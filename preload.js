const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // cota do Claude Code
  getUsage: () => ipcRenderer.invoke('get-usage'),
  getAuth: () => ipcRenderer.invoke('get-auth'),
  setAuth: (opts) => ipcRenderer.invoke('set-auth', opts),

  // máquina
  getSistema: () => ipcRenderer.invoke('get-sistema'),
  getTemps: () => ipcRenderer.invoke('get-temps'),
  onSistema: (cb) => ipcRenderer.on('sistema-update', (e, d) => cb(d)),
  onPacotes: (cb) => ipcRenderer.on('pacotes-update', (e, d) => cb(d)),

  // vidro: fundo desfocado das placas do Mirante
  vidroGet: () => ipcRenderer.invoke('vidro-get'),
  onVidro: (cb) => ipcRenderer.on('vidro-update', (e, d) => cb(d)),

  // agenda (Google Calendar por iCal)
  musicaComando: (verbo, player) => ipcRenderer.invoke('musica-comando', verbo, player),

  servLocalSobe: (indice) => ipcRenderer.invoke('serv-local-sobe', indice),
  servLocalMata: () => ipcRenderer.invoke('serv-local-mata'),
  escolheArquivo: (tipo) => ipcRenderer.invoke('escolhe-arquivo', tipo),
  servLocalLog: () => ipcRenderer.invoke('serv-local-log'),
  pipEstado: (estado) => ipcRenderer.send('pip-estado', estado),

  videoGet: () => ipcRenderer.invoke('video-get'),
  videoLiga: (valor) => ipcRenderer.invoke('video-liga', valor),
  videoEntra: () => ipcRenderer.invoke('video-entra'),
  videoPausaNavegador: () => ipcRenderer.invoke('video-pausa-navegador'),
  videoTocaNavegador: () => ipcRenderer.invoke('video-toca-navegador'),
  videoMudo: (valor) => ipcRenderer.invoke('video-mudo', valor),
  videoFecha: () => ipcRenderer.invoke('video-fecha'),
  videoProximo: () => ipcRenderer.invoke('video-proximo'),
  videoAnterior: () => ipcRenderer.invoke('video-anterior'),
  videoAutoplay: (valor) => ipcRenderer.invoke('video-autoplay', valor),
  videoVelocidade: (valor) => ipcRenderer.invoke('video-velocidade', valor),
  videoQualidade: (valor) => ipcRenderer.invoke('video-qualidade', valor),
  // Volume do player do YouTube na aba do Chrome, em passos (delta -100 a 100).
  videoVolume: (delta) => ipcRenderer.invoke('video-volume', delta),
  onVideo: (cb) => ipcRenderer.on('video-update', (e, d) => cb(d)),

  flamengoGet: () => ipcRenderer.invoke('flamengo-get'),
  flamengoRefresh: () => ipcRenderer.invoke('flamengo-refresh'),
  onFlamengo: (cb) => ipcRenderer.on('flamengo-update', (e, d) => cb(d)),

  agendaGet: () => ipcRenderer.invoke('agenda-get'),
  agendaRefresh: () => ipcRenderer.invoke('agenda-refresh'),
  agendaUrlPista: () => ipcRenderer.invoke('agenda-url-pista'),
  agendaUrlSet: (url) => ipcRenderer.invoke('agenda-url-set', url),
  // Google Tarefas: concluir pela agenda do Mirante.
  tarefaConcluir: (lista, id) => ipcRenderer.invoke('tarefa-concluir', lista, id),
  onAgenda: (cb) => ipcRenderer.on('agenda-update', (e, d) => cb(d)),
  // Jogadores online de cada servidor, pelo dynamic.json (main.js).
  jogadoresGet: () => ipcRenderer.invoke('jogadores-get'),
  onJogadores: (cb) => ipcRenderer.on('jogadores-update', (e, d) => cb(d)),

  // modo Dev: emulador e bundler
  devProjetos: () => ipcRenderer.invoke('dev-projetos'),
  devAvds: () => ipcRenderer.invoke('dev-avds'),
  devEstado: () => ipcRenderer.invoke('dev-estado'),
  devSubir: (pasta, avd, alvo) => ipcRenderer.invoke('dev-subir', pasta, avd, alvo),
  devMatar: (pasta) => ipcRenderer.invoke('dev-matar', pasta),
  devMostrar: (v) => ipcRenderer.invoke('dev-mostrar', v),
  devEncaixar: (caixa) => ipcRenderer.invoke('dev-encaixar', caixa),
  onDevLog: (cb) => ipcRenderer.on('dev-log', (e, linha) => cb(linha)),

  // manutenção e ações da máquina
  runMaintenance: () => ipcRenderer.invoke('run-maintenance'),
  getMaintenance: () => ipcRenderer.invoke('get-maintenance'),
  tecladoTravar: (seg) => ipcRenderer.invoke('teclado-travar', seg),
  tecladoSoltar: () => ipcRenderer.invoke('teclado-soltar'),
  tecladoEstado: () => ipcRenderer.invoke('teclado-estado'),
  telasDormir: () => ipcRenderer.invoke('telas-dormir'),
  painelReiniciar: () => ipcRenderer.invoke('painel-reiniciar'),
  closeApp: () => ipcRenderer.send('close-app'),

  // Sentry
  sentryGet: () => ipcRenderer.invoke('sentry-get'),
  sentryRefresh: () => ipcRenderer.invoke('sentry-refresh'),
  sentrySeen: () => ipcRenderer.invoke('sentry-seen'),
  sentryResolve: (id, status) => ipcRenderer.invoke('sentry-resolve', id, status),
  sentryOpen: (url) => ipcRenderer.send('sentry-open', url),
  sentryDetalhe: (id) => ipcRenderer.invoke('sentry-detalhe', id),
  // O main empurra a lista a cada varredura; nao precisa o renderer ficar pedindo.
  onSentry: (cb) => ipcRenderer.on('sentry-update', (e, payload) => cb(payload)),


  // servidores (txAdmin)
  txCred: () => ipcRenderer.invoke('tx-cred'),
  txPing: (host, porta) => ipcRenderer.invoke('tx-ping', host, porta),
  telaEstado: (i, r) => ipcRenderer.send('tela-estado', i, r),
  servGet: () => ipcRenderer.invoke('serv-get'),
  servCatalogo: () => ipcRenderer.invoke('serv-catalogo'),
  servCatalogoSet: (cat) => ipcRenderer.invoke('serv-catalogo-set', cat),
  servAtiva: (grupo, indice) => ipcRenderer.invoke('serv-ativa', grupo, indice),
  alertaConsole: (dados) => ipcRenderer.send('alerta-console', dados),
  fonteLog: () => ipcRenderer.invoke('fonte-log'),

  onModoExterno: (cb) => ipcRenderer.on('modo-externo', (e, m) => cb(m)),

  abrirUrl: (url) => ipcRenderer.send('abrir-url', url),
  diag: (texto) => ipcRenderer.send('diag', texto)
});
