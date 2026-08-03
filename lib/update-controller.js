'use strict';

const { EventEmitter } = require('node:events');
const { translate } = require('./i18n');

function cleanVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').slice(0, 40);
}

class UpdateController extends EventEmitter {
  constructor({ autoUpdater, isPackaged, platform, getSkippedVersion, saveSkippedVersion, beforeInstall, getLanguage }) {
    super();
    this.autoUpdater = autoUpdater;
    this.supported = Boolean(autoUpdater && isPackaged && platform === 'win32');
    this.getSkippedVersion = typeof getSkippedVersion === 'function' ? getSkippedVersion : () => '';
    this.saveSkippedVersion = typeof saveSkippedVersion === 'function' ? saveSkippedVersion : () => {};
    this.beforeInstall = typeof beforeInstall === 'function' ? beforeInstall : () => {};
    this.getLanguage = typeof getLanguage === 'function' ? getLanguage : () => 'de';
    this.manualCheck = false;
    this.state = {
      supported: this.supported,
      phase: this.supported ? 'idle' : 'development',
      version: '',
      percent: 0,
      messageKey: this.supported ? 'updater.ready' : 'updater.installedOnly',
      messageArgs: {}
    };
    if (this.supported) this.attachUpdaterEvents();
  }

  publicState() {
    return {
      ...this.state,
      message: translate(this.getLanguage(), this.state.messageKey, this.state.messageArgs)
    };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.publicState());
  }

  messagePatch(messageKey, messageArgs = {}) {
    return { messageKey, messageArgs };
  }

  attachUpdaterEvents() {
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = true;
    this.autoUpdater.on('checking-for-update', () => {
      this.setState({ phase: 'checking', percent: 0, ...this.messagePatch('updater.checking') });
    });
    this.autoUpdater.on('update-not-available', () => {
      this.manualCheck = false;
      this.setState({ phase: 'current', version: '', percent: 0, ...this.messagePatch('updater.current') });
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
          ...this.messagePatch('updater.skipped', { version })
        });
        return;
      }
      this.manualCheck = false;
      this.setState({ phase: 'available', version, percent: 0, ...this.messagePatch('updater.available', { version }) });
    });
    this.autoUpdater.on('download-progress', (progress) => {
      const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
      this.setState({
        phase: 'downloading',
        percent,
        ...this.messagePatch('updater.downloading', { percent: Math.round(percent) })
      });
    });
    this.autoUpdater.on('update-downloaded', (info) => {
      this.setState({
        phase: 'ready',
        version: cleanVersion(info?.version || this.state.version),
        percent: 100,
        ...this.messagePatch('updater.downloaded')
      });
    });
    this.autoUpdater.on('error', (error) => {
      this.manualCheck = false;
      this.setState({
        phase: 'error',
        percent: 0,
        ...this.messagePatch('updater.checkFailed', { error: error?.message || error })
      });
    });
  }

  async check({ manual = false } = {}) {
    if (!this.supported) return { ok: false, message: translate(this.getLanguage(), 'updater.unavailableBuild') };
    if (['checking', 'downloading', 'installing'].includes(this.state.phase)) {
      return { ok: false, message: translate(this.getLanguage(), 'updater.busy') };
    }
    this.manualCheck = manual === true;
    this.setState({ phase: 'checking', percent: 0, ...this.messagePatch('updater.checking') });
    try {
      await this.autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (error) {
      this.manualCheck = false;
      this.setState({ phase: 'error', percent: 0, ...this.messagePatch('updater.checkFailed', { error: error?.message || error }) });
      return { ok: false, message: error?.message || String(error) };
    }
  }

  async download() {
    if (!this.supported || this.state.phase !== 'available') {
      return { ok: false, message: translate(this.getLanguage(), 'updater.noDownload') };
    }
    this.setState({ phase: 'downloading', percent: 0, ...this.messagePatch('updater.downloading', { percent: 0 }) });
    try {
      await this.autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      this.setState({ phase: 'error', percent: 0, ...this.messagePatch('updater.downloadFailed', { error: error?.message || error }) });
      return { ok: false, message: error?.message || String(error) };
    }
  }

  skip() {
    if (this.state.phase !== 'available' || !this.state.version) {
      return { ok: false, message: translate(this.getLanguage(), 'updater.noSkip') };
    }
    this.saveSkippedVersion(this.state.version);
    this.setState({
      phase: 'skipped',
      percent: 0,
      ...this.messagePatch('updater.skipSaved', { version: this.state.version })
    });
    return { ok: true, version: this.state.version };
  }

  install() {
    if (!this.supported || this.state.phase !== 'ready') {
      return { ok: false, message: translate(this.getLanguage(), 'updater.notReady') };
    }
    this.setState({ phase: 'installing', ...this.messagePatch('updater.installing') });
    this.beforeInstall();
    this.autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  }
}

module.exports = { UpdateController, cleanVersion };
