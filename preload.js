'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('accusimRouter', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  start: () => ipcRenderer.invoke('router:start'),
  stop: () => ipcRenderer.invoke('router:stop'),
  startRecording: () => ipcRenderer.invoke('recording:start'),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  skipUpdate: () => ipcRenderer.invoke('update:skip'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  openDataFolder: () => ipcRenderer.invoke('system:open-data-folder'),
  onStateChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  }
});
