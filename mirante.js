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

    // Blur grande apaga o detalhe de qualquer jeito: rasterizar em 1/4 da largura
    // e da altura (e o blur na mesma escala) sai igual na tela, que estica com
    // background-size 100% 100%, e custa 1/16 do blur em software do canvas.
    // Medido em 13/09/2026: a bruma em 900x1600 com blur 46 levava o painel a ~5,6%
    // de CPU parado.
    const escala = blurPx >= 20 ? 0.25 : 1;
    w = Math.round(w * escala);
    h = Math.round(h * escala);
    blurPx = blurPx * escala;
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
    let pintando = false;
    // createImageBitmap não decodifica Blob de SVG no Chromium do Electron 33
    // ("The source image could not be decoded", a cada intervalo, sem nunca
    // pintar): o SVG entra por um <img>, com largura e altura fixas para ter
    // tamanho intrínseco.
    async function pinta() {
      const svg = offscreen.querySelector('svg');
      if (!svg || pintando) return;
      pintando = true;
      const copia = svg.cloneNode(true);
      copia.setAttribute('width', w);
      copia.setAttribute('height', h);
      const marcado = new XMLSerializer().serializeToString(copia);
      const urlSvg = URL.createObjectURL(new Blob([marcado], { type: 'image/svg+xml' }));
      const img = new Image();
      try {
        img.src = urlSvg;
        await img.decode();
      } catch (e) {
        pintando = false;
        return;
      } finally {
        URL.revokeObjectURL(urlSvg);
      }
      ctx.clearRect(0, 0, w, h);
      ctx.filter = blurPx ? `blur(${blurPx}px)` : 'none';
      ctx.drawImage(img, 0, 0, w, h);
      pintando = false;
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

  // Tarefas do Google Tarefas (tarefas.js) entram na mesma lista (27/09/2026):
  //  - atrasada: prazo antes de hoje e não concluída — sobe para o topo, em
  //    vermelho, com há quantos dias, e só sai quando ele marca como feita;
  //  - do dia: vai no bloco de Hoje com o botão de concluir;
  //  - futura: no dia dela, como compromisso.
  // A API só guarda a data do prazo, então tarefa não tem hora: mostra "tarefa".
  // Evento e tarefa com o mesmo título no mesmo dia (o lembrete que existe nos
  // dois) viram uma linha só — a da tarefa, que sabe se foi feita.
  function tituloBase(t) {
    return String(t || '').trim().toLowerCase();
  }

  function inicioDoDia(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  // Tarefa não tem hora (a API só guarda a data): no lugar da hora vai o
  // círculo de concluir, como no Google Tarefas, alinhado com os horários dos
  // eventos. O atraso vira segunda linha, em vermelho, por extenso.
  function linhaTarefa(t, extra) {
    const cls = 'agenda-item tarefa' + (t.feita ? ' feita' : '') + (extra ? ' ' + extra : '');
    const marca = t.feita
      ? '<span class="tarefa-ok" aria-label="Feita">✓</span>'
      : '<button class="tarefa-conclui" type="button" data-lista="' + esc(t.lista) + '" data-id="' + esc(t.id) +
        '" title="Marcar como feita" aria-label="Marcar como feita"></button>';
    let sub = '';
    if (extra === 'atrasada') {
      const dias = Math.round((inicioDoDia(new Date()) - inicioDoDia(new Date(t.dia))) / 86400000);
      sub = '<span class="agenda-local atraso">' + (dias === 1 ? 'atrasada desde ontem' : 'atrasada há ' + dias + ' dias') + '</span>';
    }
    return '<div class="' + cls + '">' +
      '<span class="agenda-hora">' + marca + '</span>' +
      '<span class="agenda-texto"><span class="agenda-titulo">' + esc(t.titulo) + '</span>' + sub + '</span>' +
      '</div>';
  }

  // O círculo só abre a confirmação; quem conclui é o botão do modal. Toque
  // sem querer num painel de parede não pode riscar tarefa (27/09/2026).
  const tarefaModal = $('tarefaModal');
  const tarefaOk = $('tarefaOk');
  let tarefaAlvo = null;

  function fechaTarefaModal() {
    tarefaModal.classList.remove('on');
    tarefaAlvo = null;
  }

  // Delegado no documento: o mesmo círculo existe na agenda do Mirante e no
  // resumo entre os consoles.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.tarefa-conclui');
    if (!b || b.disabled) return;
    const t = ((agendaEstado.tarefas || {}).tarefas || []).find(x => x.id === b.dataset.id);
    tarefaAlvo = { lista: b.dataset.lista, id: b.dataset.id };
    $('tarefaNome').textContent = t ? t.titulo : 'esta tarefa';
    $('tarefaNota').textContent = 'Ela sai do painel e fica concluída no Google Tarefas.';
    tarefaOk.disabled = false;
    tarefaModal.classList.add('on');
    tarefaOk.focus();
  });

  $('tarefaCancel').addEventListener('click', fechaTarefaModal);
  tarefaModal.addEventListener('click', (e) => { if (e.target === tarefaModal) fechaTarefaModal(); });

  tarefaOk.addEventListener('click', async () => {
    if (!tarefaAlvo) return;
    const alvo = tarefaAlvo;
    tarefaOk.disabled = true;
    let r = null;
    try { r = await window.api.tarefaConcluir(alvo.lista, alvo.id); } catch (err) {}
    if (r && r.ok) {
      const t = ((agendaEstado.tarefas || {}).tarefas || []).find(x => x.id === alvo.id);
      if (t) t.feita = true;
      fechaTarefaModal();
      pintaAgenda();
      pintaResumo();
      return;
    }
    // Falhou: o modal fica aberto, com o motivo, para tentar de novo.
    tarefaOk.disabled = false;
    $('tarefaNota').textContent = 'Não deu para marcar' + (r && r.error ? ' (' + r.error + ')' : '') + '. Tente de novo.';
  });

  function pintaAgenda() {
    pintaResumo();
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
    const hojeIni = inicioDoDia(new Date());
    const tarefas = ((agendaEstado.tarefas || {}).tarefas || []).filter(t => t.dia);
    const atrasadas = tarefas.filter(t => !t.feita && inicioDoDia(new Date(t.dia)) < hojeIni)
      .sort((a, b) => new Date(a.dia) - new Date(b.dia));
    const doDia = tarefas.filter(t => inicioDoDia(new Date(t.dia)) >= hojeIni);
    const chavesTarefa = new Set(doDia.map(t => chaveDia(new Date(t.dia)) + '|' + tituloBase(t.titulo)));
    if (!ev.length && !atrasadas.length && !doDia.length) {
      // Vazio é estado de calma, não de erro.
      pintaAgendaVazia('Nada marcado pelos próximos dias.');
      return;
    }
    soltaCalmo();

    const agora = Date.now();
    let html = '';
    if (atrasadas.length) {
      html += '<div class="agenda-dia atrasadas">Atrasadas · ' + atrasadas.length + '</div>';
      for (const t of atrasadas) html += linhaTarefa(t, 'atrasada');
    }

    // Eventos e tarefas do dia em diante numa linha do tempo só; tarefa vai no
    // começo do dia dela (não tem hora).
    const itens = ev
      .filter(e => !chavesTarefa.has(chaveDia(new Date(e.inicio)) + '|' + tituloBase(e.titulo)))
      .map(e => ({ tipo: 'evento', quando: new Date(e.inicio).getTime(), e }))
      .concat(doDia.map(t => ({ tipo: 'tarefa', quando: inicioDoDia(new Date(t.dia)) - 1, t })))
      .sort((a, b) => a.quando - b.quando);

    let diaAberto = '';
    // Só os quinze primeiros: a lista rola dentro de uma coluna estreita, e
    // compromisso de daqui a um mês não é o que ele consulta de relance.
    for (const it of itens.slice(0, 15)) {
      const ini = new Date(it.tipo === 'evento' ? it.e.inicio : it.t.dia);
      const chave = chaveDia(ini);
      const ehHoje = inicioDoDia(ini) === hojeIni;
      if (chave !== diaAberto) {
        diaAberto = chave;
        html += '<div class="agenda-dia' + (ehHoje ? ' hoje' : '') + '">' + esc(rotuloDoDia(ini)) + '</div>';
      }
      if (it.tipo === 'tarefa') {
        html += linhaTarefa(it.t, ehHoje ? 'de-hoje' : '');
        continue;
      }
      const e = it.e;
      const fim = e.fim ? new Date(e.fim) : null;
      const acabou = fim ? fim.getTime() < agora : ini.getTime() + 3600000 < agora;
      const rolando = ini.getTime() <= agora && !acabou;
      const cls = 'agenda-item' + (rolando ? ' agora' : acabou ? ' passou' : ehHoje ? ' de-hoje' : '');
      const hora = e.diaInteiro ? '<span class="dia-todo">dia todo</span>' : doisDig(ini.getHours()) + ':' + doisDig(ini.getMinutes());
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
    // Formato compacto (13/09/2026): a peça numa linha só. O anel pequeno abraça
    // a foto da peça — o arco mede a temperatura dela —, e ao lado vão o número,
    // o nome e o uso. Antes eram anel, foto, nome e dados empilhados: três
    // colunas altas para dizer três números.
    return '<div class="anel">' +
      '<span class="anel-aro">' +
        '<svg viewBox="0 0 84 84" aria-hidden="true">' +
          '<circle class="trilho" cx="42" cy="42" r="' + R + '"></circle>' +
          '<circle class="arco" id="' + id + 'Arco" cx="42" cy="42" r="' + R + '"' +
            ' stroke-dasharray="' + VOLTA.toFixed(2) + '"' +
            ' stroke-dashoffset="' + VOLTA.toFixed(2) + '"' +
            ' transform="rotate(-90 42 42)"></circle>' +
        '</svg>' +
        (foto ? '<img class="anel-foto" src="' + esc(foto) + '" alt="" aria-hidden="true">' : '') +
      '</span>' +
      '<span class="anel-info">' +
        '<span class="anel-temp"><b id="' + id + 'Txt">--</b><i>°C</i></span>' +
        '<span class="rotulo">' + rotulo + '</span>' +
        '<span class="anel-dados" id="' + id + 'Dados"></span>' +
      '</span>' +
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
    // Sem medidor de CPU: o uso já está embaixo do anel dela, e o mesmo número
    // duas vezes na mesma placa era o excesso. RAM e discos fecham uma linha.
    let html = med('mRam', 'RAM');
    (r.discos || []).forEach((d, i) => {
      // No Windows o ponto já é a letra do volume ("C:", "D:").
      html += med('mDisco' + i, d.ponto === '/' ? 'Root' : d.ponto === '~' ? 'Home' : d.ponto);
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
    // `null` é "não há gerenciador de pacotes para contar" (Windows): calar é
    // melhor que dizer "em dia" sem ter olhado.
    if (!p) { el.textContent = ''; return; }
    if (!p.total) { el.textContent = 'sistema em dia'; return; }
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
    sincronizaPip();
  }

  // O YouTube não toca aqui dentro: toca na janela do player (pip.html), que o
  // main põe por cima deste espaço no Mirante e deixa flutuar nas outras abas.
  // No Electron o que a página desenha por cima de um <webview> não recebe o
  // mouse, e a janelinha flutuando sobre os consoles não tinha como ser
  // arrastada. A placa guarda o lugar (preto, 16:9) e o título.
  function montaYoutube(v) {
    elVideo.innerHTML =
      '<span class="video-quadro" id="wVideoVaga"></span>' +
      '<span class="video-pe">' +
        '<span class="video-titulo">' + esc(v.titulo || 'Vídeo') + '</span>' +
        '<span class="rotulo video-onde">YouTube</span>' +
        '<button class="video-acao" id="wVideoAnterior" type="button" title="Anterior (depois de 5 s, volta ao começo)" aria-label="Anterior">' +
          '<svg viewBox="0 0 16 16" aria-hidden="true"><use href="#ic-anterior"/></svg></button>' +
        '<button class="video-acao" id="wVideoProximo" type="button" title="Próximo" aria-label="Próximo">' +
          '<svg viewBox="0 0 16 16" aria-hidden="true"><use href="#ic-proximo"/></svg></button>' +
        '<button class="video-acao" id="wVideoAuto" type="button" aria-label="Reprodução automática" hidden>' +
          '<svg viewBox="0 0 16 16" aria-hidden="true"><use href="#ic-auto"/></svg></button>' +
        '<select class="video-sel" id="wVideoVel" aria-label="Velocidade"></select>' +
        '<select class="video-sel" id="wVideoQual" aria-label="Qualidade" hidden></select>' +
        '<span class="video-divisa" aria-hidden="true"></span>' +
        '<button class="video-acao" id="wVideoVolMenos" type="button" title="Abaixar o volume" aria-label="Abaixar o volume">' +
          '<svg viewBox="0 0 16 16" aria-hidden="true"><use href="#ic-menos"/></svg></button>' +
        '<span class="video-volume" id="wVideoVolume" title="Volume do player no Chrome">--</span>' +
        '<button class="video-acao" id="wVideoVolMais" type="button" title="Aumentar o volume" aria-label="Aumentar o volume">' +
          '<svg viewBox="0 0 16 16" aria-hidden="true"><use href="#ic-mais"/></svg></button>' +
        '<button class="video-acao" id="wVideoMudo" type="button"></button>' +
        '<button class="video-acao fecha" id="wVideoFecha" type="button" title="Fechar o vídeo (pausa a aba no Chrome)" aria-label="Fechar o vídeo">' +
          '<svg viewBox="0 0 16 16" aria-hidden="true"><use href="#ic-x"/></svg></button>' +
      '</span>';
    $('wVideoAnterior').addEventListener('click', () => { window.api.videoAnterior().catch(() => {}); });
    $('wVideoProximo').addEventListener('click', () => { window.api.videoProximo().catch(() => {}); });
    $('wVideoAuto').addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (b.hidden) return;
      const novo = b.getAttribute('aria-pressed') !== 'true';
      pintaAuto({ autoplay: novo });
      window.api.videoAutoplay(novo).catch(() => {});
    });
    $('wVideoVel').addEventListener('change', (e) => { window.api.videoVelocidade(Number(e.target.value)).catch(() => {}); e.target.blur(); });
    $('wVideoQual').addEventListener('change', (e) => { window.api.videoQualidade(e.target.value).catch(() => {}); e.target.blur(); });
    $('wVideoVolMenos').addEventListener('click', () => mexeVolume(-PASSO_VOLUME));
    $('wVideoVolMais').addEventListener('click', () => mexeVolume(PASSO_VOLUME));
    $('wVideoMudo').addEventListener('click', () => {
      window.api.videoMudo().then(pintaMudo).catch(() => {});
    });
    $('wVideoFecha').addEventListener('click', (e) => {
      e.currentTarget.disabled = true;
      // Quem fecha quer silêncio: o fim do vídeo não devolve o som à aba.
      chromeComSom = null;
      window.api.videoFecha().catch(() => {});
    });
    pintaMudo(v);
    pintaAuto(v);
    pintaVelQual(v);
    pintaVolume(v.volume);
    elVideo.hidden = false;
    document.body.classList.add('com-video');
    pintaMusica(ultimaMusica);
  }

  // Diz ao main onde e como o player aparece: na placa (retângulo da vaga), a
  // flutuar (fora do Mirante), ou escondido — sem YouTube, ou com modal aberto,
  // que a janela do player cobriria.
  let pipUltimo = '';
  function sincronizaPip() {
    const vaga = $('wVideoVaga');
    const temYoutube = !!vaga && /^youtube:/.test(videoMontado);
    const modal = !!document.querySelector('.cortina.on');
    let estado = { visivel: false };
    if (temYoutube && !modal) {
      if (document.body.classList.contains('em-mirante')) {
        const r = vaga.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          estado = { visivel: true, modo: 'placa', x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        }
      } else {
        estado = { visivel: true, modo: 'flutuante' };
      }
    }
    const chave = JSON.stringify(estado);
    if (chave === pipUltimo) return;
    pipUltimo = chave;
    window.api.pipEstado(estado);
  }
  setInterval(sincronizaPip, 150);

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
    if (volumeAplicado != null && Math.abs(volumeAplicado - v.volume) < 0.002) return;
    volumeAplicado = v.volume;
    // Só muda o alvo do vigia: quem aplica é ele, pelo `setVolume` do player.
    try {
      quadro.executeJavaScript('window.__ricepanelVol=' + v.volume.toFixed(3) + '; true;');
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
    const rot = $('wVideoChaveRot');
    // O texto é a AÇÃO do clique, não o estado: o estado já está na cor.
    if (rot) rot.textContent = videoLigado ? 'Desligar player' : 'Ligar player';
  }

  elVideoChave.addEventListener('click', () => {
    elVideoChave.disabled = true;
    window.api.videoLiga(!videoLigado)
      .then(pintaVideo)
      .catch(() => {})
      .then(() => { elVideoChave.disabled = false; });
  });

  // Quem tem o som agora: true = a aba do Chrome (ele está olhando para ela),
  // false = a parede, null = ainda não decidido. O comando para a extensão só
  // sai na troca: a aba mutada continua "tocando", e mandar a cada tique
  // repetiria o mutar de 2 em 2 s.
  let chromeComSom = null;

  function pintaMudo(v) {
    const b = $('wVideoMudo');
    if (!b) return;
    const mudo = !!(v && v.mudo);
    b.classList.toggle('on', mudo);
    b.setAttribute('aria-pressed', String(mudo));
    b.title = mudo ? 'Tirar o mudo do player' : 'Deixar o player mudo';
    b.setAttribute('aria-label', b.title);
    b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><use href="#' + (mudo ? 'ic-mudo' : 'ic-som') + '"/></svg>';
  }

  // Volume em passos, no pé da placa: quem soma é a RiceExtension, sobre o
  // volume que o player do YouTube tem na aba naquele instante (0 a 100, o
  // número da barra de lá). Somar aqui erraria assim que ele mexesse no Chrome.
  // O som vem da janela do player (pip.html), que segue o mesmo volume no tique
  // seguinte; a leitura aqui já muda no clique para o botão não parecer solto.
  const PASSO_VOLUME = 0.5;
  let volumeMostrado = null;
  // Depois do clique a extensão ainda relata o volume velho por um tique; sem
  // esta carência o número pulava para trás e voltava.
  let volumeMexidoEm = 0;

  // Meio ponto tem casa decimal; ponto inteiro não mostra ",0".
  function textoVolume(pct) {
    const n = Math.round(pct * 10) / 10;
    return (Number.isInteger(n) ? String(n) : String(n).replace('.', ',')) + '%';
  }

  function pintaVolume(volume) {
    if (volume != null && Date.now() - volumeMexidoEm > 1800) volumeMostrado = volume;
    const el = $('wVideoVolume');
    if (!el) return;
    const txt = volumeMostrado == null ? '--' : textoVolume(volumeMostrado * 100);
    el.textContent = txt;
    el.title = 'Volume do player no Chrome' + (volumeMostrado == null ? '' : ': ' + txt);
  }

  function mexeVolume(delta) {
    window.api.videoVolume(delta).catch(() => {});
    volumeMexidoEm = Date.now();
    if (volumeMostrado == null) return;
    volumeMostrado = Math.max(0, Math.min(1, Math.round((volumeMostrado * 100 + delta) * 10) / 1000));
    pintaVolume(null);
  }

  // Reprodução automática: o interruptor do player do Chrome, lido pela
  // RiceExtension. Vídeo sem ele (playlist, live) esconde o botão.
  function pintaAuto(v) {
    const b = $('wVideoAuto');
    if (!b) return;
    const tem = v && v.autoplay != null;
    b.hidden = !tem;
    const on = !!(tem && v.autoplay);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.title = 'Reprodução automática: ' + (on ? 'ligada' : 'desligada');
  }

  // Velocidade e qualidade do player do Chrome. Mudar grava na configuração da
  // RiceExtension; em lilás quando o valor está fixado lá.
  const VELOCIDADES = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const NOME_QUALIDADE = {
    auto: 'Auto', tiny: '144p', small: '240p', medium: '360p', large: '480p',
    hd720: '720p', hd1080: '1080p', hd1440: '1440p', hd2160: '4K', hd2880: '5K', highres: '8K'
  };

  function preencheSel(sel, pares, atual) {
    const chave = JSON.stringify([pares, atual]);
    if (sel.dataset.chave === chave || document.activeElement === sel) return;
    sel.dataset.chave = chave;
    sel.textContent = '';
    for (const [valor, rotulo] of pares) {
      const o = document.createElement('option');
      o.value = valor;
      o.textContent = rotulo;
      sel.appendChild(o);
    }
    sel.value = atual;
  }

  function pintaVelQual(v) {
    const elVel = $('wVideoVel');
    const elQual = $('wVideoQual');
    if (!elVel || !elQual || !v) return;
    const vel = v.velocidade != null ? v.velocidade : 1;
    const nome = (x) => String(x).replace('.', ',') + '×';
    const lista = VELOCIDADES.includes(vel) ? VELOCIDADES : VELOCIDADES.concat(vel).sort((a, b) => a - b);
    preencheSel(elVel, lista.map(x => [String(x), nome(x)]), String(vel));
    const velFixa = !!(v.fixo && v.fixo.velocidade != null);
    elVel.classList.toggle('fixo', velFixa);
    elVel.title = 'Velocidade: ' + nome(vel) + (velFixa ? ' (fixada na RiceExtension)' : '');
    const qs = (v.qualidades || []).filter(q => NOME_QUALIDADE[q]);
    elQual.hidden = !qs.length;
    if (!qs.length) return;
    const atual = v.qualidade && qs.includes(v.qualidade) ? v.qualidade : qs[0];
    preencheSel(elQual, qs.map(q => [q, NOME_QUALIDADE[q]]), atual);
    const qualFixa = !!(v.fixo && v.fixo.qualidade);
    elQual.classList.toggle('fixo', qualFixa);
    elQual.title = 'Qualidade no Chrome: ' + NOME_QUALIDADE[atual] + (qualFixa ? ' (fixada na RiceExtension)' : '');
  }

  function pintaVideo(v) {
    if (v && 'ligado' in v) pintaChave(v.ligado);
    if (!v || !v.site) {
      // Acabou o vídeo ou a chave desligou: o painel sai da frente e devolve o
      // play à aba, se foi ele quem pausou.
      if (videoMontado && /^youtube/.test(videoMontado) && chromeComSom === false) window.api.videoTocaNavegador().catch(() => {});
      chromeComSom = null;
      paraEspelho();
      desmontaVideo();
      return;
    }

    const assinatura = v.site + ':' + v.id;
    // O player nasce assim que o vídeo toca no Chrome, mesmo com ele olhando
    // para a aba (mudo, pip.js): montar só na hora em que ele saía do Chrome
    // custava carregar a página, os cookies e chegar ao ao vivo — segundos de
    // atraso bem na troca.

    if (assinatura !== videoMontado) {
      volumeAplicado = null;
      if (v.site === 'youtube') montaYoutube(v); else montaDrm(v);
      videoMontado = assinatura;
    } else {
      aplicaVolume(v);
      const bMudo = $('wVideoMudo');
      if (bMudo && String(!!v.mudo) !== bMudo.getAttribute('aria-pressed')) pintaMudo(v);
      pintaAuto(v);
      pintaVelQual(v);
      pintaVolume(v.volume);
    }
    if (v.site !== 'youtube') return;

    // Voltar para o Chrome não interrompe a parede (13/09/2026): os dois tocam
    // juntos, e o som é da aba — a janela do player fica muda (pip.js). Saindo
    // da aba de novo, o painel pausa o Chrome e o som volta para a parede.
    if (v.janelaVisivel) {
      if (chromeComSom !== true) {
        chromeComSom = true;
        window.api.videoTocaNavegador().catch(() => {});
      }
    } else if (chromeComSom !== false) {
      chromeComSom = false;
      window.api.videoPausaNavegador().catch(() => {});
    }
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

  // Contagem até o apito, em dias, horas e minutos, como a do GTA. A cor esquenta
  // conforme o jogo chega: uma semana é informação, dois dias é aviso, o dia do
  // jogo é âmbar, e as duas últimas horas acendem no rubro do Flamengo. De dois
  // metros a cor diz "é hoje" antes de alguém ler o número.
  const NIVEIS_JOGO = [
    { ate: 2 * 3600e3, classe: 'nivel-ja' },
    { ate: 12 * 3600e3, classe: 'nivel-hoje' },
    { ate: 48 * 3600e3, classe: 'nivel-perto' },
    { ate: 7 * 86400e3, classe: 'nivel-semana' }
  ];
  let jogoAtual = null;

  function pintaContagemJogo() {
    const alvo = $('wJogoConta');
    if (!alvo || !jogoAtual) return;
    const resta = new Date(jogoAtual.quando) - Date.now();
    const nivel = NIVEIS_JOGO.find(n => resta <= n.ate);
    elJogoCorpo.classList.remove('nivel-ja', 'nivel-hoje', 'nivel-perto', 'nivel-semana');
    if (nivel) elJogoCorpo.classList.add(nivel.classe);
    if (resta <= 0) {
      alvo.innerHTML = '<span class="cr chegou"><b>Já vai</b><i>começar</i></span>';
      return;
    }
    const t = Math.floor(resta / 1000);
    const d = Math.floor(t / 86400);
    const h = Math.floor((t % 86400) / 3600);
    const m = Math.floor((t % 3600) / 60);
    const cel = (v, rot) => '<span class="cr"><b class="num">' + v + '</b><i>' + rot + '</i></span>';
    alvo.innerHTML = cel(d, d === 1 ? 'dia' : 'dias') + cel(h, h === 1 ? 'hora' : 'horas') + cel(m, 'min');
  }

  // "Ao vivo · 67'", ou "Intervalo". O minuto vem do scoreboard do ESPN, a cada 20 s.
  function aoVivo(j) {
    if (/^(HT|half ?time|intervalo)$/i.test(String(j.detalhe || '').trim())) return 'Intervalo';
    const min = String(j.relogio || '').trim();
    return 'Ao vivo' + (min && min !== "0'" ? ' · ' + min : '');
  }

  // Placar no mesmo idioma da contagem: uma célula por time, número grande e a
  // sigla embaixo, "×" no meio. Quem ganha fica aceso, quem perde apaga; no
  // empate os dois acesos. É a leitura de dois metros que o "0–0" solto não dava.
  function placarGrande(j, terminou) {
    const c = j.casa.placar, f = j.fora.placar;
    const celula = (t, perde) => '<span class="cr' + (perde ? ' perde' : '') + '">' +
      '<b class="num">' + t.placar + '</b><i>' + esc(t.sigla || String(t.nome || '').slice(0, 3)) + '</i></span>';
    return '<span class="conta-regressiva jogo-placar-vivo' + (terminou ? ' encerrado' : '') +
      '" role="status" aria-label="Placar: ' + esc(j.casa.nome) + ' ' + c + ', ' + esc(j.fora.nome) + ' ' + f + '">' +
      celula(j.casa, c < f) + '<span class="cr vs"><b>×</b></span>' + celula(j.fora, f < c) +
    '</span>';
  }

  function pintaJogo(d) {
    const j = d && d.jogo;
    if (!j) { elJogo.hidden = true; jogoAtual = null; return; }
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

    // O campeonato ganha linha própria: é o que diz o peso do jogo. A
    // transmissão entra junto quando a fonte souber; sem ela a linha só cala.
    const tv = Array.isArray(j.transmissao) && j.transmissao.length
      ? '<span class="jogo-tv"><b>TV</b>' + j.transmissao.map(esc).join(' · ') + '</span>'
      : '';

    jogoAtual = j;
    elJogoCorpo.className = 'jogo' + (rolando ? ' rolando' : '');
    elJogoCorpo.innerHTML =
      '<span class="jogo-escudos">' + escudo(j.casa) +
        '<span class="jogo-versus">×</span>' + escudo(j.fora) + '</span>' +
      '<span class="jogo-ident">' +
        '<span class="jogo-camp">' + esc(j.competicao) + (j.fase ? ' · ' + esc(j.fase) : '') + '</span>' +
        '<span class="jogo-times">' + esc(j.casa.nome) + ' × ' + esc(j.fora.nome) + '</span>' +
        (rolando
          ? '<span class="jogo-quando ao-vivo"><i class="ponto-vivo" aria-hidden="true"></i>' + esc(aoVivo(j)) + '</span>'
          : '<span class="jogo-quando">' + esc(terminou ? 'Fim de jogo' : quandoDoJogo(quando)) +
            (j.local ? ' · ' + esc(j.local) : '') + '</span>') +
      '</span>' +
      ((rolando || terminou) && temPlacar
        ? placarGrande(j, terminou)
        : (!rolando && !terminou
          ? '<span class="conta-regressiva jogo-conta" id="wJogoConta" role="timer" aria-label="Contagem regressiva para o jogo"></span>'
          : '<span></span>')) +
      // Onde passa é informação, não enfeite: linha própria, da coluna do texto
      // até embaixo da contagem, sem cortar canal nenhum.
      tv;
    if (!rolando && !terminou) pintaContagemJogo();
    pintaResumo();
  }

  // -------------------------------------------- resumo na tela Servidores
  // Entre os dois consoles: tarefa pendente (atrasada ou de hoje), o próximo
  // compromisso e o próximo jogo. Desenha mesmo com o Mirante adormecido —
  // é justamente quando ele está nos Servidores que isto aparece.
  function restaCurto(ms) {
    if (ms <= 0) return 'agora';
    const m = Math.floor(ms / 60000);
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mi = m % 60;
    if (d) return 'em ' + d + 'd ' + h + 'h';
    if (h) return 'em ' + h + 'h ' + doisDig(mi) + 'min';
    return 'em ' + mi + ' min';
  }

  // "Hoje, 21:30" / "Amanhã, 16:00" / "qui, 8/10, 19:30": cabe na célula estreita.
  function quandoCurto(d) {
    const hoje = new Date();
    const amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
    const hora = doisDig(d.getHours()) + ':' + doisDig(d.getMinutes());
    if (mesmoDia(d, hoje)) return 'Hoje, ' + hora;
    if (mesmoDia(d, amanha)) return 'Amanhã, ' + hora;
    const sem = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getDay()];
    return sem + ', ' + d.getDate() + '/' + (d.getMonth() + 1) + ', ' + hora;
  }

  // Cada célula do resumo tem a mesma anatomia das células de cima (30/09/2026):
  // um DESTAQUE grande à esquerda — número, hora, contagem — e o texto de apoio
  // ao lado. Lista de texto miúdo entre os consoles lia como mais log.
  function celulaResumo(destaque, classeDestaque, corpo) {
    return '<div class="resumo-bloco">' +
      '<span class="resumo-destaque ' + (classeDestaque || '') + '">' + destaque + '</span>' +
      '<span class="resumo-texto">' + corpo + '</span></div>';
  }

  function botaoConclui(t) {
    return '<button class="tarefa-conclui" type="button" data-lista="' + esc(t.lista) + '" data-id="' + esc(t.id) +
      '" title="Marcar como feita" aria-label="Marcar como feita"></button>';
  }

  function pintaResumo() {
    const elT = $('resumoTarefas'), elA = $('resumoAgenda'), elJ = $('resumoJogo');
    if (!elT || !elA || !elJ) return;
    const agora = Date.now();
    const hojeIni = inicioDoDia(new Date());
    const todas = ((agendaEstado.tarefas || {}).tarefas || []).filter(t => t.dia && !t.feita);

    // ------------------------------------------------------------ tarefas
    const pend = todas.filter(t => inicioDoDia(new Date(t.dia)) <= hojeIni)
      .sort((a, b) => new Date(a.dia) - new Date(b.dia));
    const atrasadas = pend.filter(t => inicioDoDia(new Date(t.dia)) < hojeIni).length;
    const cap = $('resumoTarefasCap');
    cap.textContent = atrasadas ? 'Tarefas · atrasada' + (atrasadas > 1 ? 's' : '') : (pend.length ? 'Tarefas de hoje' : 'Tarefas');
    cap.classList.toggle('alerta', atrasadas > 0);
    if (pend.length) {
      const t = pend[0];
      const dias = Math.round((hojeIni - inicioDoDia(new Date(t.dia))) / 86400000);
      const quando = dias > 0 ? (dias === 1 ? 'desde ontem' : 'há ' + dias + ' dias') : 'para hoje';
      elT.innerHTML = celulaResumo(String(pend.length), atrasadas ? 'alerta' : 'hoje',
        '<span class="resumo-titulo">' + esc(t.titulo) + '</span>' +
        '<span class="resumo-sub' + (dias > 0 ? ' alerta' : '') + '">' + botaoConclui(t) + quando +
          (pend.length > 1 ? ' · e mais ' + (pend.length - 1) : '') + '</span>');
    } else {
      // Nada atrasado nem para hoje: a próxima aparece em tom calmo, com o dia.
      const proxima = todas.filter(t => inicioDoDia(new Date(t.dia)) > hojeIni)
        .sort((a, b) => new Date(a.dia) - new Date(b.dia))[0];
      elT.innerHTML = proxima
        ? celulaResumo('<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.3l3 3 6-6.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>', 'ok',
            '<span class="resumo-titulo calmo">Nada para hoje</span>' +
            '<span class="resumo-sub">' + botaoConclui(proxima) + esc(rotuloDoDia(new Date(proxima.dia))) + ': ' + esc(proxima.titulo) + '</span>')
        : celulaResumo('<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.3l3 3 6-6.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>', 'ok',
            '<span class="resumo-titulo calmo">Nada pendente</span>');
    }

    // ------------------------------------------------------------ próximo
    // O lembrete que também é tarefa já está na coluna de tarefas.
    const titulosTarefa = new Set(((agendaEstado.tarefas || {}).tarefas || []).map(t => tituloBase(t.titulo)));
    const prox = (agendaEstado.eventos || []).find(e => {
      if (titulosTarefa.has(tituloBase(e.titulo))) return false;
      const ini = new Date(e.inicio).getTime();
      const fim = e.fim ? new Date(e.fim).getTime() : ini + 3600000;
      return fim > agora;
    });
    if (!prox) {
      elA.innerHTML = celulaResumo('—', 'calmo', '<span class="resumo-titulo calmo">Nada marcado</span>');
    } else {
      const ini = new Date(prox.inicio);
      const rolando = ini.getTime() <= agora;
      const ehHoje = mesmoDia(ini, new Date());
      const destaque = rolando ? 'agora'
        : prox.diaInteiro ? quandoCurto(ini).split(',')[0]
        : doisDig(ini.getHours()) + ':' + doisDig(ini.getMinutes());
      const sub = rolando ? 'acontecendo agora'
        : (prox.diaInteiro ? 'dia todo' : rotuloDoDia(ini)) + (prox.diaInteiro ? ' · ' + rotuloDoDia(ini) : ' · ' + restaCurto(ini - agora));
      elA.innerHTML = celulaResumo(esc(destaque), rolando ? 'vivo' : ehHoje ? 'hoje' : '',
        '<span class="resumo-titulo">' + esc(prox.titulo) + '</span>' +
        '<span class="resumo-sub' + (ehHoje || rolando ? ' quente' : '') + '">' + esc(sub) + '</span>');
    }

    // ------------------------------------------------------------ jogo
    const j = jogoAtual;
    if (!j) {
      elJ.innerHTML = celulaResumo('—', 'calmo', '<span class="resumo-titulo calmo">Sem jogo marcado</span>');
      return;
    }
    const quando = new Date(j.quando);
    const rolando = j.estado === 'in';
    const terminou = j.estado === 'post';
    const temPlacar = j.casa.placar != null && j.fora.placar != null;
    const perto = quando - agora < 24 * 3600e3;
    const local = j.local ? String(j.local).replace(/^est[aá]dio\s+/i, '') : '';
    const lado = (rolando || terminou)
      ? (temPlacar
        ? '<span class="resumo-placar' + (rolando ? ' vivo' : '') + '"><b>' + j.casa.placar + '</b><i>×</i><b>' + j.fora.placar + '</b></span>'
        : '')
      : '<span class="resumo-destaque conta' + (perto ? ' hoje' : '') + '">' + esc(restaCurto(quando - agora).replace(/^em /, '')) + '</span>';
    const sub = rolando
      ? '<span class="resumo-sub vivo">' + esc(aoVivo(j)) + '</span>'
      : terminou
        ? '<span class="resumo-sub">Fim de jogo</span>'
        : '<span class="resumo-sub' + (perto ? ' quente' : '') + '">' + esc(quandoCurto(quando)) + '</span>';
    elJ.innerHTML = '<div class="resumo-bloco jogo">' +
      '<span class="resumo-escudos">' + escudo(j.casa) + escudo(j.fora) + '</span>' +
      '<span class="resumo-texto">' +
        '<span class="resumo-titulo">' + esc(j.casa.nome) + ' × ' + esc(j.fora.nome) + '</span>' +
        sub +
        (local ? '<span class="resumo-sub local">' + esc(local) + '</span>' : '') +
      '</span>' + lado + '</div>';
  }

  // Contagem em minutos e "agora" do compromisso: um tique por minuto basta.
  setInterval(pintaResumo, 60000);

  // Resolução de minuto: um tique de 20 s basta para o número nunca ficar um
  // minuto inteiro atrasado.
  setInterval(() => { if (acordado) pintaContagemJogo(); }, 20000);

  window.api.onFlamengo(pintaJogo);
  // Tarefas chegam depois da agenda (Apps Script leva uns segundos) e mudam
  // quando ele conclui pelo celular: o main empurra, sem esperar os 5 min.
  window.api.onAgenda((a) => { agendaEstado = a; pintaAgenda(); });
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
    // Windows: janela opaca, o papel de parede é pintado aqui (04/10/2026).
    const nitido = !!(v && v.nitido);
    document.documentElement.style.setProperty('--papel-nitido', nitido ? 'url("' + v.nitido + '")' : 'none');
    document.body.classList.toggle('papel-proprio', nitido);
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
