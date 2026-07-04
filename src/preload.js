const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  version: () => ipcRenderer.invoke('app:version'),
  listGames: () => ipcRenderer.invoke('games:list'),
  install: (game) => ipcRenderer.invoke('games:install', game),
  launch: (id) => ipcRenderer.invoke('games:launch', id),
  uninstall: (id) => ipcRenderer.invoke('games:uninstall', id),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  onProgress: (cb) => ipcRenderer.on('game:progress', (_e, data) => cb(data)),
});
