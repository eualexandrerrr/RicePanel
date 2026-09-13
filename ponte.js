// Ponte com a extensão do Chrome — lado do painel, no Windows.
//
// No COSMIC quem fala com a extensão é o binário nativo em Rust. No Windows o
// Mirante é este Electron, e o Chrome não conversa com um app que já está de
// pé: native messaging sobe um processo novo por conexão (`ponte-windows/
// host.bat`). Esse host só repassa, e o painel escuta num named pipe local.
//
// Protocolo no pipe: uma mensagem JSON por linha, nos dois sentidos.
//   extensão → painel  {tipo:'abas', abas:[...]}  a cada 2 s
//                      {tipo:'cookies', pedido, cookies:[...]}
//   painel → extensão  {tipo:'pausar'|'retomar', aba}
//                      {tipo:'cookies', dominio, pedido}

const net = require('net');

const CANO = '\\\\.\\pipe\\ricepanel-ponte';
// Lista de abas mais velha que isto é de uma extensão que parou de relatar
// (Chrome fechado, service worker morto): vale como lista vazia.
const VALIDADE_MS = 8000;

let deps = null;
let conexao = null;
let abas = [];
let abasEm = 0;
let seq = 0;
const esperando = new Map();

function log(msg) {
  if (deps && deps.log) deps.log('ponte: ' + msg);
}

function trata(linha) {
  let m;
  try { m = JSON.parse(linha); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;
  if (m.tipo === 'abas' && Array.isArray(m.abas)) {
    abas = m.abas;
    abasEm = Date.now();
    return;
  }
  if (m.tipo === 'cookies' && esperando.has(m.pedido)) {
    const resolve = esperando.get(m.pedido);
    esperando.delete(m.pedido);
    const lista = Array.isArray(m.cookies) ? m.cookies : [];
    log('cookies: extensão respondeu com ' + lista.length);
    resolve(lista);
  }
}

function iniciar(d) {
  deps = d;
  const servidor = net.createServer((sock) => {
    // Uma extensão por vez: conexão nova (Chrome reiniciado) substitui a velha.
    if (conexao && conexao !== sock) { try { conexao.destroy(); } catch (e) {} }
    conexao = sock;
    log('extensão conectada');
    sock.setEncoding('utf8');
    let resto = '';
    sock.on('data', (pedaco) => {
      resto += pedaco;
      let i;
      while ((i = resto.indexOf('\n')) >= 0) {
        const linha = resto.slice(0, i);
        resto = resto.slice(i + 1);
        if (linha.trim()) trata(linha);
      }
    });
    sock.on('close', () => {
      if (conexao !== sock) return;
      conexao = null;
      abas = [];
      log('extensão desconectada');
    });
    sock.on('error', () => {});
  });
  servidor.on('error', (e) => log('pipe indisponível: ' + e.message));
  servidor.listen(CANO, () => log('ouvindo em ' + CANO));
}

function envia(msg) {
  if (!conexao) return false;
  try {
    conexao.write(JSON.stringify(msg) + '\n');
    return true;
  } catch (e) {
    return false;
  }
}

function abasAtuais() {
  return Date.now() - abasEm < VALIDADE_MS ? abas : [];
}

// Cookies de um domínio, pela API do próprio Chrome. No Windows o Chrome cifra
// o banco de cookies com chave presa ao executável dele: ler o SQLite de fora,
// como no Linux, não funciona mais.
function pedeCookies(dominio, ms) {
  return new Promise((resolve) => {
    const pedido = ++seq;
    if (!envia({ tipo: 'cookies', dominio, pedido })) return resolve([]);
    esperando.set(pedido, resolve);
    setTimeout(() => {
      if (!esperando.has(pedido)) return;
      esperando.delete(pedido);
      log('cookies: a extensão não respondeu em ' + ((ms || 4000) / 1000) + ' s');
      resolve([]);
    }, ms || 4000);
  });
}

module.exports = { iniciar, envia, abasAtuais, pedeCookies, conectada: () => !!conexao };
