// Tarefas — Google Tarefas na agenda do Mirante (27/09/2026).
//
// O iCal secreto da agenda não traz tarefa nenhuma, nem se foi concluída. Sem
// isso o painel não tinha como mostrar "passou e ninguém marcou". A API oficial
// exigiria OAuth com token que expira (a mesma razão de o agenda.js usar iCal),
// então a ponte é um Apps Script do próprio Alexandre, implantado como app da
// web que roda como ele ("RicePanel Tarefas" no script.google.com). O painel
// chama a URL com uma chave: GET lê, POST conclui. Nunca expira.
//
// URL + chave são segredo (quem tiver lê e conclui as tarefas dele): moram em
// D:\Claude\.secrets\tarefas.env, fora do repositório.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV = [
  path.join('D:', 'Claude', '.secrets', 'tarefas.env'),
  path.join(os.homedir(), '.config', 'mirante', 'tarefas.env')
];

let deps = null;
let estado = { tarefas: [], erro: null, atualizadoEm: null, tem: false };
let buscando = null;
let aoMudar = null;             // main.js empurra para a tela

function log(msg) {
  if (deps && deps.log) deps.log('tarefas: ' + msg);
}

function leConfig() {
  for (const arq of ENV) {
    try {
      const t = fs.readFileSync(arq, 'utf8');
      const url = (t.match(/^\s*TAREFAS_URL\s*=\s*(\S+)/m) || [])[1];
      const chave = (t.match(/^\s*TAREFAS_CHAVE\s*=\s*(\S+)/m) || [])[1];
      if (url && chave) return { url, chave };
    } catch (e) {}
  }
  return null;
}

function arqCache() {
  return path.join(deps.app.getPath('userData'), 'tarefas-cache.json');
}

// A API guarda só a DATA do prazo, como meia-noite UTC. Virar Date local com
// esse instante jogaria a tarefa para o dia anterior no fuso de Brasília.
function diaLocal(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString() : null;
}

function normaliza(t) {
  return {
    lista: t.lista,
    id: t.id,
    // Título de várias linhas (a tarefa do rodízio de streaming, por exemplo):
    // na agenda vai só a primeira.
    titulo: String(t.titulo || '').split('\n')[0].trim(),
    dia: diaLocal(t.prazo),
    feita: !!t.feita
  };
}

async function chama(cfg, metodo, extra) {
  const u = new URL(cfg.url);
  u.searchParams.set('chave', cfg.chave);
  for (const [k, v] of Object.entries(extra || {})) u.searchParams.set(k, v);
  const ctrl = new AbortController();
  const prazo = setTimeout(() => ctrl.abort(), 25000);
  try {
    // O Apps Script responde com 302 para o googleusercontent; o fetch segue
    // (e no POST o script já rodou antes do redirecionamento).
    const res = await fetch(u, { method: metodo, signal: ctrl.signal, cache: 'no-store', redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (j.erro) throw new Error(j.erro);
    return j;
  } finally {
    clearTimeout(prazo);
  }
}

async function busca() {
  if (buscando) return buscando;
  buscando = (async () => {
    const cfg = leConfig();
    estado.tem = !!cfg;
    if (!cfg) return estado;
    try {
      const j = await chama(cfg, 'GET');
      const antes = JSON.stringify(estado.tarefas);
      estado.tarefas = (j.tarefas || []).map(normaliza).filter(t => t.titulo && t.dia);
      if (JSON.stringify(estado.tarefas) !== antes && aoMudar) { try { aoMudar(); } catch (e) {} }
      estado.atualizadoEm = new Date().toISOString();
      estado.erro = null;
      try { fs.writeFileSync(arqCache(), JSON.stringify(estado)); } catch (e) {}
    } catch (err) {
      estado.erro = err.name === 'AbortError' ? 'tempo esgotado' : err.message;
      log('falhou: ' + estado.erro);
    }
    return estado;
  })();
  try { return await buscando; } finally { buscando = null; }
}

async function concluir(lista, id) {
  const cfg = leConfig();
  if (!cfg) return { ok: false, error: 'sem tarefas.env' };
  try {
    await chama(cfg, 'POST', { lista, id });
    // Já na tela antes da releitura: o clique não pode parecer que não pegou.
    const t = estado.tarefas.find(x => x.id === id);
    if (t) t.feita = true;
    log('concluída: ' + (t ? t.titulo : id));
    busca().catch(() => {});
    return { ok: true };
  } catch (err) {
    log('não concluiu: ' + err.message);
    return { ok: false, error: err.message };
  }
}

function iniciar(d) {
  deps = d;
  try { Object.assign(estado, JSON.parse(fs.readFileSync(arqCache(), 'utf8'))); } catch (e) {}
  estado.tem = !!leConfig();
  busca().catch(() => {});
  // Cinco minutos: marcar no celular tem de sumir da parede sem demora.
  const t = setInterval(() => { busca().catch(() => {}); }, 5 * 60 * 1000);
  if (t.unref) t.unref();
}

function atual() {
  return { tarefas: estado.tarefas, erro: estado.erro, atualizadoEm: estado.atualizadoEm, tem: estado.tem };
}

module.exports = { iniciar, busca, atual, concluir, aoMudar: (cb) => { aoMudar = cb; } };
