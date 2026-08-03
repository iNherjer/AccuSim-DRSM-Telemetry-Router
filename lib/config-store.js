'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildDefaultConfig } = require('./catalog');
const { normalizeConfig } = require('./router-core');

class BridgeConfigStore {
  constructor({ dataDirectory, fsModule = fs } = {}) {
    if (!dataDirectory) throw new Error('Datenordner fehlt.');
    this.fs = fsModule;
    this.dataDirectory = path.resolve(dataDirectory);
    this.configPath = path.join(this.dataDirectory, 'bridge-config.json');
  }

  ensureDataDirectory() {
    this.fs.mkdirSync(this.dataDirectory, { recursive: true });
    return this.dataDirectory;
  }

  read() {
    this.ensureDataDirectory();
    try {
      if (!this.fs.existsSync(this.configPath)) return this.write(buildDefaultConfig());
      const parsed = JSON.parse(this.fs.readFileSync(this.configPath, 'utf8'));
      const normalized = normalizeConfig(parsed);
      return parsed.schemaVersion === normalized.schemaVersion ? normalized : this.write(normalized);
    } catch (_) {
      return this.write(buildDefaultConfig());
    }
  }

  write(config) {
    const normalized = normalizeConfig(config);
    this.ensureDataDirectory();
    const temporaryPath = `${this.configPath}.${process.pid}.tmp`;
    this.fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    try {
      this.fs.renameSync(temporaryPath, this.configPath);
    } catch (error) {
      try {
        this.fs.copyFileSync(temporaryPath, this.configPath);
        this.fs.rmSync(temporaryPath, { force: true });
      } catch (_) {
        try { this.fs.rmSync(temporaryPath, { force: true }); } catch (_) {}
        throw error;
      }
    }
    return normalized;
  }

  reset() {
    return this.write(buildDefaultConfig());
  }
}

module.exports = { BridgeConfigStore };
