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
          gravity: { vectorG: [0.1, 0.2, -0.97] },
          turbulence: {
            sourceG: 0.12,
            bandG: 0.08,
            mainExtraG: 0.02,
            wind: { sourceG: 0.04, bandG: 0.03, extraG: 0.01 },
            unlimitedExtraG: 0.03,
            extraG: 0.03,
            limited: false
          }
        }
      }
    });
    const stopped = await recorder.stop();
    assert.equal(stopped.active, false);
    assert.equal(stopped.rows, 1);
    const text = fs.readFileSync(started.path, 'utf8').trim().split(/\r?\n/);
    assert.match(text[0], /src_a2a_acc_y_mps2/);
    assert.match(text[0], /out_acc_2_g/);
    assert.match(text[0], /turbulence_extra_g/);
    assert.match(text[0], /turbulence_wind_extra_g/);
    assert.match(text[1], /1\.2500000/);
    assert.match(text[1], /-0\.8500000/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
