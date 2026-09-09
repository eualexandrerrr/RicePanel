// Próximo jogo do Flamengo.
//
// A fonte é a API pública de placar do ESPN — a mesma que o MeuMengaoApp usa
// (`src/services/api.ts`, time 819). Ela não pede chave, não tem cota publicada
// e devolve JSON pronto; por isso aqui não existe segredo para guardar. O app
// do celular só precisa de chave para a API-Sports (foto de jogador), que este
// painel não usa.
//
// O ESPN não tem endpoint de "todos os jogos do time": a agenda é por
// competição. Então perguntamos as quatro que interessam e ficamos com o jogo
// mais próximo entre elas.
//
// Cache em disco pelo mesmo motivo da agenda: internet caída mostra o jogo que
// já sabíamos, com a hora da última leitura, em vez de placa vazia.

const fs = require('fs');
const path = require('path');

const TIME = '819';                       // Flamengo no ESPN
const COMPETICOES = [
  { slug: 'bra.1', nome: 'Brasileirão' },
  { slug: 'bra.camp.carioca', nome: 'Carioca' },
  { slug: 'conmebol.libertadores', nome: 'Libertadores' },
  { slug: 'bra.copa_do_brazil', nome: 'Copa do Brasil' }
];

const INTERVALO_MS = 10 * 60 * 1000;      // parado
const INTERVALO_VIVO_MS = 60 * 1000;      // com jogo rolando
const PRAZO_MS = 12000;

let deps = null;                          // { app, log }
let estado = { jogo: null, erro: null, atualizadoEm: null };
let timer = null;
let buscando = false;

function log(msg) {
  if (deps && deps.log) deps.log('flamengo: ' + msg);
}

function arqCache() {
  return path.join(deps.app.getPath('userData'), 'flamengo-cache.json');
}

// Os escudos vinham direto do servidor do ESPN a cada pintura. No boot da
// máquina o painel sobe antes da rede: as duas imagens falhavam, o Chromium
// marcava como quebradas e ninguém pedia de novo — ficavam os dois quadradinhos
// rasgados até alguém reiniciar o app. Agora a imagem é baixada uma vez e vive
// no disco, junto do cache do jogo. Sem rede, o escudo de ontem serve.
function pastaEscudos() {
  const p = path.join(deps.app.getPath('userData'), 'escudos');
  try { fs.mkdirSync(p, { recursive: true }); } catch (e) {}
  return p;
}

async function guardaEscudo(url, idTime) {
  if (!url || !idTime) return '';
  const ext = (String(url).match(/\.(png|jpg|jpeg|webp|svg)(\?|$)/i) || [])[1] || 'png';
  const destino = path.join(pastaEscudos(), String(idTime) + '.' + ext.toLowerCase());
  try {
    // Um escudo não muda: se já está no disco, acabou.
    if (fs.statSync(destino).size > 0) return destino;
  } catch (e) {}
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(PRAZO_MS) : undefined });
    if (!r.ok) return '';
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return '';
    fs.writeFileSync(destino, buf);
    return destino;
  } catch (e) {
    return '';
  }
}

function leCache() {
  try {
    const c = JSON.parse(fs.readFileSync(arqCache(), 'utf8'));
    if (c && c.jogo) estado = { jogo: c.jogo, erro: null, atualizadoEm: c.atualizadoEm || null };
  } catch (e) {}
}

function gravaCache() {
  try {
    fs.writeFileSync(arqCache(), JSON.stringify({
      jogo: estado.jogo, atualizadoEm: estado.atualizadoEm
    }));
  } catch (e) {}
}

// --------------------------------------------------------------- leitura

async function pegaJson(url) {
  const corta = AbortSignal.timeout ? AbortSignal.timeout(PRAZO_MS) : undefined;
  const r = await fetch(url, { signal: corta, headers: { 'accept': 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// Um competidor do ESPN vira o mínimo que a placa desenha: nome curto para o
// texto, sigla para quando não couber, escudo para o olho reconhecer antes de
// ler.
function lado(c) {
  const t = (c && c.team) || {};
  const logos = t.logos || [];
  return {
    id: t.id || '',
    nome: t.shortDisplayName || t.displayName || t.name || '',
    nomeLongo: t.displayName || t.shortDisplayName || '',
    sigla: t.abbreviation || '',
    escudo: (logos[0] && logos[0].href) || t.logo || '',
    placar: c && c.score != null ? Number(c.score) : null
  };
}

function converte(ev, competicao) {
  const comp = (ev.competitions || [])[0];
  if (!comp) return null;
  const times = comp.competitors || [];
  const casa = times.find(c => c.homeAway === 'home');
  const fora = times.find(c => c.homeAway === 'away');
  if (!casa || !fora) return null;
  const quando = new Date(ev.date);
  if (!Number.isFinite(quando.getTime())) return null;
  const estadoJogo = ((comp.status || {}).type || {}).state || 'pre';
  return {
    id: ev.id || '',
    quando: quando.toISOString(),
    competicao,
    estado: estadoJogo,                       // pre | in | post
    casa: lado(casa),
    fora: lado(fora),
    // O mando importa: "no Maracanã" e "fora" mudam o humor da placa.
    mandante: casa.team && casa.team.id === TIME,
    local: ((comp.venue || {}).fullName) || '',
    cidade: (((comp.venue || {}).address) || {}).city || ''
  };
}

async function daCompeticao(c) {
  const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/' +
    c.slug + '/teams/' + TIME + '/schedule?fixture=true';
  try {
    const d = await pegaJson(url);
    return (d.events || []).map(ev => converte(ev, c.nome)).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// O jogo que interessa é: o que está rolando agora; senão o primeiro que ainda
// não começou. Jogo encerrado só entra na conta até uma hora depois do apito,
// para a placa não trocar de assunto enquanto ele ainda comenta o resultado.
function escolhe(jogos) {
  const agora = Date.now();
  const vivo = jogos.find(j => j.estado === 'in');
  if (vivo) return vivo;

  const futuros = jogos
    .filter(j => j.estado === 'pre' && new Date(j.quando).getTime() > agora - 2 * 3600e3)
    .sort((a, b) => new Date(a.quando) - new Date(b.quando));
  if (futuros.length) return futuros[0];

  const recentes = jogos
    .filter(j => j.estado === 'post' && agora - new Date(j.quando).getTime() < 3 * 3600e3)
    .sort((a, b) => new Date(b.quando) - new Date(a.quando));
  return recentes[0] || null;
}

async function busca() {
  if (buscando) return;
  buscando = true;
  try {
    const listas = await Promise.all(COMPETICOES.map(daCompeticao));
    const jogos = [].concat.apply([], listas);
    if (!jogos.length) {
      estado.erro = 'sem resposta do ESPN';
      log('nenhuma competição respondeu; fica o que estava em cache');
      return;
    }
    const escolhido = escolhe(jogos);
    if (escolhido) {
      for (const lado of ['casa', 'fora']) {
        const t = escolhido[lado];
        t.escudoLocal = await guardaEscudo(t.escudo, t.id);
      }
    }
    estado = { jogo: escolhido, erro: null, atualizadoEm: new Date().toISOString() };
    gravaCache();
    log(escolhido
      ? 'próximo: ' + escolhido.casa.nome + ' x ' + escolhido.fora.nome +
        ' (' + escolhido.competicao + ', ' + escolhido.quando + ')'
      : 'nenhum jogo marcado nas competições consultadas');
  } catch (e) {
    estado.erro = e.message;
  } finally {
    buscando = false;
    reagenda();
  }
}

// Com jogo rolando a placa vale um minuto; parada, dez. É a mesma ideia do
// app do celular, sem o cache de 30 s: aqui ninguém está olhando o placar ao
// vivo, só passando o olho na parede.
function reagenda() {
  const vivo = estado.jogo && estado.jogo.estado === 'in';
  const ms = vivo ? INTERVALO_VIVO_MS : INTERVALO_MS;
  if (timer) clearTimeout(timer);
  timer = setTimeout(busca, ms);
  if (timer.unref) timer.unref();
}

function iniciar(d) {
  deps = d;
  leCache();
  busca();
}

function atual() {
  return estado;
}

async function forcar() {
  if (timer) clearTimeout(timer);
  await busca();
  return atual();
}

module.exports = { iniciar, atual, forcar };
