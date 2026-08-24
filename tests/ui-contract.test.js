'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('renderer element registry matches the UI and exposes every axis inversion control', () => {
  const root = path.resolve(__dirname, '..');
  const renderer = fs.readFileSync(path.join(root, 'ui', 'renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
  const block = renderer.match(/const elements = Object\.fromEntries\(\[([\s\S]*?)\]\.map/);
  assert(block, 'renderer element registry was not found');
  const ids = [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const missing = ids.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);

  for (const id of [
    'attitudeMixPitchInvertInput',
    'attitudeMixRollInvertInput',
    'groundForcesLateralInvertInput',
    'groundForcesLongitudinalInvertInput'
  ]) {
    assert(ids.includes(id), `${id} is not connected to the renderer`);
    assert.match(html, new RegExp(`id="${id}"\\s+type="checkbox"`));
  }
});
