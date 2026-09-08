// Mirante — processo principal.
//
// Painel do monitor vertical: mora no display secundário em pé, tela cheia, sem
// moldura, aceso o dia todo. Duas páginas: o Mirante (widgets) e os Servidores
// (dois consoles do txAdmin em <webview>).
//
// Portado de Windows para Linux/Hyprland em 07/09/2026: o que era PowerShell,
// tarefa agendada, LibreHardwareMonitor e variável de ambiente do registro virou
// leitura de /proc, hyprctl, script sh e systemd de usuário.

const { app, BrowserWindow, ipcMain, screen, safeStorage, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sentry = require('./sentry');
const discord = require('./discord-notas');
const sistema = require('./sistema');
const agenda = require('./agenda');
const flamengo = require('./flamengo');
const dev = require('./dev');
const vidro = require('./vidro');

// Sem aceleração de GPU: o painel é chapa e texto, e o Chromium com GPU no
// Wayland acorda a placa à toa em janela que nunca anima em tela cheia.
app.disableHardwareAcceleration();
app.setAppUserModelId('com.alexandre.mirante');

// O app_id que o Hyprland vê. Sem isto o Electron anuncia o `productName`
// ("RicePanel"), e a regra que o Alexandre já escreveu em `regras.lua` casa
// `class = "ricepanel"` — minúsculo, e o match é sensível a caixa. A regra
// existia e nunca pegou: era ela que devia dar workspace 9, tela cheia e
// `no_blur` ao painel. Quem cede é o app, não a config: assim o compositor
// continua sendo o dono da colocação, que é o lugar certo dela no Wayland.
app.commandLine.appendSwitch('class', 'ricepanel');

// Log gravado no proprio diretorio do app, com rotacao simples.
const LOG_FILE = path.join(__dirname, 'mirante.log');
// Sentinela lida pelo watchdog: existe = fechamento intencional, nao reabrir.
const STOP_FLAG = path.join(__dirname, 'mirante-stop.flag');

function log(msg) {
  try {
    try {
      if (fs.statSync(LOG_FILE).size > 256 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    } catch (e) {}
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

function displaysSummary() {
  try {
    return screen.getAllDisplays()
      .map(d => `#${d.id}{${d.bounds.x},${d.bounds.y} ${d.bounds.width}x${d.bounds.height}}`)
      .join(' ');
  } catch (e) {
    return '(indisponivel)';
  }
}

let mainWindow = null;
let repositionTimer = null;
let isRepositioning = false;

// O painel só existe no monitor secundário. Sem ele (só o principal ligado) a
// janela fica escondida; quando o secundário volta, ela reaparece lá e fica.
function aplicarMonitor(win) {
  if (!win || win.isDestroyed()) return;
  const alvo = displaySecundario();
  if (!alvo) {
    if (win.isVisible()) {
      win.hide();
      log(`monitor secundario ausente: painel escondido | displays: ${displaysSummary()}`);
    }
    return;
  }
  const before = win.getBounds();
  const wa = alvo.bounds;
  isRepositioning = true;
  win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
  if (!win.isVisible()) win.show();
  setTimeout(() => { isRepositioning = false; }, 150);
  log(`aplicarMonitor: de {${before.x},${before.y}} para {${wa.x},${wa.y}} ${wa.width}x${wa.height}`);
}

// A partir do Hyprland 0.54 a configuração é Lua, e `hyprctl dispatch <nome>
// <args>` e `hyprctl keyword` deixaram de existir — o dispatch de hoje recebe
// uma expressão Lua ("keyword can't work with non-legacy parsers. Use eval.").
// Tudo que o painel manda para o compositor passa por aqui.
function lua(codigo) {
  return sistema.roda('hyprctl', ['repl', codigo], 4000);
}

// Literal Lua de um texto que veio de fora (nome de monitor, de dispositivo).
// Sem aspas escapadas, um nome com aspas viraria código.
function luaTexto(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

// O lugar do painel é decisão do Hyprland, e mora no `.dotfiles`:
// `hypr/.config/hypr/regras.lua` casa a classe `RicePanel` e manda workspace 9
// (que o `monitores.lua` prende no monitor vertical), tela cheia, sem borda,
// sem sombra, sem blur e `opacity = "1.0 1.0"`.
//
// O que sobrou aqui não é política de posição: é a rede de segurança. Ela
// reaplica exatamente o que a regra já diz, e só quando a janela saiu do lugar.
async function reaplicaLugar(endereco, nomeMonitor) {
  const sel = luaTexto(endereco);
  return lua([
    "local sel = " + sel,
    "hl.dispatch(hl.dsp.window.pin({ window = sel, action = 'disable' }))",
    nomeMonitor
      ? "hl.dispatch(hl.dsp.window.move({ window = sel, monitor = " + luaTexto(nomeMonitor) + ", follow = false }))"
      : "",
    "hl.dispatch(hl.dsp.window.fullscreen({ window = sel, action = 'set', mode = 'fullscreen' }))",
    "return 'ok'"
  ].filter(Boolean).join('\n'));
}

// O monitor em pé, pelo retângulo e não pelo nome: os dois lados nomeiam
// diferente, e `transform` ímpar troca largura por altura no hyprctl.
async function nomeDoMonitorEmPe(alvo) {
  const bruto = await sistema.roda('hyprctl', ['-j', 'monitors'], 3000);
  try {
    const m = JSON.parse(bruto || '[]').find(mo => {
      const girado = mo.transform % 2 === 1;
      const l = girado ? mo.height : mo.width;
      const a = girado ? mo.width : mo.height;
      return mo.x === alvo.bounds.x && mo.y === alvo.bounds.y &&
             Math.round(l / (mo.scale || 1)) === alvo.bounds.width &&
             Math.round(a / (mo.scale || 1)) === alvo.bounds.height;
    });
    return m ? m.name : null;
  } catch (e) {
    return null;
  }
}

// --- Vigia: o painel nunca aparece no monitor principal ---------------------
//
// A regra é dura, e o custo dos dois erros é assimétrico: o painel sumir por um
// instante é nada; o painel deitar por cima da tela de trabalho é o defeito que
// não pode existir. Então a vigia é paranoica de propósito.
//
// Duas fontes de gatilho, porque nenhuma sozinha cobre tudo:
//   - o socket de eventos do Hyprland, que avisa na hora (troca de workspace,
//     de monitor em foco, janela movida, monitor conectado);
//   - um relógio de 10 s, que cobre o caso de o socket cair ou de o compositor
//     mexer na janela sem emitir evento que o painel escute.
//
// Conferir é barato: uma chamada de `hyprctl -j clients`. Reancorar só acontece
// quando a janela está no lugar errado.
let vigiaTimer = null;
let vigiaDebounce = null;
let vigiaSocket = null;

async function confereAncora(motivo) {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return;
  const alvo = displaySecundario();
  if (!alvo) return;

  const bruto = await sistema.roda('hyprctl', ['-j', 'clients'], 3000);
  let meu = null;
  try {
    meu = JSON.parse(bruto || '[]').find(c => c.pid === process.pid);
  } catch (e) {
    return;
  }
  if (!meu) return;

  // Fora de lugar é qualquer uma destas: preso (`pin` no Hyprland 0.56 segue o
  // FOCO, não o monitor — foi assim que o painel foi parar em cima da tela de
  // trabalho), fora da tela cheia, ou num retângulo que não é o do monitor em
  // pé. A tolerância de 2px é para arredondamento de escala, não para "quase".
  const b = alvo.bounds;
  const longe = (x, y) => Math.abs(x - y) > 2;
  const forado = meu.pinned ||
    !meu.fullscreen ||
    longe(meu.at[0], b.x) || longe(meu.at[1], b.y) ||
    longe(meu.size[0], b.width) || longe(meu.size[1], b.height);

  if (!forado) return;
  log('vigia (' + motivo + '): painel fora de lugar em {' + meu.at[0] + ',' + meu.at[1] + '} ' +
      meu.size[0] + 'x' + meu.size[1] + ' pinned=' + meu.pinned + ' fullscreen=' + meu.fullscreen +
      '; reaplicando a regra do dotfiles');
  const r = await reaplicaLugar('address:' + meu.address, await nomeDoMonitorEmPe(alvo));
  log('vigia: reaplicado (' + String(r).trim().slice(0, 40) + ')');
}

function agendaConfere(motivo) {
  if (vigiaDebounce) clearTimeout(vigiaDebounce);
  // Troca de workspace vem em rajada; conferir uma vez no fim basta.
  vigiaDebounce = setTimeout(() => confereAncora(motivo), 200);
}

// O socket2 do Hyprland manda uma linha por evento: `nome>>dados`.
function ouveEventosDoHyprland() {
  const his = process.env.HYPRLAND_INSTANCE_SIGNATURE;
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (!his || !runtime) return;
  const caminho = path.join(runtime, 'hypr', his, '.socket2.sock');

  let sobe;
  try {
    const net = require('net');
    vigiaSocket = net.createConnection(caminho);
  } catch (e) {
    log('vigia: socket de eventos indisponivel (' + e.message + ')');
    return;
  }

  const INTERESSA = /^(workspace|workspacev2|focusedmon|movewindow|movewindowv2|openwindow|monitoradded|monitorremoved|changefloatingmode|fullscreen)>>/;
  let resto = '';
  vigiaSocket.on('data', (buf) => {
    resto += buf.toString();
    const linhas = resto.split('\n');
    resto = linhas.pop();
    for (const l of linhas) {
      if (INTERESSA.test(l)) { agendaConfere(l.split('>>')[0]); break; }
    }
  });
  vigiaSocket.on('error', (e) => log('vigia: socket de eventos caiu (' + e.message + ')'));
  vigiaSocket.on('close', () => {
    vigiaSocket = null;
    // Reconecta: sem o socket sobra só o relógio, que é mais lento.
    sobe = setTimeout(ouveEventosDoHyprland, 5000);
    sobe.unref();
  });
  log('vigia: ouvindo eventos do Hyprland');
}

function ligaVigia() {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return;
  ouveEventosDoHyprland();
  vigiaTimer = setInterval(() => confereAncora('relogio'), 10000);
  vigiaTimer.unref();
}

function scheduleReposition() {
  if (repositionTimer) clearTimeout(repositionTimer);
  // debounce: eventos de display costumam vir em rajada (remove + metrics-changed)
  repositionTimer = setTimeout(() => {
    aplicarMonitor(mainWindow);
    confereAncora('display mudou');
  }, 300);
}

// O painel mora no display vertical. O critério é estar em pé, e só isso: lado
// não importa, e **ser primário também não**. Filtrar por "não primário" antes
// de procurar o vertical jogava o painel no monitor deitado nesta máquina, onde
// o Hyprland entrega o vertical como primário — o painel ia parar em cima da
// tela de trabalho. Sem nenhum display em pé devolve null e a janela fica
// escondida até um voltar.
function displaySecundario() {
  const todos = screen.getAllDisplays();
  const emPe = todos.filter(d => d.bounds.height > d.bounds.width);
  if (emPe.length) {
    // Com dois em pé, o que não é o primário é o painel: o primário é onde ele
    // trabalha.
    const primario = screen.getPrimaryDisplay();
    return emPe.find(d => d.id !== primario.id) || emPe[0];
  }
  return null;
}

function displayDoPainel() {
  return displaySecundario() || screen.getPrimaryDisplay();
}

function createWindow() {
  const wa = displayDoPainel().bounds;
  const win = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    frame: false,
    // A página do Mirante é camada de widget solto sobre o papel de parede: o
    // que não é widget tem de deixar o wallpaper passar. Transparência é opção
    // de criação — não dá para ligar e desligar depois —, então a janela nasce
    // transparente e quem pinta o fundo é o CSS: a Estação pinta a chapa opaca,
    // o Mirante não pinta nada.
    transparent: true,
    hasShadow: false,
    resizable: true,
    show: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });
  mainWindow = win;

  const deps = { app, safeStorage, Notification, shell, log, getWindow: () => mainWindow };
  sentry.iniciar(deps);
  discord.iniciar(deps);
  agenda.iniciar(deps);
  flamengo.iniciar(deps);
  dev.iniciar({ log, empurra, getWindow: () => mainWindow });
  vidro.iniciar({ app, log, empurra });

  win.webContents.on('console-message', (e, nivel, msg, linha, fonte) => {
    if (nivel >= 2) log('renderer: ' + String(msg).slice(0, 200) + ' (' + fonte + ':' + linha + ')');
  });
  // `ready-to-show` é o gatilho certo, mas não é garantido: neste Electron sob
  // Wayland, com a janela sem moldura e sem aceleração, ele não chega — e a
  // janela nasce com `show: false`, então ficava criada e nunca mapeada. Sem um
  // segundo caminho, o painel sobe invisível e só o log conta que existe.
  //
  // Os três caminhos são idempotentes: `aplicarMonitor` só chama `show()` com a
  // janela ainda escondida.
  let jaMostrou = false;
  const mostraUmaVez = (de) => {
    if (jaMostrou || !win || win.isDestroyed()) return;
    jaMostrou = true;
    aplicarMonitor(win);
    log(`primeira exibicao por ${de}: secundario=${displaySecundario() ? 'sim' : 'nao'} | visivel=${win.isVisible()}`);
    // A janela precisa estar mapeada para o hyprctl enxergá-la; um quadro de
    // folga basta, e a segunda tentativa cobre o compositor mais lento.
    setTimeout(() => confereAncora('subiu'), 500);
    setTimeout(() => confereAncora('subiu'), 2500);
  };
  win.once('ready-to-show', () => mostraUmaVez('ready-to-show'));
  win.webContents.once('did-finish-load', () => mostraUmaVez('did-finish-load'));
  // Rede de segurança: página que trava no carregamento não pode deixar o
  // painel escondido para sempre.
  setTimeout(() => mostraUmaVez('prazo de 4 s'), 4000).unref();
  win.loadFile('painel.html');
  log(`Mirante iniciado em {${wa.x},${wa.y}} ${wa.width}x${wa.height} | pid ${process.pid} | displays: ${displaysSummary()}`);

  setInterval(() => log('heartbeat: vivo'), 120000).unref();

  win.webContents.on('render-process-gone', (e, d) => {
    log(`render-process-gone: reason=${d.reason} exitCode=${d.exitCode}`);
  });
  screen.on('display-removed', (e, d) => { log(`display-removed #${d && d.id}`); scheduleReposition(); });
  screen.on('display-added', (e, d) => { log(`display-added #${d && d.id}`); scheduleReposition(); });
  screen.on('display-metrics-changed', (e, d, c) => { log(`display-metrics-changed #${d && d.id} [${(c || []).join(',')}]`); scheduleReposition(); });
}

// --- Cota do Claude Code ---------------------------------------------------
ipcMain.handle('get-usage', async () => {
  // Token OAuth fica em secure storage do binario do CLI (keyring).
  // Para o painel acessar, gere um setup-token: `claude setup-token`
  const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
  if (!fs.existsSync(credPath)) return { error: 'Execute `claude setup-token` no terminal.' };

  let token;
  try {
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    token = creds.claudeAiOauth && creds.claudeAiOauth.accessToken;
  } catch (e) {
    return { error: 'Falha ao ler credenciais: ' + e.message };
  }
  if (!token) return { error: 'Execute `claude setup-token` para gerar token persistente.' };

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': 'Bearer ' + token,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) return { error: 'Erro HTTP ' + res.status, status: res.status };
    return { data: await res.json() };
  } catch (e) {
    return { error: 'Erro de rede: ' + e.message };
  }
});

// --- Máquina: um tique só, empurrado para o renderer -----------------------
// O renderer não pergunta: o main lê e manda. Assim o intervalo é um só, e a
// leitura de CPU (que é delta entre tiques) tem cadência constante.
const TIQUE_MS = 2000;
const TIQUE_LENTO_MS = 60000;   // pacotes e coisa que muda devagar

function empurra(canal, dados) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(canal, dados);
  } catch (e) {}
}

async function tique() {
  try {
    const [retrato, hypr, musica] = await Promise.all([
      sistema.retrato(), sistema.hyprland(), sistema.musica()
    ]);
    empurra('sistema-update', { retrato, hypr, musica });
  } catch (e) {
    log('tique de sistema falhou: ' + e.message);
  }
}

async function tiqueLento() {
  try {
    empurra('pacotes-update', await sistema.pacotes());
  } catch (e) {}
  // O módulo do jogo tem cadência própria (10 min, 1 min com jogo rolando); o
  // tique lento só carrega para a tela o que ele já leu.
  try {
    empurra('flamengo-update', flamengo.atual());
  } catch (e) {}
}

function ligaTiques() {
  tique();
  tiqueLento();
  setInterval(tique, TIQUE_MS).unref();
  setInterval(tiqueLento, TIQUE_LENTO_MS).unref();
}

// Primeira pintura sem esperar o tique: o renderer pede uma vez ao subir.
ipcMain.handle('get-sistema', async () => {
  const [retrato, hypr, musica] = await Promise.all([
    sistema.retrato(), sistema.hyprland(), sistema.musica()
  ]);
  return { retrato, hypr, musica };
});

// Compatibilidade: o painel antigo pedia só as temperaturas, numa chamada
// separada da do retrato. Continua funcionando, servido do mesmo `sistema`.
ipcMain.handle('get-temps', async () => {
  const r = await sistema.retrato();
  return {
    cpu: r.cpu ? r.cpu.temp : null,
    gpu: r.gpu ? r.gpu.temp : null,
    nvme: r.nvme
  };
});

// --- Vidro: o fundo desfocado das placas do Mirante ------------------------
ipcMain.handle('vidro-get', async () => vidro.atual());

// --- Agenda (Google Calendar por iCal) -------------------------------------
// --- Música: os três botões da placa do Spotify ----------------------------
// Whitelist fechada: o renderer manda um verbo, nunca uma linha de comando. O
// player também é escolhido aqui — `-p spotify` evita mandar o comando para o
// player do Chromium quando os dois estão vivos ao mesmo tempo.
const COMANDOS_MUSICA = { anterior: 'previous', proximo: 'next', alterna: 'play-pause' };

ipcMain.handle('musica-comando', async (e, verbo, player) => {
  const cmd = COMANDOS_MUSICA[verbo];
  if (!cmd) return { ok: false, error: 'comando desconhecido' };
  const alvo = /^[A-Za-z0-9._-]{1,40}$/.test(String(player || '')) ? String(player) : '';
  const args = alvo ? ['-p', alvo, cmd] : [cmd];
  await sistema.roda('playerctl', args, 2500);
  // O tique de 2 s já traz o estado novo; devolver ok só fecha o clique.
  return { ok: true };
});

ipcMain.handle('flamengo-get', async () => flamengo.atual());
ipcMain.handle('flamengo-refresh', async () => flamengo.forcar());

ipcMain.handle('agenda-get', async () => agenda.atual());
ipcMain.handle('agenda-refresh', async () => agenda.forcar());
ipcMain.handle('agenda-url-pista', async () => agenda.pistaUrl());
ipcMain.handle('agenda-url-set', async (e, url) => {
  const r = await agenda.definirUrl(url);
  log('agenda: URL ' + (r.ok ? 'aceita' : 'recusada — ' + r.error));
  return r;
});

// --- Modo Dev --------------------------------------------------------------
ipcMain.handle('dev-projetos', async () => dev.listaProjetos());
ipcMain.handle('dev-avds', async () => dev.listaAvds());
ipcMain.handle('dev-estado', async () => dev.noAr());
ipcMain.handle('dev-subir', async (e, pasta, avd, alvo) => {
  try {
    return await dev.subir(pasta, avd, alvo);
  } catch (err) {
    log('dev-subir ERRO: ' + err.message);
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('dev-matar', async () => {
  try {
    return await dev.matar();
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('dev-mostrar', async (e, mostrar) => dev.mostrar(!!mostrar));
ipcMain.handle('dev-encaixar', async (e, caixa) => dev.encaixar(caixa || {}));

// --- Limpeza de cache ------------------------------------------------------
const MANUT_SH = path.join(__dirname, 'manutencao.sh');
const MAINT_STATUS = path.join(__dirname, 'maintenance.status.json');

function leStatusManutencao() {
  try {
    if (!fs.existsSync(MAINT_STATUS)) return null;
    // O arquivo antigo veio do powershell.exe, que grava UTF-8 com BOM.
    return JSON.parse(fs.readFileSync(MAINT_STATUS, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    return null;
  }
}

// No Linux não há elevação a pedir: o script só mexe em $HOME e roda como o
// usuário. Dispara solto e o painel acompanha pelo status, como antes.
function disparaManutencao() {
  const { spawn } = require('child_process');
  try {
    const p = spawn('/usr/bin/env', ['bash', MANUT_SH], { detached: true, stdio: 'ignore' });
    p.unref();
    return true;
  } catch (e) {
    log('manutencao: falha ao disparar: ' + e.message);
    return false;
  }
}

ipcMain.handle('run-maintenance', async () => {
  try { fs.writeFileSync(MAINT_STATUS, JSON.stringify({ running: true, ok: true, steps: [] })); } catch (e) {}
  const ok = disparaManutencao();
  log('run-maintenance: ' + (ok ? 'disparado' : 'falhou'));
  return { launched: ok };
});

ipcMain.handle('get-maintenance', async () => leStatusManutencao());

// Limpeza sozinha de 6 em 6 horas. A conta é sobre a hora da última limpeza, não
// sobre um tique de 6 h: máquina desligada um dia limpa na primeira checagem
// depois de voltar.
const LIMPEZA_INTERVALO_MS = 6 * 60 * 60 * 1000;
const LIMPEZA_CHECAGEM_MS = 10 * 60 * 1000;

function ultimaLimpezaMs() {
  const st = leStatusManutencao();
  const t = Date.parse((st && st.finishedAt) || '');
  return Number.isFinite(t) ? t : 0;
}

function avisa(titulo, corpo) {
  try {
    if (Notification.isSupported()) new Notification({ title: titulo, body: corpo }).show();
  } catch (e) {}
}

function acompanhaLimpeza() {
  const limite = Date.now() + 30 * 60 * 1000;
  const timer = setInterval(() => {
    const st = leStatusManutencao();
    if (st && st.running === false) {
      clearInterval(timer);
      const total = (st.steps || []).reduce((s, p) => s + (Number(p.freedMB) || 0), 0);
      avisa('Cache limpo', 'Liberado ' + total.toFixed(1).replace('.', ',') + ' MB.');
      log('limpeza automatica: concluida, ' + total.toFixed(1) + ' MB');
    } else if (Date.now() > limite) {
      clearInterval(timer);
      log('limpeza automatica: passou de 30 min sem status de fim');
    }
  }, 15000);
  timer.unref();
}

function limpezaAutomatica() {
  if (Date.now() - ultimaLimpezaMs() < LIMPEZA_INTERVALO_MS) return;
  try { fs.writeFileSync(MAINT_STATUS, JSON.stringify({ running: true, ok: true, steps: [] })); } catch (e) {}
  if (!disparaManutencao()) return;
  log('limpeza automatica: disparada');
  avisa('Limpando cache', 'Manutenção de 6 em 6 horas rodando em segundo plano.');
  acompanhaLimpeza();
}

function agendaLimpezaAutomatica() {
  setTimeout(limpezaAutomatica, 2 * 60 * 1000).unref();
  setInterval(limpezaAutomatica, LIMPEZA_CHECAGEM_MS).unref();
}

// --- Credencial do Claude Code (assinatura Max <-> API/gateway) ------------
// A chave fica cifrada com safeStorage (keyring do desktop) em userData, nunca
// em texto puro no repositório. Quem manda é o ~/.claude/settings.json: o Claude
// Code lê esse arquivo em toda sessão nova, então gravar ali é o que faz a troca
// valer. No Windows havia ainda variável de ambiente de escopo User; no Linux
// não existe equivalente que alcance um shell já aberto, e o settings.json
// sozinho já resolve.
const KEY_FILE = () => path.join(app.getPath('userData'), 'apikey.bin');
const DEFAULT_BASE_URL = 'https://avellogateway.online';
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');

function writeSettingsAuth(mode, baseUrl, key) {
  let raw;
  try { raw = fs.readFileSync(SETTINGS_FILE, 'utf8'); } catch (e) { raw = '{}'; }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    throw new Error('settings.json com JSON inválido; nada foi alterado');
  }
  const env = Object.assign({}, cfg.env);
  if (mode === 'api') {
    env.ANTHROPIC_BASE_URL = baseUrl;
    env.ANTHROPIC_AUTH_TOKEN = key;
  } else {
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }
  if (Object.keys(env).length) cfg.env = env; else delete cfg.env;

  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  try { fs.writeFileSync(SETTINGS_FILE + '.bak', raw); } catch (e) {}
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(cfg, null, 2) + '\n');
}

function readSettingsAuth() {
  try {
    const cfg = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const env = cfg.env || {};
    return { hasToken: !!env.ANTHROPIC_AUTH_TOKEN, baseUrl: env.ANTHROPIC_BASE_URL || '' };
  } catch (e) {
    return { hasToken: false, baseUrl: '' };
  }
}

function readSavedKey() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(fs.readFileSync(KEY_FILE()));
  } catch (e) {
    return null;
  }
}

ipcMain.handle('get-auth', async () => {
  const st = readSettingsAuth();
  const saved = readSavedKey();
  return {
    mode: st.hasToken ? 'api' : 'max',
    baseUrl: st.baseUrl || '',
    defaultUrl: DEFAULT_BASE_URL,
    keyHint: saved ? saved.slice(0, 6) + '…' + saved.slice(-4) : ''
  };
});

ipcMain.handle('set-auth', async (e, opts) => {
  const mode = opts && opts.mode;
  try {
    if (mode === 'max') {
      writeSettingsAuth('max');
      log('set-auth: modo assinatura');
      return { ok: true, mode: 'max' };
    }
    const key = ((opts && opts.key) || '').trim() || readSavedKey();
    if (!key) return { ok: false, error: 'Sem chave salva — cole a chave.' };
    const baseUrl = ((opts && opts.baseUrl) || '').trim() || DEFAULT_BASE_URL;
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(KEY_FILE(), safeStorage.encryptString(key));
    }
    writeSettingsAuth('api', baseUrl, key);
    log('set-auth: modo API (' + baseUrl + ')');
    return { ok: true, mode: 'api' };
  } catch (err) {
    log('set-auth ERRO: ' + err.message);
    return { ok: false, error: err.message };
  }
});

// --- Sentry ----------------------------------------------------------------
ipcMain.handle('sentry-get', async () => sentry.atual());
ipcMain.handle('sentry-refresh', async () => { await sentry.forcar(); return sentry.atual(); });
ipcMain.handle('sentry-seen', async () => sentry.marcarVistos());
ipcMain.handle('sentry-resolve', async (e, id, status) => {
  try {
    return await sentry.resolve(id, status);
  } catch (err) {
    log('sentry-resolve ERRO: ' + err.message);
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('sentry-detalhe', async (e, id) => {
  try {
    return await sentry.detalhe(id);
  } catch (err) {
    log('sentry-detalhe ERRO: ' + err.message);
    return null;
  }
});
ipcMain.on('sentry-open', (e, url) => {
  // So abre link do proprio Sentry: evita virar abridor generico de URL.
  if (typeof url === 'string' && /^https:\/\/[a-z0-9.-]*sentry\.io\//i.test(url)) shell.openExternal(url);
});

// --- Discord ---------------------------------------------------------------
ipcMain.handle('discord-get', async () => discord.atual());
ipcMain.handle('discord-refresh', async () => { await discord.forcar(); return discord.atual(); });
ipcMain.handle('discord-seen', async () => discord.marcarVistos());
ipcMain.handle('discord-recount', async () => discord.recontar());
ipcMain.handle('discord-topico', async (e, id, nome, resposta) => {
  try {
    return await discord.criarTopico(id, nome, resposta);
  } catch (err) {
    log('discord-topico ERRO: ' + err.message);
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('discord-reagir', async (e, id, emoji) => {
  // Lista fechada: o renderer nao escolhe emoji arbitrario para mandar na URL.
  const permitidos = ['\u{1F44D}', '❌', '✅'];
  if (permitidos.indexOf(emoji) < 0) return { ok: false, error: 'emoji nao permitido' };
  try {
    return await discord.reagir(id, emoji);
  } catch (err) {
    log('discord-reagir ERRO: ' + err.message);
    return { ok: false, error: err.message };
  }
});

// --- txAdmin ---------------------------------------------------------------
// A senha nunca mora no repositorio nem no HTML: vem de um arquivo fora do git e
// fica cifrada com safeStorage em userData.
const TX_ENV = path.join(os.homedir(), '.config', 'mirante', 'txadmin.env');
const TX_ENV_ANTIGO = path.join(os.homedir(), 'Downloads', 'Apps', '_CLAUDE', '.secrets', 'txadmin.env');
const TX_CRED = () => path.join(app.getPath('userData'), 'txadmin-cred.bin');
let txCredCache = null;

function lerTxCred() {
  if (txCredCache) return txCredCache;
  try {
    if (safeStorage.isEncryptionAvailable() && fs.existsSync(TX_CRED())) {
      const c = JSON.parse(safeStorage.decryptString(fs.readFileSync(TX_CRED())));
      if (c && c.user && c.pass) { txCredCache = c; return c; }
    }
  } catch (e) {}
  for (const arq of [TX_ENV, TX_ENV_ANTIGO]) {
    try {
      const raw = fs.readFileSync(arq, 'utf8');
      const u = (raw.match(/^\s*TXADMIN_USER\s*=\s*(.+)$/m) || [])[1];
      const p = (raw.match(/^\s*TXADMIN_PASS\s*=\s*(.+)$/m) || [])[1];
      if (u && p) {
        const c = { user: u.trim(), pass: p.trim() };
        try {
          if (safeStorage.isEncryptionAvailable()) {
            fs.writeFileSync(TX_CRED(), safeStorage.encryptString(JSON.stringify(c)));
          }
        } catch (e) {}
        txCredCache = c;
        log('txadmin: credencial importada para o cofre local (usuario ' + c.user + ')');
        return c;
      }
    } catch (e) {}
  }
  log('txadmin: sem credencial salva; consoles ficam na tela de login');
  return null;
}

ipcMain.handle('tx-cred', async () => lerTxCred());

// Batida no txAdmin. O <webview> nao avisa quando o servidor morre com a pagina
// ja carregada: ele segura o ultimo quadro. Qualquer resposta HTTP (inclusive
// 302 para o login) conta como vivo; so falha de rede e queda.
ipcMain.handle('tx-ping', async (e, host, porta) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch('http://' + host + ':' + porta + '/', {
      method: 'GET', signal: ctrl.signal, redirect: 'manual', cache: 'no-store'
    });
    return { ok: true, status: res.status };
  } catch (err) {
    const codigo = (err.cause && err.cause.code) || (err.name === 'AbortError' ? 'ETIMEDOUT' : err.message);
    return { ok: false, motivo: String(codigo) };
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.on('tela-estado', (e, i, r) => {
  if (!r) return;
  log('txadmin ' + (i === 0 ? 'remoto' : 'local') + ': ' +
      (r.senha ? 'ainda na tela de login' : 'logado') + ' (caminho ' + r.caminho + ')');
});

// A fonte do log vai injetada como data: URL. JetBrains Mono nao e fonte do
// sistema garantida: sem mandar o arquivo junto, o canvas do xterm cai no fallback.
let fonteLogCache = null;
ipcMain.handle('fonte-log', async () => {
  if (fonteLogCache !== null) return fonteLogCache;
  try {
    const bruto = fs.readFileSync(path.join(__dirname, 'fontes', 'jetbrains-mono-latin.woff2'));
    fonteLogCache = 'data:font/woff2;base64,' + bruto.toString('base64');
  } catch (e) {
    log('fonte do log nao carregou: ' + e.message);
    fonteLogCache = '';
  }
  return fonteLogCache;
});

// Erro no console de um servidor avisa em qualquer página: notificação e log.
ipcMain.on('alerta-console', (e, dados) => {
  if (!dados || !Array.isArray(dados.linhas) || !dados.linhas.length) return;
  const cabeca = dados.linhas[0].slice(0, 180);
  log('console ' + dados.onde + ': ' + dados.linhas.length + ' erro(s) — ' + cabeca);
  avisa('Erro no console · ' + dados.onde, cabeca);
  try { shell.beep(); } catch (err) {}
});

ipcMain.on('diag', (e, texto) => log('painel: ' + String(texto).slice(0, 200)));

// --- Servidores configuráveis ---------------------------------------------
const SERV_FILE = () => path.join(app.getPath('userData'), 'servidores.json');
// Sem endereço de verdade no código: quem clona o projeto não tem nada a ver
// com o servidor de ninguém, e endereço de painel administrativo publicado é
// convite. Os dois hosts reais moram em `servidores.json` no userData, que o
// próprio painel escreve pela tela de ajuste.
const SERV_PADRAO = [
  { nome: 'Servidor remoto', host: 'localhost', porta: 40120 },
  { nome: 'Servidor local', host: 'localhost', porta: 40120 }
];

function lerServidores() {
  try {
    const s = JSON.parse(fs.readFileSync(SERV_FILE(), 'utf8'));
    if (Array.isArray(s) && s.length === 2) return s;
  } catch (e) {}
  return SERV_PADRAO;
}

ipcMain.handle('serv-get', async () => lerServidores());

ipcMain.handle('serv-set', async (e, lista) => {
  // Host e porta vem de campo de texto: valida antes de gravar, senao um espaco
  // a mais vira uma URL quebrada que o webview nunca carrega.
  if (!Array.isArray(lista) || lista.length !== 2) return { ok: false, error: 'lista inválida' };
  try {
    const limpa = lista.map((s, i) => {
      const host = String(s.host || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      const porta = Number(s.porta);
      if (!/^[a-z0-9.\-]+$/i.test(host)) throw new Error('endereço inválido: ' + host);
      if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw new Error('porta inválida: ' + s.porta);
      return { nome: String(s.nome || SERV_PADRAO[i].nome).trim().slice(0, 40), host, porta };
    });
    fs.writeFileSync(SERV_FILE(), JSON.stringify(limpa, null, 1));
    log('servidores: ' + limpa.map(s => s.host + ':' + s.porta).join(' | '));
    return { ok: true, servidores: limpa };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- Trava do teclado ------------------------------------------------------
// Limpar o teclado sem desligar o PC. No Hyprland dá para desligar o dispositivo
// de entrada por nome; o hook de baixo nível do Windows não tem equivalente e
// nem precisa.
//
// O destravamento NÃO depende deste processo: junto com a trava sai um `sh`
// solto que espera o tempo e religa o teclado. Se o Mirante morrer travado, o
// teclado volta assim mesmo — é a única saída que não exige teclado.
const TRAVA_MIN_S = 5;
const TRAVA_MAX_S = 600;
let travaAte = 0;
let travaTeclados = [];
let travaTimer = null;

async function tecladosDoHypr() {
  const bruto = await sistema.roda('hyprctl', ['-j', 'devices'], 2000);
  try {
    const d = JSON.parse(bruto || '{}');
    return (d.keyboards || []).map(k => k.name).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function ligaTeclados(nomes, ligado) {
  for (const nome of nomes) {
    await lua('hl.config({ device = { [' + luaTexto(nome) + '] = { enabled = ' +
      (ligado ? 'true' : 'false') + ' } } }) return \'ok\'');
  }
}

// Teclado desligado some da lista de dispositivos do Hyprland. É a única prova
// que dá para ter daqui — e ela é obrigatória: dizer "travado" sem estar é o
// pior erro possível nesta tela, porque ele passa o pano no teclado ligado.
async function tecladosSumiram(nomes) {
  const ainda = await tecladosDoHypr();
  return nomes.every(n => ainda.indexOf(n) < 0);
}

function soltaTecladoJa(motivo) {
  if (!travaTeclados.length) return false;
  const nomes = travaTeclados;
  travaTeclados = [];
  travaAte = 0;
  if (travaTimer) { clearTimeout(travaTimer); travaTimer = null; }
  ligaTeclados(nomes, true);
  log('teclado: solto (' + motivo + ')');
  return true;
}

ipcMain.handle('teclado-travar', async (e, segundos) => {
  if (travaTeclados.length) return { ok: true, ja: true, ate: travaAte };
  const seg = Math.max(TRAVA_MIN_S, Math.min(TRAVA_MAX_S, Number(segundos) || 120));
  const nomes = await tecladosDoHypr();
  if (!nomes.length) {
    log('teclado: nenhum dispositivo listado pelo hyprctl');
    return { ok: false, error: 'nenhum teclado encontrado no Hyprland' };
  }

  await ligaTeclados(nomes, false);

  // Confere antes de dizer que travou. No Hyprland 0.56 a configuração de
  // dispositivo migrou para Lua e `hl.config({ device = ... })` aceita a
  // chamada sem desligar nada — o teclado seguia vivo com o painel anunciando
  // "travado". Sem prova, desfaz e devolve erro.
  if (!(await tecladosSumiram(nomes))) {
    await ligaTeclados(nomes, true);
    log('teclado: o Hyprland aceitou o comando mas nao desligou os dispositivos; trava recusada');
    return {
      ok: false,
      error: 'este Hyprland (' + os.release() + ') não desliga o teclado por configuração; ' +
             'a trava foi recusada para o painel não dizer que travou sem ter travado'
    };
  }

  // Rede de segurança fora deste processo: mesmo que o painel morra travado, o
  // teclado volta no fim do tempo.
  try {
    const { spawn } = require('child_process');
    const volta = nomes
      .map(n => "hyprctl repl \"hl.config({ device = { ['" + n.replace(/'/g, "") + "'] = { enabled = true } } })\"")
      .join('; ');
    const p = spawn('/bin/sh', ['-c', 'sleep ' + seg + '; ' + volta], { detached: true, stdio: 'ignore' });
    p.unref();
  } catch (err) {
    log('teclado: rede de seguranca nao subiu: ' + err.message);
  }

  travaTeclados = nomes;
  travaAte = Date.now() + seg * 1000;
  travaTimer = setTimeout(() => soltaTecladoJa('tempo'), seg * 1000);
  travaTimer.unref();
  log('teclado: travado por ' + seg + 's (' + nomes.join(', ') + ')');
  return { ok: true, ate: travaAte, segundos: seg };
});

ipcMain.handle('teclado-soltar', async () => ({ ok: true, soltou: soltaTecladoJa('painel') }));

ipcMain.handle('teclado-estado', async () => ({
  travado: !!travaTeclados.length,
  ate: travaAte,
  restante: travaTeclados.length ? Math.max(0, travaAte - Date.now()) : 0
}));

app.on('before-quit', () => soltaTecladoJa('app encerrando'));

// Emulador e bundler são filhos do painel: sair sem derrubá-los deixa o AVD
// travado e a porta do Metro ocupada até o próximo reboot.
app.on('before-quit', () => { try { dev.matar(); } catch (e) {} });

// --- Dormir as telas -------------------------------------------------------
ipcMain.handle('telas-dormir', async () => {
  const out = await lua("hl.dispatch(hl.dsp.dpms({ action = 'disable' })) return 'ok'");
  const ok = /ok/i.test(out) && !/error/i.test(out);
  log('telas-dormir: ' + (ok ? 'monitores apagados' : 'falhou (' + out.trim().slice(0, 80) + ')'));
  return { ok };
});

// --- Reiniciar o próprio painel -------------------------------------------
ipcMain.handle('painel-reiniciar', async () => {
  log('painel-reiniciar: pedido pelo painel');
  try { fs.unlinkSync(STOP_FLAG); } catch (e) {}
  app.relaunch();
  setTimeout(() => app.exit(0), 250);
  return { ok: true };
});

// Abre no navegador padrao. Lista curta de destinos: nao vira abridor generico.
ipcMain.on('abrir-url', (e, url) => {
  if (typeof url !== 'string') return;
  const servs = lerServidores();
  const doTx = servs.some(s =>
    url.startsWith('http://' + s.host + ':' + s.porta + '/'));
  if (/^https:\/\/(discord\.com|[a-z0-9.-]*sentry\.io)\//i.test(url) || doTx) shell.openExternal(url);
});

ipcMain.on('close-app', () => {
  log('close-app: encerrado pelo usuario (botao fechar)');
  try { fs.writeFileSync(STOP_FLAG, new Date().toISOString()); } catch (e) {}
  app.quit();
});

app.on('before-quit', () => log('before-quit: app encerrando'));
app.on('will-quit', () => log('will-quit: app vai sair'));
app.on('quit', (e, code) => log(`quit: codigo ${code}`));
app.on('child-process-gone', (e, d) => log(`child-process-gone: type=${d.type} reason=${d.reason}`));

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  try { process.on(sig, () => { log(`sinal ${sig} recebido: terminacao externa`); app.quit(); }); } catch (e) {}
}
process.on('uncaughtException', (err) => log(`uncaughtException: ${err && err.stack || err}`));
process.on('unhandledRejection', (r) => log(`unhandledRejection: ${r}`));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    ligaVigia();
    ligaTiques();
    agendaLimpezaAutomatica();
  });
}

app.on('window-all-closed', () => app.quit());
