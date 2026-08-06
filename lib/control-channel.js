'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const CONTROL_PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 64 * 1024;

function bridgeControlPath({ platform = process.platform, temporaryDirectory = os.tmpdir(), uid = typeof process.getuid === 'function' ? process.getuid() : 0 } = {}) {
  if (platform === 'win32') return '\\\\.\\pipe\\vfr-multitool-accusim-drsm-router-v1';
  return path.join(temporaryDirectory, `vfr-multitool-accusim-drsm-router-${uid}-v1.sock`);
}

function compactRuntimeState(runtimeState = {}) {
  const recording = runtimeState.recording && typeof runtimeState.recording === 'object'
    ? runtimeState.recording
    : {};
  return {
    process: String(runtimeState.process || 'stopped'),
    simulator: String(runtimeState.simulator || 'waiting'),
    udp: String(runtimeState.udp || 'waiting'),
    sampleHz: Number(runtimeState.sampleHz) || 0,
    samples: Number(runtimeState.samples) || 0,
    packets: Number(runtimeState.packets) || 0,
    detail: String(runtimeState.detail || ''),
    lastError: String(runtimeState.lastError || ''),
    recording: {
      active: recording.active === true,
      rows: Number(recording.rows) || 0,
      error: String(recording.error || '')
    }
  };
}

function safeRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültige Steueranfrage.');
  const id = String(value.id || '').slice(0, 80);
  const command = String(value.command || '').trim().slice(0, 80);
  if (!id || !command) throw new Error('Steueranfrage ohne ID oder Kommando.');
  return { id, command, payload: value.payload };
}

class BridgeControlServer {
  constructor({ socketPath = bridgeControlPath(), listenTarget = null, handlers = {}, fsModule = fs, netModule = net, platform = process.platform } = {}) {
    this.socketPath = socketPath;
    this.listenTarget = listenTarget || socketPath;
    this.handlers = handlers;
    this.fs = fsModule;
    this.net = netModule;
    this.platform = platform;
    this.server = null;
  }

  async listen() {
    if (this.server) return this.socketPath;
    if (this.platform !== 'win32' && typeof this.listenTarget === 'string') {
      try { this.fs.rmSync(this.socketPath, { force: true }); } catch (_) {}
    }
    const server = this.net.createServer((socket) => this.handleSocket(socket));
    this.server = server;
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener('listening', onListening);
        this.server = null;
        reject(error);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        server.on('error', () => {});
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.listenTarget);
    });
    return server.address();
  }

  handleSocket(socket) {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += String(chunk || '');
      if (Buffer.byteLength(buffer, 'utf8') > MAX_MESSAGE_BYTES) {
        socket.destroy(new Error('Steueranfrage ist zu groß.'));
        return;
      }
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) void this.handleLine(socket, line);
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('error', () => {});
  }

  async handleLine(socket, line) {
    let id = '';
    try {
      const request = safeRequest(JSON.parse(line));
      id = request.id;
      const handler = this.handlers[request.command];
      if (typeof handler !== 'function') throw new Error(`Unbekanntes Steuerkommando: ${request.command}`);
      const result = await handler(request.payload);
      socket.write(`${JSON.stringify({ id, ok: true, result: result ?? null })}\n`);
    } catch (error) {
      socket.write(`${JSON.stringify({ id, ok: false, error: error?.message || String(error) })}\n`);
    }
  }

  async close() {
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
    if (this.platform !== 'win32' && typeof this.listenTarget === 'string') {
      try { this.fs.rmSync(this.socketPath, { force: true }); } catch (_) {}
    }
  }
}

module.exports = {
  BridgeControlServer,
  CONTROL_PROTOCOL_VERSION,
  MAX_MESSAGE_BYTES,
  bridgeControlPath,
  compactRuntimeState,
  safeRequest
};
