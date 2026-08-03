'use strict';

const dgram = require('node:dgram');
const { EventEmitter } = require('node:events');
const { RouterCore, allSources, normalizeConfig } = require('./router-core');

const APP_NAME = 'AccuSim-DRSM-Telemetry-Router';
const DEF_ID = 9701;
const REQ_ID = 9701;

function readAllFloat64(recv, count) {
  const read = typeof recv.data.readFloat64 === 'function'
    ? () => recv.data.readFloat64()
    : (typeof recv.data.readDouble === 'function' ? () => recv.data.readDouble() : null);
  if (!read) throw new Error('SimConnect-Paket kann nicht als Float64 gelesen werden.');
  const values = [];
  for (let index = 0; index < count; index += 1) values.push(read());
  return values;
}

function sourceSignature(config) {
  return allSources(config)
    .filter((entry) => !Object.prototype.hasOwnProperty.call(entry, 'virtualValue'))
    .map((entry) => `${entry.id}|${entry.simVar}|${entry.simConnectUnit}`)
    .join('\n');
}

class TelemetryRuntime extends EventEmitter {
  constructor(config) {
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
    this.state = {
      process: 'stopped',
      simulator: 'waiting',
      udp: 'waiting',
      sampleHz: 0,
      samples: 0,
      packets: 0,
      detail: 'Bridge ist nicht gestartet.',
      lastError: '',
      sourceValues: {},
      outputValues: {},
      channelErrors: {},
      packetPreview: null
    };
  }

  publicState() {
    return {
      ...this.state,
      sourceValues: { ...this.state.sourceValues },
      outputValues: { ...this.state.outputValues },
      channelErrors: { ...this.state.channelErrors },
      packetPreview: this.state.packetPreview ? { ...this.state.packetPreview } : null
    };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.publicState());
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
      this.setState({ udp: 'error', lastError: `UDP: ${error.message}` });
    });
    this.setState({
      process: 'running',
      simulator: 'connecting',
      udp: 'active',
      sampleHz: 0,
      samples: 0,
      packets: 0,
      detail: 'Verbindung zu MSFS wird aufgebaut …',
      lastError: '',
      sourceValues: {},
      outputValues: {},
      channelErrors: {},
      packetPreview: null
    });
    this.reportTimer = setInterval(() => this.reportRate(), 1000);
    this.connect(this.runToken);
    return { ok: true };
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
    this.setState({
      process: 'stopped',
      simulator: 'waiting',
      udp: 'waiting',
      sampleHz: 0,
      detail: 'Bridge ist gestoppt.'
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
    this.setState({ simulator: 'connecting', detail: 'SimConnect-Konfiguration wird neu geladen …' });
    this.connect(token);
  }

  scheduleReconnect(token, message) {
    if (token !== this.runToken || this.state.process !== 'running' || this.reconnectTimer) return;
    this.setState({ simulator: 'waiting', detail: message || 'MSFS nicht verbunden; neuer Versuch in 3 Sekunden.' });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(token);
    }, 3000);
  }

  async connect(token) {
    if (token !== this.runToken || this.state.process !== 'running') return;
    this.setState({ simulator: 'connecting', detail: 'Verbinde mit MSFS / SimConnect …' });
    let simconnect;
    try {
      simconnect = require('node-simconnect');
    } catch (error) {
      this.setState({ simulator: 'error', lastError: `SimConnect-Modul fehlt: ${error.message}` });
      return;
    }

    try {
      const { recvOpen, handle } = await simconnect.open(APP_NAME, simconnect.Protocol.KittyHawk);
      if (token !== this.runToken || this.state.process !== 'running') {
        try { handle.close(); } catch (_) {}
        return;
      }
      this.handle = handle;
      const sources = allSources(this.config);
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
          const values = readAllFloat64(recv, readableSources.length);
          const sourceValues = {};
          readableSources.forEach((entry, index) => { sourceValues[entry.id] = values[index]; });
          for (const entry of sources) {
            if (Object.prototype.hasOwnProperty.call(entry, 'virtualValue')) sourceValues[entry.id] = entry.virtualValue;
          }
          this.processSample(sourceValues);
        } catch (error) {
          this.setState({ lastError: `Sample: ${error.message}` });
        }
      });
      handle.on('exception', (recv) => {
        this.setState({ lastError: `SimConnect Exception: ${recv.exceptionName || recv.exception || 'unknown'}` });
      });
      handle.on('quit', () => {
        if (this.handle === handle) this.handle = null;
        this.scheduleReconnect(token, 'MSFS wurde beendet; warte auf Neustart …');
      });
      handle.on('close', () => {
        if (this.handle === handle) this.handle = null;
        this.scheduleReconnect(token, 'SimConnect getrennt; neuer Versuch in 3 Sekunden.');
      });
      handle.on('error', (error) => {
        this.setState({ lastError: `SimConnect: ${error.message}` });
      });
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
      this.setState({
        simulator: 'connected',
        detail: `Verbunden: ${recvOpen.applicationName || 'Microsoft Flight Simulator'}`,
        lastError: ''
      });
    } catch (error) {
      this.scheduleReconnect(token, `MSFS nicht erreichbar: ${error?.message || error}`);
    }
  }

  processSample(sourceValues) {
    const nowSeconds = Number(process.hrtime.bigint() - this.startedAtNs) / 1e9;
    const mapped = this.core.update(sourceValues, nowSeconds);
    const payload = Buffer.from(JSON.stringify(mapped.packet), 'utf8');
    this.udp?.send(payload, this.config.port, this.config.host, (error) => {
      if (error) this.setState({ lastError: `UDP-Senden: ${error.message}` });
    });
    this.state.samples += 1;
    this.state.packets += 1;
    this.state.sourceValues = sourceValues;
    this.state.outputValues = mapped.outputValues;
    this.state.channelErrors = mapped.errors;
    this.state.packetPreview = mapped.packet;
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
