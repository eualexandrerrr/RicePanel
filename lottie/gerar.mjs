// Gera as animações Lottie do Mirante.
//
// São escritas por código, não baixadas: o painel roda offline, a paleta precisa
// bater com a do CSS, e um .json de terceiro traz peso e licença que não valem
// para quatro formas geométricas. Rodar: `node lottie/gerar.mjs`.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
mkdirSync(AQUI, { recursive: true });

// Catppuccin Mocha, em 0–1 como o Lottie quer.
const cor = (hex) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
  1
];
const MAUVE = '#cba6f7', BLUE = '#89b4fa', PINK = '#f5c2e7';
const GREEN = '#a6e3a1', RED = '#f38ba8', TEAL = '#94e2d5';

// Ease exponencial de saída, o mesmo perfil do CSS do painel.
const SAI = { i: { x: [0.16], y: [1] }, o: { x: [0.3], y: [0] } };
const SUAVE = { i: { x: [0.42], y: [1] }, o: { x: [0.58], y: [0] } };

// Propriedade animada a partir de uma lista [tempo, valor].
function anima(quadros, ease = SUAVE) {
  return {
    a: 1,
    k: quadros.map(([t, v], i) => (
      i === quadros.length - 1
        ? { t, s: Array.isArray(v) ? v : [v] }
        : { t, s: Array.isArray(v) ? v : [v], ...ease }
    ))
  };
}
const fixo = (v) => ({ a: 0, k: v });

function comp(nome, w, h, fr, op, layers) {
  return { v: '5.7.4', fr, ip: 0, op, w, h, nm: nome, ddd: 0, assets: [], layers };
}

function camada(ind, nome, op, shapes, transform = {}) {
  return {
    ddd: 0, ind, ty: 4, nm: nome, sr: 1, ao: 0, bm: 0, ip: 0, op, st: 0,
    ks: Object.assign({
      o: fixo(100), r: fixo(0), p: fixo([0, 0, 0]), a: fixo([0, 0, 0]), s: fixo([100, 100, 100])
    }, transform),
    shapes
  };
}

const elipse = (tamanho) => ({ ty: 'el', d: 1, s: fixo(tamanho), p: fixo([0, 0]), nm: 'el' });
const retangulo = (tamanho, raio, p = [0, 0]) => ({ ty: 'rc', d: 1, s: tamanho, p: p.a ? p : fixo(p), r: fixo(raio), nm: 'rc' });
const preenche = (hex, opacidade = 100) => ({ ty: 'fl', c: fixo(cor(hex)), o: fixo(opacidade), r: 1, bm: 0, nm: 'fl' });
const traca = (hex, largura, opacidade = 100) => ({
  ty: 'st', c: fixo(cor(hex)), o: opacidade.a ? opacidade : fixo(opacidade),
  w: largura.a ? largura : fixo(largura), lc: 2, lj: 1, ml: 4, bm: 0, nm: 'st'
});
const tr = (extra = {}) => Object.assign({
  ty: 'tr', p: fixo([0, 0]), a: fixo([0, 0]), s: fixo([100, 100]), r: fixo(0), o: fixo(100), sk: fixo(0), sa: fixo(0), nm: 'tr'
}, extra);

const grupo = (itens, nome = 'gr') => ({ ty: 'gr', nm: nome, it: itens, np: itens.length, cix: 2, bm: 0, ix: 1, hd: false });

function salva(nome, dados) {
  writeFileSync(join(AQUI, nome + '.json'), JSON.stringify(dados));
  console.log('lottie/' + nome + '.json');
}

// --------------------------------------------------------------------- aurora
// Fundo do cabeçalho: três massas de cor à deriva. O borrão é do CSS
// (filter: blur), não do Lottie — efeito de blur em Lottie é caro e o renderer
// SVG desenha isso a custo quase zero.
salva('aurora', comp('aurora', 600, 320, 30, 900, [
  camada(1, 'mauve', 900, [grupo([elipse([320, 220]), preenche(MAUVE, 70), tr()])], {
    p: anima([[0, [150, 130, 0]], [300, [230, 90, 0]], [600, [110, 170, 0]], [900, [150, 130, 0]]]),
    s: anima([[0, [100, 100, 100]], [450, [128, 112, 100]], [900, [100, 100, 100]]])
  }),
  camada(2, 'blue', 900, [grupo([elipse([300, 240]), preenche(BLUE, 62), tr()])], {
    p: anima([[0, [420, 180, 0]], [330, [330, 120, 0]], [660, [470, 210, 0]], [900, [420, 180, 0]]]),
    s: anima([[0, [112, 100, 100]], [500, [92, 118, 100]], [900, [112, 100, 100]]])
  }),
  camada(3, 'pink', 900, [grupo([elipse([260, 180]), preenche(PINK, 45), tr()])], {
    p: anima([[0, [290, 230, 0]], [400, [360, 260, 0]], [750, [220, 200, 0]], [900, [290, 230, 0]]]),
    s: anima([[0, [100, 100, 100]], [420, [118, 106, 100]], [900, [100, 100, 100]]])
  })
]));

// ---------------------------------------------------------------------- pulso
// Um canal recebeu alerta: anel que sai de dentro do número e some. Este é o
// único movimento com cor de alarme no painel.
function pulso(nome, hex) {
  const anel = (atraso) => camada(atraso + 1, 'anel' + atraso, 90, [
    grupo([elipse([60, 60]), traca(hex, 4, anima([[atraso, 90], [atraso + 55, 0]], SAI)), tr()])
  ], {
    p: fixo([100, 100, 0]),
    s: anima([[atraso, [30, 30, 100]], [atraso + 55, [190, 190, 100]]], SAI)
  });
  return comp(nome, 200, 200, 30, 90, [anel(0), anel(28)]);
}
salva('pulso-vermelho', pulso('pulso', RED));
salva('pulso-mauve', pulso('pulso', MAUVE));

// ---------------------------------------------------------------------- ondas
// Equalizador do que está tocando. Só aparece quando o player está em play: sem
// som na tela, barra parada mentindo movimento é pior que nada.
salva('ondas', comp('ondas', 120, 60, 30, 60, [1, 2, 3, 4, 5].map((n, i) => {
  const alturas = [[8, 44, 16, 38], [34, 12, 46, 20], [18, 50, 10, 30], [42, 16, 36, 12], [12, 30, 22, 48]][i];
  const x = 12 + i * 24;
  const quadros = alturas.map((h, k) => [k * 15, [10, h]]);
  quadros.push([60, [10, alturas[0]]]);
  // A barra cresce para cima: o topo do retângulo desce metade do que ele cresce.
  const centros = alturas.map((h, k) => [k * 15, [0, 26 - h / 2]]);
  centros.push([60, [0, 26 - alturas[0] / 2]]);
  return camada(n, 'barra' + n, 60, [
    grupo([
      retangulo(anima(quadros), 5, anima(centros)),
      preenche(TEAL, 100),
      tr()
    ])
  ], { p: fixo([x, 30, 0]) });
})));

// ---------------------------------------------------------------------- calmo
// Estado vazio: nada pendente. Respira devagar, quase parado — silêncio também
// é informação, e o desenho precisa dizer "tudo bem", não "carregando".
salva('calmo', comp('calmo', 160, 160, 30, 180, [
  camada(1, 'aro', 180, [
    grupo([elipse([88, 88]), traca(GREEN, 2, anima([[0, 34], [90, 62], [180, 34]])), tr()])
  ], {
    p: fixo([80, 80, 0]),
    s: anima([[0, [94, 94, 100]], [90, [106, 106, 100]], [180, [94, 94, 100]]])
  }),
  camada(2, 'ponto', 180, [grupo([elipse([12, 12]), preenche(GREEN, 100), tr()])], {
    p: fixo([80, 80, 0]),
    o: anima([[0, 70], [90, 100], [180, 70]])
  })
]));
