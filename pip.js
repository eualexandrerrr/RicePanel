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
// Terceiro motivo: ele apertou o mudo (barra aqui, ou pé da placa no Mirante).
let mudoPedido = false;

// O som é SEMPRE do Chrome (21/09/2026): a parede é só imagem, sincronizada
// com a aba. Trocar o som de lado a cada troca de janela fazia o volume e o
// ponto do vídeo "pularem" na orelha. O mudo da barra muta a aba do Chrome.
function aplicaMudo() {
  const wv = elQuadro.querySelector('webview');
  if (!wv) return;
  try { wv.setAudioMuted(true); } catch (e) {}
}

const elMudo = document.getElementById('mudo');
const elFecha = document.getElementById('fecha');

function pintaMudo() {
  elMudo.classList.toggle('on', mudoPedido);
  elMudo.setAttribute('aria-pressed', String(mudoPedido));
  elMudo.title = mudoPedido ? 'Tirar o mudo do player' : 'Deixar o player mudo';
  elMudo.setAttribute('aria-label', elMudo.title);
  elMudo.querySelector('use').setAttribute('href', mudoPedido ? '#ic-mudo' : '#ic-som');
}

// Volume: menos e mais mudam o volume do PLAYER do YouTube na aba do Chrome
// (0 a 100, o número da barra de lá). A parede toca o mesmo vídeo, então o
// volume é um só; a extensão devolve o valor novo no relato seguinte. O passo é
// de meio ponto: é para chegar devagar no ponto que ele quer.
const PASSO_VOLUME = 0.5;
const elVolume = document.getElementById('volume');
let volumeMostrado = null;
// Depois do clique a extensão ainda relata o volume velho por um tique; sem
// esta carência o número pulava para trás e voltava.
let volumeMexidoEm = 0;

// Meio ponto tem casa decimal; ponto inteiro não mostra ",0".
function textoVolume(pct) {
  const n = Math.round(pct * 10) / 10;
  return (Number.isInteger(n) ? String(n) : String(n).replace('.', ',')) + '%';
}

function pintaVolume() {
  const txt = volumeMostrado == null ? '--' : textoVolume(volumeMostrado * 100);
  elVolume.textContent = txt;
  elVolume.title = 'Volume do player no Chrome' + (volumeMostrado == null ? '' : ': ' + txt);
}

// O clique já mexe na parede e na leitura, sem esperar o tique de 2 s da
// extensão: só o Chrome demora, e o que ele ouve é a parede.
function mexeVolume(delta) {
  window.pip.volume(delta).catch(() => {});
  volumeMexidoEm = Date.now();
  if (volumeMostrado == null) return;
  volumeMostrado = Math.max(0, Math.min(1, Math.round((volumeMostrado * 100 + delta) * 10) / 1000));
  pintaVolume();
  aplicaVolume(volumeMostrado);
}

document.getElementById('volmenos').addEventListener('click', () => mexeVolume(-PASSO_VOLUME));
document.getElementById('volmais').addEventListener('click', () => mexeVolume(PASSO_VOLUME));

const elAuto = document.getElementById('auto');
let autoplay = null;

function pintaAuto() {
  elAuto.hidden = autoplay == null;
  elAuto.classList.toggle('on', !!autoplay);
  elAuto.setAttribute('aria-pressed', String(!!autoplay));
  elAuto.title = 'Reprodução automática: ' + (autoplay ? 'ligada' : 'desligada');
}

// Velocidade e qualidade: o que o player do Chrome está usando agora. Mudar
// aqui grava na configuração da RiceExtension (vale para os próximos vídeos).
const VELOCIDADES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const NOME_QUALIDADE = {
  auto: 'Auto', tiny: '144p', small: '240p', medium: '360p', large: '480p',
  hd720: '720p', hd1080: '1080p', hd1440: '1440p', hd2160: '4K', hd2880: '5K', highres: '8K'
};
const elVel = document.getElementById('velocidade');
const elQual = document.getElementById('qualidade');
let velocidadeAplicada = null;
let velocidadeDesejada = 1;

function nomeVelocidade(v) {
  return String(v).replace('.', ',') + '×';
}

function preenche(sel, pares, atual) {
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
  const vel = v.velocidade != null ? v.velocidade : 1;
  const lista = VELOCIDADES.includes(vel) ? VELOCIDADES : VELOCIDADES.concat(vel).sort((a, b) => a - b);
  preenche(elVel, lista.map(x => [String(x), nomeVelocidade(x)]), String(vel));
  const velFixa = v.fixo && v.fixo.velocidade != null;
  elVel.classList.toggle('fixo', !!velFixa);
  elVel.title = 'Velocidade: ' + nomeVelocidade(vel) + (velFixa ? ' (fixada na RiceExtension)' : '');

  const qs = (v.qualidades || []).filter(q => NOME_QUALIDADE[q]);
  elQual.hidden = !qs.length;
  if (qs.length) {
    const atual = v.qualidade && qs.includes(v.qualidade) ? v.qualidade : qs[0];
    preenche(elQual, qs.map(q => [q, NOME_QUALIDADE[q]]), atual);
    const qualFixa = v.fixo && v.fixo.qualidade;
    elQual.classList.toggle('fixo', !!qualFixa);
    elQual.title = 'Qualidade no Chrome: ' + (NOME_QUALIDADE[atual] || atual) + (qualFixa ? ' (fixada na RiceExtension)' : '');
  }
  aplicaVelocidade(vel);
}

// A parede acompanha a velocidade do Chrome: os dois tocam juntos.
function aplicaVelocidade(vel) {
  velocidadeDesejada = vel;
  const wv = elQuadro.querySelector('webview');
  if (!wv || vel === velocidadeAplicada) return;
  velocidadeAplicada = vel;
  try { wv.executeJavaScript('window.__ricepanelVelo=' + Number(vel) + '; true;'); } catch (e) {}
}

elVel.addEventListener('change', () => { window.pip.velocidade(Number(elVel.value)).catch(() => {}); elVel.blur(); });
elQual.addEventListener('change', () => { window.pip.qualidade(elQual.value).catch(() => {}); elQual.blur(); });

document.getElementById('anterior').addEventListener('click', () => { window.pip.anterior().catch(() => {}); });
document.getElementById('proximo').addEventListener('click', () => { window.pip.proximo().catch(() => {}); });
elAuto.addEventListener('click', () => {
  if (autoplay == null) return;
  autoplay = !autoplay;
  pintaAuto();
  window.pip.autoplay(autoplay).catch(() => {});
});
elMudo.addEventListener('click', () => { window.pip.mudo().catch(() => {}); });
elFecha.addEventListener('click', () => { window.pip.fecha().catch(() => {}); });

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
    '  window.__ricepanelVelo=' + Number(velocidadeDesejada || 1) + ';' +
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
    '           if(vol!==null){ var alvo=Math.round(vol*1000)/10;' +
    // O `getVolume` do YouTube devolve inteiro, então comparar com um alvo de
    // meio ponto nunca fechava: o vigia reescrevia o volume a cada 1,5 s e
    // `confirmou` nunca chegava a 2 (a parede ficava muda). O alvo posto fica
    // guardado, e o `getVolume` serve só para pegar desvio de verdade (o player
    // mexido por fora), com folga de 1,5 ponto para o arredondamento dele.
    '             if(window.__ricepanelVolPosto!==alvo||Math.abs(p.getVolume()-alvo)>1.5){' +
    // Fator de normalização de loudness do YouTube, medido ANTES de mexer:
    // `<video>.volume` = volume do player × fator. Escrever alvo/100 cru no
    // elemento (como estava) jogava fora a normalização — a parede tocava em
    // outro volume que o Chrome, e cada troca de janela "mudava o volume".
    '               var ant=p.getVolume(), fator=(v&&ant>0)?v.volume/(ant/100):NaN;' +
    '               p.setVolume(alvo); window.__ricepanelVolPosto=alvo;' +
    // Meio ponto: o fator reposto sobre o alvo com a casa decimal. Se o player
    // já guardou a fração, isto escreve o mesmo número.
    '               if(v&&isFinite(fator)&&fator>0&&fator<=1.01){ try{ v.volume=Math.max(0,Math.min(1,fator*alvo/100)); }catch(err){} }' +
    '               confirmou=0; } else confirmou++;' +
    '             if(confirmou>=2&&!window.__ricepanelSom){ window.__ricepanelSom=true; console.log("ricepanel: som-liberado "+alvo); } } }catch(err){}' +
    '    } else if(v){ if(vol!==null){ v.volume=vol; if(!window.__ricepanelSom){ window.__ricepanelSom=true; console.log("ricepanel: som-liberado "+Math.round(vol*100)); } } }' +
    '    if(p&&p.setPlaybackQualityRange){ try{p.setPlaybackQualityRange("hd720","hd720");}catch(err){} }' +
    '    try{ var velo=window.__ricepanelVelo; if(!window.__ricepanelTaxa&&p&&velo&&typeof p.getPlaybackRate==="function"&&p.getPlaybackRate()!==velo) p.setPlaybackRate(velo); }catch(err){}' +
    // Live colada na borda, pelo PLAYER do YouTube. Mexer no <video>.currentTime
    // não serve: numa live do YouTube o `seekable` do elemento não é a janela
    // real, o salto não pegava e se repetia a cada volta, engasgando o vídeo
    // (medido: "pulou 3598 s" de 1,5 em 1,5 s). `seekToLiveHead` é o botão
    // "AO VIVO" do próprio player; no máximo uma vez a cada 20 s.
    // Com relógio do Chrome fresco quem manda é ele, não a borda: a aba pode
    // estar de propósito atrás do ao vivo, e o som é dela.
    '    var refViva=window.__ricepanelPos&&Date.now()-window.__ricepanelPos.em<6000;' +
    '    try{ if(!refViva&&p&&typeof p.isAtLiveHead==="function"&&typeof p.seekToLiveHead==="function"){' +
    '      var dados=p.getVideoData?p.getVideoData():null;' +
    '      if(dados&&dados.isLive&&!p.isAtLiveHead()&&Date.now()-(window.__ricepanelBorda||0)>20000){' +
    '        window.__ricepanelBorda=Date.now(); p.seekToLiveHead(); console.log("ricepanel: ao vivo — voltou para a borda"); } } }catch(err){}' +
    '    if(v&&v.paused&&!v.ended){' +
    '      try{ if(p&&typeof p.playVideo==="function") p.playVideo(); }catch(err){}' +
    '      v.play().catch(function(err){ var m="ricepanel: play recusado — "+err.name+" "+err.message;' +
    '        if(m!==avisou){ avisou=m; console.log(m); } });' +
    '    }' +
    '  }' +
    // Sincronia com o Chrome, que tem o som: a imagem da parede tem de bater com
  // a orelha. Relógio = posição lida pela extensão + tempo desde a leitura
  // (leitura com mais de 6 s não vale: Chrome pausado, extensão parada).
  // Desvio pequeno se corrige pela TAXA do elemento (a parede é muda, ninguém
  // ouve o 1,1×), proporcional ao erro; salto com `seekTo` só acima de 2 s,
  // porque salto rebufferiza e deixa a parede atrás de novo. Live: só taxa, e
  // desvio acima de 20 s é linha do tempo diferente — não mexe.
  '  function sinc(){' +
  '    try{ var ref=window.__ricepanelPos, v=document.querySelector("video"), p=document.getElementById("movie_player");' +
  '      var velo=window.__ricepanelVelo||1;' +
  '      if(!ref||!v||v.paused||Date.now()-ref.em>6000){ if(v&&window.__ricepanelTaxa){ v.playbackRate=velo; window.__ricepanelTaxa=0; } return; }' +
  '      var esperado=ref.pos+(Date.now()-ref.em)/1000*velo, desvio=v.currentTime-esperado;' +
  '      if(Date.now()-(window.__ricepanelSincLog||0)>30000){ window.__ricepanelSincLog=Date.now();' +
  '        console.log("ricepanel: sinc desvio="+(desvio>0?"+":"")+desvio.toFixed(2)+" s taxa="+v.playbackRate.toFixed(3)+(ref.aoVivo?" ao-vivo":"")); }' +
  '      if(ref.aoVivo&&Math.abs(desvio)>20) return;' +
  '      if(!ref.aoVivo&&Math.abs(desvio)>2){' +
  '        if(p&&typeof p.seekTo==="function"&&Date.now()-(window.__ricepanelSinc||0)>5000){' +
  '          window.__ricepanelSinc=Date.now(); p.seekTo(esperado+0.5,true);' +
  '          console.log("ricepanel: acertou com o Chrome ("+(desvio>0?"+":"")+desvio.toFixed(1)+" s)"); }' +
  '        return; }' +
  '      var lim=ref.aoVivo?0.25:0.15;' +
  '      var taxa=Math.abs(desvio)<0.06?velo:velo*(1-Math.max(-lim,Math.min(lim,desvio*0.6)));' +
  '      if(Math.abs(v.playbackRate-taxa)>0.004){ v.playbackRate=taxa; window.__ricepanelTaxa=(taxa!==velo)?1:0; }' +
  '    }catch(err){} }' +
  '  if(window.__ricepanelSincVigia) clearInterval(window.__ricepanelSincVigia);' +
  '  window.__ricepanelSincVigia=setInterval(sinc,400);' +
  '  poe();' +
    '  if(window.__ricepanelVigia) clearInterval(window.__ricepanelVigia);' +
    '  window.__ricepanelVigia=setInterval(poe,1500);' +
    '  return true;})()';
}

function monta(v) {
  elQuadro.textContent = '';
  velocidadeAplicada = null;
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
  // O YouTube troca de página por dentro (SPA, redirecionamento de live) sem
  // disparar did-finish-load, e o vigia injetado morria junto com o documento
  // velho: a parede ficou com a página inteira do YouTube, sem o CSS de "só o
  // vídeo", até ele desligar e ligar o player (27/09/2026). Agora confere de 5
  // em 5 s se o vigia está vivo, e reinjeta quando não está.
  wv.addEventListener('did-navigate-in-page', injeta);
  const confere = setInterval(() => {
    if (!wv.isConnected) { clearInterval(confere); return; }
    try {
      wv.executeJavaScript('!!window.__ricepanelVigia').then((vivo) => {
        if (!vivo) { window.pip.diag('video: vigia sumiu da página — reinjetando'); injeta(); }
      }).catch(() => {});
    } catch (e) {}
  }, 5000);
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

// Relógio do Chrome para o vigia de sincronia. Live vai marcada: lá a correção
// é só pela taxa, porque salto numa live do YouTube não pega direito.
let posicaoMandada = 0;
function aplicaPosicao(v) {
  const wv = elQuadro.querySelector('webview');
  if (!wv || !v.tocando || v.posicaoExata == null || !v.posicaoEm) return;
  if (v.posicaoEm === posicaoMandada) return;
  posicaoMandada = v.posicaoEm;
  const ref = { pos: Number(v.posicaoExata), em: Number(v.posicaoEm), velo: Number(v.velocidade) || 1, aoVivo: v.duracao == null };
  try { wv.executeJavaScript('window.__ricepanelPos=' + JSON.stringify(ref) + '; true;'); } catch (e) {}
}

function aplicaVolume(volume) {
  const wv = elQuadro.querySelector('webview');
  if (!wv || volume == null) return;
  if (volumeAplicado != null && Math.abs(volumeAplicado - volume) < 0.002) return;
  volumeAplicado = volume;
  try { wv.executeJavaScript('window.__ricepanelVol=' + Number(volume).toFixed(3) + '; true;'); } catch (e) {}
}

window.pip.onVideo((v) => {
  document.body.classList.toggle('placa', !v || v.modo !== 'flutuante');
  // Sem vídeo, o main só esconde a janela — escondida, a webview seguia
  // tocando, e o vigia ainda dava play a cada 1,5 s. Desmonta de verdade.
  if (!v || v.site !== 'youtube' || !v.id) {
    if (montado) {
      montado = '';
      elQuadro.textContent = '';
      window.pip.diag('video: fechado — player desmontado');
    }
    return;
  }
  elTitulo.textContent = v.titulo || 'Vídeo';
  pintaVelQual(v);
  const autoAgora = v.autoplay == null ? null : !!v.autoplay;
  if (autoAgora !== autoplay) { autoplay = autoAgora; pintaAuto(); }
  if (mudoPedido !== !!v.mudo) {
    mudoPedido = !!v.mudo;
    pintaMudo();
    aplicaMudo();
  }
  if (chromeNaFrente !== !!v.janelaVisivel) {
    chromeNaFrente = !!v.janelaVisivel;
    aplicaMudo();
  }
  if (v.volume != null && Date.now() - volumeMexidoEm > 1800 &&
      (volumeMostrado == null || Math.abs(volumeMostrado - v.volume) >= 0.002)) {
    volumeMostrado = v.volume;
    pintaVolume();
  }
  if (v.id !== montado) {
    montado = v.id;
    monta(v);
    return;
  }
  aplicaVolume(v.volume);
  aplicaPosicao(v);
});
