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

  function poeLottie(elId, arquivo, opcoes) {
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
      animacoes.push(a);
      return a;
    } catch (e) {
      return null;
    }
  }

  function tocaAnimacoes(ligado) {
    for (const a of animacoes) {
      try { ligado ? a.play() : a.pause(); } catch (e) {}
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

  function pintaAgenda() {
    const ev = agendaEstado.eventos || [];
    diasComEvento = new Set(ev.map(e => chaveDia(new Date(e.inicio))));
    pintaMes();

    elAgendaQuando.textContent = agendaEstado.erro
      ? 'sem conexão'
      : (agendaEstado.atualizadoEm ? 'lida ' + hhmm(agendaEstado.atualizadoEm) : '');

    if (!agendaEstado.temUrl) {
      elAgendaLista.innerHTML =
        '<div class="agenda-vazio">Sem calendário ligado — abra o ajuste e cole o endereço iCal.</div>';
      return;
    }
    if (!ev.length) {
      // Vazio é estado de calma, não de erro.
      elAgendaLista.innerHTML = '<div class="agenda-vazio">Nada marcado pelos próximos dias.</div>';
      return;
    }

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

  function svgAnel(id, rotulo) {
    return '<div class="anel">' +
      '<svg viewBox="0 0 84 84">' +
        '<circle class="trilho" cx="42" cy="42" r="' + R + '"></circle>' +
        '<circle class="arco" id="' + id + 'Arco" cx="42" cy="42" r="' + R + '"' +
          ' stroke-dasharray="' + VOLTA.toFixed(2) + '"' +
          ' stroke-dashoffset="' + VOLTA.toFixed(2) + '"' +
          ' transform="rotate(-90 42 42)"></circle>' +
        '<text class="centro" id="' + id + 'Txt" x="42" y="42" text-anchor="middle" dominant-baseline="central">--</text>' +
        '<text class="grau" x="42" y="60" text-anchor="middle">°C</text>' +
      '</svg>' +
      '<span class="rotulo">' + rotulo + '</span>' +
    '</div>';
  }

  const SENSORES = [
    { id: 'anCpu', rotulo: 'CPU' },
    { id: 'anGpu', rotulo: 'GPU' },
    { id: 'anNvme', rotulo: 'SSD' }
  ];
  elAneis.innerHTML = SENSORES.map(s => svgAnel(s.id, s.rotulo)).join('');

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
  let medidoresMontados = false;

  function montaMedidores(r) {
    // Rótulo curto: a coluna da serigrafia é estreita para o trilho ficar
    // longo, e "Processador" já saía cortado em "Processad".
    let html = med('mCpu', 'CPU') + med('mRam', 'RAM');
    (r.discos || []).forEach((d, i) => {
      html += med('mDisco' + i, d.ponto === '/' ? 'Raiz' : 'Casa');
    });
    if (r.memoria && r.memoria.swapTotal) html += med('mSwap', 'Swap');
    elMedidores.innerHTML = html;
    medidoresMontados = true;
  }

  // ------------------------------------------------------------- música

  const elMusica = $('wMusica');
  let musicaAnim = null;

  function pintaMusica(m) {
    if (!m || !m.titulo) { elMusica.hidden = true; if (musicaAnim) musicaAnim.pause(); return; }
    elMusica.hidden = false;
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

  const elWorkspaces = $('wWorkspaces');
  const elJanela = $('wJanela');
  const elFicha = $('wFicha');

  function pintaHypr(h) {
    if (!h) { elWorkspaces.innerHTML = ''; elJanela.textContent = ''; return; }
    elWorkspaces.innerHTML = (h.workspaces || []).map(w =>
      '<span class="ws' + (w.ativo ? ' ativo' : '') + '">' + w.id +
      (w.janelas ? '<span class="n">' + w.janelas + '</span>' : '') + '</span>'
    ).join('');
    elJanela.textContent = h.janela ? h.janela.titulo : '';
  }

  function linhaFicha(rotulo, valor) {
    return '<span class="ficha-linha"><span class="rotulo">' + rotulo +
      '</span><span class="v">' + esc(valor) + '</span></span>';
  }

  function pintaFicha(r) {
    elFicha.innerHTML =
      linhaFicha('Sistema', r.distro || '—') +
      linhaFicha('Kernel', r.kernel || '—') +
      linhaFicha('Máquina', (r.usuario || '') + '@' + (r.host || '')) +
      linhaFicha('Carga', (r.carga || []).map(n => n.toFixed(2).replace('.', ',')).join('  ') || '—');
  }

  function pintaPacotes(p) {
    const el = $('wPacotes');
    if (!p || !p.total) { el.textContent = 'sistema em dia'; return; }
    el.textContent = p.total + (p.total === 1 ? ' pacote a atualizar' : ' pacotes a atualizar');
  }

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

    pintaAnel('anCpu', r.cpu ? r.cpu.temp : null);
    pintaAnel('anGpu', r.gpu ? r.gpu.temp : null);
    pintaAnel('anNvme', r.nvme);

    if (!medidoresMontados) montaMedidores(r);

    if (r.cpu) {
      pintaMed('mCpu', r.cpu.pct, r.cpu.pct == null ? '—' : r.cpu.pct + '%');
      $('wCargaModelo').textContent =
        [r.cpu.modelo, r.cpu.ghz ? r.cpu.ghz.toFixed(1).replace('.', ',') + ' GHz' : '']
          .filter(Boolean).join(' · ');
    }
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
  poeLottie('auroraHora', 'aurora.json', { rendererSettings: { preserveAspectRatio: 'xMidYMid slice' } });
  musicaAnim = poeLottie('wOndas', 'ondas.json');
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
