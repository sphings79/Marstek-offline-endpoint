'use strict';
/**
 * Measurements database: what the batteries upload, decoded into one row per value that changed.
 *
 * SQLite through the `node:sqlite` module that ships with Node 22, so there is nothing to
 * install. One file, <data>/measurements.db, next to the logs; the JSONL logs stay the raw source
 * (and can rebuild this file).
 *
 *   keys      key, model, fw, name, unit, scale, description, confirmed, category, fmt, evidence, edited
 *             <- the part you can edit: a name, unit, scale and category per key, applied when reading.
 *             Definitions come from keydefs.cjs; a row you edited (edited = 1) is never overwritten by them. The stored values are never changed.
 *             model is the device family (VNSD, VNSA, VNSE3: from the `aid` of the time request) and fw the
 *             control firmware (`dn`) the meaning holds for, either of them '*' for any. The control firmware
 *             numbers are shared across the families (VNSD, VNSA and VNSE3 all have 150 and 151), so a
 *             firmware alone does not say which device it is. A value is resolved in this order: model and
 *             firmware, model alone, firmware alone, general. What the keys mean was confirmed on a VNSD with
 *             firmware 151 only, so those rows carry model = 'VNSD', fw = '151' and confirmed = 1; every other
 *             device falls back to the general rows, which have the same names but are not confirmed. A firmware that sends other data or means
 *             something else by a key gets its own rows without touching the others.
 *   readings  device, key, ts (ms), raw (text as uploaded), num (number or NULL), fw (the control firmware
 *             of the device when it uploaded the value), model (its device family, '' while unknown)
 *
 * Only changes are written: an upload where `sc` is still 90 adds nothing for `sc`. A list such as
 * vc=3,14,3269,... becomes the keys vc[0], vc[1], vc[2] ... The device id (`di`) and serial (`sn`)
 * are not stored as values; the device column carries the id.
 */
const fs = require('fs');
const path = require('path');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  /* Node older than 22.5 */
}

const SKIP = new Set(['di', 'sn']);
const CONFIRMED_FW = '151';
const UPLOAD_RE = /^\/data-upload\/v1\/venus\/([0-9A-Za-z]+)/;

const { SEED, MODEL_SEED, HEX, CATEGORIES } = require('./keydefs.cjs');
const SCHEMA_VERSION = 3;
const CONFIRMED_MODEL = 'VNSD';

/** Flatten the upload string into {key: raw}; lists get one key per position. */
function parseUpload(d) {
  const out = {};
  let params;
  try {
    params = new URLSearchParams(d);
  } catch {
    return out;
  }
  for (const [k, v] of params) {
    if (SKIP.has(k)) continue;
    if (v.includes(',')) v.split(',').forEach((p, i) => { out[`${k}[${i}]`] = p; });
    else out[k] = v;
  }
  return out;
}

function create({ dataDir, log, isEnabled, modelOf = () => '' }) {
  const available = !!DatabaseSync;
  const file = path.join(dataDir, 'measurements.db');
  let db = null;
  const known = new Set();
  const last = new Map(); // device -> Map(key -> raw)
  const fwOf = new Map(); // device -> control firmware last seen
  const modelSeen = new Map(); // device -> model of its last reading
  let importing = false;
  let needsRebuild = false;
  const hexKeys = new Set(HEX);

  function open() {
    if (!available || db) return db;
    db = new DatabaseSync(file);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS keys (
        key TEXT NOT NULL, model TEXT NOT NULL DEFAULT '*', fw TEXT NOT NULL DEFAULT '*', name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '',
        scale REAL NOT NULL DEFAULT 1, description TEXT NOT NULL DEFAULT '', confirmed INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'other', fmt TEXT NOT NULL DEFAULT 'dec', evidence TEXT NOT NULL DEFAULT '', edited INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (key, model, fw)
      );
      CREATE TABLE IF NOT EXISTS readings (
        device TEXT NOT NULL, key TEXT NOT NULL, ts INTEGER NOT NULL, raw TEXT NOT NULL, num REAL, fw TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS mqtt_select (key TEXT PRIMARY KEY);
      CREATE UNIQUE INDEX IF NOT EXISTS readings_uq ON readings (device, key, ts);
      CREATE INDEX IF NOT EXISTS readings_ts ON readings (ts);
    `);
    const version = Number(db.prepare('PRAGMA user_version').get().user_version) || 0;
    const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    if (version < SCHEMA_VERSION) {
      if (!cols('keys').includes('model')) {
        // an older file: its keys table lacks the model; copy it over and drop the seeded rows that claimed a
        // verification for every device family (they are re-seeded for the one that was actually checked)
        for (const col of ["category TEXT NOT NULL DEFAULT 'other'", "fmt TEXT NOT NULL DEFAULT 'dec'", "evidence TEXT NOT NULL DEFAULT ''", 'edited INTEGER NOT NULL DEFAULT 0']) {
          try { db.exec(`ALTER TABLE keys ADD COLUMN ${col}`); } catch { /* already there */ }
        }
        db.exec(`BEGIN;
          CREATE TABLE keys_new (key TEXT NOT NULL, model TEXT NOT NULL DEFAULT '*', fw TEXT NOT NULL DEFAULT '*', name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '',
            scale REAL NOT NULL DEFAULT 1, description TEXT NOT NULL DEFAULT '', confirmed INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'other',
            fmt TEXT NOT NULL DEFAULT 'dec', evidence TEXT NOT NULL DEFAULT '', edited INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, model, fw));
          INSERT INTO keys_new (key, model, fw, name, unit, scale, description, confirmed, category, fmt, evidence, edited)
            SELECT key, '*', fw, name, unit, scale, description, confirmed, category, fmt, evidence, edited FROM keys;
          DROP TABLE keys;
          ALTER TABLE keys_new RENAME TO keys;
          DELETE FROM keys WHERE model = '*' AND fw != '*' AND edited = 0;
          COMMIT;`);
      }
      if (!cols('readings').includes('model')) db.exec("ALTER TABLE readings ADD COLUMN model TEXT NOT NULL DEFAULT ''");
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    // definitions: the verified row for a VNSD on firmware 151 and the unverified general default for everything else
    const up = db.prepare(`INSERT INTO keys (key, model, fw, name, unit, scale, description, confirmed, category, fmt, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (key, model, fw) DO UPDATE SET name = excluded.name, unit = excluded.unit, scale = excluded.scale, description = excluded.description,
        confirmed = excluded.confirmed, category = excluded.category, fmt = excluded.fmt, evidence = excluded.evidence WHERE keys.edited = 0`);
    db.exec('BEGIN');
    for (const [k, n, u, sc, cat, fmt, ev, desc] of SEED) {
      up.run(k, CONFIRMED_MODEL, CONFIRMED_FW, n, u, sc, desc, 1, cat, fmt, ev);
      up.run(k, '*', '*', n, u, sc, desc, 0, cat, fmt, ev);
    }
    for (const [k, model, fw, n, u, sc, cat, fmt, ev, desc] of MODEL_SEED) up.run(k, model, fw, n, u, sc, desc, 0, cat, fmt, ev);
    db.exec('COMMIT');
    for (const r of db.prepare("SELECT key, fmt FROM keys WHERE model = '*' AND fw = '*'").all()) {
      known.add(r.key);
      if (r.fmt === 'hex') hexKeys.add(r.key);
    }
    return db;
  }

  function lastFor(device) {
    let m = last.get(device);
    if (!m) {
      m = new Map();
      for (const r of open().prepare('SELECT key, raw, max(ts) AS ts FROM readings WHERE device = ? GROUP BY key').all(device)) m.set(r.key, r.raw);
      const lastRow = db.prepare('SELECT model FROM readings WHERE device = ? ORDER BY ts DESC LIMIT 1').get(device);
      if (lastRow) modelSeen.set(device, lastRow.model);
      last.set(device, m);
    }
    return m;
  }

  /** Store the changed values of one upload. `force` ignores the on/off switch (used by the import). */
  function noteUpload(device, ts, d, force = false, modelOverride = null) {
    if (!available || (!force && !isEnabled())) return 0;
    const kv = parseUpload(d);
    if (!Object.keys(kv).length) return 0;
    open();
    let m = lastFor(device);
    const prevFw = fwOf.has(device) ? fwOf.get(device) : (m.get('dn') || '');
    // after a firmware change every value is written again, tagged with the new firmware, even where it
    // did not change: what a key means can differ between firmwares
    // the same when the device family becomes known or changes (a board swapped for another model)
    const model = modelOverride !== null ? modelOverride : modelOf(device) || '';
    const modelChanged = modelSeen.has(device) && modelSeen.get(device) !== model;
    if ((kv.dn !== undefined && prevFw && kv.dn !== prevFw) || modelChanged) {
      m = new Map();
      last.set(device, m);
    }
    modelSeen.set(device, model);
    if (kv.dn !== undefined) fwOf.set(device, kv.dn);
    else if (!fwOf.has(device)) fwOf.set(device, prevFw);
    const fw = fwOf.get(device) || '';
    const ins = db.prepare('INSERT OR IGNORE INTO readings (device, key, ts, raw, num, fw, model) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const reg = db.prepare("INSERT OR IGNORE INTO keys (key, model, fw, name) VALUES (?, '*', '*', ?)");
    let n = 0;
    db.exec('BEGIN');
    try {
      for (const [k, v] of Object.entries(kv)) {
        if (m.get(k) === v) continue;
        if (!known.has(k)) { reg.run(k, k); known.add(k); }
        const num = hexKeys.has(k) ? (/^[0-9a-fA-F]{1,13}$/.test(v) ? parseInt(v, 16) : null) : (v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
        ins.run(device, k, ts, v, num, fw, model);
        m.set(k, v);
        n += 1;
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      log(`web   measurements write failed: ${e.message}`);
      last.delete(device);
      return 0;
    }
    return n;
  }

  /** From the request hook: only uploads carry values. */
  function noteRequest({ url, ts, body }) {
    const m = UPLOAD_RE.exec(url || '');
    if (!m || !body || typeof body.d !== 'string') return;
    try {
      noteUpload(m[1], Date.parse(ts) || Date.now(), body.d);
    } catch (e) {
      log(`web   measurements: ${e.message}`);
    }
  }

  /** Rebuild the readings from the daily request logs. Keeps the names and scales you edited. */
  async function importLogs() {
    if (!available || importing) return { ok: false, reason: importing ? 'busy' : 'unavailable' };
    importing = true;
    try {
      open();
      db.exec('DELETE FROM readings');
      last.clear();
      fwOf.clear();
      modelSeen.clear();
      const files = fs.readdirSync(dataDir).filter((f) => /^requests-\d{4}-\d\d-\d\d\.jsonl$/.test(f)).sort();
      // the model of a device is in its time requests (aid=VNSD-0), not in the uploads
      const models = new Map();
      for (const f of files) {
        let text;
        try { text = fs.readFileSync(path.join(dataDir, f), 'utf8'); } catch { continue; }
        for (const line of text.split('\n')) {
          if (!line.includes('getDateInfo')) continue;
          const u = /uid=([0-9A-Za-z]+).*?[?&]aid=([A-Za-z0-9]{2,12})/.exec(line) || /aid=([A-Za-z0-9]{2,12}).*?uid=([0-9A-Za-z]+)/.exec(line);
          if (!u) continue;
          if (/^[0-9A-Za-z]{12,}$/.test(u[1])) models.set(u[1], u[2].toUpperCase());
        }
      }
      let uploads = 0;
      let rows = 0;
      for (const f of files) {
        let text;
        try {
          text = fs.readFileSync(path.join(dataDir, f), 'utf8');
        } catch {
          continue;
        }
        for (const line of text.split('\n')) {
          if (!line.includes('data-upload')) continue;
          let r;
          try {
            r = JSON.parse(line);
          } catch {
            continue;
          }
          const m = UPLOAD_RE.exec(r.url || '');
          if (!r.accepted || !m || !r.body || typeof r.body.d !== 'string') continue;
          rows += noteUpload(m[1], Date.parse(r.ts) || 0, r.body.d, true, models.get(m[1]) || modelOf(m[1]) || '');
          uploads += 1;
        }
        await new Promise((res) => setImmediate(res)); // let the endpoint answer a battery between days
      }
      log(`web   measurements imported from the logs: ${uploads} uploads, ${rows} values`);
      return { ok: true, uploads, rows };
    } finally {
      importing = false;
    }
  }

  function stats() {
    const base = { available, enabled: !!isEnabled(), importing };
    if (!available) return base;
    open();
    const r = db.prepare('SELECT count(*) AS rows, min(ts) AS first, max(ts) AS last, count(DISTINCT device) AS devices, count(DISTINCT key) AS keys FROM readings').get();
    let bytes = 0;
    try {
      bytes = fs.statSync(file).size;
    } catch {
      /* not yet written */
    }
    return { ...base, rows: r.rows, first: r.first, last: r.last, devices: r.devices, keys: r.keys, bytes };
  }

  const inList = (ids) => ids.map(() => '?').join(',');
  // The meaning of a key for the device a value came from: model and firmware, else model alone, else firmware alone, else general.
  const META = `JOIN keys k4 ON k4.key = r.key AND k4.model = '*' AND k4.fw = '*'
    LEFT JOIN keys k3 ON k3.key = r.key AND k3.model = '*' AND k3.fw = r.fw
    LEFT JOIN keys k2 ON k2.key = r.key AND k2.model = r.model AND k2.fw = '*' AND r.model != ''
    LEFT JOIN keys k1 ON k1.key = r.key AND k1.model = r.model AND k1.fw = r.fw AND r.model != ''`;
  const pick = (col) => `COALESCE(k1.${col}, k2.${col}, k3.${col}, k4.${col})`;
  const M = `${pick('name')} AS name, ${pick('unit')} AS unit, ${pick('scale')} AS scale, ${pick('description')} AS description,
    ${pick('confirmed')} AS confirmed, ${pick('category')} AS category, k4.fmt AS fmt, ${pick('evidence')} AS evidence,
    CASE WHEN k1.key IS NOT NULL THEN 'model+fw' WHEN k2.key IS NOT NULL THEN 'model' WHEN k3.key IS NOT NULL THEN 'fw' ELSE 'general' END AS scope`;

  /** Newest value per key for a device (and the ids merged into it). */
  function latest(ids) {
    if (!available || !ids.length) return [];
    open();
    const rows = db.prepare(`SELECT r.key, r.raw, r.num, max(r.ts) AS ts, r.fw, r.model, ${M}
      FROM readings r ${META} WHERE r.device IN (${inList(ids)}) GROUP BY r.key`).all(...ids);
    return rows.map((r) => ({ key: r.key, fw: r.fw, model: r.model, scope: r.scope, specific: r.scope !== 'general', name: r.name, unit: r.unit, scale: r.scale, description: r.description, confirmed: !!r.confirmed, category: r.category, evidence: r.evidence, hex: r.fmt === 'hex', raw: r.raw, ts: r.ts, value: r.fmt === 'hex' ? `0x${r.raw}` : (r.num === null ? r.raw : r.num * r.scale) }))
        .sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
  }

  /** Points of one key; the value in force at `from` comes first, so a step curve starts correctly. */
  function series(ids, key, from, to) {
    if (!available || !ids.length) return { points: [], key: null };
    open();
    const k = db.prepare("SELECT key, name, unit FROM keys WHERE key = ? AND model = '*' AND fw = '*'").get(key);
    if (!k) return { points: [], key: null };
    const sel = `SELECT r.ts, r.raw, r.num, r.fw, ${M} FROM readings r ${META} WHERE r.device IN (${inList(ids)}) AND r.key = ?`;
    const before = db.prepare(`${sel} AND r.ts < ? ORDER BY r.ts DESC LIMIT 1`).get(...ids, key, from);
    const within = db.prepare(`${sel} AND r.ts >= ? AND r.ts <= ? ORDER BY r.ts`).all(...ids, key, from, to);
    const pts = [...(before ? [{ ...before, ts: from }] : []), ...within];
    // the scale is that of the firmware each value came from, so a firmware change does not bend the curve
    return { key: k, points: pts.map((p) => ({ ts: p.ts, value: p.num === null ? null : p.num * p.scale, raw: p.raw, fw: p.fw })) };
  }

  function keys() {
    if (!available) return [];
    open();
    return db.prepare('SELECT key, model, fw, name, unit, scale, description, confirmed, category, fmt, evidence FROM keys').all()
      .map((r) => ({ ...r, confirmed: !!r.confirmed }))
      .sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }) || a.model.localeCompare(b.model) || a.fw.localeCompare(b.fw));
  }

  /** Keys the owner picked for the MQTT mode "selection". */
  function mqttSelection() {
    if (!available) return new Set();
    open();
    return new Set(db.prepare('SELECT key FROM mqtt_select').all().map((r) => r.key));
  }
  function setMqttSelection(keys, on) {
    if (!available) return 0;
    open();
    let n = 0;
    db.exec('BEGIN');
    try {
      const add = db.prepare('INSERT OR IGNORE INTO mqtt_select (key) VALUES (?)');
      const del = db.prepare('DELETE FROM mqtt_select WHERE key = ?');
      for (const k of keys) {
        if (!known.has(k)) continue;
        (on ? add : del).run(k);
        n += 1;
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return n;
  }

  /** Set the meaning of a key for one firmware (`fw`) or for all of them ('*'). */
  function setKey(key, model, fw, { name, unit, scale, description, confirmed, category }) {
    if (!available) return false;
    open();
    const part = /^(\*|[0-9A-Za-z._-]{1,20})$/;
    if (!known.has(key) || !part.test(model) || !part.test(fw)) return false;
    const cat = CATEGORIES.includes(category) ? category : 'other';
    const fmt = db.prepare("SELECT fmt FROM keys WHERE key = ? AND model = '*' AND fw = '*'").get(key).fmt;
    const nm = String(name).slice(0, 60);
    const un = String(unit).slice(0, 12);
    const ds = String(description).slice(0, 200);
    db.prepare(`INSERT INTO keys (key, model, fw, name, unit, scale, description, confirmed, category, fmt, evidence, edited) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', 1)
      ON CONFLICT (key, model, fw) DO UPDATE SET name = excluded.name, unit = excluded.unit, scale = excluded.scale, description = excluded.description,
        confirmed = excluded.confirmed, category = excluded.category, evidence = 'user', edited = 1`)
      .run(key, model, fw, nm, un, scale, ds, confirmed ? 1 : 0, cat, fmt);
    // a broader scope also reaches the narrower rows inside it, whose own rule would otherwise win
    let inside = null;
    let arg = [];
    if (model === '*' && fw === '*') inside = "NOT (model = '*' AND fw = '*')";
    else if (fw === '*') { inside = "model = ? AND fw != '*'"; arg = [model]; }
    else if (model === '*') { inside = "fw = ? AND model != '*'"; arg = [fw]; }
    if (inside) {
      db.prepare(`UPDATE keys SET name = ?, unit = ?, scale = ?, description = ?, category = ?, evidence = 'user', edited = 1 WHERE key = ? AND ${inside}`).run(nm, un, scale, ds, cat, key, ...arg);
    }
    return true;
  }

  const FW_PARTS = { dn: 'control', bm: 'bms', iv: 'inverter', mv: 'mppt' };
  /** When a firmware version changed: for the control, BMS, inverter and MPPT firmware, each change with the time. */
  function firmwareHistory(ids) {
    if (!available || !ids.length) return [];
    open();
    const rows = db.prepare(`SELECT ts, key, raw FROM readings WHERE device IN (${inList(ids)}) AND key IN ('dn', 'bm', 'iv', 'mv') ORDER BY ts, key`).all(...ids);
    const prev = {};
    const out = [];
    for (const r of rows) {
      // a component that does not answer reports 0; that is a gap, not a version
      if (r.raw === '0' || prev[r.key] === r.raw) continue;
      out.push({ ts: r.ts, part: FW_PARTS[r.key], key: r.key, from: prev[r.key] ?? null, to: r.raw });
      prev[r.key] = r.raw;
    }
    return out;
  }

  /** Device family and control firmware seen in the values, with devices, period and how many keys they sent. */
  function firmware() {
    if (!available) return [];
    open();
    return db.prepare(`SELECT model, fw, count(DISTINCT device) AS devices, min(ts) AS first, max(ts) AS last, count(DISTINCT key) AS keys FROM readings GROUP BY model, fw ORDER BY max(ts) DESC`).all()
      .map((r) => ({ model: r.model, fw: r.fw, devices: r.devices, first: r.first, last: r.last, keys: r.keys, confirmedHere: verifiedFor(r.model, r.fw) }));
  }
  /** Is there a verified meaning for this device family on this firmware (its own, or one set for any family)? */
  function verifiedFor(model, fw) {
    return !!db.prepare("SELECT 1 FROM keys WHERE confirmed = 1 AND fw = ? AND (model = ? OR model = '*') LIMIT 1").get(fw, model || '*');
  }
  /** The combinations the built-in or edited meanings are verified for, for the page's warning. */
  function verifiedPairs() {
    if (!available) return [];
    open();
    return db.prepare("SELECT DISTINCT model, fw FROM keys WHERE confirmed = 1 AND NOT (model = '*' AND fw = '*') ORDER BY model, fw").all();
  }
  /** Fill in the model of readings that were stored before it was known. */
  function assignModel(ids, model) {
    if (!available || !ids.length || !model) return 0;
    open();
    const r = db.prepare(`UPDATE readings SET model = ? WHERE device IN (${inList(ids)}) AND model = ''`).run(model, ...ids);
    for (const id of ids) modelSeen.set(id, model);
    return Number(r.changes) || 0;
  }

  /** Old values go with the log retention; the newest value of every key stays so it still has a "current" one. */
  function prune(cutoffMs) {
    if (!available) return 0;
    open();
    const r = db.prepare(`DELETE FROM readings WHERE ts < ? AND ts < (SELECT max(ts) FROM readings x WHERE x.device = readings.device AND x.key = readings.key)`).run(cutoffMs);
    return Number(r.changes) || 0;
  }

  /** CSV rows for the support package: time, device (label), key, name, scaled value, unit, raw. */
  function exportRows(deviceMap, sinceMs, limit = 200000) {
    if (!available || !deviceMap.size) return [];
    open();
    const ids = [...deviceMap.keys()];
    return db.prepare(`SELECT r.ts, r.device, r.key, r.fw, r.model, ${M}, r.raw, r.num FROM readings r ${META}
      WHERE r.device IN (${inList(ids)}) AND r.ts >= ? ORDER BY r.ts, r.device, r.key LIMIT ?`).all(...ids, sinceMs, limit)
      .map((r) => ({ ts: r.ts, device: deviceMap.get(r.device), key: r.key, fw: r.fw, model: r.model, confirmed: !!r.confirmed, name: r.name, unit: r.unit, value: r.num === null ? r.raw : Math.round(r.num * r.scale * 1e6) / 1e6, raw: r.raw }));
  }

  function close() {
    if (db) {
      try { db.close(); } catch { /* already closed */ }
      db = null;
    }
  }

  return { assignModel, verifiedPairs, mqttSelection, setMqttSelection, available, noteRequest, noteUpload, importLogs, stats, latest, series, keys, setKey, firmware, firmwareHistory, prune, rebuildNeeded: () => needsRebuild, exportRows, close, count: () => (available ? stats().rows : 0) };
}

module.exports = { create, parseUpload };
