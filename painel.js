// Painel da Mesa — renderer.
//
// Três barramentos (Servidores, Dev, Monitor). Só um ocupa o palco; a barra
// fina de baixo e a cota crítica da travessa valem em qualquer um deles.

const LIMIAR_TOPO = 70;      // abaixo disso o limite nem aparece na travessa

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

function haQuanto(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  return Math.floor(s / 86400) + ' d';
}

function icone(nome) { return '<svg viewBox="0 0 16 16"><use href="#ic-' + nome + '"/></svg>'; }

// Data absoluta para a janela: "há 3 d" serve para bater o olho na barra, mas
// quando ele abre para ler quer saber o dia e a hora.
function fmtDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Dia e hora do jeito que ele lê: hoje e ontem por nome, o resto por dia e mês
// escrito. "26/08 13:20" obrigava a converter data em cabeça.
function fmtQuando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86400000);
  const mesmo = (a, b) => a.toDateString() === b.toDateString();
  if (mesmo(d, hoje)) return 'Hoje · ' + hora;
  if (mesmo(d, ontem)) return 'Ontem · ' + hora;
  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  return dia + ' · ' + hora;
}

// De qual lado do projeto veio o erro. 'javascript' começa com 'java': a ordem
// dos testes aqui é o que impede o erro de web virar erro de back-end.
function marcaPlataforma(p, titulo) {
  // O campo platform do Sentry e do PROJETO: num app React Native ele vem
  // "java" tanto no crash de Android quanto no de iPhone. Quando o titulo
  // entrega a origem (NSInvalidArgument, java.lang, EXC_), ele manda.
  const tt = String(titulo || '');
  if (/^(NS|EXC_|SIG|\*\*\*)/.test(tt) || /Objective-C|Swift|UIKit|CoreFoundation/i.test(tt)) return 'apple';
  if (/java\.lang|android\.|androidx\.|ANR\b/i.test(tt)) return 'android';
  const t = String(p || '').toLowerCase();
  if (t.indexOf('android') >= 0) return 'android';
  if (t.indexOf('apple') >= 0 || t.indexOf('cocoa') >= 0 || t.indexOf('ios') >= 0 || t.indexOf('swift') >= 0) return 'apple';
  if (t.indexOf('react') >= 0 || t.indexOf('flutter') >= 0) return 'atomo';
  if (t.indexOf('javascript') >= 0 || t.indexOf('node') >= 0 || t.indexOf('typescript') >= 0 ||
      t.indexOf('php') >= 0 || t.indexOf('python') >= 0 || t.indexOf('ruby') >= 0) return 'codigo';
  if (t.indexOf('java') === 0 || t.indexOf('kotlin') >= 0) return 'java';
  return 'cubo';
}

function fmtRestante(ms) {
  // resets_at ausente ou ilegível vinha como NaN e a travessa mostrava
  // "NaN:NaNm". Sem número é melhor do que número quebrado.
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const t = Math.floor(ms / 1000);
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60), s = t % 60;
  const pad = n => String(n).padStart(2, '0');
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + pad(m) + 'm';
  return pad(m) + ':' + pad(s);
}

document.getElementById('closeBtn').addEventListener('click', () => window.api.closeApp());

// ---------------------------------------------------------------- barramento
//
// Um barramento só, com os quatro destinos. Antes eram dois níveis (páginas em
// cima, modos embaixo) e isso custava dois cliques para sair do Mirante e
// escolher um console, além de mudar o conteúdo da barra de baixo conforme a
// página. Barra que muda de forma não vira músculo.
let modoAtual = 'mirante';

function trocaModo(modo) {
  modoAtual = modo;
  const noMirante = modo === 'mirante';
  document.querySelectorAll('.tecla').forEach(t => t.classList.toggle('on', t.dataset.modo === modo));
  document.querySelectorAll('.modo').forEach(s => s.classList.remove('on'));
  document.getElementById('modo' + modo.charAt(0).toUpperCase() + modo.slice(1)).classList.add('on');
  document.body.classList.toggle('em-mirante', noMirante);
  try { localStorage.setItem('modo', modo); } catch (e) {}
  garanteModuloEmCasa();
  posicionaBarra(modo);
  // A janela do emulador é do Hyprland, não do painel: ela não some sozinha
  // quando o barramento muda. Some/reaparece junto com o modo Dev.
  window.api.devMostrar(modo === 'dev');
  if (modo === 'dev') setTimeout(encaixaEmulador, 250);
  // Os widgets param de desenhar quando a página sai da frente: animação em
  // section com display:none continua custando quadro.
  if (window.mirante) window.mirante.acorda(noMirante);
}

// A barra de estado é uma só. No barramento Servidores ela se muda para entre
// os dois terminais (que é onde ele olha); nos outros volta para o pé do app.
function posicionaBarra(modo) {
  const barra = document.querySelector('.rodape');
  const meio = document.getElementById('faixaMeio');
  if (!barra || !meio) return;
  if (modo === 'servidores') {
    if (barra.parentElement !== meio) meio.appendChild(barra);
    document.body.classList.add('faixa-no-meio');
  } else {
    if (barra.parentElement !== document.body) document.body.appendChild(barra);
    document.body.classList.remove('faixa-no-meio');
  }
}

document.getElementById('barramento').addEventListener('click', (e) => {
  const t = e.target.closest('.tecla');
  if (t) trocaModo(t.dataset.modo);
});


// Clicar num indicador abre a lista numa janela de 60% da tela, por cima do que
// ele estava fazendo. Trocar de barramento tirava os consoles da frente inteira
// só para consultar quatro linhas.
//
// O módulo é MOVIDO para dentro da janela e devolvido ao fechar: é o mesmo nó do
// barramento Monitor, então continua sendo atualizado pelo mesmo código.
const janela = document.getElementById('janelaLista');
let moduloNaJanela = null;

function abreJanelaLista(moduloId, titulo) {
  const modulo = document.getElementById(moduloId);
  if (!modulo) return;
  moduloNaJanela = { modulo: modulo, pai: modulo.parentElement, proximo: modulo.nextElementSibling };
  document.getElementById('janelaTitulo').textContent = titulo;
  document.getElementById('janelaCorpo').appendChild(modulo);
  abre(janela);
}

function fechaJanelaLista() {
  fecha(janela);
  if (!moduloNaJanela) return;
  const { modulo, pai, proximo } = moduloNaJanela;
  pai.insertBefore(modulo, proximo);
  moduloNaJanela = null;
}

document.getElementById('indSentry').addEventListener('click', () => {
  abreJanelaLista('blocoSentry', 'Erros em aberto');
  buscaVitimas();
});
document.getElementById('indDiscord').addEventListener('click', () =>
  abreJanelaLista('blocoDiscord', 'Anotações sem reação'));
document.getElementById('janelaFechar').addEventListener('click', fechaJanelaLista);
janela.addEventListener('click', (e) => { if (e.target === janela) fechaJanelaLista(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && janela.classList.contains('on')) fechaJanelaLista();
});

// Entrar no barramento Monitor com a janela aberta deixaria o módulo preso
// dentro dela e o Monitor com um buraco.
function garanteModuloEmCasa() { if (moduloNaJanela) fechaJanelaLista(); }

// ---------------------------------------------------------------- servidores
let servidores = [];

function urlDe(s) { return 'http://' + s.host + ':' + s.porta + '/server/console'; }

// Local é o que aponta para esta máquina; o resto é produção com gente dentro.
function ehLocal(s) {
  return /^(localhost|127\.0\.0\.1|::1|0\.0\.0\.0)$/i.test(String(s.host || '').trim());
}

function pintaServidores() {
  servidores.forEach((s, i) => {
    const local = ehLocal(s);
    const selo = document.getElementById('selo' + i);
    selo.textContent = local ? 'Local' : 'Remoto';
    selo.className = 'selo ' + (local ? 'local' : 'remoto');
    // O selo já diz remoto/local; repetir "Servidor remoto" ao lado só
    // espremia o cabeçalho e quebrava em duas linhas.
    document.getElementById('nome' + i).textContent = '';
    const dest = document.getElementById('dest' + i);
    dest.textContent = s.host + ':' + s.porta;
    dest.className = 'destino' + (local ? '' : ' remoto');
  });
}

// A fonte do Live Console é xterm desenhando em canvas: CSS não alcança. O que
// alcança é o zoom do webview — que aumenta o console inteiro, inclusive a
// barra de comando.
//
// Padrão 100%: acima disso o xterm reflui com menos colunas e a linha quebra no
// meio da palavra ("milliseco / nds"). Quem decide o quanto vale a pena é ele,
// nos botões — e o nível fica escrito ao lado para os dois consoles nunca
// ficarem em tamanhos diferentes sem ele perceber.
const ZOOM_PADRAO = 0.8;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.6;

function zoomGuardado(i) {
  try {
    const z = Number(localStorage.getItem('zoom' + i));
    if (z >= ZOOM_MIN && z <= ZOOM_MAX) return z;
  } catch (e) {}
  return ZOOM_PADRAO;
}

function aplicaZoom(i, z) {
  const limite = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) * 100) / 100;
  document.getElementById('wv' + i).setZoomFactor(limite);
  try { localStorage.setItem('zoom' + i, String(limite)); } catch (e) {}
  const marca = document.getElementById('zoomNivel' + i);
  if (marca) {
    marca.textContent = Math.round(limite * 100) + '%';
    marca.classList.toggle('fora-do-padrao', limite !== ZOOM_PADRAO);
  }
  return limite;
}

document.querySelectorAll('[data-zoom]').forEach(b => {
  b.addEventListener('click', () => {
    const i = Number(b.dataset.zoom);
    aplicaZoom(i, zoomGuardado(i) + (Number(b.dataset.passo) * 0.1));
  });
});

// Clique no nível volta os dois para 100% de uma vez.
document.querySelectorAll('.zoom-nivel').forEach(m => {
  m.addEventListener('click', () => { aplicaZoom(0, ZOOM_PADRAO); aplicaZoom(1, ZOOM_PADRAO); });
});

function carregaTelas() {
  servidores.forEach((s, i) => {
    const wv = document.getElementById('wv' + i);
    const alvo = urlDe(s);
    if (wv.getAttribute('src') !== alvo) wv.setAttribute('src', alvo);
  });
}

// Mantém os dois consoles logados. A sessão do txAdmin expira; em vez de o
// painel virar duas telas de login, ele repõe o login sozinho.
//
// O campo é de um app React: atribuir .value direto não avisa o React e o botão
// continua achando que o campo está vazio. Daí o setter nativo do prototype.
function roteiroLogin(cred) {
  return '(() => {' +
    'const alvo = ' + JSON.stringify({ u: cred.user, p: cred.pass }) + ';' +
    'if (window.__mesaEntrando) return "ja";' +
    'window.__mesaEntrando = true;' +
    'const poe = (el, v) => {' +
      'const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;' +
      'set.call(el, v);' +
      'el.dispatchEvent(new Event("input", { bubbles: true }));' +
      'el.dispatchEvent(new Event("change", { bubbles: true }));' +
    '};' +
    'let voltas = 0;' +
    'const t = setInterval(() => {' +
      'if (++voltas > 30) { clearInterval(t); window.__mesaEntrando = false; return; }' +
      'const senha = document.querySelector("input[type=password]");' +
      'if (!senha) return;' +
      'const form = senha.closest("form") || document.body;' +
      'const usuario = Array.from(form.querySelectorAll("input")).find(i => i !== senha && i.type !== "hidden");' +
      'if (!usuario) return;' +
      'clearInterval(t);' +
      'poe(usuario, alvo.u);' +
      'poe(senha, alvo.p);' +
      'setTimeout(() => {' +
        'const bts = Array.from(form.querySelectorAll("button, input[type=submit]"));' +
        'const texto = b => (b.textContent || b.value || "").trim();' +
        'const entrar = bts.find(b => /^login$/i.test(texto(b))) ||' +
          'bts.find(b => /login|entrar/i.test(texto(b)) && !/cfx/i.test(texto(b)));' +
        'if (entrar) entrar.click();' +
        'else if (form.requestSubmit) form.requestSubmit();' +
      '}, 150);' +
    '}, 500);' +
    'return "tentando";' +
  '})()';
}

// O txAdmin traz barra de cima, menu lateral e cartão de status. Num painel que
// já mostra estado por conta própria isso é moldura ocupando o log.
//
// Esconder, e não "mostrar só o console": se o txAdmin mudar de estrutura, a
// falha é o menu reaparecer — nunca o console sumir.
const CSS_SO_CONSOLE = [
  ':root { --page-pt: 0px !important; --page-pb: 0px !important; }',
  'header.sticky { display: none !important; }',
  'aside.tx-sidebar { display: none !important; }',
  '#root > div { padding-left: 0 !important; padding-right: 0 !important; gap: 0 !important; }',
  'main { min-width: 0 !important; }',
  'main > div { border: 0 !important; border-radius: 0 !important; height: 100vh !important; }',
  '.h-contentvh { height: 100vh !important; }',
  '.min-h-contentvh { min-height: 100vh !important; }',
  // A faixa "Live Console" com o selo NEW e a engrenagem: o painel já diz de
  // qual servidor é o log, e o rótulo só come altura do que interessa. Não há
  // classe própria para mirar, então o alvo é a forma — a barra do topo do main
  // é a única com um <p class="font-mono"> dois níveis abaixo dela.
  'main div.border-b:has(> div > div > p.font-mono) { display: none !important; }'
].join(' ');

// A barra lateral do txAdmin é a MESMA peça que o painel esconde para o console
// ocupar a tela inteira: nela moram o cartão de estado, os botões do servidor e
// a lista de quem está online. Clicar na contagem de jogadores traz essa barra
// de volta, por cima do log, e ali dentro tudo é o txAdmin de verdade — clicar
// num nome abre o diálogo dele, com kick, aviso, ban e histórico.
//
// Por cima, e não empurrando o console: o log do txAdmin é canvas do xterm, que
// refaz o atlas de glifos a cada mudança de largura. Reservar espaço faria o
// terminal remontar toda vez que a lista abre e fecha.
//
// O aside é `hidden xl:flex` no txAdmin: em 1080px de painel ele nunca apareceria
// sozinho, nem sem o `display:none` que o painel injeta.
const CSS_LISTA_JOGADORES = [
  'aside.tx-sidebar {',
  '  display: flex !important;',
  '  position: fixed !important;',
  '  top: 0 !important; right: 0 !important;',
  '  width: 320px !important; max-width: 60vw !important;',
  '  height: 100vh !important;',
  '  z-index: 40 !important;',
  '  padding: 8px !important; gap: 8px !important;',
  '  overflow-y: auto !important;',
  '  background: #16181c;',
  '  background: hsl(var(--card, 224 10% 10%)) !important;',
  '  border-left: 1px solid hsl(var(--border, 224 10% 20%)) !important;',
  '  box-shadow: -14px 0 28px rgba(0, 0, 0, 0.5) !important;',
  '}'
].join(' ');

// O X mora DENTRO do webview, e não no painel: elemento do painel posto por
// cima do <webview> não aparece — o guest compõe acima do documento hospedeiro,
// e o botão ficava desenhado atrás do console. Dentro do guest ele é irmão da
// lista e sobe junto com ela.
//
// O clique volta pelo console do webview, que o painel escuta em
// 'console-message'. É o único canal de mão dupla que existe sem um preload
// próprio para a página do txAdmin.
const ROTEIRO_X_LISTA =
  '(() => {' +
    'const barra = document.querySelector("aside.tx-sidebar");' +
    'if (!barra) return "sem barra";' +
    'if (document.getElementById("mesa-fecha")) return "ja tinha";' +
    'const b = document.createElement("button");' +
    'b.id = "mesa-fecha";' +
    'b.type = "button";' +
    'b.title = "Fechar a lista";' +
    'b.textContent = "✕";' +
    'b.setAttribute("style", "position:fixed;top:10px;right:10px;z-index:60;' +
      'width:26px;height:26px;line-height:1;padding:0;border-radius:6px;' +
      'border:1px solid rgba(255,255,255,0.18);background:rgba(20,22,26,0.95);' +
      'color:#d8dde5;font-size:13px;cursor:pointer;display:flex;' +
      'align-items:center;justify-content:center");' +
    'b.addEventListener("click", () => console.log("mesa:fechar-lista"));' +
    'document.body.appendChild(b);' +
    'return "posto";' +
  '})()';

const ROTEIRO_TIRA_X =
  '(() => {' +
    'const b = document.getElementById("mesa-fecha");' +
    'if (b) b.remove();' +
    'return "ok";' +
  '})()';

// Uma por console. A chave devolvida pelo insertCSS é o que permite tirar o CSS
// depois; guardar só um booleano deixaria a folha grudada para sempre.
const listaJog = [
  { aberta: false, chave: null },
  { aberta: false, chave: null }
];

async function pintaLista(i) {
  const wv = document.getElementById('wv' + i);
  const caixa = document.getElementById('jogCaixa' + i);
  const est = listaJog[i];
  if (caixa) caixa.classList.toggle('aberta', est.aberta);

  if (!wv) return;
  try {
    if (est.aberta) {
      if (!est.chave) est.chave = await wv.insertCSS(CSS_LISTA_JOGADORES);
      await wv.executeJavaScript(ROTEIRO_X_LISTA, false);
    } else if (est.chave) {
      await wv.removeInsertedCSS(est.chave);
      est.chave = null;
      await wv.executeJavaScript(ROTEIRO_TIRA_X, false);
    }
  } catch (e) {
    // Webview recarregando no meio do clique: a folha volta sozinha no dom-ready.
    est.chave = null;
  }
}

function alternaLista(i) {
  // A chave NÃO se perde aqui: ela é o que o removeInsertedCSS pede para tirar a
  // folha. Zerar junto com o estado deixava a lateral colada na tela — o painel
  // marcava fechado e o CSS continuava lá. Quem descarta a chave é só o
  // dom-ready, onde o documento inteiro (e a folha com ele) some de verdade.
  listaJog[i].aberta = !listaJog[i].aberta;
  pintaLista(i);
}

// O menu fica escondido, não removido: os números seguem legíveis no DOM.
// A contagem de jogadores o próprio txAdmin põe no título da aba.
// Sem expressão regular com escape de propósito: este script viaja como string
// até dentro do webview, e cada camada come uma barra invertida no caminho.
const LEITOR_ESTADO =
  '(() => {' +
    'const tit = document.title || "";' +
    'const a = tit.indexOf("("), b = tit.indexOf(")");' +
    'const n = (a === 0 && b > 1) ? Number(tit.slice(1, b)) : NaN;' +
    'const aside = document.querySelector("aside.tx-sidebar");' +
    'const cima = (aside ? aside.textContent : "").toUpperCase();' +
    'return {' +
      'jogadores: Number.isFinite(n) ? n : null,' +
      'ligado: cima.indexOf("ONLINE") >= 0 ? true : (cima.indexOf("OFFLINE") >= 0 ? false : null)' +
    '};' +
  '})()';

// Reiniciar é o botão do próprio txAdmin, no menu que o painel esconde. Os
// botões não têm title nem aria-label: o que identifica cada um é o desenho do
// ícone. O de reiniciar é o lucide rotate-ccw, que começa com "M3 12a9 9 0 1 0".
// Os vizinhos são desligar e anúncio — errar de botão aqui derruba o servidor,
// por isso a checagem é pelo caminho do SVG e não por posição na lista.
//
// Depois de clicar, o txAdmin abre o diálogo dele. O painel lê o texto: se não
// falar em reiniciar/restart, aperta Escape e devolve erro em vez de confirmar
// às cegas.
const ROTEIRO_RELIGA =
  '(async () => {' +
    'const espera = (ms) => new Promise(r => setTimeout(r, ms));' +
    'const aside = document.querySelector("aside.tx-sidebar");' +
    'if (!aside) return { ok: false, motivo: "menu do txAdmin não encontrado" };' +
    'const alvo = Array.from(aside.querySelectorAll("button")).find(b => {' +
      'const p = b.querySelector("svg path");' +
      'return p && String(p.getAttribute("d") || "").indexOf("M3 12a9 9 0 1 0") === 0;' +
    '});' +
    'if (!alvo) return { ok: false, motivo: "botão de reiniciar não encontrado" };' +
    'alvo.click();' +
    'await espera(900);' +
    'const cx = document.querySelector("[role=alertdialog], [role=dialog]");' +
    'if (!cx) return { ok: true, dialogo: false };' +
    'const texto = (cx.textContent || "").toLowerCase();' +
    'if (texto.indexOf("restart") < 0 && texto.indexOf("reinici") < 0) {' +
      'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));' +
      'return { ok: false, motivo: "o diálogo aberto não era de reinício" };' +
    '}' +
    // O txAdmin rotula o confirmar de "Continue" — nao de Restart nem Confirm.
    // Por isso aqui vao duas redes: a lista de palavras e, se ela falhar, o
    // ultimo botao que nao seja Cancelar (o AlertDialog poe a acao por ultimo).
    'const bts = Array.from(cx.querySelectorAll("button"));' +
    'const rotulo = (b) => (b.textContent || "").trim().toLowerCase();' +
    'const cancela = (b) => {' +
      'const t = rotulo(b);' +
      'return t.indexOf("cancel") >= 0 || t.indexOf("voltar") >= 0 || t.indexOf("fechar") >= 0;' +
    '};' +
    'const palavras = ["continue", "continuar", "restart", "reinici", "confirm", "proceed", "sim", "yes"];' +
    'let sim = bts.find(b => !cancela(b) && palavras.some(p => rotulo(b).indexOf(p) >= 0));' +
    'if (!sim) { const sobra = bts.filter(b => !cancela(b) && rotulo(b)); sim = sobra[sobra.length - 1]; }' +
    'if (!sim) return { ok: false, motivo: "não achei o confirmar do txAdmin" };' +
    'sim.click();' +
    'return { ok: true, dialogo: true };' +
  '})()';

// Ligar: o botao aparece no MESMO menu, no lugar do desligar, quando o txAdmin
// ve o servidor parado. O icone e o `play` do lucide, que muda de grafia entre
// versoes — por isso tres marcas e, como ultima rede, o texto do botao.
const ROTEIRO_LIGA =
  '(async () => {' +
    'const espera = (ms) => new Promise(r => setTimeout(r, ms));' +
    'const aside = document.querySelector("aside.tx-sidebar");' +
    'if (!aside) return { ok: false, motivo: "menu do txAdmin não encontrado" };' +
    'const botoes = Array.from(aside.querySelectorAll("button"));' +
    'const marcas = ["m5 3 14 9", "M5 3l14 9", "M6 3l14 9", "polygon"];' +
    'let alvo = botoes.find(b => Array.from(b.querySelectorAll("svg path, svg polygon")).some(e => {' +
      'const d = String(e.getAttribute("d") || e.getAttribute("points") || "");' +
      'return marcas.some(m => d.toLowerCase().indexOf(m.toLowerCase()) === 0);' +
    '}));' +
    'if (!alvo) alvo = botoes.find(b => {' +
      'const t = ((b.getAttribute("aria-label") || "") + " " + (b.getAttribute("title") || "") + " " + (b.textContent || "")).toLowerCase();' +
      'return t.indexOf("start") >= 0 || t.indexOf("ligar") >= 0 || t.indexOf("iniciar") >= 0;' +
    '});' +
    'if (!alvo) return { ok: false, motivo: "botão de ligar não encontrado" };' +
    'alvo.click();' +
    'await espera(900);' +
    'const cx = document.querySelector("[role=alertdialog], [role=dialog]");' +
    'if (!cx) return { ok: true, dialogo: false };' +
    'const bts = Array.from(cx.querySelectorAll("button"));' +
    'const rotulo = (b) => (b.textContent || "").trim().toLowerCase();' +
    'const cancela = (b) => {' +
      'const t = rotulo(b);' +
      'return t.indexOf("cancel") >= 0 || t.indexOf("voltar") >= 0 || t.indexOf("fechar") >= 0;' +
    '};' +
    'const palavras = ["continue", "continuar", "start", "iniciar", "ligar", "confirm", "proceed", "sim", "yes"];' +
    'let sim = bts.find(b => !cancela(b) && palavras.some(pl => rotulo(b).indexOf(pl) >= 0));' +
    'if (!sim) { const sobra = bts.filter(b => !cancela(b) && rotulo(b)); sim = sobra[sobra.length - 1]; }' +
    'if (!sim) return { ok: false, motivo: "não achei o confirmar do txAdmin" };' +
    'sim.click();' +
    'return { ok: true, dialogo: true };' +
  '})()';

// Desligar e mais grave que reiniciar: o servidor NAO volta sozinho. Por isso
// aqui o dialogo do txAdmin nao e so conferido — ele e exigido. Sem dialogo, o
// painel devolve erro em vez de dizer que deu certo.
const ROTEIRO_DESLIGA =
  '(async () => {' +
    'const espera = (ms) => new Promise(r => setTimeout(r, ms));' +
    'const aside = document.querySelector("aside.tx-sidebar");' +
    'if (!aside) return { ok: false, motivo: "menu do txAdmin não encontrado" };' +
    'const botoes = Array.from(aside.querySelectorAll("button"));' +
    // O icone de desligar do lucide: haste em cima, arco aberto embaixo. Duas
    // grafias do mesmo desenho circulam entre versoes do lucide, e a haste
    // sozinha ("M12 2v10") serve de terceira rede.
    'const marcas = ["M18.36 6.64", "M18.4 6.6", "M12 2v10"];' +
    'let alvo = botoes.find(b => Array.from(b.querySelectorAll("svg path")).some(e => {' +
      'const d = String(e.getAttribute("d") || "");' +
      'return marcas.some(m => d.indexOf(m) === 0);' +
    '}));' +
    'if (!alvo) alvo = botoes.find(b => {' +
      'const t = ((b.getAttribute("aria-label") || "") + " " + (b.getAttribute("title") || "")).toLowerCase();' +
      'return t.indexOf("stop") >= 0 || t.indexOf("shutdown") >= 0 || t.indexOf("desliga") >= 0;' +
    '});' +
    'if (!alvo) return { ok: false, motivo: "botão de desligar não encontrado" };' +
    'alvo.click();' +
    'await espera(900);' +
    'const cx = document.querySelector("[role=alertdialog], [role=dialog]");' +
    'if (!cx) return { ok: false, motivo: "o txAdmin não abriu confirmação — confira lá antes de repetir" };' +
    'const texto = (cx.textContent || "").toLowerCase();' +
    'const fala = ["stop", "shutdown", "desliga", "desligar", "parar", "encerrar"];' +
    'if (!fala.some(pl => texto.indexOf(pl) >= 0)) {' +
      'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));' +
      'return { ok: false, motivo: "o diálogo aberto não era de desligamento" };' +
    '}' +
    'const bts = Array.from(cx.querySelectorAll("button"));' +
    'const rotulo = (b) => (b.textContent || "").trim().toLowerCase();' +
    'const cancela = (b) => {' +
      'const t = rotulo(b);' +
      'return t.indexOf("cancel") >= 0 || t.indexOf("voltar") >= 0 || t.indexOf("fechar") >= 0;' +
    '};' +
    'const palavras = ["continue", "continuar", "stop", "shutdown", "desliga", "confirm", "proceed", "sim", "yes"];' +
    'let sim = bts.find(b => !cancela(b) && palavras.some(pl => rotulo(b).indexOf(pl) >= 0));' +
    'if (!sim) { const sobra = bts.filter(b => !cancela(b) && rotulo(b)); sim = sobra[sobra.length - 1]; }' +
    'if (!sim) return { ok: false, motivo: "não achei o confirmar do txAdmin" };' +
    'sim.click();' +
    'return { ok: true, dialogo: true };' +
  '})()';

// O que o txAdmin diz de cada servidor: true no ar, false parado, null quando
// nem ele respondeu. Os botões quentes obedecem a isto.
const estadoLigado = [null, null];
const ultimoBotoes = ['', ''];

// Servidor parado não tem o que desligar nem reiniciar; servidor no ar não tem
// o que ligar. Antes os três botões ficavam sempre acesos, e desligar um
// servidor já parado devolvia erro do txAdmin como se o painel tivesse falhado.
function aplicaBotoesQuentes(i) {
  const vivo = caiuEm[i] === null;          // o txAdmin respondeu?
  const ligado = estadoLigado[i];
  const acha = (attr) => document.querySelector('[data-' + attr + '="' + i + '"]');

  const liga = acha('liga');
  const desliga = acha('desliga');
  const religa = acha('religa');

  // Sem resposta do txAdmin nenhum botão promete nada: quem não sabe o estado
  // não manda comando.
  const podeDesligar = vivo && ligado === true;
  const podeLigar = vivo && ligado === false;

  if (desliga) { desliga.disabled = !podeDesligar; desliga.hidden = podeLigar; }
  if (religa) religa.disabled = !podeDesligar;
  if (liga) { liga.hidden = !podeLigar; liga.disabled = !podeLigar; }

  // Uma linha no log a cada mudança: é como se confere de fora que o botão
  // seguiu o estado do servidor, sem precisar abrir a página.
  const marca = (vivo ? 'tx-ok' : 'tx-fora') + '/' +
    (ligado === true ? 'no-ar' : ligado === false ? 'parado' : 'sem-leitura');
  if (ultimoBotoes[i] !== marca) {
    ultimoBotoes[i] = marca;
    window.api.diag('botões ' + (i === 0 ? 'remoto' : 'local') + ': ' + marca +
      ' → ligar=' + (podeLigar ? 'on' : 'off') + ' desligar=' + (podeDesligar ? 'on' : 'off'));
  }
}

async function leEstadoServidor(wv, i) {
  // Terminal caido segura a pagina antiga inteira: ler dali repintaria "No ar"
  // e a contagem de jogadores de minutos atras. A chapa manda enquanto durar.
  if (caiuEm[i] !== null) return;
  let r = null;
  try { r = await wv.executeJavaScript(LEITOR_ESTADO, false); } catch (e) {}
  const sv = document.getElementById('sv' + i);
  const caixa = document.getElementById('jogCaixa' + i);
  const jog = document.getElementById('jog' + i);
  if (!r) {
    sv.textContent = '';
    caixa.style.display = 'none';
    estadoLigado[i] = null;
    aplicaBotoesQuentes(i);
    return;
  }
  estadoLigado[i] = r.ligado;
  aplicaBotoesQuentes(i);
  sv.textContent = r.ligado === null ? '' : (r.ligado ? 'No ar' : 'Fora');
  sv.className = 'pastilha' + (r.ligado ? ' no-ar' : r.ligado === false ? ' fora' : '');
  caixa.style.display = r.jogadores == null ? 'none' : 'flex';
  if (r.jogadores != null) {
    const vazio = r.jogadores === 0;
    jog.textContent = r.jogadores;
    jog.className = 'n' + (vazio ? ' vazio' : '');
    caixa.classList.toggle('vazia', vazio);
  }
}

let txCred = null;
const credPronta = window.api.txCred().then(c => { txCred = c; return c; });

// O xterm do txAdmin desenha em canvas (xterm-text-layer): CSS chega no elemento
// mas não no que é pintado — a fonte vem de `options.fontFamily`, guardada dentro
// da instância do terminal, que a página não expõe.
//
// O ponto por onde tudo passa é o `ctx.font` do canvas. Trocando só a família no
// setter, todo desenho seguinte sai na fonte escolhida sem tocar em tamanho,
// peso ou estilo — e sem depender de alcançar a instância do xterm.
const FONTE_CONSOLE = '"JetBrains Mono", "Cascadia Mono", Consolas, monospace';

// JetBrains Mono não é fonte do sistema: o arquivo vai junto, em data: URL, e
// precisa estar carregado ANTES de o xterm montar o atlas de glifos — senão o
// canvas desenha no fallback e só a próxima remontagem corrige.
const fontePronta = window.api.fonteLog().then(dados => dados || '');

function cssDaFonte(dados) {
  return dados
    ? '@font-face { font-family: "JetBrains Mono";' +
      ' src: url(' + dados + ') format("woff2");' +
      ' font-weight: 100 800; font-style: normal; font-display: block; }'
    : '';
}

// O xterm do txAdmin desenha em canvas: CSS chega no elemento mas não no que é
// pintado — a fonte vem de `options.fontFamily`, guardada dentro da instância,
// que a página não expõe.
//
// O ponto por onde tudo passa é o `ctx.font`. Trocando só a família no setter,
// todo desenho seguinte sai na fonte escolhida, sem tocar em tamanho ou peso e
// sem precisar alcançar o xterm.
const ROTEIRO_FONTE =
  '(() => {' +
    'if (window.__mesaFonte) return "ja";' +
    'const familia = ' + JSON.stringify(FONTE_CONSOLE) + ';' +
    'const troca = function (v) {' +
      // Corta no último "px " e troca o que vem depois. Sem regex de propósito:
      // este texto atravessa três camadas de string até o webview e cada uma
      // come uma barra de escape pelo caminho.
      'const t = String(v);' +
      'const i = t.lastIndexOf("px ");' +
      'return i >= 0 ? t.slice(0, i + 2) + " " + familia : v;' +
    '};' +
    'const alvos = [];' +
    'if (window.CanvasRenderingContext2D) alvos.push(CanvasRenderingContext2D.prototype);' +
    // O atlas de glifos do xterm é montado num OffscreenCanvas, que tem
    // prototype próprio: patch só no canvas normal não alcança o log.
    'if (window.OffscreenCanvasRenderingContext2D) alvos.push(OffscreenCanvasRenderingContext2D.prototype);' +
    'let n = 0;' +
    'alvos.forEach(function (proto) {' +
      'const d = Object.getOwnPropertyDescriptor(proto, "font");' +
      'if (!d || !d.set) return;' +
      'Object.defineProperty(proto, "font", {' +
        'configurable: true,' +
        'get: function () { return d.get.call(this); },' +
        'set: function (v) { d.set.call(this, troca(v)); }' +
      '});' +
      'n++;' +
    '});' +
    'window.__mesaFonte = n > 0;' +
    'return n ? "ok:" + n : "sem setter";' +
  '})()';

// Espera a fonte ficar pronta dentro da página antes de mexer no atlas.
// Nome sem aspas de propósito: CSS aceita família de duas palavras sem aspas, e
// aspas aqui atravessariam três camadas de string até o webview — cada uma come
// uma barra de escape pelo caminho.
const CARREGA_FONTE =
  '(async () => {' +
    'try { await document.fonts.load("14px JetBrains Mono"); } catch (e) {}' +
    'try { await document.fonts.ready; } catch (e) {}' +
    'return document.fonts.check("14px JetBrains Mono");' +
  '})()';

// O que é DOM de verdade na página (barra de comando, histórico) segue por CSS.
const CSS_FONTE_DOM =
  '.xterm, .xterm-rows, .xterm-rows *, .xterm-helpers, .xterm-helpers * {' +
  ' font-family: ' + FONTE_CONSOLE + ' !important;' +
  ' font-variant-ligatures: none !important; }';

// A barra de comando é input de verdade, e o zoom do webview (0.85) a encolhe
// junto com o log — o que ele digita acaba menor que o que lê. Aqui ela volta a
// um tamanho de leitura, com a mesma fonte do console.
//
// Escopo: só input de texto dentro do <main>, que é o console. O campo de senha
// do login fica de fora de propósito — mexer nele atrapalharia o roteiro que
// repõe a sessão.
const CSS_BARRA_COMANDO = [
  'main input[type="text"], main input:not([type]) {',
  ' font-family: ' + FONTE_CONSOLE + ' !important;',
  ' font-size: 17px !important;',
  ' line-height: 1.4 !important;',
  ' height: auto !important;',
  ' min-height: 42px !important;',
  ' padding-top: 6px !important;',
  ' padding-bottom: 6px !important; }',
  // O ">" ao lado do campo é ícone: cresce junto para não ficar desproporcional.
  'main form svg, main input + svg, main svg.lucide-chevron-right {',
  ' width: 18px !important; height: 18px !important; }'
].join(' ');


// --------------------------------------------------- comando em fila (virgula)
// O console do txAdmin manda a linha inteira pro FXServer, e o FXServer nao
// conhece virgula: "ensure kd_stable, ensure kd_horses_book" vira UM comando
// chamado `ensure` com argumento sujo, e volta erro.
//
// Aqui a linha e fatiada dentro do webview e cada pedaco entra pela MESMA barra
// de comando, um de cada vez — o txAdmin nem sabe que veio junto. O envio imita
// o que o dedo faz: escreve no campo com o setter nativo (senao o React nao ve),
// espera o React confirmar, e dispara o submit do formulario.
//
// Virgula nem sempre e separador: `say oi, pessoal` e uma frase so. Por isso os
// comandos de texto livre ficam de fora, e aspas seguram o que estiver dentro.
const CMD_TEXTO_LIVRE = [
  'say', 'chat', 'announce', 'tweet', 'twt', 'me', 'dm', 'pm', 'msg',
  'kick', 'ban', 'warn', 'report', 'echo'
];

const ROTEIRO_FATIA = `
(() => {
  if (window.__mesaFatia) return "ja estava";
  window.__mesaFatia = true;

  const LIVRES = ${JSON.stringify(CMD_TEXTO_LIVRE)};
  const PAUSA = 3000;  // respiro entre um script e o proximo: o ensure precisa
                       // do resource de pe antes do proximo entrar
  const PAUSA_REFRESH = 5000;  // o refresh remonta a lista de resources; sem esse
                               // respiro o comando seguinte cai no vazio

  const TAB = String.fromCharCode(9);
  const FIMLINHA = String.fromCharCode(10);

  const espera = ms => new Promise(r => setTimeout(r, ms));

  const poe = (el, v) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  // Sem regex de proposito: este roteiro viaja como texto ate dentro do webview.
  function primeiraPalavra(t) {
    let i = 0;
    while (i < t.length && (t.charAt(i) === " " || t.charAt(i) === TAB)) i++;
    let p = "";
    while (i < t.length && t.charAt(i) !== " " && t.charAt(i) !== TAB) { p += t.charAt(i); i++; }
    return p.toLowerCase();
  }

  function fatiar(linha) {
    const t = (linha || "").trim();
    if (!t) return [];
    if (LIVRES.indexOf(primeiraPalavra(t)) >= 0) return [t];
    const partes = [];
    let atual = "";
    let aspas = "";
    for (let i = 0; i < t.length; i++) {
      const c = t.charAt(i);
      if (aspas) {
        atual += c;
        if (c === aspas) aspas = "";
        continue;
      }
      if (c === '"' || c === "'") { aspas = c; atual += c; continue; }
      if (c === "," || c === ";" || c === FIMLINHA) { partes.push(atual); atual = ""; continue; }
      atual += c;
    }
    partes.push(atual);
    const limpas = [];
    for (let i = 0; i < partes.length; i++) {
      const p = partes[i].trim();
      if (p) limpas.push(p);
    }
    return limpas;
  }

  const ehRefresh = cmd => primeiraPalavra((cmd || "").trim()) === "refresh";

  async function enviaUm(el, cmd) {
    poe(el, cmd);
    await espera(90);                      // o React precisa comitar o estado
    const form = el.closest("form");
    if (form && form.requestSubmit) { form.requestSubmit(); return; }
    if (form) { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); return; }
    const tecla = tipo => new KeyboardEvent(tipo, {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true
    });
    el.dispatchEvent(tecla("keydown"));
    el.dispatchEvent(tecla("keypress"));
    el.dispatchEvent(tecla("keyup"));
  }

  async function enviaFila(el, cmds) {
    window.__mesaEnviando = true;
    try {
      for (let i = 0; i < cmds.length; i++) {
        await enviaUm(el, cmds[i]);
        if (i < cmds.length - 1) {
          await espera(ehRefresh(cmds[i]) ? PAUSA_REFRESH : PAUSA);
        }
      }
      await espera(120);
      if (el.value) poe(el, "");
    } finally {
      window.__mesaEnviando = false;
      setTimeout(persisteHist, 500);
    }
  }

  // ------------------------------------------------ historico da barra
  // O txAdmin guarda o historico em memoria (estado do React) e so espelha em
  // localStorage. Como a fila entra comando a comando, a seta pra cima dele
  // devolve "ensure kd_stable_taming" — o pedaco, nunca a linha que foi
  // digitada. Entao o historico da seta passa a ser deste roteiro: guarda a
  // linha BRUTA, com virgula e tudo, e a seta anda nela.
  const CHAVE_HIST = "txa:liveConsole:history";
  let hist = [];
  try {
    const guardado = JSON.parse(localStorage.getItem(CHAVE_HIST) || "[]");
    if (guardado && guardado.length) {
      for (let i = 0; i < guardado.length; i++) {
        if (typeof guardado[i] === "string") hist.push(guardado[i]);
      }
    }
  } catch (e) {}
  let ponteiro = -1;      // -1 = linha em edicao, fora do historico
  let ultimoPosto = null; // o que o roteiro escreveu por ultimo no campo

  function guardaHist(linha) {
    const t = (linha || "").trim();
    if (!t || hist[0] === t) return;
    const i = hist.indexOf(t);
    if (i >= 0) hist.splice(i, 1);
    hist.unshift(t);
    if (hist.length > 60) hist.length = 60;
    // O txAdmin escreve a lista dele a CADA comando da fila; a nossa tem de
    // entrar depois do ultimo, senao o recarregamento traz a lista dele.
    setTimeout(persisteHist, 400);
  }

  function persisteHist() {
    try { localStorage.setItem(CHAVE_HIST, JSON.stringify(hist)); } catch (e) {}
  }

  function poeDoHist(el, v) {
    ultimoPosto = v;
    poe(el, v);
    setTimeout(() => {
      try { el.selectionStart = el.selectionEnd = el.value.length; } catch (e) {}
    }, 0);
  }

  // Digitou por cima do que veio do historico: volta a ser linha em edicao.
  window.addEventListener("input", (e) => {
    const el = e.target;
    if (!el || el.tagName !== "INPUT") return;
    if (el.value !== ultimoPosto) { ponteiro = -1; ultimoPosto = null; }
  }, true);

  // Captura na janela: pega o Enter antes do React e do formulario.
  window.addEventListener("keydown", (e) => {
    if (!e.isTrusted) return;                  // o Enter que eu mesmo disparo passa
    const el = e.target;
    if (!el || el.tagName !== "INPUT" || el.type === "password") return;
    if (document.querySelector("input[type=password]")) return;   // tela de login
    const main = document.querySelector("main");
    if (main && !main.contains(el)) return;

    // Seta: anda no historico deste roteiro, nunca no do txAdmin.
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // Com a fila correndo o campo e do roteiro: seta agora so atrapalharia.
      if (window.__mesaEnviando) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (!hist.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "ArrowUp") {
        ponteiro = ponteiro + 1;
        if (ponteiro > hist.length - 1) ponteiro = hist.length - 1;
      } else {
        ponteiro = ponteiro - 1;
        if (ponteiro < -1) ponteiro = -1;
      }
      poeDoHist(el, ponteiro < 0 ? "" : hist[ponteiro]);
      return;
    }

    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey) return;
    if (window.__mesaEnviando) { e.preventDefault(); return; }
    const bruta = el.value;
    guardaHist(bruta);                         // a linha inteira, antes de fatiar
    ponteiro = -1;
    ultimoPosto = null;
    const cmds = fatiar(bruta);
    if (cmds.length < 2) return;               // linha simples segue o caminho normal
    e.preventDefault();
    e.stopImmediatePropagation();
    console.log("[mesa] fila de comando: " + cmds.length + " -> " + cmds.join(" | "));
    enviaFila(el, cmds);
  }, true);

  return "ligado";
})()`;


[0, 1].forEach(i => {
  const wv = document.getElementById('wv' + i);
  const est = document.getElementById('est' + i);
  wv.addEventListener('did-start-loading', () => { est.textContent = 'ligando'; est.classList.remove('ruim'); });
  wv.addEventListener('did-stop-loading', () => { est.textContent = ''; });
  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return;              // navegação trocada, não é falha
    if (e.isMainFrame === false) return;         // sub-recurso não derruba a tela
    est.textContent = 'sem sinal (' + e.errorCode + ')';
    est.classList.add('ruim');
    // Falha de rede levanta a chapa na hora; o resto espera a batida decidir.
    const causa = CODIGO_REDE[String(e.errorCode)];
    if (causa) marcaCaido(i, causa);
  });
  // Único canal de volta do guest sem preload próprio: o X da lista avisa por
  // console.log e o painel fecha a lista pelo caminho normal.
  wv.addEventListener('console-message', (e) => {
    const msg = String((e && (e.message || e.args)) || '');
    if (msg.indexOf('mesa:fechar-lista') < 0) return;
    if (!listaJog[i].aberta) return;
    window.api.diag('lista ' + i + ': fechada pelo X');
    alternaLista(i);
  });

  wv.addEventListener('dom-ready', async () => {
    try { await wv.insertCSS(CSS_SO_CONSOLE); } catch (e) {}
    // Recarregou com a lista aberta: a folha some junto com o documento.
    listaJog[i].chave = null;
    if (listaJog[i].aberta) { try { await pintaLista(i); } catch (e) {} }
    // Duas frentes: o CSS pega o que é DOM (barra de comando, histórico) e o
    // roteiro pega o canvas do log, que é o que importa.
    try {
      const dados = await fontePronta;
      if (dados) await wv.insertCSS(cssDaFonte(dados));
      await wv.insertCSS(CSS_FONTE_DOM);
      await wv.insertCSS(CSS_BARRA_COMANDO);
      const r = await wv.executeJavaScript(ROTEIRO_FONTE, false);
      const carregou = await wv.executeJavaScript(CARREGA_FONTE, false);
      window.api.diag('fonte do console ' + i + ': patch ' + r + ' | JetBrains disponível: ' + carregou);
      // O espião do log entra junto: ele precisa estar de pé ANTES do socket.io
      // começar a puxar, senão as primeiras respostas passam sem ser lidas.
      await wv.executeJavaScript(ESPIAO_XHR, false);
      // Fatiador de comando: precisa estar de pe antes de o dedo digitar.
      const fatia = await wv.executeJavaScript(ROTEIRO_FATIA, false);
      window.api.diag('fatiador de comando ' + i + ': ' + fatia);
    } catch (e) {
      window.api.diag('fonte do console ' + i + ' falhou: ' + e.message);
    }
    aplicaZoom(i, zoomGuardado(i));
    // Empurrão curto no zoom: o xterm só refaz o atlas de glifos quando as
    // medidas mudam, e sem isso a fonte nova só apareceria na próxima linha.
    setTimeout(() => {
      const z = zoomGuardado(i);
      wv.setZoomFactor(z + 0.01);
      setTimeout(() => wv.setZoomFactor(z), 120);
    }, 600);
    const cred = txCred || await credPronta;
    if (cred) { try { await wv.executeJavaScript(roteiroLogin(cred), false); } catch (e) {} }
    // Confere: sumiu o campo de senha, entrou. Continua lá, o login não passou.
    setTimeout(async () => {
      try {
        const r = await wv.executeJavaScript(
          '({ senha: !!document.querySelector("input[type=password]"), caminho: location.pathname })', false);
        if (r && r.senha) {
          est.textContent = 'login não passou';
          est.classList.add('ruim');
        } else {
          est.textContent = '';
          est.classList.remove('ruim');
        }
        window.api.telaEstado(i, r);
      } catch (e) {}
      leEstadoServidor(wv, i);
      clearInterval(wv._relogio);
      wv._relogio = setInterval(() => leEstadoServidor(wv, i), 10000);
    }, 7000);
  });
});

document.querySelectorAll('.jogadores').forEach(caixa => {
  const i = Number(caixa.id.replace('jogCaixa', ''));
  caixa.addEventListener('click', () => alternaLista(i));
  caixa.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternaLista(i); }
  });
});

document.querySelectorAll('[data-abre]').forEach(b => {
  b.addEventListener('click', () => window.api.abrirUrl(urlDe(servidores[Number(b.dataset.abre)])));
});

// Reiniciar derruba jogador de verdade: modal antes, e o painel ainda confere o
// diálogo que o txAdmin abrir. Se o diálogo não falar em reiniciar, cancela.
const religaModal = document.getElementById('religaModal');
let religaAlvo = null;

document.querySelectorAll('[data-religa]').forEach(b => {
  b.addEventListener('click', () => {
    const i = Number(b.dataset.religa);
    religaAlvo = i;
    const s = servidores[i];
    document.getElementById('religaNome').textContent = s.nome;
    document.getElementById('religaHost').textContent = s.host + ':' + s.porta;
    const jogEl = document.getElementById('jog' + i);
    const gente = Number(jogEl && jogEl.textContent) || 0;
    document.getElementById('religaGente').innerHTML = gente > 0
      ? '<b style="color:var(--vermelho)">Tem ' + gente + ' jogador(es) online agora.</b><br><br>'
      : '';
    abre(religaModal);
  });
});

document.getElementById('religaCancel').addEventListener('click', () => fecha(religaModal));
religaModal.addEventListener('click', (e) => { if (e.target === religaModal) fecha(religaModal); });

document.getElementById('religaOk').addEventListener('click', async () => {
  const i = religaAlvo;
  fecha(religaModal);
  if (i == null) return;
  const est = document.getElementById('est' + i);
  est.textContent = 'pedindo reinício';
  est.classList.remove('ruim');
  let r = null;
  try { r = await document.getElementById('wv' + i).executeJavaScript(ROTEIRO_RELIGA, false); } catch (e) {}
  if (!r || !r.ok) {
    est.textContent = (r && r.motivo) || 'não deu para reiniciar';
    est.classList.add('ruim');
    return;
  }
  est.textContent = r.dialogo ? 'reinício confirmado' : 'reinício pedido';
  setTimeout(() => { est.textContent = ''; }, 10000);
});

// Ligar não tem rito: subir servidor parado não derruba ninguém. Clique direto.
document.querySelectorAll('[data-liga]').forEach(b => {
  b.addEventListener('click', async () => {
    const i = Number(b.dataset.liga);
    const est = document.getElementById('est' + i);
    est.textContent = 'pedindo para ligar';
    est.classList.remove('ruim');
    let r = null;
    try { r = await document.getElementById('wv' + i).executeJavaScript(ROTEIRO_LIGA, false); } catch (e) {}
    if (!r || !r.ok) {
      est.textContent = (r && r.motivo) || 'não deu para ligar';
      est.classList.add('ruim');
      return;
    }
    est.textContent = 'ligando';
    setTimeout(() => { est.textContent = ''; }, 10000);
  });
});

// Desligar tem o mesmo rito do reiniciar, com o aviso a mais de que ninguem
// sobe o servidor de volta sozinho.
const desligaModal = document.getElementById('desligaModal');
let desligaAlvo = null;

document.querySelectorAll('[data-desliga]').forEach(b => {
  b.addEventListener('click', () => {
    const i = Number(b.dataset.desliga);
    desligaAlvo = i;
    const s = servidores[i];
    document.getElementById('desligaNome').textContent = s.nome;
    document.getElementById('desligaHost').textContent = s.host + ':' + s.porta;
    const jogEl = document.getElementById('jog' + i);
    const gente = Number(jogEl && jogEl.textContent) || 0;
    document.getElementById('desligaGente').innerHTML = gente > 0
      ? '<b style="color:var(--vermelho)">Tem ' + gente + ' jogador(es) online agora.</b><br><br>'
      : '';
    abre(desligaModal);
  });
});

document.getElementById('desligaCancel').addEventListener('click', () => fecha(desligaModal));
desligaModal.addEventListener('click', (e) => { if (e.target === desligaModal) fecha(desligaModal); });

document.getElementById('desligaOk').addEventListener('click', async () => {
  const i = desligaAlvo;
  fecha(desligaModal);
  if (i == null) return;
  const est = document.getElementById('est' + i);
  est.textContent = 'pedindo desligamento';
  est.classList.remove('ruim');
  let r = null;
  try { r = await document.getElementById('wv' + i).executeJavaScript(ROTEIRO_DESLIGA, false); } catch (e) {}
  if (!r || !r.ok) {
    est.textContent = (r && r.motivo) || 'não deu para desligar';
    est.classList.add('ruim');
    return;
  }
  est.textContent = 'desligamento confirmado';
  setTimeout(() => { est.textContent = ''; }, 10000);
});

// ------------------------------------------ terminal que parou de responder
// O <webview> não fica preto quando o txAdmin morre: ele segura o último quadro
// desenhado, e console congelado passa por console vivo. Quem diz a verdade é
// uma batida de fora, do processo principal, a cada 15 s.
const PULSO_INTERVALO = 15000;
const caiuEm = [null, null];

// Códigos de rede do Chromium que valem por queda de verdade.
const CODIGO_REDE = {
  '-100': 'ECONNCLOSED', '-101': 'ECONNRESET', '-102': 'ECONNREFUSED',
  '-104': 'ECONNFAILED', '-105': 'ENOTFOUND', '-106': 'sem internet',
  '-109': 'EHOSTUNREACH', '-118': 'ETIMEDOUT', '-7': 'ETIMEDOUT'
};

function motivoLegivel(m) {
  const c = String(m || '').toUpperCase();
  if (c.indexOf('ECONNREFUSED') >= 0) return 'A porta está fechada. O txAdmin não está no ar.';
  if (c.indexOf('ETIMEDOUT') >= 0 || c.indexOf('TEMPO') >= 0) return 'Tempo esgotado: a máquina não respondeu.';
  if (c.indexOf('ENOTFOUND') >= 0 || c.indexOf('EAI_AGAIN') >= 0) return 'Endereço não encontrado.';
  if (c.indexOf('EHOSTUNREACH') >= 0 || c.indexOf('ENETUNREACH') >= 0) return 'Sem rota até esse host.';
  if (c.indexOf('ECONNRESET') >= 0 || c.indexOf('ECONNCLOSED') >= 0) return 'A conexão caiu no meio.';
  if (c.indexOf('SEM INTERNET') >= 0) return 'Esta máquina está sem rede.';
  return m ? 'Não deu para falar com ele (' + m + ').' : 'Não deu para falar com ele.';
}

function textoDesde(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'fora há ' + s + ' s';
  const m = Math.round(s / 60);
  if (m < 60) return 'fora há ' + m + ' min';
  return 'fora há ' + Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}

function marcaCaido(i, motivo) {
  const caixa = document.getElementById('off' + i);
  if (!caixa) return;
  // A chapa começa embaixo do cabeçalho: os botões de recarregar e de abrir no
  // navegador continuam alcançáveis com o terminal caído.
  const cab = caixa.parentElement.querySelector('header');
  caixa.style.top = (cab ? cab.offsetHeight : 44) + 'px';
  const s = servidores[i] || {};
  document.getElementById('offAlvo' + i).textContent = (s.host || '') + ':' + (s.porta || '');
  document.getElementById('offMotivo' + i).textContent = motivoLegivel(motivo);
  if (caiuEm[i] === null) {
    caiuEm[i] = Date.now();
    window.api.diag('console ' + (i === 0 ? 'remoto' : 'local') + ': sem resposta — ' + (motivo || '?'));
    document.querySelector('.tecla[data-modo="servidores"] .marcador').classList.add('aceso');
  }
  document.getElementById('offDesde' + i).textContent = textoDesde(caiuEm[i]);
  caixa.hidden = false;
  const est = document.getElementById('est' + i);
  est.textContent = 'sem resposta';
  est.classList.add('ruim');
  // Sem sinal não tem número: manter o "No ar" de antes na tela seria mentira.
  const sv = document.getElementById('sv' + i);
  sv.textContent = '';
  sv.className = 'pastilha';
  document.getElementById('jogCaixa' + i).style.display = 'none';
  // Com o txAdmin fora do ar, nenhum botão quente tem a quem falar.
  estadoLigado[i] = null;
  aplicaBotoesQuentes(i);
}

function marcaDePe(i) {
  const caixa = document.getElementById('off' + i);
  if (caixa) caixa.hidden = true;
  if (caiuEm[i] === null) return;
  const quanto = textoDesde(caiuEm[i]);
  caiuEm[i] = null;
  window.api.diag('console ' + (i === 0 ? 'remoto' : 'local') + ': voltou (' + quanto + ')');
  const est = document.getElementById('est' + i);
  if (est.textContent === 'sem resposta') { est.textContent = ''; est.classList.remove('ruim'); }
  // A página que ficou pendurada no servidor morto não reconecta sozinha.
  document.getElementById('wv' + i).reload();
  aplicaBotoesQuentes(i);
}

async function bateNoTx(i) {
  const s = servidores[i];
  if (!s) return;
  let r = null;
  try { r = await window.api.txPing(s.host, s.porta); } catch (e) {}
  if (r && r.ok) marcaDePe(i); else marcaCaido(i, r && r.motivo);
}

async function conferePulso() {
  // Um tropeco aqui nao pode matar a batida: sem o try, uma excecao derruba o
  // laco inteiro e o painel volta a acreditar no quadro congelado.
  try {
    for (let i = 0; i < 2; i++) await bateNoTx(i);
  } catch (e) {
    window.api.diag('batida do txadmin falhou: ' + e.message);
  }
  setTimeout(conferePulso, PULSO_INTERVALO);
}
setTimeout(conferePulso, 3000);

// O "fora há N min" tem que andar sozinho enquanto ninguém mexe na tela.
setInterval(() => {
  [0, 1].forEach(i => {
    if (caiuEm[i] !== null) document.getElementById('offDesde' + i).textContent = textoDesde(caiuEm[i]);
  });
}, 10000);

document.querySelectorAll('[data-retenta]').forEach(b => {
  b.addEventListener('click', async () => {
    const i = Number(b.dataset.retenta);
    document.getElementById('offMotivo' + i).textContent = 'Conferindo…';
    await bateNoTx(i);
  });
});

// --- modal dos servidores ---
const servModal = document.getElementById('servModal');
function abre(el) { el.classList.add('on'); }
function fecha(el) { el.classList.remove('on'); }

document.getElementById('ajusteServ').addEventListener('click', () => {
  document.getElementById('nomeA').value = servidores[0].nome;
  document.getElementById('hostA').value = servidores[0].host;
  document.getElementById('portaA').value = servidores[0].porta;
  document.getElementById('nomeB').value = servidores[1].nome;
  document.getElementById('hostB').value = servidores[1].host;
  document.getElementById('portaB').value = servidores[1].porta;
  document.getElementById('servNota').textContent = 'Salvar recarrega as duas telas e refaz o login.';
  abre(servModal);
});
document.getElementById('servCancel').addEventListener('click', () => fecha(servModal));
servModal.addEventListener('click', (e) => { if (e.target === servModal) fecha(servModal); });
document.getElementById('servOk').addEventListener('click', async () => {
  const nova = [
    { nome: document.getElementById('nomeA').value, host: document.getElementById('hostA').value, porta: document.getElementById('portaA').value },
    { nome: document.getElementById('nomeB').value, host: document.getElementById('hostB').value, porta: document.getElementById('portaB').value }
  ];
  const r = await window.api.servSet(nova);
  if (!r || !r.ok) {
    document.getElementById('servNota').textContent = (r && r.error) || 'não deu para salvar';
    return;
  }
  servidores = r.servidores;
  pintaServidores();
  carregaTelas();
  fecha(servModal);
});

// Migracao de uma vez: o padrao era 1.25 e os cliques de teste desalinharam os
// dois consoles. Zera o que estava guardado para todo mundo comecar no padrao
// atual. Sobe o numero da marca sempre que o ZOOM_PADRAO mudar, senao o valor
// guardado vence o padrao novo e a mudanca nao aparece.
try {
  if (localStorage.getItem('zoomNormalizado') !== '4') {
    localStorage.removeItem('zoom0');
    localStorage.removeItem('zoom1');
    localStorage.setItem('zoomNormalizado', '4');
  }
} catch (e) {}

(async () => {
  servidores = await window.api.servGet();
  pintaServidores();
  carregaTelas();
})();

// ---------------------------------------------------------------------- dev
const devLogEl = document.getElementById('devLog');
let devLimpo = false;

function poeLog(linha) {
  if (!devLimpo) { devLogEl.innerHTML = ''; devLimpo = true; }
  const div = document.createElement('div');
  if (linha.indexOf('$ ') === 0) div.className = 'cmd';
  else if (linha.indexOf('— ') === 0) div.className = 'fim';
  div.textContent = linha;
  devLogEl.appendChild(div);
  // Só cola no fim se já estava no fim: senão o log rouba a rolagem de quem lê.
  const perto = devLogEl.scrollHeight - devLogEl.scrollTop - devLogEl.clientHeight < 60;
  if (perto) devLogEl.scrollTop = devLogEl.scrollHeight;
  while (devLogEl.childElementCount > 600) devLogEl.removeChild(devLogEl.firstChild);
}

window.api.onDevLog(poeLog);

// A janela do emulador tem altura própria: ele aceita a largura que o painel
// pede e ignora a altura (fica em ~1940 px, mais que os 1920 do monitor). Então
// o encaixe alinha pelo topo do vão e o pé do aparelho passa da tela.
// Tentar corrigir pela proporção só encolhia a janela a cada clique — a altura
// não acompanha a largura.
async function encaixaEmulador() {
  const vao = document.getElementById('vaoEmu');
  const r = vao.getBoundingClientRect();
  if (r.width < 60 || r.height < 60) return;
  const res = await window.api.devEncaixar({
    x: r.x, y: r.y, w: r.width, h: r.height,
    indice: document.getElementById('devAvd').value === 'Main_Debug_2' ? 1 : 0
  });
  if (!res || !res.ok) { poeLog('— encaixe: ' + ((res && res.saida) || 'sem resposta')); return; }
  if (res.altura > r.height + 20) {
    poeLog('— encaixado: a janela do emulador tem ' + res.altura +
      ' px de altura e o vão tem ' + Math.round(r.height) + '; o pé do aparelho fica fora da tela.');
  }
}

document.getElementById('devEncaixar').addEventListener('click', encaixaEmulador);
document.getElementById('devLimpar').addEventListener('click', () => {
  devLogEl.innerHTML = '';
  devLimpo = true;
});

document.getElementById('devSubir').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const pasta = document.getElementById('devProjeto').value;
  const avd = document.getElementById('devAvd').value;
  if (!pasta) return;
  btn.disabled = true;
  const r = await window.api.devSubir(pasta, avd, alvoDev);
  btn.disabled = false;
  if (!r || !r.ok) { poeLog('— ' + ((r && r.error) || 'não deu para subir')); return; }
  document.getElementById('devAvdPast').textContent =
    (alvoDev === 'app' ? r.avd + ' · ' : '') + 'Metro ' + r.metro;
  document.getElementById('marcadorDev').classList.add('aceso');
  if (alvoDev === 'web') {
    // O bundler web demora a responder; só aponta o webview quando ele subir.
    const alvoUrl = 'http://localhost:' + r.metro;
    poeLog('— web em ' + alvoUrl + ' (o painel abre quando o bundler responder)');
    setTimeout(() => { document.getElementById('wvWeb').setAttribute('src', alvoUrl); }, 12000);
    return;
  }
  // O emulador leva um tempo para abrir a janela; tenta encaixar algumas vezes.
  [12000, 25000, 45000, 70000].forEach(t => setTimeout(encaixaEmulador, t));
});

document.getElementById('devMatar').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const pasta = document.getElementById('devProjeto').value;
  btn.disabled = true;
  await window.api.devMatar(pasta);
  btn.disabled = false;
  document.getElementById('devAvdPast').textContent = '';
  document.getElementById('marcadorDev').classList.remove('aceso');
});

(async () => {
  const lista = await window.api.devProjetos();
  const sel = document.getElementById('devProjeto');
  sel.innerHTML = lista.map(p => '<option value="' + esc(p.pasta) + '">' + esc(p.nome) + '</option>').join('')
    || '<option value="">nenhum projeto encontrado</option>';
  try {
    const guardado = localStorage.getItem('devProjeto');
    if (guardado && lista.some(p => p.pasta === guardado)) sel.value = guardado;
  } catch (e) {}
  sel.addEventListener('change', () => {
    try { localStorage.setItem('devProjeto', sel.value); } catch (e) {}
  });

  // A lista de AVDs vem do próprio SDK, não do HTML: nome escrito à mão vira
  // mentira no dia em que ele apagar ou renomear um emulador no Android Studio.
  const avds = await window.api.devAvds();
  const selAvd = document.getElementById('devAvd');
  if (avds && avds.length) {
    selAvd.innerHTML = avds.map(a => '<option value="' + esc(a) + '">' + esc(a) + '</option>').join('');
    try {
      const g = localStorage.getItem('devAvd');
      if (g && avds.indexOf(g) >= 0) selAvd.value = g;
    } catch (e) {}
  } else {
    selAvd.innerHTML = '<option value="">nenhum AVD criado</option>';
  }
  selAvd.addEventListener('change', () => {
    try { localStorage.setItem('devAvd', selAvd.value); } catch (e) {}
  });
})();

// -------------------------------------------- erro nos consoles dos servidores
// Medido em 27/08/2026, dentro do proprio painel, com o console remoto ativo:
//
//     {"xhr":8,"xhrComLog":2,"ws":0,"fillText":0,"drawImage":0,"terminal":false}
//
// O que isso fecha, depois de tres tentativas erradas na historia deste arquivo:
//   - `.xterm-rows` nao existe: o xterm desenha em canvas.
//   - `window.WebSocket` nao ve nada: o socket.io do txAdmin usa polling.
//   - `fillText`/`drawImage` tambem nao veem nada — a rasterizacao acontece
//     fora da thread principal, entao embrulhar o prototipo nao alcanca.
//   - a instancia do Terminal nao esta pendurada no fiber do React.
//
// Sobra o unico ponto por onde o texto passa de verdade: a resposta do XHR.
// O espiao embrulha o XMLHttpRequest dentro do webview, remonta os pacotes do
// engine.io, tira o ANSI e guarda so as linhas de erro numa fila. O painel
// drena essa fila a cada 4 s — nada se perde entre duas leituras, que era o
// defeito do leitor de viewport antigo.

// Cor NAO entra mais como criterio sozinho. O txAdmin pinta de vermelho ate
// linha de tabela — o primeiro teste real acusou "[script:rsg-inventory] ├─
// Total: 3" como erro. Palavra decide; a cor so reforça.
const MARCAS_ERRO = [
  'error', 'exception', 'traceback', 'fatal', 'failed', 'failure',
  'no such command', 'refused', 'timed out', 'cannot find', 'not found',
  'denied', 'crash'
];

// Moldura de tabela do txAdmin. Linha com isso e relatorio, nunca erro.
const RISCOS_DE_TABELA = '│├└┌┬┴┼─╭╮╰╯';

// Injetado uma vez por carregamento. Sem regex e sem barra invertida: o ESC do
// ANSI vem de String.fromCharCode(27), e o separador do engine.io de charCode 30.
const ESPIAO_XHR = `
(() => {
  if (window.__mesaVigia) return "ja estava";

  const MARCAS = ${JSON.stringify(MARCAS_ERRO)};
  const RISCOS = ${JSON.stringify(RISCOS_DE_TABELA)};
  const ESC = String.fromCharCode(27);
  const SEPARADOR = String.fromCharCode(30);

  const fila = [];
  let vistas = 0;

  // Tira as sequencias de cor do ANSI sem regex: acha o ESC, pula ate a letra
  // que fecha a sequencia, segue.
  function semCor(t) {
    if (t.indexOf(ESC) < 0) return t;
    let saida = "";
    let i = 0;
    while (i < t.length) {
      if (t.charCodeAt(i) === 27) {
        let j = i + 1;
        if (t.charAt(j) === "[") {
          j++;
          while (j < t.length && "0123456789;".indexOf(t.charAt(j)) >= 0) j++;
          j++;
        }
        i = j;
      } else {
        saida += t.charAt(i);
        i++;
      }
    }
    return saida;
  }

  // Vermelho do proprio terminal: 31 e o vermelho normal, 91 o brilhante.
  function pintadaDeVermelho(bruta) {
    return bruta.indexOf(ESC + "[31") >= 0 || bruta.indexOf(ESC + "[91") >= 0;
  }

  function ehErro(bruta, limpa) {
    // Moldura de tabela sai fora antes de qualquer coisa.
    for (let i = 0; i < RISCOS.length; i++) {
      if (limpa.indexOf(RISCOS.charAt(i)) >= 0) return false;
    }
    const t = limpa.toLowerCase();
    for (let i = 0; i < MARCAS.length; i++) if (t.indexOf(MARCAS[i]) >= 0) return true;
    return false;
  }

  function come(texto) {
    if (!texto) return;
    const partes = String(texto).split(SEPARADOR);
    for (const parte of partes) {
      // engine.io v4: 4 = mensagem, 2 = evento do socket.io. Sobra o JSON.
      if (parte.indexOf("42") !== 0) continue;
      let corpo = null;
      try { corpo = JSON.parse(parte.slice(2)); } catch (e) { continue; }
      if (!Array.isArray(corpo)) continue;
      for (const pedaco of corpo) {
        if (typeof pedaco !== "string" || !pedaco) continue;
        for (const bruta of pedaco.split(String.fromCharCode(10))) {
          const limpa = semCor(bruta).trim();
          if (!limpa) continue;
          vistas++;
          if (ehErro(bruta, limpa) && fila.length < 60) fila.push(limpa.slice(0, 300));
        }
      }
    }
  }

  const abrirOriginal = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    this.__mesaUrl = String(url || "");
    this.addEventListener("load", function () {
      if (this.__mesaUrl.indexOf("socket.io") < 0) return;
      try { come(this.responseText); } catch (e) {}
    });
    return abrirOriginal.apply(this, arguments);
  };

  window.__mesaVigia = {
    drenar: function () {
      const saida = fila.slice();
      fila.length = 0;
      return { erros: saida, vistas: vistas };
    }
  };
  return "ligado";
})()
`;

let diagVigia = false;
const jaAlertado = [new Set(), new Set()];
// A primeira drenagem traz tudo que ja estava na tela quando o painel abriu.
// Alarmar aquilo seria dar um susto por historico — anota como visto e cala.
const primeiraDrenagem = [true, true];

// Duas linhas de erro iguais chegam com carimbo de hora diferente, e o mesmo
// erro costuma vir com um numero diferente no meio ("timer interval of 166" e
// "de 185"). Dedupe por texto exato deixaria o painel alarmando a cada 5 s por
// causa do shard error do bot do Discord. A chave zera todo digito.
function chaveDoErro(linha) {
  let k = '';
  for (let i = 0; i < linha.length; i++) {
    const c = linha.charCodeAt(i);
    k += (c >= 48 && c <= 57) ? '#' : linha.charAt(i);
  }
  return k;
}

function alertaConsole(i, linhas) {
  const s = servidores[i];
  const onde = (s ? s.nome : 'servidor') + (ehLocal(s || {}) ? '' : ' · produção');
  document.querySelector('.tecla[data-modo="servidores"] .marcador').classList.add('aceso');
  const est = document.getElementById('est' + i);
  est.textContent = linhas.length + ' erro(s) no console';
  est.classList.add('ruim');
  window.api.alertaConsole({ onde: onde, indice: i, linhas: linhas });
  // No barramento Dev o log do Metro é o que ele está olhando: o aviso entra ali.
  if (modoAtual === 'dev') linhas.forEach(l => poeLog('— erro em ' + onde + ': ' + l));
}

async function vigiaErros() {
  for (let i = 0; i < 2; i++) {
    try {
      const wv = document.getElementById('wv' + i);
      const r = await wv.executeJavaScript(
        'window.__mesaVigia ? window.__mesaVigia.drenar() : null', false);

      if (!r) {
        // O espião cai junto com a página a cada navegação; repõe e segue.
        await wv.executeJavaScript(ESPIAO_XHR, false);
        continue;
      }

      if (!diagVigia && r.vistas > 0) {
        diagVigia = true;
        window.api.diag('vigia de console: ligado, ' + r.vistas + ' linha(s) lida(s) do XHR');
      }

      const novos = r.erros.filter(l => !jaAlertado[i].has(chaveDoErro(l)));
      novos.forEach(l => jaAlertado[i].add(chaveDoErro(l)));

      if (primeiraDrenagem[i]) {
        primeiraDrenagem[i] = false;
        if (novos.length) {
          window.api.diag('vigia ' + i + ': ' + novos.length + ' erro(s) já na tela ao abrir, silenciados');
        }
        continue;
      }
      if (!novos.length) continue;
      // O console remoto repete o mesmo erro a cada 5 s; sem esta poda o painel
      // vira um alarme continuo. Passou de 300 distintos, recomeça.
      if (jaAlertado[i].size > 300) jaAlertado[i] = new Set();
      alertaConsole(i, novos);
    } catch (e) {}
  }
  setTimeout(vigiaErros, 4000);
}
setTimeout(vigiaErros, 12000);


// Limpa a marca quando ele volta para o barramento dos servidores.
document.querySelector('.tecla[data-modo="servidores"]').addEventListener('click', () => {
  document.querySelector('.tecla[data-modo="servidores"] .marcador').classList.remove('aceso');
  [0, 1].forEach(i => {
    const est = document.getElementById('est' + i);
    if (est.textContent.indexOf('erro(s) no console') >= 0) {
      est.textContent = '';
      est.classList.remove('ruim');
    }
  });
});

// --------------------------------------------------------- dev: app ou web
// App sobe emulador + Metro. Web sobe o mesmo Metro em modo web e mostra a
// página num webview no lugar do vão do emulador.
let alvoDev = 'app';

function pintaAlvoDev() {
  document.getElementById('devApp').classList.toggle('on', alvoDev === 'app');
  document.getElementById('devWeb').classList.toggle('on', alvoDev === 'web');
  const ehApp = alvoDev === 'app';
  document.getElementById('vaoEmu').style.display = ehApp ? 'flex' : 'none';
  document.getElementById('wvWeb').style.display = ehApp ? 'none' : 'flex';
  document.getElementById('devAvd').style.display = ehApp ? '' : 'none';
  document.getElementById('devEncaixar').style.display = ehApp ? '' : 'none';
  document.getElementById('devTituloAlvo').textContent = ehApp ? 'Emulador' : 'Navegador';
  // Sair do app com o emulador aberto deixaria a janela por cima do painel.
  window.api.devMostrar(ehApp && modoAtual === 'dev');
  try { localStorage.setItem('alvoDev', alvoDev); } catch (e) {}
}

document.getElementById('devApp').addEventListener('click', () => { alvoDev = 'app'; pintaAlvoDev(); });
document.getElementById('devWeb').addEventListener('click', () => { alvoDev = 'web'; pintaAlvoDev(); });

try {
  const g = localStorage.getItem('alvoDev');
  if (g === 'web' || g === 'app') alvoDev = g;
} catch (e) {}
pintaAlvoDev();

// ------------------------------------------------------------- cota do Claude
// Na travessa não cabe (nem interessa) a cota inteira: só o que está apertando.
// Nada acima do limiar = mostra apenas o mais alto, para a travessa nunca ficar
// vazia e ele saber que a leitura está viva.
let cotaLimites = [];

// A faixa do meio volta ao formato do widget original: uma linha por limite,
// rótulo com o período, barra cheia, porcentagem e cronômetro do reset. É o que
// ele lia sem pensar antes desta migração toda.
function corDaBarra(pct) {
  if (pct >= 90) return 'var(--vermelho)';
  if (pct >= 70) return 'var(--ambar)';
  return 'var(--verde)';
}

function linhaLimite(l, opc) {
  const o = opc || {};
  const resets = l.resets && new Date(l.resets) - new Date() > 0 ? l.resets : '';
  const leitura = o.leitura != null ? o.leitura : l.pct + '<span class="u">%</span>';
  const cauda = o.fixo
    ? '<span class="fixo">' + esc(o.fixo) + '</span>'
    : (resets ? '<span class="contador" data-resets="' + resets + '"></span>' : '');
  return '<div class="limite">' +
    '<span class="lbl"><span class="nome">' + esc(l.rotulo) + '</span>' +
    '<span class="per">' + esc(l.periodo || '') + '</span></span>' +
    '<span class="trilho"><span class="cheio" style="transform:scaleX(' +
      (Math.max(0, Math.min(100, l.pct)) / 100) +
      ');background:' + (o.cor || corDaBarra(l.pct)) + '"></span></span>' +
    '<span class="pct">' + leitura + '</span>' +
    '<span class="rst">' + cauda + '</span>' +
  '</div>';
}

function pintaCotaBarra() {
  const alvo = document.getElementById('cotaBarra');
  if (!alvo) return;
  if (!cotaLimites.length) { alvo.innerHTML = ''; return; }
  alvo.innerHTML = cotaLimites.map(l => linhaLimite(l)).join('');
  atualizaContadores();
}

function atualizaContadores() {
  document.querySelectorAll('.contador[data-resets]').forEach(el => {
    const resta = new Date(el.dataset.resets) - new Date();
    if (!Number.isFinite(resta) || resta <= 0) { el.textContent = ''; return; }
    el.textContent = fmtRelogio(resta);
    const horas = resta / 3600000;
    el.className = 'contador' + (horas < 1 ? ' crit' : horas < 6 ? ' warn' : '');
  });
}

// Formato do widget antigo: cronômetro completo até virar dias.
function fmtRelogio(ms) {
  const t = Math.floor(ms / 1000);
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60), sg = t % 60;
  const pad = n => String(n).padStart(2, '0');
  if (d > 0) return d + 'd ' + pad(h) + 'h ' + pad(m) + 'm';
  return pad(h) + ':' + pad(m) + ':' + pad(sg);
}

// Sessão e Semana são as duas leituras que ele quer sempre na travessa: uma diz
// quanto sobra agora, a outra quanto sobra até domingo. O resto (Opus, Fable e o
// que a API inventar de modelo novo) só entra quando estiver apertando de
// verdade — antes disso a travessa caía no limite mais alto e mostrava um modelo
// qualquer no lugar do que interessa.
const FIXOS_TOPO = ['Sessão', 'Semana'];

// A cota saiu da travessa em 08/09/2026: quanto sobrou de token da IA é
// trabalho, e o topo passou a ser só navegação. A leitura continua no rodapé,
// dentro da Estação. A função fica porque o elemento pode voltar.
function pintaCotaTopo() {
  const alvo = document.getElementById('cotaTopo');
  if (!alvo) return;
  if (!cotaLimites.length) { alvo.innerHTML = ''; return; }
  const fixos = FIXOS_TOPO
    .map(nome => cotaLimites.find(l => l.rotulo === nome))
    .filter(Boolean);
  const apertados = cotaLimites
    .filter(l => l.pct >= LIMIAR_TOPO && !FIXOS_TOPO.includes(l.rotulo))
    .sort((a, b) => b.pct - a.pct);
  // Sem os fixos (API mudou de nome, resposta veio pela metade) a travessa não
  // pode ficar vazia: cai no comportamento antigo, o limite mais alto.
  const lista = fixos.concat(apertados);
  if (!lista.length) lista.push(cotaLimites.slice().sort((a, b) => b.pct - a.pct)[0]);
  // Tres cotas com cronometro nao cabem nos 1080 do monitor vertical: a travessa
  // passava dos 1117 px e o palco inteiro saia pela borda direita. Com um limite
  // apertado na fila, o que sai e o relogio de reset — a porcentagem fica.
  const comRelogio = lista.length <= 2;
  alvo.innerHTML = lista.map(l => {
    const resta = comRelogio && l.resets ? new Date(l.resets) - new Date() : 0;
    const classe = l.pct >= 90 ? ' critico' : l.pct >= 70 ? ' perto' : '';
    return '<span class="cota-item' + classe + '">' +
      '<span class="rot">' + esc(l.rotulo) + '</span>' +
      '<span class="fio"><i style="transform:scaleX(' + (l.pct / 100) + ')"></i></span>' +
      '<span class="pc">' + l.pct + '<span class="u">%</span></span>' +
      (resta > 0 ? '<span class="resta">' + fmtRestante(resta) + '</span>' : '') +
    '</span>';
  }).join('');
}

// Prateleira: lançamento do GTA VI, 19/11/2026 (data oficial da Rockstar depois
// do adiamento). Hora local, meia-noite — o dia é o que importa, não o minuto.
const LANC_GTA = new Date(2026, 10, 19, 0, 0, 0);

// Dias, horas e minutos. Sem segundos de propósito: a barra fica acesa no canto
// do olho o dia todo, e dígito virando toda hora ali é movimento à toa.
function pintaContagemGta() {
  const alvo = document.getElementById('gtaConta');
  if (!alvo) return;
  const resta = LANC_GTA - new Date();
  if (resta <= 0) {
    const hoje = new Date().toDateString() === LANC_GTA.toDateString();
    alvo.innerHTML = '<span class="cr chegou"><b>' + (hoje ? 'É hoje' : 'Lançado') +
      '</b><i>19 nov 2026</i></span>';
    return;
  }
  const t = Math.floor(resta / 1000);
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const cel = (v, rot) => '<span class="cr"><b class="num">' + v + '</b><i>' + rot + '</i></span>';
  alvo.innerHTML = cel(d, d === 1 ? 'dia' : 'dias') +
    cel(h, h === 1 ? 'hora' : 'horas') +
    cel(m, 'min');
}

function tickRestantes() {
  document.querySelectorAll('.sub[data-resets]').forEach(el => {
    const iso = el.dataset.resets;
    if (!iso) return;
    const resta = new Date(iso) - new Date();
    el.textContent = resta <= 0 ? 'resetando' : fmtRestante(resta);
    el.classList.toggle('agora', resta > 0 && resta < 3600000);
    el.classList.toggle('perto', resta >= 3600000 && resta < 6 * 3600000);
  });
  pintaCotaTopo();
  atualizaContadores();
  pintaContagemGta();
  const agora = new Date();
  const dia = agora.toLocaleDateString('pt-BR', { weekday: 'long' }).split('-')[0];
  const data = agora.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  document.getElementById('clockDia').textContent =
    dia.charAt(0).toUpperCase() + dia.slice(1) + ' · ' + data;
  document.getElementById('clock').textContent =
    agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const POLL_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
let temDados = false, backoffMs = 0, timerCota = null;

function renderCota(d) {
  const limites = [];
  const junta = (rotulo, periodo, info) => {
    if (!info) return;
    limites.push({
      rotulo,
      periodo,
      pct: Math.min(100, Math.round(info.utilization || 0)),
      resets: info.resets_at || ''
    });
  };
  junta('Sessão', '5h', d.five_hour);
  junta('Semana', '7d', d.seven_day);
  junta('Opus', '7d', d.seven_day_opus);
  for (const lim of d.limits || []) {
    const modelo = lim.scope && lim.scope.model && lim.scope.model.display_name;
    if (lim.group === 'weekly' && modelo) {
      junta(modelo, '7d', { utilization: lim.percent, resets_at: lim.resets_at });
    }
  }
  cotaLimites = limites;
  pintaCotaBarra();

  document.getElementById('content').innerHTML =
    limites.map(l => linhaLimite(l)).join('') ||
    '<div class="quieto">A API de uso não devolveu limites.</div>';
  tickRestantes();
}

async function atualizaCota() {
  if (timerCota) { clearTimeout(timerCota); timerCota = null; }
  const r = await window.api.getUsage();
  let espera = POLL_MS;
  if (r.error) {
    if (r.status === 429) {
      backoffMs = Math.min(backoffMs ? backoffMs * 2 : POLL_MS, MAX_BACKOFF_MS);
      espera = backoffMs;
    }
    if (!temDados) {
      document.getElementById('content').innerHTML = '<div class="quebrado">' + esc(r.error) + '</div>';
    }
  } else {
    backoffMs = 0;
    temDados = true;
    try { localStorage.setItem('lastUsage', JSON.stringify({ data: r.data, at: Date.now() })); } catch (e) {}
    renderCota(r.data);
  }
  timerCota = setTimeout(atualizaCota, espera);
}

try {
  const guardado = JSON.parse(localStorage.getItem('lastUsage'));
  if (guardado && guardado.data) { temDados = true; renderCota(guardado.data); }
} catch (e) {}
atualizaCota();
setInterval(tickRestantes, 1000);

// ------------------------------------------------------------- temperaturas
function corTemp(t, morno, quente) {
  if (t == null) return 'var(--serigrafia-fraca)';
  if (t >= quente) return 'var(--vermelho)';
  if (t >= morno) return 'var(--ambar)';
  return 'var(--verde)';
}

// Temperatura é medida: ganha a mesma barra da cota, só com as zonas do °C.
function canalTemp(rotulo, t, morno, quente) {
  if (t == null) return '';
  return linhaLimite(
    { rotulo: rotulo, periodo: '°C', pct: t, resets: '' },
    { leitura: t + '<span class="u">°</span>', cor: corTemp(t, morno, quente), fixo: quente + '° máx' }
  );
}

async function atualizaTemps() {
  let html = '', cpu = null, gpu = null;
  try {
    const r = await window.api.getTemps();
    if (r && !r.error) {
      cpu = r.cpu; gpu = r.gpu;
      html += canalTemp('CPU', r.cpu, 75, 90);
      html += canalTemp('GPU', r.gpu, 75, 84);
    }
  } catch (e) {}
  const caixa = document.getElementById('canaisTemp');
  caixa.innerHTML = html;
  caixa.style.display = html ? 'flex' : 'none';
  document.getElementById('seamTemp').style.display = html ? 'block' : 'none';

  const poe = (id, item, fioId, t, morno, quente) => {
    document.getElementById(item).style.display = t == null ? 'none' : 'flex';
    const el = document.getElementById(id);
    el.textContent = t == null ? '--' : t + '°';
    el.style.color = corTemp(t, morno, quente);
    const fio = document.getElementById(fioId);
    if (fio) {
      // Escala fixa de 30 a 100 °C: abaixo disso a máquina está fria e acima
      // ela já se desligou. Fio proporcional só dentro da faixa que existe.
      const p = t == null ? 0 : Math.max(0, Math.min(1, (t - 30) / 70));
      fio.style.transform = 'scaleX(' + p + ')';
      fio.style.background = corTemp(t, morno, quente);
    }
  };
  poe('cpuTemp', 'cpuItem', 'cpuFio', cpu, 75, 90);
  poe('gpuTemp', 'gpuItem', 'gpuFio', gpu, 75, 84);
  // Sem sensor nenhum a célula inteira sai: rótulo gravado sobre vazio é pior
  // que a chapa lisa.
  const celTemp = document.getElementById('celTemp');
  if (celTemp) celTemp.style.display = (cpu == null && gpu == null) ? 'none' : '';

  setTimeout(atualizaTemps, 3000);
}
atualizaTemps();

// Um momento de movimento só: o canal bate quando chega alerta; a marca fica.
function bate(moduloId, marcadorId) {
  const modulo = document.getElementById(moduloId);
  modulo.classList.add('batendo');
  document.getElementById(marcadorId).classList.add('aceso');
  setTimeout(() => modulo.classList.remove('batendo'), 60000);
}

// -------------------------------------------------------------------- Sentry
const COR_NIVEL = {
  fatal: 'var(--vermelho)', error: 'var(--vermelho)',
  warning: 'var(--ambar)', info: 'var(--azul)', debug: 'var(--serigrafia-fraca)'
};
let sy = { issues: [], novos: [], erro: null, atualizadoEm: null, alerta: null };
// Quem pegou cada erro. Guardado por issue porque a busca custa uma chamada por
// erro; sem cache, cada varredura refaria tudo.
const detalhesSentry = {};

async function buscaVitimas() {
  for (const i of sy.issues) {
    if (detalhesSentry[i.id] !== undefined) continue;
    detalhesSentry[i.id] = null;   // marca como em busca, evita pedir duas vezes
    try {
      const d = await window.api.sentryDetalhe(i.id);
      detalhesSentry[i.id] = d || { lugar: '', aparelho: '', sistema: '', versao: '', usuario: '' };
    } catch (e) {
      detalhesSentry[i.id] = { lugar: 'não deu para descobrir', aparelho: '', sistema: '', versao: '', usuario: '' };
    }
    renderSentry();
  }
}
let syAlertaEm = null, syAviso = false, syAvisoTimer = null;

function renderSentry() {
  const total = sy.issues.length;
  const novos = (sy.novos || []).length;
  const marcados = new Set(sy.novos || []);

  const cnt = document.getElementById('sentryCount');
  cnt.textContent = sy.erro ? '--' : (total === 0 ? 'limpo' : String(total));
  cnt.classList.toggle('limpo', total === 0 && !sy.erro);
  document.getElementById('ledSentry').className =
    'led' + (novos ? ' clip' : (total ? ' ambar' : ' verde'));
  document.getElementById('sentryWhen').textContent =
    sy.erro ? 'sem resposta' : (sy.atualizadoEm ? 'varrido ' + haQuanto(sy.atualizadoEm) : '');
  document.getElementById('sentryNovos').textContent =
    novos ? novos + (novos === 1 ? ' novo' : ' novos') : '';

  const aviso = (syAviso && sy.alerta)
    ? '<div class="aviso">' + icone('alerta') + '<span>' + esc(sy.alerta.resumo) + '</span></div>'
    : '';
  const fita = document.getElementById('sentryList');
  if (!total) {
    fita.innerHTML = aviso + (sy.erro
      ? '<div class="quebrado">Sentry não respondeu: ' + esc(sy.erro) + '</div>'
      : '<div class="quieto">Nenhum erro em aberto nos últimos 90 dias.</div>');
    return;
  }
  fita.innerHTML = aviso + sy.issues.map(i => {
    const ev = i.eventos + (i.eventos === 1 ? ' evento' : ' eventos');
    const us = i.usuarios ? ' · ' + i.usuarios + (i.usuarios === 1 ? ' usuário' : ' usuários') : '';
    const cor = COR_NIVEL[i.nivel] || 'var(--ambar)';
    const d = detalhesSentry[i.id];
    // Mesma anatomia da anotação: marca colorida no lugar do avatar, projeto no
    // lugar do nome, data em destaque e o corpo abaixo.
    const vitima = d
      ? [d.lugar, d.aparelho, d.sistema, d.versao].filter(Boolean).join(' · ')
      : 'procurando quem pegou o erro…';
    return '<div class="dc-msg linha' + (marcados.has(i.id) ? ' nova' : '') + '" data-id="' + esc(i.id) + '">' +
      '<span class="dc-marca-nivel" style="color:' + cor + '" title="' + esc(i.plataforma || 'plataforma desconhecida') + '">' +
        icone(marcaPlataforma(i.plataforma, i.titulo)) + '</span>' +
      '<div class="dc-corpo">' +
        '<div class="dc-cabeca">' +
          '<span class="dc-nome" style="color:' + cor + '">' + esc(i.projeto) + '</span>' +
          '<span class="dc-nivel">' + esc((i.nivel || '').toUpperCase()) + '</span>' +
        '</div>' +
        '<div class="dc-quando">' + (fmtQuando(i.ultimo) || '—') +
          '<span class="atras">há ' + haQuanto(i.ultimo) + '</span></div>' +
        '<div class="dc-titulo">' + esc(i.titulo) + '</div>' +
        '<div class="dc-vitima">' + esc(vitima) +
          (d && d.usuario ? '<span class="quem">usuário ' + esc(d.usuario) + '</span>' : '') +
        '</div>' +
        (i.detalhe ? '<div class="dc-cru">' + esc(i.detalhe) + '</div>' : '') +
        '<div class="dc-rodape">' + ev + us + ' · desde ' + (fmtDataHora(i.primeiro) || '—') +
          ' · ' + esc(i.shortId) + '</div>' +
      '</div>' +
      '<div class="acoes">' +
        '<button class="botao" data-act="abrir" data-link="' + esc(i.link) + '" title="Abrir no Sentry" aria-label="Abrir no Sentry">' + icone('sai') + '</button>' +
        '<button class="botao" data-act="resolver" title="Marcar como resolvido" aria-label="Marcar como resolvido">' + icone('ok') + '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

document.getElementById('sentryList').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('.botao');
  if (!btn) return;
  if (btn.dataset.act === 'abrir') return window.api.sentryOpen(btn.dataset.link);
  // Resolver escreve no Sentry de verdade: pede o segundo clique.
  if (!btn.classList.contains('confirma-morna')) {
    btn.classList.add('confirma-morna');
    btn.innerHTML = '<span class="rot">Confirmar</span>';
    clearTimeout(btn._t);
    btn._t = setTimeout(() => {
      btn.classList.remove('confirma-morna');
      btn.innerHTML = icone('ok');
    }, 4000);
    return;
  }
  clearTimeout(btn._t);
  btn.disabled = true;
  const linha = btn.closest('.dc-msg') || btn.closest('.linha');
  cardTrabalhando(linha, 'resolvendo no Sentry…');
  const r = await window.api.sentryResolve(btn.closest('.linha').dataset.id, 'resolved');
  if (!r || !r.ok) {
    btn.disabled = false;
    btn.classList.remove('confirma-morna');
    btn.innerHTML = icone('ok');
    cardPronto(linha, (r && r.error) || 'não deu para resolver', true);
    return;
  }
  if (linha) linha.classList.add('resolvida');
  cardPronto(linha, 'resolvido');
});

document.getElementById('sentryRefresh').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.classList.add('girando');
  sy = await window.api.sentryRefresh();
  btn.classList.remove('girando');
  window.api.sentrySeen();
  sy.novos = [];
  document.getElementById('marcadorMonitor').classList.remove('aceso');
  renderSentry();
});

window.api.onSentry((p) => {
  const novo = p.alerta && p.alerta.em !== syAlertaEm;
  sy = p;
  if (novo) {
    syAlertaEm = p.alerta.em;
    syAviso = true;
    bate('blocoSentry', 'marcadorMonitor');
    clearTimeout(syAvisoTimer);
    syAvisoTimer = setTimeout(() => { syAviso = false; renderSentry(); }, 60000);
  }
  renderSentry();
});

(async () => {
  sy = await window.api.sentryGet();
  syAlertaEm = sy.alerta ? sy.alerta.em : null;
  renderSentry();
})();

// ------------------------------------------------- anotações do Michigan
let dc = { total: 0, pendentes: [], novos: [], erro: null, atualizadoEm: null, alerta: null };
let dcAlertaEm = null, dcAviso = false, dcAvisoTimer = null;

// Anotacao clicada sai da tela na hora, antes de o Discord responder: ele
// despacha uma atras da outra sem esperar rede. O id fica aqui ate a resposta
// chegar; se o Discord recusar, a anotacao volta para o lugar com o motivo.
const dcOcultos = new Set();

function dcSome(id) {
  if (!id) return;
  dcOcultos.add(id);
  renderDiscord();
}

function dcVolta(id, motivo) {
  dcOcultos.delete(id);
  renderDiscord();
  const linha = document.querySelector('.dc-msg[data-id="' + id + '"]');
  if (linha) cardPronto(linha, motivo, true);
}

function renderDiscord() {
  const pend = (dc.pendentes || []).filter(p => !dcOcultos.has(p.id));
  const novos = (dc.novos || []).length;
  const marcados = new Set(dc.novos || []);

  const cnt = document.getElementById('dcCount');
  cnt.textContent = dc.erro ? '--' : (pend.length === 0 ? 'em dia' : String(pend.length));
  cnt.classList.toggle('limpo', pend.length === 0 && !dc.erro);
  document.getElementById('ledDiscord').className =
    'led' + (novos ? ' clip' : (pend.length ? ' ambar' : ' verde'));
  document.getElementById('dcWhen').textContent =
    dc.erro ? 'sem resposta' : (dc.total ? dc.total + ' no canal' : '');
  document.getElementById('dcNovos').textContent =
    novos ? novos + (novos === 1 ? ' nova' : ' novas') : '';

  const aviso = (dcAviso && dc.alerta)
    ? '<div class="aviso">' + icone('alerta') + '<span>' + esc(dc.alerta.resumo) + '</span></div>'
    : '';
  const fita = document.getElementById('dcList');
  if (!pend.length) {
    fita.innerHTML = aviso + (dc.erro
      ? '<div class="quebrado">Discord não respondeu: ' + esc(dc.erro) + '</div>'
      : '<div class="quieto">Tudo reagido — nada pendente.</div>');
    return;
  }
  // Fora da janela a lista é resumo de barra; dentro dela a anotação aparece
  // como aparece no Discord — avatar, nome na cor do cargo, hora e a imagem
  // inline. É lá que ele lê de verdade, e ler recado picotado não serve.
  const semTexto = pend.every(p => !p.texto);
  fita.innerHTML = aviso + pend.map(p => {
    const quando = fmtQuando(p.em);
    const imagens = (p.imagens || []).map(im =>
      '<img class="dc-imagem" src="' + esc(im.url) + '" alt="' + esc(im.nome || 'imagem') + '" loading="lazy">'
    ).join('');
    const anexos = (p.anexos || []).map(a =>
      '<a class="dc-anexo" href="#" data-link="' + esc(p.link) + '">' + esc(a.nome) + '</a>'
    ).join('');
    return '<div class="dc-msg linha' + (marcados.has(p.id) ? ' nova' : '') +
      '" data-id="' + esc(p.id) + '">' +
      '<img class="dc-avatar" src="' + esc(p.avatar || '') + '" alt="" loading="lazy">' +
      '<div class="dc-corpo">' +
        '<div class="dc-cabeca">' +
          '<span class="dc-nome"' + (p.cor ? ' style="color:' + esc(p.cor) + '"' : '') + '>' +
            esc(p.autor) + '</span>' +
          (p.encaminhada ? '<span class="dc-marca">encaminhou</span>' : '') +
        '</div>' +
        '<div class="dc-quando">' + quando +
          '<span class="atras">há ' + haQuanto(p.em) + '</span></div>' +
        (p.texto ? '<div class="dc-texto">' + esc(p.texto) + '</div>' : '') +
        (imagens ? '<div class="dc-anexos">' + imagens + '</div>' : '') +
        (anexos ? '<div class="dc-arquivos">' + anexos + '</div>' : '') +
      '</div>' +
      '<div class="acoes dc-acoes" data-id="' + esc(p.id) + '">' +
        '<button class="botao reagir" data-emoji="\u{1F44D}" title="Reagir com joinha — resolvido">' +
          '<span class="emoji">\u{1F44D}</span></button>' +
        '<button class="botao reagir" data-emoji="\u274C" title="Reagir com X — não vai ser feito, sem explicação">' +
          '<span class="emoji">\u274C</span></button>' +
        '<button class="botao recusa" title="X com motivo — abre o tópico explicando e só então marca o X">' +
          '<span class="emoji">\u274C</span>' + icone('topico') + '</button>' +
        '<button class="botao topico" title="Abrir tópico nesta anotação e já responder">' +
          icone('topico') + '</button>' +
        '<button class="botao copiar" title="Copiar a mensagem inteira para colar na IA">' +
          icone('copiar') + '</button>' +
        '<button class="botao" data-link="' + esc(p.link) + '" title="Abrir no Discord" aria-label="Abrir no Discord">' + icone('sai') + '</button>' +
      '</div>' +
    '</div>';
  }).join('') + (semTexto
    ? '<div class="nota">Nenhuma das pendentes trouxe texto. Se isso persistir, o ' +
      '<b>Message Content Intent</b> do bot pode ter caído.</div>'
    : '');
}

// Monta o bloco que vai para a área de transferência: tudo que a IA precisa
// para entender o caso sem ele ter que reescrever nada.
function contextoDaMensagem(p) {
  const linhas = [
    'Anotação do servidor Michigan Roleplay — canal anotacoes-season4',
    'Autor: ' + p.autor,
    'Data: ' + fmtDataHora(p.em) + (p.encaminhada ? '  (encaminhada de outro canal)' : ''),
    'Link: ' + p.link,
    '',
    p.texto || '(sem texto)'
  ];
  if ((p.imagens || []).length) {
    linhas.push('', 'Imagens anexadas:');
    p.imagens.forEach(im => linhas.push('  ' + im.url));
  }
  if ((p.anexos || []).length) {
    linhas.push('', 'Outros anexos:');
    p.anexos.forEach(a => linhas.push('  ' + a.nome + ' - ' + a.url));
  }
  return linhas.join('\n');
}

// O card inteiro sinaliza que algo está acontecendo. Botão sozinho é pequeno
// demais para ele perceber, e sem sinal a espera parece travamento.
function cardTrabalhando(el, texto) {
  if (!el) return;
  el.classList.add('trabalhando');
  let faixa = el.querySelector('.dc-status');
  if (!faixa) {
    faixa = document.createElement('div');
    faixa.className = 'dc-status';
    el.appendChild(faixa);
  }
  faixa.textContent = texto;
}

function cardPronto(el, texto, ruim) {
  if (!el) return;
  el.classList.remove('trabalhando');
  const faixa = el.querySelector('.dc-status');
  if (!faixa) return;
  if (!texto) { faixa.remove(); return; }
  faixa.textContent = texto;
  faixa.classList.toggle('ruim', !!ruim);
  if (!ruim) setTimeout(() => { if (faixa.parentElement) faixa.remove(); }, 2500);
}

// Aviso curto no próprio botão, sem roubar foco nem abrir caixa.
function marcaFeito(btn, texto) {
  const antes = btn.innerHTML;
  btn.innerHTML = '<span class="rot">' + texto + '</span>';
  btn.classList.add('confirma-morna');
  setTimeout(() => {
    btn.innerHTML = antes;
    btn.classList.remove('confirma-morna');
  }, 1600);
}

document.getElementById('dcList').addEventListener('click', async (ev) => {
  const anexo = ev.target.closest('.dc-anexo');
  if (anexo) { ev.preventDefault(); return window.api.abrirUrl(anexo.dataset.link); }

  const btn = ev.target.closest('.botao');
  if (!btn) return;
  ev.preventDefault();
  const caixa = btn.closest('.dc-acoes');
  const id = caixa && caixa.dataset.id;
  const item = (dc.pendentes || []).find(x => x.id === id);

  if (btn.classList.contains('copiar')) {
    if (!item) return;
    const linha = btn.closest('.dc-msg');
    try {
      await navigator.clipboard.writeText(contextoDaMensagem(item));
      marcaFeito(btn, 'copiado');
      cardPronto(linha, 'contexto copiado');
    } catch (e) {
      marcaFeito(btn, 'falhou');
      cardPronto(linha, 'não deu para copiar', true);
    }
    return;
  }

  if (btn.classList.contains('recusa')) {
    // X com motivo: recusar calado deixa o time no escuro daqui a um mês. O
    // motivo vira a primeira mensagem do tópico e só depois disso o X é
    // registrado. O X seco, ao lado, resolve o que não merece explicação.
    if (item) abreTopico(item, true);
    return;
  }

  if (btn.classList.contains('reagir')) {
    // Um clique só: reagir é reversível (a outra reação apaga esta), então
    // pedir confirmação era fricção à toa — e virou o motivo de a reação nunca
    // chegar a sair.
    //
    // A anotação sai da tela no clique, sem esperar as duas chamadas do Discord
    // (DELETE da reação contrária + PUT da nova): a fila anda enquanto a rede
    // trabalha. Só volta se a reação falhar, aí com o motivo na linha.
    const emoji = btn.dataset.emoji;
    dcSome(id);
    window.api.discordReagir(id, emoji).then(r => {
      if (!r || !r.ok) dcVolta(id, (r && r.error) || 'não deu para reagir');
    }).catch(e => dcVolta(id, e.message || 'não deu para reagir'));
    return;
  }

  if (btn.classList.contains('topico')) {
    if (item) abreTopico(item);
    return;
  }

  if (btn.dataset.link) window.api.abrirUrl(btn.dataset.link);
});

document.getElementById('dcRefresh').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.classList.add('girando');
  dc = await window.api.discordRefresh();
  btn.classList.remove('girando');
  window.api.discordSeen();
  dc.novos = [];
  renderDiscord();
});

window.api.onDiscord((p) => {
  const novo = p.alerta && p.alerta.em !== dcAlertaEm;
  dc = p;
  // Reação confirmada: o backend já tirou a anotação da lista, então o id não
  // precisa mais ser escondido à mão.
  const vivas = new Set((p.pendentes || []).map(x => x.id));
  for (const id of Array.from(dcOcultos)) if (!vivas.has(id)) dcOcultos.delete(id);
  if (novo) {
    dcAlertaEm = p.alerta.em;
    dcAviso = true;
    bate('blocoDiscord', 'marcadorMonitor');
    clearTimeout(dcAvisoTimer);
    dcAvisoTimer = setTimeout(() => { dcAviso = false; renderDiscord(); }, 60000);
  }
  renderDiscord();
});

(async () => {
  dc = await window.api.discordGet();
  dcAlertaEm = dc.alerta ? dc.alerta.em : null;
  renderDiscord();
})();

setInterval(() => { renderSentry(); renderDiscord(); }, 30000);

const XIS_EMOJI = '❌';

// --- tópico com resposta ---------------------------------------------------
// Cria a thread na anotação e já deixa a primeira mensagem dentro. Quem fala é
// o bot, mas quem escreve é o Alexandre: o texto vai como ele digitou, sem
// prefixo de robô. Por isso o botão só dispara depois de ele revisar no modal.
const topicoModal = document.getElementById('topicoModal');
let topicoAlvo = null;

let topicoRecusa = false;

function abreTopico(item, recusando) {
  topicoAlvo = item;
  topicoRecusa = !!recusando;
  const base = (item.texto || 'Anotação de ' + item.autor).replace(/\s+/g, ' ').trim();
  document.getElementById('topicoNome').value = base.slice(0, 90);
  document.getElementById('topicoResposta').value = '';
  document.getElementById('topicoDe').textContent = item.autor + ' · ' + fmtDataHora(item.em);
  document.getElementById('topicoTexto').textContent = item.texto || '(sem texto)';

  document.getElementById('topicoTitulo').textContent = recusando
    ? 'Por que não vai ser feito?'
    : 'Abrir tópico na anotação';
  document.getElementById('topicoRotuloResposta').textContent = recusando
    ? 'Motivo da recusa'
    : 'Sua resposta';
  document.getElementById('topicoResposta').placeholder = recusando
    ? 'explique por que isso não vai ser feito — vira a primeira mensagem do tópico'
    : 'escreva aqui — sai pelo bot, no seu nome';
  document.getElementById('topicoOk').textContent = recusando
    ? 'Registrar e marcar ❌'
    : 'Criar e responder';
  document.getElementById('topicoNota').textContent = recusando
    ? 'O motivo vira o tópico e o ❌ é marcado depois que ele for publicado.'
    : 'A mensagem sai pelo bot, no seu nome. O tópico se arquiva sozinho em 24 h.';
  abre(topicoModal);
  setTimeout(() => document.getElementById('topicoResposta').focus(), 60);
}

document.getElementById('topicoCancel').addEventListener('click', () => fecha(topicoModal));
topicoModal.addEventListener('click', (e) => { if (e.target === topicoModal) fecha(topicoModal); });

document.getElementById('topicoOk').addEventListener('click', async () => {
  if (!topicoAlvo) return;
  const btn = document.getElementById('topicoOk');
  const nome = document.getElementById('topicoNome').value.trim();
  const resposta = document.getElementById('topicoResposta').value;
  if (!nome) {
    document.getElementById('topicoNota').textContent = 'O tópico precisa de um nome.';
    return;
  }
  if (topicoRecusa && !resposta.trim()) {
    document.getElementById('topicoNota').textContent = 'Escreva o motivo antes de marcar o ❌.';
    return;
  }
  const alvo = topicoAlvo;

  // Recusa: fecha na hora e some da lista, que é o ponto — ele despacha a fila
  // inteira sem esperar o Discord. O motivo é publicado e o ❌ registrado em
  // segundo plano; se qualquer um dos dois falhar, a anotação volta para a
  // lista e o modal reabre com o texto que ele escreveu.
  if (topicoRecusa) {
    fecha(topicoModal);
    dcSome(alvo.id);
    document.getElementById('dcWhen').textContent = 'recusada com motivo';
    try {
      const r = await window.api.discordTopico(alvo.id, nome, resposta);
      if (!r || !r.ok) throw new Error((r && r.error) || 'não deu para criar o tópico');
      // O ❌ só entra depois que o motivo está publicado: se a ordem invertesse
      // e a mensagem falhasse, a anotação sairia da lista sem explicação.
      const rr = await window.api.discordReagir(alvo.id, XIS_EMOJI);
      if (!rr || !rr.ok) {
        throw new Error('tópico criado, mas o ❌ não entrou: ' +
          ((rr && rr.error) || 'motivo desconhecido'));
      }
    } catch (e) {
      dcVolta(alvo.id, e.message || 'a recusa não foi registrada');
      abreTopico(alvo, true);
      document.getElementById('topicoNome').value = nome;
      document.getElementById('topicoResposta').value = resposta;
      document.getElementById('topicoNota').textContent = e.message || 'a recusa não foi registrada';
    }
    return;
  }

  btn.disabled = true;
  const rotuloAntes = btn.textContent;
  btn.textContent = 'Criando o tópico…';
  const r = await window.api.discordTopico(alvo.id, nome, resposta);
  btn.textContent = rotuloAntes;
  btn.disabled = false;
  if (!r || !r.ok) {
    document.getElementById('topicoNota').textContent = (r && r.error) || 'não deu para criar o tópico';
    return;
  }
  fecha(topicoModal);
  document.getElementById('dcWhen').textContent = 'tópico criado';
  setTimeout(() => renderDiscord(), 2500);
});

// --------------------------------------------------------------- manutenção
const maintBtns = Array.from(document.querySelectorAll('[data-maint]'));
const maintStatus = document.getElementById('maintStatus');
const maintModal = document.getElementById('maintModal');
let maintPoll = null, maintTicks = 0;

function fimManut() {
  if (maintPoll) { clearInterval(maintPoll); maintPoll = null; }
  maintBtns.forEach(b => { b.disabled = false; b.classList.remove('girando'); });
}
function mostraManut(txt, on) {
  maintStatus.textContent = txt;
  maintStatus.classList.toggle('on', !!on);
}
async function acompanhaManut() {
  maintTicks++;
  const s = await window.api.getMaintenance();
  const comecou = s && Array.isArray(s.steps) && s.steps.length;
  if (comecou) {
    const linhas = s.steps.map(st => '· ' + st.name + (st.freedMB > 0 ? ' — ' + st.freedMB + ' MB' : ''));
    const total = s.steps.reduce((a, st) => a + (st.freedMB || 0), 0);
    mostraManut((s.running ? 'Limpando…' : 'Pronto · ' + total.toFixed(1) + ' MB liberados') +
      '\n' + linhas.join('\n'), true);
  }
  if (s && !s.running) {
    fimManut();
    setTimeout(() => mostraManut('', false), 8000);
    return;
  }
  if (!comecou && maintTicks > 26) {
    fimManut();
    mostraManut('Não começou — o manutencao.sh não subiu; veja o mirante.log.', true);
    setTimeout(() => mostraManut('', false), 6000);
  }
}

maintBtns.forEach(b => b.addEventListener('click', () => { if (!b.disabled) abre(maintModal); }));
document.getElementById('maintCancel').addEventListener('click', () => fecha(maintModal));
maintModal.addEventListener('click', (e) => { if (e.target === maintModal) fecha(maintModal); });
document.getElementById('maintOk').addEventListener('click', async () => {
  fecha(maintModal);
  maintBtns.forEach(b => { b.disabled = true; b.classList.add('girando'); });
  mostraManut('Disparando a manutenção…', true);
  const r = await window.api.runMaintenance();
  if (!r || !r.launched) {
    fimManut();
    mostraManut('Não deu para iniciar: ' + ((r && r.error) || 'motivo desconhecido'), true);
    return;
  }
  if (maintPoll) clearInterval(maintPoll);
  maintTicks = 0;
  maintPoll = setInterval(acompanhaManut, 1500);
});

// ---------------------------------------------------------------- credencial
const authModal = document.getElementById('authModal');
const authUrl = document.getElementById('authUrl');
const authKey = document.getElementById('authKey');
const authNote = document.getElementById('authNote');
const apiFields = document.getElementById('apiFields');
const optMax = document.getElementById('optMax');
const optApi = document.getElementById('optApi');
const chaveMax = document.getElementById('chaveMax');
const chaveApi = document.getElementById('chaveApi');
let authMode = 'max', authAtual = null;

function pintaModo(m) {
  authMode = m;
  optMax.classList.toggle('on', m === 'max');
  optApi.classList.toggle('on', m === 'api');
  apiFields.style.display = m === 'api' ? 'block' : 'none';
}
function pintaChave(m) {
  chaveMax.classList.toggle('on', m === 'max');
  chaveApi.classList.toggle('on', m === 'api');
}
async function carregaAuth() {
  try { authAtual = await window.api.getAuth(); pintaChave(authAtual.mode); } catch (e) {}
  return authAtual;
}
function abreAuth(a, forcar) {
  authUrl.value = a.baseUrl || a.defaultUrl || '';
  authKey.value = '';
  authKey.placeholder = a.keyHint ? 'salva: ' + a.keyHint : 'colar chave';
  authNote.textContent = 'Grava no settings.json e nas variáveis de ambiente. Vale na próxima sessão do Claude Code.';
  pintaModo(forcar || a.mode);
  abre(authModal);
}
optMax.addEventListener('click', () => pintaModo('max'));
optApi.addEventListener('click', () => pintaModo('api'));

async function trocaCredencial(alvo) {
  const a = await carregaAuth() || { mode: 'max' };
  if (alvo === 'api' && !a.keyHint) return abreAuth(a, 'api');
  const r = await window.api.setAuth({ mode: alvo, baseUrl: a.baseUrl || a.defaultUrl, key: '' });
  if (!r || !r.ok) {
    mostraManut('Não deu para trocar: ' + ((r && r.error) || 'motivo desconhecido'), true);
    setTimeout(() => mostraManut('', false), 6000);
    return;
  }
  pintaChave(r.mode);
  avisaTroca(r.mode);
}
chaveMax.addEventListener('click', () => trocaCredencial('max'));
chaveApi.addEventListener('click', () => trocaCredencial('api'));
[chaveMax, chaveApi].forEach(b => b.addEventListener('contextmenu', async (e) => {
  e.preventDefault();
  abreAuth(await carregaAuth() || { mode: 'max' });
}));

function avisaTroca(m) {
  mostraManut((m === 'api' ? 'Modo API ligado.' : 'Modo assinatura Max ligado.') +
    '\nVale na próxima sessão do Claude Code.', true);
  setTimeout(() => mostraManut('', false), 6000);
}
document.getElementById('authCancel').addEventListener('click', () => fecha(authModal));
authModal.addEventListener('click', (e) => { if (e.target === authModal) fecha(authModal); });
document.getElementById('authOk').addEventListener('click', async () => {
  const btn = document.getElementById('authOk');
  btn.disabled = true;
  const r = await window.api.setAuth({ mode: authMode, baseUrl: authUrl.value, key: authKey.value });
  btn.disabled = false;
  if (!r || !r.ok) {
    authNote.textContent = 'Não deu certo: ' + ((r && r.error) || 'motivo desconhecido');
    return;
  }
  pintaChave(r.mode);
  fecha(authModal);
  avisaTroca(r.mode);
});
carregaAuth();

// Volta no barramento em que ele estava. O padrão é o Mirante: é a página que
// fica na tela quando ninguém pediu nada.
let modoInicial = 'mirante';
try {
  const guardado = localStorage.getItem('modo');
  if (guardado && ['mirante', 'servidores', 'dev', 'monitor'].indexOf(guardado) >= 0) modoInicial = guardado;
} catch (e) {}
trocaModo('mirante');
tickRestantes();

// ------------------------------------------------------- trava do teclado
// Para limpar o teclado sem desligar o PC: engole toda tecla por 2 minutos.
// Sai de tres jeitos — clicar de novo, o tempo acabar, ou Ctrl+Alt+Del (o
// Windows nunca deixa um hook comum segurar essa sequencia).
const TRAVA_SEG = 120;
const tecladoBtn = document.getElementById('tecladoBtn');
const tecladoRot = document.getElementById('tecladoRot');
let tecladoAte = 0, tecladoRelogio = null;

function pintaTeclado() {
  const falta = tecladoAte ? Math.max(0, Math.ceil((tecladoAte - Date.now()) / 1000)) : 0;
  if (falta > 0) {
    tecladoBtn.classList.add('travado');
    // So o numero: "Liberar 118s" empurrava a banca inteira a cada segundo.
    tecladoRot.textContent = falta + 's';
    tecladoBtn.title = 'Teclado travado — clique para liberar agora';
  } else {
    tecladoAte = 0;
    tecladoBtn.classList.remove('travado');
    tecladoRot.textContent = 'Teclado';
    tecladoBtn.title = 'Travar o teclado por 2 minutos para limpar';
    if (tecladoRelogio) { clearInterval(tecladoRelogio); tecladoRelogio = null; }
  }
}

function ligaRelogioTeclado() {
  if (tecladoRelogio) clearInterval(tecladoRelogio);
  tecladoRelogio = setInterval(pintaTeclado, 500);
  pintaTeclado();
}

tecladoBtn.addEventListener('click', async () => {
  if (tecladoBtn.disabled) return;
  if (tecladoAte) {
    await window.api.tecladoSoltar();
    tecladoAte = 0;
    pintaTeclado();
    return;
  }
  tecladoBtn.disabled = true;
  const r = await window.api.tecladoTravar(TRAVA_SEG);
  tecladoBtn.disabled = false;
  if (!r || !r.ok) {
    tecladoRot.textContent = 'Falhou';
    setTimeout(pintaTeclado, 2500);
    return;
  }
  tecladoAte = r.ate || (Date.now() + TRAVA_SEG * 1000);
  ligaRelogioTeclado();
});

// Painel recarregado no meio da trava tem que reencontrar o estado.
(async () => {
  const e = await window.api.tecladoEstado();
  if (e && e.travado) { tecladoAte = e.ate; ligaRelogioTeclado(); }
})();

// ------------------------------------------------------------ telas e painel
// Duas teclas sem resposta para dar: a tela apaga (e você não está mais olhando)
// e o painel morre para renascer. Ambas ficam âmbar por um instante só para o
// clique não parecer perdido.
function piscaFeito(btn, rot, texto, volta) {
  const antes = rot.textContent;
  btn.classList.add('feito');
  rot.textContent = texto;
  setTimeout(() => {
    btn.classList.remove('feito');
    rot.textContent = volta || antes;
  }, 2200);
}

const telasBtn = document.getElementById('telasBtn');
const telasRot = document.getElementById('telasRot');
telasBtn.addEventListener('click', async () => {
  // O atraso mora no script: se apagasse na hora, o resto do movimento do mouse
  // acenderia a tela de volta antes de você tirar a mão.
  piscaFeito(telasBtn, telasRot, 'Apagando', 'Telas');
  const r = await window.api.telasDormir();
  if (!r || !r.ok) piscaFeito(telasBtn, telasRot, 'Falhou', 'Telas');
});

const painelBtn = document.getElementById('painelBtn');
const painelRot = document.getElementById('painelRot');
let painelArmado = false;
painelBtn.addEventListener('click', async () => {
  // Segundo clique: reiniciar no meio de um comando no console é perda de vista,
  // não de dado, mas ainda assim não pode sair por esbarrão.
  if (!painelArmado) {
    painelArmado = true;
    painelBtn.classList.add('feito');
    painelRot.textContent = 'Confirmar';
    setTimeout(() => {
      if (!painelArmado) return;
      painelArmado = false;
      painelBtn.classList.remove('feito');
      painelRot.textContent = 'Painel';
    }, 4000);
    return;
  }
  painelArmado = false;
  painelBtn.classList.add('girando');
  painelRot.textContent = 'Subindo';
  await window.api.painelReiniciar();
});
