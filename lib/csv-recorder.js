'use strict';

const fs = require('node:fs');
const path = require('node:path');

function timestampForFile(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function csvValue(value) {
  if (value === true) return '1';
  if (value === false) return '0';
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(7) : '';
}

function columnId(prefix, id, unit = '') {
  const safeId = String(id || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const safeUnit = String(unit || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return [prefix, safeId, safeUnit].filter(Boolean).join('_').toLowerCase();
}

class CsvRecorder {
  constructor({ outputDirectory, fsModule = fs, now = () => new Date() } = {}) {
    if (!outputDirectory) throw new Error('CSV-Ausgabeordner fehlt.');
    this.outputDirectory = path.resolve(outputDirectory);
    this.fs = fsModule;
    this.now = now;
    this.stream = null;
    this.sourceColumns = [];
    this.outputColumns = [];
    this.state = { active: false, path: '', rows: 0, error: '' };
  }

  publicState() {
    return { ...this.state };
  }

  start({ sources = [], outputs = [] } = {}) {
    if (this.stream) return this.publicState();
    this.fs.mkdirSync(this.outputDirectory, { recursive: true });
    const filePath = path.join(
      this.outputDirectory,
      `AccuSim-Telemetry-Router-${timestampForFile(this.now())}.csv`
    );
    this.sourceColumns = sources.map((source) => ({
      id: source.id,
      header: columnId('src', source.id, source.inputUnit)
    }));
    this.outputColumns = outputs.map((output) => ({
      id: output.id,
      header: columnId('out', output.id, output.targetUnit)
    }));
    this.stream = this.fs.createWriteStream(filePath, { flags: 'w' });
    this.stream.on('error', (error) => {
      this.state = { ...this.state, active: false, error: error.message };
      this.stream = null;
    });
    const headers = [
      'time_s',
      ...this.sourceColumns.map((entry) => entry.header),
      ...this.outputColumns.map((entry) => entry.header),
      'sample_dt_s',
      'gap_detected',
      'post_gap_turbulence_suppressed',
      'post_gap_remaining_s',
      'gravity_reference_pitch_rad',
      'gravity_reference_roll_rad',
      'gravity_reference_valid',
      'gravity_lateral_g',
      'gravity_longitudinal_g',
      'gravity_vertical_g',
      'turbulence_source_g',
      'turbulence_band_g',
      'turbulence_main_extra_g',
      'turbulence_wind_source_g',
      'turbulence_wind_band_g',
      'turbulence_wind_extra_g',
      'turbulence_unlimited_extra_g',
      'turbulence_computed_extra_g',
      'turbulence_extra_g',
      'turbulence_limited',
      'turbulence_suppressed'
    ];
    this.stream.write(`${headers.join(',')}\n`);
    this.state = { active: true, path: filePath, rows: 0, error: '' };
    return this.publicState();
  }

  write({ sourceValues = {}, mapped = {} } = {}) {
    if (!this.stream || !this.state.active) return;
    const diagnostics = mapped.diagnostics || {};
    const timing = diagnostics.timing || {};
    const gravity = diagnostics.gravity?.vectorG || [];
    const gravityDiagnostics = diagnostics.gravity || {};
    const turbulence = diagnostics.turbulence || {};
    const wind = turbulence.wind || {};
    const row = [
      csvValue(mapped.packet?.t),
      ...this.sourceColumns.map((entry) => csvValue(sourceValues[entry.id])),
      ...this.outputColumns.map((entry) => csvValue(mapped.outputValues?.[entry.id])),
      csvValue(timing.sampleDtSeconds),
      csvValue(timing.gapDetected),
      csvValue(timing.postGapTurbulenceSuppressed),
      csvValue(timing.postGapRemainingSeconds),
      csvValue(gravityDiagnostics.referencePitchRad),
      csvValue(gravityDiagnostics.referenceRollRad),
      csvValue(gravityDiagnostics.referenceValid),
      csvValue(gravity[0]),
      csvValue(gravity[1]),
      csvValue(gravity[2]),
      csvValue(turbulence.sourceG),
      csvValue(turbulence.bandG),
      csvValue(turbulence.mainExtraG),
      csvValue(wind.sourceG),
      csvValue(wind.bandG),
      csvValue(wind.extraG),
      csvValue(turbulence.unlimitedExtraG),
      csvValue(turbulence.computedExtraG),
      csvValue(turbulence.extraG),
      csvValue(turbulence.limited),
      csvValue(turbulence.suppressed)
    ];
    this.stream.write(`${row.join(',')}\n`);
    this.state.rows += 1;
  }

  stop() {
    const stream = this.stream;
    this.stream = null;
    this.state.active = false;
    if (!stream) return Promise.resolve(this.publicState());
    return new Promise((resolve) => {
      stream.end(() => resolve(this.publicState()));
    });
  }
}

module.exports = { CsvRecorder, columnId, csvValue, timestampForFile };
