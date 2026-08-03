'use strict';

const G_MPS2 = 9.80665;
const FT_TO_M = 0.3048;
const KNOT_TO_MPS = 0.5144444444444445;
const DEG_TO_RAD = Math.PI / 180;

const UNIT_DEFINITIONS = Object.freeze({
  number: { label: 'Zahl / raw', family: 'scalar', factor: 1 },
  boolean: { label: 'Bool (0/1)', family: 'boolean', factor: 1 },
  ratio: { label: 'Anteil 0…1', family: 'ratio', factor: 1 },
  percent: { label: 'Prozent 0…100', family: 'ratio', factor: 0.01 },
  rpm: { label: 'RPM', family: 'rpm', factor: 1 },
  count: { label: 'Zähler', family: 'count', factor: 1 },
  g: { label: 'G', family: 'acceleration', factor: 1 },
  mps2: { label: 'm/s²', family: 'acceleration', factor: 1 / G_MPS2 },
  fps2: { label: 'ft/s²', family: 'acceleration', factor: FT_TO_M / G_MPS2 },
  radps: { label: 'rad/s', family: 'angularVelocity', factor: 1 },
  degps: { label: '°/s', family: 'angularVelocity', factor: DEG_TO_RAD },
  radps2: { label: 'rad/s²', family: 'angularAcceleration', factor: 1 },
  degps2: { label: '°/s²', family: 'angularAcceleration', factor: DEG_TO_RAD },
  radians: { label: 'Radiant', family: 'angle', factor: 1 },
  degrees: { label: 'Grad', family: 'angle', factor: DEG_TO_RAD },
  mps: { label: 'm/s', family: 'velocity', factor: 1 },
  fps: { label: 'ft/s', family: 'velocity', factor: FT_TO_M },
  knots: { label: 'Knoten', family: 'velocity', factor: KNOT_TO_MPS },
  meters: { label: 'Meter', family: 'length', factor: 1 },
  feet: { label: 'Fuß', family: 'length', factor: FT_TO_M }
});

const OPERATIONS = Object.freeze([
  { id: 'direct', label: 'Direkt / umrechnen' },
  { id: 'integrate', label: 'Integrieren' },
  { id: 'differentiate', label: 'Ableiten' }
]);

function compatibleOperationIds(inputFamily, outputFamily) {
  const operations = [];
  const direct = inputFamily === outputFamily ||
    (outputFamily === 'boolean' && ['scalar', 'ratio', 'count', 'rpm'].includes(inputFamily)) ||
    (outputFamily === 'scalar' && ['boolean', 'ratio', 'count', 'rpm'].includes(inputFamily)) ||
    (outputFamily === 'ratio' && ['boolean', 'scalar'].includes(inputFamily)) ||
    (outputFamily === 'count' && ['boolean', 'scalar'].includes(inputFamily)) ||
    (outputFamily === 'rpm' && inputFamily === 'scalar');
  if (direct) operations.push('direct');
  if ((inputFamily === 'angularAcceleration' && outputFamily === 'angularVelocity') ||
      (inputFamily === 'acceleration' && outputFamily === 'velocity')) {
    operations.push('integrate');
  }
  if ((inputFamily === 'angle' && outputFamily === 'angularVelocity') ||
      (inputFamily === 'velocity' && outputFamily === 'acceleration')) {
    operations.push('differentiate');
  }
  return operations;
}

function safeCompatibleOperationIds(inputFamily, outputFamily) {
  const operations = compatibleOperationIds(inputFamily, outputFamily);
  if (inputFamily === outputFamily) return operations;
  return operations.filter((operation) => operation !== 'direct' ||
    (inputFamily === 'boolean' && outputFamily === 'ratio'));
}

const UNIT_FAMILIES = [...new Set(Object.values(UNIT_DEFINITIONS).map((entry) => entry.family))];
const OPERATION_COMPATIBILITY = Object.freeze(Object.fromEntries(UNIT_FAMILIES.map((inputFamily) => [
  inputFamily,
  Object.freeze(Object.fromEntries(UNIT_FAMILIES.map((outputFamily) => [
    outputFamily,
    Object.freeze(compatibleOperationIds(inputFamily, outputFamily))
  ])))
])));
const SAFE_OPERATION_COMPATIBILITY = Object.freeze(Object.fromEntries(UNIT_FAMILIES.map((inputFamily) => [
  inputFamily,
  Object.freeze(Object.fromEntries(UNIT_FAMILIES.map((outputFamily) => [
    outputFamily,
    Object.freeze(safeCompatibleOperationIds(inputFamily, outputFamily))
  ])))
])));

function source(id, group, label, simVar, simConnectUnit, inputUnit) {
  return { id, group, label, simVar, simConnectUnit, inputUnit };
}

const BUILTIN_SOURCES = Object.freeze([
  { id: 'virtual.zero', group: 'Virtuell', label: 'Konstant 0', virtualValue: 0, inputUnit: 'number' },
  { id: 'virtual.one', group: 'Virtuell', label: 'Konstant 1', virtualValue: 1, inputUnit: 'number' },

  source('a2a.acc.x', 'A2A Flugmodell', 'FM Body Acceleration X', 'L:FM_BodyAccelerationX', 'number', 'mps2'),
  source('a2a.acc.y', 'A2A Flugmodell', 'FM Body Acceleration Y', 'L:FM_BodyAccelerationY', 'number', 'mps2'),
  source('a2a.acc.z', 'A2A Flugmodell', 'FM Body Acceleration Z', 'L:FM_BodyAccelerationZ', 'number', 'mps2'),
  source('a2a.rotacc.x', 'A2A Flugmodell', 'FM Rotation Acceleration X', 'L:FM_BodyRotationAccelerationX', 'number', 'radps2'),
  source('a2a.rotacc.y', 'A2A Flugmodell', 'FM Rotation Acceleration Y', 'L:FM_BodyRotationAccelerationY', 'number', 'radps2'),
  source('a2a.rotacc.z', 'A2A Flugmodell', 'FM Rotation Acceleration Z', 'L:FM_BodyRotationAccelerationZ', 'number', 'radps2'),

  source('a2a.engine.rpm', 'A2A Motor', 'Engine 1 RPM', 'L:Eng1_RPM', 'number', 'rpm'),
  source('a2a.engine.manifold', 'A2A Motor', 'Manifold Pressure', 'L:Eng1_ManifoldPressure', 'number', 'number'),
  source('a2a.engine.fuelFlow', 'A2A Motor', 'Fuel Flow GPH', 'L:Eng1_GPH', 'number', 'number'),
  source('a2a.engine.egt', 'A2A Motor', 'EGT Gauge', 'L:Eng1_EGTGauge', 'number', 'number'),
  source('a2a.engine.cht', 'A2A Motor', 'CHT Gauge', 'L:Eng1_CHTGauge', 'number', 'number'),
  source('a2a.engine.oilTemp', 'A2A Motor', 'Oil Temperature', 'L:Eng1_OilTempGauge', 'number', 'number'),
  source('a2a.engine.oilPressure', 'A2A Motor', 'Oil Pressure', 'L:Eng1_OilPressureGauge', 'number', 'number'),
  source('a2a.engine.fuelPressure', 'A2A Motor', 'Fuel Pressure', 'L:Eng1_FuelPressureGauge', 'number', 'number'),
  source('a2a.engine.suction', 'A2A Motor', 'Suction Pressure', 'L:Eng1_SuctionPressure', 'number', 'number'),
  source('a2a.control.throttle', 'A2A Steuerung', 'Throttle Position', 'L:Throttle1Position', 'number', 'ratio'),
  source('a2a.control.mixture', 'A2A Steuerung', 'Mixture Lever', 'L:Eng1_MixtureManualLever', 'number', 'ratio'),
  source('a2a.control.prop', 'A2A Steuerung', 'RPM Lever Position', 'L:RPMLever1Position', 'number', 'ratio'),
  source('a2a.stall', 'A2A Flugzeug', 'Stall Warning', 'L:LightStallWarning', 'number', 'boolean'),
  source('a2a.flaps', 'A2A Flugzeug', 'Landing Flaps Position', 'L:LandFlapsPos', 'number', 'percent'),
  source('a2a.canopy', 'A2A Flugzeug', 'Exit / Canopy Open', 'L:ExitOpen1', 'number', 'percent'),

  source('std.pitch', 'MSFS Lage', 'Plane Pitch Degrees', 'PLANE PITCH DEGREES', 'degrees', 'degrees'),
  source('std.bank', 'MSFS Lage', 'Plane Bank Degrees', 'PLANE BANK DEGREES', 'degrees', 'degrees'),
  source('std.heading', 'MSFS Lage', 'True Heading', 'PLANE HEADING DEGREES TRUE', 'degrees', 'degrees'),
  source('std.velocity.world.x', 'MSFS Geschwindigkeit', 'Velocity World X', 'VELOCITY WORLD X', 'feet per second', 'fps'),
  source('std.velocity.world.y', 'MSFS Geschwindigkeit', 'Velocity World Y', 'VELOCITY WORLD Y', 'feet per second', 'fps'),
  source('std.velocity.world.z', 'MSFS Geschwindigkeit', 'Velocity World Z', 'VELOCITY WORLD Z', 'feet per second', 'fps'),
  source('std.acc.body.x', 'MSFS Beschleunigung', 'Acceleration Body X', 'ACCELERATION BODY X', 'feet per second squared', 'fps2'),
  source('std.acc.body.y', 'MSFS Beschleunigung', 'Acceleration Body Y', 'ACCELERATION BODY Y', 'feet per second squared', 'fps2'),
  source('std.acc.body.z', 'MSFS Beschleunigung', 'Acceleration Body Z', 'ACCELERATION BODY Z', 'feet per second squared', 'fps2'),
  source('std.angular.body.x', 'MSFS Drehrate', 'Rotation Velocity Body X', 'ROTATION VELOCITY BODY X', 'radians per second', 'radps'),
  source('std.angular.body.y', 'MSFS Drehrate', 'Rotation Velocity Body Y', 'ROTATION VELOCITY BODY Y', 'radians per second', 'radps'),
  source('std.angular.body.z', 'MSFS Drehrate', 'Rotation Velocity Body Z', 'ROTATION VELOCITY BODY Z', 'radians per second', 'radps'),

  source('std.alt.agl', 'MSFS Flugzustand', 'Altitude AGL', 'PLANE ALT ABOVE GROUND', 'feet', 'feet'),
  source('std.alt.msl', 'MSFS Flugzustand', 'Altitude MSL', 'PLANE ALTITUDE', 'feet', 'feet'),
  source('std.airspeed.tas', 'MSFS Flugzustand', 'True Airspeed', 'AIRSPEED TRUE', 'knots', 'knots'),
  source('std.airspeed.ias', 'MSFS Flugzustand', 'Indicated Airspeed', 'AIRSPEED INDICATED', 'knots', 'knots'),
  source('std.mach', 'MSFS Flugzustand', 'Mach', 'AIRSPEED MACH', 'mach', 'number'),
  source('std.aoa', 'MSFS Flugzustand', 'Incidence Alpha / AOA', 'INCIDENCE ALPHA', 'degrees', 'degrees'),
  source('std.aos', 'MSFS Flugzustand', 'Incidence Beta / AOS', 'INCIDENCE BETA', 'radians', 'radians'),
  source('std.verticalSpeed', 'MSFS Flugzustand', 'Vertical Speed', 'VERTICAL SPEED', 'feet per second', 'fps'),
  source('std.stall', 'MSFS Flugzustand', 'Stall Warning', 'STALL WARNING', 'Bool', 'boolean'),

  source('std.wind.x', 'MSFS Wetter', 'Ambient Wind X', 'AMBIENT WIND X', 'meters per second', 'mps'),
  source('std.wind.y', 'MSFS Wetter', 'Ambient Wind Y', 'AMBIENT WIND Y', 'meters per second', 'mps'),
  source('std.wind.z', 'MSFS Wetter', 'Ambient Wind Z', 'AMBIENT WIND Z', 'meters per second', 'mps'),

  source('std.engine1.rpm', 'MSFS Motor', 'General Engine 1 RPM', 'GENERAL ENG RPM:1', 'rpm', 'rpm'),
  source('std.engine2.rpm', 'MSFS Motor', 'General Engine 2 RPM', 'GENERAL ENG RPM:2', 'rpm', 'rpm'),
  source('std.prop1.rpm', 'MSFS Motor', 'Propeller 1 RPM', 'PROP RPM:1', 'rpm', 'rpm'),
  source('std.prop2.rpm', 'MSFS Motor', 'Propeller 2 RPM', 'PROP RPM:2', 'rpm', 'rpm'),

  source('std.flaps', 'MSFS Flugzeug', 'Flaps Handle', 'FLAPS HANDLE PERCENT', 'percent over 100', 'ratio'),
  source('std.gear', 'MSFS Flugzeug', 'Gear Total Extended', 'GEAR TOTAL PCT EXTENDED', 'percent over 100', 'ratio'),
  source('std.gear.left', 'MSFS Flugzeug', 'Gear Left Position', 'GEAR LEFT POSITION', 'percent over 100', 'ratio'),
  source('std.gear.center', 'MSFS Flugzeug', 'Gear Center / Nose Position', 'GEAR CENTER POSITION', 'percent over 100', 'ratio'),
  source('std.gear.right', 'MSFS Flugzeug', 'Gear Right Position', 'GEAR RIGHT POSITION', 'percent over 100', 'ratio'),
  source('std.speedbrakes', 'MSFS Flugzeug', 'Spoilers Handle Position', 'SPOILERS HANDLE POSITION', 'percent over 100', 'ratio'),
  source('std.elevator', 'MSFS Steuerung', 'Elevator Deflection', 'ELEVATOR DEFLECTION PCT', 'percent over 100', 'ratio'),
  source('std.aileron', 'MSFS Steuerung', 'Left Aileron Deflection', 'AILERON LEFT DEFLECTION PCT', 'percent over 100', 'ratio'),
  source('std.rudder', 'MSFS Steuerung', 'Rudder Deflection', 'RUDDER DEFLECTION PCT', 'percent over 100', 'ratio'),
  source('std.elevatorTrim', 'MSFS Steuerung', 'Elevator Trim Position', 'ELEVATOR TRIM POSITION', 'radians', 'radians')
]);

function output(id, group, label, packetKey, targetUnit, options = {}) {
  return { id, group, label, packetKey, targetUnit, ...options };
}

const OUTPUTS = Object.freeze([
  output('acc.0', 'Motion', 'Acceleration lateral', 'acc', 'g', {
    index: 0,
    basic: true,
    simpleSources: [
      { sourceId: 'std.acc.body.x', operation: 'direct' },
      { sourceId: 'a2a.acc.x', operation: 'direct' }
    ]
  }),
  output('acc.1', 'Motion', 'Acceleration longitudinal', 'acc', 'g', {
    index: 1,
    basic: true,
    simpleSources: [
      { sourceId: 'std.acc.body.z', operation: 'direct' },
      { sourceId: 'a2a.acc.z', operation: 'direct' }
    ]
  }),
  output('acc.2', 'Motion', 'Acceleration vertical', 'acc', 'g', {
    index: 2,
    basic: true,
    simpleSources: [
      { sourceId: 'std.acc.body.y', operation: 'direct' },
      { sourceId: 'a2a.acc.y', operation: 'direct' }
    ]
  }),
  output('ang_vel.0', 'Motion', 'Angular Velocity pitch', 'ang_vel', 'radps', {
    index: 0,
    basic: true,
    simpleSources: [
      { sourceId: 'std.angular.body.x', operation: 'direct' },
      { sourceId: 'a2a.rotacc.x', operation: 'integrate' }
    ]
  }),
  output('ang_vel.1', 'Motion', 'Angular Velocity roll', 'ang_vel', 'radps', {
    index: 1,
    basic: true,
    simpleSources: [
      { sourceId: 'std.angular.body.z', operation: 'direct' },
      { sourceId: 'a2a.rotacc.z', operation: 'integrate' }
    ]
  }),
  output('ang_vel.2', 'Motion', 'Angular Velocity yaw', 'ang_vel', 'radps', {
    index: 2,
    basic: true,
    simpleSources: [
      { sourceId: 'std.angular.body.y', operation: 'direct' },
      { sourceId: 'a2a.rotacc.y', operation: 'integrate' }
    ]
  }),
  output('vel.0', 'Motion', 'Global Velocity east', 'vel', 'mps', { index: 0 }),
  output('vel.1', 'Motion', 'Global Velocity north', 'vel', 'mps', { index: 1 }),
  output('vel.2', 'Motion', 'Global Velocity up', 'vel', 'mps', { index: 2 }),
  output('pitch', 'Motion', 'Pitch', 'pitch', 'radians', {
    basic: true,
    simpleSources: [{ sourceId: 'std.pitch', operation: 'direct' }]
  }),
  output('roll', 'Motion', 'Roll', 'roll', 'radians', {
    basic: true,
    simpleSources: [{ sourceId: 'std.bank', operation: 'direct' }]
  }),
  output('yaw', 'Motion', 'Yaw / Heading', 'yaw', 'radians', {
    basic: true,
    simpleSources: [{ sourceId: 'std.heading', operation: 'direct' }]
  }),
  output('alt_agl', 'Motion', 'Altitude AGL', 'alt_agl', 'meters', {
    basic: true,
    simpleSources: [{ sourceId: 'std.alt.agl', operation: 'direct' }]
  }),
  output('alt_msl', 'Motion', 'Altitude MSL', 'alt_msl', 'meters'),
  output('tas', 'Motion', 'True Airspeed', 'tas', 'mps', { min: 0 }),

  output('aoa', 'Aerodynamics', 'Angle of Attack', 'aoa', 'radians'),
  output('aos', 'Aerodynamics', 'Angle of Sideslip', 'aos', 'radians'),
  output('ias', 'Aerodynamics', 'Indicated Airspeed', 'ias', 'mps', {
    min: 0,
    basic: true,
    simpleSources: [{ sourceId: 'std.airspeed.ias', operation: 'direct' }]
  }),
  output('mach', 'Aerodynamics', 'Mach', 'mach', 'number', { min: 0 }),
  output('wind.0', 'Aerodynamics', 'Wind east', 'wind', 'mps', { index: 0 }),
  output('wind.1', 'Aerodynamics', 'Wind north', 'wind', 'mps', { index: 1 }),
  output('wind.2', 'Aerodynamics', 'Wind up', 'wind', 'mps', { index: 2 }),
  output('shake', 'Aerodynamics', 'Generic Shake', 'shake', 'ratio', { min: 0, max: 1 }),
  ...Array.from({ length: 8 }, (_, index) => output(
    `panel_shake.${index}`,
    'Aerodynamics',
    `Panel Shake ${index + 1}`,
    'panel_shake',
    'ratio',
    { index, min: 0, max: 1 }
  )),
  output('stall', 'Aerodynamics', 'Stall Warning', 'stall', 'boolean', {
    basic: true,
    simpleSources: [
      { sourceId: 'std.stall', operation: 'direct' },
      { sourceId: 'a2a.stall', operation: 'direct' }
    ]
  }),

  output('rpm_left', 'Engine', 'Engine RPM left', 'rpm_left', 'rpm', {
    min: 0,
    basic: true,
    simpleSources: [
      { sourceId: 'std.engine1.rpm', operation: 'direct' },
      { sourceId: 'a2a.engine.rpm', operation: 'direct' }
    ]
  }),
  output('rpm_right', 'Engine', 'Engine RPM right', 'rpm_right', 'rpm', { min: 0 }),
  output('prop_rpm', 'Engine', 'Propeller RPM', 'prop_rpm', 'rpm', {
    min: 0,
    basic: true,
    simpleSources: [
      { sourceId: 'std.prop1.rpm', operation: 'direct' },
      { sourceId: 'a2a.engine.rpm', operation: 'direct' }
    ]
  }),
  output('rotor_rpm', 'Rotor', 'Main Rotor RPM', 'rotor_rpm', 'rpm', { min: 0 }),

  output('gear_left', 'Gear & Surfaces', 'Gear left', 'gear_left', 'ratio', { min: 0, max: 1 }),
  output('gear_nose', 'Gear & Surfaces', 'Gear nose', 'gear_nose', 'ratio', { min: 0, max: 1 }),
  output('gear_right', 'Gear & Surfaces', 'Gear right', 'gear_right', 'ratio', { min: 0, max: 1 }),
  output('flaps', 'Gear & Surfaces', 'Flaps', 'flaps', 'ratio', { min: 0, max: 1 }),
  output('speedbrakes', 'Gear & Surfaces', 'Speedbrakes', 'speedbrakes', 'ratio', { min: 0, max: 1 }),
  output('canopy', 'Gear & Surfaces', 'Canopy', 'canopy', 'ratio', { min: 0, max: 1 }),
  output('gear', 'Gear & Surfaces', 'Gear overall', 'gear', 'ratio', { min: 0, max: 1 }),
  output('afterburner.0', 'Gear & Surfaces', 'Afterburner left', 'afterburner', 'ratio', { index: 0, min: 0, max: 1 }),
  output('afterburner.1', 'Gear & Surfaces', 'Afterburner right', 'afterburner', 'ratio', { index: 1, min: 0, max: 1 }),

  output('cannon_rounds_fired', 'Weapons', 'Cannon rounds fired', 'cannon_rounds_fired', 'count', { min: 0, integer: true }),
  output('missiles_released', 'Weapons', 'Missiles released', 'missiles_released', 'count', { min: 0, integer: true }),
  output('bombs_released', 'Weapons', 'Bombs released', 'bombs_released', 'count', { min: 0, integer: true }),
  output('rockets_released', 'Weapons', 'Rockets released', 'rockets_released', 'count', { min: 0, integer: true }),
  output('flares_released', 'Weapons', 'Flares released', 'flares_released', 'count', { min: 0, integer: true }),
  output('chaff_released', 'Weapons', 'Chaff released', 'chaff_released', 'count', { min: 0, integer: true }),
  output('damage_total', 'Damage', 'Structural damage total', 'damage_total', 'number', { min: 0 })
]);

const SAFE_SOURCE_IDS = Object.freeze({
  'acc.0': ['std.acc.body.x', 'a2a.acc.x'],
  'acc.1': ['std.acc.body.z', 'a2a.acc.z'],
  'acc.2': ['std.acc.body.y', 'a2a.acc.y'],
  'ang_vel.0': ['std.angular.body.x', 'a2a.rotacc.x'],
  'ang_vel.1': ['std.angular.body.z', 'a2a.rotacc.z'],
  'ang_vel.2': ['std.angular.body.y', 'a2a.rotacc.y'],
  'vel.0': ['std.velocity.world.x'],
  'vel.1': ['std.velocity.world.z'],
  'vel.2': ['std.velocity.world.y'],
  pitch: ['std.pitch'],
  roll: ['std.bank'],
  yaw: ['std.heading'],
  alt_agl: ['std.alt.agl'],
  alt_msl: ['std.alt.msl'],
  tas: ['std.airspeed.tas'],
  aoa: ['std.aoa'],
  aos: ['std.aos'],
  ias: ['std.airspeed.ias'],
  mach: ['std.mach'],
  'wind.0': ['std.wind.x'],
  'wind.1': ['std.wind.z'],
  'wind.2': ['std.wind.y'],
  shake: ['std.stall', 'a2a.stall'],
  stall: ['std.stall', 'a2a.stall'],
  rpm_left: ['std.engine1.rpm', 'a2a.engine.rpm'],
  rpm_right: ['std.engine2.rpm'],
  prop_rpm: ['std.prop1.rpm', 'a2a.engine.rpm'],
  gear_left: ['std.gear.left'],
  gear_nose: ['std.gear.center'],
  gear_right: ['std.gear.right'],
  flaps: ['std.flaps', 'a2a.flaps'],
  speedbrakes: ['std.speedbrakes'],
  canopy: ['a2a.canopy'],
  gear: ['std.gear']
});

const DEFAULT_CHANNELS = Object.freeze({
  'acc.0': { enabled: true, sourceId: 'a2a.acc.x', inputUnit: 'mps2', operation: 'direct', scale: 1, offset: 0 },
  'acc.1': { enabled: true, sourceId: 'a2a.acc.z', inputUnit: 'mps2', operation: 'direct', scale: 1, offset: 0 },
  'acc.2': { enabled: true, sourceId: 'a2a.acc.y', inputUnit: 'mps2', operation: 'direct', scale: 1, offset: 0 },
  'ang_vel.0': { enabled: true, sourceId: 'std.angular.body.x', inputUnit: 'radps', operation: 'direct', scale: 1, offset: 0 },
  'ang_vel.1': { enabled: true, sourceId: 'std.angular.body.z', inputUnit: 'radps', operation: 'direct', scale: 1, offset: 0 },
  'ang_vel.2': { enabled: true, sourceId: 'std.angular.body.y', inputUnit: 'radps', operation: 'direct', scale: 1, offset: 0 },
  'vel.0': { enabled: false, sourceId: 'std.velocity.world.x', inputUnit: 'fps', operation: 'direct', scale: 1, offset: 0 },
  'vel.1': { enabled: false, sourceId: 'std.velocity.world.z', inputUnit: 'fps', operation: 'direct', scale: 1, offset: 0 },
  'vel.2': { enabled: false, sourceId: 'std.velocity.world.y', inputUnit: 'fps', operation: 'direct', scale: 1, offset: 0 },
  pitch: { enabled: true, sourceId: 'std.pitch', inputUnit: 'degrees', operation: 'direct', scale: 1, offset: 0 },
  roll: { enabled: true, sourceId: 'std.bank', inputUnit: 'degrees', operation: 'direct', scale: 1, offset: 0 },
  yaw: { enabled: true, sourceId: 'std.heading', inputUnit: 'degrees', operation: 'direct', scale: -1, offset: 0 },
  alt_agl: { enabled: true, sourceId: 'std.alt.agl', inputUnit: 'feet', operation: 'direct', scale: 1, offset: 0 },
  alt_msl: { enabled: false, sourceId: 'std.alt.msl', inputUnit: 'feet', operation: 'direct', scale: 1, offset: 0 },
  tas: { enabled: false, sourceId: 'std.airspeed.tas', inputUnit: 'knots', operation: 'direct', scale: 1, offset: 0 },
  aoa: { enabled: false, sourceId: 'std.aoa', inputUnit: 'degrees', operation: 'direct', scale: 1, offset: 0 },
  aos: { enabled: false, sourceId: 'std.aos', inputUnit: 'radians', operation: 'direct', scale: 1, offset: 0 },
  ias: { enabled: true, sourceId: 'std.airspeed.ias', inputUnit: 'knots', operation: 'direct', scale: 1, offset: 0 },
  mach: { enabled: false, sourceId: 'std.mach', inputUnit: 'number', operation: 'direct', scale: 1, offset: 0 },
  'wind.0': { enabled: false, sourceId: 'std.wind.x', inputUnit: 'mps', operation: 'direct', scale: 1, offset: 0 },
  'wind.1': { enabled: false, sourceId: 'std.wind.z', inputUnit: 'mps', operation: 'direct', scale: 1, offset: 0 },
  'wind.2': { enabled: false, sourceId: 'std.wind.y', inputUnit: 'mps', operation: 'direct', scale: 1, offset: 0 },
  stall: { enabled: true, sourceId: 'a2a.stall', inputUnit: 'boolean', operation: 'direct', scale: 1, offset: 0 },
  rpm_left: { enabled: true, sourceId: 'a2a.engine.rpm', inputUnit: 'rpm', operation: 'direct', scale: 1, offset: 0 },
  prop_rpm: { enabled: true, sourceId: 'a2a.engine.rpm', inputUnit: 'rpm', operation: 'direct', scale: 1, offset: 0 },
  gear_left: { enabled: false, sourceId: 'std.gear.left', inputUnit: 'ratio', operation: 'direct', scale: 1, offset: 0 },
  gear_nose: { enabled: false, sourceId: 'std.gear.center', inputUnit: 'ratio', operation: 'direct', scale: 1, offset: 0 },
  gear_right: { enabled: false, sourceId: 'std.gear.right', inputUnit: 'ratio', operation: 'direct', scale: 1, offset: 0 },
  flaps: { enabled: false, sourceId: 'std.flaps', inputUnit: 'ratio', operation: 'direct', scale: 1, offset: 0 },
  speedbrakes: { enabled: false, sourceId: 'std.speedbrakes', inputUnit: 'ratio', operation: 'direct', scale: 1, offset: 0 },
  canopy: { enabled: false, sourceId: 'a2a.canopy', inputUnit: 'percent', operation: 'direct', scale: 1, offset: 0 },
  gear: { enabled: false, sourceId: 'std.gear', inputUnit: 'ratio', operation: 'direct', scale: 1, offset: 0 }
});

function defaultChannelFor(outputDefinition) {
  return DEFAULT_CHANNELS[outputDefinition.id] || {
    enabled: false,
    sourceId: '',
    inputUnit: outputDefinition.targetUnit,
    operation: 'direct',
    scale: 1,
    offset: 0
  };
}

function buildDefaultConfig() {
  return {
    schemaVersion: 2,
    expertMode: false,
    unsafeMode: false,
    name: 'A2A_PA24_250_Comanche_MSFS',
    host: '127.0.0.1',
    port: 4135,
    period: 'visual',
    customSources: [],
    channels: Object.fromEntries(OUTPUTS.map((definition) => [
      definition.id,
      { ...defaultChannelFor(definition) }
    ]))
  };
}

module.exports = {
  BUILTIN_SOURCES,
  DEFAULT_CHANNELS,
  OPERATION_COMPATIBILITY,
  OPERATIONS,
  OUTPUTS,
  SAFE_SOURCE_IDS,
  SAFE_OPERATION_COMPATIBILITY,
  UNIT_DEFINITIONS,
  buildDefaultConfig,
  compatibleOperationIds,
  defaultChannelFor,
  safeCompatibleOperationIds
};
