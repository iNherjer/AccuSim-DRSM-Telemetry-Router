'use strict';

const { EventEmitter } = require('node:events');

function cleanVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').slice(0, 40);
}

class UpdateController extends EventEmitter {
  constructor({ autoUpdater, isPackaged, platform, getSkippedVersion, saveSkippedVersion, beforeInstall }) {
    super();
    this.autoUpdater = autoUpdater;
    this.supported = Boolean(autoUpdater && isPackaged && platform === 'win32');
    this.getSkippedVersion = typeof getSkippedVersion === 'function' ? getSkippedVersion : () => '';
    this.saveSkippedVersion = typeof saveSkippedVersion === 'function' ? saveSkippedVersion : () => {};
    this.beforeInstall = typeof beforeInstall === 'function' ? beforeInstall : () => {};
    this.manualCheck = false;
    this.state = {
      supported: this.supported,
      phase: this.supported ? 'idle' : 'development',
      version: '',
      percent: 0,
      message: this.supported
        ? 'Updateprüfung steht bereit.'
        : 'Updates sind im installierten Windows-Build aktiv.'
    };
    if (this.supported) this.attachUpdaterEvents();
  }

  publicState() {
    return { ...this.state };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.publicState());
  }

  attachUpdaterEvents() {
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = true;
    this.autoUpdater.on('checking-for-update', () => {
      this.setState({ phase: 'checking', percent: 0, message: 'Suche nach Updates …' });
    });
    this.autoUpdater.on('update-not-available', () => {
      this.manualCheck = false;
      this.setState({ phase: 'current', version: '', percent: 0, message: 'Die installierte Version ist aktuell.' });
    });
    this.autoUpdater.on('update-available', (info) => {
      const version = cleanVersion(info?.version);
      const skipped = cleanVersion(this.getSkippedVersion());
      if (!this.manualCheck && version && skipped === version) {
        this.manualCheck = false;
        this.setState({
          phase: 'skipped',
          version,
          percent: 0,
          message: `Version ${version} wurde übersprungen. Über das Tray kann erneut geprüft werden.`
        });
        return;
      }
      this.manualCheck = false;
      this.setState({ phase: 'available', version, percent: 0, message: `Version ${version} ist verfügbar.` });
    });
    this.autoUpdater.on('download-progress', (progress) => {
      const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
      this.setState({
        phase: 'downloading',
        percent,
        message: `Update wird geladen … ${Math.round(percent)} %`
      });
    });
    this.autoUpdater.on('update-downloaded', (info) => {
      this.setState({
        phase: 'ready',
        version: cleanVersion(info?.version || this.state.version),
        percent: 100,
        message: 'Update ist geladen und geprüft. Installation beim Neustart oder beim nächsten Beenden.'
      });
    });
    this.autoUpdater.on('error', (error) => {
      this.manualCheck = false;
      this.setState({
        phase: 'error',
        percent: 0,
        message: `Updateprüfung fehlgeschlagen: ${error?.message || error}`
      });
    });
  }

  async check({ manual = false } = {}) {
    if (!this.supported) return { ok: false, message: 'Updates sind in diesem Build nicht verfügbar.' };
    if (['checking', 'downloading', 'installing'].includes(this.state.phase)) {
      return { ok: false, message: 'Eine Update-Aktion läuft bereits.' };
    }
    this.manualCheck = manual === true;
    this.setState({ phase: 'checking', percent: 0, message: 'Suche nach Updates …' });
    try {
      await this.autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (error) {
      this.manualCheck = false;
      this.setState({ phase: 'error', percent: 0, message: `Updateprüfung fehlgeschlagen: ${error?.message || error}` });
      return { ok: false, message: error?.message || String(error) };
    }
  }

  async download() {
    if (!this.supported || this.state.phase !== 'available') {
      return { ok: false, message: 'Derzeit steht kein Update zum Download bereit.' };
    }
    this.setState({ phase: 'downloading', percent: 0, message: 'Update wird geladen …' });
    try {
      await this.autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      this.setState({ phase: 'error', percent: 0, message: `Update konnte nicht geladen werden: ${error?.message || error}` });
      return { ok: false, message: error?.message || String(error) };
    }
  }

  skip() {
    if (this.state.phase !== 'available' || !this.state.version) {
      return { ok: false, message: 'Derzeit steht kein Update zum Überspringen bereit.' };
    }
    this.saveSkippedVersion(this.state.version);
    this.setState({
      phase: 'skipped',
      percent: 0,
      message: `Version ${this.state.version} wird nicht mehr automatisch angeboten.`
    });
    return { ok: true, version: this.state.version };
  }

  install() {
    if (!this.supported || this.state.phase !== 'ready') {
      return { ok: false, message: 'Das Update ist noch nicht installationsbereit.' };
    }
    this.setState({ phase: 'installing', message: 'Bridge wird beendet und das Update installiert …' });
    this.beforeInstall();
    this.autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  }
}

module.exports = { UpdateController, cleanVersion };
