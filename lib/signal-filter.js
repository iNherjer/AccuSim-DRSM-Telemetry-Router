'use strict';

// Each filter operates on one calculated contribution, before summation.
const MIXER_FILTERS = Object.freeze([
  { id: 'turbulence.main', anchor: 'turbulenceEnabledInput', de: 'Turbulenz-Hauptsignal', en: 'Main turbulence' },
  { id: 'turbulence.wind', anchor: 'turbulenceEnabledInput', de: 'Vertikaler Wind', en: 'Vertical wind' },
  { id: 'turbulence.lateral', anchor: 'turbulenceEnabledInput', de: 'Seitenwind vor Kraft-/Drehratenverteilung', en: 'Lateral wind before force/rate distribution' },
  { id: 'ground.lateral', anchor: 'groundForcesEnabledInput', de: 'Ground quer', en: 'Ground lateral' },
  { id: 'ground.longitudinal', anchor: 'groundForcesEnabledInput', de: 'Ground längs', en: 'Ground longitudinal' },
  { id: 'ground.heave', anchor: 'groundForcesEnabledInput', de: 'Ground-Heave-Korrektur', en: 'Ground heave correction' },
  { id: 'attitude.pitch', anchor: 'attitudeMixEnabledInput', de: 'Lagebeimischung Pitch', en: 'Pitch attitude mix' },
  { id: 'attitude.roll', anchor: 'attitudeMixEnabledInput', de: 'Lagebeimischung Roll', en: 'Roll attitude mix' },
  { id: 'shake.airframe', anchor: 'shakeMixerEnabledInput', de: 'Airframe Shake vor Achsenverteilung', en: 'Airframe shake before axis distribution' },
  { id: 'shake.vertical', anchor: 'shakeMixerEnabledInput', de: 'Vertical Shake vor Achsenverteilung', en: 'Vertical shake before axis distribution' },
  { id: 'shake.horizontal', anchor: 'shakeMixerEnabledInput', de: 'Horizontal Shake vor Achsenverteilung', en: 'Horizontal shake before axis distribution' }
]);

function normalizeFilter(raw = {}) {
  const nonnegative = (value, max) => Number.isFinite(Number(value))
    ? Math.max(0, Math.min(max, Number(value))) : 0;
  return { smoothingMs: nonnegative(raw?.smoothingMs, 5000), ramp: nonnegative(raw?.ramp, 1000000) };
}

function channelFilterSupported(definition, units) {
  return !definition.integer && !['boolean', 'count'].includes(units[definition.targetUnit]?.family);
}

function filterColumnIds(outputs, units) {
  return [
    ...outputs.filter((output) => channelFilterSupported(output, units)).map((output) => `channel.${output.id}`),
    ...MIXER_FILTERS.map((entry) => entry.id)
  ];
}

function wrappedDelta(delta, period) {
  return period > 0 ? ((delta + period / 2) % period + period) % period - period / 2 : delta;
}

class SignalFilters {
  constructor() {
    this.states = new Map();
    this.diagnostics = {};
    this.used = new Set();
  }

  begin() { this.diagnostics = {}; this.used.clear(); }

  apply(id, input, time, settings, { period = 0, context = '' } = {}) {
    const { smoothingMs, ramp } = normalizeFilter(settings);
    this.used.add(id);
    const previous = this.states.get(id);
    const dt = previous ? time - previous.time : 0;
    const valid = previous && previous.context === context && dt > 0 && dt <= 0.25;
    // Bypass must be bit-for-bit unchanged, including at angle wrap boundaries.
    let smoothed = input;
    let output = input;
    if (valid && (smoothingMs > 0 || ramp > 0)) {
      if (smoothingMs > 0) {
        const alpha = -Math.expm1(-dt / (smoothingMs / 1000));
        smoothed = previous.smoothed + alpha * wrappedDelta(input - previous.smoothed, period);
      }
      const delta = wrappedDelta(smoothed - previous.output, period);
      output = previous.output + (ramp > 0
        ? Math.max(-ramp * dt, Math.min(ramp * dt, delta)) : delta);
    }
    this.states.set(id, { time, smoothed, output, context });
    this.diagnostics[id] = { input, smoothed, output, smoothingMs, ramp,
      active: smoothingMs > 0 || ramp > 0, reset: !valid };
    return output;
  }

  end() {
    // Disabled/erroring branches must not resume an old retained cue.
    for (const id of this.states.keys()) if (!this.used.has(id)) this.states.delete(id);
  }
}

module.exports = { MIXER_FILTERS, SignalFilters, normalizeFilter, channelFilterSupported, filterColumnIds };
