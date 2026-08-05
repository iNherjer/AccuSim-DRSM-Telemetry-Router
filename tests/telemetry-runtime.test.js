'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildDefaultConfig } = require('../lib/catalog');
const { sourceSignature } = require('../lib/telemetry-runtime');

test('SimConnect subscription changes only when required inputs change', () => {
  const config = buildDefaultConfig();
  const initial = sourceSignature(config);

  config.channels['acc.0'].scale = -1;
  assert.equal(sourceSignature(config), initial);

  config.channels['acc.0'].sourceId = 'std.acc.body.x';
  // Both candidates are diagnostic comparison channels and are therefore
  // already subscribed before the route changes.
  assert.equal(sourceSignature(config), initial);

  const changed = sourceSignature(config);
  config.channels.gear_left.sourceId = 'std.gear.left';
  assert.equal(config.channels.gear_left.enabled, false);
  assert.equal(sourceSignature(config), changed);

  config.channels.gear_left.enabled = true;
  assert.notEqual(sourceSignature(config), changed);
});
