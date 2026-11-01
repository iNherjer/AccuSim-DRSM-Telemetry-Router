'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SignalFilters, normalizeFilter, MIXER_FILTERS } = require('../lib/signal-filter');
const { RouterCore, normalizeConfig, requiredSources } = require('../lib/router-core');
const { buildDefaultConfig } = require('../lib/catalog');

const close = (a, b, epsilon = 1e-10) => assert(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('zero means exact bypass and first sample preserves the resting 1 G load', () => {
  const filters = new SignalFilters();
  for (let i = 0; i < 100; i++) {
    const input = Math.sin(i * 0.8) * 4;
    assert.equal(filters.apply('test', input, i * 0.02, { smoothingMs: 0, ramp: 0 }), input);
  }
  assert.equal(filters.apply('rest', 1, 0, { smoothingMs: 1000, ramp: 0.01 }), 1);
  assert.equal(filters.apply('rest', 1, 0.02, { smoothingMs: 1000, ramp: 0.01 }), 1);
});

test('smoothing suppresses a brief spike but converges to sustained acceleration without washout', () => {
  const f = new SignalFilters();
  const config = { smoothingMs: 100, ramp: 0 };
  f.apply('heave', 1, 0, config);
  const peak = f.apply('heave', 2, 0.02, config);
  assert(peak > 1 && peak < 1.2);
  let value;
  for (let i = 2; i <= 100; i++) value = f.apply('heave', 1.5, i * 0.02, config);
  close(value, 1.5, 1e-8);
});

test('ramp bounds positive and negative changes with actual elapsed time', () => {
  const f = new SignalFilters();
  const config = { smoothingMs: 0, ramp: 2 };
  f.apply('heave', 1, 0, config);
  close(f.apply('heave', 3, 0.02, config), 1.04);
  close(f.apply('heave', -3, 0.05, config), 0.98);
  close(f.apply('heave', -3, 0.15, config), 0.78);
});

test('smoothing is time-based and the subsequent ramp still bounds every step', () => {
  function run(dt) {
    const f = new SignalFilters();
    f.apply('x', 0, 0, { smoothingMs: 200 });
    let result;
    for (let i = 1; i <= Math.round(1 / dt); i++) result = f.apply('x', 1, i * dt, { smoothingMs: 200 });
    return result;
  }
  close(run(0.01), run(0.02));
  const f = new SignalFilters();
  let last = f.apply('x', 0, 0, { smoothingMs: 50, ramp: 0.5 });
  for (let i = 1; i <= 100; i++) {
    const next = f.apply('x', i < 50 ? 5 : -5, i * 0.02, { smoothingMs: 50, ramp: 0.5 });
    assert(Math.abs(next - last) <= 0.010000000001);
    last = next;
  }
});

test('angle wrap takes the short route rather than sweeping through 180 degrees', () => {
  const f = new SignalFilters(), rad = Math.PI / 180;
  f.apply('yaw', 359 * rad, 0, { smoothingMs: 100 }, { period: 2 * Math.PI });
  const value = f.apply('yaw', 1 * rad, 0.02, { smoothingMs: 100 }, { period: 2 * Math.PI });
  assert(value > 359 * rad && value < 361 * rad);
});

test('gaps, changed sources and inactive branches cannot replay retained cues', () => {
  const f = new SignalFilters(), config = { smoothingMs: 500, ramp: 0.01 };
  f.begin(); f.apply('x', 2, 0, config, { context: 'a' }); f.end();
  assert.equal(f.apply('x', 1, 0.4, config, { context: 'a' }), 1);
  assert.equal(f.apply('x', 3, 0.42, config, { context: 'b' }), 3);
  f.begin(); f.end();
  assert.equal(f.apply('x', 0, 0.44, config, { context: 'b' }), 0);
});

test('enabling uses previous live value, disabling is immediate bypass', () => {
  const f = new SignalFilters();
  f.apply('x', 1, 0, {});
  close(f.apply('x', 3, 0.02, { ramp: 1 }), 1.02);
  assert.equal(f.apply('x', -2, 0.04, {}), -2);
  close(f.apply('x', -4, 0.06, { ramp: 1 }), -2.02);
});

test('filter settings persist, normalize invalid values, and default to bypass', () => {
  const config = buildDefaultConfig();
  config.channels['acc.2'].filter = { smoothingMs: 80, ramp: 2 };
  config.mixerFilters['turbulence.wind'] = { smoothingMs: 120, ramp: 0.5 };
  const normalized = normalizeConfig(JSON.parse(JSON.stringify(config)));
  assert.deepEqual(normalized.channels['acc.2'].filter, { smoothingMs: 80, ramp: 2 });
  assert.deepEqual(normalized.mixerFilters['turbulence.wind'], { smoothingMs: 120, ramp: 0.5 });
  assert.deepEqual(normalizeFilter({ smoothingMs: -10, ramp: Infinity }), { smoothingMs: 0, ramp: 0 });
  for (const { id } of MIXER_FILTERS) assert.deepEqual(normalizeConfig({}).mixerFilters[id], { smoothingMs: 0, ramp: 0 });
});

function heaveConfig() {
  const config = buildDefaultConfig();
  for (const channel of Object.values(config.channels)) channel.enabled = false;
  config.channels['acc.2'].enabled = true;
  return config;
}

test('heave channel shaping changes only the base; raw wind branch remains independent', () => {
  const config = heaveConfig();
  config.channels['acc.2'].filter = { smoothingMs: 0, ramp: 1 };
  config.turbulence.enabled = true;
  config.turbulence.sourceId = 'std.gforce';
  config.turbulence.gain = 1;
  config.turbulence.windEnabled = true;
  config.turbulence.windSourceId = 'std.wind.aircraft.y';
  config.turbulence.windMix = 1;
  config.turbulence.windGain = 1;
  config.mixerFilters['turbulence.wind'] = { smoothingMs: 0, ramp: 0.1 };
  const core = new RouterCore(config);
  core.update({ 'std.gforce': 1, 'std.wind.aircraft.y': 0 }, 0);
  const result = core.update({ 'std.gforce': 2, 'std.wind.aircraft.y': 10 }, 0.02);
  const shaped = result.diagnostics.signalFilters;
  close(shaped['channel.acc.2'].output, 1.02);
  close(shaped['turbulence.wind'].output, 0.002);
  assert(shaped['turbulence.wind'].input > 0.002);
  assert.equal(shaped['channel.acc.2'].input, 2);
  assert(result.packet.acc[2] > 1.02 && result.packet.acc[2] < 1.023);
});

test('filter-only config edits retain ramp history and disabled channels do not retain it', () => {
  const config = heaveConfig();
  const core = new RouterCore(config);
  core.update({ 'std.gforce': 1 }, 0);
  config.channels['acc.2'].filter.ramp = 1;
  core.setConfig(config);
  close(core.update({ 'std.gforce': 2 }, 0.02).packet.acc[2], 1.02);
  config.channels['acc.2'].enabled = false;
  core.setConfig(config); core.update({ 'std.gforce': 2 }, 0.04);
  config.channels['acc.2'].enabled = true;
  core.setConfig(config);
  close(core.update({ 'std.gforce': 1 }, 0.06).packet.acc[2], 1);
});

test('every mixer branch has its own effective ramp before summation or distribution', () => {
  const config = buildDefaultConfig();
  config.groundForces.enabled = true;
  config.groundForces.accelerationCompensationEnabled = false;
  config.attitudeMix.enabled = true;
  config.shakeMixer.enabled = true;
  config.turbulence.enabled = true;
  config.turbulence.windEnabled = true;
  config.turbulence.lateralWindEnabled = true;
  for (const { id } of MIXER_FILTERS) config.mixerFilters[id] = { smoothingMs: 25, ramp: 0.05 };
  const core = new RouterCore(config), changed = new Set(), previous = new Map();
  for (let frame = 0; frame < 150; frame++) {
    const t = frame * 0.02;
    const sources = Object.fromEntries(requiredSources(config).map((source, index) => [
      source.id, source.virtualValue ?? Math.sin(t * ((index % 6) + 1)) * 2
    ]));
    sources['std.on_ground'] = 1;
    sources['std.gforce'] = 1 + Math.sin(t * 3) * 0.4;
    const result = core.update(sources, t);
    for (const { id } of MIXER_FILTERS) {
      const diagnostics = result.diagnostics.signalFilters[id];
      assert(diagnostics, `missing mixer filter: ${id}`);
      if (previous.has(id)) assert(Math.abs(diagnostics.output - previous.get(id)) <= 0.001000000001, id);
      if (Math.abs(diagnostics.output - diagnostics.input) > 1e-6) changed.add(id);
      previous.set(id, diagnostics.output);
    }
  }
  assert.deepEqual([...changed].sort(), MIXER_FILTERS.map(({ id }) => id).sort());
});
