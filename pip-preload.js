// Ponte da janela do player (pip.html) com o processo principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pip', {
  // Estado do vídeo e o modo da janela ('placa' no Mirante, 'flutuante' fora dele).
  onVideo: (cb) => ipcRenderer.on('pip-video', (e, d) => cb(d)),
  // Põe os cookies da conta dele na partição da webview antes de carregar.
  entra: () => ipcRenderer.invoke('video-entra'),
  // Botões da barra: mudo (sem valor alterna) e fechar o vídeo.
  mudo: (valor) => ipcRenderer.invoke('video-mudo', valor),
  fecha: () => ipcRenderer.invoke('video-fecha'),
  proximo: () => ipcRenderer.invoke('video-proximo'),
  anterior: () => ipcRenderer.invoke('video-anterior'),
  autoplay: (valor) => ipcRenderer.invoke('video-autoplay', valor),
  velocidade: (valor) => ipcRenderer.invoke('video-velocidade', valor),
  // Volume do player do YouTube na aba do Chrome, em passos (delta de -100 a 100).
  volume: (delta) => ipcRenderer.invoke('video-volume', delta),
  qualidade: (valor) => ipcRenderer.invoke('video-qualidade', valor),
  diag: (texto) => ipcRenderer.send('diag', texto)
});
