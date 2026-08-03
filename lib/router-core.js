'use strict';

const {
  BUILTIN_SOURCES,
  OPERATIONS,
  OUTPUTS,
  SAFE_SOURCE_IDS,
  UNIT_DEFINITIONS,
  buildDefaultConfig,
  compatibleOperationIds,
  defaultChannelFor,
  safeCompatibleOperationIds
} = require('./catalog');

const OPERATION_IDS = new Set(OPERATIONS.map((entry) => entry.id));
const OUTPUT_BY_ID = new Map(OUTPUTS.map((entry) => [entry.id, entry]));

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeCustomSources(rawSources) {
  const seen = new Set(BUILTIN_SOURCES.map((entry) => entry.id));
  const result = [];
  for (const raw of Array.isArray(rawSources) ? rawSources : []) {
    const id = String(raw?.id || '').trim();
    const label = String(raw?.label || '').trim();
    const simVar = String(raw?.simVar || '').trim();
    const inputUnit = UNIT_DEFINITIONS[raw?.inputUnit] ? raw.inputUnit : 'number';
    if (!id || !label || !simVar || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      group: 'Eigene LVars',
      label: label.slice(0, 100),
      simVar: simVar.slice(0, 180),
      simConnectUnit: String(raw?.simConnectUnit || 'number').trim().slice(0, 80) || 'number',
      inputUnit
    });
  }
  return result;
}

function allSources(config) {
  return [...BUILTIN_SOURCES, ...normalizeCustomSources(config?.customSources)];
}

function channelCompatibilityError(config, definition, channel, sourceMap) {
  const source = sourceMap.get(channel.sourceId);
  if (!source) return 'Eingangsquelle ist nicht verfügbar.';
  if (config?.unsafeMode === true) return '';

  const customSource = source.group === 'Eigene LVars' || source.id.startsWith('custom.');
  if (!customSource && !(SAFE_SOURCE_IDS[definition.id] || []).includes(source.id)) {
    return 'Eingangsquelle passt fachlich nicht zum Ausgang; nur im Raw-Modus erlaubt.';
  }

  const sourceUnit = UNIT_DEFINITIONS[source.inputUnit];
  const inputUnit = UNIT_DEFINITIONS[channel.inputUnit];
  const targetUnit = UNIT_DEFINITIONS[definition.targetUnit];
  if (!sourceUnit || !inputUnit || !targetUnit) return 'Unbekannte Einheit.';
  if (sourceUnit.family !== inputUnit.family) {
    return `${inputUnit.label} passt nicht zur physikalischen Größe der Eingangsquelle.`;
  }
  if (!safeCompatibleOperationIds(inputUnit.family, targetUnit.family).includes(channel.operation)) {
    return `${inputUnit.label} kann nicht sicher per ${channel.operation} in ${targetUnit.label} umgerechnet werden.`;
  }
  return '';
}

function requiredSources(config) {
  const channels = safeObject(config?.channels);
  const sources = allSources(config);
  const sourceMap = new Map(sources.map((entry) => [entry.id, entry]));
  const selectedIds = new Set();
  for (const definition of OUTPUTS) {
    const channel = safeObject(channels[definition.id]);
    const sourceId = String(channel.sourceId || '').trim();
    if (channel.enabled === true && sourceId && !channelCompatibilityError(config, definition, channel, sourceMap)) {
      selectedIds.add(sourceId);
    }
  }
  return sources.filter((entry) => selectedIds.has(entry.id));
}

function normalizeConfig(rawConfig) {
  const defaults = buildDefaultConfig();
  const raw = safeObject(rawConfig);
  const customSources = normalizeCustomSources(raw.customSources);
  const sourceMap = new Map([...BUILTIN_SOURCES, ...customSources].map((entry) => [entry.id, entry]));
  const rawChannels = safeObject(raw.channels);
  const channels = {};
  const isLegacyConfig = finite(raw.schemaVersion, 1) < 2;

  for (const definition of OUTPUTS) {
    const fallback = defaultChannelFor(definition);
    const candidate = safeObject(rawChannels[definition.id]);
    const requestedSourceId = String(candidate.sourceId ?? fallback.sourceId ?? '').trim();
    const sourceDefinition = sourceMap.get(requestedSourceId);
    const sourceId = sourceDefinition ? requestedSourceId : '';
    const requestedInputUnit = String(candidate.inputUnit || '').trim();
    const inputUnit = UNIT_DEFINITIONS[requestedInputUnit]
      ? requestedInputUnit
      : (sourceDefinition?.inputUnit || fallback.inputUnit || definition.targetUnit);
    const requestedEnabled = candidate.enabled === undefined ? fallback.enabled === true : candidate.enabled === true;
    channels[definition.id] = {
      enabled: isLegacyConfig && !definition.basic ? false : requestedEnabled,
      sourceId,
      inputUnit,
      operation: OPERATION_IDS.has(candidate.operation) ? candidate.operation : fallback.operation,
      scale: finite(candidate.scale, finite(fallback.scale, 1)),
      offset: finite(candidate.offset, finite(fallback.offset, 0))
    };
  }

  return {
    schemaVersion: 2,
    expertMode: raw.expertMode === true,
    unsafeMode: raw.unsafeMode === true,
    name: String(raw.name || defaults.name).trim().slice(0, 100) || defaults.name,
    host: String(raw.host || defaults.host).trim().slice(0, 255) || defaults.host,
    port: clamp(Math.round(finite(raw.port, defaults.port)), 1, 65535),
    period: raw.period === 'sim' ? 'sim' : 'visual',
    customSources,
    channels
  };
}

function directCompatible(inputFamily, outputFamily) {
  return compatibleOperationIds(inputFamily, outputFamily).includes('direct');
}

function operationCompatible(operation, inputFamily, outputFamily) {
  return compatibleOperationIds(inputFamily, outputFamily).includes(operation);
}

function differentiatedValue(inputFamily, canonicalValue, previousCanonical, dtSeconds) {
  const derivative = (canonicalValue - previousCanonical) / dtSeconds;
  // Acceleration uses G as its canonical unit while velocity uses m/s.
  return inputFamily === 'velocity' ? derivative / 9.80665 : derivative;
}

class RouterCore {
  constructor(config = buildDefaultConfig()) {
    this.setConfig(config);
  }

  setConfig(config) {
    this.config = normalizeConfig(config);
    this.sourceMap = new Map(allSources(this.config).map((entry) => [entry.id, entry]));
    this.states = new Map();
    this.startedAtSeconds = null;
  }

  convert(definition, channel, rawValue, timeSeconds) {
    const input = UNIT_DEFINITIONS[channel.inputUnit];
    const target = UNIT_DEFINITIONS[definition.targetUnit];
    if (!input || !target) return { error: 'Unbekannte Einheit.' };
    const compatibleOperations = this.config.unsafeMode
      ? compatibleOperationIds(input.family, target.family)
      : safeCompatibleOperationIds(input.family, target.family);
    if (!compatibleOperations.includes(channel.operation)) {
      return { error: `${input.label} kann nicht per ${channel.operation} in ${target.label} umgerechnet werden.` };
    }
    const rawNumber = Number(rawValue);
    if (!Number.isFinite(rawNumber)) return { error: 'Eingang liefert keine Zahl.' };

    const canonical = rawNumber * input.factor;
    const previous = this.states.get(definition.id);
    const dt = previous ? timeSeconds - previous.timeSeconds : 0;
    const validDt = dt > 0.001 && dt <= 0.25;
    let converted = canonical;

    if (channel.operation === 'integrate') {
      const priorIntegral = previous && validDt ? previous.integral : 0;
      converted = priorIntegral + canonical * (validDt ? dt : 0);
      this.states.set(definition.id, { timeSeconds, canonical, integral: converted });
    } else if (channel.operation === 'differentiate') {
      converted = previous && validDt
        ? differentiatedValue(input.family, canonical, previous.canonical, dt)
        : 0;
      this.states.set(definition.id, { timeSeconds, canonical, integral: 0 });
    } else {
      this.states.set(definition.id, { timeSeconds, canonical, integral: 0 });
    }

    let value = converted * finite(channel.scale, 1) + finite(channel.offset, 0);
    if (target.family === 'boolean') value = value >= 0.5 ? 1 : 0;
    if (definition.integer) value = Math.round(value);
    if (Number.isFinite(definition.min)) value = Math.max(definition.min, value);
    if (Number.isFinite(definition.max)) value = Math.min(definition.max, value);
    return { value };
  }

  update(sourceValues, timeSeconds) {
    const now = finite(timeSeconds);
    if (this.startedAtSeconds === null) this.startedAtSeconds = now;
    const packet = {
      v: 2,
      name: this.config.name,
      t: Math.max(0, now - this.startedAtSeconds)
    };
    const outputValues = {};
    const errors = {};
    const arrays = new Map();

    for (const definition of OUTPUTS) {
      const channel = this.config.channels[definition.id];
      if (!channel?.enabled) continue;
      if (!channel.sourceId) {
        errors[definition.id] = 'Keine Eingangsquelle ausgewählt.';
        continue;
      }
      const compatibilityError = channelCompatibilityError(
        this.config,
        definition,
        channel,
        this.sourceMap
      );
      if (compatibilityError) {
        errors[definition.id] = compatibilityError;
        continue;
      }
      const result = this.convert(definition, channel, sourceValues[channel.sourceId], now);
      if (result.error) {
        errors[definition.id] = result.error;
        continue;
      }
      outputValues[definition.id] = result.value;
      if (Number.isInteger(definition.index)) {
        if (!arrays.has(definition.packetKey)) arrays.set(definition.packetKey, []);
        arrays.get(definition.packetKey)[definition.index] = result.value;
      } else {
        packet[definition.packetKey] = result.value;
      }
    }

    for (const [key, values] of arrays) {
      const lastDefined = values.reduce((last, value, index) => value === undefined ? last : index, -1);
      if (lastDefined < 0) continue;
      packet[key] = Array.from({ length: lastDefined + 1 }, (_, index) => finite(values[index], 0));
    }

    return { packet, outputValues, errors };
  }
}

module.exports = {
  OUTPUT_BY_ID,
  RouterCore,
  allSources,
  channelCompatibilityError,
  directCompatible,
  normalizeConfig,
  normalizeCustomSources,
  operationCompatible,
  requiredSources
};
