// Página 1 — o Mirante.
//
// O que fica na tela o dia todo: hora, data, mês, agenda, térmica, carga,
// música e a máquina. Roda antes do painel.js e publica `window.mirante`, que o
// barramento usa para acordar e adormecer a página.
//
// Regra que vale para o arquivo inteiro: nada aqui pergunta ao main de dois em
// dois segundos. O main já empurra o retrato da máquina por `onSistema`; o resto
// tem cadência própria e longa. Painel aceso 24 h não pode gastar bateria de
// varredura em coisa que muda de hora em hora.

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // Quando a página sai da frente, todo desenho para. Section com display:none
  // ainda cobra quadro de animação e recálculo de layout.
  let acordado = false;
  let ultimoRetrato = null;
  let ultimoHypr = null;

  // ------------------------------------------------------------- utilidades

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function doisDig(n) { return String(n).padStart(2, '0'); }

  // Bytes por segundo em unidade que cabe na célula. Rede em casa passa o dia
  // em kB/s e pula para MB/s por segundos: unidade fixa deixaria a leitura em
  // 0,0 quase sempre ou estourando a largura no pico.
  function fmtBytes(b) {
    if (b == null) return '—';
    if (b < 1024) return Math.round(b) + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10 * 1024 ? 1 : 0).replace('.', ',') + ' kB';
    return (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
  }

  function fmtGB(b) {
    if (b == null) return '—';
    return (b / 1073741824).toFixed(1).replace('.', ',') + ' GB';
  }

  function fmtDuracao(seg) {
    if (seg == null) return '—';
    const d = Math.floor(seg / 86400);
    const h = Math.floor((seg % 86400) / 3600);
    const m = Math.floor((seg % 3600) / 60);
    if (d) return d + 'd ' + h + 'h';
    if (h) return h + 'h ' + m + 'min';
    return m + 'min';
  }

  function fmtRelogioCurto(seg) {
    if (seg == null) return '0:00';
    return Math.floor(seg / 60) + ':' + doisDig(Math.floor(seg % 60));
  }

  function mesmoDia(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function meiaNoite(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function chaveDia(d) {
    return d.getFullYear() + '-' + doisDig(d.getMonth() + 1) + '-' + doisDig(d.getDate());
  }

  // Semana ISO: a que contém a quinta-feira. É a numeração que aparece em
  // calendário e em planilha, então é a que ele reconhece.
  function semanaIso(d) {
    const q = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    q.setUTCDate(q.getUTCDate() + 4 - (q.getUTCDay() || 7));
    const jan1 = new Date(Date.UTC(q.getUTCFullYear(), 0, 1));
    return Math.ceil(((q - jan1) / 86400000 + 1) / 7);
  }

  function diaDoAno(d) {
    return Math.floor((meiaNoite(d) - new Date(d.getFullYear(), 0, 0)) / 86400000);
  }

  // --------------------------------------------------------------- Lottie

  // As animações são de ambiente. Se o lottie-web não carregar (arquivo movido,
  // vendor apagado), a página continua inteira: o que some é a textura de fundo,
  // nunca um dado.
  const animacoes = [];

  // Reamostra o lottie por relógio próprio: sem isso ele atualiza no RAF, na
  // taxa do monitor (144 Hz), não nos 30 fps do JSON.
  function comTaxaLimitada(anim, fpsAlvo) {
    const passoMs = 1000 / fpsAlvo;
    let relogio = null;
    let quadro = 0;
    function avanca() {
      const total = anim.totalFrames;
      const taxaOriginal = anim.frameRate;
      if (!total || !taxaOriginal) return; // JSON ainda carregando
      quadro = (quadro + taxaOriginal / fpsAlvo) % total;
      try { anim.goToAndStop(quadro, true); } catch (e) {}
    }
    return {
      play() { if (!relogio) relogio = setInterval(avanca, passoMs); },
      pause() { clearInterval(relogio); relogio = null; },
      destroy() { clearInterval(relogio); relogio = null; try { anim.destroy(); } catch (e) {} }
    };
  }

  function poeLottie(elId, arquivo, opcoes, fpsAlvo) {
    const el = $(elId);
    if (!el || typeof window.lottie === 'undefined') return null;
    try {
      const a = window.lottie.loadAnimation(Object.assign({
        container: el,
        renderer: 'svg',
        loop: true,
        autoplay: false,
        path: 'lottie/' + arquivo
      }, opcoes || {}));
      const controlada = fpsAlvo ? comTaxaLimitada(a, fpsAlvo) : a;
      animacoes.push(controlada);
      return controlada;
    } catch (e) {
      return null;
    }
  }

  // O custo de bruma/aurora não era a taxa de atualização, era a camada em si
  // (mask+filter+SVG vivo) -- confirmado em 10/09/2026, nenhum ajuste isolado
  // de CSS resolveu. Aqui o lottie roda num container nunca anexado ao
  // document; a cada intervalo a gente serializa o SVG, rasteriza com o blur
  // já embutido no canvas, e troca o background-image do elemento visível.
  function criarFundoBakeado(elId, arquivo, { w, h, blurPx = 0, intervaloMs = 2500, rendererSettings } = {}) {
    const el = $(elId);
    if (!el || typeof window.lottie === 'undefined') return null;
    const offscreen = document.createElement('div');
    offscreen.style.width = w + 'px';
    offscreen.style.height = h + 'px';
    let anim;
    try {
      anim = window.lottie.loadAnimation({
        container: offscreen, renderer: 'svg', loop: true, autoplay: false,
        path: 'lottie/' + arquivo, rendererSettings
      });
    } catch (e) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    let quadro = 0;
    let relogio = null;

    // data: URI em background-image vaza: o Chromium guarda o bitmap decodificado
    // no cache por URL, e cada troca e uma URL nova que nunca sai de la. Blob URL
    // revogado a cada troca libera o anterior de verdade -- medido, 19 MB/min
    // parou de crescer com isto.
    let urlAnterior = null;
    async function pinta() {
      const svg = offscreen.querySelector('svg');
      if (!svg) return;
      const marcado = new XMLSerializer().serializeToString(svg);
      const blobSvg = new Blob([marcado], { type: 'image/svg+xml' });
      let bitmap;
      try {
        bitmap = await createImageBitmap(blobSvg, { resizeWidth: w, resizeHeight: h });
      } catch (e) {
        console.error('DEBUG bitmap falhou', elId, String(e));
        return;
      }
      ctx.clearRect(0, 0, w, h);
      ctx.filter = blurPx ? `blur(${blurPx}px)` : 'none';
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : '?';
      console.error('DEBUG', elId, 'heapMB=' + heap);
      canvas.toBlob(blob => {
        if (!blob) return;
        const novaUrl = URL.createObjectURL(blob);
        el.style.backgroundImage = `url(${novaUrl})`;
        if (urlAnterior) URL.revokeObjectURL(urlAnterior);
        urlAnterior = novaUrl;
      }, 'image/png');
    }

    function avanca() {
      const total = anim.totalFrames;
      const taxa = anim.frameRate;
      if (!total || !taxa) return;
      quadro = (quadro + taxa * intervaloMs / 1000) % total;
      try { anim.goToAndStop(quadro, true); } catch (e) {}
      pinta();
    }

    const controlada = {
      play() { if (!relogio) { avanca(); relogio = setInterval(avanca, intervaloMs); } },
      pause() { clearInterval(relogio); relogio = null; },
      destroy() { clearInterval(relogio); relogio = null; try { anim.destroy(); } catch (e) {} }
    };
    animacoes.push(controlada);
    return controlada;
  }

  function tocaAnimacoes(ligado) {
    for (const a of animacoes) {
      try { ligado ? a.play() : a.pause(); } catch (e) {}
    }
    // O `calmo` não mora no array: ele nasce e morre junto com o estado vazio da
    // agenda, então é preciso alcançá-lo à parte. Sem isto ele seguiria cobrando
    // quadro com o Mirante escondido, que é exatamente o que `acorda` evita.
    if (calmoAnim) {
      try { ligado ? calmoAnim.play() : calmoAnim.pause(); } catch (e) {}
    }
  }

  // ---------------------------------------------------------------- relógio

  const elHora = $('wHora');
  const elData = $('wData');
  const elSaudacao = $('wSaudacao');
  const elSemana = $('wSemana');
  const elDiaAno = $('wDiaAno');

  const fmtDataLonga = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  let ultimoMinuto = -1;
  let pontosApagados = false;

  function saudacaoDe(h) {
    if (h < 5) return 'Madrugada';
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  function pintaRelogio(forca) {
    const agora = new Date();
    const min = agora.getHours() * 60 + agora.getMinutes();

    // O dois-pontos pisca a cada segundo; o resto só é reescrito quando o
    // minuto vira. Reescrever o número inteiro 60 vezes por minuto obriga o
    // Chromium a remedir a fonte gigante a cada segundo, à toa.
    pontosApagados = !pontosApagados;
    const dp = elHora.querySelector('.dp');
    if (dp) dp.classList.toggle('apaga', pontosApagados);

    if (!forca && min === ultimoMinuto) return;
    ultimoMinuto = min;

    elHora.innerHTML = doisDig(agora.getHours()) +
      '<span class="dp">:</span>' + doisDig(agora.getMinutes());
    elData.textContent = fmtDataLonga.format(agora);
    elSaudacao.textContent = saudacaoDe(agora.getHours());
    elSemana.textContent = 'S' + semanaIso(agora);
    elDiaAno.textContent = diaDoAno(agora) + '/' + (diaDoAno(new Date(agora.getFullYear(), 11, 31)));

    // Virou o dia: o mês precisa remarcar o "hoje" e a agenda, reordenar.
    if (agora.getHours() === 0 && agora.getMinutes() === 0) {
      pintaMes();
      pintaAgenda();
    }
  }

  // --------------------------------------------------------- calendário

  const elMesGrade = $('wMesGrade');
  const elMesNome = $('wMesNome');
  const fmtMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
  const CABECA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  let mesVisto = null;          // null = o mês de hoje
  let diasComEvento = new Set();

  function mesBase() {
    const hoje = new Date();
    return mesVisto || new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  }

  function pintaMes() {
    const base = mesBase();
    const hoje = new Date();
    elMesNome.textContent = fmtMes.format(base);

    const primeiro = new Date(base.getFullYear(), base.getMonth(), 1);
    // A grade começa no domingo da semana do dia 1 e vai até fechar semanas
    // inteiras: mês que começa numa sexta ficaria com um buraco de cinco
    // células e a primeira linha desalinhada do cabeçalho.
    const comeco = new Date(primeiro);
    comeco.setDate(1 - primeiro.getDay());

    let html = CABECA.map(c => '<span class="mes-cab">' + c + '</span>').join('');
    const cursor = new Date(comeco);
    for (let i = 0; i < 42; i++) {
      const fora = cursor.getMonth() !== base.getMonth();
      const fds = cursor.getDay() === 0 || cursor.getDay() === 6;
      const classes = ['mes-dia'];
      if (fora) classes.push('fora');
      if (fds) classes.push('fds');
      if (mesmoDia(cursor, hoje)) classes.push('hoje');
      const marca = diasComEvento.has(chaveDia(cursor)) && !fora ? '<i class="ponto"></i>' : '';
      html += '<span class="' + classes.join(' ') + '">' + cursor.getDate() + marca + '</span>';
      cursor.setDate(cursor.getDate() + 1);
      // Última linha vazia não entra: seis semanas só cabem em mês que
      // realmente atravessa seis.
      if (i === 34 && cursor.getMonth() !== base.getMonth()) break;
    }
    elMesGrade.innerHTML = html;
  }

  function andaMes(n) {
    const base = mesBase();
    mesVisto = new Date(base.getFullYear(), base.getMonth() + n, 1);
    pintaMes();
  }

  $('wMesAnt').addEventListener('click', () => andaMes(-1));
  $('wMesProx').addEventListener('click', () => andaMes(1));
  $('wMesHoje').addEventListener('click', () => { mesVisto = null; pintaMes(); });

  // -------------------------------------------------------------- agenda

  const elAgendaLista = $('wAgendaLista');
  const elAgendaQuando = $('wAgendaQuando');
  const AGENDA_MS = 5 * 60 * 1000;
  let agendaEstado = { eventos: [], erro: null, atualizadoEm: null, temUrl: false };

  const fmtDiaAgenda = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });

  function rotuloDoDia(d) {
    const hoje = new Date();
    const amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
    if (mesmoDia(d, hoje)) return 'Hoje';
    if (mesmoDia(d, amanha)) return 'Amanhã';
    return fmtDiaAgenda.format(d);
  }

  // O vazio da agenda ganhou desenho (08/09/2026): antes era uma frase solta em
  // serigrafia fraca no meio de uma placa grande, que lia como espera de
  // carregamento. O `calmo` é um aro que respira devagar — diz "está tudo bem,
  // não há nada", que é a regra 4 do DESIGN.md.
  //
  // A animação é montada e desmontada a cada pintura porque o `innerHTML` da
  // lista apaga o container: guardá-la no array geral de `poeLottie` deixaria um
  // Lottie órfão cobrando quadro para sempre a cada refresh da agenda.
  let calmoAnim = null;

  function soltaCalmo() {
    if (!calmoAnim) return;
    try { calmoAnim.destroy(); } catch (e) {}
    calmoAnim = null;
  }

  function pintaAgendaVazia(texto) {
    soltaCalmo();
    const vazio = document.createElement('div');
    vazio.className = 'agenda-vazio';
    const selo = document.createElement('span');
    selo.className = 'selo-calmo';
    selo.setAttribute('aria-hidden', 'true');
    const frase = document.createElement('span');
    frase.textContent = texto;
    vazio.append(selo, frase);
    elAgendaLista.replaceChildren(vazio);

    if (typeof window.lottie === 'undefined') return;
    try {
      calmoAnim = window.lottie.loadAnimation({
        container: selo,
        renderer: 'svg',
        loop: true,
        autoplay: acordado,
        path: 'lottie/calmo.json'
      });
    } catch (e) {
      calmoAnim = null;
    }
  }

  function pintaAgenda() {
    const ev = agendaEstado.eventos || [];
    diasComEvento = new Set(ev.map(e => chaveDia(new Date(e.inicio))));
    pintaMes();

    elAgendaQuando.textContent = agendaEstado.erro
      ? 'sem conexão'
      : (agendaEstado.atualizadoEm ? 'lida ' + hhmm(agendaEstado.atualizadoEm) : '');

    if (!agendaEstado.temUrl) {
      pintaAgendaVazia('Sem calendário ligado — abra o ajuste e cole o endereço iCal.');
      return;
    }
    if (!ev.length) {
      // Vazio é estado de calma, não de erro.
      pintaAgendaVazia('Nada marcado pelos próximos dias.');
      return;
    }
    soltaCalmo();

    const agora = Date.now();
    let html = '';
    let diaAberto = '';
    // Só os quinze primeiros: a lista rola dentro de uma coluna estreita, e
    // compromisso de daqui a um mês não é o que ele consulta de relance.
    for (const e of ev.slice(0, 15)) {
      const ini = new Date(e.inicio);
      const fim = e.fim ? new Date(e.fim) : null;
      const chave = chaveDia(ini);
      if (chave !== diaAberto) {
        diaAberto = chave;
        html += '<div class="agenda-dia">' + esc(rotuloDoDia(ini)) + '</div>';
      }
      const acabou = fim ? fim.getTime() < agora : ini.getTime() + 3600000 < agora;
      const rolando = ini.getTime() <= agora && !acabou;
      const cls = 'agenda-item' + (rolando ? ' agora' : acabou ? ' passou' : '');
      const hora = e.diaInteiro ? 'dia' : doisDig(ini.getHours()) + ':' + doisDig(ini.getMinutes());
      html += '<div class="' + cls + '">' +
        '<span class="agenda-hora">' + hora + '</span>' +
        '<span class="agenda-texto">' +
          '<span class="agenda-titulo">' + esc(e.titulo) + '</span>' +
          (e.local ? '<span class="agenda-local">' + esc(e.local) + '</span>' : '') +
        '</span></div>';
    }
    elAgendaLista.innerHTML = html;
  }

  function hhmm(iso) {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? doisDig(d.getHours()) + ':' + doisDig(d.getMinutes()) : '';
  }

  async function buscaAgenda(forcando) {
    try {
      agendaEstado = forcando ? await window.api.agendaRefresh() : await window.api.agendaGet();
      pintaAgenda();
    } catch (e) {}
  }

  $('wAgendaRefresh').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.classList.add('girando');
    await buscaAgenda(true);
    btn.classList.remove('girando');
  });

  // --- modal do calendário ---
  const agendaModal = $('agendaModal');
  const agendaUrl = $('agendaUrl');
  const agendaNota = $('agendaNota');

  async function abreAgendaModal() {
    let pista = '';
    try { pista = await window.api.agendaUrlPista(); } catch (e) {}
    agendaUrl.value = '';
    agendaNota.textContent = pista
      ? 'Já existe um calendário salvo (' + pista + '). Colar outro endereço substitui; salvar em branco desliga.'
      : 'Nenhum calendário salvo ainda.';
    agendaModal.classList.add('on');
    agendaUrl.focus();
  }

  $('wAgendaConf').addEventListener('click', abreAgendaModal);
  $('agendaCancel').addEventListener('click', () => agendaModal.classList.remove('on'));
  agendaModal.addEventListener('click', (e) => {
    if (e.target === agendaModal) agendaModal.classList.remove('on');
  });
  $('agendaOk').addEventListener('click', async () => {
    agendaNota.textContent = 'Buscando…';
    const r = await window.api.agendaUrlSet(agendaUrl.value);
    if (!r.ok) { agendaNota.textContent = 'Não deu: ' + r.error; return; }
    agendaModal.classList.remove('on');
    agendaUrl.value = '';
    await buscaAgenda(false);
  });

  // ------------------------------------------------------------- térmica

  const elAneis = $('wAneis');
  const R = 36;                       // raio do anel, em unidades do viewBox
  const VOLTA = 2 * Math.PI * R;
  const TEMP_MIN = 30, TEMP_MAX = 100;

  // Mesma escala do resto do painel: 30 a 100 °C, verde até 65, âmbar até 82,
  // vermelho acima. Escala fixa é o que deixa comparar CPU com GPU de relance.
  function corTemp(t) {
    if (t == null) return 'var(--overlay0)';
    if (t >= 82) return 'var(--vermelho)';
    if (t >= 65) return 'var(--ambar)';
    return 'var(--verde)';
  }

  // Foto real da peça, dos arquivos em `fotos/` (crédito em fotos/CREDITOS.md).
  // É a peça de referência, não a desta máquina: no tamanho em que aparece o que
  // se reconhece é o formato — pastilha de processador, cooler de três hélices,
  // placa pequena de uma hélice, bastão de M.2.
  function fotoDaPeca(tipo, nome, marca) {
    if (tipo === 'cpu') return /ryzen/i.test(nome || '') ? 'fotos/cpu-ryzen.png' : '';
    if (tipo === 'nvme') return 'fotos/ssd-nvme.png';
    if (/nvidia/i.test(marca || '')) return 'fotos/gpu-nvidia.png';
    if (/amd|radeon/i.test(marca || '')) return 'fotos/gpu-amd.png';
    return '';
  }

  function svgAnel(id, rotulo, foto) {
    return '<div class="anel">' +
      '<svg viewBox="0 0 84 84">' +
        '<circle class="trilho" cx="42" cy="42" r="' + R + '"></circle>' +
        '<circle class="arco" id="' + id + 'Arco" cx="42" cy="42" r="' + R + '"' +
          ' stroke-dasharray="' + VOLTA.toFixed(2) + '"' +
          ' stroke-dashoffset="' + VOLTA.toFixed(2) + '"' +
          ' transform="rotate(-90 42 42)"></circle>' +
        // Número e grau na MESMA linha de texto. Em dois `<text>` empilhados o
        // "°C" caía em cima da barriga dos dígitos e o miolo do anel ficava
        // apertado; sobrescrito, o grau é sinal de unidade e não segunda linha.
        '<text class="centro" x="42" y="44" text-anchor="middle" dominant-baseline="central">' +
          '<tspan id="' + id + 'Txt">--</tspan>' +
          '<tspan class="grau" dy="-9">°C</tspan>' +
        '</text>' +
      '</svg>' +
      // A foto fica entre o anel e o nome: é a peça que aquele número mede.
      (foto ? '<img class="anel-foto" src="' + esc(foto) + '" alt="" aria-hidden="true">' : '') +
      '<span class="rotulo">' + rotulo + '</span>' +
      '<span class="anel-dados" id="' + id + 'Dados"></span>' +
    '</div>';
  }

  // Quantos anéis existem é da máquina, não do HTML: esta tem duas placas de
  // vídeo, outra pode ter uma só. Enquanto o primeiro retrato não chega, a fila
  // é a antiga — CPU, GPU, SSD — para a placa não nascer com um buraco.
  let aneisMontados = '';

  // O nome da placa vale mais que a palavra "GPU" quando há duas: é por ele que
  // ele sabe qual anel é a de trabalho e qual é a que só toca vídeo.
  function rotuloGpu(g, i, quantas) {
    if (quantas < 2) return 'GPU';
    return g.nome || ('GPU ' + (i + 1));
  }

  function listaGpus(r) {
    if (!r) return null;
    if (Array.isArray(r.gpus)) return r.gpus;
    return r.gpu ? [r.gpu] : [];
  }

  function montaAneis(r) {
    const gpus = listaGpus(r);
    const modeloCpu = r && r.cpu ? r.cpu.modelo : '';
    const sensores = [{
      id: 'anCpu',
      rotulo: 'CPU',
      foto: fotoDaPeca('cpu', modeloCpu, 'AMD')
    }];
    if (gpus == null) {
      sensores.push({ id: 'anGpu0', rotulo: 'GPU', foto: '' });
    } else {
      gpus.forEach((g, i) => sensores.push({
        id: 'anGpu' + i,
        rotulo: rotuloGpu(g, i, gpus.length),
        foto: fotoDaPeca('gpu', g.nome, g.marca)
      }));
    }
    sensores.push({
      id: 'anNvme',
      rotulo: (r && r.nvmeModelo) || 'SSD',
      foto: fotoDaPeca('nvme')
    });

    // Só remonta quando a fila muda de verdade: reescrever o innerHTML a cada
    // dois segundos apagaria a transição de 800 ms dos arcos.
    const assinatura = sensores.map(x => x.id + ':' + x.rotulo + ':' + x.foto).join('|');
    if (assinatura === aneisMontados) return;
    aneisMontados = assinatura;
    elAneis.style.setProperty('--n-aneis', sensores.length);
    elAneis.innerHTML = sensores.map(x => svgAnel(x.id, x.rotulo, x.foto)).join('');
  }

  montaAneis(null);

  function pintaAnel(id, t) {
    const arco = $(id + 'Arco');
    const txt = $(id + 'Txt');
    if (!arco || !txt) return;
    if (t == null) {
      arco.style.strokeDashoffset = VOLTA;
      arco.style.stroke = 'var(--overlay0)';
      txt.textContent = '--';
      return;
    }
    const f = Math.max(0, Math.min(1, (t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)));
    arco.style.strokeDashoffset = (VOLTA * (1 - f)).toFixed(2);
    arco.style.stroke = corTemp(t);
    txt.textContent = Math.round(t);
  }

  // ------------------------------------------------------------- carga

  const elMedidores = $('wMedidores');

  // Rótulo e valor na mesma linha, trilho curto logo abaixo: o fio atravessando
  // a placa inteira, com o valor lá na outra ponta, era o desenho que mais
  // incomodava — o olho tinha de viajar para juntar as duas metades do dado.
  function med(id, rotulo) {
    return '<div class="med">' +
      '<span class="topo">' +
        '<span class="rotulo">' + rotulo + '</span>' +
        '<span class="valor" id="' + id + 'Val">—</span>' +
      '</span>' +
      '<span class="trilho"><i id="' + id + 'Fio"></i></span>' +
    '</div>';
  }

  function corCarga(pct) {
    if (pct == null) return 'var(--overlay0)';
    if (pct >= 90) return 'var(--vermelho)';
    if (pct >= 70) return 'var(--ambar)';
    return 'var(--acento)';
  }

  function pintaMed(id, pct, texto) {
    const fio = $(id + 'Fio');
    const val = $(id + 'Val');
    if (!fio || !val) return;
    const f = pct == null ? 0 : Math.max(0, Math.min(100, pct)) / 100;
    fio.style.transform = 'scaleX(' + f.toFixed(4) + ')';
    fio.style.background = corCarga(pct);
    val.textContent = texto;
  }

  // Os medidores de disco só existem depois do primeiro retrato: a quantidade
  // de volumes é da máquina, não do HTML.
  // Guarda a fila montada: o swap entra e sai conforme o uso, e a grade tem de
  // acompanhar sem remontar a cada tique.
  let medidoresMontados = '';

  function montaMedidores(r) {
    // Rótulo curto: a coluna da serigrafia é estreita para o trilho ficar
    // longo, e "Processador" já saía cortado em "Processad".
    let html = med('mCpu', 'CPU') + med('mRam', 'RAM');
    (r.discos || []).forEach((d, i) => {
      html += med('mDisco' + i, d.ponto === '/' ? 'Root' : 'Home');
    });
    // Swap praticamente zerado é linha morta: a máquina tem 32 GB e o kernel
    // deixa alguns megabytes lá parados. Só entra quando passa de 256 MB.
    if (r.memoria && r.memoria.swapTotal && r.memoria.swapUsado > 256 * 1048576) {
      html += med('mSwap', 'Swap');
    }
    elMedidores.innerHTML = html;
  }

  // -------------------------------------------------- números da peça

  // O anel dá a temperatura; esta linha, logo abaixo do nome, dá o resto: o
  // quanto a peça está sendo usada e de quanta memória. Uma linha por coluna,
  // curta — quem quer detalhe abre o Monitor.
  function fmtVram(mib) {
    if (mib == null) return null;
    const gb = mib / 1024;
    return (gb >= 10 ? Math.round(gb) : gb.toFixed(1).replace('.', ',')) + '';
  }

  function poeDados(id, texto) {
    const el = $(id + 'Dados');
    if (el) el.textContent = texto || '';
  }

  function dadosDaGpu(g) {
    // A placa do passthrough continua na faixa com a VM desligada: o número não
    // existe porque quem lê os sensores dela é o Windows, não porque sumiu.
    const uso = g.uso == null ? (g.naVm ? 'no vfio' : '—') : g.uso + '%';
    const vram = (g.vramUsada != null && g.vramTotal != null)
      ? fmtVram(g.vramUsada) + '/' + fmtVram(g.vramTotal) + ' GB'
      : '';
    return [uso, vram].filter(Boolean).join(' · ');
  }

  // ------------------------------------------------------------- música

  const elMusica = $('wMusica');
  const elMusicaMarca = $('wMusicaMarca');
  const elMusicaControles = $('wMusicaControles');
  const elMusicaAlternaIcone = $('wMusicaAlternaIcone');
  let musicaAnim = null;
  let playerAtual = '';

  // Só o Spotify ganha marca e botões: é o player que ele usa e o que responde
  // a MPRIS de forma confiável. Outro player continua aparecendo, sem botoeira,
  // porque metade dos botões que não funcionam é pior que nenhum.
  function ehSpotify(m) {
    return /spotify/i.test((m && m.player) || '');
  }

  function mandaMusica(verbo) {
    window.api.musicaComando(verbo, playerAtual).catch(() => {});
  }

  $('wMusicaAnterior').addEventListener('click', () => mandaMusica('anterior'));
  $('wMusicaProximo').addEventListener('click', () => mandaMusica('proximo'));
  $('wMusicaAlterna').addEventListener('click', () => mandaMusica('alterna'));

  let ultimaMusica = null;
  function pintaMusica(m) {
    ultimaMusica = m;
    // Com a placa de vídeo de pé a da música cala, seja quem for que toca: o
    // vídeo é o que ele está vendo, e um Spotify pausado embaixo dele é ruído.
    const comVideo = document.body.classList.contains('com-video');
    if (!m || !m.titulo || comVideo) { elMusica.hidden = true; if (musicaAnim) musicaAnim.pause(); return; }
    elMusica.hidden = false;
    playerAtual = m.player || '';

    const spotify = ehSpotify(m);
    elMusicaMarca.hidden = !spotify;
    elMusicaControles.hidden = !spotify;
    if (spotify) {
      // O botão do meio mostra o que ele VAI fazer, não o estado atual.
      const botao = $('wMusicaAlterna');
      elMusicaAlternaIcone.setAttribute('href', m.tocando ? '#ic-pausa' : '#ic-toca');
      botao.title = m.tocando ? 'Pausar' : 'Tocar';
      botao.setAttribute('aria-label', botao.title);
    }

    $('wMusicaTitulo').textContent = m.titulo;
    $('wMusicaArtista').textContent = m.artista || '—';
    $('wMusicaPlayer').textContent =
      (m.player || 'tocando') + (m.duracao ? ' · ' + fmtRelogioCurto(m.posicao) + ' / ' + fmtRelogioCurto(m.duracao) : '');
    const fio = $('wMusicaFio');
    if (fio) {
      const f = (m.duracao && m.posicao != null)
        ? Math.max(0, Math.min(1, m.posicao / m.duracao))
        : 0;
      fio.style.transform = 'scaleX(' + f.toFixed(4) + ')';
    }
    // A onda só se mexe com som andando: parada, ela mentiria.
    if (musicaAnim) { m.tocando && acordado ? musicaAnim.play() : musicaAnim.pause(); }
  }

  // ------------------------------------------------------------- máquina

  const elJanela = $('wJanela');
  const elFicha = $('wFicha');

  // A fileira de pastilhas de workspace saiu (08/09/2026): num painel que fica
  // na parede, saber em qual workspace o Hyprland está não é informação — ele
  // já está olhando para a tela que responde a isso. Sobrou a janela em foco.
  function pintaHypr(h) {
    if (!h) { elJanela.textContent = ''; return; }
    // O próprio painel não conta como janela em foco: ele fica na frente o dia
    // todo, então a linha passava a maior parte do tempo escrevendo "Mirante"
    // para quem já está olhando para o Mirante.
    const classe = h.janela ? (h.janela.classe || '') : '';
    elJanela.textContent = /^ricepanel$/i.test(classe) ? '' : (h.janela ? h.janela.titulo : '');
  }

  function linhaFicha(rotulo, valor) {
    return '<span class="ficha-linha"><span class="rotulo">' + rotulo +
      '</span><span class="v">' + esc(valor) + '</span></span>';
  }

  function pintaFicha(r) {
    elFicha.innerHTML =
      linhaFicha('Sistema', r.distro || '—') +
      linhaFicha('Kernel', r.kernel || '—') +
      linhaFicha('Máquina', (r.usuario || '') + '@' + (r.host || ''));
  }

  // Uma conta só, com a origem entre parênteses: o número é o que ele procura,
  // e a divisão repo/AUR é o que diz se a atualização é baixar ou compilar.
  function pintaPacotes(p) {
    const el = $('wPacotes');
    if (!p || !p.total) { el.textContent = 'sistema em dia'; return; }
    const partes = [];
    if (p.repo) partes.push(p.repo + ' repo');
    if (p.aur) partes.push(p.aur + ' AUR');
    el.textContent = p.total + (p.total === 1 ? ' pacote' : ' pacotes') +
      (partes.length > 1 ? ' · ' + partes.join(' · ') : partes.length ? ' do ' + partes[0].split(' ')[1] : '') +
      ' a atualizar';
  }

  // ---------------------------------------- vídeo do navegador

  // Regra: o painel só assume o vídeo quando a janela que toca não está à vista
  // dele. Assumir significa montar o player do YouTube na posição em que ele
  // parou e pausar a aba do navegador — dois áudios ao mesmo tempo seria o pior
  // resultado possível.
  const elVideo = $('wVideo');
  let videoMontado = '';          // id + site do que está na placa agora
  let volumeAplicado = null;      // último volume mandado para o player

  function desmontaVideo() {
    document.body.classList.remove('com-video');
    if (!videoMontado) return;
    videoMontado = '';
    elVideo.innerHTML = '';
    elVideo.hidden = true;
    pintaMusica(ultimaMusica);
  }

  function montaYoutube(v) {
    const inicio = Math.max(0, (v.posicao || 0) - 1);
    // Página normal do YouTube, não o `/embed`: o embed recusa quem não tem
    // origem HTTP (erro 153), e a página do painel é `file://`. A página cheia
    // carrega sem reclamar; o que sobra dela — cabeçalho, sugestões,
    // comentários — some no CSS injetado logo abaixo.
    const src = 'https://www.youtube.com/watch?v=' + encodeURIComponent(v.id) +
      '&t=' + inicio + 's';
    // A webview tem partição própria (a mesma constante mora em video.js); a
    // sessão do Chrome dele entra nela por `videoEntra` antes de carregar. O
    // user-agent perde o carimbo do Electron: o YouTube trata a sessão como a
    // do navegador de onde os cookies vieram.
    const ua = navigator.userAgent.replace(/ (ricepanel|electron)\/\S+/gi, '');
    elVideo.innerHTML =
      '<span class="video-quadro">' +
        '<webview id="wVideoQuadro" partition="persist:video-mirante" allowpopups="false"' +
        ' useragent="' + ua.replace(/"/g, '') + '"></webview>' +
      '</span>' +
      '<span class="video-pe">' +
        '<span class="video-titulo">' + esc(v.titulo || 'Vídeo') + '</span>' +
        '<span class="rotulo video-onde">YouTube</span>' +
      '</span>';
    elVideo.hidden = false;
    document.body.classList.add('com-video');
    pintaMusica(ultimaMusica);

    const quadro = $('wVideoQuadro');
    if (!quadro) return;

    // O que fica da página é só o vídeo. Sem isto o painel viraria uma janela
    // do YouTube na parede, com barra de busca e coluna de sugestões.
    const SO_O_VIDEO = [
      '#masthead-container, ytd-masthead, #secondary, #below, #chat,',
      'ytd-comments, tp-yt-app-drawer, ytd-mini-guide-renderer,',
      'ytd-watch-metadata, #related, .ytp-chrome-top, .ytp-gradient-top,',
      'ytd-merch-shelf-renderer { display: none !important; }',
      'html, body { overflow: hidden !important; background: #000 !important; }',
      'ytd-app, #content, ytd-page-manager, ytd-watch-flexy { background: #000 !important; }',
      '#primary, #primary-inner, #player, #player-container,',
      '#player-container-inner, #movie_player, .html5-video-player {',
      '  margin: 0 !important; padding: 0 !important;',
      '  width: 100vw !important; max-width: 100vw !important;',
      '  height: 100vh !important; max-height: 100vh !important; }',
      '.html5-video-container, video { width: 100% !important; height: 100% !important;',
      '  left: 0 !important; top: 0 !important; object-fit: contain !important; }'
    ].join('\n');

    // `insertCSS` sozinho não segura, e uma injeção só também não: o YouTube
    // troca a página inteira depois do `dom-ready` (SPA), e o anúncio que roda
    // antes do vídeo monta outro DOM em cima. Então o que entra na página é um
    // vigia: repõe o `<style>` e o volume enquanto o vídeo não estabiliza, e se
    // desliga sozinho depois de um minuto para não ficar rodando à toa.
    const script =
      '(function(){' +
      '  var css=' + JSON.stringify(SO_O_VIDEO) + ';' +
      '  var vol=' + (v.volume != null ? v.volume.toFixed(3) : 'null') + ';' +
      '  function poe(){' +
      '    var e=document.getElementById("ricepanel-so-o-video");' +
      '    if(!e){ e=document.createElement("style"); e.id="ricepanel-so-o-video";' +
      '            (document.head||document.documentElement).appendChild(e); }' +
      '    if(e.textContent!==css) e.textContent=css;' +
      '    var v=document.querySelector("video");' +
      '    if(v){ v.muted=false; if(vol!==null) v.volume=vol; if(v.paused) v.play().catch(function(){}); }' +
      '    var p=document.getElementById("movie_player");' +
      '    if(p&&p.setPlaybackQualityRange){ try{p.setPlaybackQualityRange("hd720","hd720");}catch(err){} }' +
      '  }' +
      '  poe();' +
      '  if(window.__ricepanelVigia) clearInterval(window.__ricepanelVigia);' +
      '  window.__ricepanelVigia=setInterval(poe,1000);' +
      '  setTimeout(function(){ clearInterval(window.__ricepanelVigia); }, 60000);' +
      '  return true;})()';

    const injeta = () => {
      try { quadro.executeJavaScript(script); } catch (e) {}
    };

    quadro.addEventListener('dom-ready', () => {
      try { quadro.setAudioMuted(false); } catch (e) {}
      injeta();
    }, { once: true });
    quadro.addEventListener('did-finish-load', injeta);

    // Cookies primeiro, página depois: carregar antes é entrar deslogado e
    // recarregar, com o anúncio no meio. Se a placa saiu enquanto esperava, a
    // webview já não está no documento e não há o que carregar.
    window.api.videoEntra().catch(() => {}).then(() => {
      if (quadro.isConnected) quadro.src = src;
    });
  }

  // ---- espelho da janela ----
  // Globoplay e Netflix não tocam dentro do Electron: falta o Widevine. Em vez
  // de fingir, o painel espelha a janela do navegador — quem decodifica
  // continua sendo o Chrome dele, com DRM e com o Premium que ele paga. O
  // preço é o diálogo do portal do Hyprland, uma vez por sessão.
  let espelho = null;              // MediaStream de pé
  function paraEspelho() {
    if (!espelho) return;
    try { espelho.getTracks().forEach(t => t.stop()); } catch (e) {}
    espelho = null;
  }

  async function ligaEspelho() {
    try {
      espelho = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false
      });
    } catch (e) {
      const aviso = document.getElementById('wEspelhoAviso');
      if (aviso) aviso.textContent = 'Não deu para espelhar: ' + (e.message || e.name);
      return;
    }
    const quadro = document.getElementById('wEspelhoQuadro');
    if (!quadro) { paraEspelho(); return; }
    quadro.srcObject = espelho;
    quadro.play().catch(() => {});
    document.getElementById('wEspelhoCapa').hidden = true;
    // O compositor pode encerrar a partilha por fora; quando isso acontece a
    // placa volta ao convite em vez de ficar com um quadro congelado.
    espelho.getVideoTracks().forEach(t => t.addEventListener('ended', () => {
      paraEspelho();
      const capa = document.getElementById('wEspelhoCapa');
      if (capa) capa.hidden = false;
    }));
  }

  function montaDrm(v) {
    paraEspelho();
    elVideo.innerHTML =
      '<span class="video-quadro">' +
        '<video id="wEspelhoQuadro" autoplay muted playsinline></video>' +
        '<span class="video-drm" id="wEspelhoCapa">' +
          '<span class="rotulo">Tocando no navegador</span>' +
          '<span class="video-titulo">' + esc(v.titulo || '—') + '</span>' +
          '<span class="rotulo">O serviço usa DRM e não roda dentro do painel</span>' +
          '<button class="botao-espelho" id="wEspelhoBotao">Espelhar a janela aqui</button>' +
          '<span class="rotulo" id="wEspelhoAviso"></span>' +
        '</span>' +
      '</span>' +
      '<span class="video-pe">' +
        '<span class="video-titulo">' + esc(v.titulo || 'Vídeo') + '</span>' +
        '<span class="rotulo video-onde">Espelho</span>' +
      '</span>';
    elVideo.hidden = false;
    document.body.classList.add('com-video');
    pintaMusica(ultimaMusica);
    const botao = document.getElementById('wEspelhoBotao');
    if (botao) botao.addEventListener('click', ligaEspelho);
  }

  // O volume vem do fluxo do navegador (PipeWire): o painel toca o mesmo vídeo,
  // então toca no mesmo volume que ele deixou na aba.
  function aplicaVolume(v) {
    const quadro = $('wVideoQuadro');
    if (!quadro || !v || v.volume == null) return;
    if (volumeAplicado != null && Math.abs(volumeAplicado - v.volume) < 0.02) return;
    volumeAplicado = v.volume;
    try {
      quadro.executeJavaScript(
        'var a=document.querySelector("video"); if(a){a.volume=' + v.volume.toFixed(3) + ';} true;');
    } catch (e) {}
  }

  // A chave na travessa. O estado vem sempre do main junto com o retrato do
  // vídeo, então o botão nunca mostra um "ligado" que o main não confirmou.
  const elVideoChave = $('wVideoChave');
  let videoLigado = false;

  function pintaChave(ligado) {
    videoLigado = !!ligado;
    elVideoChave.classList.toggle('on', videoLigado);
    elVideoChave.setAttribute('aria-pressed', String(videoLigado));
    elVideoChave.title = 'Vídeo do navegador na parede: ' + (videoLigado ? 'ligado' : 'desligado');
  }

  elVideoChave.addEventListener('click', () => {
    elVideoChave.disabled = true;
    window.api.videoLiga(!videoLigado)
      .then(pintaVideo)
      .catch(() => {})
      .then(() => { elVideoChave.disabled = false; });
  });

  function pintaVideo(v) {
    if (v && 'ligado' in v) pintaChave(v.ligado);
    if (!v || !v.site || v.janelaVisivel) {
      // Ele voltou para a janela: o painel devolve o vídeo e sai da frente.
      if (videoMontado && /^youtube/.test(videoMontado)) window.api.videoTocaNavegador().catch(() => {});
      paraEspelho();
      desmontaVideo();
      return;
    }

    const assinatura = v.site + ':' + v.id;
    if (assinatura === videoMontado) { aplicaVolume(v); return; }
    volumeAplicado = null;

    if (v.site === 'youtube') {
      montaYoutube(v);
      videoMontado = assinatura;
      // A aba fica em silêncio enquanto a parede toca.
      window.api.videoPausaNavegador().catch(() => {});
      return;
    }
    montaDrm(v);
    videoMontado = assinatura;
  }

  window.api.onVideo(pintaVideo);
  window.api.videoGet().then(pintaVideo).catch(() => {});

  // -------------------------------------------------- próximo jogo

  // Fonte: API pública do ESPN, pelo `flamengo.js` do main (mesma que o
  // MeuMengaoApp usa). Sem chave, então não há segredo para guardar aqui.
  const elJogo = $('wJogo');
  const elJogoCorpo = $('wJogoCorpo');

  const fmtDiaJogo = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'short'
  });

  // "Hoje 21:30" vale mais que "Quinta, 11 de set. 21:30" quando é hoje — é a
  // mesma regra que a agenda já usa dois blocos acima.
  function quandoDoJogo(d) {
    const hoje = new Date();
    const amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
    const hora = doisDig(d.getHours()) + ':' + doisDig(d.getMinutes());
    if (mesmoDia(d, hoje)) return 'Hoje, ' + hora;
    if (mesmoDia(d, amanha)) return 'Amanhã, ' + hora;
    return fmtDiaJogo.format(d) + ', ' + hora;
  }

  // O arquivo local vem primeiro: no boot da máquina o painel sobe antes da
  // rede, e a imagem remota falharia sem nunca ser pedida de novo. O endereço
  // do ESPN fica de reserva, para o dia em que o disco não tiver o escudo.
  function escudo(t) {
    const local = t.escudoLocal ? 'file://' + t.escudoLocal : '';
    const fonte = local || t.escudo;
    if (!fonte) return '<span class="jogo-versus">' + esc(t.sigla || '?') + '</span>';
    const reserva = local && t.escudo
      ? ' onerror="this.onerror=null;this.src=\'' + esc(t.escudo) + '\'"'
      : '';
    return '<img src="' + esc(fonte) + '" alt="" aria-hidden="true"' + reserva + '>';
  }

  function pintaJogo(d) {
    const j = d && d.jogo;
    if (!j) { elJogo.hidden = true; return; }
    elJogo.hidden = false;

    const quando = new Date(j.quando);
    const rolando = j.estado === 'in';
    const terminou = j.estado === 'post';
    const temPlacar = j.casa.placar != null && j.fora.placar != null;

    const linhaQuando = rolando
      ? 'AGORA · ' + j.competicao
      : terminou
        ? 'Fim de jogo · ' + j.competicao
        : quandoDoJogo(quando) + ' · ' + j.competicao;

    elJogoCorpo.className = 'jogo' + (rolando ? ' rolando' : '');
    elJogoCorpo.innerHTML =
      '<span class="jogo-escudos">' + escudo(j.casa) +
        '<span class="jogo-versus">×</span>' + escudo(j.fora) + '</span>' +
      '<span class="jogo-ident">' +
        '<span class="jogo-times">' + esc(j.casa.nome) + ' × ' + esc(j.fora.nome) + '</span>' +
        '<span class="jogo-quando">' + esc(linhaQuando) + '</span>' +
        (j.local ? '<span class="rotulo">' + esc(j.local) + '</span>' : '') +
      '</span>' +
      ((rolando || terminou) && temPlacar
        ? '<span class="jogo-placar">' + j.casa.placar + '–' + j.fora.placar + '</span>'
        : '');
  }

  window.api.onFlamengo(pintaJogo);
  window.api.flamengoGet().then(pintaJogo).catch(() => {});

  // ---------------------------------------------------------------- vidro

  // O fundo desfocado das placas. Vem do main como data: URL e entra numa
  // variável CSS; `background-attachment: fixed` no `.placa` faz o resto.
  // A classe no body é o que diz ao CSS que pode afinar a tinta: sem fundo, a
  // tinta chapada é a única coisa segurando a leitura e precisa ficar densa.
  function pintaVidro(v) {
    const tem = !!(v && v.fundo);
    document.documentElement.style.setProperty('--vidro-fundo', tem ? 'url("' + v.fundo + '")' : 'none');
    document.body.classList.toggle('tem-vidro', tem);
  }

  window.api.onVidro(pintaVidro);
  window.api.vidroGet().then(pintaVidro).catch(() => {});

  // ------------------------------------------------- retrato da máquina

  function pintaRetrato(r) {
    if (!r) return;
    ultimoRetrato = r;
    if (!acordado) return;

    montaAneis(r);
    pintaAnel('anCpu', r.cpu ? r.cpu.temp : null);
    if (r.cpu) {
      poeDados('anCpu', [
        r.cpu.pct == null ? '—' : r.cpu.pct + '%',
        r.cpu.ghz ? r.cpu.ghz.toFixed(1).replace('.', ',') + ' GHz' : ''
      ].filter(Boolean).join(' · '));
    }
    (listaGpus(r) || []).forEach((g, i) => {
      pintaAnel('anGpu' + i, g.temp);
      poeDados('anGpu' + i, dadosDaGpu(g));
    });
    pintaAnel('anNvme', r.nvme);

    const filaMed = (r.discos || []).map(d => d.ponto).join(',') +
      (r.memoria && r.memoria.swapTotal && r.memoria.swapUsado > 256 * 1048576 ? '+swap' : '');
    if (filaMed !== medidoresMontados) { medidoresMontados = filaMed; montaMedidores(r); }

    if (r.cpu) pintaMed('mCpu', r.cpu.pct, r.cpu.pct == null ? '—' : r.cpu.pct + '%');
    if (r.memoria) {
      pintaMed('mRam', r.memoria.pct, fmtGB(r.memoria.usada) + ' / ' + fmtGB(r.memoria.total));
      if (r.memoria.swapTotal && $('mSwapFio')) {
        const pct = Math.round((r.memoria.swapUsado / r.memoria.swapTotal) * 100);
        pintaMed('mSwap', pct, fmtGB(r.memoria.swapUsado));
      }
    }
    (r.discos || []).forEach((d, i) => {
      pintaMed('mDisco' + i, d.pct, fmtGB(d.total - d.usado) + ' livres');
    });

    if (r.rede) {
      $('wRedeRx').textContent = fmtBytes(r.rede.rxs) + '/s';
      $('wRedeTx').textContent = fmtBytes(r.rede.txs) + '/s';
      $('wRedeIface').textContent = r.rede.iface || '';
    }

    $('wUptime').textContent = fmtDuracao(r.uptime);
    pintaFicha(r);
  }

  // ------------------------------------------------------------- ligação

  window.api.onSistema((d) => {
    if (!d) return;
    ultimoHypr = d.hypr;
    pintaRetrato(d.retrato);
    if (acordado) { pintaHypr(d.hypr); pintaMusica(d.musica); }
  });

  window.api.onPacotes(pintaPacotes);

  // Um tique de um segundo só para o relógio. É barato: fora da virada do
  // minuto ele só troca a opacidade do dois-pontos.
  setInterval(() => { if (acordado) pintaRelogio(false); }, 1000);
  setInterval(() => { if (acordado) buscaAgenda(false); }, AGENDA_MS);
  // O mês redesenha de hora em hora para não ficar com o "hoje" de ontem
  // quando o painel passa a virada aberto nesta página.
  setInterval(() => { if (acordado) pintaMes(); }, 60 * 60 * 1000);

  function acorda(ligado) {
    const mudou = ligado !== acordado;
    acordado = ligado;
    tocaAnimacoes(ligado);
    if (!ligado || !mudou) return;
    // Voltar para a página é repintar tudo com o que já está em mãos: esperar o
    // próximo tique deixaria a tela dois segundos com o valor de quando ele saiu.
    pintaRelogio(true);
    pintaMes();
    pintaAgenda();
    pintaRetrato(ultimoRetrato);
    pintaHypr(ultimoHypr);
  }

  // Primeira pintura sem esperar tique nenhum.
  pintaRelogio(true);
  pintaMes();
  criarFundoBakeado('brumaMirante', 'bruma.json', { w: 900, h: 1600, blurPx: 46, intervaloMs: 3000 });
  criarFundoBakeado('auroraHora', 'aurora.json', { w: 600, h: 320, blurPx: 3, intervaloMs: 2500 });
  // Pequeno e sem blur: fica no lottie normal, 20 fps já é barato.
  musicaAnim = poeLottie('wOndas', 'ondas.json', {}, 20);
  buscaAgenda(false);
  window.api.getSistema().then((d) => {
    if (!d) return;
    ultimoHypr = d.hypr;
    pintaRetrato(d.retrato);
    pintaHypr(d.hypr);
    pintaMusica(d.musica);
  }).catch(() => {});

  window.mirante = { acorda: acorda };
})();
