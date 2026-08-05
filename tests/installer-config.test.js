'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('web installer is the only build target and closes legacy portable processes', () => {
  const root = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const includePath = packageJson.build?.nsisWeb?.include;
  assert.equal(packageJson.version, '1.9.0');
  assert.equal(includePath, 'build/installer.nsh');
  assert.deepEqual(packageJson.build?.win?.target, [{ target: 'nsis-web', arch: ['x64'] }]);
  assert.equal(packageJson.build?.portable, undefined);

  const installer = fs.readFileSync(path.join(root, includePath), 'utf8');
  assert.match(installer, /customCheckAppRunning/);
  assert.match(installer, /\$\{APP_EXECUTABLE_FILENAME\}/);
  assert.match(installer, /AccuSim-DRSM-Telemetry-Router\.exe/);
  assert.match(installer, /nsProcess::CloseProcess/);
  assert.match(installer, /nsProcess::KillProcess/);
  assert.match(installer, /Installation fortsetzen\?/);
});
