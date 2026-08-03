'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray
} = require('electron');
const { BridgeConfigStore } = require('./lib/config-store');
const {
  BUILTIN_SOURCES,
  OPERATION_COMPATIBILITY,
  OPERATIONS,
  OUTPUTS,
  SAFE_OPERATION_COMPATIBILITY,
  SAFE_SOURCE_IDS,
  UNIT_DEFINITIONS
} = require('./lib/catalog');
const { allSources } = require('./lib/router-core');
const { TelemetryRuntime } = require('./lib/telemetry-runtime');
const { shouldBroadcastToWindow } = require('./lib/window-visibility');

const singleInstanceLock = app.requestSingleInstanceLock();

let mainWindow = null;
let tray = null;
let store = null;
let config = null;
let runtime = null;
let configRevision = 1;

function iconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'icon.png')
    : path.resolve(__dirname, '..', '..', 'icon-192.png');
}

function publicCatalog() {
  return {
    builtinSources: BUILTIN_SOURCES,
    sources: allSources(config),
    outputs: OUTPUTS,
    units: UNIT_DEFINITIONS,
    operations: OPERATIONS,
    operationCompatibility: OPERATION_COMPATIBILITY,
    safeOperationCompatibility: SAFE_OPERATION_COMPATIBILITY,
    safeSourceIds: SAFE_SOURCE_IDS
  };
}

function currentState() {
  return {
    appVersion: app.getVersion(),
    configRevision,
    config,
    catalog: publicCatalog(),
    runtime: runtime?.publicState() || null,
    dataDirectory: store?.dataDirectory || ''
  };
}

function broadcastState(force = false) {
  if (!shouldBroadcastToWindow(mainWindow, force)) return;
  mainWindow.webContents.send('state:changed', currentState());
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  broadcastState(true);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#07111d',
    icon: iconPath(),
    title: 'AccuSim DRSM Telemetry Router',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.once('did-finish-load', () => {
    const capturePath = String(process.env.ACCUSIM_ROUTER_CAPTURE_PATH || '').trim();
    if (!capturePath) return;
    setTimeout(async () => {
      try {
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(capturePath, image.toPNG());
      } finally {
        app.isQuitting = true;
        app.quit();
      }
    }, 800);
  });
  mainWindow.on('close', (event) => {
    if (app.isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('restore', () => broadcastState(true));
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath()).resize({ width: 20, height: 20 });
  tray = new Tray(image);
  tray.setToolTip('AccuSim DRSM Telemetry Router');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Router anzeigen', click: showWindow },
    { type: 'separator' },
    { label: 'Bridge starten', click: () => runtime.start() },
    { label: 'Bridge stoppen', click: () => runtime.stop() },
    { type: 'separator' },
    {
      label: 'Beenden',
      click: () => {
        app.isQuitting = true;
        runtime.stop();
        app.quit();
      }
    }
  ]));
  tray.on('double-click', showWindow);
}

function registerIpc() {
  ipcMain.handle('app:get-state', () => currentState());
  ipcMain.handle('router:start', () => runtime.start());
  ipcMain.handle('router:stop', () => runtime.stop());
  ipcMain.handle('config:save', (_event, nextConfig) => {
    config = store.write(nextConfig);
    configRevision += 1;
    runtime.updateConfig(config);
    broadcastState();
    return { ok: true, config, configRevision };
  });
  ipcMain.handle('config:reset', () => {
    config = store.reset();
    configRevision += 1;
    runtime.updateConfig(config);
    broadcastState();
    return { ok: true, config, configRevision };
  });
  ipcMain.handle('system:open-data-folder', async () => {
    const error = await shell.openPath(store.dataDirectory);
    return { ok: !error, message: error || '' };
  });
}

async function startApplication() {
  const documentsDirectory = String(process.env.ACCUSIM_ROUTER_DOCUMENTS_DIR || '').trim() || app.getPath('documents');
  const dataDirectory = path.join(documentsDirectory, 'VFR Multitool', 'AccuSim DRSM Router');
  store = new BridgeConfigStore({ dataDirectory });
  config = store.read();
  runtime = new TelemetryRuntime(config);
  runtime.on('state', () => broadcastState());
  registerIpc();
  createWindow();
  createTray();
  broadcastState();
}

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(startApplication);
  app.on('activate', showWindow);
  app.on('before-quit', () => {
    app.isQuitting = true;
    runtime?.stop();
  });
  app.on('window-all-closed', () => {
    // Windows-Tray-Anwendung: im Hintergrund weiterlaufen.
  });
}
