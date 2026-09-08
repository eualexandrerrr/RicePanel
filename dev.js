// Modo Dev — emulador Android e Metro, versão Linux/Hyprland.
//
// Substitui o `emulador.ps1` do Windows. O que lá era um comando do perfil do
// PowerShell aqui é sequência explícita: sobe o AVD, espera o adb enxergar o
// aparelho, abre o caminho de volta da porta do Metro e só então chama o Expo.
// A ordem importa — `adb reverse` antes do aparelho existir falha calado, e o
// app abre sem bundler.
//
// A janela do emulador é do Hyprland, não do painel: trocar de barramento não a
// esconde sozinha. Encaixar e esconder passam por `hyprctl`, sobre o endereço da
// janela (`address:0x…`), que é o único identificador estável — título e classe
// mudam com a versão do emulador.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(os.homedir(), 'Apps');
const EMULADOR = path.join(os.homedir(), 'Android', 'Sdk', 'emulator', 'emulator');
const WS_OCULTO = 'special:mirante-oculto';

// A porta é fixa por projeto de propósito: `adb reverse` amarra a porta ao
// aparelho, e porta rodando faz o app instalado apontar para o bundler errado
// depois de trocar de projeto.
const PROJETOS = [
  { pasta: 'mobile/MeuEscolarApp', nome: 'Meu Escolar', metro: 8082 },
  { pasta: 'mobile/LigaFootApp', nome: 'LigaFoot', metro: 8083 },
  { pasta: 'mobile/MeuMengaoApp', nome: 'Meu Mengão', metro: 8084 },
  { pasta: 'mobile/DamaAppGame', nome: 'Dama', metro: 8086 },
  { pasta: 'mobile/AvioraManagerAppGame', nome: 'Aviora', metro: 8087 },
  { pasta: 'web/eualexandre.dev', nome: 'eualexandre.dev', metro: 8090 },
  { pasta: 'web/FazendaoAppGame', nome: 'Fazendão', metro: 8091 }
];

let deps = null;          // { log, empurra, getWindow }
let metroProc = null;
let emuProc = null;
let projetoNoAr = null;

function log(msg) {
  if (deps && deps.log) deps.log('dev: ' + msg);
}

function saida(linha) {
  if (deps && deps.empurra) deps.empurra('dev-log', linha);
}

function ligaSaida(proc) {
  const manda = (d) => String(d).split(/\r?\n/).forEach(l => { if (l.trim()) saida(l.trimEnd()); });
  if (proc.stdout) proc.stdout.on('data', manda);
  if (proc.stderr) proc.stderr.on('data', manda);
}

// Comando curto cuja saída interessa inteira (adb, hyprctl).
function roda(cmd, args, ms) {
  return new Promise((resolve) => {
    let pronto = false;
    const fim = (s) => { if (!pronto) { pronto = true; resolve(s); } };
    let p;
    try {
      p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return fim('');
    }
    let buf = '';
    p.stdout.on('data', d => { buf += d; });
    p.stderr.on('data', () => {});
    p.on('error', () => fim(''));
    p.on('close', () => fim(buf));
    setTimeout(() => { try { p.kill(); } catch (e) {} fim(buf); }, ms || 5000);
  });
}

function espera(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// --------------------------------------------------------------- projetos

function listaProjetos() {
  return PROJETOS
    .filter(p => fs.existsSync(path.join(RAIZ, p.pasta)))
    .map(p => ({
      pasta: p.pasta,
      nome: p.nome,
      metro: p.metro,
      web: p.pasta.startsWith('web/')
    }));
}

async function listaAvds() {
  if (!fs.existsSync(EMULADOR)) return [];
  const out = await roda(EMULADOR, ['-list-avds'], 6000);
  return out.split('\n').map(s => s.trim()).filter(Boolean);
}

// --------------------------------------------------------------- subir

// O emulador demora e o adb só enxerga o aparelho depois do boot. Esperar pelo
// `sys.boot_completed` é o único sinal que não mente: `adb devices` já lista o
// aparelho como "device" enquanto o Android ainda está na animação.
async function esperaBoot(limiteMs) {
  const fim = Date.now() + limiteMs;
  let avisou = false;
  while (Date.now() < fim) {
    const out = await roda('adb', ['shell', 'getprop', 'sys.boot_completed'], 4000);
    if (out.trim() === '1') return true;
    if (!avisou) { saida('· esperando o Android terminar de subir…'); avisou = true; }
    await espera(2000);
  }
  return false;
}

async function subir(pasta, avd, alvo) {
  const projeto = PROJETOS.find(p => p.pasta === pasta);
  if (!projeto) return { ok: false, error: 'projeto desconhecido' };
  if (metroProc || emuProc) return { ok: false, error: 'já tem coisa subindo por aqui — feche antes' };

  const dir = path.join(RAIZ, projeto.pasta);
  if (!fs.existsSync(dir)) return { ok: false, error: 'pasta não existe: ' + dir };

  const paraWeb = alvo === 'web';
  projetoNoAr = projeto;

  if (!paraWeb) {
    if (!fs.existsSync(EMULADOR)) {
      projetoNoAr = null;
      return { ok: false, error: 'emulador do Android SDK não encontrado em ' + EMULADOR };
    }
    const avds = await listaAvds();
    const alvoAvd = avds.includes(avd) ? avd : avds[0];
    if (!alvoAvd) {
      projetoNoAr = null;
      return { ok: false, error: 'nenhum AVD criado no Android Studio' };
    }

    saida('$ emulator -avd ' + alvoAvd + '   · ' + projeto.nome);
    try {
      // -no-snapshot-load: snapshot velha com outro bundler apontado dá tela
      // branca que parece erro do app e não é.
      emuProc = spawn(EMULADOR, ['-avd', alvoAvd, '-gpu', 'auto', '-no-snapshot-load'], {
        cwd: dir,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      projetoNoAr = null;
      return { ok: false, error: err.message };
    }
    ligaSaida(emuProc);
    emuProc.on('exit', (code) => {
      saida('— emulador encerrou (código ' + code + ')');
      emuProc = null;
    });

    const subiu = await esperaBoot(180000);
    if (!subiu) {
      saida('— o Android não terminou de subir em 3 min; o Metro sobe assim mesmo');
    } else {
      // Caminho de volta: o app dentro do emulador fala com o Metro do host.
      await roda('adb', ['reverse', 'tcp:' + projeto.metro, 'tcp:' + projeto.metro], 6000);
      saida('· adb reverse tcp:' + projeto.metro);
    }
  }

  const args = paraWeb
    ? ['expo', 'start', '--web', '--port', String(projeto.metro)]
    : ['expo', 'start', '--port', String(projeto.metro)];
  saida('$ npx ' + args.join(' '));
  try {
    metroProc = spawn('npx', args, {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { CI: '1', FORCE_COLOR: '0' })
    });
  } catch (err) {
    projetoNoAr = null;
    return { ok: false, error: err.message };
  }
  ligaSaida(metroProc);
  metroProc.on('exit', (code) => {
    saida('— bundler encerrou (código ' + code + ')');
    metroProc = null;
  });

  log('subindo ' + projeto.nome + (paraWeb ? ' na web' : ' no emulador'));
  return { ok: true, projeto: projeto.nome, metro: projeto.metro, web: paraWeb };
}

// --------------------------------------------------------------- derrubar

async function matar() {
  saida('$ fechando emulador e bundler');
  if (metroProc) { try { metroProc.kill('SIGTERM'); } catch (e) {} metroProc = null; }
  // `adb emu kill` fecha o emulador pela porta de console dele; matar o
  // processo direto às vezes deixa o qemu órfão segurando o AVD travado.
  await roda('adb', ['emu', 'kill'], 5000);
  if (emuProc) { try { emuProc.kill('SIGTERM'); } catch (e) {} emuProc = null; }
  projetoNoAr = null;
  return { ok: true };
}

// ------------------------------------------------------- janela do emulador

// O emulador aparece no Hyprland com classe própria; casar por classe e por
// título cobre as duas versões (a nova usa "Android Emulator", a antiga o nome
// do AVD).
async function janelaDoEmulador() {
  const bruto = await roda('hyprctl', ['-j', 'clients'], 3000);
  let lista;
  try { lista = JSON.parse(bruto || '[]'); } catch (e) { return null; }
  return lista.find(c => {
    const cls = String(c.class || '').toLowerCase();
    const tit = String(c.title || '').toLowerCase();
    return /emulator|qemu/.test(cls) || /android emulator|^emulator/.test(tit);
  }) || null;
}

// Desde o Hyprland 0.54 a configuração é Lua e `hyprctl dispatch <nome> <args>`
// não existe mais: o dispatch de hoje recebe uma expressão Lua, e cada
// dispatcher recebe **uma tabela nomeada**. Passar os argumentos na ordem antiga
// não dá erro — o dispatcher aceita e mira a janela ativa, então o comando
// acertaria a janela errada em silêncio.
function lua(codigo) {
  return roda('hyprctl', ['repl', codigo], 4000);
}

function luaTexto(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

// Esconder é mandar para um workspace especial, não minimizar: o Hyprland não
// tem minimizar, e fechar mataria o emulador junto.
async function mostrar(visivel) {
  const j = await janelaDoEmulador();
  if (!j) return { ok: false, error: 'janela do emulador não encontrada' };
  const destino = visivel ? await workspaceDoPainel() : WS_OCULTO;
  await lua(
    'hl.dispatch(hl.dsp.window.move({ window = ' + luaTexto('address:' + j.address) +
    ', workspace = ' + luaTexto(destino) + ', follow = false })) return \'ok\''
  );
  return { ok: true };
}

async function workspaceDoPainel() {
  const bruto = await roda('hyprctl', ['-j', 'monitors'], 3000);
  try {
    const mons = JSON.parse(bruto || '[]');
    // O painel mora no monitor em pé; a janela do emulador tem de cair no
    // workspace que está aceso lá, senão ela some numa tela que ninguém vê.
    // Transform ímpar quer dizer girado: aí largura e altura vêm trocadas.
    const vertical = mons.find(m => {
      const girado = m.transform % 2 === 1;
      return (girado ? m.width : m.height) > (girado ? m.height : m.width);
    }) || mons[0];
    return String(vertical.activeWorkspace.id);
  } catch (e) {
    return '1';
  }
}

// Encaixa a janela no vão que o painel reservou. As coordenadas chegam
// relativas ao conteúdo da janela do painel; aqui viram tela.
async function encaixar(caixa) {
  const win = deps && deps.getWindow && deps.getWindow();
  if (!win || win.isDestroyed()) return { ok: false, error: 'painel sem janela' };
  const j = await janelaDoEmulador();
  if (!j) return { ok: false, error: 'janela do emulador não encontrada' };

  const b = win.getContentBounds();
  const x = Math.round(b.x + (caixa.x || 0));
  const y = Math.round(b.y + (caixa.y || 0));
  const w = Math.max(200, Math.round(caixa.w || 400));
  const h = Math.max(200, Math.round(caixa.h || 600));
  const sel = luaTexto('address:' + j.address);

  // Flutuante primeiro: janela em mosaico ignora posição exata, e o resize
  // aplicado antes do float é descartado no momento em que ela solta.
  await lua(`
    hl.dispatch(hl.dsp.window.float({ window = ${sel}, action = 'enable' }))
    hl.dispatch(hl.dsp.window.resize({ window = ${sel}, x = ${w}, y = ${h}, relative = false }))
    hl.dispatch(hl.dsp.window.move({ window = ${sel}, x = ${x}, y = ${y}, relative = false }))
    return 'ok'
  `);
  return { ok: true, largura: w, altura: h };
}

function noAr() {
  return {
    projeto: projetoNoAr ? projetoNoAr.pasta : null,
    nome: projetoNoAr ? projetoNoAr.nome : null,
    bundler: !!metroProc,
    emulador: !!emuProc
  };
}

function iniciar(d) {
  deps = d;
}

module.exports = { iniciar, listaProjetos, listaAvds, subir, matar, mostrar, encaixar, noAr };
