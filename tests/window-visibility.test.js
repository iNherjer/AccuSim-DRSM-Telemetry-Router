'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldBroadcastToWindow } = require('../lib/window-visibility');

function windowState({ destroyed = false, visible = true, minimized = false } = {}) {
  return {
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    isMinimized: () => minimized
  };
}

test('renderer updates freeze while hidden or minimized and resume on demand', () => {
  assert.equal(shouldBroadcastToWindow(windowState()), true);
  assert.equal(shouldBroadcastToWindow(windowState({ visible: false })), false);
  assert.equal(shouldBroadcastToWindow(windowState({ minimized: true })), false);
  assert.equal(shouldBroadcastToWindow(windowState({ visible: false }), true), true);
  assert.equal(shouldBroadcastToWindow(windowState({ destroyed: true }), true), false);
  assert.equal(shouldBroadcastToWindow(null, true), false);
});
