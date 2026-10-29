'use strict';

// Wire layout from DCS_To_FlyPT_Mover.lua bundled with Mover 3.5.3
// (27 August 2021, script header 3.5.2). Bridge packets use DRSM ordering.
function encodeOutput(packet, protocol = 'drsm') {
  if (protocol !== 'flypt353') return Buffer.from(JSON.stringify(packet), 'utf8');
  const n = (value) => Number.isFinite(value) ? value : 0;
  const a = packet.acc || [];
  const v = packet.vel || [];
  const w = packet.ang_vel || [];
  const values = [
    a[1], a[0], a[2],
    v[1], v[0], v[2],
    w[2], w[1], w[0],
    -n(packet.yaw), packet.roll, packet.pitch,
    packet.tas,
    // Draw arguments 1/4/6 are suspension travel, NOT gear extension.
    // No equivalent source is currently routed; do not invent compression.
    0, 0, 0, 0,
    packet.alt_agl, packet.flaps, packet.gear, packet.speedbrakes,
    packet.canopy, packet.stall, packet.aoa, packet.t
  ];
  return Buffer.from(values.map((value) => n(value).toFixed(4)).join(' '), 'utf8');
}

module.exports = { encodeOutput };
