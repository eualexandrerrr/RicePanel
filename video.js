// Vídeo do navegador redirecionado para o Mirante.
//
// A ideia: quando ele está vendo alguma coisa no navegador e sai daquele
// workspace, o vídeo continua — na parede, no painel, que ele enxerga do outro
// monitor. Quando ele volta para a janela do navegador, o painel devolve.
//
// De onde vem a informação: MPRIS, o mesmo barramento que já serve a placa da
// música. O Chrome publica título, posição e estado de qualquer aba tocando som.
//
// O que o MPRIS NÃO dá é a URL. A capa que o Chrome publica é um arquivo
// temporário local (`file:///tmp/.com.google.Chrome.xxxxxx`), sem id nenhum
// dentro. Ligar o depurador remoto do Chrome resolveria, mas deixaria uma porta
// aberta que controla o navegador inteiro — caro demais para um painel de
// parede. Então a URL sai do HISTÓRICO: o Chrome grava título e endereço de
// cada visita num SQLite, e o título que ele grava é o mesmo que o MPRIS
// publica. O painel copia o banco (o original fica travado com o Chrome de pé)
// e procura a visita mais recente cujo título casa.
//
// Serviço com DRM (Globoplay, Netflix) não toca dentro do Electron: falta o
// Widevine, que a build oficial não traz. Para esses o painel mostra o que está
// passando e diz que o vídeo fica no navegador — melhor que uma tela preta
// fingindo que tocou.

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const INTERVALO_MS = 2000;
const PRAZO_MS = 1500;

let deps = null;                 // { log }
let estado = {
  site: '',                      // youtube | drm | ''
  id: '',
  titulo: '',
  posicao: null,
  duracao: null,
  tocando: false,
  janelaVisivel: true,           // a aba está à vista dele agora?
  player: ''
};
let timer = null;

function log(msg) {
  if (deps && deps.log) deps.log('video: ' + msg);
}

function roda(cmd, args, ms) {
  return new Promise((resolve) => {
    let pronto = false;
    const fim = (s) => { if (!pronto) { pronto = true; resolve(s); } };
    try {
      const filho = execFile(cmd, args, { timeout: ms || PRAZO_MS, maxBuffer: 1 << 20 },
        (err, out) => fim(err && !out ? '' : String(out || '')));
      filho.on('error', () => fim(''));
    } catch (e) { fim(''); }
  });
}

// --------------------------------------------------------- quem está tocando

// O Chrome publica um player por processo, com nome `chromium.instanceNNN`.
// Firefox publica `firefox.instanceNNN`. Qualquer um serve.
function ehNavegador(nome) {
  return /^(chromium|chrome|firefox|brave|vivaldi)[.\s]/i.test(nome || '');
}

// Alguns players entregam a capa do YouTube já com o id dentro. Quando vem
// assim, sai de graça e o histórico nem é aberto.
function leYoutubeDaCapa(artUrl) {
  const m = String(artUrl || '').match(/(?:i\.ytimg\.com|img\.youtube\.com)\/vi\/([A-Za-z0-9_-]{6,})\//);
  return m ? m[1] : '';
}

async function lePlayers() {
  const lista = (await roda('playerctl', ['-l'])).split('\n').map(s => s.trim()).filter(Boolean);
  return lista.filter(ehNavegador);
}

const SEP = '';

async function leMetadados(player) {
  const bruto = await roda('playerctl', [
    '-p', player, 'metadata', '--format',
    ['{{status}}', '{{title}}', '{{mpris:artUrl}}', '{{mpris:length}}', '{{position}}'].join(SEP)
  ]);
  const p = bruto.trim().split(SEP);
  if (p.length < 3 || !p[1]) return null;
  const dur = Number(p[3]);
  const pos = Number(p[4]);
  return {
    tocando: /playing/i.test(p[0]),
    titulo: p[1],
    capa: p[2] || '',
    duracao: Number.isFinite(dur) && dur > 0 ? Math.round(dur / 1e6) : null,
    posicao: Number.isFinite(pos) ? Math.round(pos / 1e6) : null
  };
}

// ------------------------------------------------- a URL, pelo histórico

const PERFIS = [
  '.config/google-chrome/Default/History',
  '.config/chromium/Default/History',
  '.config/BraveSoftware/Brave-Browser/Default/History',
  '.config/vivaldi/Default/History'
];

// O Chrome põe a contagem de não lidas na frente do título da aba
// ("(16) Reisan - Linger - YouTube") e o nome do site atrás. O MPRIS publica só
// o miolo, então é no miolo que a comparação é feita.
function miolo(titulo) {
  return String(titulo || '')
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s+[-–]\s+(YouTube|Globoplay)\s*$/i, '')
    .trim()
    .toLowerCase();
}

let sqlite = null;
try { sqlite = require('node:sqlite'); } catch (e) { sqlite = null; }

// `node:sqlite` quando existe; senão o binário `sqlite3`. Sem os dois o módulo
// simplesmente não resolve URL nenhuma e o painel segue sem assumir o vídeo.
async function consultaHistorico(copia, padrao) {
  const sql = "select url, title from urls where url like '" + padrao +
    "' order by last_visit_time desc limit 40";
  if (sqlite && sqlite.DatabaseSync) {
    try {
      const db = new sqlite.DatabaseSync(copia, { readOnly: true });
      const linhas = db.prepare(sql).all();
      db.close();
      return linhas;
    } catch (e) {}
  }
  const bruto = await roda('sqlite3', ['-separator', SEP, copia, sql], 3000);
  return bruto.split('\n').filter(Boolean).map(l => {
    const [url, title] = l.split(SEP);
    return { url, title };
  });
}

// A cópia do banco é refeita no máximo uma vez por minuto: é I/O de disco para
// um dado que só muda quando ele troca de vídeo.
let copiaFeitaEm = 0;
const cacheUrl = new Map();      // miolo do título -> url

function copiaHistorico() {
  const destino = path.join(os.tmpdir(), 'ricepanel-historico.db');
  const agora = Date.now();
  if (agora - copiaFeitaEm < 60000 && fs.existsSync(destino)) return destino;
  for (const rel of PERFIS) {
    const origem = path.join(os.homedir(), rel);
    try {
      if (!fs.existsSync(origem)) continue;
      fs.copyFileSync(origem, destino);
      fs.chmodSync(destino, 0o600);
      copiaFeitaEm = agora;
      return destino;
    } catch (e) {}
  }
  return '';
}

async function urlDoTitulo(titulo, padrao) {
  const chave = miolo(titulo);
  if (!chave) return '';
  const cacheado = cacheUrl.get(padrao + '|' + chave);
  if (cacheado !== undefined) return cacheado;

  const copia = copiaHistorico();
  if (!copia) return '';

  let achou = '';
  try {
    const linhas = await consultaHistorico(copia, padrao);
    const exato = linhas.find(l => miolo(l.title) === chave);
    const perto = linhas.find(l => {
      const m = miolo(l.title);
      return m && (m.includes(chave) || chave.includes(m));
    });
    achou = (exato || perto || {}).url || '';
  } catch (e) {}

  // O cache é pequeno de propósito: serve para o tique de 2 s não reabrir o
  // banco, não para guardar o histórico dele na memória.
  if (cacheUrl.size > 30) cacheUrl.clear();
  cacheUrl.set(padrao + '|' + chave, achou);
  return achou;
}

function idDaUrlYoutube(url) {
  const m = String(url || '').match(/[?&]v=([A-Za-z0-9_-]{6,})/) ||
    String(url || '').match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : '';
}

// ------------------------------------------------- a aba está à vista dele?

// Só faz sentido puxar o vídeo para a parede quando a janela do navegador não
// está na frente dele. `hyprctl` diz qual workspace está ativo em cada monitor;
// se a janela daquele vídeo está num deles, ele já está vendo.
async function janelaVisivel(titulo) {
  const [cliBruto, monBruto] = await Promise.all([
    roda('hyprctl', ['-j', 'clients']),
    roda('hyprctl', ['-j', 'monitors'])
  ]);
  try {
    const clientes = JSON.parse(cliBruto || '[]');
    const monitores = JSON.parse(monBruto || '[]');
    const ativos = new Set(monitores.map(m => m.activeWorkspace && m.activeWorkspace.id));
    const chave = miolo(titulo).slice(0, 24);
    if (!chave) return true;
    // A janela certa é a que tem o título do vídeo. Aba de fundo não bate com
    // título nenhum — e é exatamente o caso em que o painel deve assumir.
    const doVideo = clientes.filter(c =>
      /chrome|chromium|firefox|brave|vivaldi/i.test(c.class || '') &&
      miolo(c.title).includes(chave));
    return doVideo.some(c => ativos.has(c.workspace && c.workspace.id));
  } catch (e) {
    return true;   // sem hyprctl, não rouba o vídeo de ninguém
  }
}

// ------------------------------------------------------------------ tique

function limpa() {
  estado = { site: '', id: '', titulo: '', posicao: null, duracao: null,
    tocando: false, janelaVisivel: true, player: '' };
}

async function olha() {
  try {
    const players = await lePlayers();
    for (const p of players) {
      const m = await leMetadados(p);
      if (!m) continue;

      // Ordem: capa (barato) → histórico (uma cópia de arquivo por minuto).
      let id = leYoutubeDaCapa(m.capa);
      if (!id) id = idDaUrlYoutube(await urlDoTitulo(m.titulo, '%youtube.com/watch%'));
      const drm = !id && !!(await urlDoTitulo(m.titulo, '%globoplay%'));
      if (!id && !drm) continue;

      const antes = estado.id || estado.titulo;
      estado = {
        site: id ? 'youtube' : 'drm',
        id,
        titulo: m.titulo,
        posicao: m.posicao,
        duracao: m.duracao,
        tocando: m.tocando,
        janelaVisivel: await janelaVisivel(m.titulo),
        player: p
      };
      if (antes !== (id || m.titulo)) {
        log('achou ' + estado.site + ': ' + m.titulo + (id ? ' (' + id + ')' : ''));
      }
      return estado;
    }
    limpa();
  } catch (e) {
    log('falhou: ' + e.message);
  }
  return estado;
}

// Pausa a aba do navegador quando o painel assume o vídeo: dois áudios ao mesmo
// tempo é o pior resultado possível dessa funcionalidade.
async function pausaNavegador() {
  if (!estado.player) return { ok: false };
  await roda('playerctl', ['-p', estado.player, 'pause']);
  estado.tocando = false;
  return { ok: true };
}

async function tocaNavegador() {
  if (!estado.player) return { ok: false };
  await roda('playerctl', ['-p', estado.player, 'play']);
  return { ok: true };
}

function iniciar(d) {
  deps = d;
  const passo = async () => {
    await olha();
    timer = setTimeout(passo, INTERVALO_MS);
    if (timer.unref) timer.unref();
  };
  passo();
}

module.exports = { iniciar, atual: () => estado, pausaNavegador, tocaNavegador };
