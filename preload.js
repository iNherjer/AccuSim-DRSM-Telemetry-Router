'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('accusimRouter', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  start: () => ipcRenderer.invoke('router:start'),
  stop: () => ipcRenderer.invoke('router:stop'),
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
