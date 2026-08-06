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
      'attitude_mix_lateral_g',
      'attitude_mix_longitudinal_g',
      'ground_forces_on_ground',
      'ground_forces_valid',
      'ground_forces_blend',
      'ground_forces_raw_lateral_g',
      'ground_forces_raw_longitudinal_g',
      'ground_forces_filtered_lateral_g',
      'ground_forces_filtered_longitudinal_g',
      'ground_forces_kinematic_lateral_g',
      'ground_forces_kinematic_longitudinal_g',
      'ground_forces_compensated_lateral_g',
      'ground_forces_compensated_longitudinal_g',
      'ground_forces_compensation_valid',
      'ground_forces_unlimited_lateral_g',
      'ground_forces_unlimited_longitudinal_g',
      'ground_forces_limited_lateral_g',
      'ground_forces_limited_longitudinal_g',
      'ground_forces_applied_lateral_g',
      'ground_forces_applied_longitudinal_g',
      'ground_forces_lateral_eligible',
      'ground_forces_longitudinal_eligible',
      'ground_forces_lateral_limited',
      'ground_forces_longitudinal_limited',
      'ground_heave_blend',
      'ground_heave_ground_g',
      'ground_heave_flight_g',
      'ground_heave_raw_delta_g',
      'ground_heave_applied_g',
      'ground_heave_eligible',
      ...['airframe', 'vertical', 'horizontal'].flatMap((source) => [
        `shake_mixer_${source}_raw`,
        `shake_mixer_${source}_band`,
        `shake_mixer_${source}_normalized`,
        `shake_mixer_${source}_lateral_g`,
        `shake_mixer_${source}_longitudinal_g`,
        `shake_mixer_${source}_vertical_g`
      ]),
      'shake_mixer_unlimited_lateral_g',
      'shake_mixer_unlimited_longitudinal_g',
      'shake_mixer_unlimited_vertical_g',
      'shake_mixer_extra_lateral_g',
      'shake_mixer_extra_longitudinal_g',
      'shake_mixer_extra_vertical_g',
      'shake_mixer_applied_lateral_g',
      'shake_mixer_applied_longitudinal_g',
      'shake_mixer_applied_vertical_g',
      'shake_mixer_lateral_limited',
      'shake_mixer_longitudinal_limited',
      'shake_mixer_vertical_limited',
      ...[0, 1, 2].flatMap((index) => [
        `fusion_${index}_v2`,
        `fusion_${index}_source_acc_radps2`,
        `fusion_${index}_bias_radps2`,
        `fusion_${index}_unbiased_acc_radps2`,
        `fusion_${index}_reference_rate_radps`,
        `fusion_${index}_prediction_radps`,
        `fusion_${index}_correction_radps`,
        `fusion_${index}_correction_active`,
        `fusion_${index}_correction_tau_s`,
        `fusion_${index}_detail_radps`,
        `fusion_${index}_detail_mix`,
        `fusion_${index}_washout_correction_radps`,
        `fusion_${index}_washout_active`,
        `fusion_${index}_washout_tau_s`,
        `fusion_${index}_output_radps`,
        `fusion_${index}_reference_valid`
      ]),
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
    const attitudeMix = diagnostics.attitudeMix?.vectorG || [];
    const groundForces = diagnostics.groundForces || {};
    const shakeMixer = diagnostics.shakeMixer || {};
    const angularFusion = diagnostics.angularFusion || {};
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
      csvValue(attitudeMix[0]),
      csvValue(attitudeMix[1]),
      csvValue(groundForces.onGround),
      csvValue(groundForces.valid),
      csvValue(groundForces.blend),
      csvValue(groundForces.rawG?.[0]),
      csvValue(groundForces.rawG?.[1]),
      csvValue(groundForces.filteredG?.[0]),
      csvValue(groundForces.filteredG?.[1]),
      csvValue(groundForces.kinematicG?.[0]),
      csvValue(groundForces.kinematicG?.[1]),
      csvValue(groundForces.compensatedG?.[0]),
      csvValue(groundForces.compensatedG?.[1]),
      csvValue(groundForces.compensationValid),
      csvValue(groundForces.unlimitedG?.[0]),
      csvValue(groundForces.unlimitedG?.[1]),
      csvValue(groundForces.limitedG?.[0]),
      csvValue(groundForces.limitedG?.[1]),
      csvValue(groundForces.appliedG?.[0]),
      csvValue(groundForces.appliedG?.[1]),
      csvValue(groundForces.eligible?.[0]),
      csvValue(groundForces.eligible?.[1]),
      csvValue(groundForces.limited?.[0]),
      csvValue(groundForces.limited?.[1]),
      csvValue(groundForces.heave?.blend),
      csvValue(groundForces.heave?.groundG),
      csvValue(groundForces.heave?.flightG),
      csvValue(groundForces.heave?.rawDeltaG),
      csvValue(groundForces.heave?.appliedG),
      csvValue(groundForces.heave?.eligible),
      ...['airframe', 'vertical', 'horizontal'].flatMap((source) => {
        const shake = shakeMixer.sources?.[source] || {};
        return [
          csvValue(shake.raw),
          csvValue(shake.band),
          csvValue(shake.normalized),
          csvValue(shake.contributionG?.[0]),
          csvValue(shake.contributionG?.[1]),
          csvValue(shake.contributionG?.[2])
        ];
      }),
      csvValue(shakeMixer.unlimitedG?.[0]),
      csvValue(shakeMixer.unlimitedG?.[1]),
      csvValue(shakeMixer.unlimitedG?.[2]),
      csvValue(shakeMixer.extraG?.[0]),
      csvValue(shakeMixer.extraG?.[1]),
      csvValue(shakeMixer.extraG?.[2]),
      csvValue(shakeMixer.appliedG?.[0]),
      csvValue(shakeMixer.appliedG?.[1]),
      csvValue(shakeMixer.appliedG?.[2]),
      csvValue(shakeMixer.limited?.[0]),
      csvValue(shakeMixer.limited?.[1]),
      csvValue(shakeMixer.limited?.[2]),
      ...[0, 1, 2].flatMap((index) => {
        const fusion = angularFusion[`ang_vel.${index}`] || {};
        return [
          csvValue(fusion.v2),
          csvValue(fusion.sourceAccelerationRadps2),
          csvValue(fusion.biasRadps2),
          csvValue(fusion.unbiasedAccelerationRadps2),
          csvValue(fusion.referenceRateRadps),
          csvValue(fusion.predictionRadps),
          csvValue(fusion.correctionRadps),
          csvValue(fusion.correctionActive),
          csvValue(fusion.correctionTauSeconds),
          csvValue(fusion.detailRadps),
          csvValue(fusion.detailMix),
          csvValue(fusion.washoutCorrectionRadps),
          csvValue(fusion.washoutActive),
          csvValue(fusion.washoutTauSeconds),
          csvValue(fusion.outputRadps),
          csvValue(fusion.referenceValid)
        ];
      }),
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
