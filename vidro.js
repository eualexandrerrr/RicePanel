// Vidro — o desfoque atrás das placas do Mirante.
//
// O problema: a página do Mirante quer as duas coisas ao mesmo tempo — papel de
// parede NÍTIDO onde não há widget, e vidro desfocado atrás de cada placa.
// Nenhum dos dois caminhos óbvios entrega isso:
//
//   `backdrop-filter` do CSS só desfoca o que está pintado dentro da própria
//   página, e atrás desta janela não há nada pintado — há o compositor. Numa
//   janela transparente ele não faz nada.
//
//   `blur` do Hyprland desfoca a janela inteira. Como o painel ocupa o monitor
//   todo, ligar blur borra o wallpaper de ponta a ponta, inclusive onde a
//   página é totalmente transparente (o `ignore_alpha` que separa as zonas é de
//   regra de LAYER, não de janela).
//
// A saída é fazer o desfoque nós mesmos: descobrir qual imagem o daemon de
// wallpaper está mostrando no monitor vertical, gerar uma cópia desfocada com
// ffmpeg e entregá-la ao renderer. Lá ela entra como `background-image` das
// placas com `background-attachment: fixed`, que ancora o fundo na viewport —
// então cada placa mostra exatamente o pedaço de wallpaper que está atrás dela.
// É backdrop-filter de verdade, só calculado fora.
//
// Vantagem sobre o blur do compositor: o desfoque existe SÓ onde há placa. O
// resto da tela continua com o papel de parede que ele escolheu, sem véu.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SIGMA = 34;          // desfoque; alto o bastante para virar material
const ESCURECE = -0.05;    // um toque abaixo: vidro escuro lê melhor de longe
const RECHECA_MS = 60000;  // ele troca de wallpaper pelo menu; isto acompanha

let deps = null;           // { app, log, empurra }
let estado = { arquivo: null, origem: null, largura: 0, altura: 0 };
let gerando = false;

function log(msg) {
  if (deps && deps.log) deps.log('vidro: ' + msg);
}

function roda(cmd, args, ms) {
  return new Promise((resolve) => {
    let pronto = false;
    const fim = (s) => { if (!pronto) { pronto = true; resolve(s); } };
    let p;
    try {
      p = execFile(cmd, args, { timeout: ms || 8000, maxBuffer: 2 * 1024 * 1024 },
        (err, out) => fim(err && !out ? '' : String(out || '')));
    } catch (e) {
      return fim('');
    }
    p.on('error', () => fim(''));
  });
}

// `awww query` devolve uma linha por monitor:
//   ": DP-3: 1080x1920, scale: 1, currently displaying: image: /caminho.jpg"
// Pega a linha do monitor em pé — é onde o painel mora. Largura menor que a
// altura é o critério, o mesmo do resto do app; nome de saída não serve porque
// muda de máquina para máquina.
async function wallpaperDoMonitorEmPe() {
  const out = await roda('awww', ['query'], 5000);
  if (!out) return null;
  for (const linha of out.split('\n')) {
    const m = linha.match(/:\s*([\w-]+):\s*(\d+)x(\d+).*?image:\s*(.+?)\s*$/);
    if (!m) continue;
    const largura = Number(m[2]);
    const altura = Number(m[3]);
    if (altura <= largura) continue;
    return { monitor: m[1], largura, altura, arquivo: m[4] };
  }
  return null;
}

function destino() {
  return path.join(deps.app.getPath('userData'), 'vidro-fundo.jpg');
}

// Corta para o formato exato do monitor antes de desfocar: desfocar e depois
// esticar deixa o grão do blur alongado, e a placa passa a mostrar um pedaço
// que não é o que está atrás dela.
async function gera(alvo) {
  const saida = destino();
  const filtro = [
    'scale=' + alvo.largura + ':' + alvo.altura + ':force_original_aspect_ratio=increase',
    'crop=' + alvo.largura + ':' + alvo.altura,
    'gblur=sigma=' + SIGMA,
    'eq=brightness=' + ESCURECE
  ].join(',');

  const out = await roda('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', alvo.arquivo,
    '-vf', filtro,
    '-q:v', '4',
    saida
  ], 30000);

  if (!fs.existsSync(saida)) {
    log('ffmpeg não gerou o fundo (' + String(out).trim().slice(0, 120) + ')');
    return false;
  }
  return true;
}

async function atualiza() {
  if (gerando) return estado;
  const alvo = await wallpaperDoMonitorEmPe();
  if (!alvo) {
    // Sem daemon de wallpaper (ou saída diferente): o painel segue inteiro, com
    // as placas caindo no véu chapado do CSS.
    if (estado.origem !== null) log('nenhum wallpaper reportado; vidro cai no véu chapado');
    estado = { arquivo: null, origem: null, largura: 0, altura: 0 };
    return estado;
  }
  if (alvo.arquivo === estado.origem && estado.arquivo) return estado;

  gerando = true;
  try {
    if (await gera(alvo)) {
      estado = {
        arquivo: destino(),
        origem: alvo.arquivo,
        largura: alvo.largura,
        altura: alvo.altura
      };
      log('fundo desfocado de ' + path.basename(alvo.arquivo) +
          ' (' + alvo.largura + 'x' + alvo.altura + ', sigma ' + SIGMA + ')');
      if (deps.empurra) deps.empurra('vidro-update', atual());
    }
  } finally {
    gerando = false;
  }
  return estado;
}

// O renderer não pode carregar `file:///...` de fora do diretório do app sem
// atrito, e nem precisa: a imagem é pequena depois do blur, então vai como
// data: URL. Assim também não há corrida entre gravar o arquivo e a página
// pedir por ele.
function atual() {
  if (!estado.arquivo) return { fundo: null };
  try {
    const bruto = fs.readFileSync(estado.arquivo);
    return {
      fundo: 'data:image/jpeg;base64,' + bruto.toString('base64'),
      largura: estado.largura,
      altura: estado.altura
    };
  } catch (e) {
    return { fundo: null };
  }
}

function iniciar(d) {
  deps = d;
  atualiza();
  const t = setInterval(atualiza, RECHECA_MS);
  t.unref();
}

module.exports = { iniciar, atualiza, atual };
