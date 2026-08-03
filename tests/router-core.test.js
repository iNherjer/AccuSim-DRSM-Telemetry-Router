'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BUILTIN_SOURCES,
  OUTPUTS,
  SAFE_SOURCE_IDS,
  TURBULENCE_PRESETS,
  TURBULENCE_SOURCE_IDS,
  UNIT_DEFINITIONS,
  buildDefaultConfig,
  compatibleOperationIds,
  safeCompatibleOperationIds
} = require('../lib/catalog');
const { RouterCore, gravityVector, normalizeConfig, operationCompatible, requiredSources } = require('../lib/router-core');

function close(actual, expected, epsilon = 1e-9) {
  assert(Math.abs(actual - expected) <= epsilon, `expected ${expected}, got ${actual}`);
}

test('turbulence presets increase monotonically from light to extreme', () => {
  assert.deepEqual(TURBULENCE_PRESETS.map((preset) => preset.id), [
    'light', 'medium', 'strong', 'extreme'
  ]);
  const defaults = buildDefaultConfig().turbulence;
  const medium = TURBULENCE_PRESETS.find((preset) => preset.id === 'medium');
  for (const key of ['mix', 'gain', 'lowCutHz', 'highCutHz', 'maxExtraG']) {
    assert.equal(medium[key], defaults[key]);
  }
  for (let index = 1; index < TURBULENCE_PRESETS.length; index += 1) {
    const previous = TURBULENCE_PRESETS[index - 1];
    const current = TURBULENCE_PRESETS[index];
    assert(current.mix > previous.mix);
    assert(current.gain > previous.gain);
    assert(current.maxExtraG > previous.maxExtraG);
    assert(current.lowCutHz < previous.lowCutHz);
    assert(current.highCutHz > previous.highCutHz);
  }
});

test('default mapping emits the validated essential Comanche channels', () => {
  const core = new RouterCore(buildDefaultConfig());
  const result = core.update({
    'a2a.acc.x': 9.80665,
    'a2a.acc.y': 19.6133,
    'a2a.acc.z': 29.41995,
    'std.angular.body.x': 1,
    'std.angular.body.y': 2,
    'std.angular.body.z': 3,
    'std.velocity.world.x': 10,
    'std.velocity.world.y': 20,
    'std.velocity.world.z': 30,
    'std.pitch': 10,
    'std.bank': 20,
    'std.heading': 90,
    'std.alt.agl': 1000,
    'std.alt.msl': 2000,
    'std.airspeed.tas': 100,
    'std.airspeed.ias': 90,
    'std.aoa': 5,
    'std.aos': 0.1,
    'std.mach': 0.2,
    'std.wind.x': 1,
    'std.wind.y': 2,
    'std.wind.z': 3,
    'a2a.stall': 1,
    'a2a.engine.rpm': 2400,
    'std.gear.left': 1,
    'std.gear.center': 1,
    'std.gear.right': 1,
    'std.flaps': 0.25,
    'a2a.canopy': 50,
    'std.gear': 1
  }, 10);
  close(result.packet.acc[0], 1 + Math.sin(-Math.PI / 9) * Math.cos(-Math.PI / 18));
  close(result.packet.acc[1], 3 - Math.sin(-Math.PI / 18));
  close(result.packet.acc[2], 2 - Math.cos(-Math.PI / 9) * Math.cos(-Math.PI / 18));
  assert.deepEqual(result.packet.ang_vel, [1, 3, 2]);
  close(result.packet.pitch, -Math.PI / 18);
  close(result.packet.roll, -Math.PI / 9);
  close(result.packet.yaw, -Math.PI / 2);
  close(result.packet.alt_agl, 304.8);
  close(result.packet.ias, 46.3);
  assert.equal(result.packet.stall, 1);
  assert.equal(result.packet.rpm_left, 2400);
  assert.equal(result.packet.prop_rpm, 2400);
  assert.equal(result.packet.vel, undefined);
  assert.equal(result.packet.gear_left, undefined);
  assert.equal(result.packet.flaps, undefined);
  assert.equal(result.packet.v, 2);
  assert.equal(result.packet.name, 'A2A_PA24_250_Comanche_MSFS');
  assert.deepEqual(result.errors, {});
});

test('individual channels can be disabled and omitted', () => {
  const config = buildDefaultConfig();
  Object.values(config.channels).forEach((channel) => { channel.enabled = false; });
  config.channels.rpm_left.enabled = true;
  const core = new RouterCore(config);
  const result = core.update({ 'a2a.engine.rpm': 1234 }, 0);
  assert.equal(result.packet.rpm_left, 1234);
  assert.equal(result.packet.acc, undefined);
  assert.deepEqual(Object.keys(result.packet), ['v', 'name', 't', 'rpm_left']);
});

test('angular acceleration is integrated only when explicitly selected', () => {
  const config = buildDefaultConfig();
  Object.values(config.channels).forEach((channel) => { channel.enabled = false; });
  config.channels['ang_vel.0'] = {
    enabled: true,
    sourceId: 'a2a.rotacc.x',
    inputUnit: 'radps2',
    operation: 'integrate',
    scale: 1,
    offset: 0
  };
  const core = new RouterCore(config);
  core.update({ 'a2a.rotacc.x': 2 }, 0);
  const result = core.update({ 'a2a.rotacc.x': 2 }, 0.5);
  close(result.packet.ang_vel[0], 0, 1e-12); // Gap protection resets integrations above 250 ms.
  const second = core.update({ 'a2a.rotacc.x': 2 }, 0.6);
  close(second.packet.ang_vel[0], 0.2, 1e-12);
});

test('incompatible direct units are reported per channel', () => {
  const config = buildDefaultConfig();
  Object.values(config.channels).forEach((channel) => { channel.enabled = false; });
  config.channels['ang_vel.0'] = {
    enabled: true,
    sourceId: 'a2a.rotacc.x',
    inputUnit: 'radps2',
    operation: 'direct',
    scale: 1,
    offset: 0
  };
  const result = new RouterCore(config).update({ 'a2a.rotacc.x': 3 }, 0);
  assert.match(result.errors['ang_vel.0'], /kann nicht/);
  assert.equal(result.packet.ang_vel, undefined);
});

test('custom LVars are normalized and survive valid mappings', () => {
  const config = buildDefaultConfig();
  config.customSources.push({
    id: 'custom.buffet',
    label: 'Buffet',
    simVar: 'L:My_Buffet',
    simConnectUnit: 'number',
    inputUnit: 'percent'
  });
  config.channels.shake = {
    enabled: true,
    sourceId: 'custom.buffet',
    inputUnit: 'percent',
    operation: 'direct',
    scale: 1,
    offset: 0
  };
  const normalized = normalizeConfig(config);
  assert.equal(normalized.customSources[0].simVar, 'L:My_Buffet');
  const result = new RouterCore(normalized).update({ 'custom.buffet': 25 }, 0);
  close(result.packet.shake, 0.25);
});

test('supported calculus combinations are explicit', () => {
  assert.equal(operationCompatible('integrate', 'angularAcceleration', 'angularVelocity'), true);
  assert.equal(operationCompatible('direct', 'angularAcceleration', 'angularVelocity'), false);
  assert.equal(operationCompatible('differentiate', 'velocity', 'acceleration'), true);
});

test('catalog covers every documented numeric DCS-v2 telemetry field', () => {
  const actual = new Set(OUTPUTS.map((entry) => entry.packetKey));
  const expected = new Set([
    'acc', 'ang_vel', 'vel', 'pitch', 'roll', 'yaw', 'alt_agl', 'alt_msl', 'tas',
    'aoa', 'aos', 'ias', 'mach', 'wind', 'shake', 'panel_shake', 'stall',
    'rpm_left', 'rpm_right', 'prop_rpm', 'rotor_rpm',
    'gear_left', 'gear_nose', 'gear_right', 'flaps', 'speedbrakes', 'canopy', 'gear', 'afterburner',
    'cannon_rounds_fired', 'missiles_released', 'bombs_released', 'rockets_released',
    'flares_released', 'chaff_released', 'damage_total'
  ]);
  assert.deepEqual(actual, expected);
});

test('basic view exposes only relevant standard and A2A sources', () => {
  const sourceIds = new Set(BUILTIN_SOURCES.map((entry) => entry.id));
  const basicOutputs = OUTPUTS.filter((entry) => entry.basic);
  assert.deepEqual(basicOutputs.map((entry) => entry.id), [
    'acc.0', 'acc.1', 'acc.2', 'ang_vel.0', 'ang_vel.1', 'ang_vel.2',
    'pitch', 'roll', 'yaw', 'alt_agl', 'ias', 'stall', 'rpm_left', 'prop_rpm'
  ]);
  for (const output of basicOutputs) {
    assert(output.simpleSources.length >= 1 && output.simpleSources.length <= 2);
    for (const rule of output.simpleSources) {
      assert.equal(sourceIds.has(rule.sourceId), true, `${output.id}: ${rule.sourceId}`);
      assert.equal(['std.', 'a2a.'].some((prefix) => rule.sourceId.startsWith(prefix)), true);
      assert.equal(['direct', 'integrate'].includes(rule.operation), true);
    }
  }
});

test('legacy full default is migrated to the reduced basic output set', () => {
  const legacy = buildDefaultConfig();
  legacy.schemaVersion = 1;
  legacy.expertMode = true;
  legacy.channels['vel.0'].enabled = true;
  legacy.channels.gear_left.enabled = true;
  const normalized = normalizeConfig(legacy);
  assert.equal(normalized.schemaVersion, 3);
  assert.equal(normalized.expertMode, true);
  assert.equal(normalized.channels['acc.0'].enabled, true);
  assert.equal(normalized.channels['vel.0'].enabled, false);
  assert.equal(normalized.channels.gear_left.enabled, false);
});

test('schema v2 mappings migrate negative scales into the explicit invert flag', () => {
  const config = buildDefaultConfig();
  config.schemaVersion = 2;
  for (const channel of Object.values(config.channels)) delete channel.invert;
  config.channels.pitch.scale = 1;
  config.channels.roll.scale = 1;
  config.channels.yaw.scale = -1;
  const normalized = normalizeConfig(config);
  assert.equal(normalized.channels.pitch.invert, true);
  assert.equal(normalized.channels.roll.invert, true);
  assert.equal(normalized.channels.yaw.invert, true);
  assert.equal(normalized.channels.yaw.scale, 1);
});

test('DCS gravity reference is a full attitude-dependent 1g vector', () => {
  const level = gravityVector(0, 0, 1);
  close(level[0], 0);
  close(level[1], 0);
  close(level[2], -1);
  const banked = gravityVector(0, Math.PI / 6, 1);
  close(banked[0], 0.5);
  close(banked[1], 0);
  close(banked[2], -Math.sqrt(3) / 2);
});

test('DCS vectors keep a fixed shape when an individual axis is disabled', () => {
  const config = buildDefaultConfig();
  config.gravity.enabled = false;
  config.channels['ang_vel.2'].enabled = false;
  const result = new RouterCore(config).update({
    'a2a.acc.x': 0,
    'a2a.acc.y': 0,
    'a2a.acc.z': 0,
    'std.angular.body.x': 1,
    'std.angular.body.z': 2,
    'std.pitch': 0,
    'std.bank': 0,
    'std.heading': 0,
    'std.alt.agl': 0,
    'std.airspeed.ias': 0,
    'a2a.stall': 0,
    'a2a.engine.rpm': 0
  }, 0);
  assert.deepEqual(result.packet.ang_vel, [1, 2, 0]);
  assert.equal(result.packet.ang_vel.length, 3);
});

test('turbulence mixer adds only a bounded band-pass component to vertical acceleration', () => {
  const config = buildDefaultConfig();
  config.gravity.enabled = false;
  config.turbulence.enabled = true;
  config.turbulence.mix = 1;
  config.turbulence.gain = 3;
  config.turbulence.maxExtraG = 0.2;
  const core = new RouterCore(config);
  const sample = {
    'a2a.acc.x': 0,
    'a2a.acc.y': 0,
    'a2a.acc.z': 0,
    'std.angular.body.x': 0,
    'std.angular.body.y': 0,
    'std.angular.body.z': 0,
    'std.pitch': 0,
    'std.bank': 0,
    'std.heading': 0,
    'std.alt.agl': 0,
    'std.airspeed.ias': 0,
    'a2a.stall': 0,
    'a2a.engine.rpm': 0
  };
  core.update(sample, 0);
  sample['a2a.acc.y'] = 0.1 * 9.80665;
  const result = core.update(sample, 0.02);
  assert(result.diagnostics.turbulence.bandG > 0);
  assert(result.diagnostics.turbulence.extraG > 0);
  assert(result.diagnostics.turbulence.extraG < 0.2);
  assert(result.packet.acc[2] > 0.1);
});

test('only enabled channel sources are required and shared sources are deduplicated', () => {
  const config = buildDefaultConfig();
  const defaults = requiredSources(config).map((entry) => entry.id);
  assert.equal(defaults.length, 13);
  assert.equal(defaults.includes('a2a.engine.rpm'), true);
  assert.equal(defaults.includes('std.gear.left'), false);
  assert.equal(defaults.includes('std.wind.x'), false);

  config.channels['acc.0'].sourceId = 'std.acc.body.x';
  config.channels['acc.1'].enabled = false;
  const changed = requiredSources(config).map((entry) => entry.id);
  assert.equal(changed.includes('std.acc.body.x'), true);
  assert.equal(changed.includes('a2a.acc.x'), false);
  assert.equal(changed.includes('a2a.acc.z'), false);
  assert.equal(changed.filter((id) => id === 'a2a.engine.rpm').length, 1);
});

test('safe expert source catalog is semantic and mathematically reachable', () => {
  const sourceById = new Map(BUILTIN_SOURCES.map((source) => [source.id, source]));
  const outputById = new Map(OUTPUTS.map((output) => [output.id, output]));
  for (const [outputId, sourceIds] of Object.entries(SAFE_SOURCE_IDS)) {
    const output = outputById.get(outputId);
    assert(output, `unknown output ${outputId}`);
    for (const sourceId of sourceIds) {
      const source = sourceById.get(sourceId);
      assert(source, `${outputId}: unknown source ${sourceId}`);
      const inputFamily = UNIT_DEFINITIONS[source.inputUnit].family;
      const outputFamily = UNIT_DEFINITIONS[output.targetUnit].family;
      assert(compatibleOperationIds(inputFamily, outputFamily).length > 0, `${outputId}: ${sourceId}`);
    }
  }
  assert.equal(SAFE_SOURCE_IDS['acc.0'].includes('std.velocity.world.x'), false);
  assert.deepEqual(compatibleOperationIds('velocity', 'acceleration'), ['differentiate']);
  assert.deepEqual(compatibleOperationIds('scalar', 'acceleration'), []);
  assert.deepEqual(safeCompatibleOperationIds('scalar', 'rpm'), []);
  assert.deepEqual(safeCompatibleOperationIds('boolean', 'ratio'), ['direct']);
});

test('turbulence source list stays limited to meaningful vertical detectors', () => {
  assert.deepEqual(TURBULENCE_SOURCE_IDS, [
    'a2a.acc.y',
    'std.acc.body.y',
    'std.gforce',
    'std.wind.y'
  ]);
});

test('safe runtime blocks stored Raw mappings until Raw mode is enabled', () => {
  const config = buildDefaultConfig();
  for (const channel of Object.values(config.channels)) channel.enabled = false;
  config.expertMode = true;
  config.channels.rpm_left = {
    enabled: true,
    sourceId: 'std.mach',
    inputUnit: 'number',
    operation: 'direct',
    scale: 1,
    offset: 0
  };

  const safeCore = new RouterCore(config);
  const safeResult = safeCore.update({ 'std.mach': 0.75 }, 0);
  assert.equal(safeResult.packet.rpm_left, undefined);
  assert.match(safeResult.errors.rpm_left, /Raw-Modus/);
  assert.equal(requiredSources(safeCore.config).some((source) => source.id === 'std.mach'), false);

  config.unsafeMode = true;
  const rawCore = new RouterCore(config);
  const rawResult = rawCore.update({ 'std.mach': 0.75 }, 0);
  assert.equal(rawResult.packet.rpm_left, 0.75);
  assert.equal(rawResult.errors.rpm_left, undefined);
  assert.equal(requiredSources(rawCore.config).some((source) => source.id === 'std.mach'), true);
});
