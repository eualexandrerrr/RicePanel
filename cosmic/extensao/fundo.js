// Ponte entre o Chrome e o RicePanel.
//
// O MPRIS do Chrome publica uma sessão de mídia só, a da última aba que tocou:
// com dois vídeos abertos o painel não sabia qual estava tocando, e o `pause`
// podia cair na aba errada. A extensão enxerga todas as abas, lê o <video> de
// cada uma (volume real, depois da normalização do YouTube; posição; pausa) e
// manda a lista ao painel por native messaging. O painel responde com comandos
// para uma aba específica: pausar, retomar.

const HOST = 'br.com.eualexandre.ricepanel';
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
  if (!p || typeof p.getVolume !== 'function') return null;
  return { volume: p.getVolume(), mudo: typeof p.isMuted === 'function' ? p.isMuted() : false };
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
        if (yv && yv.result) {
          estado.volumeYoutube = yv.result.volume;
          estado.mudoYoutube = !!yv.result.mudo;
        }
      } catch (e) {}
    }
    lista.push(Object.assign({
      aba: aba.id,
      janela: aba.windowId,
      url: aba.url,
      ativa: aba.active,
      janelaFocada: !!focada.get(aba.windowId),
      janelaEstado: estadoJanela.get(aba.windowId) || '',
      audivel: !!aba.audible
    }, estado));
  }
  try { porta.postMessage({ tipo: 'abas', abas: lista, em: Date.now() }); } catch (e) {}
}

// Cookies da conta dele para a webview do painel, que tem sessão própria. Lista
// fechada de domínios: o host não pede cookie de banco nenhum por aqui.
const DOMINIOS_COOKIES = ['youtube.com'];

async function trataComando(msg) {
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
