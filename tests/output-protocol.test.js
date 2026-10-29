'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeOutput } = require('../lib/output-protocol');
const { normalizeConfig } = require('../lib/router-core');

test('FlyPT 3.5.3 matches all 25 positions of its bundled DCS Lua exporter', () => {
  const packet = {
    acc: [2, 1, 3], vel: [5, 4, 6], ang_vel: [9, 8, 7],
    yaw: -10, roll: 11, pitch: 12, tas: 13,
    gear_nose: 14, gear_left: 16, gear_right: 17,
    alt_agl: 18, flaps: 19, gear: 20, speedbrakes: 21,
    canopy: 22, stall: 23, aoa: 24, t: 25, rpm_left: 2700
  };
  const text = encodeOutput(packet, 'flypt353').toString();
  const expected = Array.from({ length: 25 }, (_, i) => i >= 13 && i <= 16 ? 0 : i + 1);
  assert.deepEqual(text.split(' ').map(Number), expected);
  assert.equal(text.split(' ').length, 25);
  assert(!text.includes('2700'));
  assert.deepEqual(JSON.parse(encodeOutput(packet).toString()), packet);
});

test('FlyPT disabled and invalid fields retain fixed positions and finite values', () => {
  const values = encodeOutput({ acc: [NaN, undefined, 1], pitch: Infinity }, 'flypt353')
    .toString().split(' ').map(Number);
  assert.equal(values.length, 25);
  assert(values.every(Number.isFinite));
  assert.equal(values[2], 1);
  assert.equal(values[11], 0);
});

test('output protocol persists and legacy configurations keep DRSM', () => {
  assert.equal(normalizeConfig({}).outputProtocol, 'drsm');
  assert.equal(normalizeConfig({ outputProtocol: 'flypt353', port: 4124 }).outputProtocol, 'flypt353');
  assert.equal(normalizeConfig({ outputProtocol: 'unknown' }).outputProtocol, 'drsm');
});

test('runtime sends selected encoding and can switch back to DRSM without restarting', () => {
  const { TelemetryRuntime } = require('../lib/telemetry-runtime');
  const runtime = new TelemetryRuntime({ outputProtocol: 'flypt353', port: 4124 });
  runtime.startedAtNs = process.hrtime.bigint();
  const sent = [];
  runtime.udp = { send: (data, port, host) => sent.push({ text: data.toString(), port, host }) };
  runtime.processSample({});
  assert.equal(sent[0].port, 4124);
  assert.equal(sent[0].host, '127.0.0.1');
  assert.equal(sent[0].text.split(' ').length, 25);
  assert.equal(runtime.state.packetPreview, sent[0].text);
  runtime.updateConfig({ outputProtocol: 'drsm', port: 4135 });
  runtime.processSample({});
  assert.equal(sent[1].port, 4135);
  assert.equal(JSON.parse(sent[1].text).v, 2);
});
