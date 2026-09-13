// Ponte da janela do player (pip.html) com o processo principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pip', {
  // Estado do vídeo e o modo da janela ('placa' no Mirante, 'flutuante' fora dele).
  onVideo: (cb) => ipcRenderer.on('pip-video', (e, d) => cb(d)),
  // Põe os cookies da conta dele na partição da webview antes de carregar.
  entra: () => ipcRenderer.invoke('video-entra'),
  diag: (texto) => ipcRenderer.send('diag', texto)
});
