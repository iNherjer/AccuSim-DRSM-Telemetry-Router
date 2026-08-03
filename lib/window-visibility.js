'use strict';

function shouldBroadcastToWindow(window, force = false) {
  if (!window || window.isDestroyed()) return false;
  return force === true || (window.isVisible() && !window.isMinimized());
}

module.exports = { shouldBroadcastToWindow };
