'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CsvRecorder } = require('../lib/csv-recorder');

test('CSV recorder writes raw sources, routed outputs and turbulence diagnostics', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'accusim-router-csv-'));
  try {
    const recorder = new CsvRecorder({
      outputDirectory: root,
      now: () => new Date(2026, 7, 3, 12, 34, 56)
    });
    const started = recorder.start({
      sources: [{ id: 'a2a.acc.y', inputUnit: 'mps2' }],
      outputs: [{ id: 'acc.2', targetUnit: 'g' }]
    });
    assert.equal(started.active, true);
    recorder.write({
      sourceValues: { 'a2a.acc.y': 1.25 },
      mapped: {
        packet: { t: 0.02 },
        outputValues: { 'acc.2': -0.85 },
        diagnostics: {
          timing: {
            sampleDtSeconds: 0.02,
            gapDetected: true,
            postGapTurbulenceSuppressed: true,
            postGapRemainingSeconds: 0.73
          },
          gravity: {
            vectorG: [0.1, 0.2, 0.97],
            referencePitchRad: -0.1,
            referenceRollRad: 0.2,
            referenceValid: true
          },
          attitudeMix: { vectorG: [0.05, -0.04, 0] },
          groundForces: {
            onGround: true,
            valid: true,
            blend: 0.75,
            rawG: [0.2, -0.3],
            filteredG: [0.18, -0.28],
            kinematicG: [0.16, -0.25],
            compensatedG: [0.17, -0.26],
            compensationValid: true,
            unlimitedG: [0.18, -0.28],
            limitedG: [0.17, -0.26],
            appliedG: [0.1275, -0.195],
            eligible: [true, true],
            limited: [false, false],
            heave: {
              blend: 0.8,
              groundG: 1.02,
              flightG: 0.95,
              rawDeltaG: 0.056,
              appliedG: 0.056,
              eligible: true
            }
          },
          shakeMixer: {
            sources: {
              airframe: {
                raw: 0.2,
                band: 0.1,
                normalized: 0.4,
                contributionG: [0.01, 0.02, 0.03]
              },
              vertical: {
                raw: 0.04,
                band: 0.02,
                normalized: 0.4,
                contributionG: [0, 0, 0.04]
              },
              horizontal: {
                raw: 0.12,
                band: 0.06,
                normalized: 0.4,
                contributionG: [0.04, 0, 0]
              }
            },
            unlimitedG: [0.05, 0.02, 0.07],
            extraG: [0.048, 0.019, 0.065],
            appliedG: [0.048, 0.019, 0.065],
            limited: [false, false, false]
          },
          angularFusion: {
            'ang_vel.0': {
              sourceAccelerationRadps2: 0.2,
              referenceRateRadps: 0.1,
              predictionRadps: 0.12,
              correctionRadps: -0.01,
              correctionActive: true,
              correctionTauSeconds: 1.25,
              washoutCorrectionRadps: -0.001,
              washoutActive: true,
              washoutTauSeconds: 6,
              outputRadps: 0.11,
              referenceValid: true
            }
          },
          turbulence: {
            sourceG: 0.12,
            bandG: 0.08,
            mainExtraG: 0.02,
            wind: { sourceG: 0.04, bandG: 0.03, extraG: 0.01 },
            unlimitedExtraG: 0.03,
            computedExtraG: 0.03,
            extraG: 0.03,
            limited: false,
            suppressed: true
          }
        }
      }
    });
    const stopped = await recorder.stop();
    assert.equal(stopped.active, false);
    assert.equal(stopped.rows, 1);
    const text = fs.readFileSync(started.path, 'utf8').trim().split(/\r?\n/);
    assert.equal(text[1].split(',').length, text[0].split(',').length);
    assert.match(text[0], /src_a2a_acc_y_mps2/);
    assert.match(text[0], /out_acc_2_g/);
    assert.match(text[0], /turbulence_extra_g/);
    assert.match(text[0], /turbulence_wind_extra_g/);
    assert.match(text[0], /sample_dt_s/);
    assert.match(text[0], /gravity_reference_pitch_rad/);
    assert.match(text[0], /attitude_mix_lateral_g/);
    assert.match(text[0], /ground_forces_blend/);
    assert.match(text[0], /ground_forces_applied_longitudinal_g/);
    assert.match(text[0], /ground_forces_compensated_longitudinal_g/);
    assert.match(text[0], /ground_heave_applied_g/);
    assert.match(text[0], /ground_forces_lateral_eligible/);
    assert.match(text[0], /shake_mixer_airframe_raw/);
    assert.match(text[0], /shake_mixer_vertical_band/);
    assert.match(text[0], /shake_mixer_horizontal_lateral_g/);
    assert.match(text[0], /shake_mixer_applied_vertical_g/);
    assert.match(text[0], /fusion_0_reference_rate_radps/);
    assert.match(text[0], /fusion_0_bias_radps2/);
    assert.match(text[0], /fusion_0_detail_mix/);
    assert.match(text[0], /fusion_0_washout_active/);
    assert.match(text[0], /turbulence_suppressed/);
    assert.match(text[1], /1\.2500000/);
    assert.match(text[1], /-0\.8500000/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
