'use strict';
/**
 * The web process: started and supervised by the main process (supervisor.cjs).
 *
 * It decides which code to run. The files of the image are the default. An update that was installed
 * from the web interface lives in <data>/web-override/<version>/; it is used when it is newer than the
 * files of the image, was not marked as failed, and every file its manifest lists is there. Safe mode
 * (MEP_SAFE=1) always takes the files of the image. This file itself is part of the image and never
 * replaced, so a broken update cannot stop it from choosing.
 */
const fs = require('fs');
const path = require('path');

const IMAGE = __dirname;
const IPC_VERSION = 1;
const RESTART_CODE = 75;
const dataDir = process.env.LOG_DIR || '/data';
const certDir = process.env.CERT_DIR || '/certs';
const overDir = path.join(dataDir, 'web-override');

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const parts = (v) => String(v || '').split('.').map((x) => parseInt(x, 10) || 0);
const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

const bundled = readJson(path.join(IMAGE, 'web-version.json')) || { version: '0.0.0' };
const failed = (readJson(path.join(overDir, 'failed.json')) || []).map((f) => f.version);

function pickRoot() {
  const base = { root: IMAGE, version: bundled.version, kind: 'bundled', bundledVersion: bundled.version, failed, safeMode: process.env.MEP_SAFE === '1' };
  if (base.safeMode) return base;
  const cur = readJson(path.join(overDir, 'current.json'));
  // `force` is for development: a file written by hand into the data folder, never set by the interface
  if (!cur || !cur.version || failed.includes(cur.version) || (!cur.force && !newer(cur.version, bundled.version))) return base;
  const dir = path.join(overDir, String(cur.version).replace(/[^0-9A-Za-z._-]/g, ''));
  const manifest = readJson(path.join(dir, 'manifest.json'));
  if (!manifest || !Array.isArray(manifest.files) || !manifest.files.every((f) => fs.existsSync(path.join(dir, f)))) return base;
  // an installed update must still fit the image it runs in: a newer image may speak another IPC version or be
  // older than the update asks for (a rolled-back container), and then the files of the image are the safe choice
  const need = manifest.requires || {};
  const container = (/^v?(\d+\.\d+\.\d+)/.exec(process.env.APP_VERSION || '') || [])[1];
  if (need.ipc !== IPC_VERSION || (need.minContainer && container && newer(need.minContainer, container))) return { ...base, incompatible: cur.version };
  return { ...base, root: dir, version: cur.version, kind: 'override' };
}

const pick = pickRoot();
const stamp = (now = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
};
const log = (line) => console.log(`${stamp()} ${line}`);

// remembered while an update is being tried; the supervisor uses it to tell a crashing update from a crashing image
if (pick.kind === 'override') {
  try { fs.writeFileSync(path.join(overDir, 'attempt.json'), JSON.stringify({ version: pick.version, ts: Date.now() })); } catch { /* read-only data dir */ }
  setTimeout(() => { try { fs.unlinkSync(path.join(overDir, 'attempt.json')); } catch { /* already gone */ } }, 25000).unref();
}

const logbuf = require(path.join(pick.root, 'logbuf.cjs'));
logbuf.capture();

const handlers = new Map();
const ipc = {
  on: (type, fn) => handlers.set(type, fn),
  send: (m) => { if (process.connected) { try { process.send(m); } catch { /* the main process is gone */ } } },
};
let web = null;
let leaving = false;
async function leave(code) {
  if (leaving) return;
  leaving = true;
  try { if (web && web.flush) web.flush(); } catch (e) { console.error(`web   flush failed: ${e.message}`); }
  setTimeout(() => process.exit(code), 100);
}
ipc.restart = () => leave(RESTART_CODE);

process.on('message', (m) => {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'event' && web) {
    try {
      if (m.k === 'request') web.noteRequest(m.d);
      else if (m.k === 'connection') web.noteConnection(m.d);
      else if (m.k === 'tls') web.noteTlsError(m.d);
    } catch (e) { console.error(`web   event failed: ${e.message}`); }
  } else if (m.t === 'shutdown') leave(0);
  else if (handlers.has(m.t)) handlers.get(m.t)(m.line !== undefined ? m.line : m.lines !== undefined ? m.lines : m.s);
});
process.on('disconnect', () => leave(0)); // the main process died: do not linger
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => leave(0));

const key = fs.readFileSync(path.join(certDir, 'server.key'));
const cert = fs.readFileSync(path.join(certDir, 'server.crt'));
const webInfo = { incompatible: pick.incompatible || null, version: pick.version, root: pick.kind, bundledVersion: pick.bundledVersion, safeMode: pick.safeMode, failed, ipcVersion: IPC_VERSION, imageDir: IMAGE };
web = require(path.join(pick.root, 'web.cjs')).init({ dataDir, certDir, key, cert, version: process.env.APP_VERSION || 'dev', log, ipc, webInfo });
process.send && process.send({ t: 'ready', ipc: IPC_VERSION, web: { version: pick.version, root: pick.kind } });
