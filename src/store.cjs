'use strict';
/**
 * Tiny JSON file store for the web interface: settings, the password hash and the
 * device list. Writes are atomic (temp file + rename) and owner-only, so a crash
 * in the middle of a write never leaves a half-written file behind.
 */
const fs = require('fs');

function read(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function write(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

module.exports = { read, write };
