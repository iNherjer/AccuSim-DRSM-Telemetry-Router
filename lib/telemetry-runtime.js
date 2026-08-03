'use strict';

const dgram = require('node:dgram');
const { EventEmitter } = require('node:events');
const { OUTPUTS } = require('./catalog');
const { CsvRecorder } = require('./csv-recorder');
const { translate } = require('./i18n');
const { RouterCore, allSources, normalizeConfig, requiredSources } = require('./router-core');

const APP_NAME = 'AccuSim-DRSM-Telemetry-Router';
const DEF_ID = 9701;
const REQ_ID = 9701;

function readAllFloat64(recv, count, language = 'de') {
  const read = typeof recv.data.readFloat64 === 'function'
    ? () => recv.data.readFloat64()
    : (typeof recv.data.readDouble === 'function' ? () => recv.data.readDouble() : null);
  if (!read) throw new Error(translate(language, 'runtime.floatError'));
  const values = [];
  for (let index = 0; index < count; index += 1) values.push(read());
  return values;
}

function sourceSignature(config) {
  return requiredSources(config)
    .filter((entry) => !Object.prototype.hasOwnProperty.call(entry, 'virtualValue'))
    .map((entry) => `${entry.id}|${entry.simVar}|${entry.simConnectUnit}`)
    .join('\n');
}

class TelemetryRuntime extends EventEmitter {
  constructor(config, { recordingDirectory = '' } = {}) {
    super();
    this.config = normalizeConfig(config);
    this.core = new RouterCore(this.config);
    this.udp = null;
    this.handle = null;
    this.reconnectTimer = null;
    this.reportTimer = null;
    this.runToken = 0;
    this.startedAtNs = null;
    this.lastRateAt = 0;
    this.lastRateSamples = 0;
    this.lastTelemetryEmitAt = 0;
    this.recorder = recordingDirectory ? new CsvRecorder({ outputDirectory: recordingDirectory }) : null;
    this.state = {
      process: 'stopped',
      simulator: 'waiting',
      udp: 'waiting',
      sampleHz: 0,
      samples: 0,
      packets: 0,
      detailKey: 'runtime.bridgeNotStarted',
      detailArgs: {},
      detail: '',
      lastErrorKey: '',
      lastErrorArgs: {},
      lastError: '',
      sourceValues: {},
      outputValues: {},
      channelErrors: {},
      diagnostics: {},
      recording: this.recorder?.publicState() || { active: false, path: '', rows: 0, error: '' },
      packetPreview: null
    };
  }

  publicState() {
    const detail = this.state.detailKey
      ? translate(this.config.language, this.state.detailKey, this.state.detailArgs)
      : this.state.detail;
    const lastError = this.state.lastErrorKey
      ? translate(this.config.language, this.state.lastErrorKey, this.state.lastErrorArgs)
      : this.state.lastError;
    return {
      ...this.state,
      detail,
      lastError,
      sourceValues: { ...this.state.sourceValues },
      outputValues: { ...this.state.outputValues },
      channelErrors: { ...this.state.channelErrors },
      diagnostics: JSON.parse(JSON.stringify(this.state.diagnostics || {})),
      recording: { ...(this.state.recording || {}) },
      packetPreview: this.state.packetPreview ? { ...this.state.packetPreview } : null
    };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.publicState());
  }

  detailPatch(key, args = {}) {
    return { detailKey: key, detailArgs: args, detail: '' };
  }

  errorPatch(key, args = {}) {
    return { lastErrorKey: key, lastErrorArgs: args, lastError: '' };
  }

  clearErrorPatch() {
    return { lastErrorKey: '', lastErrorArgs: {}, lastError: '' };
  }

  updateConfig(config) {
    const next = normalizeConfig(config);
    const mustReconnect = sourceSignature(next) !== sourceSignature(this.config) || next.period !== this.config.period;
    this.config = next;
    this.core.setConfig(next);
    if (mustReconnect && this.state.process === 'running') this.reconnectNow();
    return this.config;
  }

  start() {
    if (this.state.process === 'running') return { ok: true, alreadyRunning: true };
    this.runToken += 1;
    this.startedAtNs = process.hrtime.bigint();
    this.lastRateAt = Date.now();
    this.lastRateSamples = 0;
    this.lastTelemetryEmitAt = 0;
    this.core.setConfig(this.config);
    this.udp = dgram.createSocket('udp4');
    this.udp.on('error', (error) => {
      this.setState({ udp: 'error', ...this.errorPatch('runtime.udpError', { error: error.message }) });
    });
    this.setState({
      process: 'running',
      simulator: 'connecting',
      udp: 'active',
      sampleHz: 0,
      samples: 0,
      packets: 0,
      ...this.detailPatch('runtime.bridgeStarting'),
      ...this.clearErrorPatch(),
      sourceValues: {},
      outputValues: {},
      channelErrors: {},
      diagnostics: {},
      packetPreview: null
    });
    this.reportTimer = setInterval(() => this.reportRate(), 1000);
    this.connect(this.runToken);
    return { ok: true };
  }

  startRecording() {
    if (!this.recorder) return { ok: false, message: translate(this.config.language, 'runtime.csvNotConfigured') };
    try {
      const recording = this.recorder.start({ sources: allSources(this.config), outputs: OUTPUTS });
      this.setState({ recording });
      return { ok: true, recording };
    } catch (error) {
      const recording = { active: false, path: '', rows: 0, error: error.message };
      this.setState({ recording });
      return { ok: false, message: error.message, recording };
    }
  }

  async stopRecording() {
    if (!this.recorder) return { ok: false, message: translate(this.config.language, 'runtime.csvNotConfigured') };
    const recording = await this.recorder.stop();
    this.setState({ recording });
    return { ok: true, recording };
  }

  stop() {
    if (this.state.process === 'stopped') return { ok: true, alreadyStopped: true };
    this.runToken += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.reconnectTimer = null;
    this.reportTimer = null;
    const handle = this.handle;
    this.handle = null;
    try { handle?.close(); } catch (_) {}
    try { this.udp?.close(); } catch (_) {}
    this.udp = null;
    if (this.recorder?.publicState().active) void this.stopRecording();
    this.setState({
      process: 'stopped',
      simulator: 'waiting',
      udp: 'waiting',
      sampleHz: 0,
      ...this.detailPatch('runtime.bridgeStopped')
    });
    return { ok: true };
  }

  reconnectNow() {
    if (this.state.process !== 'running') return;
    this.runToken += 1;
    const token = this.runToken;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const handle = this.handle;
    this.handle = null;
    try { handle?.close(); } catch (_) {}
    this.setState({ simulator: 'connecting', ...this.detailPatch('runtime.reloading') });
    this.connect(token);
  }

  scheduleReconnect(token, detailKey = 'runtime.retry', detailArgs = {}) {
    if (token !== this.runToken || this.state.process !== 'running' || this.reconnectTimer) return;
    this.setState({ simulator: 'waiting', ...this.detailPatch(detailKey, detailArgs) });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(token);
    }, 3000);
  }

  async connect(token) {
    if (token !== this.runToken || this.state.process !== 'running') return;
    this.setState({ simulator: 'connecting', ...this.detailPatch('runtime.connecting') });
    let simconnect;
    try {
      simconnect = require('node-simconnect');
    } catch (error) {
      this.setState({ simulator: 'error', ...this.errorPatch('runtime.simModuleMissing', { error: error.message }) });
      return;
    }

    try {
      const { recvOpen, handle } = await simconnect.open(APP_NAME, simconnect.Protocol.KittyHawk);
      if (token !== this.runToken || this.state.process !== 'running') {
        try { handle.close(); } catch (_) {}
        return;
      }
      this.handle = handle;
      const sources = requiredSources(this.config);
      const readableSources = sources.filter((entry) => !Object.prototype.hasOwnProperty.call(entry, 'virtualValue'));
      for (const entry of readableSources) {
        handle.addToDataDefinition(
          DEF_ID,
          entry.simVar,
          entry.simConnectUnit || 'number',
          simconnect.SimConnectDataType.FLOAT64
        );
      }

      handle.on('simObjectData', (recv) => {
        if (token !== this.runToken || recv.requestID !== REQ_ID) return;
        try {
          const values = readAllFloat64(recv, readableSources.length, this.config.language);
          const sourceValues = {};
          readableSources.forEach((entry, index) => { sourceValues[entry.id] = values[index]; });
          for (const entry of sources) {
            if (Object.prototype.hasOwnProperty.call(entry, 'virtualValue')) sourceValues[entry.id] = entry.virtualValue;
          }
          this.processSample(sourceValues);
        } catch (error) {
          this.setState(this.errorPatch('runtime.sampleError', { error: error.message }));
        }
      });
      handle.on('exception', (recv) => {
        this.setState(this.errorPatch('runtime.simException', {
          error: recv.exceptionName || recv.exception || 'unknown'
        }));
      });
      handle.on('quit', () => {
        if (this.handle === handle) this.handle = null;
        this.scheduleReconnect(token, 'runtime.msfsQuit');
      });
      handle.on('close', () => {
        if (this.handle === handle) this.handle = null;
        this.scheduleReconnect(token, 'runtime.simDisconnected');
      });
      handle.on('error', (error) => {
        this.setState(this.errorPatch('runtime.simException', { error: error.message }));
      });
      if (readableSources.length > 0) {
        handle.requestDataOnSimObject(
          REQ_ID,
          DEF_ID,
          simconnect.SimConnectConstants.OBJECT_ID_USER,
          this.config.period === 'sim' ? simconnect.SimConnectPeriod.SIM_FRAME : simconnect.SimConnectPeriod.VISUAL_FRAME,
          0,
          0,
          0,
          0
        );
      }
      this.setState({
        simulator: 'connected',
        ...(readableSources.length > 0
          ? this.detailPatch('runtime.connectedSources', {
              app: recvOpen.applicationName || 'Microsoft Flight Simulator',
              count: readableSources.length
            })
          : this.detailPatch('runtime.connectedNoSources')),
        ...this.clearErrorPatch()
      });
    } catch (error) {
      this.scheduleReconnect(token, 'runtime.unreachable', { error: error?.message || error });
    }
  }

  processSample(sourceValues) {
    const nowSeconds = Number(process.hrtime.bigint() - this.startedAtNs) / 1e9;
    const mapped = this.core.update(sourceValues, nowSeconds);
    const payload = Buffer.from(JSON.stringify(mapped.packet), 'utf8');
    this.udp?.send(payload, this.config.port, this.config.host, (error) => {
      if (error) this.setState(this.errorPatch('runtime.udpSendError', { error: error.message }));
    });
    this.state.samples += 1;
    this.state.packets += 1;
    this.state.sourceValues = sourceValues;
    this.state.outputValues = mapped.outputValues;
    this.state.channelErrors = mapped.errors;
    this.state.diagnostics = mapped.diagnostics;
    this.state.packetPreview = mapped.packet;
    this.recorder?.write({ sourceValues, mapped });
    this.state.recording = this.recorder?.publicState() || this.state.recording;
    const now = Date.now();
    if (now - this.lastTelemetryEmitAt >= 100) {
      this.lastTelemetryEmitAt = now;
      this.emit('state', this.publicState());
    }
  }

  reportRate() {
    if (this.state.process !== 'running') return;
    const now = Date.now();
    const elapsed = Math.max(1, now - this.lastRateAt);
    const sampleHz = (this.state.samples - this.lastRateSamples) * 1000 / elapsed;
    this.lastRateAt = now;
    this.lastRateSamples = this.state.samples;
    this.setState({ sampleHz });
  }
}

module.exports = { TelemetryRuntime, readAllFloat64, sourceSignature };
