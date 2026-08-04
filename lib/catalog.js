'use strict';

const G_MPS2 = 9.80665;
const FT_TO_M = 0.3048;
const KNOT_TO_MPS = 0.5144444444444445;
const DEG_TO_RAD = Math.PI / 180;

const UNIT_DEFINITIONS = Object.freeze({
  number: { label: 'Zahl / raw', labelEn: 'Number / raw', family: 'scalar', factor: 1 },
  boolean: { label: 'Bool (0/1)', labelEn: 'Boolean (0/1)', family: 'boolean', factor: 1 },
  ratio: { label: 'Anteil 0…1', labelEn: 'Ratio 0…1', family: 'ratio', factor: 1 },
  percent: { label: 'Prozent 0…100', labelEn: 'Percent 0…100', family: 'ratio', factor: 0.01 },
  rpm: { label: 'RPM', labelEn: 'RPM', family: 'rpm', factor: 1 },
  count: { label: 'Zähler', labelEn: 'Counter', family: 'count', factor: 1 },
  g: { label: 'G', labelEn: 'G', family: 'acceleration', factor: 1 },
  mps2: { label: 'm/s²', labelEn: 'm/s²', family: 'acceleration', factor: 1 / G_MPS2 },
  fps2: { label: 'ft/s²', labelEn: 'ft/s²', family: 'acceleration', factor: FT_TO_M / G_MPS2 },
  radps: { label: 'rad/s', labelEn: 'rad/s', family: 'angularVelocity', factor: 1 },
  degps: { label: '°/s', labelEn: '°/s', family: 'angularVelocity', factor: DEG_TO_RAD },
  radps2: { label: 'rad/s²', labelEn: 'rad/s²', family: 'angularAcceleration', factor: 1 },
  degps2: { label: '°/s²', labelEn: '°/s²', family: 'angularAcceleration', factor: DEG_TO_RAD },
  radians: { label: 'Radiant', labelEn: 'Radians', family: 'angle', factor: 1 },
  degrees: { label: 'Grad', labelEn: 'Degrees', family: 'angle', factor: DEG_TO_RAD },
  mps: { label: 'm/s', labelEn: 'm/s', family: 'velocity', factor: 1 },
  fps: { label: 'ft/s', labelEn: 'ft/s', family: 'velocity', factor: FT_TO_M },
  knots: { label: 'Knoten', labelEn: 'Knots', family: 'velocity', factor: KNOT_TO_MPS },
  meters: { label: 'Meter', labelEn: 'Meters', family: 'length', factor: 1 },
  feet: { label: 'Fuß', labelEn: 'Feet', family: 'length', factor: FT_TO_M }
});

const OPERATIONS = Object.freeze([
  { id: 'direct', label: 'Direkt / umrechnen', labelEn: 'Direct / convert' },
  { id: 'integrate', label: 'Integrieren', labelEn: 'Integrate' },
  { id: 'differentiate', label: 'Ableiten', labelEn: 'Differentiate' }
]);

const GROUP_LABELS = Object.freeze({
  Virtuell: { de: 'Virtuell', en: 'Virtual' },
  'A2A Flugmodell': { de: 'A2A Flugmodell', en: 'A2A flight model' },
  'A2A Motor': { de: 'A2A Motor', en: 'A2A engine' },
  'A2A Steuerung': { de: 'A2A Steuerung', en: 'A2A controls' },
  'A2A Flugzeug': { de: 'A2A Flugzeug', en: 'A2A aircraft' },
  'MSFS Lage': { de: 'MSFS Lage', en: 'MSFS attitude' },
  'MSFS Geschwindigkeit': { de: 'MSFS Geschwindigkeit', en: 'MSFS velocity' },
  'MSFS Beschleunigung': { de: 'MSFS Beschleunigung', en: 'MSFS acceleration' },
  'MSFS Drehrate': { de: 'MSFS Drehrate', en: 'MSFS angular rate' },
  'MSFS Drehbeschleunigung': { de: 'MSFS Drehbeschleunigung', en: 'MSFS angular acceleration' },
  'MSFS Flugzustand': { de: 'MSFS Flugzustand', en: 'MSFS flight state' },
  'MSFS Wetter': { de: 'MSFS Wetter', en: 'MSFS weather' },
  'MSFS Motor': { de: 'MSFS Motor', en: 'MSFS engine' },
  'MSFS Flugzeug': { de: 'MSFS Flugzeug', en: 'MSFS aircraft' },
  'MSFS Steuerung': { de: 'MSFS Steuerung', en: 'MSFS controls' },
  'Eigene LVars': { de: 'Eigene LVars', en: 'Custom LVars' },
  Motion: { de: 'Motion', en: 'Motion' },
  Aerodynamics: { de: 'Aerodynamik', en: 'Aerodynamics' },
  Engine: { de: 'Motor', en: 'Engine' },
  Rotor: { de: 'Rotor', en: 'Rotor' },
  'Gear & Surfaces': { de: 'Fahrwerk & Klappen', en: 'Gear & Surfaces' },
  Weapons: { de: 'Waffen', en: 'Weapons' },
  Damage: { de: 'Schaden', en: 'Damage' },
  Sonstige: { de: 'Sonstige', en: 'Other' }
});

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
  { id: 'virtual.zero', group: 'Virtuell', label: 'Konstant 0', labelEn: 'Constant 0', virtualValue: 0, inputUnit: 'number' },
  { id: 'virtual.one', group: 'Virtuell', label: 'Konstant 1', labelEn: 'Constant 1', virtualValue: 1, inputUnit: 'number' },

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
  source('std.velocity.body.y', 'MSFS Geschwindigkeit', 'Velocity Body Y', 'VELOCITY BODY Y', 'feet per second', 'fps'),
  source('std.wind.relative.body.y', 'MSFS Geschwindigkeit', 'Relative Wind Velocity Body Y', 'RELATIVE WIND VELOCITY BODY Y', 'feet per second', 'fps'),
  source('std.acc.body.x', 'MSFS Beschleunigung', 'Acceleration Body X', 'ACCELERATION BODY X', 'feet per second squared', 'fps2'),
  source('std.acc.body.y', 'MSFS Beschleunigung', 'Acceleration Body Y', 'ACCELERATION BODY Y', 'feet per second squared', 'fps2'),
  source('std.acc.body.z', 'MSFS Beschleunigung', 'Acceleration Body Z', 'ACCELERATION BODY Z', 'feet per second squared', 'fps2'),
  source('std.acc.world.y', 'MSFS Beschleunigung', 'Acceleration World Y', 'ACCELERATION WORLD Y', 'feet per second squared', 'fps2'),
  source('std.gforce', 'MSFS Beschleunigung', 'G Force', 'G FORCE', 'GForce', 'g'),
  source('std.angular.body.x', 'MSFS Drehrate', 'Rotation Velocity Body X', 'ROTATION VELOCITY BODY X', 'radians per second', 'radps'),
  source('std.angular.body.y', 'MSFS Drehrate', 'Rotation Velocity Body Y', 'ROTATION VELOCITY BODY Y', 'radians per second', 'radps'),
  source('std.angular.body.z', 'MSFS Drehrate', 'Rotation Velocity Body Z', 'ROTATION VELOCITY BODY Z', 'radians per second', 'radps'),
  source('std.rotacc.body.x', 'MSFS Drehbeschleunigung', 'Rotation Acceleration Body X', 'ROTATION ACCELERATION BODY X', 'radians per second squared', 'radps2'),
  source('std.rotacc.body.y', 'MSFS Drehbeschleunigung', 'Rotation Acceleration Body Y', 'ROTATION ACCELERATION BODY Y', 'radians per second squared', 'radps2'),
  source('std.rotacc.body.z', 'MSFS Drehbeschleunigung', 'Rotation Acceleration Body Z', 'ROTATION ACCELERATION BODY Z', 'radians per second squared', 'radps2'),

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
  source('std.wind.aircraft.y', 'MSFS Wetter', 'Aircraft Wind Y', 'AIRCRAFT WIND Y', 'knots', 'knots'),
  source('std.cloud.density', 'MSFS Wetter', 'Environment Cloud Density', 'ENV CLOUD DENSITY', 'percent over 100', 'ratio'),

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

const OUTPUT_LOCALIZATION = Object.freeze({
  'acc.0': { de: 'Beschleunigung quer', en: 'Lateral acceleration', helpDe: 'Querbeschleunigung auf der DCS-Körperachse in G. DRSM nutzt sie vor allem für Sway und anteilig Roll-Cues.', helpEn: 'Acceleration on the lateral DCS body axis in G. DRSM primarily uses it for sway and partly for roll cues.' },
  'acc.1': { de: 'Beschleunigung längs', en: 'Longitudinal acceleration', helpDe: 'Längsbeschleunigung auf der DCS-Körperachse in G. Positive und negative Änderungen treiben hauptsächlich Surge- und Pitch-Cues.', helpEn: 'Acceleration on the longitudinal DCS body axis in G. Positive and negative changes mainly drive surge and pitch cues.' },
  'acc.2': { de: 'Beschleunigung vertikal', en: 'Vertical acceleration', helpDe: 'Vertikalbeschleunigung auf der DCS-Körperachse in G. Enthält bei aktiver Gravity Reference die Ruhelast und speist Heave sowie Turbulenzstöße.', helpEn: 'Acceleration on the vertical DCS body axis in G. With gravity reference enabled it includes resting load and drives heave and turbulence cues.' },
  'ang_vel.0': { de: 'Drehrate Pitch', en: 'Pitch angular velocity', helpDe: 'Nickrate um die DCS-Pitchachse in rad/s. DRSM verwendet sie für schnelle Pitch-Bewegungen; Drehbeschleunigung muss dafür integriert werden.', helpEn: 'Pitch rate around the DCS pitch axis in rad/s. DRSM uses it for rapid pitch motion; angular acceleration must be integrated first.' },
  'ang_vel.1': { de: 'Drehrate Roll', en: 'Roll angular velocity', helpDe: 'Rollrate um die DCS-Rollachse in rad/s. Sie ergänzt den absoluten Rollwinkel um die Geschwindigkeit der Bewegung.', helpEn: 'Roll rate around the DCS roll axis in rad/s. It complements the absolute roll angle with motion speed.' },
  'ang_vel.2': { de: 'Drehrate Yaw', en: 'Yaw angular velocity', helpDe: 'Gierrate um die DCS-Yawachse in rad/s. Sie liefert DRSM schnelle Dreh- und Slip-Cues.', helpEn: 'Yaw rate around the DCS yaw axis in rad/s. It supplies rapid rotation and slip cues to DRSM.' },
  'vel.0': { de: 'Globale Geschwindigkeit Ost', en: 'Global velocity east', helpDe: 'Globale Ost-West-Geschwindigkeit in m/s. Optionaler Bestandteil des immer dreiteiligen DCS-Geschwindigkeitsvektors.', helpEn: 'Global east-west velocity in m/s. Optional member of the fixed three-element DCS velocity vector.' },
  'vel.1': { de: 'Globale Geschwindigkeit Nord', en: 'Global velocity north', helpDe: 'Globale Nord-Süd-Geschwindigkeit in m/s. Optionaler Navigationswert, kein direkter Körperachsen-Cue.', helpEn: 'Global north-south velocity in m/s. Optional navigation value rather than a direct body-axis cue.' },
  'vel.2': { de: 'Globale Geschwindigkeit oben', en: 'Global velocity up', helpDe: 'Globale Vertikalgeschwindigkeit in m/s, positiv nach oben. Kann für vertikale Bewegungslogik verwendet werden.', helpEn: 'Global vertical velocity in m/s, positive upward. It can support vertical motion logic.' },
  pitch: { de: 'Pitch / Nicklage', en: 'Pitch attitude', helpDe: 'Absolute Nicklage in Radiant. DRSM nutzt sie für Lage- und Washout-Cues; die Standardzuordnung korrigiert das MSFS-Vorzeichen.', helpEn: 'Absolute pitch attitude in radians. DRSM uses it for attitude and washout cues; the default mapping corrects the MSFS sign.' },
  roll: { de: 'Roll / Querlage', en: 'Roll attitude', helpDe: 'Absolute Querlage in Radiant. Die Standardzuordnung korrigiert das MSFS-Vorzeichen für die DCS-Konvention.', helpEn: 'Absolute bank attitude in radians. The default mapping corrects the MSFS sign for the DCS convention.' },
  yaw: { de: 'Yaw / Steuerkurs', en: 'Yaw / heading', helpDe: 'Absoluter wahrer Steuerkurs in Radiant. Wird für die Ausrichtung verwendet; die Standardzuordnung invertiert auf die DCS-Konvention.', helpEn: 'Absolute true heading in radians. Used for orientation; the default mapping inverts it to the DCS convention.' },
  alt_agl: { de: 'Höhe über Grund', en: 'Altitude AGL', helpDe: 'Höhe über dem Gelände in Metern. Hilft DRSM, Boden- und Flugzustände voneinander zu unterscheiden.', helpEn: 'Height above terrain in meters. Helps DRSM distinguish ground and airborne states.' },
  alt_msl: { de: 'Höhe über Meeresspiegel', en: 'Altitude MSL', helpDe: 'Druck-/Flughöhe über Meeresspiegel in Metern. Optionaler Kontextwert für Profile und Logik.', helpEn: 'Altitude above mean sea level in meters. Optional context for profiles and logic.' },
  tas: { de: 'Wahre Fluggeschwindigkeit', en: 'True airspeed', helpDe: 'Wahre Fluggeschwindigkeit in m/s. Beschreibt die Geschwindigkeit relativ zur Luftmasse.', helpEn: 'True airspeed in m/s. Describes speed relative to the air mass.' },
  aoa: { de: 'Anstellwinkel', en: 'Angle of attack', helpDe: 'Anstellwinkel in Radiant. Nützlich für aerodynamische Last-, Buffet- und Stall-Cues.', helpEn: 'Angle of attack in radians. Useful for aerodynamic load, buffet and stall cues.' },
  aos: { de: 'Schiebewinkel', en: 'Angle of sideslip', helpDe: 'Schiebewinkel in Radiant. Kann seitliche aerodynamische Cues ergänzen.', helpEn: 'Sideslip angle in radians. Can add lateral aerodynamic cues.' },
  ias: { de: 'Angezeigte Fluggeschwindigkeit', en: 'Indicated airspeed', helpDe: 'Angezeigte Fluggeschwindigkeit in m/s. DRSM kann damit Cue-Stärken und Flugzustände geschwindigkeitsabhängig skalieren.', helpEn: 'Indicated airspeed in m/s. DRSM can use it to scale cue strength and flight states by airspeed.' },
  mach: { de: 'Machzahl', en: 'Mach number', helpDe: 'Dimensionslose Machzahl. Vor allem für schnelle Flugzeuge und transsonische Effekte relevant.', helpEn: 'Dimensionless Mach number. Mainly relevant to fast aircraft and transonic effects.' },
  'wind.0': { de: 'Wind Ost', en: 'Wind east', helpDe: 'Östliche Komponente des globalen Windvektors in m/s.', helpEn: 'East component of the global wind vector in m/s.' },
  'wind.1': { de: 'Wind Nord', en: 'Wind north', helpDe: 'Nördliche Komponente des globalen Windvektors in m/s.', helpEn: 'North component of the global wind vector in m/s.' },
  'wind.2': { de: 'Wind oben', en: 'Wind up', helpDe: 'Vertikale Komponente des globalen Windvektors in m/s. Sie ist nicht identisch mit lokaler Turbulenz am Flugzeug.', helpEn: 'Upward component of the global wind vector in m/s. It is not the same as local turbulence at the aircraft.' },
  shake: { de: 'Allgemeines Rütteln', en: 'Generic shake', helpDe: 'Normierte Rüttelstärke von 0 bis 1. Kann für Buffet, Stall oder andere Vibrationen verwendet werden.', helpEn: 'Normalized shake intensity from 0 to 1. Can represent buffet, stall or other vibration.' },
  stall: { de: 'Stallwarnung', en: 'Stall warning', helpDe: 'Binäres Stallwarnsignal 0/1. Eignet sich als Schalter für Buffet- oder Stall-Effekte.', helpEn: 'Binary stall warning signal 0/1. Suitable as a switch for buffet or stall effects.' },
  rpm_left: { de: 'Motordrehzahl links', en: 'Left engine RPM', helpDe: 'Drehzahl des linken beziehungsweise ersten Motors in RPM. Kann vibrations- und drehzahlabhängige Effekte treiben.', helpEn: 'Left or first engine speed in RPM. Can drive vibration and RPM-dependent effects.' },
  rpm_right: { de: 'Motordrehzahl rechts', en: 'Right engine RPM', helpDe: 'Drehzahl des rechten beziehungsweise zweiten Motors in RPM.', helpEn: 'Right or second engine speed in RPM.' },
  prop_rpm: { de: 'Propellerdrehzahl', en: 'Propeller RPM', helpDe: 'Propellerdrehzahl in RPM. Bei der Comanche kann derselbe A2A-Motorwert als Ausgangspunkt dienen.', helpEn: 'Propeller speed in RPM. For the Comanche the same A2A engine value can serve as the initial source.' },
  rotor_rpm: { de: 'Hauptrotordrehzahl', en: 'Main rotor RPM', helpDe: 'Drehzahl des Hauptrotors in RPM. Nur für Hubschrauberprofile relevant.', helpEn: 'Main rotor speed in RPM. Relevant only to helicopter profiles.' },
  gear_left: { de: 'Fahrwerk links', en: 'Left gear', helpDe: 'Ausfahrposition des linken Fahrwerks von 0 bis 1. Kann Fahrwerksstöße und Bodenzustand unterstützen.', helpEn: 'Left landing-gear extension from 0 to 1. Can support gear-bump and ground-state effects.' },
  gear_nose: { de: 'Bugfahrwerk', en: 'Nose gear', helpDe: 'Ausfahrposition des Bug- oder Mittelfahrwerks von 0 bis 1.', helpEn: 'Nose or center landing-gear extension from 0 to 1.' },
  gear_right: { de: 'Fahrwerk rechts', en: 'Right gear', helpDe: 'Ausfahrposition des rechten Fahrwerks von 0 bis 1.', helpEn: 'Right landing-gear extension from 0 to 1.' },
  flaps: { de: 'Landeklappen', en: 'Flaps', helpDe: 'Klappenstellung von 0 bis 1. Optionaler Zustandswert für Profil- und Aerodynamikeffekte.', helpEn: 'Flap extension from 0 to 1. Optional state value for profile and aerodynamic effects.' },
  speedbrakes: { de: 'Störklappen', en: 'Speedbrakes', helpDe: 'Stör- oder Bremsklappenstellung von 0 bis 1.', helpEn: 'Speedbrake or spoiler extension from 0 to 1.' },
  canopy: { de: 'Haube / Tür', en: 'Canopy / door', helpDe: 'Öffnungsgrad der Haube oder Tür von 0 bis 1.', helpEn: 'Canopy or door opening from 0 to 1.' },
  gear: { de: 'Fahrwerk gesamt', en: 'Overall gear', helpDe: 'Gesamter Ausfahrzustand des Fahrwerks von 0 bis 1.', helpEn: 'Overall landing-gear extension from 0 to 1.' },
  'afterburner.0': { de: 'Nachbrenner links', en: 'Left afterburner', helpDe: 'Nachbrennerzustand des linken beziehungsweise ersten Triebwerks von 0 bis 1.', helpEn: 'Afterburner state of the left or first engine from 0 to 1.' },
  'afterburner.1': { de: 'Nachbrenner rechts', en: 'Right afterburner', helpDe: 'Nachbrennerzustand des rechten beziehungsweise zweiten Triebwerks von 0 bis 1.', helpEn: 'Afterburner state of the right or second engine from 0 to 1.' },
  cannon_rounds_fired: { de: 'Abgefeuerte Kanonenschüsse', en: 'Cannon rounds fired', helpDe: 'Kumulativer Zähler abgefeuerter Kanonenschüsse. Nur für Waffen- und Rückstoßeffekte relevant.', helpEn: 'Cumulative count of cannon rounds fired. Relevant only to weapon and recoil effects.' },
  missiles_released: { de: 'Abgefeuerte Raketen', en: 'Missiles released', helpDe: 'Kumulativer Zähler abgefeuerter Lenkflugkörper.', helpEn: 'Cumulative count of missiles released.' },
  bombs_released: { de: 'Abgeworfene Bomben', en: 'Bombs released', helpDe: 'Kumulativer Zähler abgeworfener Bomben.', helpEn: 'Cumulative count of bombs released.' },
  rockets_released: { de: 'Abgefeuerte ungelenkte Raketen', en: 'Rockets released', helpDe: 'Kumulativer Zähler abgefeuerter ungelenkter Raketen.', helpEn: 'Cumulative count of unguided rockets released.' },
  flares_released: { de: 'Ausgestoßene Flares', en: 'Flares released', helpDe: 'Kumulativer Zähler ausgestoßener Täuschkörper-Flares.', helpEn: 'Cumulative count of released countermeasure flares.' },
  chaff_released: { de: 'Ausgestoßenes Chaff', en: 'Chaff released', helpDe: 'Kumulativer Zähler ausgestoßener Düppel.', helpEn: 'Cumulative count of released chaff countermeasures.' },
  damage_total: { de: 'Strukturschaden gesamt', en: 'Total structural damage', helpDe: 'Summierter Schadenswert. Die genaue Skala hängt von der Quelle beziehungsweise dem DCS-Profil ab.', helpEn: 'Aggregate damage value. Its exact scale depends on the source and DCS profile.' }
});

function output(id, group, label, packetKey, targetUnit, options = {}) {
  const panelIndex = id.startsWith('panel_shake.') ? Number(id.split('.')[1]) + 1 : 0;
  const localized = OUTPUT_LOCALIZATION[id] || (panelIndex ? {
    de: `Panel-Rütteln ${panelIndex}`,
    en: `Panel shake ${panelIndex}`,
    helpDe: `Normierter Rüttelkanal ${panelIndex} von 0 bis 1 für ein separat zuweisbares Cockpit- oder Vibrationselement.`,
    helpEn: `Normalized shake channel ${panelIndex} from 0 to 1 for an independently mapped cockpit or vibration element.`
  } : {});
  return {
    id,
    group,
    label,
    labelDe: localized.de || label,
    labelEn: localized.en || label,
    helpDe: localized.helpDe || '',
    helpEn: localized.helpEn || '',
    packetKey,
    targetUnit,
    ...options
  };
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
  'acc.2': ['std.acc.body.y', 'std.gforce', 'a2a.acc.y'],
  'ang_vel.0': ['std.angular.body.x', 'std.rotacc.body.x', 'a2a.rotacc.x'],
  'ang_vel.1': ['std.angular.body.z', 'std.rotacc.body.z', 'a2a.rotacc.z'],
  'ang_vel.2': ['std.angular.body.y', 'std.rotacc.body.y', 'a2a.rotacc.y'],
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

const TURBULENCE_SOURCE_IDS = Object.freeze([
  'a2a.acc.y',
  'std.acc.body.y',
  'std.acc.world.y',
  'std.gforce',
  'std.wind.y',
  'std.wind.aircraft.y',
  'std.wind.relative.body.y'
]);

const TURBULENCE_WIND_SOURCE_IDS = Object.freeze([
  'std.wind.aircraft.y',
  'std.wind.y',
  'std.wind.relative.body.y'
]);

// These sources are sampled even when they are not routed to DCS. The recorder
// can therefore compare the same manoeuvre and turbulence event across every
// candidate signal without forcing the tester to reconfigure output channels.
const DIAGNOSTIC_SOURCE_IDS = Object.freeze([
  'a2a.acc.y',
  'std.acc.body.y',
  'std.acc.world.y',
  'std.gforce',
  'std.wind.y',
  'std.wind.aircraft.y',
  'std.wind.relative.body.y',
  'std.velocity.world.y',
  'std.velocity.body.y',
  'std.cloud.density',
  'std.pitch',
  'std.angular.body.x',
  'std.elevator'
]);

const TURBULENCE_PRESETS = Object.freeze([
  Object.freeze({
    id: 'light',
    label: 'Leicht',
    description: 'Dezente Luftunruhe mit engem Sicherheitslimit.',
    labelEn: 'Light',
    descriptionEn: 'Subtle air disturbance with a tight safety limit.',
    mix: 0.25,
    gain: 1.6,
    lowCutHz: 0.9,
    highCutHz: 4,
    maxExtraG: 0.08
  }),
  Object.freeze({
    id: 'medium',
    label: 'Mittel',
    description: 'Ausgewogener Ausgangspunkt für normale Turbulenz.',
    labelEn: 'Medium',
    descriptionEn: 'Balanced starting point for normal turbulence.',
    mix: 0.5,
    gain: 2.5,
    lowCutHz: 0.7,
    highCutHz: 5,
    maxExtraG: 0.2
  }),
  Object.freeze({
    id: 'strong',
    label: 'Stark',
    description: 'Deutlich spürbare Stöße mit breiterem Frequenzband.',
    labelEn: 'Strong',
    descriptionEn: 'Clearly noticeable bumps across a wider frequency band.',
    mix: 0.75,
    gain: 3.5,
    lowCutHz: 0.5,
    highCutHz: 7,
    maxExtraG: 0.3
  }),
  Object.freeze({
    id: 'extreme',
    label: 'Extrem',
    description: 'Nur für kurze Tests; kann DRSM- oder Plattformlimits erreichen.',
    labelEn: 'Extreme',
    descriptionEn: 'For short tests only; may reach DRSM or platform limits.',
    mix: 1,
    gain: 5,
    lowCutHz: 0.3,
    highCutHz: 10,
    maxExtraG: 0.5
  })
]);

const DEFAULT_CHANNELS = Object.freeze({
  'acc.0': { enabled: true, sourceId: 'a2a.acc.x', inputUnit: 'mps2', operation: 'direct', invert: false, scale: 1, offset: 0 },
  'acc.1': { enabled: true, sourceId: 'a2a.acc.z', inputUnit: 'mps2', operation: 'direct', invert: false, scale: 1, offset: 0 },
  'acc.2': { enabled: true, sourceId: 'a2a.acc.y', inputUnit: 'mps2', operation: 'direct', invert: false, scale: 1, offset: 0 },
  'ang_vel.0': { enabled: true, sourceId: 'std.angular.body.x', inputUnit: 'radps', operation: 'direct', invert: false, scale: 1, offset: 0 },
  'ang_vel.1': { enabled: true, sourceId: 'std.angular.body.z', inputUnit: 'radps', operation: 'direct', invert: false, scale: 1, offset: 0 },
  'ang_vel.2': { enabled: true, sourceId: 'std.angular.body.y', inputUnit: 'radps', operation: 'direct', invert: false, scale: 1, offset: 0 },
  'vel.0': { enabled: false, sourceId: 'std.velocity.world.x', inputUnit: 'fps', operation: 'direct', scale: 1, offset: 0 },
  'vel.1': { enabled: false, sourceId: 'std.velocity.world.z', inputUnit: 'fps', operation: 'direct', scale: 1, offset: 0 },
  'vel.2': { enabled: false, sourceId: 'std.velocity.world.y', inputUnit: 'fps', operation: 'direct', scale: 1, offset: 0 },
  pitch: { enabled: true, sourceId: 'std.pitch', inputUnit: 'degrees', operation: 'direct', invert: true, scale: 1, offset: 0 },
  roll: { enabled: true, sourceId: 'std.bank', inputUnit: 'degrees', operation: 'direct', invert: true, scale: 1, offset: 0 },
  yaw: { enabled: true, sourceId: 'std.heading', inputUnit: 'degrees', operation: 'direct', invert: true, scale: 1, offset: 0 },
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
    invert: false,
    scale: 1,
    offset: 0
  };
}

function buildDefaultConfig() {
  return {
    schemaVersion: 4,
    language: 'de',
    expertMode: false,
    unsafeMode: false,
    skippedUpdateVersion: '',
    name: 'A2A_PA24_250_Comanche_MSFS',
    host: '127.0.0.1',
    port: 4135,
    period: 'visual',
    gravity: {
      enabled: true,
      strengthG: 1
    },
    turbulence: {
      enabled: false,
      sourceId: 'a2a.acc.y',
      mix: 0.5,
      gain: 2.5,
      lowCutHz: 0.7,
      highCutHz: 5,
      maxExtraG: 0.2,
      windEnabled: false,
      windSourceId: 'std.wind.aircraft.y',
      windMix: 0.25,
      windGain: 1,
      windInvert: false
    },
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
  DIAGNOSTIC_SOURCE_IDS,
  GROUP_LABELS,
  OPERATION_COMPATIBILITY,
  OPERATIONS,
  OUTPUTS,
  SAFE_SOURCE_IDS,
  TURBULENCE_PRESETS,
  TURBULENCE_SOURCE_IDS,
  TURBULENCE_WIND_SOURCE_IDS,
  SAFE_OPERATION_COMPATIBILITY,
  UNIT_DEFINITIONS,
  buildDefaultConfig,
  compatibleOperationIds,
  defaultChannelFor,
  safeCompatibleOperationIds
};
