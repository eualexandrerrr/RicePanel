// Ponte entre o Chrome e o RicePanel.
//
// O MPRIS do Chrome publica uma sessão de mídia só, a da última aba que tocou:
// com dois vídeos abertos o painel não sabia qual estava tocando, e o `pause`
// podia cair na aba errada. A extensão enxerga todas as abas, lê o <video> de
// cada uma (volume real, depois da normalização do YouTube; posição; pausa) e
// manda a lista ao painel por native messaging. O painel responde com comandos
// para uma aba específica: pausar, retomar.

const HOST = 'br.com.eualexandre.ricepanel';
// Versão do código da ponte. O Chrome guarda o service worker de extensão
// "sem compactação" em cache e não relê o fundo.js nem reiniciando o navegador;
// o painel compara este número com o do arquivo em disco e, diferente, manda
// `recarregar`. Suba o número a cada mudança neste arquivo.
const VERSAO_PONTE = 4;
const SITES = /^https:\/\/(www\.|m\.)?youtube\.com\/(watch|live)|^https:\/\/globoplay\.globo\.com\//;

let porta = null;

function conecta() {
  try {
    porta = chrome.runtime.connectNative(HOST);
  } catch (e) {
    porta = null;
    return;
  }
  porta.onMessage.addListener(trataComando);
  porta.onDisconnect.addListener(() => {
    porta = null;
    // O host morre junto com o painel; tenta de novo no próximo alarme.
  });
}

// Roda dentro da aba: estado do <video> principal.
function leVideo() {
  const v = [...document.querySelectorAll('video')].find(x => x.duration > 0 || x.readyState > 0);
  if (!v) return null;
  const vol = v.muted ? 0 : v.volume;
  return {
    tocando: !v.paused && !v.ended,
    posicao: v.currentTime,
    duracao: Number.isFinite(v.duration) ? v.duration : null,
    volume: vol,
    titulo: document.title.replace(/^\(\d+\)\s*/, '').replace(/\s+-\s+YouTube$/, '')
  };
}

// Roda no mundo da PÁGINA (world MAIN): o volume do player do YouTube, o mesmo
// número da barra de volume (0 a 100). O `volume` do <video> já vem com a
// normalização de loudness aplicada e muda de vídeo para vídeo; copiar esse
// número para o painel fazia o YouTube de lá normalizar de novo por cima.
function leVolumeYoutube() {
  const p = document.getElementById('movie_player');
  if (!p) return { api: 'sem movie_player' };
  if (typeof p.getVolume !== 'function') return { api: 'sem getVolume' };
  const r = { api: 'ok', volume: p.getVolume(), mudo: typeof p.isMuted === 'function' ? p.isMuted() : false };
  // Numa live: está na borda do ao vivo, e quantos segundos atrás dela.
  try {
    const dados = p.getVideoData ? p.getVideoData() : null;
    r.aoVivo = !!(dados && dados.isLive);
    if (r.aoVivo) {
      if (typeof p.isAtLiveHead === 'function') r.naBorda = p.isAtLiveHead();
      const prog = typeof p.getProgressState === 'function' ? p.getProgressState() : null;
      if (prog && Number.isFinite(prog.seekableEnd) && Number.isFinite(prog.current)) {
        r.atraso = Math.round(prog.seekableEnd - prog.current);
      }
    }
  } catch (e) {}
  return r;
}

// Roda no mundo da PÁGINA: numa live que ficou para trás, volta para o ao vivo
// (o botão "AO VIVO" do player) e garante o play.
function voltaAoVivo() {
  const p = document.getElementById('movie_player');
  if (!p) return 'sem movie_player';
  let feito = 'nada';
  try {
    const dados = p.getVideoData ? p.getVideoData() : null;
    if (dados && dados.isLive) {
      // `isAtLiveHead` do YouTube tem folga grande: medido 45 s atrás com ele
      // dizendo que estava na borda. A distância real sai do progresso.
      const prog = typeof p.getProgressState === 'function' ? p.getProgressState() : null;
      const atraso = prog && Number.isFinite(prog.seekableEnd) && Number.isFinite(prog.current)
        ? prog.seekableEnd - prog.current : null;
      const longe = atraso != null ? atraso > 5 : (typeof p.isAtLiveHead === 'function' && !p.isAtLiveHead());
      if (longe) {
        if (typeof p.seekToLiveHead === 'function') p.seekToLiveHead();
        else if (prog && Number.isFinite(prog.seekableEnd) && typeof p.seekTo === 'function') p.seekTo(prog.seekableEnd - 1, true);
        feito = 'pulou ' + Math.round(atraso || 0) + ' s';
      } else {
        feito = 'já na borda (' + Math.round(atraso || 0) + ' s)';
      }
    }
  } catch (e) { feito = 'erro ' + e.message; }
  try { if (typeof p.playVideo === 'function') p.playVideo(); } catch (e) {}
  return feito;
}

function pausaVideo(pausar) {
  const v = document.querySelector('video');
  if (!v) return false;
  if (pausar) v.pause(); else v.play().catch(() => {});
  return true;
}

async function relata() {
  if (!porta) conecta();
  if (!porta) return;
  const abas = await chrome.tabs.query({ url: ['https://www.youtube.com/*', 'https://m.youtube.com/*', 'https://globoplay.globo.com/*'] });
  const janelas = await chrome.windows.getAll();
  const focada = new Map(janelas.map(j => [j.id, j.focused]));
  // Minimizada conta como fora da vista: no Windows não há workspace para
  // perguntar, e é o estado da janela que diz se ele ainda enxerga a aba.
  const estadoJanela = new Map(janelas.map(j => [j.id, j.state]));
  const lista = [];
  for (const aba of abas) {
    if (!SITES.test(aba.url || '')) continue;
    let estado = null;
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: aba.id }, func: leVideo });
      estado = r && r.result;
    } catch (e) {}
    if (!estado) continue;
    if (/youtube\.com/.test(aba.url || '')) {
      try {
        const [yv] = await chrome.scripting.executeScript({ target: { tabId: aba.id }, func: leVolumeYoutube, world: 'MAIN' });
        const yr = yv && yv.result;
        estado.apiYoutube = (yr && yr.api) || 'script sem resposta';
        if (yr && yr.api === 'ok') {
          estado.volumeYoutube = yr.volume;
          estado.mudoYoutube = !!yr.mudo;
          estado.aoVivoYoutube = !!yr.aoVivo;
          if (yr.naBorda != null) estado.naBordaYoutube = yr.naBorda;
          if (yr.atraso != null) estado.atrasoAoVivo = yr.atraso;
        }
      } catch (e) {
        estado.apiYoutube = 'erro: ' + e.message;
      }
    }
    lista.push(Object.assign({
      aba: aba.id,
      janela: aba.windowId,
      url: aba.url,
      ativa: aba.active,
      janelaFocada: !!focada.get(aba.windowId),
      janelaEstado: estadoJanela.get(aba.windowId) || '',
      mudaNoChrome: !!(aba.mutedInfo && aba.mutedInfo.muted),
      audivel: !!aba.audible
    }, estado));
  }
  try { porta.postMessage({ tipo: 'abas', abas: lista, em: Date.now(), versao: VERSAO_PONTE }); } catch (e) {}
}

// Cookies da conta dele para a webview do painel, que tem sessão própria. Lista
// fechada de domínios: o host não pede cookie de banco nenhum por aqui.
const DOMINIOS_COOKIES = ['youtube.com'];

async function trataComando(msg) {
  // O painel viu que o fundo.js em disco é mais novo que este: relê a extensão.
  if (msg && msg.tipo === 'recarregar') {
    chrome.runtime.reload();
    return;
  }
  if (msg && msg.tipo === 'cookies') {
    const dominio = DOMINIOS_COOKIES.includes(msg.dominio) ? msg.dominio : null;
    let cookies = [];
    if (dominio) {
      try { cookies = await chrome.cookies.getAll({ domain: dominio }); } catch (e) {}
    }
    try { porta.postMessage({ tipo: 'cookies', pedido: msg.pedido, cookies }); } catch (e) {}
    return;
  }
  if (!msg || typeof msg.aba !== 'number') return;
  // Mutar em vez de pausar (painel do Windows): a aba segue tocando no ao vivo
  // enquanto o som vem da parede. Pausar uma live e retomar depois continua do
  // ponto parado, pelo DVR — o Chrome ficava minutos atrás da parede.
  if (msg.tipo === 'mutar' || msg.tipo === 'desmutar') {
    try { await chrome.tabs.update(msg.aba, { muted: msg.tipo === 'mutar' }); } catch (e) {}
    if (msg.tipo === 'desmutar') {
      try { await chrome.scripting.executeScript({ target: { tabId: msg.aba }, func: voltaAoVivo, world: 'MAIN' }); } catch (e) {}
    }
    relata();
    return;
  }
  if (msg.tipo === 'pausar' || msg.tipo === 'retomar') {
    try {
      await chrome.scripting.executeScript({ target: { tabId: msg.aba }, func: pausaVideo, args: [msg.tipo === 'pausar'] });
    } catch (e) {}
    relata();
  }
}

// O service worker do MV3 dorme; o alarme de 30 s o acorda, e enquanto a porta
// nativa está aberta ele fica de pé e relata a cada 2 s.
chrome.alarms.create('ricepanel', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(relata);
chrome.tabs.onUpdated.addListener((id, mudou) => { if ('audible' in mudou || mudou.status === 'complete') relata(); });
chrome.tabs.onActivated.addListener(relata);
chrome.tabs.onRemoved.addListener(relata);
chrome.windows.onFocusChanged.addListener(relata);
setInterval(relata, 2000);
relata();
