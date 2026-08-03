'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { BridgeConfigStore } = require('../lib/config-store');

test('config store creates and atomically persists bridge configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'accusim-router-config-'));
  try {
    const store = new BridgeConfigStore({ dataDirectory: root });
    const initial = store.read();
    assert.equal(initial.port, 4135);
    assert.equal(initial.schemaVersion, 2);
    assert.equal(initial.expertMode, false);
    assert.equal(fs.existsSync(path.join(root, 'bridge-config.json')), true);
    initial.host = '192.168.1.20';
    initial.channels.rpm_left.enabled = false;
    store.write(initial);
    const loaded = store.read();
    assert.equal(loaded.host, '192.168.1.20');
    assert.equal(loaded.channels.rpm_left.enabled, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('invalid files safely fall back to defaults', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'accusim-router-invalid-'));
  try {
    fs.writeFileSync(path.join(root, 'bridge-config.json'), '{broken', 'utf8');
    const config = new BridgeConfigStore({ dataDirectory: root }).read();
    assert.equal(config.name, 'A2A_PA24_250_Comanche_MSFS');
    assert.equal(config.channels['acc.2'].enabled, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
