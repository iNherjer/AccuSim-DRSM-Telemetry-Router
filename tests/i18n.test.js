'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { OUTPUTS, TURBULENCE_PRESETS, UNIT_DEFINITIONS } = require('../lib/catalog');
const { TRANSLATIONS, normalizeLanguage, translate } = require('../lib/i18n');
const { RouterCore, normalizeConfig } = require('../lib/router-core');

test('German and English expose the same translation keys', () => {
  assert.deepEqual(Object.keys(TRANSLATIONS.en).sort(), Object.keys(TRANSLATIONS.de).sort());
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage('fr'), 'de');
  assert.equal(translate('en', 'packet.summary', { fields: 4, packets: 10 }), '4 fields · 10 packets');
  assert.equal(translate('de', 'packet.summary', { fields: 4, packets: 10 }), '4 Felder · 10 Pakete');
});

test('every DCS output has bilingual labels and a meaningful tooltip', () => {
  for (const output of OUTPUTS) {
    assert(output.labelDe?.length > 2, `${output.id} has no German label`);
    assert(output.labelEn?.length > 2, `${output.id} has no English label`);
    assert(output.helpDe?.length > 25, `${output.id} has no German help`);
    assert(output.helpEn?.length > 25, `${output.id} has no English help`);
  }
  for (const unit of Object.values(UNIT_DEFINITIONS)) assert(unit.labelEn);
  for (const preset of TURBULENCE_PRESETS) {
    assert(preset.labelEn);
    assert(preset.descriptionEn);
  }
});

test('language persists through normalization and localizes mapping errors', () => {
  const config = normalizeConfig({ language: 'en' });
  assert.equal(config.language, 'en');
  Object.values(config.channels).forEach((channel) => { channel.enabled = false; });
  config.channels['ang_vel.0'] = {
    enabled: true,
    sourceId: 'a2a.rotacc.x',
    inputUnit: 'radps2',
    operation: 'direct',
    scale: 1,
    offset: 0
  };
  const result = new RouterCore(config).update({ 'a2a.rotacc.x': 3 }, 0);
  assert.match(result.errors['ang_vel.0'], /cannot be converted/);
});
