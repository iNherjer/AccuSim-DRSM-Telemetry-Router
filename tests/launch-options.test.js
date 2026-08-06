'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseLaunchOptions, secondInstanceAction } = require('../lib/launch-options');

test('tracker background launch stays headless and tracker-owned', () => {
  assert.deepEqual(parseLaunchOptions(['app.exe', '--background', '--owner=tracker']), {
    background: true,
    showSettings: false,
    start: false,
    stop: false,
    owner: 'tracker'
  });
});

test('manual second launch promotes a headless instance and opens settings', () => {
  const action = secondInstanceAction(['app.exe']);
  assert.equal(action.showSettings, true);
  assert.equal(action.promoteToStandalone, true);
  assert.equal(action.owner, 'standalone');
});

test('settings command does not take ownership away from the tracker', () => {
  const action = secondInstanceAction(['app.exe', '--show-settings']);
  assert.equal(action.showSettings, true);
  assert.equal(action.promoteToStandalone, false);
});
