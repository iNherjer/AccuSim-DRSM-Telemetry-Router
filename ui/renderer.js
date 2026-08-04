'use strict';

const elements = Object.fromEntries([
  'versionLine', 'processBadge', 'simDot', 'simStatus', 'udpDot', 'udpStatus',
  'sampleRate', 'packetCount', 'nameInput', 'hostInput', 'portInput', 'periodSelect',
  'saveStatus', 'startButton', 'stopButton', 'disableAllButton', 'resetButton',
  'recordButton', 'stopRecordButton', 'recordingDetail',
  'openFolderButton', 'runtimeDetail', 'filterInput', 'mappingGroups',
  'customSourceForm', 'customLabelInput', 'customVarInput', 'customUnitSelect',
  'customSourceList', 'packetPreview', 'packetSummary', 'expertToggleButton',
  'rawToggleButton', 'viewHint', 'customSourcesPanel', 'packetPanel',
  'updateCheckButton', 'updateBanner', 'updateTitle', 'updateMessage',
  'updateProgressWrap', 'updateProgress', 'downloadUpdateButton',
  'skipUpdateButton', 'restartUpdateButton', 'gravityEnabledInput',
  'gravityStrengthInput', 'gravityVectorLive', 'attitudeMixEnabledInput',
  'attitudeMixPitchInput', 'attitudeMixRollInput', 'attitudeMixVectorLive',
  'rotationCorrectionEnabledInput', 'rotationCorrectionTauInput',
  'rotationWashoutEnabledInput', 'rotationWashoutTauInput',
  'rotationReferenceLive', 'rotationWashoutLive',
  'turbulenceEnabledInput',
  'turbulenceSourceSelect', 'turbulenceMixInput', 'turbulenceGainInput',
  'turbulenceLowCutInput', 'turbulenceHighCutInput', 'turbulenceMaxExtraInput',
  'turbulenceWindEnabledInput', 'turbulenceWindSourceSelect',
  'turbulenceWindMixInput', 'turbulenceWindGainInput', 'turbulenceWindInvertInput',
  'turbulenceSourceLive', 'turbulenceBandLive', 'turbulenceExtraLive',
  'turbulenceWindSourceLive', 'turbulenceWindBandLive', 'turbulenceWindExtraLive',
  'turbulenceFinalLive', 'turbulenceStatus', 'turbulencePresetState',
  'languageSelect'
].map((id) => [id, document.getElementById(id)]));

let state = null;
let draftConfig = null;
let renderedRevision = 0;
let saveTimer = null;
let saveSequence = 0;

function language() {
  return draftConfig?.language === 'en' ? 'en' : 'de';
}

function t(key, variables = {}) {
  const table = state?.translations?.[language()] || state?.translations?.de || {};
  const fallback = state?.translations?.de?.[key] || key;
  const template = table[key] ?? fallback;
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name) => (
    Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : `{${name}}`
  ));
}

function localizedLabel(definition) {
  if (!definition) return '';
  return language() === 'en'
    ? (definition.labelEn || definition.label || '')
    : (definition.labelDe || definition.label || definition.labelEn || '');
}

function localizedHelp(output) {
  return language() === 'en' ? output.helpEn : output.helpDe;
}

function localizedGroup(group) {
  return state?.catalog?.groupLabels?.[group]?.[language()] || group || t('mapping.other');
}

function locale() {
  return language() === 'en' ? 'en-US' : 'de-DE';
}

function applyStaticTranslations() {
  document.documentElement.lang = language();
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll('[data-i18n-title]')) {
    element.title = t(element.dataset.i18nTitle);
  }
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }
  for (const element of document.querySelectorAll('[data-i18n-aria]')) {
    element.setAttribute('aria-label', t(element.dataset.i18nAria));
  }
  for (const element of document.querySelectorAll('[data-i18n-tooltip]')) {
    const text = t(element.dataset.i18nTooltip);
    element.dataset.tooltip = text;
    element.setAttribute('aria-label', text);
    element.title = text;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function numberText(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (Math.abs(number) >= 10000) return number.toFixed(0);
  if (Math.abs(number) >= 1000) return number.toFixed(1);
  if (Math.abs(number) >= 10) return number.toFixed(3);
  return number.toFixed(digits);
}

function setStateClass(element, base, value) {
  element.className = `${base} ${value || 'waiting'}`;
}

function groupBy(items, key) {
  const result = new Map();
  for (const item of items) {
    const group = item[key] || 'Sonstige';
    if (!result.has(group)) result.set(group, []);
    result.get(group).push(item);
  }
  return result;
}

function appendSourceOption(parent, source, selectedId, prefix = '') {
  const option = document.createElement('option');
  option.value = source.id;
  option.textContent = source.simVar?.startsWith('L:')
    ? `${prefix}${source.simVar} — ${localizedLabel(source)}`
    : `${prefix}${localizedLabel(source)}${source.simVar ? ` · ${source.simVar}` : ''}`;
  option.selected = source.id === selectedId;
  parent.appendChild(option);
}

function compatibleOperationIds(inputUnitId, targetUnitId) {
  const inputFamily = state.catalog.units[inputUnitId]?.family;
  const outputFamily = state.catalog.units[targetUnitId]?.family;
  return state.catalog.operationCompatibility?.[inputFamily]?.[outputFamily] || [];
}

function safeOperationIds(inputUnitId, targetUnitId) {
  const inputFamily = state.catalog.units[inputUnitId]?.family;
  const outputFamily = state.catalog.units[targetUnitId]?.family;
  return state.catalog.safeOperationCompatibility?.[inputFamily]?.[outputFamily] || [];
}

function groupedSourceOptions(sources, selectedId) {
  const groups = groupBy(sources, 'group');
  const fragment = document.createDocumentFragment();
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = t('mapping.none');
  fragment.appendChild(empty);
  for (const [group, sources] of groups) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = localizedGroup(group);
    for (const source of sources) {
      appendSourceOption(optgroup, source, selectedId);
    }
    fragment.appendChild(optgroup);
  }
  return fragment;
}

function expertSourceOptions(output, selectedId) {
  if (draftConfig.unsafeMode) return groupedSourceOptions(state.catalog.sources, selectedId);
  const safeBuiltinIds = new Set(state.catalog.safeSourceIds?.[output.id] || []);
  const sources = state.catalog.sources.filter((source) => {
    const isCustom = source.group === 'Eigene LVars' || source.id.startsWith('custom.');
    return (isCustom || safeBuiltinIds.has(source.id)) &&
      safeOperationIds(source.inputUnit, output.targetUnit).length > 0;
  });
  const fragment = groupedSourceOptions(sources, selectedId);
  const allowedIds = new Set(sources.map((source) => source.id));
  if (selectedId && !allowedIds.has(selectedId)) {
    const selectedSource = state.catalog.sources.find((entry) => entry.id === selectedId);
    if (selectedSource) {
      const group = document.createElement('optgroup');
      group.label = t('mapping.currentRaw');
      appendSourceOption(group, selectedSource, selectedId);
      fragment.appendChild(group);
    }
  }
  return fragment;
}

function simpleSourceOptions(output, selectedId) {
  const fragment = document.createDocumentFragment();
  const allowedIds = new Set((output.simpleSources || []).map((entry) => entry.sourceId));
  for (const rule of output.simpleSources || []) {
    const source = state.catalog.sources.find((entry) => entry.id === rule.sourceId);
    if (!source) continue;
    const prefix = source.id.startsWith('a2a.') ? t('mapping.a2aPrefix') : t('mapping.standardPrefix');
    appendSourceOption(fragment, source, selectedId, prefix);
  }

  if (selectedId && !allowedIds.has(selectedId)) {
    const selectedSource = state.catalog.sources.find((entry) => entry.id === selectedId);
    if (selectedSource) {
      const group = document.createElement('optgroup');
      group.label = t('mapping.currentExpert');
      appendSourceOption(group, selectedSource, selectedId);
      fragment.appendChild(group);
    }
  }
  return fragment;
}

function sourceOptions(output, selectedId) {
  return draftConfig.expertMode
    ? expertSourceOptions(output, selectedId)
    : simpleSourceOptions(output, selectedId);
}

function unitOptions(selectedId, allowedFamily = '') {
  const fragment = document.createDocumentFragment();
  for (const [id, definition] of Object.entries(state.catalog.units)) {
    if (allowedFamily && definition.family !== allowedFamily) continue;
    const option = document.createElement('option');
    option.value = id;
    option.textContent = localizedLabel(definition);
    option.selected = id === selectedId;
    fragment.appendChild(option);
  }
  if (selectedId && allowedFamily && state.catalog.units[selectedId]?.family !== allowedFamily) {
    const option = document.createElement('option');
    option.value = selectedId;
    option.textContent = `${localizedLabel(state.catalog.units[selectedId]) || selectedId} · Raw`;
    option.selected = true;
    fragment.appendChild(option);
  }
  return fragment;
}

function operationOptions(selectedId, allowedIds = null) {
  const fragment = document.createDocumentFragment();
  for (const operation of state.catalog.operations) {
    if (allowedIds && !allowedIds.includes(operation.id)) continue;
    const option = document.createElement('option');
    option.value = operation.id;
    option.textContent = localizedLabel(operation);
    option.selected = operation.id === selectedId;
    fragment.appendChild(option);
  }
  if (selectedId && allowedIds && !allowedIds.includes(selectedId)) {
    const operation = state.catalog.operations.find((entry) => entry.id === selectedId);
    const option = document.createElement('option');
    option.value = selectedId;
    option.textContent = `${localizedLabel(operation) || selectedId} · ${t('mapping.incompatible')}`;
    option.selected = true;
    fragment.appendChild(option);
  }
  return fragment;
}

function mappingUnitOptions(output, source, selectedId) {
  if (!draftConfig.expertMode || draftConfig.unsafeMode) return unitOptions(selectedId);
  const family = state.catalog.units[source?.inputUnit]?.family || state.catalog.units[output.targetUnit]?.family;
  return unitOptions(selectedId, family);
}

function mappingOperationOptions(output, inputUnitId, selectedId) {
  if (!draftConfig.expertMode || draftConfig.unsafeMode) return operationOptions(selectedId);
  return operationOptions(selectedId, safeOperationIds(inputUnitId, output.targetUnit));
}

function updateChannel(outputId, patch) {
  draftConfig.channels[outputId] = { ...draftConfig.channels[outputId], ...patch };
  queueSave();
}

function makeMappingRow(output) {
  const channel = draftConfig.channels[output.id];
  const row = document.createElement('div');
  row.className = `mapping-row${channel.enabled ? '' : ' disabled'}`;
  row.dataset.outputId = output.id;
  row.dataset.search = `${output.group} ${localizedGroup(output.group)} ${output.labelDe} ${output.labelEn} ${output.id}`.toLowerCase();

  const enable = document.createElement('input');
  enable.type = 'checkbox';
  enable.checked = channel.enabled;
  enable.className = 'channel-toggle';
  enable.title = t('mapping.enableTooltip');
  enable.setAttribute('aria-label', `${output.id}: ${t('mapping.enableTooltip')}`);
  enable.addEventListener('change', () => {
    row.classList.toggle('disabled', !enable.checked);
    updateChannel(output.id, { enabled: enable.checked });
  });

  const sourceSelect = document.createElement('select');
  sourceSelect.className = 'source-select';
  sourceSelect.appendChild(sourceOptions(output, channel.sourceId));
  sourceSelect.title = `${t('mapping.sourceTooltip')}\n${sourceSelect.selectedOptions[0]?.textContent || ''}`;
  sourceSelect.addEventListener('change', () => {
    const selectedSource = state.catalog.sources.find((entry) => entry.id === sourceSelect.value);
    const simpleRule = output.simpleSources?.find((entry) => entry.sourceId === sourceSelect.value);
    const nextInputUnit = selectedSource?.inputUnit || unitSelect.value;
    const compatibleOperations = safeOperationIds(nextInputUnit, output.targetUnit);
    let nextOperation = operationSelect.value;
    if (!draftConfig.expertMode && simpleRule?.operation) nextOperation = simpleRule.operation;
    if (draftConfig.expertMode && !draftConfig.unsafeMode && !compatibleOperations.includes(nextOperation)) {
      nextOperation = compatibleOperations[0] || nextOperation;
    }
    unitSelect.replaceChildren(mappingUnitOptions(output, selectedSource, nextInputUnit));
    unitSelect.value = nextInputUnit;
    operationSelect.replaceChildren(mappingOperationOptions(output, nextInputUnit, nextOperation));
    operationSelect.value = nextOperation;
    sourceSelect.title = `${t('mapping.sourceTooltip')}\n${sourceSelect.selectedOptions[0]?.textContent || ''}`;
    updateChannel(output.id, {
      sourceId: sourceSelect.value,
      inputUnit: nextInputUnit,
      operation: nextOperation
    });
  });

  const selectedSource = state.catalog.sources.find((entry) => entry.id === channel.sourceId);
  const invert = document.createElement('input');
  invert.type = 'checkbox';
  invert.checked = channel.invert === true;
  invert.className = 'invert-toggle';
  invert.title = t('mapping.invertTooltip');
  invert.setAttribute('aria-label', `${output.id}: ${t('mapping.invertTooltip')}`);
  invert.addEventListener('change', () => updateChannel(output.id, { invert: invert.checked }));

  const unitSelect = document.createElement('select');
  unitSelect.className = 'unit-select expert-only';
  unitSelect.appendChild(mappingUnitOptions(output, selectedSource, channel.inputUnit));
  unitSelect.title = t('mapping.unitTooltip');

  const operationSelect = document.createElement('select');
  operationSelect.className = 'operation-select expert-only';
  operationSelect.appendChild(mappingOperationOptions(output, channel.inputUnit, channel.operation));
  operationSelect.title = t('mapping.operationTooltip');
  operationSelect.addEventListener('change', () => updateChannel(output.id, { operation: operationSelect.value }));
  unitSelect.addEventListener('change', () => {
    const compatibleOperations = safeOperationIds(unitSelect.value, output.targetUnit);
    let nextOperation = operationSelect.value;
    if (draftConfig.expertMode && !draftConfig.unsafeMode && !compatibleOperations.includes(nextOperation)) {
      nextOperation = compatibleOperations[0] || nextOperation;
      operationSelect.replaceChildren(mappingOperationOptions(output, unitSelect.value, nextOperation));
      operationSelect.value = nextOperation;
    }
    updateChannel(output.id, { inputUnit: unitSelect.value, operation: nextOperation });
  });

  const scale = document.createElement('input');
  scale.type = 'number';
  scale.step = 'any';
  scale.value = channel.scale;
  scale.className = 'number-input expert-only';
  scale.title = t('mapping.scaleTooltip');
  scale.addEventListener('change', () => updateChannel(output.id, { scale: Number(scale.value) }));

  const offset = document.createElement('input');
  offset.type = 'number';
  offset.step = 'any';
  offset.value = channel.offset;
  offset.className = 'number-input expert-only';
  offset.title = t('mapping.offsetTooltip');
  offset.addEventListener('change', () => updateChannel(output.id, { offset: Number(offset.value) }));

  const inputLive = document.createElement('output');
  inputLive.className = 'live-value input-live';
  inputLive.dataset.sourceValueFor = output.id;
  inputLive.textContent = '—';
  inputLive.title = t('mapping.inputLiveTooltip');

  const outputLabel = document.createElement('div');
  outputLabel.className = 'output-label';
  const outputCodeRow = document.createElement('div');
  outputCodeRow.className = 'output-code-row';
  const outputCode = document.createElement('strong');
  outputCode.textContent = output.id;
  const help = document.createElement('span');
  help.className = 'help-tip output-help-tip';
  help.tabIndex = 0;
  help.setAttribute('role', 'note');
  help.textContent = '?';
  help.dataset.tooltip = localizedHelp(output);
  help.setAttribute('aria-label', localizedHelp(output));
  help.title = localizedHelp(output);
  outputCodeRow.append(outputCode, help);
  const outputDescription = document.createElement('small');
  outputDescription.textContent = `${localizedLabel(output)} · ${localizedLabel(state.catalog.units[output.targetUnit]) || output.targetUnit}`;
  outputLabel.append(outputCodeRow, outputDescription);

  const outputLive = document.createElement('output');
  outputLive.className = 'live-value output-live';
  outputLive.dataset.outputValueFor = output.id;
  outputLive.textContent = '—';
  outputLive.title = t('mapping.outputLiveTooltip');

  row.append(enable, sourceSelect, invert, unitSelect, operationSelect, scale, offset, inputLive, outputLabel, outputLive);
  return row;
}

function turbulenceSourceOptions(selectedId) {
  const allowedFamilies = new Set(['acceleration', 'velocity']);
  const allowedBuiltinIds = new Set(state.catalog.turbulenceSourceIds || []);
  const sources = state.catalog.sources.filter((source) => {
    const family = state.catalog.units[source.inputUnit]?.family;
    const customSource = source.group === 'Eigene LVars' || source.id.startsWith('custom.');
    return allowedFamilies.has(family) && (customSource || allowedBuiltinIds.has(source.id));
  });
  return groupedSourceOptions(sources, selectedId);
}

function turbulenceWindSourceOptions(selectedId) {
  const allowedBuiltinIds = new Set(state.catalog.turbulenceWindSourceIds || []);
  const sources = state.catalog.sources.filter((source) => {
    const family = state.catalog.units[source.inputUnit]?.family;
    const customSource = source.group === 'Eigene LVars' || source.id.startsWith('custom.');
    return family === 'velocity' && (customSource || allowedBuiltinIds.has(source.id));
  });
  return groupedSourceOptions(sources, selectedId);
}

function activeTurbulencePreset() {
  const config = draftConfig.turbulence || {};
  return (state.catalog.turbulencePresets || []).find((preset) => (
    Math.abs(Number(config.mix) - preset.mix) < 1e-9 &&
    Math.abs(Number(config.gain) - preset.gain) < 1e-9 &&
    Math.abs(Number(config.lowCutHz) - preset.lowCutHz) < 1e-9 &&
    Math.abs(Number(config.highCutHz) - preset.highCutHz) < 1e-9 &&
    Math.abs(Number(config.maxExtraG) - preset.maxExtraG) < 1e-9
  ));
}

function renderTurbulencePresetState() {
  const active = activeTurbulencePreset();
  for (const button of document.querySelectorAll('[data-turbulence-preset]')) {
    const preset = (state.catalog.turbulencePresets || []).find(
      (entry) => entry.id === button.dataset.turbulencePreset
    );
    const label = localizedLabel(preset);
    const description = language() === 'en' ? preset?.descriptionEn : preset?.description;
    button.textContent = label;
    button.title = `${label}: ${description || ''}`;
    button.setAttribute('aria-pressed', String(button.dataset.turbulencePreset === active?.id));
  }
  elements.turbulencePresetState.textContent = active
    ? `${localizedLabel(active)}: ${language() === 'en' ? active.descriptionEn : active.description}`
    : t('turbulence.custom');
}

function renderDynamicsConfig() {
  elements.gravityEnabledInput.checked = draftConfig.gravity?.enabled === true;
  elements.gravityStrengthInput.value = draftConfig.gravity?.strengthG ?? 1;
  elements.attitudeMixEnabledInput.checked = draftConfig.attitudeMix?.enabled === true;
  elements.attitudeMixPitchInput.value = Math.round(Number(draftConfig.attitudeMix?.pitchMix ?? 1) * 100);
  elements.attitudeMixRollInput.value = Math.round(Number(draftConfig.attitudeMix?.rollMix ?? 1) * 100);
  elements.rotationCorrectionEnabledInput.checked = draftConfig.rotationFusion?.correctionEnabled === true;
  elements.rotationCorrectionTauInput.value = draftConfig.rotationFusion?.correctionTauSeconds ?? 1.25;
  elements.rotationWashoutEnabledInput.checked = draftConfig.rotationFusion?.residualWashoutEnabled === true;
  elements.rotationWashoutTauInput.value = draftConfig.rotationFusion?.residualWashoutTauSeconds ?? 6;
  elements.turbulenceEnabledInput.checked = draftConfig.turbulence?.enabled === true;
  elements.turbulenceSourceSelect.replaceChildren(
    turbulenceSourceOptions(draftConfig.turbulence?.sourceId || 'a2a.acc.y')
  );
  elements.turbulenceSourceSelect.value = draftConfig.turbulence?.sourceId || 'a2a.acc.y';
  elements.turbulenceSourceSelect.title = `${t('tooltip.turbulenceSource')}\n${elements.turbulenceSourceSelect.selectedOptions[0]?.textContent || ''}`;
  elements.turbulenceMixInput.value = Math.round(Number(draftConfig.turbulence?.mix ?? 0.5) * 100);
  elements.turbulenceGainInput.value = draftConfig.turbulence?.gain ?? 2.5;
  elements.turbulenceLowCutInput.value = draftConfig.turbulence?.lowCutHz ?? 0.7;
  elements.turbulenceHighCutInput.value = draftConfig.turbulence?.highCutHz ?? 5;
  elements.turbulenceMaxExtraInput.value = draftConfig.turbulence?.maxExtraG ?? 0.2;
  elements.turbulenceWindEnabledInput.checked = draftConfig.turbulence?.windEnabled === true;
  elements.turbulenceWindSourceSelect.replaceChildren(
    turbulenceWindSourceOptions(draftConfig.turbulence?.windSourceId || 'std.wind.aircraft.y')
  );
  elements.turbulenceWindSourceSelect.value = draftConfig.turbulence?.windSourceId || 'std.wind.aircraft.y';
  elements.turbulenceWindSourceSelect.title = `${t('tooltip.turbulenceWindSource')}\n${elements.turbulenceWindSourceSelect.selectedOptions[0]?.textContent || ''}`;
  elements.turbulenceWindMixInput.value = Math.round(Number(draftConfig.turbulence?.windMix ?? 0.25) * 100);
  elements.turbulenceWindGainInput.value = draftConfig.turbulence?.windGain ?? 1;
  elements.turbulenceWindInvertInput.checked = draftConfig.turbulence?.windInvert === true;
  renderTurbulencePresetState();
}

function renderMappings() {
  elements.mappingGroups.replaceChildren();
  const visibleOutputs = draftConfig.expertMode
    ? state.catalog.outputs
    : state.catalog.outputs.filter((output) => output.basic);
  const groups = groupBy(visibleOutputs, 'group');
  for (const [group, outputs] of groups) {
    const section = document.createElement('details');
    section.className = 'mapping-group';
    section.open = !draftConfig.expertMode || ['Motion', 'Aerodynamics', 'Engine', 'Gear & Surfaces'].includes(group);
    const summary = document.createElement('summary');
    const enabledCount = outputs.filter((output) => draftConfig.channels[output.id]?.enabled).length;
    const groupLabel = document.createElement('span');
    groupLabel.textContent = localizedGroup(group);
    const countLabel = document.createElement('small');
    countLabel.textContent = t('mapping.count', { enabled: enabledCount, total: outputs.length });
    summary.append(groupLabel, countLabel);
    section.appendChild(summary);
    const body = document.createElement('div');
    body.className = 'mapping-group-body';
    outputs.forEach((output) => body.appendChild(makeMappingRow(output)));
    section.appendChild(body);
    elements.mappingGroups.appendChild(section);
  }
  applyFilter();
}

function applyViewMode() {
  const expertMode = draftConfig.expertMode === true;
  const unsafeMode = expertMode && draftConfig.unsafeMode === true;
  document.body.classList.toggle('expert-mode', expertMode);
  document.body.classList.toggle('raw-mode', unsafeMode);
  elements.expertToggleButton.setAttribute('aria-pressed', String(expertMode));
  elements.expertToggleButton.querySelector('small').textContent = expertMode ? t('mapping.on') : t('mapping.off');
  elements.rawToggleButton.setAttribute('aria-pressed', String(unsafeMode));
  elements.rawToggleButton.querySelector('small').textContent = unsafeMode ? t('mapping.on') : t('mapping.off');
  elements.viewHint.textContent = unsafeMode
    ? t('mapping.rawHint')
    : (expertMode
        ? t('mapping.expertHint')
        : t('mapping.basicHint'));
  elements.filterInput.placeholder = expertMode
    ? t('mapping.filterExpert')
    : t('mapping.filterBasic');
}

function renderCustomSources() {
  elements.customUnitSelect.replaceChildren(unitOptions('number'));
  const customSources = draftConfig.customSources || [];
  elements.customSourceList.replaceChildren();
  if (!customSources.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = t('custom.empty');
    elements.customSourceList.appendChild(empty);
    return;
  }
  for (const source of customSources) {
    const row = document.createElement('div');
    row.className = 'custom-source-row';
    const description = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = source.label;
    const variable = document.createElement('code');
    variable.textContent = source.simVar;
    const unit = document.createElement('small');
    unit.textContent = localizedLabel(state.catalog.units[source.inputUnit]) || source.inputUnit;
    description.append(name, variable, unit);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-button';
    remove.textContent = t('custom.remove');
    remove.addEventListener('click', () => {
      draftConfig.customSources = draftConfig.customSources.filter((entry) => entry.id !== source.id);
      for (const channel of Object.values(draftConfig.channels)) {
        if (channel.sourceId === source.id) channel.sourceId = '';
      }
      queueSave(true);
    });
    row.append(description, remove);
    elements.customSourceList.appendChild(row);
  }
}

function renderConfig() {
  elements.languageSelect.value = language();
  applyStaticTranslations();
  elements.nameInput.value = draftConfig.name;
  elements.hostInput.value = draftConfig.host;
  elements.portInput.value = draftConfig.port;
  elements.periodSelect.value = draftConfig.period;
  renderDynamicsConfig();
  applyViewMode();
  renderMappings();
  renderCustomSources();
}

function applyFilter() {
  const query = elements.filterInput.value.trim().toLowerCase();
  for (const row of document.querySelectorAll('.mapping-row')) {
    row.hidden = Boolean(query) && !row.dataset.search.includes(query);
  }
  for (const group of document.querySelectorAll('.mapping-group')) {
    const visible = [...group.querySelectorAll('.mapping-row')].some((row) => !row.hidden);
    group.hidden = !visible;
    if (query && visible) group.open = true;
  }
}

function queueSave(forceRender = false) {
  elements.saveStatus.textContent = t('connection.saving');
  elements.saveStatus.className = 'save-status saving';
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const sequence = ++saveSequence;
    let result;
    try {
      result = await window.accusimRouter.saveConfig(draftConfig);
    } catch (error) {
      result = { ok: false, message: error?.message || String(error) };
    }
    if (sequence !== saveSequence) return;
    if (!result?.ok) {
      elements.saveStatus.textContent = result?.message || t('connection.saveError');
      elements.saveStatus.className = 'save-status error';
      return;
    }
    draftConfig = clone(result.config);
    renderedRevision = result.configRevision;
    elements.saveStatus.textContent = t('connection.saved');
    elements.saveStatus.className = 'save-status';
    if (forceRender) renderConfig();
  }, 300);
}

function renderLive(runtime = {}) {
  const runtimeDetail = runtime.detailKey ? t(runtime.detailKey, runtime.detailArgs || {}) : runtime.detail;
  const runtimeError = runtime.lastErrorKey ? t(runtime.lastErrorKey, runtime.lastErrorArgs || {}) : runtime.lastError;
  const running = runtime.process === 'running';
  setStateClass(elements.processBadge, 'badge', running ? 'running' : 'waiting');
  elements.processBadge.textContent = running ? t('status.active') : t('status.ready');
  setStateClass(elements.simDot, 'status-dot', runtime.simulator || 'waiting');
  elements.simStatus.textContent = {
    connected: t('status.connected'),
    connecting: t('status.connecting'),
    waiting: t('status.disconnected'),
    error: t('status.error')
  }[runtime.simulator] || t('status.disconnected');
  setStateClass(elements.udpDot, 'status-dot', runtime.udp === 'active' ? 'connected' : runtime.udp || 'waiting');
  elements.udpStatus.textContent = runtime.udp === 'active'
    ? `${draftConfig.host}:${draftConfig.port}`
    : (runtime.udp === 'error' ? t('status.error') : t('status.stopped'));
  elements.sampleRate.textContent = `${Number(runtime.sampleHz || 0).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Hz`;
  elements.packetCount.textContent = Number(runtime.packets || 0).toLocaleString(locale());
  elements.runtimeDetail.textContent = runtimeError
    ? `${runtimeDetail || ''} · ${runtimeError}`
    : (runtimeDetail || t('runtime.bridgeNotStarted'));
  elements.runtimeDetail.classList.toggle('error', Boolean(runtimeError));
  elements.startButton.disabled = running;
  elements.stopButton.disabled = !running;
  const recording = runtime.recording || {};
  elements.recordButton.disabled = !running || recording.active === true;
  elements.stopRecordButton.disabled = recording.active !== true;
  elements.recordButton.classList.toggle('recording', recording.active === true);
  elements.recordingDetail.classList.toggle('error', Boolean(recording.error));
  elements.recordingDetail.textContent = recording.error
    ? t('recording.error', { error: recording.error })
    : (recording.active
        ? t('recording.active', { rows: Number(recording.rows || 0).toLocaleString(locale()), path: recording.path || '' })
        : (recording.path ? t('recording.saved', { path: recording.path }) : t('recording.off')));

  const diagnostics = runtime.diagnostics || {};
  const gravityVector = diagnostics.gravity?.vectorG || (draftConfig.gravity?.enabled
    ? [0, 0, Number(draftConfig.gravity?.strengthG ?? 1)]
    : [0, 0, 0]);
  elements.gravityVectorLive.textContent = `[${gravityVector.map((value) => numberText(value, 3)).join(', ')}] g`;
  const attitudeMixVector = diagnostics.attitudeMix?.vectorG || [0, 0, 0];
  elements.attitudeMixVectorLive.textContent = `[${attitudeMixVector.slice(0, 2).map((value) => numberText(value, 3)).join(', ')}] g`;
  const angularReference = diagnostics.angularReference?.filteredRates || [0, 0, 0];
  elements.rotationReferenceLive.textContent = `[${angularReference.map((value) => numberText(value, 4)).join(', ')}] rad/s`;
  const fusionAxes = ['Pitch', 'Roll', 'Yaw'];
  const washoutAxes = fusionAxes.filter((_axis, index) => (
    diagnostics.angularFusion?.[`ang_vel.${index}`]?.washoutActive === true
  ));
  elements.rotationWashoutLive.textContent = washoutAxes.length
    ? t('rotationFusion.activeAxes', { axes: washoutAxes.join(', ') })
    : t('rotationFusion.inactive');
  const turbulence = diagnostics.turbulence || {};
  const turbulenceWind = turbulence.wind || {};
  elements.turbulenceSourceLive.textContent = `${numberText(turbulence.sourceG, 4)} g`;
  elements.turbulenceBandLive.textContent = `${numberText(turbulence.bandG, 4)} g`;
  elements.turbulenceExtraLive.textContent = `${numberText(turbulence.extraG, 4)} g`;
  elements.turbulenceWindSourceLive.textContent = `${numberText(turbulenceWind.sourceG, 4)} g`;
  elements.turbulenceWindBandLive.textContent = `${numberText(turbulenceWind.bandG, 4)} g`;
  elements.turbulenceWindExtraLive.textContent = `${numberText(turbulenceWind.extraG, 4)} g`;
  elements.turbulenceFinalLive.textContent = diagnostics.accelerationG
    ? `${numberText(diagnostics.accelerationG[2], 4)} g`
    : '—';
  const turbulenceError = runtime.channelErrors?.turbulence || '';
  elements.turbulenceStatus.classList.toggle('error', Boolean(turbulenceError));
  elements.turbulenceStatus.textContent = turbulenceError || (draftConfig.turbulence?.enabled
    ? t('turbulence.on', {
        limit: turbulence.limited ? t('turbulence.limited') : '',
        low: numberText(draftConfig.turbulence.lowCutHz, 2),
        high: numberText(draftConfig.turbulence.highCutHz, 2)
      })
    : t('turbulence.off'));

  for (const output of state.catalog.outputs) {
    const channel = draftConfig.channels[output.id];
    const sourceValueElement = document.querySelector(`[data-source-value-for="${CSS.escape(output.id)}"]`);
    if (sourceValueElement) sourceValueElement.textContent = numberText(runtime.sourceValues?.[channel?.sourceId]);
    const outputValueElement = document.querySelector(`[data-output-value-for="${CSS.escape(output.id)}"]`);
    if (outputValueElement) {
      outputValueElement.textContent = channel?.enabled ? numberText(runtime.outputValues?.[output.id]) : t('mapping.disabledValue');
      const error = runtime.channelErrors?.[output.id] || '';
      outputValueElement.classList.toggle('error', Boolean(error));
      outputValueElement.title = error;
      outputValueElement.closest('.mapping-row')?.classList.toggle('mapping-error', Boolean(error));
    }
  }

  if (runtime.packetPreview) {
    elements.packetPreview.textContent = JSON.stringify(runtime.packetPreview, null, 2);
    elements.packetSummary.textContent = t('packet.summary', {
      fields: Object.keys(runtime.packetPreview).length,
      packets: runtime.packets || 0
    });
  } else {
    elements.packetPreview.textContent = t('packet.waiting');
    elements.packetSummary.textContent = t('packet.none');
  }
}

function renderUpdate(update = {}) {
  const phase = String(update.phase || 'development');
  const supported = update.supported === true;
  const busy = ['checking', 'downloading', 'installing'].includes(phase);
  const visible = ['available', 'downloading', 'ready', 'installing'].includes(phase);
  const version = update.version || '';

  elements.updateCheckButton.disabled = !supported || busy || phase === 'ready';
  elements.updateCheckButton.textContent = {
    checking: t('update.checking'),
    current: t('update.currentShort'),
    available: t('update.availableShort', { version }),
    downloading: t('update.downloadingShort', { percent: Math.round(Number(update.percent) || 0) }),
    ready: t('update.readyShort'),
    installing: t('update.installingShort'),
    error: t('update.retry'),
    skipped: t('update.check')
  }[phase] || (supported ? t('update.check') : t('update.portable'));

  elements.updateBanner.hidden = !visible;
  elements.updateBanner.className = `update-banner ${phase}`;
  elements.updateTitle.textContent = phase === 'ready'
    ? t('update.readyTitle', { version })
    : (phase === 'downloading'
        ? t('update.downloadingTitle', { version })
        : t('update.availableVersionTitle', { version }));
  elements.updateMessage.textContent = update.messageKey
    ? t(update.messageKey, update.messageArgs || {})
    : (update.message || '');
  elements.updateProgressWrap.hidden = !['downloading', 'ready', 'installing'].includes(phase);
  elements.updateProgress.style.width = `${Math.max(0, Math.min(100, Number(update.percent) || 0))}%`;
  elements.downloadUpdateButton.hidden = phase !== 'available';
  elements.skipUpdateButton.hidden = phase !== 'available';
  elements.restartUpdateButton.hidden = phase !== 'ready';
}

function render(nextState) {
  state = nextState;
  if (!draftConfig || state.configRevision !== renderedRevision) {
    draftConfig = clone(state.config);
    renderedRevision = state.configRevision;
    renderConfig();
  }
  elements.versionLine.textContent = t('app.versionLine', { version: state.appVersion || '–' });
  renderLive(state.runtime || {});
  renderUpdate(state.update || {});
}

function bindConfigInput(element, key, parser = (value) => value) {
  element.addEventListener('change', () => {
    draftConfig[key] = parser(element.value);
    queueSave();
  });
}

bindConfigInput(elements.nameInput, 'name', (value) => value.trim());
bindConfigInput(elements.hostInput, 'host', (value) => value.trim());
bindConfigInput(elements.portInput, 'port', Number);
bindConfigInput(elements.periodSelect, 'period');

elements.languageSelect.addEventListener('change', () => {
  if (!draftConfig) return;
  draftConfig.language = elements.languageSelect.value === 'en' ? 'en' : 'de';
  renderConfig();
  renderLive(state.runtime || {});
  renderUpdate(state.update || {});
  queueSave();
});

function bindNestedCheckbox(element, section, key) {
  element.addEventListener('change', () => {
    draftConfig[section][key] = element.checked;
    if (section === 'turbulence') renderTurbulencePresetState();
    queueSave();
  });
}

function bindNestedNumber(element, section, key, transform = Number) {
  element.addEventListener('change', () => {
    draftConfig[section][key] = transform(element.value);
    if (section === 'turbulence') renderTurbulencePresetState();
    queueSave();
  });
}

bindNestedCheckbox(elements.gravityEnabledInput, 'gravity', 'enabled');
bindNestedNumber(elements.gravityStrengthInput, 'gravity', 'strengthG');
bindNestedCheckbox(elements.attitudeMixEnabledInput, 'attitudeMix', 'enabled');
bindNestedNumber(elements.attitudeMixPitchInput, 'attitudeMix', 'pitchMix', (value) => Number(value) / 100);
bindNestedNumber(elements.attitudeMixRollInput, 'attitudeMix', 'rollMix', (value) => Number(value) / 100);
bindNestedCheckbox(elements.rotationCorrectionEnabledInput, 'rotationFusion', 'correctionEnabled');
bindNestedNumber(elements.rotationCorrectionTauInput, 'rotationFusion', 'correctionTauSeconds');
bindNestedCheckbox(elements.rotationWashoutEnabledInput, 'rotationFusion', 'residualWashoutEnabled');
bindNestedNumber(elements.rotationWashoutTauInput, 'rotationFusion', 'residualWashoutTauSeconds');
bindNestedCheckbox(elements.turbulenceEnabledInput, 'turbulence', 'enabled');
elements.turbulenceSourceSelect.addEventListener('change', () => {
  draftConfig.turbulence.sourceId = elements.turbulenceSourceSelect.value;
  elements.turbulenceSourceSelect.title = `${t('tooltip.turbulenceSource')}\n${elements.turbulenceSourceSelect.selectedOptions[0]?.textContent || ''}`;
  queueSave();
});
bindNestedNumber(elements.turbulenceMixInput, 'turbulence', 'mix', (value) => Number(value) / 100);
bindNestedNumber(elements.turbulenceGainInput, 'turbulence', 'gain');
bindNestedNumber(elements.turbulenceLowCutInput, 'turbulence', 'lowCutHz');
bindNestedNumber(elements.turbulenceHighCutInput, 'turbulence', 'highCutHz');
bindNestedNumber(elements.turbulenceMaxExtraInput, 'turbulence', 'maxExtraG');
bindNestedCheckbox(elements.turbulenceWindEnabledInput, 'turbulence', 'windEnabled');
elements.turbulenceWindSourceSelect.addEventListener('change', () => {
  draftConfig.turbulence.windSourceId = elements.turbulenceWindSourceSelect.value;
  elements.turbulenceWindSourceSelect.title = `${t('tooltip.turbulenceWindSource')}\n${elements.turbulenceWindSourceSelect.selectedOptions[0]?.textContent || ''}`;
  queueSave();
});
bindNestedNumber(elements.turbulenceWindMixInput, 'turbulence', 'windMix', (value) => Number(value) / 100);
bindNestedNumber(elements.turbulenceWindGainInput, 'turbulence', 'windGain');
bindNestedCheckbox(elements.turbulenceWindInvertInput, 'turbulence', 'windInvert');

for (const button of document.querySelectorAll('[data-turbulence-preset]')) {
  button.addEventListener('click', () => {
    const preset = (state.catalog.turbulencePresets || []).find(
      (entry) => entry.id === button.dataset.turbulencePreset
    );
    if (!preset) return;
    Object.assign(draftConfig.turbulence, {
      enabled: true,
      mix: preset.mix,
      gain: preset.gain,
      lowCutHz: preset.lowCutHz,
      highCutHz: preset.highCutHz,
      maxExtraG: preset.maxExtraG
    });
    renderDynamicsConfig();
    queueSave();
  });
}

elements.startButton.addEventListener('click', () => window.accusimRouter.start());
elements.stopButton.addEventListener('click', () => window.accusimRouter.stop());
elements.recordButton.addEventListener('click', () => window.accusimRouter.startRecording());
elements.stopRecordButton.addEventListener('click', () => window.accusimRouter.stopRecording());
elements.updateCheckButton.addEventListener('click', () => window.accusimRouter.checkForUpdates());
elements.downloadUpdateButton.addEventListener('click', () => window.accusimRouter.downloadUpdate());
elements.skipUpdateButton.addEventListener('click', () => window.accusimRouter.skipUpdate());
elements.restartUpdateButton.addEventListener('click', () => {
  const version = state?.update?.version || t('confirm.newVersion');
  if (!window.confirm(t('confirm.install', { version }))) return;
  window.accusimRouter.installUpdate();
});
elements.openFolderButton.addEventListener('click', () => window.accusimRouter.openDataFolder());
elements.filterInput.addEventListener('input', applyFilter);
elements.expertToggleButton.addEventListener('click', () => {
  if (!draftConfig) return;
  draftConfig.expertMode = !draftConfig.expertMode;
  applyViewMode();
  renderMappings();
  queueSave();
});
elements.rawToggleButton.addEventListener('click', () => {
  if (!draftConfig?.expertMode) return;
  draftConfig.unsafeMode = !draftConfig.unsafeMode;
  applyViewMode();
  renderMappings();
  queueSave();
});

elements.disableAllButton.addEventListener('click', () => {
  if (!window.confirm(t('confirm.disableAll'))) return;
  Object.values(draftConfig.channels).forEach((channel) => { channel.enabled = false; });
  renderMappings();
  queueSave();
});

elements.resetButton.addEventListener('click', async () => {
  if (!window.confirm(t('confirm.reset'))) return;
  const result = await window.accusimRouter.resetConfig();
  if (result?.ok) {
    draftConfig = clone(result.config);
    renderedRevision = result.configRevision;
    renderConfig();
  }
});

elements.customSourceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const label = elements.customLabelInput.value.trim();
  const simVar = elements.customVarInput.value.trim();
  if (!label || !simVar) return;
  const id = `custom.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
  draftConfig.customSources.push({
    id,
    group: 'Eigene LVars',
    label,
    simVar,
    simConnectUnit: 'number',
    inputUnit: elements.customUnitSelect.value
  });
  elements.customLabelInput.value = '';
  elements.customVarInput.value = '';
  queueSave(true);
});

window.accusimRouter.onStateChanged(render);
window.accusimRouter.getState().then(render);
