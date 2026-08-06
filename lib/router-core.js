'use strict';

const {
  BUILTIN_SOURCES,
  DIAGNOSTIC_SOURCE_IDS,
  MOTION_MIX_PROFILES,
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
const FUSION_REFERENCE_FILTER_TAU_SECONDS = 0.08;
const FUSION_REFERENCE_RATE_LIMIT_RADPS = 8;
const RESIDUAL_WASHOUT_ACCEL_THRESHOLD_RADPS2 = 0.01;
const RESIDUAL_WASHOUT_REFERENCE_THRESHOLD_RADPS = 0.015;
const RESIDUAL_WASHOUT_RATE_LIMIT_RADPS = 0.08;
const V2_REFERENCE_SOURCE_IDS = Object.freeze({
  'ang_vel.0': 'std.angular.body.x',
  'ang_vel.1': 'std.angular.body.z',
  'ang_vel.2': 'std.angular.body.y'
});
const SHAKE_MIX_SOURCES = Object.freeze([
  Object.freeze({ key: 'airframe', sourceId: 'a2a.shake.airframe', reference: 0.25 }),
  Object.freeze({ key: 'vertical', sourceId: 'a2a.shake.panel.vertical', reference: 0.05 }),
  Object.freeze({ key: 'horizontal', sourceId: 'a2a.shake.panel.horizontal', reference: 0.15 })
]);

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

function channelMatchesProfile(channel, expected) {
  return channel?.enabled === expected.enabled &&
    channel?.sourceId === expected.sourceId &&
    channel?.inputUnit === expected.inputUnit &&
    channel?.operation === expected.operation &&
    channel?.invert === expected.invert &&
    Math.abs(finite(channel?.scale, 1) - expected.scale) < 1e-9 &&
    Math.abs(finite(channel?.offset, 0) - expected.offset) < 1e-9;
}

function motionChannelsMatchProfile(channels, profile) {
  return Object.entries(profile.channels).every(([outputId, expected]) => (
    channelMatchesProfile(channels[outputId], expected)
  ));
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
  const fusionChannels = OUTPUTS.filter((definition) => {
    const channel = safeObject(channels[definition.id]);
    return channel.enabled === true && ['fuse', 'fuse_v2'].includes(channel.operation);
  });
  const usesLegacyAngularFusion = fusionChannels.some((definition) => (
    safeObject(channels[definition.id]).operation === 'fuse'
  ));
  for (const definition of fusionChannels) {
    if (safeObject(channels[definition.id]).operation !== 'fuse_v2') continue;
    const referenceSourceId = V2_REFERENCE_SOURCE_IDS[definition.id];
    if (referenceSourceId) selectedIds.add(referenceSourceId);
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
  if (config?.gravity?.enabled === true || config?.attitudeMix?.enabled === true || usesLegacyAngularFusion) {
    // Gravity compensation must always use the physical MSFS attitude. It must
    // not depend on whether the routed pitch/roll outputs are enabled, scaled,
    // offset or mapped to another source. Their inversion still defines the
    // coordinate-system sign used by the DCS output.
    selectedIds.add('std.pitch');
    selectedIds.add('std.bank');
  }
  if (config?.groundForces?.enabled === true) {
    selectedIds.add('std.on_ground');
    selectedIds.add('std.acc.body.x');
    selectedIds.add('std.acc.body.z');
  }
  if (config?.shakeMixer?.enabled === true) {
    for (const definition of SHAKE_MIX_SOURCES) selectedIds.add(definition.sourceId);
  }
  if (usesLegacyAngularFusion) selectedIds.add('std.heading');
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
  const rawAttitudeMix = safeObject(raw.attitudeMix);
  const rawGroundForces = safeObject(raw.groundForces);
  const rawShakeMixer = safeObject(raw.shakeMixer);
  const rawRotationFusion = safeObject(raw.rotationFusion);
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

  // v1.6.x used the opposite vertical gravity sign. Some test profiles worked
  // around the resulting -1 G rest value with an exact +2 offset. Remove only
  // that known workaround while migrating; arbitrary user offsets survive.
  if (schemaVersion < 5 && rawGravity.enabled !== false) {
    const vertical = channels['acc.2'];
    if (vertical.sourceId === 'a2a.acc.y' && Math.abs(vertical.offset - 2) < 1e-9) {
      vertical.offset = 0;
    }
  }
  // Pure integration of an acceleration has no absolute-rate reference and
  // will drift. Existing A2A mappings are upgraded to the bounded fusion path.
  if (schemaVersion < 5) {
    for (const outputId of ['ang_vel.0', 'ang_vel.1', 'ang_vel.2']) {
      const channel = channels[outputId];
      if (channel.sourceId.startsWith('a2a.rotacc.') && channel.operation === 'integrate') {
        channel.operation = 'fuse';
      }
    }
  }

  // v1.9 makes the validated V2 topology the factory default. Upgrade only an
  // untouched v1.8 Legacy mapping; any expert tuning or custom source choice is
  // preserved and remains explicitly switchable from the UI.
  if (schemaVersion < 8 && motionChannelsMatchProfile(channels, MOTION_MIX_PROFILES.legacy)) {
    for (const [outputId, channel] of Object.entries(MOTION_MIX_PROFILES.v2.channels)) {
      channels[outputId] = { ...channel };
    }
  }

  // A2A FM BodyAccelerationY is centred around zero and therefore needs the
  // DCS resting-load/gravity vector. Standard G FORCE already includes that
  // reference; applying gravity again would double it. Keep this deterministic
  // even for expert mappings so changing the vertical source cannot leave a
  // stale gravity checkbox behind.
  const automaticGravityEnabled = channels['acc.2']?.enabled === true &&
    channels['acc.2'].sourceId === 'a2a.acc.y';

  const fallbackShakeMixer = defaults.shakeMixer;
  const rawShakeSources = safeObject(rawShakeMixer.sources);
  const shakeSources = Object.fromEntries(SHAKE_MIX_SOURCES.map(({ key }) => {
    const candidate = safeObject(rawShakeSources[key]);
    const fallback = fallbackShakeMixer.sources[key];
    const rawMixes = Array.isArray(candidate.mixes) ? candidate.mixes : fallback.mixes;
    return [key, {
      invert: candidate.invert === true,
      mixes: Array.from({ length: 3 }, (_unused, index) => clamp(
        finite(rawMixes[index], fallback.mixes[index]),
        0,
        2
      ))
    }];
  }));

  return {
    schemaVersion: 10,
    language: normalizeLanguage(raw.language),
    expertMode: raw.expertMode === true,
    unsafeMode: raw.unsafeMode === true,
    skippedUpdateVersion: String(raw.skippedUpdateVersion || '').trim().slice(0, 40),
    name: String(raw.name || defaults.name).trim().slice(0, 100) || defaults.name,
    host: String(raw.host || defaults.host).trim().slice(0, 255) || defaults.host,
    port: clamp(Math.round(finite(raw.port, defaults.port)), 1, 65535),
    period: raw.period === 'sim' ? 'sim' : 'visual',
    gravity: {
      enabled: automaticGravityEnabled,
      strengthG: clamp(finite(rawGravity.strengthG, defaults.gravity.strengthG), 0, 2)
    },
    attitudeMix: {
      enabled: rawAttitudeMix.enabled === true,
      pitchMix: clamp(finite(rawAttitudeMix.pitchMix, defaults.attitudeMix.pitchMix), 0, 2),
      rollMix: clamp(finite(rawAttitudeMix.rollMix, defaults.attitudeMix.rollMix), 0, 2)
    },
    groundForces: {
      enabled: rawGroundForces.enabled === true,
      lateralMix: clamp(finite(
        rawGroundForces.lateralMix,
        defaults.groundForces.lateralMix
      ), 0, 2),
      longitudinalMix: clamp(finite(
        rawGroundForces.longitudinalMix,
        defaults.groundForces.longitudinalMix
      ), 0, 2),
      filterHz: clamp(finite(
        rawGroundForces.filterHz,
        defaults.groundForces.filterHz
      ), 0.5, 20),
      maxExtraG: clamp(finite(
        rawGroundForces.maxExtraG,
        defaults.groundForces.maxExtraG
      ), 0.01, 2),
      fadeInSeconds: clamp(finite(
        rawGroundForces.fadeInSeconds,
        defaults.groundForces.fadeInSeconds
      ), 0.05, 5),
      fadeOutSeconds: clamp(finite(
        rawGroundForces.fadeOutSeconds,
        defaults.groundForces.fadeOutSeconds
      ), 0.05, 5)
    },
    shakeMixer: {
      enabled: rawShakeMixer.enabled === true,
      strengthG: clamp(finite(
        rawShakeMixer.strengthG,
        fallbackShakeMixer.strengthG
      ), 0, 0.5),
      centerHz: clamp(finite(
        rawShakeMixer.centerHz,
        fallbackShakeMixer.centerHz
      ), 0.05, 10),
      smoothingHz: clamp(finite(
        rawShakeMixer.smoothingHz,
        fallbackShakeMixer.smoothingHz
      ), 0.1, 20),
      maxExtraG: clamp(finite(
        rawShakeMixer.maxExtraG,
        fallbackShakeMixer.maxExtraG
      ), 0.01, 1),
      sources: shakeSources
    },
    rotationFusion: {
      correctionEnabled: rawRotationFusion.correctionEnabled === undefined
        ? defaults.rotationFusion.correctionEnabled
        : rawRotationFusion.correctionEnabled === true,
      correctionTauSeconds: clamp(finite(
        rawRotationFusion.correctionTauSeconds,
        defaults.rotationFusion.correctionTauSeconds
      ), 0.25, 20),
      residualWashoutEnabled: rawRotationFusion.residualWashoutEnabled === true,
      residualWashoutTauSeconds: clamp(finite(
        rawRotationFusion.residualWashoutTauSeconds,
        defaults.rotationFusion.residualWashoutTauSeconds
      ), 1, 60),
      v2DetailMix: clamp(finite(
        rawRotationFusion.v2DetailMix,
        defaults.rotationFusion.v2DetailMix
      ), 0, 1),
      v2CorrectionTauSeconds: clamp(finite(
        rawRotationFusion.v2CorrectionTauSeconds,
        defaults.rotationFusion.v2CorrectionTauSeconds
      ), 0.1, 5),
      v2BiasTauSeconds: clamp(finite(
        rawRotationFusion.v2BiasTauSeconds,
        defaults.rotationFusion.v2BiasTauSeconds
      ), 0.5, 20)
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
  // The A2A FM body acceleration axes contain an attitude-correlated share
  // with the opposite sign on lateral and longitudinal. Real flight logs show
  // that these two components must keep the original compensation direction,
  // while DCS/DRSM requires a positive vertical 1 G resting reference.
  return [
    magnitude * Math.sin(safeRoll) * cosPitch,
    -magnitude * Math.sin(safePitch),
    magnitude * Math.cos(safeRoll) * cosPitch
  ];
}

function vectorDot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function vectorCross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
}

function orientationMatrix(pitch, roll, heading) {
  const sinHeading = Math.sin(heading);
  const cosHeading = Math.cos(heading);
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);
  const sinRoll = Math.sin(roll);
  const cosRoll = Math.cos(roll);
  const forward = [cosPitch * sinHeading, cosPitch * cosHeading, sinPitch];
  const levelRight = [cosHeading, -sinHeading, 0];
  const levelUp = vectorCross(levelRight, forward);
  const right = levelRight.map((value, index) => value * cosRoll - levelUp[index] * sinRoll);
  const up = levelRight.map((value, index) => value * sinRoll + levelUp[index] * cosRoll);
  return [
    [right[0], forward[0], up[0]],
    [right[1], forward[1], up[1]],
    [right[2], forward[2], up[2]]
  ];
}

function rotationVectorPerSecond(previous, current, dtSeconds) {
  if (!previous || dtSeconds <= 0) return [0, 0, 0];
  const delta = Array.from({ length: 3 }, (_unused, row) => (
    Array.from({ length: 3 }, (_unusedColumn, column) => (
      vectorDot(
        [previous[0][row], previous[1][row], previous[2][row]],
        [current[0][column], current[1][column], current[2][column]]
      )
    ))
  ));
  const cosine = clamp((delta[0][0] + delta[1][1] + delta[2][2] - 1) / 2, -1, 1);
  const angle = Math.acos(cosine);
  const skew = [
    delta[2][1] - delta[1][2],
    delta[0][2] - delta[2][0],
    delta[1][0] - delta[0][1]
  ];
  if (angle < 1e-7) return skew.map((value) => value * 0.5 / dtSeconds);
  const sine = Math.sin(angle);
  if (Math.abs(sine) < 1e-7) return [0, 0, 0];
  return skew.map((value) => value * angle / (2 * sine * dtSeconds));
}

function physicalAttitude(sourceValues) {
  const pitch = Number(sourceValues?.['std.pitch']);
  const roll = Number(sourceValues?.['std.bank']);
  const heading = Number(sourceValues?.['std.heading']);
  const valid = [pitch, roll, heading].every(Number.isFinite);
  const degreesToRadians = UNIT_DEFINITIONS.degrees.factor;
  return {
    pitch: valid ? pitch * degreesToRadians : 0,
    roll: valid ? roll * degreesToRadians : 0,
    heading: valid ? heading * degreesToRadians : 0,
    valid
  };
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
    this.angularFusionStates = new Map();
    this.angularReferenceState = null;
    this.groundForceState = null;
    this.shakeMixerStates = new Map();
    this.turbulenceStates = new Map();
    this.startedAtSeconds = null;
    this.lastSampleAtSeconds = null;
    this.turbulenceSuppressedUntilSeconds = null;
  }

  angularReference(sourceValues, timeSeconds) {
    const attitude = physicalAttitude(sourceValues);
    const currentOrientation = attitude.valid
      ? orientationMatrix(attitude.pitch, attitude.roll, attitude.heading)
      : null;
    const previous = this.angularReferenceState;
    const dt = previous ? timeSeconds - previous.timeSeconds : 0;
    const validDt = attitude.valid && previous?.orientation &&
      dt > 0.001 && dt <= SAMPLE_GAP_THRESHOLD_SECONDS;
    let rawRates = [0, 0, 0];
    let valid = false;
    if (validDt) {
      rawRates = rotationVectorPerSecond(previous.orientation, currentOrientation, dt);
      // MSFS/A2A Body Y follows increasing heading, while the orientation
      // matrix expresses yaw in the opposite mathematical sense. Real A2A
      // flight logs confirm this sign relation for FM Rotation Acceleration Y.
      rawRates[2] *= -1;
      valid = rawRates.every((value) => Number.isFinite(value) &&
        Math.abs(value) <= FUSION_REFERENCE_RATE_LIMIT_RADPS);
    }
    if (!valid) rawRates = [0, 0, 0];
    const alpha = validDt
      ? 1 - Math.exp(-dt / FUSION_REFERENCE_FILTER_TAU_SECONDS)
      : 1;
    const previousFiltered = previous?.filteredRates || [0, 0, 0];
    const filteredRates = rawRates.map((value, index) => (
      valid ? previousFiltered[index] + alpha * (value - previousFiltered[index]) : 0
    ));
    this.angularReferenceState = {
      timeSeconds,
      orientation: currentOrientation,
      filteredRates
    };
    return { valid, rawRates, filteredRates, attitude };
  }

  fusedAngularVelocity(definition, channel, canonicalAcceleration, timeSeconds, angularReference) {
    const index = definition.index;
    const sign = channel.invert === true ? -1 : 1;
    const gain = finite(channel.scale, 1) * sign;
    const acceleration = canonicalAcceleration * gain;
    const referenceRate = angularReference?.valid
      ? finite(angularReference.filteredRates?.[index], 0) * gain
      : 0;
    const previous = this.angularFusionStates.get(definition.id);
    const dt = previous ? timeSeconds - previous.timeSeconds : 0;
    const validDt = dt > 0.001 && dt <= SAMPLE_GAP_THRESHOLD_SECONDS;
    const prediction = previous && validDt
      ? previous.estimate + acceleration * dt
      : 0;
    const fusionConfig = this.config.rotationFusion;
    const correctionActive = fusionConfig.correctionEnabled &&
      angularReference?.valid && validDt;
    const correctionAlpha = correctionActive
      ? 1 - Math.exp(-dt / fusionConfig.correctionTauSeconds)
      : 0;
    const corrected = prediction + correctionAlpha * (referenceRate - prediction);
    const washoutActive = fusionConfig.residualWashoutEnabled &&
      angularReference?.valid && validDt &&
      Math.abs(acceleration) <= RESIDUAL_WASHOUT_ACCEL_THRESHOLD_RADPS2 &&
      Math.abs(referenceRate) <= RESIDUAL_WASHOUT_REFERENCE_THRESHOLD_RADPS &&
      Math.abs(corrected) <= RESIDUAL_WASHOUT_RATE_LIMIT_RADPS;
    const washoutFactor = washoutActive
      ? Math.exp(-dt / fusionConfig.residualWashoutTauSeconds)
      : 1;
    const estimate = corrected * washoutFactor;
    this.angularFusionStates.set(definition.id, { timeSeconds, estimate });
    return {
      value: estimate + finite(channel.offset, 0),
      fusion: {
        sourceAccelerationRadps2: acceleration,
        referenceRateRadps: referenceRate,
        predictionRadps: prediction,
        correctionRadps: corrected - prediction,
        correctionActive,
        correctionTauSeconds: fusionConfig.correctionTauSeconds,
        washoutCorrectionRadps: estimate - corrected,
        washoutActive,
        washoutTauSeconds: fusionConfig.residualWashoutTauSeconds,
        outputRadps: estimate + finite(channel.offset, 0),
        referenceValid: angularReference?.valid === true
      }
    };
  }

  fusedAngularVelocityV2(definition, channel, canonicalAcceleration, timeSeconds, sourceValues) {
    const sign = channel.invert === true ? -1 : 1;
    const gain = finite(channel.scale, 1) * sign;
    const acceleration = canonicalAcceleration * gain;
    const referenceSourceId = V2_REFERENCE_SOURCE_IDS[definition.id] || '';
    const rawReferenceRate = Number(sourceValues?.[referenceSourceId]);
    const referenceValid = Number.isFinite(rawReferenceRate) &&
      Math.abs(rawReferenceRate) <= FUSION_REFERENCE_RATE_LIMIT_RADPS;
    const referenceRate = referenceValid ? rawReferenceRate * gain : 0;
    const previous = this.angularFusionStates.get(definition.id);
    const dt = previous ? timeSeconds - previous.timeSeconds : 0;
    const validDt = dt > 0.001 && dt <= SAMPLE_GAP_THRESHOLD_SECONDS;
    const fusionConfig = this.config.rotationFusion;

    // Start exactly on the drift-free standard rate and learn the current A2A
    // acceleration as the initial bias. This makes starting/reconnecting the
    // bridge bumpless even when the A2A LVar carries a non-zero resting value.
    const initialEstimate = referenceValid ? referenceRate : 0;
    const previousEstimate = previous && validDt ? previous.estimate : initialEstimate;
    const previousBias = previous && validDt
      ? previous.bias
      : (referenceValid ? acceleration : 0);
    const prediction = validDt
      ? previousEstimate + (acceleration - previousBias) * dt
      : initialEstimate;
    const correctionActive = referenceValid && validDt;
    const correctionAlpha = correctionActive
      ? 1 - Math.exp(-dt / fusionConfig.v2CorrectionTauSeconds)
      : 0;
    const referenceError = referenceRate - prediction;
    const estimate = prediction + correctionAlpha * referenceError;
    const biasCorrection = correctionActive
      ? -referenceError * dt / (fusionConfig.v2BiasTauSeconds ** 2)
      : 0;
    const bias = clamp(previousBias + biasCorrection, -20, 20);
    const detail = referenceValid ? estimate - referenceRate : estimate;
    const mixed = referenceValid
      ? referenceRate + fusionConfig.v2DetailMix * detail
      : estimate;
    const value = mixed + finite(channel.offset, 0);

    this.angularFusionStates.set(definition.id, {
      timeSeconds,
      estimate,
      bias
    });
    return {
      value,
      fusion: {
        v2: true,
        referenceSourceId,
        sourceAccelerationRadps2: acceleration,
        biasRadps2: bias,
        unbiasedAccelerationRadps2: acceleration - bias,
        referenceRateRadps: referenceRate,
        predictionRadps: prediction,
        correctionRadps: estimate - prediction,
        correctionActive,
        correctionTauSeconds: fusionConfig.v2CorrectionTauSeconds,
        detailRadps: detail,
        detailMix: fusionConfig.v2DetailMix,
        washoutCorrectionRadps: 0,
        washoutActive: false,
        washoutTauSeconds: 0,
        outputRadps: value,
        referenceValid
      }
    };
  }

  convert(definition, channel, rawValue, timeSeconds, angularReference = null, sourceValues = {}) {
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
    if (channel.operation === 'fuse') {
      return this.fusedAngularVelocity(
        definition,
        channel,
        canonical,
        timeSeconds,
        angularReference
      );
    }
    if (channel.operation === 'fuse_v2') {
      return this.fusedAngularVelocityV2(
        definition,
        channel,
        canonical,
        timeSeconds,
        sourceValues
      );
    }
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

  groundForcesSignal(sourceValues, timeSeconds) {
    const config = this.config.groundForces;
    const onGroundNumber = Number(sourceValues?.['std.on_ground']);
    const lateralFps2 = Number(sourceValues?.['std.acc.body.x']);
    const longitudinalFps2 = Number(sourceValues?.['std.acc.body.z']);
    if (![onGroundNumber, lateralFps2, longitudinalFps2].every(Number.isFinite)) {
      return { error: translate(this.config.language, 'core.groundForcesNotNumber') };
    }

    const onGround = onGroundNumber >= 0.5;
    const fps2ToG = UNIT_DEFINITIONS.fps2.factor;
    const rawG = [lateralFps2 * fps2ToG, longitudinalFps2 * fps2ToG];
    const previous = this.groundForceState;
    const dt = previous ? timeSeconds - previous.timeSeconds : 0;
    const validDt = dt > 0.001 && dt <= SAMPLE_GAP_THRESHOLD_SECONDS;
    let blend = previous && validDt ? previous.blend : 0;
    let filteredG = previous && validDt ? [...previous.filteredG] : [...rawG];

    if (previous && validDt) {
      const fadeSeconds = onGround ? config.fadeInSeconds : config.fadeOutSeconds;
      // The configured duration reaches roughly 99% of the target while the
      // exponential curve stays continuous at touchdown and lift-off.
      const blendAlpha = 1 - Math.exp(-4.605170186 * dt / fadeSeconds);
      blend += blendAlpha * ((onGround ? 1 : 0) - blend);

      if (onGround) {
        if (!previous.onGround) {
          // Capture the new contact value while the blend is still near zero;
          // stale airborne acceleration must never leak into touchdown.
          filteredG = [...rawG];
        } else {
          const filterAlpha = 1 - Math.exp(-2 * Math.PI * config.filterHz * dt);
          filteredG = previous.filteredG.map((value, index) => (
            value + filterAlpha * (rawG[index] - value)
          ));
        }
      }
      // In flight, hold the last ground sample and fade only the blend. This
      // prevents airborne standard acceleration from replacing AccuSim during
      // the transition.
    }

    blend = clamp(blend, 0, 1);
    const mixes = [config.lateralMix, config.longitudinalMix];
    const unlimitedG = filteredG.map((value, index) => value * mixes[index]);
    const maxExtraG = config.maxExtraG;
    const limitedG = unlimitedG.map((value) => maxExtraG * Math.tanh(value / maxExtraG));
    this.groundForceState = { timeSeconds, onGround, blend, filteredG };
    return {
      valid: true,
      onGround,
      blend,
      rawG,
      filteredG,
      unlimitedG,
      limitedG,
      limited: unlimitedG.map((value) => Math.abs(value) > maxExtraG)
    };
  }

  shakeMixerBranch(sourceValues, definition, timeSeconds) {
    const rawNumber = Number(sourceValues?.[definition.sourceId]);
    if (!Number.isFinite(rawNumber)) {
      return { error: translate(this.config.language, 'core.shakeMixerNotNumber') };
    }

    const config = this.config.shakeMixer;
    const previous = this.shakeMixerStates.get(definition.key);
    const dt = previous ? timeSeconds - previous.timeSeconds : 0;
    const validDt = dt > 0.001 && dt <= SAMPLE_GAP_THRESHOLD_SECONDS;
    const lowCutHz = Math.min(config.centerHz, Math.max(0.05, config.smoothingHz - 0.05));
    const highCutHz = Math.max(config.smoothingHz, lowCutHz + 0.05);
    let slow = rawNumber;
    let fast = rawNumber;
    if (previous && validDt) {
      const slowAlpha = 1 - Math.exp(-2 * Math.PI * lowCutHz * dt);
      const fastAlpha = 1 - Math.exp(-2 * Math.PI * highCutHz * dt);
      slow = previous.slow + slowAlpha * (rawNumber - previous.slow);
      fast = previous.fast + fastAlpha * (rawNumber - previous.fast);
    }
    const band = fast - slow;
    const sourceConfig = config.sources[definition.key];
    const sign = sourceConfig.invert ? -1 : 1;
    const normalized = band / definition.reference * sign;
    const contributionG = sourceConfig.mixes.map((mix) => (
      normalized * config.strengthG * mix
    ));
    this.shakeMixerStates.set(definition.key, { timeSeconds, slow, fast });
    return {
      sourceId: definition.sourceId,
      raw: rawNumber,
      band,
      reference: definition.reference,
      normalized,
      contributionG
    };
  }

  shakeMixerSignal(sourceValues, timeSeconds) {
    const sources = {};
    const unlimitedG = [0, 0, 0];
    for (const definition of SHAKE_MIX_SOURCES) {
      const result = this.shakeMixerBranch(sourceValues, definition, timeSeconds);
      if (result.error) return result;
      sources[definition.key] = result;
      for (let index = 0; index < 3; index += 1) {
        unlimitedG[index] += result.contributionG[index];
      }
    }
    const maxExtraG = this.config.shakeMixer.maxExtraG;
    const extraG = unlimitedG.map((value) => maxExtraG * Math.tanh(value / maxExtraG));
    return {
      valid: true,
      sources,
      unlimitedG,
      extraG,
      limited: unlimitedG.map((value) => Math.abs(value) > maxExtraG)
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
      this.states.clear();
      this.angularFusionStates.clear();
      this.angularReferenceState = null;
      this.groundForceState = null;
      this.shakeMixerStates.clear();
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
    const usesLegacyAngularFusion = OUTPUTS.some((definition) => {
      const channel = this.config.channels[definition.id];
      return channel?.enabled === true && channel.operation === 'fuse';
    });
    const usesV2AngularFusion = OUTPUTS.some((definition) => {
      const channel = this.config.channels[definition.id];
      return channel?.enabled === true && channel.operation === 'fuse_v2';
    });
    const angularReference = usesLegacyAngularFusion
      ? this.angularReference(sourceValues, now)
      : (usesV2AngularFusion
          ? {
              valid: ['std.angular.body.x', 'std.angular.body.z', 'std.angular.body.y']
                .every((sourceId) => Number.isFinite(Number(sourceValues?.[sourceId]))),
              rawRates: [
                finite(sourceValues?.['std.angular.body.x']),
                finite(sourceValues?.['std.angular.body.z']),
                finite(sourceValues?.['std.angular.body.y'])
              ],
              filteredRates: [
                finite(sourceValues?.['std.angular.body.x']),
                finite(sourceValues?.['std.angular.body.z']),
                finite(sourceValues?.['std.angular.body.y'])
              ]
            }
          : null);
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
      attitudeMix: {
        enabled: this.config.attitudeMix.enabled,
        vectorG: [0, 0, 0]
      },
      groundForces: {
        enabled: this.config.groundForces.enabled,
        valid: false,
        onGround: false,
        blend: 0,
        rawG: [0, 0],
        filteredG: [0, 0],
        unlimitedG: [0, 0],
        limitedG: [0, 0],
        appliedG: [0, 0],
        eligible: [false, false],
        limited: [false, false]
      },
      shakeMixer: {
        enabled: this.config.shakeMixer.enabled,
        valid: false,
        sources: Object.fromEntries(SHAKE_MIX_SOURCES.map(({ key, sourceId, reference }) => [key, {
          sourceId,
          raw: 0,
          band: 0,
          reference,
          normalized: 0,
          contributionG: [0, 0, 0]
        }])),
        unlimitedG: [0, 0, 0],
        extraG: [0, 0, 0],
        appliedG: [0, 0, 0],
        eligible: [false, false, false],
        limited: [false, false, false]
      },
      angularReference: angularReference || {
        valid: false,
        rawRates: [0, 0, 0],
        filteredRates: [0, 0, 0]
      },
      angularFusion: {},
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
      const result = this.convert(
        definition,
        channel,
        sourceValues[channel.sourceId],
        now,
        angularReference,
        sourceValues
      );
      if (result.error) {
        errors[definition.id] = result.error;
        continue;
      }
      outputValues[definition.id] = result.value;
      if (result.fusion) diagnostics.angularFusion[definition.id] = result.fusion;
      if (Number.isInteger(definition.index)) {
        if (!arrays.has(definition.packetKey)) arrays.set(definition.packetKey, []);
        arrays.get(definition.packetKey)[definition.index] = result.value;
      } else {
        packet[definition.packetKey] = result.value;
      }
    }

    const acceleration = arrays.get('acc');
    if (acceleration) {
      if (this.config.groundForces.enabled) {
        const groundForces = this.groundForcesSignal(sourceValues, now);
        if (groundForces.error) {
          errors.groundForces = groundForces.error;
        } else {
          const expectedSources = ['a2a.acc.x', 'a2a.acc.z'];
          const eligible = expectedSources.map((sourceId, index) => {
            const channel = this.config.channels[`acc.${index}`];
            return channel?.enabled === true &&
              channel.sourceId === sourceId &&
              channel.operation === 'direct';
          });
          const appliedG = groundForces.limitedG.map((value, index) => {
            if (!eligible[index]) return 0;
            const channel = this.config.channels[`acc.${index}`];
            const sign = channel.invert === true ? -1 : 1;
            return value * groundForces.blend * finite(channel.scale, 1) * sign;
          });
          for (let index = 0; index < 2; index += 1) {
            if (!eligible[index]) continue;
            const outputId = `acc.${index}`;
            acceleration[index] = finite(acceleration[index], 0) + appliedG[index];
            outputValues[outputId] = acceleration[index];
          }
          diagnostics.groundForces = {
            ...diagnostics.groundForces,
            ...groundForces,
            eligible,
            appliedG
          };
        }
      }
      if (this.config.gravity.enabled || this.config.attitudeMix.enabled) {
        const reference = gravityReferenceAttitude(sourceValues, this.config.channels);
        const unitVectorG = gravityVector(reference.pitch, reference.roll, 1);
        const vectorG = this.config.gravity.enabled
          ? unitVectorG.map((value) => value * this.config.gravity.strengthG)
          : [0, 0, 0];
        diagnostics.gravity = {
          ...diagnostics.gravity,
          vectorG,
          referencePitchRad: reference.pitch,
          referenceRollRad: reference.roll,
          referenceValid: reference.valid
        };
        if (this.config.gravity.enabled) {
          for (let index = 0; index < 3; index += 1) {
            const outputId = `acc.${index}`;
            if (!this.config.channels[outputId]?.enabled) continue;
            acceleration[index] = finite(acceleration[index], 0) + vectorG[index];
            outputValues[outputId] = acceleration[index];
          }
        }
        if (this.config.attitudeMix.enabled) {
          // Gravity X/Y above compensate the attitude-correlated A2A FM share.
          // Re-add the opposite share deliberately when the user wants a
          // sustained platform tilt in addition to the transient motion cue.
          const attitudeVectorG = [
            -unitVectorG[0] * this.config.attitudeMix.rollMix,
            -unitVectorG[1] * this.config.attitudeMix.pitchMix,
            0
          ];
          diagnostics.attitudeMix.vectorG = attitudeVectorG;
          for (let index = 0; index < 2; index += 1) {
            const outputId = `acc.${index}`;
            if (!this.config.channels[outputId]?.enabled) continue;
            acceleration[index] = finite(acceleration[index], 0) + attitudeVectorG[index];
            outputValues[outputId] = acceleration[index];
          }
        }
      }
      if (this.config.shakeMixer.enabled) {
        const shakeMixer = this.shakeMixerSignal(sourceValues, now);
        if (shakeMixer.error) {
          errors.shakeMixer = shakeMixer.error;
        } else {
          const eligible = Array.from({ length: 3 }, (_unused, index) => (
            this.config.channels[`acc.${index}`]?.enabled === true
          ));
          const appliedG = shakeMixer.extraG.map((value, index) => (
            eligible[index] ? value : 0
          ));
          for (let index = 0; index < 3; index += 1) {
            if (!eligible[index]) continue;
            const outputId = `acc.${index}`;
            acceleration[index] = finite(acceleration[index], 0) + appliedG[index];
            outputValues[outputId] = acceleration[index];
          }
          diagnostics.shakeMixer = {
            ...diagnostics.shakeMixer,
            ...shakeMixer,
            eligible,
            appliedG
          };
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
  orientationMatrix,
  physicalAttitude,
  requiredSources,
  rotationVectorPerSecond,
  SAMPLE_GAP_THRESHOLD_SECONDS,
  POST_GAP_TURBULENCE_SUPPRESSION_SECONDS
};
