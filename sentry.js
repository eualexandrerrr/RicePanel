// Integracao com a API do Sentry: varre as issues NAO RESOLVIDAS de toda a org
// (todos os projetos numa chamada so) e avisa na hora quando aparece erro novo
// ou quando um erro ja conhecido volta a acontecer.
//
// Por que polling e nao webhook: webhook do Sentry exige URL publica e esta
// maquina nao tem. 45 s de intervalo da "na hora" na pratica e cabe folgado no
// rate limit da API.
const fs = require('fs');
const path = require('path');
const os = require('os');

const ORG = 'eualexandrerrr';
const API = 'https://sentry.io/api/0';
const POLL_MS = 45000;
const POLL_ERRO_MS = 180000;   // backoff quando a API falha (rede caida, 429)
const JANELA = '90d';          // quanto tempo para tras a lista de nao resolvidos alcanca
const LIMITE = 50;
const MAX_TOASTS = 3;          // rajada maior vira um toast-resumo

// Token de administracao (sntryu_). Ordem: cofre local -> variavel de ambiente
// -> arquivo de segredos do _CLAUDE. Achando fora do cofre, importa para ele.
const SECRETS_ENV = path.join(os.homedir(), 'Downloads', 'Apps', '_CLAUDE', '.secrets', 'sentry.env');

let dep = null;                // { app, safeStorage, Notification, shell, log, getWindow }
let timer = null;
let estado = { iniciado: false, issues: {} };
let cache = { issues: [], atualizadoEm: null, erro: null, org: ORG, alerta: null };
let novos = new Set();         // ids ainda nao vistos pelo usuario nesta sessao

function arqEstado() { return path.join(dep.app.getPath('userData'), 'sentry-state.json'); }
function arqToken() { return path.join(dep.app.getPath('userData'), 'sentry-token.bin'); }
function log(m) { try { dep.log('sentry: ' + m); } catch (e) {} }

function carregaEstado() {
  try {
    const s = JSON.parse(fs.readFileSync(arqEstado(), 'utf8'));
    if (s && s.issues) estado = { iniciado: !!s.iniciado, issues: s.issues };
  } catch (e) {}
}

function salvaEstado() {
  try { fs.writeFileSync(arqEstado(), JSON.stringify(estado)); } catch (e) {}
}

function salvaToken(t) {
  try {
    if (dep.safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(arqToken(), dep.safeStorage.encryptString(t));
    }
  } catch (e) {}
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
  let t = (process.env.SENTRY_AUTH_TOKEN || '').trim();
  if (!t) {
    try {
      const m = fs.readFileSync(SECRETS_ENV, 'utf8').match(/^\s*SENTRY_AUTH_TOKEN\s*=\s*(.+)$/m);
      if (m) t = m[1].trim();
    } catch (e) {}
  }
  if (t) { salvaToken(t); tokenCache = t; log('token importado para o cofre local'); }
  return t || null;
}

async function api(caminho, opts) {
  const token = leToken();
  if (!token) throw new Error('sem token');
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(API + caminho, Object.assign({
      signal: ctrl.signal,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    }, opts || {}));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.status === 204 ? null : await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// So o que o widget precisa mostrar; o resto da issue e ruido de payload.
function enxuga(i) {
  const md = i.metadata || {};
  return {
    id: i.id,
    shortId: i.shortId,
    titulo: i.title,
    detalhe: md.value || i.culprit || '',
    projeto: (i.project && i.project.slug) || '?',
    projetoNome: (i.project && i.project.name) || '',
    plataforma: i.platform || (i.project && i.project.platform) || '',
    nivel: i.level || 'error',
    eventos: Number(i.count) || 0,
    usuarios: i.userCount || 0,
    primeiro: i.firstSeen,
    ultimo: i.lastSeen,
    link: i.permalink
  };
}

async function buscaIssues() {
  const qs = 'query=' + encodeURIComponent('is:unresolved') +
    '&statsPeriod=' + JANELA + '&limit=' + LIMITE + '&sort=date&project=-1';
  const lista = await api('/organizations/' + ORG + '/issues/?' + qs);
  return (Array.isArray(lista) ? lista : []).map(enxuga);
}

// Compara com o retrato anterior e devolve o que merece toast.
// Primeira execucao nao notifica nada: so tira o retrato, senao o widget
// dispararia um toast por cada erro antigo que ja estava la.
function compara(lista) {
  const antes = estado.issues;
  const agora = {};
  const alertas = [];
  for (const it of lista) {
    const prev = antes[it.id];
    agora[it.id] = { ultimo: it.ultimo, eventos: it.eventos };
    if (!estado.iniciado) continue;
    if (!prev) alertas.push({ it, tipo: 'novo' });
    else if (it.eventos > prev.eventos || new Date(it.ultimo) > new Date(prev.ultimo)) {
      alertas.push({ it, tipo: 'voltou' });
    }
  }
  const primeiraVez = !estado.iniciado;
  estado = { iniciado: true, issues: agora };
  salvaEstado();
  if (primeiraVez) log('primeiro retrato: ' + lista.length + ' issues nao resolvidas (sem toast)');
  return alertas;
}

function toast(titulo, corpo, link) {
  try {
    if (!dep.Notification.isSupported()) return;
    const n = new dep.Notification({ title: titulo, body: corpo, urgency: 'critical' });
    n.on('click', () => { if (link) dep.shell.openExternal(link); });
    n.show();
  } catch (e) {
    log('falha no toast: ' + e.message);
  }
}

function avisa(alertas) {
  for (const a of alertas.slice(0, MAX_TOASTS)) {
    const marca = a.tipo === 'novo' ? 'Erro novo' : 'Voltou a acontecer';
    toast(
      marca + ' · ' + (a.it.projetoNome || a.it.projeto),
      (a.it.titulo + '\n' + a.it.detalhe).slice(0, 220),
      a.it.link
    );
  }
  const resto = alertas.length - MAX_TOASTS;
  if (resto > 0) {
    toast('Sentry', '+' + resto + ' erro(s) alem dos mostrados. Abra o widget.', null);
  }
}

function empurra() {
  try {
    const win = dep.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('sentry-update', Object.assign({}, cache, { novos: Array.from(novos) }));
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
    const lista = await buscaIssues();
    const alertas = compara(lista);
    // Marcacao de "nao visto" some quando o erro deixa de estar na lista.
    const vivos = new Set(lista.map(i => i.id));
    novos = new Set(Array.from(novos).filter(id => vivos.has(id)));
    for (const a of alertas) novos.add(a.it.id);
    // O alerta viaja junto com a lista: o widget se acende sozinho mesmo com a
    // notificacao do Windows desligada (ToastEnabled=0), que e o caso aqui.
    const alerta = alertas.length ? {
      em: new Date().toISOString(),
      quantos: alertas.length,
      novos: alertas.filter(a => a.tipo === 'novo').length,
      resumo: alertas[0].it.projeto + ' · ' + alertas[0].it.titulo
    } : cache.alerta;
    cache = { issues: lista, atualizadoEm: new Date().toISOString(), erro: null, org: ORG, alerta };
    if (alertas.length) {
      log(alertas.length + ' alerta(s): ' + alertas.map(a => a.tipo + ' ' + a.it.shortId).join(', '));
      avisa(alertas);
      try { dep.shell.beep(); } catch (e) {}
    }
    empurra();
    agenda(POLL_MS);
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'API nao respondeu' : e.message;
    cache = Object.assign({}, cache, { erro: msg });
    log('falha ao consultar: ' + msg);
    empurra();
    agenda(POLL_ERRO_MS);
  }
}

// Quem levou o erro. A lista de issues não traz isso: é preciso buscar o último
// evento, que carrega o usuário (anônimo, com geo), o aparelho, o sistema e a
// versão do app. Uma chamada por issue — por isso só acontece quando o painel
// abre a janela, nunca na varredura.
async function detalhe(id) {
  const ev = await api('/organizations/' + ORG + '/issues/' + id + '/events/latest/');
  if (!ev) return null;
  const ctx = ev.contexts || {};
  const u = ev.user || {};
  const geo = u.geo || {};
  const tags = {};
  (ev.tags || []).forEach(t => { tags[t.key] = t.value; });
  return {
    quando: ev.dateCreated || '',
    // email e username costumam vir vazios (sendDefaultPii desligado); o id
    // anônimo ainda serve para saber se é sempre a mesma pessoa.
    usuario: u.email || u.username || u.name || (u.id ? u.id.slice(0, 8) : ''),
    lugar: [geo.city, geo.country_code].filter(Boolean).join(', '),
    aparelho: [(ctx.device && ctx.device.brand), (ctx.device && ctx.device.model)]
      .filter(Boolean).join(' ') || tags.device || '',
    sistema: [(ctx.os && ctx.os.name), (ctx.os && ctx.os.version)].filter(Boolean).join(' ') || '',
    versao: (ev.release && ev.release.version) || tags.release || '',
    ambiente: tags.environment || ''
  };
}

async function resolve(id, status) {
  // status: 'resolved' (some da lista) ou 'ignored' (silencia sem resolver)
  await api('/organizations/' + ORG + '/issues/' + id + '/', {
    method: 'PUT',
    body: JSON.stringify({ status: status || 'resolved' })
  });
  log('issue ' + id + ' marcada como ' + (status || 'resolved'));
  delete estado.issues[id];
  novos.delete(id);
  salvaEstado();
  // Tira da lista na hora e deixa a varredura reconciliar depois: esperar a
  // consulta inteira fazia o clique no visto parecer travado.
  cache = Object.assign({}, cache, { issues: cache.issues.filter(i => i.id !== id) });
  empurra();
  agenda(3000);
  return { ok: true };
}

function iniciar(deps) {
  dep = deps;
  carregaEstado();
  // Espera 5 s para nao competir com o boot do widget.
  agenda(5000);
  log('poller ligado (org ' + ORG + ', a cada ' + (POLL_MS / 1000) + ' s)');
}

module.exports = {
  iniciar,
  resolve,
  detalhe,
  atual: () => Object.assign({}, cache, { novos: Array.from(novos) }),
  marcarVistos: () => { novos.clear(); return true; },
  forcar: () => tick()
};
