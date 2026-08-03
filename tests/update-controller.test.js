'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { UpdateController, cleanVersion } = require('../lib/update-controller');

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.availableVersion = '1.3.1';
    this.downloadCount = 0;
    this.installCount = 0;
  }

  checkForUpdates() {
    queueMicrotask(() => this.emit('update-available', { version: this.availableVersion }));
    return Promise.resolve();
  }

  downloadUpdate() {
    this.downloadCount += 1;
    queueMicrotask(() => {
      this.emit('download-progress', { percent: 42.4 });
      this.emit('update-downloaded', { version: this.availableVersion });
    });
    return Promise.resolve();
  }

  quitAndInstall() {
    this.installCount += 1;
  }
}

test('version labels are normalized for persistent skipping', () => {
  assert.equal(cleanVersion('v1.3.1'), '1.3.1');
  assert.equal(cleanVersion(' 1.4.0 '), '1.4.0');
});

test('startup check offers an available update and can persistently skip it', async () => {
  const updater = new FakeUpdater();
  let skippedVersion = '';
  const controller = new UpdateController({
    autoUpdater: updater,
    isPackaged: true,
    platform: 'win32',
    getSkippedVersion: () => skippedVersion,
    saveSkippedVersion: (version) => { skippedVersion = version; }
  });

  await controller.check();
  await nextTurn();
  assert.equal(controller.publicState().phase, 'available');
  assert.deepEqual(controller.skip(), { ok: true, version: '1.3.1' });
  assert.equal(skippedVersion, '1.3.1');

  await controller.check();
  await nextTurn();
  assert.equal(controller.publicState().phase, 'skipped');

  await controller.check({ manual: true });
  await nextTurn();
  assert.equal(controller.publicState().phase, 'available');
});

test('chosen update downloads, reports progress and installs only on command', async () => {
  const updater = new FakeUpdater();
  let preparedForInstall = false;
  const controller = new UpdateController({
    autoUpdater: updater,
    isPackaged: true,
    platform: 'win32',
    getSkippedVersion: () => '',
    saveSkippedVersion: () => {},
    beforeInstall: () => { preparedForInstall = true; }
  });

  await controller.check();
  await nextTurn();
  assert.deepEqual(await controller.download(), { ok: true });
  await nextTurn();
  assert.equal(updater.downloadCount, 1);
  assert.equal(controller.publicState().phase, 'ready');
  assert.equal(controller.publicState().percent, 100);
  assert.equal(updater.installCount, 0);

  assert.deepEqual(controller.install(), { ok: true });
  assert.equal(preparedForInstall, true);
  assert.equal(updater.installCount, 1);
});

test('development builds do not contact the updater', async () => {
  const updater = new FakeUpdater();
  const controller = new UpdateController({
    autoUpdater: updater,
    isPackaged: false,
    platform: 'win32'
  });
  assert.equal(controller.publicState().phase, 'development');
  assert.equal((await controller.check()).ok, false);
});
