'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConfig, RouterCore, requiredSources } = require('../lib/router-core');
const { BUILTIN_SOURCES, OUTPUTS, SAFE_SOURCE_IDS, buildDefaultConfig } = require('../lib/catalog');

function ballConfig(patch = {}) {
  const config = buildDefaultConfig();
  for (const channel of Object.values(config.channels)) channel.enabled = false;
  config.channels['acc.0'] = {
    enabled: true, sourceId: 'a2a.ball', inputUnit: 'ball', operation: 'ball_cue',
    scale: 1, offset: 0, invert: false, ...patch
  };
  return config;
}

test('ball catalog exposes exact LVar only as a calibrated lateral alternative', () => {
  const source = BUILTIN_SOURCES.find((entry) => entry.id === 'a2a.ball');
  assert.equal(source.simVar, 'L:InclinometerBall');
  assert.equal(source.simConnectUnit, 'number');
  assert(OUTPUTS.find((entry) => entry.id === 'acc.0').simpleSources.some((s) => s.sourceId === source.id));
  assert.deepEqual(Object.keys(SAFE_SOURCE_IDS).filter((id) => SAFE_SOURCE_IDS[id].includes(source.id)), ['acc.0']);
  assert(requiredSources(ballConfig()).some((entry) => entry.id === 'a2a.ball'));
  assert.equal(buildDefaultConfig().channels['acc.0'].sourceId, 'a2a.acc.x');
});

test('ball center and signed full scale produce calibrated G, not raw G', () => {
  const core = new RouterCore(ballConfig());
  for (const [raw, expected] of [[0, 0], [-1, -0.1], [1, 0.1], [0.5, 0.05], [50, 0.1]]) {
    const result = core.update({ 'a2a.ball': raw }, 0);
    assert.equal(result.packet.acc[0], expected);
    assert.equal(result.errors['acc.0'], undefined);
  }
});

test('ball calibration, inversion and post-gain limit persist and apply', () => {
  const config = ballConfig({ invert: true, scale: 2 });
  config.ballCue = { center: 0.1, gainG: 0.2, limitG: 0.15 };
  const normalized = normalizeConfig(config);
  assert.deepEqual(normalized.ballCue, config.ballCue);
  const core = new RouterCore(normalized);
  assert.equal(core.update({ 'a2a.ball': 0.1 }, 0).packet.acc[0], 0);
  assert.equal(core.update({ 'a2a.ball': 1 }, 1).packet.acc[0], -0.15);
  assert.equal(core.update({ 'a2a.ball': -1 }, 2).packet.acc[0], 0.15);
});

test('missing ball reports a channel error rather than a fabricated live measurement', () => {
  const result = new RouterCore(ballConfig()).update({}, 0);
  assert(result.errors['acc.0']);
  assert.equal(result.outputValues['acc.0'], undefined);
});

test('ball motion cue cannot be treated as direct G or routed to pitch/heave', () => {
  const direct = ballConfig({ operation: 'direct' });
  assert(new RouterCore(direct).update({ 'a2a.ball': 1 }, 0).errors['acc.0']);
  for (const id of ['acc.2', 'pitch']) {
    const config = ballConfig();
    config.unsafeMode = true;
    config.channels[id] = { ...config.channels['acc.0'] };
    assert(new RouterCore(config).update({ 'a2a.ball': 1 }, 0).errors[id]);
  }
});
