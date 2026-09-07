// Canal de anotacoes do Michigan no Discord.
//
// Regra do Alexandre: mensagem SEM reacao = assunto ainda nao resolvido.
// Assim que alguem (ele) reage, sai da lista de pendencias.
//
// O token e o do bot ja configurado no txAdmin (txData/default/config.json).
// Contagem e reacoes funcionam sem intent privilegiada; o TEXTO exige o
// "Message Content Intent", ligado no portal em 27/08/2026 (as flags do app
// passaram a trazer MESSAGE_CONTENT_LIMITED, 1<<19). Se um dia o texto voltar a
// vir vazio para tudo, e esse toggle que caiu.
const fs = require('fs');
const path = require('path');

const API = 'https://discord.com/api/v10';
const GUILD = '000000000000000000';
const CANAL = '000000000000000001';
const POLL_MS = 60000;
const POLL_ERRO_MS = 240000;
const RECHECA_POR_VEZ = 25;   // quantas pendencias reconferir por varredura
const TX_CONFIG = path.join(
  'C:', 'Users', 'Alexandre', 'Downloads', 'MichiganRoleplay', 'txData', 'default', 'config.json'
);

let dep = null;               // { app, safeStorage, Notification, shell, log, getWindow }
let timer = null;
let estado = { iniciado: false, total: 0, ultimoId: null, pendentes: {} };
let cache = { total: 0, pendentes: [], atualizadoEm: null, erro: null, alerta: null };
let novos = new Set();

function arqEstado() { return path.join(dep.app.getPath('userData'), 'discord-state.json'); }
function arqToken() { return path.join(dep.app.getPath('userData'), 'discord-token.bin'); }
function log(m) { try { dep.log('discord: ' + m); } catch (e) {} }

function carregaEstado() {
  try {
    const s = JSON.parse(fs.readFileSync(arqEstado(), 'utf8'));
    if (s && s.pendentes) estado = Object.assign(estado, s);
  } catch (e) {}
}

function salvaEstado() {
  try { fs.writeFileSync(arqEstado(), JSON.stringify(estado)); } catch (e) {}
}

let tokenCache = null;
function leToken() {
  if (tokenCache) return tokenCache;
  try {
    if (dep.safeStorage.isEncryptionAvailable() && fs.existsSync(arqToken())) {
      const t = dep.safeStorage.decryptString(fs.readFileSync(arqToken()));
      if (t && t.trim()) { tokenCache = t.trim(); return tokenCache; }
    }
  } catch (e) {}
  let t = '';
  try {
    const cfg = JSON.parse(fs.readFileSync(TX_CONFIG, 'utf8'));
    t = ((cfg.discordBot && cfg.discordBot.token) || '').trim();
  } catch (e) {}
  if (t) {
    try {
      if (dep.safeStorage.isEncryptionAvailable()) {
        fs.writeFileSync(arqToken(), dep.safeStorage.encryptString(t));
      }
    } catch (e) {}
    tokenCache = t;
    log('token do bot lido do txAdmin e guardado no cofre local');
  }
  return t || null;
}

async function api(caminho) {
  const token = leToken();
  if (!token) throw new Error('sem token do bot');
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(API + caminho, {
      signal: ctrl.signal,
      headers: { 'Authorization': 'Bot ' + token }
    });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      throw new Error('rate limit (' + (j.retry_after || '?') + 's)');
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function link(id) {
  return 'https://discord.com/channels/' + GUILD + '/' + CANAL + '/' + id;
}

// Timestamp sai do proprio id (snowflake): epoch do Discord + 42 bits de tempo.
function quando(id) {
  return new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString();
}

// So o que o widget precisa mostrar; o resto da mensagem e ruido de payload.
//
// O texto nem sempre esta em `content`. Mensagem ENCAMINHADA (o Alexandre
// encaminha muita coisa de outros canais para ca) chega com content vazio e o
// conteudo real dentro de `message_snapshots` — foi por isso que varias
// anotacoes apareciam so como "sem reacao".
function textoDaMensagem(m) {
  const direto = (m.content || '').trim();
  if (direto) return { texto: direto, encaminhada: false };

  const snap = (m.message_snapshots || [])[0];
  const orig = snap && snap.message ? snap.message : null;
  if (orig) {
    const t = (orig.content || '').trim();
    if (t) return { texto: t, encaminhada: true };
    const e = (orig.embeds || [])[0];
    if (e && (e.title || e.description)) {
      return { texto: (e.title || e.description || '').trim(), encaminhada: true };
    }
    if ((orig.attachments || []).length) {
      return { texto: descreveAnexos(orig.attachments), encaminhada: true };
    }
  }

  const e = (m.embeds || [])[0];
  if (e && (e.title || e.description || (e.author && e.author.name))) {
    return { texto: (e.title || e.description || e.author.name || '').trim(), encaminhada: false };
  }
  if ((m.attachments || []).length) {
    return { texto: descreveAnexos(m.attachments), encaminhada: false };
  }
  if ((m.sticker_items || []).length) {
    return { texto: 'figurinha: ' + m.sticker_items.map(s => s.name).join(', '), encaminhada: false };
  }
  return { texto: '', encaminhada: false };
}

// Anexo sem legenda vira a descricao do que foi mandado, em vez de nada.
function descreveAnexos(lista) {
  const nomes = lista.map(a => a.filename).filter(Boolean);
  const soImagem = lista.every(a => String(a.content_type || '').indexOf('image/') === 0);
  const rotulo = soImagem
    ? (lista.length === 1 ? 'imagem' : lista.length + ' imagens')
    : (lista.length === 1 ? 'anexo' : lista.length + ' anexos');
  return nomes.length ? rotulo + ': ' + nomes.join(', ') : rotulo;
}

// Cores dos cargos do servidor, para o nome sair da mesma cor que sai no
// Discord. Buscado uma vez por execucao: cargo muda de cor uma vez por ano.
let coresCargo = null;
async function carregaCargos() {
  if (coresCargo) return coresCargo;
  coresCargo = {};
  try {
    const lista = await api('/guilds/' + GUILD + '/roles');
    if (Array.isArray(lista)) {
      for (const c of lista) coresCargo[c.id] = { cor: c.color, posicao: c.position };
    }
    log('cargos carregados: ' + Object.keys(coresCargo).length);
  } catch (e) {
    log('nao deu para ler os cargos: ' + e.message);
  }
  return coresCargo;
}

// No Discord vale a cor do cargo mais alto que TEM cor; cargo sem cor (0) nao
// pinta nada, mesmo estando acima.
// A REST nao manda member na mensagem; quando mandar (gateway), aproveita.
function corDoAutor(m) {
  return corDosCargos((m.member && m.member.roles) || []);
}

function urlAvatar(m) {
  const u = m.author || {};
  // Avatar por servidor (member.avatar) vence o global, como no proprio Discord.
  if (m.member && m.member.avatar) {
    return 'https://cdn.discordapp.com/guilds/' + GUILD + '/users/' + u.id +
      '/avatars/' + m.member.avatar + '.png?size=64';
  }
  if (u.avatar) {
    return 'https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + '.png?size=64';
  }
  // Sem avatar o Discord usa um padrao derivado do id.
  const i = u.discriminator && u.discriminator !== '0'
    ? Number(u.discriminator) % 5
    : Number((BigInt(u.id || '0') >> 22n) % 6n);
  return 'https://cdn.discordapp.com/embed/avatars/' + i + '.png';
}

function imagensDe(lista) {
  return (lista || [])
    .filter(a => String(a.content_type || '').indexOf('image/') === 0)
    .map(a => ({ url: a.url, largura: a.width || 0, altura: a.height || 0, nome: a.filename }));
}

function outrosAnexos(lista) {
  return (lista || [])
    .filter(a => String(a.content_type || '').indexOf('image/') !== 0)
    .map(a => ({ nome: a.filename, url: a.url, tamanho: a.size || 0 }));
}

// A rota REST de mensagens NAO traz o `member` (so o gateway traz), entao a cor
// do cargo e o apelido do servidor precisam vir de uma busca por autor. Sao
// poucos autores num canal de anotacoes, e o resultado fica em cache: uma
// chamada por pessoa, nao por mensagem.
const membros = {};

async function membroDe(userId) {
  if (!userId) return null;
  if (membros[userId] !== undefined) return membros[userId];
  membros[userId] = null;               // evita duas buscas do mesmo autor
  try {
    membros[userId] = await api('/guilds/' + GUILD + '/members/' + userId);
  } catch (e) {
    // Quem saiu do servidor devolve 404: fica sem cor mesmo, e tudo bem.
    membros[userId] = null;
  }
  return membros[userId];
}

function corDosCargos(cargos) {
  if (!coresCargo || !cargos || !cargos.length) return '';
  let melhor = null;
  for (const id of cargos) {
    const c = coresCargo[id];
    if (!c || !c.cor) continue;
    if (!melhor || c.posicao > melhor.posicao) melhor = c;
  }
  return melhor ? '#' + melhor.cor.toString(16).padStart(6, '0') : '';
}

// Passa a lista de pendencias completando cor e apelido de cada autor.
async function completaAutores(lista) {
  const ids = Array.from(new Set(lista.map(p => p.autorId).filter(Boolean)));
  for (const id of ids) await membroDe(id);
  for (const p of lista) {
    const m = membros[p.autorId];
    if (!m) continue;
    if (m.nick) p.autor = m.nick;
    const cor = corDosCargos(m.roles);
    if (cor) p.cor = cor;
    if (m.avatar) {
      p.avatar = 'https://cdn.discordapp.com/guilds/' + GUILD + '/users/' + p.autorId +
        '/avatars/' + m.avatar + '.png?size=64';
    }
  }
  log('autores completados: ' + ids.length);
}

function enxuga(m) {
  const t = textoDaMensagem(m);
  const snap = (m.message_snapshots || [])[0];
  const orig = snap && snap.message ? snap.message : null;
  return {
    id: m.id,
    autor: (m.member && m.member.nick) ||
           (m.author && (m.author.global_name || m.author.username)) || '?',
    autorId: (m.author && m.author.id) || '',
    avatar: urlAvatar(m),
    cor: corDoAutor(m),
    texto: t.texto.slice(0, 900),
    encaminhada: t.encaminhada,
    imagens: imagensDe(m.attachments).concat(orig ? imagensDe(orig.attachments) : []),
    anexos: outrosAnexos(m.attachments).concat(orig ? outrosAnexos(orig.attachments) : []),
    em: quando(m.id),
    link: link(m.id)
  };
}

function semReacao(m) {
  return !(m.reactions && m.reactions.length);
}

// Varredura completa do canal, so na primeira vez: pagina de tras para frente
// ate o comeco. Depois disso o poll so busca o que chegou de novo.
async function varreduraCompleta() {
  await carregaCargos();
  let antes = null;
  let total = 0;
  const pendentes = {};
  let ultimoId = null;
  for (let volta = 0; volta < 200; volta++) {   // teto de seguranca: 20 mil msgs
    const q = '/channels/' + CANAL + '/messages?limit=100' + (antes ? '&before=' + antes : '');
    const lote = await api(q);
    if (!Array.isArray(lote) || !lote.length) break;
    if (!ultimoId) ultimoId = lote[0].id;       // o mais recente do canal
    total += lote.length;
    for (const m of lote) if (semReacao(m)) pendentes[m.id] = enxuga(m);
    antes = lote[lote.length - 1].id;
    if (lote.length < 100) break;
  }
  log('varredura completa: ' + total + ' mensagens, ' + Object.keys(pendentes).length + ' sem reacao');
  return { total, pendentes, ultimoId };
}

async function novasDesde(ultimoId) {
  await carregaCargos();
  const achadas = [];
  let depois = ultimoId;
  for (let volta = 0; volta < 20; volta++) {
    const lote = await api('/channels/' + CANAL + '/messages?limit=100&after=' + depois);
    if (!Array.isArray(lote) || !lote.length) break;
    // vem do mais novo para o mais antigo; o proximo 'after' e o mais novo do lote
    achadas.push(...lote);
    depois = lote[0].id;
    if (lote.length < 100) break;
  }
  return achadas;
}

// Reage-se a mensagens antigas o tempo todo; sem endpoint em lote, reconfere
// uma por uma, das mais velhas para as mais novas, com teto por varredura.
async function reconfere(ids) {
  const resolvidas = [];
  for (const id of ids) {
    try {
      const m = await api('/channels/' + CANAL + '/messages/' + id);
      if (!semReacao(m)) resolvidas.push(id);
    } catch (e) {
      if (/HTTP 404/.test(e.message)) resolvidas.push(id);   // apagada
      else break;                                            // rede/rate limit: para por aqui
    }
  }
  return resolvidas;
}

function toast(titulo, corpo, url) {
  try {
    if (!dep.Notification.isSupported()) return;
    const n = new dep.Notification({ title: titulo, body: corpo, urgency: 'critical' });
    n.on('click', () => { if (url) dep.shell.openExternal(url); });
    n.show();
  } catch (e) {}
}

// Reflete o estado em memoria no que o painel mostra, sem nenhuma chamada.
function atualizaCacheLocal() {
  const pendentes = Object.values(estado.pendentes)
    .sort((a, b) => (BigInt(b.id) < BigInt(a.id) ? -1 : 1));
  cache = Object.assign({}, cache, { total: estado.total, pendentes: pendentes });
}

function empurra() {
  try {
    const win = dep.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('discord-update', Object.assign({}, cache, { novos: Array.from(novos) }));
    }
  } catch (e) {}
}

function agenda(ms) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, ms);
  if (timer.unref) timer.unref();
}

async function tick() {
  try {
    let alerta = cache.alerta;
    const chegaram = [];

    if (!estado.iniciado || !estado.ultimoId) {
      const r = await varreduraCompleta();
      estado = { iniciado: true, total: r.total, ultimoId: r.ultimoId, pendentes: r.pendentes };
    } else {
      const lote = await novasDesde(estado.ultimoId);
      if (lote.length) {
        estado.total += lote.length;
        estado.ultimoId = lote[0].id;
        for (const m of lote) {
          if (semReacao(m)) {
            const p = enxuga(m);
            estado.pendentes[p.id] = p;
            chegaram.push(p);
          }
        }
      }
      // reconfere as pendencias mais antigas (as que ele costuma ir resolvendo)
      const ids = Object.keys(estado.pendentes)
        .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
        .slice(0, RECHECA_POR_VEZ);
      for (const id of await reconfere(ids)) delete estado.pendentes[id];
    }

    salvaEstado();

    const pendentes = Object.values(estado.pendentes)
      .sort((a, b) => (BigInt(b.id) < BigInt(a.id) ? -1 : 1));   // mais novas primeiro
    await completaAutores(pendentes);
    for (const p of pendentes) estado.pendentes[p.id] = p;
    salvaEstado();
    const vivas = new Set(pendentes.map(p => p.id));
    novos = new Set(Array.from(novos).filter(id => vivas.has(id)));
    for (const p of chegaram) novos.add(p.id);

    if (chegaram.length) {
      alerta = {
        em: new Date().toISOString(),
        quantos: chegaram.length,
        resumo: chegaram[0].autor + (chegaram[0].texto ? ' · ' + chegaram[0].texto : ' · nova anotação')
      };
      log(chegaram.length + ' anotacao(oes) nova(s) sem reacao');
      for (const p of chegaram.slice(0, 3)) {
        toast('Anotação nova · Michigan', p.autor + (p.texto ? ': ' + p.texto.slice(0, 160) : ''), p.link);
      }
      try { dep.shell.beep(); } catch (e) {}
    }

    cache = {
      total: estado.total,
      pendentes,
      atualizadoEm: new Date().toISOString(),
      erro: null,
      alerta
    };
    empurra();
    agenda(POLL_MS);
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'Discord nao respondeu' : e.message;
    cache = Object.assign({}, cache, { erro: msg });
    log('falha: ' + msg);
    empurra();
    agenda(POLL_ERRO_MS);
  }
}

// PUT/DELETE de reacao nao devolvem corpo; a resposta util e so o status.
async function chamaReacao(metodo, id, emoji) {
  const token = leToken();
  if (!token) throw new Error('sem token do bot');
  const caminho = API + '/channels/' + CANAL + '/messages/' + id +
    '/reactions/' + encodeURIComponent(emoji) + '/@me';
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(caminho, {
      method: metodo,
      signal: ctrl.signal,
      headers: { 'Authorization': 'Bot ' + token, 'Content-Length': '0' }
    });
    if (res.status === 403) throw new Error('o bot nao tem permissao de reagir aqui');
    // 404 no DELETE e normal: a reacao que se queria tirar nao existia.
    if (!res.ok && res.status !== 204 && !(metodo === 'DELETE' && res.status === 404)) {
      throw new Error('HTTP ' + res.status);
    }
    return true;
  } finally {
    clearTimeout(timeout);
  }
}

// Reagir e o que marca a anotacao como resolvida — e a regra do canal. O bot
// reage no lugar do Alexandre: joinha vale "resolvido", X vale "nao vai ser
// feito". As duas se excluem, entao a nova apaga a anterior.
const JOINHA = '\u{1F44D}';
const XIS = '\u274C';

async function reagir(id, emoji) {
  const oposto = emoji === JOINHA ? XIS : JOINHA;
  // Tira a contraria primeiro: uma anula a outra, nunca convivem.
  try { await chamaReacao('DELETE', id, oposto); } catch (e) {}
  await chamaReacao('PUT', id, emoji);

  log('reagiu ' + emoji + ' em ' + id);
  delete estado.pendentes[id];
  novos.delete(id);
  salvaEstado();
  // Nao espera a varredura: ela reconfere ate 25 pendencias uma a uma e fazia o
  // clique parecer travado. A lista sai da frente na hora, com o que ja se sabe,
  // e a proxima volta do poller (em 3 s) reconcilia com o servidor.
  atualizaCacheLocal();
  empurra();
  agenda(3000);
  return { ok: true, emoji: emoji };
}

// Cria o topico na mensagem e ja deixa a primeira resposta dentro dele.
// Quem fala e o bot, mas quem escreve e o Alexandre: o texto vai como ele
// digitou, sem prefixo de robo.
async function criarTopico(id, nome, resposta) {
  const token = leToken();
  if (!token) throw new Error('sem token do bot');
  const cabecalho = {
    'Authorization': 'Bot ' + token,
    'Content-Type': 'application/json'
  };

  const rt = await fetch(API + '/channels/' + CANAL + '/messages/' + id + '/threads', {
    method: 'POST',
    headers: cabecalho,
    body: JSON.stringify({
      name: String(nome || 'Anotacao').slice(0, 100),
      auto_archive_duration: 1440          // arquiva sozinho em 24 h
    })
  });
  if (!rt.ok) {
    const corpo = await rt.text();
    throw new Error('nao criou o topico (HTTP ' + rt.status + ') ' + corpo.slice(0, 120));
  }
  const topico = await rt.json();

  if (resposta && resposta.trim()) {
    const rm = await fetch(API + '/channels/' + topico.id + '/messages', {
      method: 'POST',
      headers: cabecalho,
      body: JSON.stringify({ content: resposta.trim().slice(0, 1900) })
    });
    if (!rm.ok) {
      const corpo = await rm.text();
      throw new Error('topico criado, mas a resposta falhou (HTTP ' + rm.status + ') ' + corpo.slice(0, 120));
    }
  }

  log('topico criado em ' + id + ': ' + String(nome).slice(0, 60));
  return {
    ok: true,
    id: topico.id,
    link: 'https://discord.com/channels/' + GUILD + '/' + topico.id
  };
}

function iniciar(deps) {
  dep = deps;
  carregaEstado();
  agenda(8000);
  log('poller ligado (canal ' + CANAL + ', a cada ' + (POLL_MS / 1000) + ' s)');
}

module.exports = {
  iniciar,
  reagir,
  criarTopico,
  atual: () => Object.assign({}, cache, { novos: Array.from(novos) }),
  marcarVistos: () => { novos.clear(); return true; },
  forcar: () => tick(),
  // Recontagem do zero: usar se a contagem sair do lugar.
  recontar: async () => {
    estado = { iniciado: false, total: 0, ultimoId: null, pendentes: {} };
    salvaEstado();
    await tick();
    return cache;
  }
};
