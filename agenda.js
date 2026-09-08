// Agenda — compromissos do Google Calendar, lidos pelo endereço secreto em
// formato iCal.
//
// Por que iCal e não a API oficial: o painel fica aceso sozinho num monitor
// vertical. OAuth exige consentimento em navegador e refresh token que expira
// quando a conta muda de senha — no dia em que expirasse, a agenda ficaria
// muda esperando alguém que não está na frente da máquina. O endereço secreto
// é uma URL só, de leitura, que o Google renova apenas se o Alexandre pedir.
//
// A URL é um segredo (quem tiver ela lê a agenda inteira), então mora no
// userData do app — nunca no repositório. Cifrada com safeStorage quando existe
// keyring; onde não existe, num arquivo 0600 do mesmo diretório (ver `gravaUrl`).
//
// O último retrato bom fica em cache no disco: rede caída mostra a agenda de
// ontem com o aviso de quando foi lida, em vez de célula vazia.

const fs = require('fs');
const path = require('path');

const INTERVALO_MS = 15 * 60 * 1000;   // varredura
const JANELA_DIAS = 45;                // até onde expandir repetição
const MAX_EVENTOS = 60;

let deps = null;                       // { app, safeStorage, log }
let estado = {
  eventos: [],
  erro: null,
  atualizadoEm: null,
  temUrl: false
};
let timer = null;
let buscando = false;

function log(msg) {
  if (deps && deps.log) deps.log('agenda: ' + msg);
}

// ------------------------------------------------------------------ segredo

function arqUrl() {
  return path.join(deps.app.getPath('userData'), 'agenda-url.bin');
}

// Onde a URL fica quando não há keyring. Mesmo diretório do resto: dentro da
// /home dele, sem depender de flag de linha de comando para ser lida de volta.
function arqUrlTexto() {
  return path.join(deps.app.getPath('userData'), 'agenda-url.txt');
}

function arqCache() {
  return path.join(deps.app.getPath('userData'), 'agenda-cache.json');
}

function leUrl() {
  try {
    if (deps.safeStorage.isEncryptionAvailable() && fs.existsSync(arqUrl())) {
      return deps.safeStorage.decryptString(fs.readFileSync(arqUrl()));
    }
  } catch (e) {}
  try {
    return fs.readFileSync(arqUrlTexto(), 'utf8').trim();
  } catch (e) {
    return '';
  }
}

// Esta máquina não tem Secret Service no DBus (sem gnome-keyring, sem kwallet),
// e recusar a gravação deixava a agenda desligada para sempre — que é pior do
// que guardar o endereço num arquivo só dele. Então: cifra quando dá, e quando
// não dá, arquivo 0600 no userData. A proteção real vira a permissão do
// arquivo; quem já lê a /home dele também lê o resto do painel de qualquer
// jeito. Ligar um keyring depois não quebra nada: a próxima gravação passa a
// usar o .bin e o .txt é apagado.
function gravaUrl(url) {
  if (!url) {
    try { fs.unlinkSync(arqUrl()); } catch (e) {}
    try { fs.unlinkSync(arqUrlTexto()); } catch (e) {}
    return;
  }
  if (deps.safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(arqUrl(), deps.safeStorage.encryptString(url));
    try { fs.unlinkSync(arqUrlTexto()); } catch (e) {}
    return;
  }
  fs.writeFileSync(arqUrlTexto(), url + '\n', { mode: 0o600 });
  try { fs.chmodSync(arqUrlTexto(), 0o600); } catch (e) {}
  log('sem keyring no sistema — endereço guardado em arquivo 0600 no userData');
}

// O Google entrega o endereço secreto em três formatos e o painel aceita todos:
// .ics direto, webcal:// (o mesmo endereço com outro esquema) e a URL do
// "Incorporar" — desta última dá para tirar o calendar id.
function normalizaUrl(bruta) {
  let u = String(bruta || '').trim();
  if (!u) return '';
  u = u.replace(/^webcal:\/\//i, 'https://');
  if (!/^https:\/\//i.test(u)) throw new Error('a URL precisa começar com https:// ou webcal://');
  if (!/calendar\.google\.com/i.test(u)) throw new Error('não parece um endereço do Google Calendar');
  return u;
}

// ------------------------------------------------------- leitura do formato

// Linha dobrada do iCal continua na seguinte com um espaço ou tab na frente.
// Sem desdobrar, todo SUMMARY comprido chega cortado.
function desdobra(texto) {
  return texto.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function desescapa(v) {
  return String(v || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

// Uma linha do iCal é NOME;PARAM=VALOR;PARAM=VALOR:conteúdo. O primeiro ':'
// fora de aspas separa; dentro de aspas ele é conteúdo de parâmetro.
function separaLinha(linha) {
  let fim = -1;
  let entreAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') entreAspas = !entreAspas;
    else if (c === ':' && !entreAspas) { fim = i; break; }
  }
  if (fim < 0) return null;
  const cabeca = linha.slice(0, fim);
  const valor = linha.slice(fim + 1);
  const partes = cabeca.split(';');
  const params = {};
  for (const p of partes.slice(1)) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { nome: partes[0].toUpperCase(), params, valor };
}

// ----------------------------------------------------------------- fuso

// Converte um horário "solto" (sem fuso na string) para o instante real,
// interpretando-o na zona pedida. O truque é formatar um palpite naquela zona e
// medir o quanto ele errou: a diferença é o deslocamento daquele instante, que
// já vem com horário de verão aplicado.
function deslocamentoDaZona(instante, zona) {
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const p = Object.fromEntries(f.formatToParts(instante).map(x => [x.type, x.value]));
    const comoSeFosseUtc = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour === '24' ? '0' : p.hour), Number(p.minute), Number(p.second)
    );
    return comoSeFosseUtc - instante.getTime();
  } catch (e) {
    return 0;
  }
}

function naZona(partes, zona) {
  const palpiteUtc = Date.UTC(partes[0], partes[1] - 1, partes[2], partes[3], partes[4], partes[5]);
  if (!zona) {
    // Sem TZID e sem 'Z': é hora local da máquina, que é o que o Google manda
    // quando o calendário não tem fuso declarado.
    return new Date(partes[0], partes[1] - 1, partes[2], partes[3], partes[4], partes[5]);
  }
  // Duas passadas: a primeira acerta o instante, a segunda corrige a virada de
  // horário de verão que a primeira possa ter atravessado.
  let d = new Date(palpiteUtc - deslocamentoDaZona(new Date(palpiteUtc), zona));
  d = new Date(palpiteUtc - deslocamentoDaZona(d, zona));
  return d;
}

// DTSTART aparece em três formas: data pura (dia inteiro), hora local com TZID,
// e hora em UTC terminada em Z.
function leData(valor, params) {
  const v = String(valor || '').trim();
  const soData = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (soData || (params && params.VALUE === 'DATE')) {
    const m = soData || v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    // Dia inteiro começa à meia-noite local: é assim que ele lê na tela.
    return { data: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), diaInteiro: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const partes = [1, 2, 3, 4, 5, 6].map(i => Number(m[i]));
  if (m[7]) {
    return { data: new Date(Date.UTC(partes[0], partes[1] - 1, partes[2], partes[3], partes[4], partes[5])), diaInteiro: false };
  }
  return { data: naZona(partes, params && params.TZID), diaInteiro: false };
}

// ------------------------------------------------------------- repetição

const DIAS_RRULE = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function leRrule(valor) {
  const r = {};
  for (const par of String(valor || '').split(';')) {
    const eq = par.indexOf('=');
    if (eq < 0) continue;
    r[par.slice(0, eq).toUpperCase()] = par.slice(eq + 1);
  }
  return r;
}

function somaMeses(d, n) {
  const alvo = new Date(d.getTime());
  const dia = alvo.getDate();
  alvo.setDate(1);
  alvo.setMonth(alvo.getMonth() + n);
  // 31 de janeiro + 1 mês não existe: cai no último dia de fevereiro, que é o
  // que o Google também faz.
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(dia, ultimo));
  return alvo;
}

// Expande a repetição dentro da janela. Suporta o que aparece numa agenda
// pessoal: FREQ diária/semanal/mensal/anual, INTERVAL, BYDAY na semanal, COUNT,
// UNTIL e EXDATE. Regra mais exótica que isso cai no evento único — melhor
// mostrar a primeira ocorrência do que inventar as outras.
function expandeRepeticao(inicio, fim, rrule, exdatas, deAte) {
  const [de, ate] = deAte;
  const r = leRrule(rrule);
  const freq = String(r.FREQ || '').toUpperCase();
  if (!freq) return [];

  const passo = Math.max(1, Number(r.INTERVAL) || 1);
  const limiteCount = Number(r.COUNT) || 0;
  const limiteUntil = r.UNTIL ? (leData(r.UNTIL, {}) || {}).data : null;
  const duracao = fim ? fim.getTime() - inicio.getTime() : 0;
  const pulados = new Set(exdatas.map(d => d.getTime()));

  const byday = String(r.BYDAY || '')
    .split(',')
    .map(s => DIAS_RRULE[s.replace(/^[-+]?\d+/, '').toUpperCase()])
    .filter(n => n != null);

  const saida = [];
  let contadas = 0;
  let cursor = new Date(inicio.getTime());
  // Teto de segurança: agenda com repetição diária de anos atrás não pode
  // travar o painel num laço.
  for (let volta = 0; volta < 4000; volta++) {
    if (cursor.getTime() > ate) break;
    if (limiteUntil && cursor.getTime() > limiteUntil.getTime()) break;

    // Semanal com BYDAY: cada volta é uma semana, e dentro dela saem os dias
    // marcados.
    const candidatos = [];
    if (freq === 'WEEKLY' && byday.length) {
      const domingo = new Date(cursor.getTime());
      domingo.setDate(domingo.getDate() - domingo.getDay());
      for (const d of byday) {
        const q = new Date(domingo.getTime());
        q.setDate(domingo.getDate() + d);
        q.setHours(inicio.getHours(), inicio.getMinutes(), inicio.getSeconds(), 0);
        if (q.getTime() >= inicio.getTime()) candidatos.push(q);
      }
      candidatos.sort((a, b) => a - b);
    } else {
      candidatos.push(new Date(cursor.getTime()));
    }

    for (const q of candidatos) {
      if (limiteUntil && q.getTime() > limiteUntil.getTime()) continue;
      if (pulados.has(q.getTime())) continue;
      contadas++;
      if (limiteCount && contadas > limiteCount) return saida;
      if (q.getTime() >= de && q.getTime() <= ate) {
        saida.push({ inicio: q, fim: duracao ? new Date(q.getTime() + duracao) : null });
      }
      if (saida.length >= MAX_EVENTOS) return saida;
    }

    if (freq === 'DAILY') cursor.setDate(cursor.getDate() + passo);
    else if (freq === 'WEEKLY') cursor.setDate(cursor.getDate() + 7 * passo);
    else if (freq === 'MONTHLY') cursor = somaMeses(cursor, passo);
    else if (freq === 'YEARLY') cursor = somaMeses(cursor, 12 * passo);
    else break;
  }
  return saida;
}

// --------------------------------------------------------------- o arquivo

function leIcs(texto, agora) {
  const linhas = desdobra(texto).split('\n');
  const de = agora.getTime() - 12 * 60 * 60 * 1000;             // hoje mais cedo ainda conta
  const ate = agora.getTime() + JANELA_DIAS * 24 * 60 * 60 * 1000;
  const eventos = [];

  let atual = null;
  for (const linha of linhas) {
    const t = linha.trim();
    if (t === 'BEGIN:VEVENT') { atual = { exdatas: [] }; continue; }
    if (t === 'END:VEVENT') {
      if (atual) empilha(atual, eventos, de, ate);
      atual = null;
      continue;
    }
    if (!atual) continue;

    const p = separaLinha(linha);
    if (!p) continue;
    if (p.nome === 'DTSTART') atual.inicio = leData(p.valor, p.params);
    else if (p.nome === 'DTEND') atual.fim = leData(p.valor, p.params);
    else if (p.nome === 'SUMMARY') atual.titulo = desescapa(p.valor);
    else if (p.nome === 'LOCATION') atual.local = desescapa(p.valor);
    else if (p.nome === 'RRULE') atual.rrule = p.valor;
    else if (p.nome === 'STATUS') atual.status = p.valor.trim().toUpperCase();
    else if (p.nome === 'EXDATE') {
      for (const v of p.valor.split(',')) {
        const d = leData(v, p.params);
        if (d) atual.exdatas.push(d.data);
      }
    }
  }

  // `inicio` já é string ISO aqui: subtrair string dá NaN e o sort vira
  // no-op — a repetição sairia toda depois dos eventos únicos.
  eventos.sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));
  return eventos.slice(0, MAX_EVENTOS);
}

function empilha(ev, saida, de, ate) {
  if (!ev.inicio || !ev.inicio.data) return;
  if (ev.status === 'CANCELLED') return;

  const base = {
    titulo: ev.titulo || '(sem título)',
    local: ev.local || '',
    diaInteiro: ev.inicio.diaInteiro
  };

  if (ev.rrule) {
    const oc = expandeRepeticao(
      ev.inicio.data,
      ev.fim ? ev.fim.data : null,
      ev.rrule,
      ev.exdatas,
      [de, ate]
    );
    for (const o of oc) {
      saida.push(Object.assign({}, base, {
        inicio: o.inicio.toISOString(),
        fim: o.fim ? o.fim.toISOString() : null,
        repete: true
      }));
    }
    return;
  }

  const t = ev.inicio.data.getTime();
  if (t < de || t > ate) return;
  saida.push(Object.assign({}, base, {
    inicio: ev.inicio.data.toISOString(),
    fim: ev.fim && ev.fim.data ? ev.fim.data.toISOString() : null,
    repete: false
  }));
}

// ------------------------------------------------------------------- cache

function gravaCache() {
  try {
    fs.writeFileSync(arqCache(), JSON.stringify({
      eventos: estado.eventos,
      atualizadoEm: estado.atualizadoEm
    }));
  } catch (e) {}
}

function leCache() {
  try {
    const c = JSON.parse(fs.readFileSync(arqCache(), 'utf8'));
    if (Array.isArray(c.eventos)) {
      estado.eventos = c.eventos;
      estado.atualizadoEm = c.atualizadoEm || null;
    }
  } catch (e) {}
}

// ------------------------------------------------------------------ busca

async function busca() {
  if (buscando) return estado;
  const url = leUrl();
  estado.temUrl = !!url;
  if (!url) {
    estado.erro = null;
    return estado;
  }

  buscando = true;
  const ctrl = new AbortController();
  const prazo = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const texto = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(texto)) throw new Error('a resposta não é um calendário iCal');
    estado.eventos = leIcs(texto, new Date());
    estado.atualizadoEm = new Date().toISOString();
    estado.erro = null;
    gravaCache();
    log(estado.eventos.length + ' compromisso(s) na janela de ' + JANELA_DIAS + ' dias');
  } catch (err) {
    // Erro não apaga o que já está na tela: o cache continua valendo, com a
    // hora da última leitura boa ao lado.
    estado.erro = err.name === 'AbortError' ? 'tempo esgotado' : err.message;
    log('falhou: ' + estado.erro);
  } finally {
    clearTimeout(prazo);
    buscando = false;
  }
  return estado;
}

// -------------------------------------------------------------------- API

function iniciar(d) {
  deps = d;
  leCache();
  estado.temUrl = !!leUrl();
  busca();
  timer = setInterval(busca, INTERVALO_MS);
  timer.unref();
}

function atual() {
  return {
    eventos: estado.eventos,
    erro: estado.erro,
    atualizadoEm: estado.atualizadoEm,
    temUrl: estado.temUrl
  };
}

async function forcar() {
  await busca();
  return atual();
}

async function definirUrl(bruta) {
  try {
    const url = normalizaUrl(bruta);
    gravaUrl(url);
    estado.temUrl = !!url;
    if (!url) {
      estado.eventos = [];
      estado.atualizadoEm = null;
      gravaCache();
      return { ok: true, temUrl: false };
    }
    await busca();
    if (estado.erro) return { ok: false, error: estado.erro };
    return { ok: true, temUrl: true, total: estado.eventos.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Só diz se existe e como termina: a URL inteira é a chave do calendário e não
// volta para a tela nem para o log.
function pistaUrl() {
  const u = leUrl();
  if (!u) return '';
  const m = u.match(/\/ical\/([^/]+)\//);
  const id = m ? decodeURIComponent(m[1]) : u;
  return id.length > 28 ? id.slice(0, 14) + '…' + id.slice(-10) : id;
}

module.exports = { iniciar, atual, forcar, definirUrl, pistaUrl };
