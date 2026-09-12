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
// A conta é a dele: a webview do painel tem partição própria, então o YouTube
// entrava deslogado — anúncio, sem Premium, e às vezes a tela de "faça login".
// Entrar pelo painel não resolve, o Google recusa login vindo de Electron. Os
// cookies de youtube.com são copiados do Chrome (SQLite ao lado do histórico,
// cifrados com a chave fixa do Chrome no Linux sem keyring) a cada vídeo novo.
//
// Tudo isto é opcional e nasce DESLIGADO: puxar o vídeo pausa a aba dele, e
// isso só é bem-vindo quando ele pediu. A chave fica na travessa.
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

let deps = null;                 // { log, app, session }
const PARTICAO = 'persist:video-mirante';   // a mesma do <webview> em mirante.js
let ligado = false;
let pausadoPeloPainel = false;
let estado = {
  site: '',                      // youtube | drm | ''
  id: '',
  titulo: '',
  posicao: null,
  duracao: null,
  tocando: false,
  janelaVisivel: true,           // a aba está à vista dele agora?
  player: '',
  volume: null                   // 0..1, copiado do fluxo do navegador
};
// O último volume visto vale enquanto o navegador está mudo: ao pausar a aba o
// fluxo some do PipeWire e a leitura viraria `null` bem na hora em que o painel
// precisa dela.
let ultimoVolume = null;
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

// ---------------------------------------------------------------- chave

function arquivoChave() {
  return path.join(deps.app.getPath('userData'), 'video.json');
}

function leChave() {
  try { ligado = !!JSON.parse(fs.readFileSync(arquivoChave(), 'utf8')).ligado; }
  catch (e) { ligado = false; }
}

async function liga(valor) {
  ligado = !!valor;
  try { fs.writeFileSync(arquivoChave(), JSON.stringify({ ligado })); } catch (e) {}
  // Desligar com a aba pausada pelo painel devolve o som ao navegador: senão
  // ele desliga a chave e o vídeo fica mudo nos dois lugares.
  if (!ligado) {
    if (pausadoPeloPainel) await tocaNavegador();
    limpa();
  }
  log(ligado ? 'ligado' : 'desligado');
  return ligado;
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

// ------------------------------------------------------ volume do navegador

// O painel toca o mesmo vídeo que estava no Chrome, então tem de tocar no
// mesmo volume: se ele deixou a aba em 30%, ouvir 100% na parede é susto. O
// PipeWire guarda o volume por fluxo, e `pactl list sink-inputs` é onde ele
// aparece. Sem áudio tocando não existe fluxo — nesse caso não há o que copiar
// e o player fica com o volume que já tinha.
async function volumeDoNavegador() {
  const bruto = await roda('pactl', ['list', 'sink-inputs'], 2500);
  if (!bruto) return null;
  for (const bloco of bruto.split(/Sink Input #/).slice(1)) {
    if (!/chrome|chromium|brave|vivaldi|firefox/i.test(bloco)) continue;
    const m = bloco.match(/Volume:[^\n]*?(\d+)%/);
    if (!m) continue;
    const pct = Number(m[1]);
    if (!Number.isFinite(pct)) continue;
    return Math.max(0, Math.min(1, pct / 100));
  }
  return null;
}

// ------------------------------------------------------- a conta dele

// O Chrome guarda os cookies num SQLite igual ao do histórico, com o valor
// cifrado. No Linux sem keyring a chave é fixa e conhecida ("peanuts", prefixo
// `v10`); com keyring o prefixo é `v11` e a senha não está ao alcance daqui —
// nesse caso o cookie é pulado e o YouTube toca deslogado, como antes.
// Só youtube.com entra, e entra de novo a cada vídeo: o Google gira alguns
// cookies de sessão de minuto em minuto e cópia velha vira sessão inválida.
const PERFIS_COOKIES = PERFIS.map(p => p.replace(/History$/, 'Cookies'));
const EPOCA_CHROME_S = 11644473600;      // 1601 → 1970, em segundos
const SAMESITE = { '-1': 'unspecified', '0': 'no_restriction', '1': 'lax', '2': 'strict' };
let chaveV10 = null;

function decifraV10(cifrado, host) {
  const crypto = require('crypto');
  if (!chaveV10) chaveV10 = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
  const d = crypto.createDecipheriv('aes-128-cbc', chaveV10, Buffer.alloc(16, 0x20));
  let claro = Buffer.concat([d.update(cifrado.subarray(3)), d.final()]);
  // Chrome 130+ prefixa o valor com o SHA-256 do host, amarrando cookie a domínio.
  const hash = crypto.createHash('sha256').update(host).digest();
  if (claro.length >= 32 && claro.subarray(0, 32).equals(hash)) claro = claro.subarray(32);
  return claro.toString('utf8');
}

// Devolve linhas como arrays de texto, pelo `node:sqlite` ou pelo binário; o
// blob cifrado vai em hex nos dois para o caminho ser um só.
// O Chrome guarda também cópias particionadas por site de origem (CHIPS): o
// VISITOR_INFO1_LIVE que o youtube.com criou embutido no github.com, por
// exemplo. Só a partição do próprio YouTube interessa; sem a coluna (Chrome
// antigo) a consulta cai para a lista inteira.
const SQL_COOKIES = "select host_key, name, value, hex(encrypted_value), path, expires_utc, " +
  "is_secure, is_httponly, samesite from cookies where host_key like '%youtube.com'";
const SQL_SO_PRIMEIRA = " and (top_frame_site_key = '' or top_frame_site_key like 'https://youtube.com%')";

async function consultaCookies(copia) {
  for (const sql of [SQL_COOKIES + SQL_SO_PRIMEIRA, SQL_COOKIES]) {
    if (sqlite && sqlite.DatabaseSync) {
      try {
        const db = new sqlite.DatabaseSync(copia, { readOnly: true });
        const linhas = db.prepare(sql).all().map(l => Object.values(l).map(v => String(v ?? '')));
        db.close();
        return linhas;
      } catch (e) {}
    }
    const bruto = await roda('sqlite3', ['-separator', SEP, copia, sql], 3000);
    const linhas = bruto.split('\n').filter(Boolean).map(l => l.split(SEP));
    if (linhas.length) return linhas;
  }
  return [];
}

async function cookiesDoNavegador() {
  const copia = path.join(os.tmpdir(), 'ricepanel-cookies.db');
  let copiou = false;
  for (const rel of PERFIS_COOKIES) {
    const origem = path.join(os.homedir(), rel);
    try {
      if (!fs.existsSync(origem)) continue;
      fs.copyFileSync(origem, copia);
      fs.chmodSync(copia, 0o600);
      copiou = true;
      break;
    } catch (e) {}
  }
  if (!copiou) return [];
  let linhas = [];
  try { linhas = await consultaCookies(copia); } catch (e) { log('cookies: ' + e.message); }
  // Cookie de sessão não fica largado no /tmp.
  try { fs.unlinkSync(copia); } catch (e) {}

  const saida = [];
  for (const [host, nome, claro, hex, caminho, expira, seguro, soHttp, mesmoSite] of linhas) {
    let valor = claro || '';
    if (!valor && hex) {
      const cifrado = Buffer.from(hex, 'hex');
      if (cifrado.length <= 3 || cifrado.subarray(0, 3).toString() !== 'v10') continue;
      try { valor = decifraV10(cifrado, host); } catch (e) { continue; }
    }
    if (!valor) continue;
    const exp = Number(expira);
    saida.push({
      url: 'https://' + host.replace(/^\./, ''),
      domain: host.startsWith('.') ? host : undefined,
      name: nome,
      value: valor,
      path: caminho || '/',
      secure: seguro === '1',
      httpOnly: soHttp === '1',
      sameSite: SAMESITE[mesmoSite] || 'unspecified',
      expirationDate: exp > 0 ? Math.floor(exp / 1e6 - EPOCA_CHROME_S) : undefined
    });
  }
  return saida;
}

// Põe a sessão do Chrome na partição da webview. Os cookies antigos de
// youtube.com saem antes: se ele trocou de conta ou saiu no Chrome, o painel
// acompanha em vez de continuar logado num fantasma.
async function entraComAContaDele() {
  if (!deps.session) return { ok: false, total: 0 };
  const ses = deps.session.fromPartition(PARTICAO);
  const cookies = await cookiesDoNavegador();
  try {
    const velhos = await ses.cookies.get({ domain: 'youtube.com' });
    for (const c of velhos) {
      await ses.cookies.remove('https://' + c.domain.replace(/^\./, '') + c.path, c.name).catch(() => {});
    }
  } catch (e) {}
  let total = 0;
  for (const c of cookies) {
    try { await ses.cookies.set(c); total++; }
    catch (e) { log('cookie ' + c.name + ' recusado: ' + e.message); }
  }
  log('conta: ' + total + ' cookies do navegador na partição');
  return { ok: total > 0, total };
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
    tocando: false, janelaVisivel: true, player: '', volume: ultimoVolume };
}

// Atalho de desenvolvimento: `RICEPANEL_VIDEO_FAKE=drm` (ou `youtube:<id>`)
// finge um vídeo tocando fora da vista, para conferir a placa sem depender de
// haver algo rolando no navegador na hora.
function fingido() {
  const f = process.env.RICEPANEL_VIDEO_FAKE;
  if (!f) return null;
  const [tipo, id] = String(f).split(':');
  return {
    site: tipo === 'youtube' ? 'youtube' : 'drm',
    id: tipo === 'youtube' ? (id || 'dQw4w9WgXcQ') : '',
    titulo: 'Teste de placa de vídeo',
    posicao: 0,
    duracao: null,
    tocando: true,
    janelaVisivel: false,
    player: ''
  };
}

async function olha() {
  if (!ligado) { limpa(); return estado; }
  const falso = fingido();
  if (falso) { estado = falso; return estado; }
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

      const vol = await volumeDoNavegador();
      if (vol != null) ultimoVolume = vol;

      const antes = estado.id || estado.titulo;
      estado = {
        site: id ? 'youtube' : 'drm',
        id,
        titulo: m.titulo,
        posicao: m.posicao,
        duracao: m.duracao,
        tocando: m.tocando,
        janelaVisivel: await janelaVisivel(m.titulo),
        player: p,
        volume: ultimoVolume
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
  pausadoPeloPainel = true;
  return { ok: true };
}

async function tocaNavegador() {
  if (!estado.player) return { ok: false };
  await roda('playerctl', ['-p', estado.player, 'play']);
  pausadoPeloPainel = false;
  return { ok: true };
}

function iniciar(d) {
  deps = d;
  leChave();
  log((ligado ? 'ligado' : 'desligado') + '; vigiando o navegador a cada ' + (INTERVALO_MS / 1000) + ' s');
  const passo = async () => {
    await olha();
    timer = setTimeout(passo, INTERVALO_MS);
    if (timer.unref) timer.unref();
  };
  passo();
}

module.exports = {
  iniciar,
  atual: () => Object.assign({ ligado }, estado),
  ligado: () => ligado,
  liga,
  entraComAContaDele,
  cookiesDoNavegador,
  pausaNavegador,
  tocaNavegador
};
