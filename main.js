const { app, BrowserWindow, ipcMain, screen, safeStorage, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sentry = require('./sentry');
const discord = require('./discord-notas');

// Widget simples: sem aceleracao de GPU evita os erros de cache do Chromium
app.disableHardwareAcceleration();
// Sem AppUserModelId o Windows nao entrega o toast de notificacao (ele fica
// preso ao electron.exe generico e some da central de notificacoes).
app.setAppUserModelId('com.alexandre.widget-claude');

const WIDTH = 420;
const HEIGHT = 258;
const DEFAULT_X = -664;
const DEFAULT_Y = 695;

// Log gravado no proprio diretorio do widget (widget.log), com rotacao simples.
const LOG_FILE = path.join(__dirname, 'widget.log');
// Sentinela lida pelo watchdog: existe = fechamento intencional, nao reabrir.
const STOP_FLAG = path.join(__dirname, 'widget-stop.flag');
function log(msg) {
  try {
    // rotaciona se passar de ~256 KB
    try {
      if (fs.statSync(LOG_FILE).size > 256 * 1024) {
        fs.renameSync(LOG_FILE, LOG_FILE + '.old');
      }
    } catch (e) {}
    const ts = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`);
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

function posFile() {
  return path.join(app.getPath('userData'), 'position.json');
}

function loadPos() {
  try {
    const p = JSON.parse(fs.readFileSync(posFile(), 'utf8'));
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
  } catch (e) {}
  return { x: DEFAULT_X, y: DEFAULT_Y };
}

function savePos(bounds) {
  try {
    fs.writeFileSync(posFile(), JSON.stringify({ x: bounds.x, y: bounds.y }));
  } catch (e) {}
}

// Nome do processo (sem .exe), comparado por substring e minusculo.
// O widget SEMPRE fica na frente destes: navegador nunca pode cobri-lo.
const BROWSERS = ['firefox', 'chrome'];
// O widget NUNCA fica na frente destes: emulador cobrindo a area manda o widget
// para tras dele. 'qemu-system' pega x86_64 e aarch64 do emulador do Android.
const EMULATORS = ['qemu-system', 'emulator', 'scrcpy', 'bluestacks', 'hd-player', 'ldplayer', 'nox', 'memu'];
// Janelas-fantasma que cobrem a area sem serem app de verdade. O overlay do
// Lightshot fica sempre presente e era o que derrubava o widget para tras do
// Firefox: bastava ele ser contado como "outro app" cobrindo.
const IGNORED = ['lightshot'];

let mainWindow = null;
let topMost = true;           // estado atual do alwaysOnTop
let desiredPos = null;      // ultima posicao escolhida pelo usuario (alvo ao restaurar monitores)
let isRepositioning = false; // ignora evento 'moved' durante reposicionamento programatico
let repositionTimer = null;

// Retorna o display que contem o centro destes bounds, ou null se estiver fora de toda tela.
function getDisplayForBounds(bounds) {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return screen.getAllDisplays().find(d => {
    const a = d.bounds;
    return cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height;
  }) || null;
}

// O painel so existe no monitor secundario. Sem ele (so o monitor 1 ligado) a
// janela fica escondida; quando o secundario volta, ela reaparece la e fica.
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
  if (!win.isVisible()) {
    win.show();
    // skipTaskbar no Windows nao e um estilo da janela: o Electron chama
    // ITaskbarList::DeleteTab. Todo hide/show devolve o botao para a barra, entao
    // reaplicar aqui e o que mantem o painel fora dela quando o monitor volta.
    win.setSkipTaskbar(true);
  }
  setTimeout(() => { isRepositioning = false; }, 150);
  log(`aplicarMonitor: de {${before.x},${before.y}} para {${wa.x},${wa.y}} ${wa.width}x${wa.height} | displays: ${displaysSummary()}`);
}

function applyTopMost(on) {
  topMost = on;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // So o caso topmost e aplicado pelo Electron; o caso "abaixo" fica a cargo do
  // watcher, que insere a janela logo atras do app em foreground. Chamar
  // setAlwaysOnTop(false) aqui desfaria isso (NOTOPMOST sobe acima do app ativo).
  if (on) mainWindow.setAlwaysOnTop(true, 'screen-saver');
}

// Watcher em powershell persistente: le o processo em foreground, ajusta a
// z-order do widget via SetWindowPos e reporta o estado (TOP/BELOW <processo>).
function startForegroundWatch() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { spawn } = require('child_process');
  const script = path.join(__dirname, 'foreground-watch.ps1');
  const hwnd = mainWindow.getNativeWindowHandle().readBigUInt64LE(0).toString();
  let ps;
  try {
    ps = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Hwnd', hwnd,
      '-Browsers', BROWSERS.join(','),
      '-Emulators', EMULATORS.join(','),
      '-Ignore', IGNORED.join(',')
    ], { windowsHide: true });
  } catch (e) {
    log('foreground-watch: falha ao iniciar: ' + e.message);
    return;
  }
  let buf = '';
  ps.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const [state, name] = line.split(/\s+/, 2);
      topMost = state === 'TOP';
      // 'name' e o processo da janela mais alta que cobre a area do widget
      // (nao o app em foco) - e ele que decide se o widget sobe ou desce.
      log(`cobrindo=${name} => ${state}`);
    }
  });
  ps.stderr.on('data', (d) => log('foreground-watch stderr: ' + String(d).trim()));
  ps.on('exit', (code) => {
    log(`foreground-watch encerrou (code ${code}); reiniciando em 5s`);
    setTimeout(startForegroundWatch, 5000).unref();
  });
  app.on('before-quit', () => { try { ps.kill(); } catch (e) {} });
}

function scheduleReposition() {
  if (repositionTimer) clearTimeout(repositionTimer);
  // debounce: eventos de display costumam vir em rajada (remove + metrics-changed)
  repositionTimer = setTimeout(() => aplicarMonitor(mainWindow), 300);
}

// Monitor de trabalho: o painel mora no display vertical (o secundario). Sem
// secundario devolve null - a janela fica escondida ate ele voltar.
function displaySecundario() {
  const todos = screen.getAllDisplays();
  const primario = screen.getPrimaryDisplay();
  const secundarios = todos.filter(d => d.id !== primario.id);
  if (!secundarios.length) return null;
  // Prefere o mais "em pe" (altura > largura); senao, o primeiro secundario.
  return secundarios.find(d => d.bounds.height > d.bounds.width) || secundarios[0];
}

// Bounds de partida da janela: o secundario quando existe, senao o primario
// (so para nascer com geometria valida - escondida).
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
    resizable: true,
    // Quem manda mostrar e o aplicarMonitor: sem monitor secundario o painel
    // nem aparece.
    show: false,
    // Fora da barra de tarefas: o painel mora no monitor vertical e fica aceso o
    // dia todo. Botao na barra so ocupa espaco e convida a minimizar uma tela que
    // nao deveria sumir — e sem moldura nao ha como restaurar de volta.
    skipTaskbar: true,
    backgroundColor: '#0e0e11',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Os dois consoles do txAdmin vivem em <webview>, cada um com sua sessao
      // persistente (o login fica salvo entre reinicios).
      webviewTag: true
    }
  });
  mainWindow = win;

  const deps = { app, safeStorage, Notification, shell, log, getWindow: () => mainWindow };
  sentry.iniciar(deps);
  discord.iniciar(deps);
  win.webContents.on('console-message', (e, nivel, msg, linha, fonte) => {
    if (nivel >= 2) log('renderer: ' + String(msg).slice(0, 200) + ' (' + fonte + ':' + linha + ')');
  });
  win.once('ready-to-show', () => {
    aplicarMonitor(win);
    log(`ready-to-show: secundario=${displaySecundario() ? 'sim' : 'nao'}`);
  });
  win.loadFile('painel.html');
  log(`Painel iniciado em {${wa.x},${wa.y}} ${wa.width}x${wa.height} | pid ${process.pid} | displays: ${displaysSummary()}`);

  // Heartbeat: grava sinal de vida a cada 2 min. Se o widget some sem log de
  // encerramento, o ultimo heartbeat marca o momento aproximado da morte =>
  // diferencia kill duro/crash (sem before-quit) de saida graciosa.
  setInterval(() => {
  log('heartbeat: vivo');
  // Reiniciar o Explorer recria a barra de tarefas do zero, e ela volta com o
  // botao do painel — nao ha evento de TaskbarCreated no Electron, entao o
  // heartbeat serve de carona para desfazer isso em ate 2 min.
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) mainWindow.setSkipTaskbar(true);
}, 120000).unref();

  // Renderer morto (crash/OOM da pagina) nao dispara before-quit; registra aqui.
  win.webContents.on('render-process-gone', (e, details) => {
    log(`render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });
  // Monitor entrando/saindo (sleep do DisplayPort) reposiciona o painel no
  // display certo, senao ele fica fora da tela quando a topologia muda.
  screen.on('display-removed', (e, d) => { log(`display-removed #${d && d.id} | restantes: ${displaysSummary()}`); scheduleReposition(); });
  screen.on('display-added', (e, d) => { log(`display-added #${d && d.id} | agora: ${displaysSummary()}`); scheduleReposition(); });
  screen.on('display-metrics-changed', (e, d, changed) => { log(`display-metrics-changed #${d && d.id} [${(changed||[]).join(',')}]`); scheduleReposition(); });
}

ipcMain.handle('get-usage', async () => {
  // Token OAuth fica em secure storage do binario do CLI (DPAPI/keyring).
  // Para o widget acessar, gere um setup-token: `claude setup-token`
  // Isso grava claudeAiOauth.accessToken em .credentials.json.
  const credPath = path.join(os.homedir(), '.claude', '.credentials.json');

  if (!fs.existsSync(credPath)) {
    return { error: 'Execute `claude setup-token` no terminal.' };
  }

  let token;
  try {
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    token = creds.claudeAiOauth && creds.claudeAiOauth.accessToken;
  } catch (e) {
    return { error: 'Falha ao ler credenciais: ' + e.message };
  }

  if (!token) {
    return { error: 'Execute `claude setup-token` para gerar token persistente.' };
  }

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) {
      return { error: 'Erro HTTP ' + res.status, status: res.status };
    }
    const data = await res.json();
    return { data };
  } catch (e) {
    return { error: 'Erro de rede: ' + e.message };
  }
});

function parseTemp(v) {
  if (!v) return null;
  const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Math.round(parseFloat(m[0])) : null;
}

function findTemp(hw, preferred) {
  const group = (hw.Children || []).find(c => c.Text === 'Temperatures');
  if (!group) return null;
  const sensors = group.Children || [];
  for (const name of preferred) {
    const s = sensors.find(x => x.Text && x.Text.toLowerCase().includes(name));
    if (s) { const t = parseTemp(s.Value); if (t != null) return t; }
  }
  for (const s of sensors) { const t = parseTemp(s.Value); if (t != null) return t; }
  return null;
}

ipcMain.handle('get-temps', async () => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch('http://localhost:8085/data.json', { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { error: 'LHM HTTP ' + res.status };
    const data = await res.json();
    const comp = data.Children && data.Children[0];
    if (!comp) return { error: 'sem dados' };
    let cpu = null, gpu = null;
    for (const hw of comp.Children || []) {
      const img = (hw.ImageURL || '').toLowerCase();
      if (cpu == null && img.includes('cpu')) {
        cpu = findTemp(hw, ['tctl/tdie', 'tdie', 'package', 'core']);
      }
      if (gpu == null && (img.includes('nvidia') || img.includes('ati') || img.includes('amd') || img.includes('gpu'))) {
        gpu = findTemp(hw, ['gpu core', 'core', 'gpu']);
      }
    }
    return { cpu, gpu };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'LHM nao respondeu' : e.message };
  }
});

// Dispara o script de manutencao (auto-eleva via UAC) e le o estado que ele grava.
const MAINT_PS1 = path.join(__dirname, 'maintenance.ps1');
const MAINT_STATUS = path.join(__dirname, 'maintenance.status.json');

const MAINT_TAREFA = 'WidgetClaude-Manutencao-Agora';

// Tarefa agendada ja registrada com RunLevel Highest roda elevada sem perguntar
// nada. Enquanto ela existir, o botao Cache nao mostra UAC nenhum; se sumir
// (maquina nova, tarefa apagada), o caminho antigo com RunAs continua valendo.
function disparaTarefaManutencao() {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      "$t = Get-ScheduledTask -TaskName '" + MAINT_TAREFA + "' -ErrorAction SilentlyContinue; " +
      "if (-not $t) { 'sem-tarefa'; exit }; " +
      "Start-ScheduledTask -TaskName '" + MAINT_TAREFA + "'; 'ok'"
    ], { windowsHide: true, timeout: 15000 }, (err, out) => {
      resolve(/^ok/m.test(String(out || '')));
    });
  });
}

ipcMain.handle('run-maintenance', async () => {
  try {
    // zera o status anterior para o renderer nao ver resultado velho
    try { fs.writeFileSync(MAINT_STATUS, JSON.stringify({ running: true, ok: true, steps: [] })); } catch (e) {}

    if (await disparaTarefaManutencao()) {
      log('run-maintenance: disparado pela tarefa agendada (sem UAC)');
      return { launched: true, viaTarefa: true };
    }

    // Eleva DIRETO daqui (nao confia na auto-elevacao do .ps1): um powershell
    // curto e visivel dispara o Start-Process -Verb RunAs, que mostra o UAC de
    // forma confiavel. O processo elevado roda o script oculto.
    const { spawn } = require('child_process');
    const cmd =
      "Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden " +
      "-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','\"" +
      MAINT_PS1 + "\"'";
    const child = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd
    ], { windowsHide: true, stdio: 'ignore' });
    child.unref();
    log('run-maintenance: elevacao disparada (aguardando UAC)');
    return { launched: true };
  } catch (e) {
    log('run-maintenance ERRO: ' + e.message);
    return { launched: false, error: e.message };
  }
});

// O status vem do powershell.exe (5.1), que grava UTF-8 COM BOM: sem tirar o
// ﻿ da frente o JSON.parse estoura e o painel nunca ve o resultado.
function leStatusManutencao() {
  try {
    if (!fs.existsSync(MAINT_STATUS)) return null;
    return JSON.parse(fs.readFileSync(MAINT_STATUS, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    return null;
  }
}

ipcMain.handle('get-maintenance', async () => leStatusManutencao());

// --- Limpeza de cache automatica, de 6 em 6 horas ---
// Sem clique: dispara a mesma tarefa agendada do botao Cache, ja registrada com
// RunLevel Highest — roda elevada e sem UAC. Se a tarefa nao existir a limpeza
// automatica nao acontece: abrir UAC sozinho, sem ninguem na frente da maquina,
// deixaria a caixa parada esperando resposta para sempre.
const LIMPEZA_INTERVALO_MS = 6 * 60 * 60 * 1000;
// A checagem e frequente de proposito: a conta e feita sobre o horario da ultima
// limpeza, entao maquina desligada por um dia limpa na primeira checagem depois
// de voltar, em vez de esperar o proximo tique de 6 h.
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

// A tarefa roda solta, em outro processo elevado: o unico jeito de saber que
// terminou e ver o status voltar a running=false.
function acompanhaLimpeza() {
  const limite = Date.now() + 30 * 60 * 1000;
  const timer = setInterval(() => {
    const st = leStatusManutencao();
    if (st && st.running === false) {
      clearInterval(timer);
      const total = (st.steps || []).reduce((soma, passo) => soma + (Number(passo.freedMB) || 0), 0);
      avisa('Cache limpo', 'Liberado ' + total.toFixed(1).replace('.', ',') + ' MB.');
      log('limpeza automatica: concluida, ' + total.toFixed(1) + ' MB');
    } else if (Date.now() > limite) {
      clearInterval(timer);
      log('limpeza automatica: passou de 30 min sem status de fim');
    }
  }, 15000);
  timer.unref();
}

async function limpezaAutomatica() {
  if (Date.now() - ultimaLimpezaMs() < LIMPEZA_INTERVALO_MS) return;

  try { fs.writeFileSync(MAINT_STATUS, JSON.stringify({ running: true, ok: true, steps: [] })); } catch (e) {}

  if (!(await disparaTarefaManutencao())) {
    log('limpeza automatica: tarefa ' + MAINT_TAREFA + ' nao existe, pulando');
    return;
  }

  log('limpeza automatica: disparada');
  avisa('Limpando cache', 'Manutencao de 6 em 6 horas rodando em segundo plano.');
  acompanhaLimpeza();
}

function agendaLimpezaAutomatica() {
  // 2 min de folga: o logon ja esta cheio de coisa subindo ao mesmo tempo.
  setTimeout(limpezaAutomatica, 2 * 60 * 1000).unref();
  setInterval(limpezaAutomatica, LIMPEZA_CHECAGEM_MS).unref();
}

// --- Troca de credencial do Claude Code (assinatura Max <-> API/gateway) ---
// A chave fica cifrada com DPAPI (safeStorage) em userData, nunca em texto puro
// no repositorio. O modo e gravado nas variaveis de ambiente de escopo User,
// entao so vale para processos abertos DEPOIS da troca.
const KEY_FILE = () => path.join(app.getPath('userData'), 'apikey.bin');
const AUTH_VARS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'];
const DEFAULT_BASE_URL = 'https://avellogateway.online';
// O Claude Code le este arquivo no start. Escrever aqui alem das variaveis de
// ambiente e o que faz a troca valer de verdade: variavel de escopo User so
// chega em processo cujo PAI ja nasceu depois da troca, e um terminal aberto
// (ou o proprio explorer.exe) passa adiante o ambiente antigo indefinidamente.
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');

// Aplica o modo no settings.json preservando todo o resto do arquivo.
// JSON invalido aborta sem escrever: melhor falhar do que zerar a config.
function writeSettingsAuth(mode, baseUrl, key) {
  let raw;
  try {
    raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
  } catch (e) {
    raw = '{}';
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    throw new Error('settings.json com JSON invalido; nada foi alterado');
  }
  const env = Object.assign({}, cfg.env);
  if (mode === 'api') {
    env.ANTHROPIC_BASE_URL = baseUrl;
    env.ANTHROPIC_AUTH_TOKEN = key;
  } else {
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }
  if (Object.keys(env).length) cfg.env = env;
  else delete cfg.env;

  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  // Copia de seguranca do conteudo anterior antes de sobrescrever.
  try { fs.writeFileSync(SETTINGS_FILE + '.bak', raw); } catch (e) {}
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(cfg, null, 2) + '\n');
}

// Modo gravado no settings.json (o que o Claude Code realmente vai usar).
function readSettingsAuth() {
  try {
    const cfg = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const env = cfg.env || {};
    return {
      hasToken: !!env.ANTHROPIC_AUTH_TOKEN,
      baseUrl: env.ANTHROPIC_BASE_URL || ''
    };
  } catch (e) {
    return { hasToken: false, baseUrl: '' };
  }
}

// Roda um comando powershell curto. Segredos vao por env do processo filho,
// nunca na linha de comando (que fica visivel na lista de processos).
function psRun(script, extraEnv) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 15000, env: Object.assign({}, process.env, extraEnv || {}) },
      (err, stdout) => resolve({ err, out: String(stdout || '').trim() })
    );
  });
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
  // process.env e um retrato do momento do boot; le o valor atual do registro.
  const r = await psRun(
    "$b=[Environment]::GetEnvironmentVariable('ANTHROPIC_BASE_URL','User');" +
    "$t=[Environment]::GetEnvironmentVariable('ANTHROPIC_AUTH_TOKEN','User');" +
    "\"$b|\" + $(if ($t) { '1' } else { '0' })"
  );
  const [envUrl, envHasToken] = (r.out || '|0').split('|');
  const st = readSettingsAuth();
  const saved = readSavedKey();
  // O settings.json manda: e o que o Claude Code le em toda sessao nova.
  return {
    mode: (st.hasToken || envHasToken === '1') ? 'api' : 'max',
    baseUrl: st.baseUrl || envUrl || '',
    defaultUrl: DEFAULT_BASE_URL,
    keyHint: saved ? saved.slice(0, 6) + '…' + saved.slice(-4) : ''
  };
});

ipcMain.handle('set-auth', async (e, opts) => {
  const mode = opts && opts.mode;
  try {
    if (mode === 'max') {
      writeSettingsAuth('max');
      await psRun(AUTH_VARS
        .map(v => `[Environment]::SetEnvironmentVariable('${v}',$null,'User')`)
        .join(';'));
      log('set-auth: modo assinatura (settings.json + variaveis limpos)');
      return { ok: true, mode: 'max' };
    }
    const key = ((opts && opts.key) || '').trim() || readSavedKey();
    if (!key) return { ok: false, error: 'Sem chave salva — cole a chave.' };
    const baseUrl = ((opts && opts.baseUrl) || '').trim() || DEFAULT_BASE_URL;
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(KEY_FILE(), safeStorage.encryptString(key));
    }
    writeSettingsAuth('api', baseUrl, key);
    await psRun(
      "[Environment]::SetEnvironmentVariable('ANTHROPIC_BASE_URL',$env:WC_URL,'User');" +
      "[Environment]::SetEnvironmentVariable('ANTHROPIC_AUTH_TOKEN',$env:WC_KEY,'User')",
      { WC_URL: baseUrl, WC_KEY: key }
    );
    log('set-auth: modo API (' + baseUrl + ') settings.json + variaveis');
    return { ok: true, mode: 'api' };
  } catch (err) {
    log('set-auth ERRO: ' + err.message);
    return { ok: false, error: err.message };
  }
});

// --- Sentry: lista de erros nao resolvidos e acoes sobre eles ---
ipcMain.handle('sentry-get', async () => sentry.atual());

ipcMain.handle('sentry-refresh', async () => {
  await sentry.forcar();
  return sentry.atual();
});

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
  if (typeof url === 'string' && /^https:\/\/[a-z0-9.-]*sentry\.io\//i.test(url)) {
    shell.openExternal(url);
  }
});

// --- Login do txAdmin: mantem os dois consoles logados ---
// A senha nunca mora no repositorio nem no HTML: vem de _CLAUDE/.secrets
// (pasta ignorada pelo git) e fica cifrada com DPAPI em userData.
const TX_ENV = path.join(os.homedir(), 'Downloads', 'Apps', '_CLAUDE', '.secrets', 'txadmin.env');
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
  try {
    const raw = fs.readFileSync(TX_ENV, 'utf8');
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

// O <webview> exige caminho absoluto no preload; quem sabe onde o app mora e o main.
// Linha de diagnostico do renderer, para o widget.log.
// Medicao pontual do layout do painel; dispara com 'medir.flag' e some depois.
function medeLayout() {
  const flag = path.join(__dirname, 'medir.flag');
  if (!fs.existsSync(flag)) return;
  try { fs.unlinkSync(flag); } catch (e) {}
  mainWindow.webContents.executeJavaScript(
    '(() => {' +
    ' const b = document.querySelector("#faixaMeio .rodape");' +
    ' if (!b) return "sem faixa";' +
    ' const r = b.getBoundingClientRect();' +
    ' const filhos = Array.from(b.children).map(c => {' +
    '   const cr = c.getBoundingClientRect();' +
    '   return (c.id || c.className) + " x=" + Math.round(cr.x) + " w=" + Math.round(cr.width);' +
    ' });' +
    ' return "faixa w=" + Math.round(r.width) + " | " + filhos.join(" | ");' +
    '})()'
  ).then(r => log('medida: ' + r)).catch(e => log('medida falhou: ' + e.message));
}

ipcMain.on('diag', (e, texto) => log('painel: ' + String(texto).slice(0, 200)));

// A fonte do log vai injetada como data: URL. JetBrains Mono nao e fonte do
// sistema: sem mandar o arquivo junto, o canvas do xterm cai no fallback.
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

// Erro no console de um servidor avisa em qualquer barramento: toast, beep e log.
ipcMain.on('alerta-console', (e, dados) => {
  if (!dados || !Array.isArray(dados.linhas) || !dados.linhas.length) return;
  const cabeca = dados.linhas[0].slice(0, 180);
  log('console ' + dados.onde + ': ' + dados.linhas.length + ' erro(s) — ' + cabeca);
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'Erro no console · ' + dados.onde,
        body: cabeca,
        urgency: 'critical'
      });
      n.show();
    }
  } catch (err) {}
  try { shell.beep(); } catch (err) {}
});

// O painel relata como cada console ficou depois da tentativa de login.
// Captura o conteudo dos dois webviews em arquivo. Serve para conferir o
// console sem depender da tela: quando o monitor dorme, CopyFromScreen devolve
// um quadro congelado, e PrintWindow nao alcanca o conteudo de <webview>.
// Dispara criando o arquivo 'capturar.flag' nesta pasta.
function capturaTelas(destino) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(
    '(async () => {' +
    ' const out = [];' +
    ' for (const id of ["wv0","wv1"]) {' +
    '   const wv = document.getElementById(id);' +
    '   const img = await wv.capturePage();' +
    '   out.push(img.toDataURL());' +
    ' }' +
    ' return out;' +
    '})()'
  ).then(lista => {
    lista.forEach((dataUrl, i) => {
      const b64 = dataUrl.split(',')[1];
      const arq = path.join(destino, 'console-' + (i === 0 ? 'remoto' : 'local') + '.png');
      fs.writeFileSync(arq, Buffer.from(b64, 'base64'));
      log('captura: ' + arq);
    });
  }).catch(err => log('captura falhou: ' + err.message));
}

ipcMain.on('tela-estado', (e, i, r) => {
  const nome = i === 0 ? 'remoto' : 'local';
  if (!r) return;
  log('txadmin ' + nome + ': ' + (r.senha ? 'ainda na tela de login' : 'logado') +
      ' (caminho ' + r.caminho + ')');
  // Sentinela: existe o arquivo, tira a captura e apaga a sentinela.
  if (i === 1) setTimeout(medeLayout, 2000);
  const flag = path.join(__dirname, 'capturar.flag');
  if (i === 1 && fs.existsSync(flag)) {
    try { fs.unlinkSync(flag); } catch (e) {}
    setTimeout(() => capturaTelas(__dirname), 4000);
  }
});

// --- Servidores configuraveis (aba Servidores) ---------------------------
const SERV_FILE = () => path.join(app.getPath('userData'), 'servidores.json');
const SERV_PADRAO = [
  { nome: 'Servidor remoto', host: '192.0.2.10', porta: 40120 },
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
  // Host e porta vem de campo de texto: valida antes de gravar, senao um
  // espaco a mais vira uma URL quebrada que o webview nunca carrega.
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

// --- Modo Dev: emulador + Metro ------------------------------------------
// O comando `emulador` mora em arquivo proprio (repo do perfil do PowerShell,
// em Documents\PowerShell). Carregamos o .ps1 direto, sem depender de o perfil
// ter sido carregado nesta sessao.
const EMULADOR_PS1 = path.join(os.homedir(), 'Documents', 'PowerShell', 'emulador.ps1');
const ENCAIXA_PS1 = path.join(__dirname, 'encaixar-emulador.ps1');
const RAIZ_APPS = path.join(os.homedir(), 'Downloads', 'Apps');
// A porta do Metro vem da mesma tabela do emulador.ps1; aqui e so para exibir.
const PROJETOS = [
  { pasta: 'MeuEscolarApp', nome: 'Meu Escolar', metro: 8082 },
  { pasta: 'FaeTerraplanagemApp', nome: 'Fae', metro: 8081 },
  { pasta: 'LigaFootApp', nome: 'LigaFoot', metro: 8083 },
  { pasta: 'MeuMengaoApp', nome: 'Meu Mengão', metro: 8084 },
  { pasta: 'DamaAppGame', nome: 'Dama', metro: 8086 }
];

let devProc = null;

function devLog(linha) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dev-log', linha);
  } catch (e) {}
}

function ligaSaida(proc) {
  const manda = (d) => String(d).split(/\r?\n/).forEach(l => { if (l.trim()) devLog(l); });
  proc.stdout.on('data', manda);
  proc.stderr.on('data', manda);
}

ipcMain.handle('dev-projetos', async () =>
  PROJETOS.filter(p => fs.existsSync(path.join(RAIZ_APPS, p.pasta))));

ipcMain.handle('dev-subir', async (e, pasta, avd, alvo) => {
  const projeto = PROJETOS.find(p => p.pasta === pasta);
  if (!projeto) return { ok: false, error: 'projeto desconhecido' };
  if (devProc) return { ok: false, error: 'já tem coisa subindo por aqui — feche antes' };
  const dir = path.join(RAIZ_APPS, projeto.pasta);
  if (!fs.existsSync(dir)) return { ok: false, error: 'pasta não existe: ' + dir };

  const paraWeb = alvo === 'web';
  const alvoAvd = avd === 'Main_Debug_2' ? 'Main_Debug_2' : 'Main_Debug';
  if (!paraWeb && !fs.existsSync(EMULADOR_PS1)) {
    return { ok: false, error: 'emulador.ps1 não encontrado' };
  }

  // App passa pelo `emulador` (que resolve JDK, AVD, adb reverse e Metro na
  // ordem certa). Web nao precisa de nada disso: e o proprio Expo em modo web.
  const cmd = paraWeb
    ? "Set-Location '" + dir + "'; npx expo start --web --port " + projeto.metro
    : ". '" + EMULADOR_PS1 + "'; Set-Location '" + dir + "'; emulador -AVD " + alvoAvd;

  const { spawn } = require('child_process');
  try {
    devProc = spawn('pwsh.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
      { cwd: dir, windowsHide: true });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  devLog('$ ' + (paraWeb ? 'expo start --web --port ' + projeto.metro : 'emulador -AVD ' + alvoAvd) +
    '   · ' + projeto.nome);
  ligaSaida(devProc);
  devProc.on('exit', (code) => {
    devLog('— ' + (paraWeb ? 'bundler web' : 'emulador') + ' encerrou (código ' + code + ')');
    devProc = null;
  });
  log('dev: subindo ' + projeto.nome + (paraWeb ? ' na web' : ' no ' + alvoAvd));
  return { ok: true, projeto: projeto.nome, metro: projeto.metro, avd: alvoAvd, web: paraWeb };
});

ipcMain.handle('dev-matar', async (e, pasta) => {
  const projeto = PROJETOS.find(p => p.pasta === pasta);
  const dir = projeto ? path.join(RAIZ_APPS, projeto.pasta) : RAIZ_APPS;
  const { spawn } = require('child_process');
  const cmd = ". '" + EMULADOR_PS1 + "'; Set-Location '" + dir + "'; emulador --kill";
  devLog('$ emulador --kill');
  try {
    const p = spawn('pwsh.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
      { windowsHide: true });
    ligaSaida(p);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (devProc) { try { devProc.kill(); } catch (e2) {} devProc = null; }
  return { ok: true };
});

function rodaEncaixe(args) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ENCAIXA_PS1].concat(args),
      { windowsHide: true, timeout: 12000 },
      (err, out) => {
        const saida = String(out || '').trim();
        // "ok <largura> <altura>" quando encaixou; o painel usa para se ajustar.
        const m = saida.match(/^ok (\d+) (\d+)$/);
        resolve({
          ok: /^ok/.test(saida),
          saida,
          largura: m ? Number(m[1]) : null,
          altura: m ? Number(m[2]) : null
        });
      });
  });
}

// A janela do emulador e do Windows, nao do painel: trocar de barramento nao a
// esconde sozinha. Minimiza ao sair do Dev, restaura ao voltar.
ipcMain.handle('dev-mostrar', async (e, mostrar) =>
  rodaEncaixe(['-Acao', mostrar ? 'restaurar' : 'minimizar']));

// Encaixa a janela do emulador no espaco que o painel reservou.
ipcMain.handle('dev-encaixar', async (e, caixa) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  const b = mainWindow.getContentBounds();
  return rodaEncaixe([
    '-X', String(Math.round(b.x + caixa.x)),
    '-Y', String(Math.round(b.y + caixa.y)),
    '-W', String(Math.round(caixa.w)),
    '-H', String(Math.round(caixa.h)),
    '-Indice', String(caixa.indice || 0),
    '-Acao', 'encaixar'
  ]);
});

// --- Discord: anotacoes sem reacao no canal do Michigan ---
ipcMain.handle('discord-get', async () => discord.atual());
ipcMain.handle('discord-refresh', async () => { await discord.forcar(); return discord.atual(); });
ipcMain.handle('discord-seen', async () => discord.marcarVistos());
ipcMain.handle('discord-recount', async () => discord.recontar());

// Criar topico na anotacao e ja deixar a primeira resposta dentro dele.
// Escreve no Discord em nome do Alexandre: o botao no painel e o consentimento.
ipcMain.handle('discord-topico', async (e, id, nome, resposta) => {
  try {
    return await discord.criarTopico(id, nome, resposta);
  } catch (err) {
    log('discord-topico ERRO: ' + err.message);
    return { ok: false, error: err.message };
  }
});

// Reagir marca a anotacao como resolvida no proprio Discord.
ipcMain.handle('discord-reagir', async (e, id, emoji) => {
  // Lista fechada: o renderer nao escolhe emoji arbitrario para mandar na URL.
  const permitidos = ['\u{1F44D}', '\u274C', '\u2705'];   // joinha, X, check
  if (permitidos.indexOf(emoji) < 0) return { ok: false, error: 'emoji nao permitido' };
  try {
    return await discord.reagir(id, emoji);
  } catch (err) {
    log('discord-reagir ERRO: ' + err.message);
    return { ok: false, error: err.message };
  }
});

// --- Trava do teclado (limpar o teclado sem desligar o PC) ---
// O hook de baixo nivel mora no processo do PowerShell, nao aqui: matar o
// processo devolve o teclado na hora, mesmo se o painel travar ou morrer.
const TRAVA_PS1 = path.join(__dirname, 'trava-teclado.ps1');
let travaProc = null;
let travaAte = 0;

function soltaTeclado(motivo) {
  if (!travaProc) return false;
  const p = travaProc;
  travaProc = null;
  travaAte = 0;
  try { p.kill(); } catch (e) {}
  log('teclado: solto (' + motivo + ')');
  return true;
}

ipcMain.handle('teclado-travar', async (e, segundos) => {
  if (travaProc) return { ok: true, ja: true, ate: travaAte };
  const seg = Math.max(5, Math.min(600, Number(segundos) || 120));
  const { spawn } = require('child_process');
  try {
    const p = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TRAVA_PS1,
      '-Segundos', String(seg), '-Pai', String(process.pid)
    ], { windowsHide: true });

    // Espera o "ligado" do script: sem isso o painel mostraria trava ativa
    // enquanto o hook nem subiu (por exemplo se o SetWindowsHookEx falhar).
    const ligou = await new Promise((resolve) => {
      let saida = '';
      const prazo = setTimeout(() => resolve(false), 8000);
      p.stdout.on('data', (d) => {
        saida += String(d);
        if (/ligado/.test(saida)) { clearTimeout(prazo); resolve(true); }
        if (/erro/.test(saida)) { clearTimeout(prazo); resolve(false); }
      });
      p.on('exit', () => { clearTimeout(prazo); resolve(false); });
    });

    if (!ligou) {
      try { p.kill(); } catch (e2) {}
      log('teclado: nao consegui travar');
      return { ok: false, error: 'nao consegui instalar o hook' };
    }

    travaProc = p;
    travaAte = Date.now() + seg * 1000;
    p.on('exit', () => {
      // Fim natural do tempo do script: zera o estado sem matar ninguem.
      if (travaProc === p) { travaProc = null; travaAte = 0; log('teclado: solto (tempo)'); }
    });
    log('teclado: travado por ' + seg + 's');
    return { ok: true, ate: travaAte, segundos: seg };
  } catch (err) {
    log('teclado ERRO: ' + err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('teclado-soltar', async () => ({ ok: true, soltou: soltaTeclado('painel') }));

// --- Dormir as telas ---
const TELAS_PS1 = path.join(__dirname, 'telas-dormir.ps1');

ipcMain.handle('telas-dormir', async () => {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TELAS_PS1],
      { windowsHide: true, timeout: 10000 },
      (err, out) => {
        const ok = /^ok/m.test(String(out || ''));
        log('telas-dormir: ' + (ok ? 'monitores apagados' : 'falhou'));
        resolve({ ok });
      });
  });
});

// --- Reiniciar o proprio painel ---
// relaunch marca o proximo processo ANTES de sair; o quit em seguida e o que
// realmente derruba este. Sem apagar a flag, o widget subiria e o watchdog
// acharia que foi fechado na mao.
ipcMain.handle('painel-reiniciar', async () => {
  log('painel-reiniciar: pedido pelo painel');
  try { fs.unlinkSync(STOP_FLAG); } catch (e) {}
  app.relaunch();
  setTimeout(() => app.exit(0), 250);
  return { ok: true };
});

ipcMain.handle('teclado-estado', async () => ({
  travado: !!travaProc,
  ate: travaAte,
  restante: travaProc ? Math.max(0, travaAte - Date.now()) : 0
}));

// Rede de seguranca: se o widget cair, o teclado nao fica preso.
app.on('before-quit', () => soltaTeclado('app encerrando'));

// Abre no navegador padrao. Lista curta de destinos: nao vira abridor generico.
ipcMain.on('abrir-url', (e, url) => {
  if (typeof url !== 'string') return;
  const ok = /^https:\/\/(discord\.com|[a-z0-9.-]*sentry\.io)\//i.test(url) ||
             /^http:\/\/(localhost|191\.96\.81\.142):40120\//.test(url);
  if (ok) shell.openExternal(url);
});

ipcMain.on('resize-height', (e, h) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.setContentSize(WIDTH, Math.max(60, Math.round(h)));
});

// Fechamento manual pelo botao X: grava a flag para o watchdog (tarefa agendada
// WidgetClaude-Watchdog) nao reabrir o widget em seguida. restart-widget.ps1 e
// startup-onlogon.ps1 apagam a flag ao subir o widget de novo.
ipcMain.on('close-app', () => {
  log('close-app: encerrado pelo usuario (botao fechar)');
  try { fs.writeFileSync(STOP_FLAG, new Date().toISOString()); } catch (e) {}
  app.quit();
});

app.on('before-quit', () => log('before-quit: app encerrando'));
app.on('will-quit', () => log('will-quit: app vai sair'));
app.on('quit', (e, code) => log(`quit: codigo ${code}`));
app.on('child-process-gone', (e, d) => log(`child-process-gone: type=${d.type} reason=${d.reason}`));

// Captura terminacao externa (Task Scheduler / taskkill) e erros nao tratados,
// que de outra forma matam o processo sem deixar rastro no log.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGBREAK']) {
  try { process.on(sig, () => { log(`sinal ${sig} recebido: terminacao externa`); app.quit(); }); } catch (e) {}
}
process.on('uncaughtException', (err) => log(`uncaughtException: ${err && err.stack || err}`));
process.on('unhandledRejection', (r) => log(`unhandledRejection: ${r}`));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    agendaLimpezaAutomatica();
  });
}

app.on('window-all-closed', () => {
  app.quit();
});
