const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  version: () => ipcRenderer.invoke('app:version'),
  listGames: () => ipcRenderer.invoke('games:list'),
  install: (game) => ipcRenderer.invoke('games:install', game),
  launch: (id) => ipcRenderer.invoke('games:launch', id),
  uninstall: (id) => ipcRenderer.invoke('games:uninstall', id),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  onProgress: (cb) => ipcRenderer.on('game:progress', (_e, data) => cb(data)),
  onRunning: (cb) => ipcRenderer.on('game:running', (_e, data) => cb(data)),
  listNews: () => ipcRenderer.invoke('news:list'),

  authStart: () => ipcRenderer.invoke('auth:start'),
  authPoll: (data) => ipcRenderer.invoke('auth:poll', data),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authLogout: () => ipcRenderer.invoke('auth:logout'),

  filesList: () => ipcRenderer.invoke('files:list'),
  fileDownload: (data) => ipcRenderer.invoke('files:download', data),

  dlcList: (gameId) => ipcRenderer.invoke('dlc:list', gameId),
  dlcBuy: (data) => ipcRenderer.invoke('dlc:buy', data),
  dlcInstall: (data) => ipcRenderer.invoke('dlc:install', data),
});
