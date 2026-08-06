'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  BridgeControlServer,
  CONTROL_PROTOCOL_VERSION,
  bridgeControlPath,
  compactRuntimeState
} = require('../lib/control-channel');

test('control path is stable on Windows and user-scoped during development', () => {
  assert.equal(bridgeControlPath({ platform: 'win32' }), '\\\\.\\pipe\\vfr-multitool-accusim-drsm-router-v1');
  assert.equal(
    bridgeControlPath({ platform: 'darwin', temporaryDirectory: '/tmp/example', uid: 501 }),
    path.join('/tmp/example', 'vfr-multitool-accusim-drsm-router-501-v1.sock')
  );
  assert.equal(CONTROL_PROTOCOL_VERSION, 1);
});

test('control server handles status and rejects unknown commands', async () => {
  const server = new BridgeControlServer({
    handlers: { status: () => ({ protocolVersion: CONTROL_PROTOCOL_VERSION, appVersion: '1.12.0' }) }
  });
  const responses = [];
  const socket = { write: (value) => responses.push(JSON.parse(String(value).trim())) };
  await server.handleLine(socket, JSON.stringify({ id: 'test-1', command: 'status' }));
  assert.deepEqual(responses.shift(), {
    id: 'test-1',
    ok: true,
    result: { protocolVersion: 1, appVersion: '1.12.0' }
  });
  await server.handleLine(socket, JSON.stringify({ id: 'test-2', command: 'unknown' }));
  const unknown = responses.shift();
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /Unbekanntes Steuerkommando/);
});

test('runtime status is compact and excludes raw telemetry values', () => {
  const compact = compactRuntimeState({
    process: 'running', simulator: 'connected', udp: 'active', sampleHz: 59.8,
    samples: 200, packets: 199, sourceValues: { secret: 42 }, outputValues: { acc: [1, 2, 3] },
    recording: { active: true, rows: 120 }
  });
  assert.equal(compact.process, 'running');
  assert.equal(compact.recording.active, true);
  assert.equal(compact.sourceValues, undefined);
  assert.equal(compact.outputValues, undefined);
});
