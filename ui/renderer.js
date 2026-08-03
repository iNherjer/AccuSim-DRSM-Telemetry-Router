'use strict';

const elements = Object.fromEntries([
  'versionLine', 'processBadge', 'simDot', 'simStatus', 'udpDot', 'udpStatus',
  'sampleRate', 'packetCount', 'nameInput', 'hostInput', 'portInput', 'periodSelect',
  'saveStatus', 'startButton', 'stopButton', 'disableAllButton', 'resetButton',
  'openFolderButton', 'runtimeDetail', 'filterInput', 'mappingGroups',
  'customSourceForm', 'customLabelInput', 'customVarInput', 'customUnitSelect',
  'customSourceList', 'packetPreview', 'packetSummary', 'expertToggleButton',
  'viewHint', 'customSourcesPanel', 'packetPanel'
].map((id) => [id, document.getElementById(id)]));

let state = null;
let draftConfig = null;
let renderedRevision = 0;
let saveTimer = null;
let saveSequence = 0;

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
    ? `${prefix}${source.simVar} — ${source.label}`
    : `${prefix}${source.label}${source.simVar ? ` · ${source.simVar}` : ''}`;
  option.selected = source.id === selectedId;
  parent.appendChild(option);
}

function expertSourceOptions(selectedId) {
  const groups = groupBy(state.catalog.sources, 'group');
  const fragment = document.createDocumentFragment();
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '— keine Quelle —';
  fragment.appendChild(empty);
  for (const [group, sources] of groups) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group;
    for (const source of sources) {
      appendSourceOption(optgroup, source, selectedId);
    }
    fragment.appendChild(optgroup);
  }
  return fragment;
}

function simpleSourceOptions(output, selectedId) {
  const fragment = document.createDocumentFragment();
  const allowedIds = new Set((output.simpleSources || []).map((entry) => entry.sourceId));
  for (const rule of output.simpleSources || []) {
    const source = state.catalog.sources.find((entry) => entry.id === rule.sourceId);
    if (!source) continue;
    const prefix = source.id.startsWith('a2a.') ? 'A2A AccuSim · ' : 'Standard MSFS · ';
    appendSourceOption(fragment, source, selectedId, prefix);
  }

  if (selectedId && !allowedIds.has(selectedId)) {
    const selectedSource = state.catalog.sources.find((entry) => entry.id === selectedId);
    if (selectedSource) {
      const group = document.createElement('optgroup');
      group.label = 'Aktuelle Expertenzuordnung';
      appendSourceOption(group, selectedSource, selectedId);
      fragment.appendChild(group);
    }
  }
  return fragment;
}

function sourceOptions(output, selectedId) {
  return draftConfig.expertMode
    ? expertSourceOptions(selectedId)
    : simpleSourceOptions(output, selectedId);
}

function unitOptions(selectedId) {
  const fragment = document.createDocumentFragment();
  for (const [id, definition] of Object.entries(state.catalog.units)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = definition.label;
    option.selected = id === selectedId;
    fragment.appendChild(option);
  }
  return fragment;
}

function operationOptions(selectedId) {
  const fragment = document.createDocumentFragment();
  for (const operation of state.catalog.operations) {
    const option = document.createElement('option');
    option.value = operation.id;
    option.textContent = operation.label;
    option.selected = operation.id === selectedId;
    fragment.appendChild(option);
  }
  return fragment;
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
  row.dataset.search = `${output.group} ${output.label} ${output.id}`.toLowerCase();

  const enable = document.createElement('input');
  enable.type = 'checkbox';
  enable.checked = channel.enabled;
  enable.className = 'channel-toggle';
  enable.title = 'Kanal ein-/ausschalten';
  enable.addEventListener('change', () => {
    row.classList.toggle('disabled', !enable.checked);
    updateChannel(output.id, { enabled: enable.checked });
  });

  const sourceSelect = document.createElement('select');
  sourceSelect.className = 'source-select';
  sourceSelect.appendChild(sourceOptions(output, channel.sourceId));
  sourceSelect.title = sourceSelect.selectedOptions[0]?.textContent || '';
  sourceSelect.addEventListener('change', () => {
    const selectedSource = state.catalog.sources.find((entry) => entry.id === sourceSelect.value);
    const simpleRule = output.simpleSources?.find((entry) => entry.sourceId === sourceSelect.value);
    unitSelect.value = selectedSource?.inputUnit || unitSelect.value;
    if (!draftConfig.expertMode && simpleRule?.operation) operationSelect.value = simpleRule.operation;
    sourceSelect.title = sourceSelect.selectedOptions[0]?.textContent || '';
    updateChannel(output.id, {
      sourceId: sourceSelect.value,
      inputUnit: unitSelect.value,
      operation: operationSelect.value
    });
  });

  const unitSelect = document.createElement('select');
  unitSelect.className = 'unit-select expert-only';
  unitSelect.appendChild(unitOptions(channel.inputUnit));
  unitSelect.addEventListener('change', () => updateChannel(output.id, { inputUnit: unitSelect.value }));

  const operationSelect = document.createElement('select');
  operationSelect.className = 'operation-select expert-only';
  operationSelect.appendChild(operationOptions(channel.operation));
  operationSelect.addEventListener('change', () => updateChannel(output.id, { operation: operationSelect.value }));

  const scale = document.createElement('input');
  scale.type = 'number';
  scale.step = 'any';
  scale.value = channel.scale;
  scale.className = 'number-input expert-only';
  scale.title = 'Negativer Faktor invertiert das Vorzeichen';
  scale.addEventListener('change', () => updateChannel(output.id, { scale: Number(scale.value) }));

  const offset = document.createElement('input');
  offset.type = 'number';
  offset.step = 'any';
  offset.value = channel.offset;
  offset.className = 'number-input expert-only';
  offset.addEventListener('change', () => updateChannel(output.id, { offset: Number(offset.value) }));

  const inputLive = document.createElement('output');
  inputLive.className = 'live-value input-live';
  inputLive.dataset.sourceValueFor = output.id;
  inputLive.textContent = '—';

  const outputLabel = document.createElement('div');
  outputLabel.className = 'output-label';
  outputLabel.innerHTML = `<strong>${output.id}</strong><small>${output.label} · ${state.catalog.units[output.targetUnit]?.label || output.targetUnit}</small>`;

  const outputLive = document.createElement('output');
  outputLive.className = 'live-value output-live';
  outputLive.dataset.outputValueFor = output.id;
  outputLive.textContent = '—';

  row.append(enable, sourceSelect, unitSelect, operationSelect, scale, offset, inputLive, outputLabel, outputLive);
  return row;
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
    summary.innerHTML = `<span>${group}</span><small>${enabledCount} von ${outputs.length} aktiv</small>`;
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
  document.body.classList.toggle('expert-mode', expertMode);
  elements.expertToggleButton.setAttribute('aria-pressed', String(expertMode));
  elements.expertToggleButton.querySelector('small').textContent = expertMode ? 'an' : 'aus';
  elements.viewHint.textContent = expertMode
    ? 'Expertenansicht: alle DCS-v2-Ausgänge, alle Quellen und sämtliche Umrechnungen.'
    : 'Basisansicht: Motion-Cues, IAS/AGL, Stall und RPM – jeweils nur mit passender Standard- oder A2A-Quelle.';
  elements.filterInput.placeholder = expertMode
    ? 'z. B. RPM, gear, shake'
    : 'z. B. RPM, vertical';
}

function renderCustomSources() {
  elements.customUnitSelect.replaceChildren(unitOptions('number'));
  const customSources = draftConfig.customSources || [];
  elements.customSourceList.replaceChildren();
  if (!customSources.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Noch keine eigenen LVars hinterlegt.';
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
    unit.textContent = state.catalog.units[source.inputUnit]?.label || source.inputUnit;
    description.append(name, variable, unit);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-button';
    remove.textContent = '− Entfernen';
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
  elements.nameInput.value = draftConfig.name;
  elements.hostInput.value = draftConfig.host;
  elements.portInput.value = draftConfig.port;
  elements.periodSelect.value = draftConfig.period;
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
  elements.saveStatus.textContent = 'Speichert …';
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
      elements.saveStatus.textContent = result?.message || 'Speicherfehler';
      elements.saveStatus.className = 'save-status error';
      return;
    }
    draftConfig = clone(result.config);
    renderedRevision = result.configRevision;
    elements.saveStatus.textContent = 'Gespeichert';
    elements.saveStatus.className = 'save-status';
    if (forceRender) renderConfig();
  }, 300);
}

function renderLive(runtime = {}) {
  const running = runtime.process === 'running';
  setStateClass(elements.processBadge, 'badge', running ? 'running' : 'waiting');
  elements.processBadge.textContent = running ? 'Aktiv' : 'Bereit';
  setStateClass(elements.simDot, 'status-dot', runtime.simulator || 'waiting');
  elements.simStatus.textContent = {
    connected: 'Verbunden', connecting: 'Verbindet …', waiting: 'Nicht verbunden', error: 'Fehler'
  }[runtime.simulator] || 'Nicht verbunden';
  setStateClass(elements.udpDot, 'status-dot', runtime.udp === 'active' ? 'connected' : runtime.udp || 'waiting');
  elements.udpStatus.textContent = runtime.udp === 'active'
    ? `${draftConfig.host}:${draftConfig.port}`
    : (runtime.udp === 'error' ? 'Fehler' : 'Gestoppt');
  elements.sampleRate.textContent = `${Number(runtime.sampleHz || 0).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Hz`;
  elements.packetCount.textContent = Number(runtime.packets || 0).toLocaleString('de-DE');
  elements.runtimeDetail.textContent = runtime.lastError
    ? `${runtime.detail || ''} · ${runtime.lastError}`
    : (runtime.detail || 'Bridge ist nicht gestartet.');
  elements.runtimeDetail.classList.toggle('error', Boolean(runtime.lastError));
  elements.startButton.disabled = running;
  elements.stopButton.disabled = !running;

  for (const output of state.catalog.outputs) {
    const channel = draftConfig.channels[output.id];
    const sourceValueElement = document.querySelector(`[data-source-value-for="${CSS.escape(output.id)}"]`);
    if (sourceValueElement) sourceValueElement.textContent = numberText(runtime.sourceValues?.[channel?.sourceId]);
    const outputValueElement = document.querySelector(`[data-output-value-for="${CSS.escape(output.id)}"]`);
    if (outputValueElement) {
      outputValueElement.textContent = channel?.enabled ? numberText(runtime.outputValues?.[output.id]) : 'aus';
      const error = runtime.channelErrors?.[output.id] || '';
      outputValueElement.classList.toggle('error', Boolean(error));
      outputValueElement.title = error;
      outputValueElement.closest('.mapping-row')?.classList.toggle('mapping-error', Boolean(error));
    }
  }

  if (runtime.packetPreview) {
    elements.packetPreview.textContent = JSON.stringify(runtime.packetPreview, null, 2);
    elements.packetSummary.textContent = `${Object.keys(runtime.packetPreview).length} Felder · ${runtime.packets || 0} Pakete`;
  } else {
    elements.packetPreview.textContent = 'Bridge starten, um die JSON-Ausgabe zu sehen.';
    elements.packetSummary.textContent = 'Noch keine Telemetrie';
  }
}

function render(nextState) {
  state = nextState;
  elements.versionLine.textContent = `Desktop v${state.appVersion || '–'} · DCS-Protokoll v2`;
  if (!draftConfig || state.configRevision !== renderedRevision) {
    draftConfig = clone(state.config);
    renderedRevision = state.configRevision;
    renderConfig();
  }
  renderLive(state.runtime || {});
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

elements.startButton.addEventListener('click', () => window.accusimRouter.start());
elements.stopButton.addEventListener('click', () => window.accusimRouter.stop());
elements.openFolderButton.addEventListener('click', () => window.accusimRouter.openDataFolder());
elements.filterInput.addEventListener('input', applyFilter);
elements.expertToggleButton.addEventListener('click', () => {
  if (!draftConfig) return;
  draftConfig.expertMode = !draftConfig.expertMode;
  applyViewMode();
  renderMappings();
  queueSave();
});

elements.disableAllButton.addEventListener('click', () => {
  if (!window.confirm('Wirklich alle optionalen DCS-Ausgabekanäle deaktivieren?')) return;
  Object.values(draftConfig.channels).forEach((channel) => { channel.enabled = false; });
  renderMappings();
  queueSave();
});

elements.resetButton.addEventListener('click', async () => {
  if (!window.confirm('Alle Zuordnungen, Umrechnungen und eigenen LVars auf den Auslieferungszustand zurücksetzen?')) return;
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
