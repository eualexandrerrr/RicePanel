// Player do vídeo do navegador, em janela própria.
//
// Por que janela e não elemento da página do painel: no Electron, o que é
// desenhado por cima de um <webview> não recebe o mouse — o evento vai para a
// página da webview embaixo. Nos Servidores a janelinha flutuava por cima dos
// consoles do txAdmin e não havia como pegar nela para arrastar (medido: nem
// pointerover chegava). Janela própria é arrastada e redimensionada pelo
// Windows, e é UMA só: no Mirante ela se encaixa na placa, fora dele flutua.
// Trocar de aba só muda a janela de lugar; o vídeo não recarrega.

const elQuadro = document.getElementById('quadro');
const elTitulo = document.getElementById('titulo');
let montado = '';               // id do vídeo que está tocando
let volumeAplicado = null;
// Mudo por dois motivos: o volume ainda não foi confirmado (o YouTube começa
// em 100%), ou ele está olhando a aba do Chrome, que toca junto e tem o som.
let somLiberado = false;
let chromeNaFrente = false;

function aplicaMudo() {
  const wv = elQuadro.querySelector('webview');
  if (!wv) return;
  try { wv.setAudioMuted(chromeNaFrente || !somLiberado); } catch (e) {}
}

// O que fica da página do YouTube é só o vídeo: sem cabeçalho, sugestões,
// comentários, e sem os controles do player por cima da imagem.
const SO_O_VIDEO = [
  '#masthead-container, ytd-masthead, #secondary, #below, #chat,',
  'ytd-comments, tp-yt-app-drawer, ytd-mini-guide-renderer,',
  'ytd-watch-metadata, #related, .ytp-chrome-top, .ytp-gradient-top,',
  'ytd-merch-shelf-renderer { display: none !important; }',
  '.ytp-chrome-bottom, .ytp-gradient-bottom, .ytp-chrome-controls, .ytp-bezel,',
  '.ytp-bezel-text-wrapper, .ytp-tooltip, .ytp-pause-overlay, .ytp-ce-element,',
  '.ytp-cards-teaser, .ytp-paid-content-overlay, .ytp-watermark,',
  '.ytp-overlay-bottom-right, .ytp-iv-player-content { display: none !important; }',
  '.html5-video-player, .html5-video-player * { cursor: none !important; }',
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

// Vigia injetado na página: repõe o CSS (o YouTube é SPA e troca o DOM), aplica
// o volume pelo PLAYER (setVolume, 0 a 100 — o <video>.volume já vem com a
// normalização de loudness e brigava com ela) e dá play enquanto a janela
// existir. A webview nasce muda e só ganha som depois de duas conferências com
// o volume certo: o YouTube começa no volume de fábrica (100%) e isso saía
// gritando. Sem volume do Chrome ainda, 15%.
function roteiro(volume) {
  return '(function(){' +
    '  var css=' + JSON.stringify(SO_O_VIDEO) + ';' +
    '  if(window.__ricepanelVol===undefined) window.__ricepanelVol=' + (volume != null ? Number(volume).toFixed(3) : '0.15') + ';' +
    '  var avisou="", confirmou=0;' +
    '  function poe(){' +
    '    var e=document.getElementById("ricepanel-so-o-video");' +
    '    if(!e){ e=document.createElement("style"); e.id="ricepanel-so-o-video";' +
    '            (document.head||document.documentElement).appendChild(e); }' +
    '    if(e.textContent!==css) e.textContent=css;' +
    '    var p=document.getElementById("movie_player");' +
    '    var v=document.querySelector("video");' +
    '    var vol=window.__ricepanelVol;' +
    '    if(p&&typeof p.setVolume==="function"){' +
    '      try{ if(p.isMuted&&p.isMuted()) p.unMute();' +
    '           if(vol!==null){ var alvo=Math.round(vol*100);' +
    '             if(p.getVolume()!==alvo){ p.setVolume(alvo); confirmou=0; } else confirmou++;' +
    '             if(confirmou>=2&&!window.__ricepanelSom){ window.__ricepanelSom=true; console.log("ricepanel: som-liberado "+alvo); } } }catch(err){}' +
    '    } else if(v){ if(vol!==null){ v.volume=vol; if(!window.__ricepanelSom){ window.__ricepanelSom=true; console.log("ricepanel: som-liberado "+Math.round(vol*100)); } } }' +
    '    if(p&&p.setPlaybackQualityRange){ try{p.setPlaybackQualityRange("hd720","hd720");}catch(err){} }' +
    // Live colada na borda, pelo PLAYER do YouTube. Mexer no <video>.currentTime
    // não serve: numa live do YouTube o `seekable` do elemento não é a janela
    // real, o salto não pegava e se repetia a cada volta, engasgando o vídeo
    // (medido: "pulou 3598 s" de 1,5 em 1,5 s). `seekToLiveHead` é o botão
    // "AO VIVO" do próprio player; no máximo uma vez a cada 20 s.
    '    try{ if(p&&typeof p.isAtLiveHead==="function"&&typeof p.seekToLiveHead==="function"){' +
    '      var dados=p.getVideoData?p.getVideoData():null;' +
    '      if(dados&&dados.isLive&&!p.isAtLiveHead()&&Date.now()-(window.__ricepanelBorda||0)>20000){' +
    '        window.__ricepanelBorda=Date.now(); p.seekToLiveHead(); console.log("ricepanel: ao vivo — voltou para a borda"); } } }catch(err){}' +
    '    if(v&&v.paused&&!v.ended){' +
    '      try{ if(p&&typeof p.playVideo==="function") p.playVideo(); }catch(err){}' +
    '      v.play().catch(function(err){ var m="ricepanel: play recusado — "+err.name+" "+err.message;' +
    '        if(m!==avisou){ avisou=m; console.log(m); } });' +
    '    }' +
    '  }' +
    '  poe();' +
    '  if(window.__ricepanelVigia) clearInterval(window.__ricepanelVigia);' +
    '  window.__ricepanelVigia=setInterval(poe,1500);' +
    '  return true;})()';
}

function monta(v) {
  elQuadro.textContent = '';
  volumeAplicado = v.volume;
  somLiberado = false;
  // Página normal do YouTube, não o /embed: o embed recusa origem file:// (erro
  // 153). O user-agent perde o carimbo do Electron: a sessão passa pela do
  // navegador de onde os cookies vieram.
  // Live não leva posição: o tempo da aba do Chrome numa live é posição no DVR,
  // e abrir ali deixava a parede atrás do ao vivo. Live é duração desconhecida.
  const aoVivo = v.duracao == null;
  const inicio = Math.max(0, (v.posicao || 0) - 1);
  const src = 'https://www.youtube.com/watch?v=' + encodeURIComponent(v.id) + (aoVivo ? '' : '&t=' + inicio + 's');
  const ua = navigator.userAgent.replace(/ (ricepanel|electron)\/\S+/gi, '');
  const wv = document.createElement('webview');
  wv.setAttribute('partition', 'persist:video-mirante');
  wv.setAttribute('allowpopups', 'false');
  wv.setAttribute('useragent', ua);
  elQuadro.appendChild(wv);

  const injeta = () => { try { wv.executeJavaScript(roteiro(v.volume)); } catch (e) {} };
  wv.addEventListener('dom-ready', () => {
    try { wv.setAudioMuted(true); } catch (e) {}
    injeta();
  }, { once: true });
  wv.addEventListener('did-finish-load', injeta);
  wv.addEventListener('console-message', (e) => {
    const msg = String(e.message || '');
    if (!/^ricepanel:/.test(msg)) return;
    if (/som-liberado/.test(msg)) { somLiberado = true; aplicaMudo(); }
    window.pip.diag('video: ' + msg.slice(10, 200));
  });

  // Cookies primeiro, página depois: carregar antes é entrar deslogado, com
  // anúncio no meio.
  window.pip.entra().catch(() => {}).then(() => {
    if (wv.isConnected && montado === v.id) wv.src = src;
  });
}

function aplicaVolume(volume) {
  const wv = elQuadro.querySelector('webview');
  if (!wv || volume == null) return;
  if (volumeAplicado != null && Math.abs(volumeAplicado - volume) < 0.02) return;
  volumeAplicado = volume;
  try { wv.executeJavaScript('window.__ricepanelVol=' + Number(volume).toFixed(3) + '; true;'); } catch (e) {}
}

window.pip.onVideo((v) => {
  document.body.classList.toggle('placa', !v || v.modo !== 'flutuante');
  if (!v || v.site !== 'youtube' || !v.id) return;   // o main esconde a janela
  elTitulo.textContent = v.titulo || 'Vídeo';
  if (chromeNaFrente !== !!v.janelaVisivel) {
    chromeNaFrente = !!v.janelaVisivel;
    aplicaMudo();
  }
  if (v.id !== montado) {
    montado = v.id;
    monta(v);
    return;
  }
  aplicaVolume(v.volume);
});
