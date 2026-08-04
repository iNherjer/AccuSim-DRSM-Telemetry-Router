'use strict';

const {
  BUILTIN_SOURCES,
  DIAGNOSTIC_SOURCE_IDS,
  OPERATIONS,
  OUTPUTS,
  SAFE_SOURCE_IDS,
  UNIT_DEFINITIONS,
  buildDefaultConfig,
  compatibleOperationIds,
  defaultChannelFor,
  safeCompatibleOperationIds
} = require('./catalog');
const { normalizeLanguage, translate } = require('./i18n');

const OPERATION_IDS = new Set(OPERATIONS.map((entry) => entry.id));
const OUTPUT_BY_ID = new Map(OUTPUTS.map((entry) => [entry.id, entry]));
const SIGN_CORRECTION_OUTPUTS = new Set(['pitch', 'roll']);
const FIXED_ARRAY_LENGTHS = Object.freeze({ acc: 3, ang_vel: 3, vel: 3, wind: 3, afterburner: 2 });
const SAMPLE_GAP_THRESHOLD_SECONDS = 0.25;
const POST_GAP_TURBULENCE_SUPPRESSION_SECONDS = 0.75;

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

function localizedLabel(definition, language) {
  return normalizeLanguage(language) === 'en'
    ? (definition?.labelEn || definition?.label || '')
    : (definition?.label || definition?.labelEn || '');
}

function operationLabel(operationId, language) {
  return localizedLabel(OPERATIONS.find((entry) => entry.id === operationId), language) || operationId;
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
  const language = normalizeLanguage(config?.language);
  const source = sourceMap.get(channel.sourceId);
  if (!source) return translate(language, 'core.sourceUnavailable');
  if (config?.unsafeMode === true) return '';

  const customSource = source.group === 'Eigene LVars' || source.id.startsWith('custom.');
  if (!customSource && !(SAFE_SOURCE_IDS[definition.id] || []).includes(source.id)) {
    return translate(language, 'core.sourceMismatch');
  }

  const sourceUnit = UNIT_DEFINITIONS[source.inputUnit];
  const inputUnit = UNIT_DEFINITIONS[channel.inputUnit];
  const targetUnit = UNIT_DEFINITIONS[definition.targetUnit];
  if (!sourceUnit || !inputUnit || !targetUnit) return translate(language, 'core.unknownUnit');
  if (sourceUnit.family !== inputUnit.family) {
    return translate(language, 'core.inputFamilyMismatch', {
      unit: localizedLabel(inputUnit, language)
    });
  }
  if (!safeCompatibleOperationIds(inputUnit.family, targetUnit.family).includes(channel.operation)) {
    return translate(language, 'core.unsafeConversion', {
      unit: localizedLabel(inputUnit, language),
      operation: operationLabel(channel.operation, language),
      target: localizedLabel(targetUnit, language)
    });
  }
  return '';
}

function requiredSources(config) {
  const channels = safeObject(config?.channels);
  const sources = allSources(config);
  const sourceMap = new Map(sources.map((entry) => [entry.id, entry]));
  const selectedIds = new Set(DIAGNOSTIC_SOURCE_IDS);
  for (const definition of OUTPUTS) {
    const channel = safeObject(channels[definition.id]);
    const sourceId = String(channel.sourceId || '').trim();
    if (channel.enabled === true && sourceId && !channelCompatibilityError(config, definition, channel, sourceMap)) {
      selectedIds.add(sourceId);
    }
  }
  const turbulence = safeObject(config?.turbulence);
  if (turbulence.enabled === true) {
    const turbulenceSource = sourceMap.get(String(turbulence.sourceId || '').trim());
    const family = UNIT_DEFINITIONS[turbulenceSource?.inputUnit]?.family;
    if (turbulenceSource && ['acceleration', 'velocity'].includes(family)) {
      selectedIds.add(turbulenceSource.id);
    }
    if (turbulence.windEnabled === true) {
      const windSource = sourceMap.get(String(turbulence.windSourceId || '').trim());
      const windFamily = UNIT_DEFINITIONS[windSource?.inputUnit]?.family;
      if (windSource && windFamily === 'velocity') selectedIds.add(windSource.id);
    }
  }
  if (config?.gravity?.enabled === true) {
    // Gravity compensation must always use the physical MSFS attitude. It must
    // not depend on whether the routed pitch/roll outputs are enabled, scaled,
    // offset or mapped to another source. Their inversion still defines the
    // coordinate-system sign used by the DCS output.
    selectedIds.add('std.pitch');
    selectedIds.add('std.bank');
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
  const schemaVersion = finite(raw.schemaVersion, 1);
  const isLegacyConfig = schemaVersion < 2;
  const isPreInvertConfig = schemaVersion < 3;

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
    let scale = finite(candidate.scale, finite(fallback.scale, 1));
    let invert = isPreInvertConfig
      ? false
      : (candidate.invert === undefined ? fallback.invert === true : candidate.invert === true);
    if (scale < 0) {
      scale = Math.abs(scale);
      invert = !invert;
    }
    if (isPreInvertConfig && SIGN_CORRECTION_OUTPUTS.has(definition.id)) invert = true;
    channels[definition.id] = {
      enabled: isLegacyConfig && !definition.basic ? false : requestedEnabled,
      sourceId,
      inputUnit,
      operation: OPERATION_IDS.has(candidate.operation) ? candidate.operation : fallback.operation,
      invert,
      scale,
      offset: finite(candidate.offset, finite(fallback.offset, 0))
    };
  }

  const rawGravity = safeObject(raw.gravity);
  const rawTurbulence = safeObject(raw.turbulence);
  const fallbackTurbulence = defaults.turbulence;
  const requestedTurbulenceSourceId = String(
    rawTurbulence.sourceId || fallbackTurbulence.sourceId
  ).trim();
  const turbulenceSource = sourceMap.get(requestedTurbulenceSourceId);
  const turbulenceFamily = UNIT_DEFINITIONS[turbulenceSource?.inputUnit]?.family;
  const turbulenceSourceId = turbulenceSource && ['acceleration', 'velocity'].includes(turbulenceFamily)
    ? requestedTurbulenceSourceId
    : fallbackTurbulence.sourceId;
  const requestedWindSourceId = String(
    rawTurbulence.windSourceId || fallbackTurbulence.windSourceId
  ).trim();
  const windSource = sourceMap.get(requestedWindSourceId);
  const windSourceId = UNIT_DEFINITIONS[windSource?.inputUnit]?.family === 'velocity'
    ? requestedWindSourceId
    : fallbackTurbulence.windSourceId;

  return {
    schemaVersion: 4,
    language: normalizeLanguage(raw.language),
    expertMode: raw.expertMode === true,
    unsafeMode: raw.unsafeMode === true,
    skippedUpdateVersion: String(raw.skippedUpdateVersion || '').trim().slice(0, 40),
    name: String(raw.name || defaults.name).trim().slice(0, 100) || defaults.name,
    host: String(raw.host || defaults.host).trim().slice(0, 255) || defaults.host,
    port: clamp(Math.round(finite(raw.port, defaults.port)), 1, 65535),
    period: raw.period === 'sim' ? 'sim' : 'visual',
    gravity: {
      enabled: rawGravity.enabled === undefined ? defaults.gravity.enabled : rawGravity.enabled === true,
      strengthG: clamp(finite(rawGravity.strengthG, defaults.gravity.strengthG), 0, 2)
    },
    turbulence: {
      enabled: rawTurbulence.enabled === true,
      sourceId: turbulenceSourceId,
      mix: clamp(finite(rawTurbulence.mix, fallbackTurbulence.mix), 0, 1),
      gain: clamp(finite(rawTurbulence.gain, fallbackTurbulence.gain), 0, 8),
      lowCutHz: clamp(finite(rawTurbulence.lowCutHz, fallbackTurbulence.lowCutHz), 0.05, 10),
      highCutHz: clamp(finite(rawTurbulence.highCutHz, fallbackTurbulence.highCutHz), 0.1, 20),
      maxExtraG: clamp(finite(rawTurbulence.maxExtraG, fallbackTurbulence.maxExtraG), 0.01, 2),
      windEnabled: rawTurbulence.windEnabled === true,
      windSourceId,
      windMix: clamp(finite(rawTurbulence.windMix, fallbackTurbulence.windMix), 0, 1),
      windGain: clamp(finite(rawTurbulence.windGain, fallbackTurbulence.windGain), 0, 8),
      windInvert: rawTurbulence.windInvert === true
    },
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

function gravityVector(pitch, roll, strengthG = 1) {
  const magnitude = clamp(finite(strengthG, 1), 0, 2);
  const safePitch = finite(pitch);
  const safeRoll = finite(roll);
  const cosPitch = Math.cos(safePitch);
  return [
    magnitude * Math.sin(safeRoll) * cosPitch,
    -magnitude * Math.sin(safePitch),
    -magnitude * Math.cos(safeRoll) * cosPitch
  ];
}

function gravityReferenceAttitude(sourceValues, channels = {}) {
  const pitchDegrees = Number(sourceValues?.['std.pitch']);
  const rollDegrees = Number(sourceValues?.['std.bank']);
  const valid = Number.isFinite(pitchDegrees) && Number.isFinite(rollDegrees);
  const degreesToRadians = UNIT_DEFINITIONS.degrees.factor;
  const pitchSign = safeObject(channels.pitch).invert === true ? -1 : 1;
  const rollSign = safeObject(channels.roll).invert === true ? -1 : 1;
  return {
    // Inversion defines the selected DCS axis convention. Scale and offset are
    // deliberately excluded so user cue tuning cannot distort physical gravity.
    pitch: valid ? pitchDegrees * degreesToRadians * pitchSign : 0,
    roll: valid ? rollDegrees * degreesToRadians * rollSign : 0,
    valid
  };
}

class RouterCore {
  constructor(config = buildDefaultConfig()) {
    this.setConfig(config);
  }

  setConfig(config) {
    this.config = normalizeConfig(config);
    this.sourceMap = new Map(allSources(this.config).map((entry) => [entry.id, entry]));
    this.states = new Map();
    this.turbulenceStates = new Map();
    this.startedAtSeconds = null;
    this.lastSampleAtSeconds = null;
    this.turbulenceSuppressedUntilSeconds = null;
  }

  convert(definition, channel, rawValue, timeSeconds) {
    const language = this.config.language;
    const input = UNIT_DEFINITIONS[channel.inputUnit];
    const target = UNIT_DEFINITIONS[definition.targetUnit];
    if (!input || !target) return { error: translate(language, 'core.unknownUnit') };
    const compatibleOperations = this.config.unsafeMode
      ? compatibleOperationIds(input.family, target.family)
      : safeCompatibleOperationIds(input.family, target.family);
    if (!compatibleOperations.includes(channel.operation)) {
      return { error: translate(language, 'core.unsupportedConversion', {
        unit: localizedLabel(input, language),
        operation: operationLabel(channel.operation, language),
        target: localizedLabel(target, language)
      }) };
    }
    const rawNumber = Number(rawValue);
    if (!Number.isFinite(rawNumber)) return { error: translate(language, 'core.notNumber') };

    const canonical = rawNumber * input.factor;
    const previous = this.states.get(definition.id);
    const dt = previous ? timeSeconds - previous.timeSeconds : 0;
    const validDt = dt > 0.001 && dt <= SAMPLE_GAP_THRESHOLD_SECONDS;
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

    const sign = channel.invert === true ? -1 : 1;
    let value = converted * finite(channel.scale, 1) * sign + finite(channel.offset, 0);
    if (target.family === 'boolean') value = value >= 0.5 ? 1 : 0;
    if (definition.integer) value = Math.round(value);
    if (Number.isFinite(definition.min)) value = Math.max(definition.min, value);
    if (Number.isFinite(definition.max)) value = Math.min(definition.max, value);
    return { value };
  }

  turbulenceBranch(sourceValues, sourceId, stateKey, timeSeconds) {
    const config = this.config.turbulence;
    const source = this.sourceMap.get(sourceId);
    const input = UNIT_DEFINITIONS[source?.inputUnit];
    const rawNumber = Number(sourceValues[sourceId]);
    if (!source || !input || !['acceleration', 'velocity'].includes(input.family)) {
      return { error: translate(this.config.language, 'core.turbulenceSourceType') };
    }
    if (!Number.isFinite(rawNumber)) return { error: translate(this.config.language, 'core.turbulenceNotNumber') };

    const canonical = rawNumber * input.factor;
    const previous = this.turbulenceStates.get(stateKey);
    const dt = previous ? timeSeconds - previous.timeSeconds : 0;
    const validDt = dt > 0.001 && dt <= SAMPLE_GAP_THRESHOLD_SECONDS;
    let sourceG = canonical;
    if (input.family === 'velocity') {
      sourceG = previous && validDt ? (canonical - previous.canonical) / dt / 9.80665 : 0;
    }

    const lowCutHz = Math.min(config.lowCutHz, Math.max(0.05, config.highCutHz - 0.05));
    const highCutHz = Math.max(config.highCutHz, lowCutHz + 0.05);
    let slow = sourceG;
    let fast = sourceG;
    if (previous && validDt) {
      const slowAlpha = 1 - Math.exp(-2 * Math.PI * lowCutHz * dt);
      const fastAlpha = 1 - Math.exp(-2 * Math.PI * highCutHz * dt);
      slow = previous.slow + slowAlpha * (sourceG - previous.slow);
      fast = previous.fast + fastAlpha * (sourceG - previous.fast);
    }
    const bandG = fast - slow;
    this.turbulenceStates.set(stateKey, { timeSeconds, canonical, slow, fast });
    return {
      raw: rawNumber,
      sourceG,
      bandG,
      inputFamily: input.family
    };
  }

  turbulenceSignal(sourceValues, timeSeconds) {
    const config = this.config.turbulence;
    const main = this.turbulenceBranch(sourceValues, config.sourceId, 'main', timeSeconds);
    if (main.error) return main;

    const mainExtraG = main.bandG * (config.gain - 1) * config.mix;
    let wind = {
      sourceId: config.windSourceId,
      raw: 0,
      sourceG: 0,
      bandG: 0,
      extraG: 0,
      inputFamily: 'velocity'
    };
    if (config.windEnabled && config.windMix > 0) {
      const windResult = this.turbulenceBranch(
        sourceValues,
        config.windSourceId,
        'wind',
        timeSeconds
      );
      if (windResult.error) return { error: windResult.error, windError: true };
      const sign = config.windInvert ? -1 : 1;
      wind = {
        ...windResult,
        sourceId: config.windSourceId,
        extraG: windResult.bandG * config.windGain * config.windMix * sign
      };
    }

    const unlimitedExtraG = mainExtraG + wind.extraG;
    const maxExtraG = config.maxExtraG;
    const extraG = maxExtraG * Math.tanh(unlimitedExtraG / maxExtraG);
    return {
      ...main,
      mainExtraG,
      wind,
      unlimitedExtraG,
      extraG,
      limited: Math.abs(unlimitedExtraG) > maxExtraG
    };
  }

  update(sourceValues, timeSeconds) {
    const now = finite(timeSeconds);
    if (this.startedAtSeconds === null) this.startedAtSeconds = now;
    const sampleDtSeconds = this.lastSampleAtSeconds === null
      ? 0
      : now - this.lastSampleAtSeconds;
    const gapDetected = this.lastSampleAtSeconds !== null
      && sampleDtSeconds > SAMPLE_GAP_THRESHOLD_SECONDS;
    if (gapDetected) {
      this.turbulenceStates.clear();
      this.turbulenceSuppressedUntilSeconds = now + POST_GAP_TURBULENCE_SUPPRESSION_SECONDS;
    }
    this.lastSampleAtSeconds = now;
    const postGapRemainingSeconds = this.turbulenceSuppressedUntilSeconds === null
      ? 0
      : Math.max(0, this.turbulenceSuppressedUntilSeconds - now);
    const postGapTurbulenceSuppressed = postGapRemainingSeconds > 0;
    const packet = {
      v: 2,
      name: this.config.name,
      t: Math.max(0, now - this.startedAtSeconds)
    };
    const outputValues = {};
    const errors = {};
    const arrays = new Map();
    const diagnostics = {
      timing: {
        sampleDtSeconds,
        gapDetected,
        gapThresholdSeconds: SAMPLE_GAP_THRESHOLD_SECONDS,
        postGapTurbulenceSuppressed,
        postGapRemainingSeconds
      },
      gravity: {
        enabled: this.config.gravity.enabled,
        vectorG: [0, 0, 0],
        referencePitchRad: 0,
        referenceRollRad: 0,
        referenceValid: false
      },
      turbulence: {
        enabled: this.config.turbulence.enabled,
        sourceId: this.config.turbulence.sourceId,
        sourceG: 0,
        bandG: 0,
        mainExtraG: 0,
        wind: {
          enabled: this.config.turbulence.windEnabled,
          sourceId: this.config.turbulence.windSourceId,
          sourceG: 0,
          bandG: 0,
          extraG: 0
        },
        computedExtraG: 0,
        extraG: 0,
        limited: false,
        suppressed: false
      }
    };

    for (const definition of OUTPUTS) {
      const channel = this.config.channels[definition.id];
      if (!channel?.enabled) continue;
      if (!channel.sourceId) {
        errors[definition.id] = translate(this.config.language, 'core.noSource');
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

    const acceleration = arrays.get('acc');
    if (acceleration) {
      if (this.config.gravity.enabled) {
        const reference = gravityReferenceAttitude(sourceValues, this.config.channels);
        const vectorG = gravityVector(reference.pitch, reference.roll, this.config.gravity.strengthG);
        diagnostics.gravity = {
          ...diagnostics.gravity,
          vectorG,
          referencePitchRad: reference.pitch,
          referenceRollRad: reference.roll,
          referenceValid: reference.valid
        };
        for (let index = 0; index < 3; index += 1) {
          const outputId = `acc.${index}`;
          if (!this.config.channels[outputId]?.enabled) continue;
          acceleration[index] = finite(acceleration[index], 0) + vectorG[index];
          outputValues[outputId] = acceleration[index];
        }
      }
      if (this.config.turbulence.enabled && this.config.channels['acc.2']?.enabled) {
        const turbulence = this.turbulenceSignal(sourceValues, now);
        if (turbulence.error) {
          errors.turbulence = turbulence.error;
        } else {
          const computedExtraG = turbulence.extraG;
          const appliedExtraG = postGapTurbulenceSuppressed ? 0 : computedExtraG;
          acceleration[2] = finite(acceleration[2], 0) + appliedExtraG;
          outputValues['acc.2'] = acceleration[2];
          diagnostics.turbulence = {
            ...diagnostics.turbulence,
            ...turbulence,
            computedExtraG,
            extraG: appliedExtraG,
            suppressed: postGapTurbulenceSuppressed
          };
        }
      }
    }
    diagnostics.accelerationG = acceleration
      ? Array.from({ length: 3 }, (_, index) => finite(acceleration[index], 0))
      : null;

    for (const [key, values] of arrays) {
      const lastDefined = values.reduce((last, value, index) => value === undefined ? last : index, -1);
      if (lastDefined < 0) continue;
      const length = FIXED_ARRAY_LENGTHS[key] || lastDefined + 1;
      packet[key] = Array.from({ length }, (_, index) => finite(values[index], 0));
    }

    return { packet, outputValues, errors, diagnostics };
  }
}

module.exports = {
  OUTPUT_BY_ID,
  RouterCore,
  allSources,
  channelCompatibilityError,
  directCompatible,
  gravityVector,
  gravityReferenceAttitude,
  normalizeConfig,
  normalizeCustomSources,
  operationCompatible,
  requiredSources,
  SAMPLE_GAP_THRESHOLD_SECONDS,
  POST_GAP_TURBULENCE_SUPPRESSION_SECONDS
};
