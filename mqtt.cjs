'use strict';
/**
 * Health values for Home Assistant over MQTT.
 *
 * A small MQTT 3.1.1 client (publish only: connect, QoS 0, retain, last will, keep-alive, reconnect)
 * written with Node's net/tls, so there is no dependency to add. On top of it the publisher announces
 * entities with Home Assistant's MQTT discovery and keeps their state current:
 *
 *   per device   last upload (timestamp), upload spacing, reachable (ping), TLS handshake time, TLS
 *                errors, the four firmware versions, "upload overdue"
 *   the endpoint version, running since, network up, availability and number of outages over 7 days
 *

 * Optionally every value of the measurements database is published as well (one entity per key, named as
 * on the Measurements page): either only what Home Assistant cannot read over Modbus, or everything,
 * limited to the categories you pick. The values arrive in one JSON message per device.
 *
 * It only reports. Nothing arrives from Home Assistant, nothing controls a battery, and the battery
 * values themselves (state of charge, power, ...) are not sent: Home Assistant reads them over Modbus.
 * Device ids never appear in a topic or a name; a topic carries a short hash.
 */
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { MODBUS, SEED } = require('./keydefs.cjs');

const KEEPALIVE_S = 60;
const PUBLISH_MS = 30000;

const str = (s) => {
  const b = Buffer.from(String(s), 'utf8');
  return Buffer.concat([Buffer.from([b.length >> 8, b.length & 0xff]), b]);
};
function varint(n) {
  const out = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 0x80;
    out.push(d);
  } while (n > 0);
  return Buffer.from(out);
}
const packet = (first, body) => Buffer.concat([Buffer.from([first]), varint(body.length), body]);

/** @returns client with connect(), publish(), close(), isConnected(), lastError */
function client(opts, log = () => {}) {
  let sock = null;
  let connected = false;
  let closing = false;
  let buf = Buffer.alloc(0);
  let ka = null;
  let retry = null;
  let delay = 5000;
  let waiter = null;
  const api = { lastError: null };

  function parse() {
    while (buf.length >= 2) {
      let mult = 1, len = 0, i = 1, b;
      do {
        if (i >= buf.length) return;
        b = buf[i++];
        len += (b & 127) * mult;
        mult *= 128;
      } while (b & 128 && i < 5);
      if (buf.length < i + len) return;
      const type = buf[0] >> 4;
      const body = buf.subarray(i, i + len);
      buf = buf.subarray(i + len);
      if (type === 2) {
        const rc = body[1];
        if (rc === 0) {
          connected = true;
          delay = 5000;
          api.lastError = null;
          if (waiter) waiter.resolve({ ok: true });
          if (opts.onConnect) opts.onConnect();
        } else {
          const why = { 1: 'badProtocol', 2: 'badClientId', 3: 'serverUnavailable', 4: 'badCredentials', 5: 'notAuthorised' }[rc] || `refused ${rc}`;
          api.lastError = why;
          if (waiter) waiter.resolve({ ok: false, error: why });
          sock.destroy();
        }
      }
    }
  }

  function connect() {
    return new Promise((resolve) => {
      closing = false;
      waiter = { resolve };
      const done = (r) => { if (waiter) { const w = waiter; waiter = null; w.resolve(r); } };
      waiter.resolve = (r) => { waiter = null; resolve(r); };
      const onErr = (e) => {
        api.lastError = e.code || e.message;
        done({ ok: false, error: api.lastError });
      };
      const open = () => {
        const flags = 0x02 | (opts.will ? 0x04 | (opts.will.retain ? 0x20 : 0) : 0) | (opts.username ? 0x80 : 0) | (opts.password ? 0x40 : 0);
        const parts = [str('MQTT'), Buffer.from([4, flags, KEEPALIVE_S >> 8, KEEPALIVE_S & 0xff]), str(opts.clientId)];
        if (opts.will) parts.push(str(opts.will.topic), str(opts.will.payload));
        if (opts.username) parts.push(str(opts.username));
        if (opts.password) parts.push(str(opts.password));
        sock.write(packet(0x10, Buffer.concat(parts)));
      };
      sock = opts.tls
        ? tls.connect({ host: opts.host, port: opts.port, rejectUnauthorized: !opts.insecure, servername: net.isIP(opts.host) ? undefined : opts.host }, open)
        : net.connect({ host: opts.host, port: opts.port }, open);
      sock.setTimeout(15000);
      sock.on('timeout', () => { if (!connected) { sock.destroy(new Error('timeout')); } });
      sock.on('data', (d) => { buf = Buffer.concat([buf, d]); parse(); });
      sock.on('error', onErr);
      sock.on('close', () => {
        connected = false;
        clearInterval(ka);
        done({ ok: false, error: api.lastError || 'closed' });
        if (!closing && opts.reconnect) {
          retry = setTimeout(() => connect(), delay);
          retry.unref();
          delay = Math.min(60000, delay * 2);
        }
      });
      ka = setInterval(() => { if (connected) sock.write(Buffer.from([0xc0, 0x00])); }, (KEEPALIVE_S / 2) * 1000);
      ka.unref();
    });
  }

  api.connect = connect;
  api.isConnected = () => connected;
  api.publish = (topic, payload, retain = false) => {
    if (!connected) return false;
    sock.write(packet(0x30 | (retain ? 1 : 0), Buffer.concat([str(topic), Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8')])));
    return true;
  };
  api.close = () => {
    closing = true;
    clearTimeout(retry);
    clearInterval(ka);
    if (sock) {
      try { if (connected) sock.write(Buffer.from([0xe0, 0x00])); } catch { /* socket gone */ }
      sock.end();
      setTimeout(() => sock && sock.destroy(), 500).unref();
    }
    connected = false;
  };
  return api;
}

const CATEGORIES = ['firmware', 'power', 'energy', 'battery', 'bms', 'temperature', 'grid', 'pv', 'status', 'errors', 'network', 'system', 'other'];
const DEFAULT_CATEGORIES = ['firmware', 'power', 'energy', 'battery', 'bms', 'temperature', 'grid', 'pv', 'status'];
const DEFAULTS = { enabled: false, host: '', port: 1883, tls: false, insecure: false, username: '', topicPrefix: 'marstek-endpoint', discoveryPrefix: 'homeassistant', measurements: { mode: 'off', categories: DEFAULT_CATEGORIES } };
// never published: the address and the device clock are not health values
const NOT_PUBLISHED = new Set(['ip', 'dt']);
const CLASSES = { W: ['power', 'measurement'], kWh: ['energy', 'total_increasing'], Wh: ['energy', 'total_increasing'], V: ['voltage', 'measurement'], A: ['current', 'measurement'], '°C': ['temperature', 'measurement'], Hz: ['frequency', 'measurement'], '%': [null, 'measurement'] };
const DIAGNOSTIC = new Set(['status', 'errors', 'network', 'system', 'firmware']);

function normalise(c = {}) {
  const topic = (v, d) => (/^[A-Za-z0-9_\-/]{1,64}$/.test(String(v || '')) ? String(v).replace(/^\/+|\/+$/g, '') : d);
  return {
    enabled: c.enabled === true,
    host: String(c.host || '').trim().slice(0, 253),
    port: Number.isInteger(Number(c.port)) && Number(c.port) > 0 && Number(c.port) < 65536 ? Number(c.port) : 1883,
    tls: !!c.tls,
    insecure: !!c.insecure,
    username: String(c.username || '').trim().slice(0, 128),
    topicPrefix: topic(c.topicPrefix, DEFAULTS.topicPrefix),
    discoveryPrefix: topic(c.discoveryPrefix, DEFAULTS.discoveryPrefix),
    measurements: {
      mode: ['extra', 'all', 'custom'].includes(c.measurements && c.measurements.mode) ? c.measurements.mode : 'off',
      categories: Array.isArray(c.measurements && c.measurements.categories) ? CATEGORIES.filter((x) => c.measurements.categories.includes(x)) : DEFAULT_CATEGORIES,
    },
  };
}
const validate = (c) => (c.host && !/^[A-Za-z0-9.\-:]+$/.test(c.host) ? 'badHost' : null);

function create({ log, getConfig, getSecrets, version, devices, pingStatus, measurementsLatest, overdue, endpointInfo, selection = () => new Set() }) {
  let cl = null;
  let key = '';
  let timer = null;
  let announced = '';
  let announcedTopics = new Set();
  // one query per device and publish run: the discovery, the states and the firmware values all read the same rows
  let runCache = null;
  const lastRows = (uid) => {
    if (!runCache) return measurementsLatest(uid) || [];
    if (!runCache.has(uid)) runCache.set(uid, measurementsLatest(uid) || []);
    return runCache.get(uid);
  };
  let swept = false; // the first announcement after a start also clears what an earlier run left in the broker
  const status = { connected: false, lastError: null, lastPublish: null };
  const cfg = () => normalise(getConfig());
  const hid = (uid) => crypto.createHash('sha1').update(String(uid)).digest('hex').slice(0, 10);
  const nameOf = (d) => d.name || (d.mac ? `Venus ${d.mac.slice(-4)}` : `Venus ${hid(d.uid).slice(0, 4)}`);

  function connectIfNeeded() {
    const c = cfg();
    const secrets = getSecrets();
    const k = JSON.stringify([c, !!secrets.mqttPassword]);
    if (!c.enabled || !c.host) {
      if (cl) { cl.close(); cl = null; key = ''; announced = ''; }
      status.connected = false;
      return;
    }
    if (cl && key === k) return;
    if (cl) cl.close();
    key = k;
    announced = '';
    cl = client({
      host: c.host, port: c.port, tls: c.tls, insecure: c.insecure, username: c.username, password: secrets.mqttPassword || '',
      clientId: `marstek-endpoint-${crypto.randomBytes(3).toString('hex')}`, reconnect: true,
      will: { topic: `${c.topicPrefix}/status`, payload: 'offline', retain: true },
      onConnect: () => { status.connected = true; announced = ''; publishAll(); },
    }, log);
    cl.connect().then((r) => { if (!r.ok) status.lastError = r.error; });
  }

  const ent = (c, component, uid, obj, extra) => ({
    topic: `${c.discoveryPrefix}/${component}/mep_${uid}/${obj}/config`,
    payload: { unique_id: `mep_${uid}_${obj}`, availability_topic: `${c.topicPrefix}/status`, ...extra },
  });

  /** The keys that go out under the current settings, for one device. */
  function chosen(c, rows) {
    if (c.measurements.mode === 'off') return [];
    if (c.measurements.mode === 'custom') {
      const picked = selection();
      return rows.filter((r) => !NOT_PUBLISHED.has(r.key) && picked.has(r.key));
    }
    return rows.filter((r) => !NOT_PUBLISHED.has(r.key) && c.measurements.categories.includes(r.category || 'other') && (c.measurements.mode === 'all' || (r.evidence !== 'ha' && !MODBUS.has(r.key))));
  }
  const objId = (key) => String(key).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  function discovery(c) {
    const out = [];
    const v = (obj) => `{{ value_json.${obj} }}`;
    for (const d of devices.list()) {
      const id = hid(d.uid);
      const st = `${c.topicPrefix}/${id}/state`;
      const dev = { identifiers: [`mep_${id}`], name: nameOf(d), manufacturer: 'Marstek (via Offline Endpoint)', model: 'Venus' };
      const e = (comp, obj, name, extra) => out.push(ent(c, comp, id, obj, { name, state_topic: st, value_template: v(obj), device: dev, ...extra }));
      e('sensor', 'last_upload', 'Last upload', { device_class: 'timestamp' });
      e('sensor', 'upload_interval_s', 'Upload interval', { unit_of_measurement: 's', device_class: 'duration', state_class: 'measurement', entity_category: 'diagnostic' });
      e('binary_sensor', 'reachable', 'Reachable', { device_class: 'connectivity', payload_on: 'ON', payload_off: 'OFF' });
      e('binary_sensor', 'upload_overdue', 'Upload overdue', { device_class: 'problem', payload_on: 'ON', payload_off: 'OFF' });
      e('sensor', 'tls_handshake_ms', 'TLS handshake', { unit_of_measurement: 'ms', state_class: 'measurement', entity_category: 'diagnostic' });
      e('sensor', 'tls_errors', 'TLS errors', { state_class: 'total_increasing', entity_category: 'diagnostic' });
      for (const r of chosen(c, lastRows(d.uid))) {
        const [dc, sc] = r.key === 'bp' ? ['energy_storage', 'measurement'] : CLASSES[r.unit] || [null, null];
        const numeric = typeof r.value === 'number';
        out.push(ent(c, 'sensor', id, `m_${objId(r.key)}`, {
          name: r.name, state_topic: `${c.topicPrefix}/${id}/values`, value_template: `{{ value_json['${r.key}'] }}`, device: dev,
          ...(numeric && r.unit ? { unit_of_measurement: r.unit } : {}),
          ...(numeric && dc ? { device_class: dc } : {}),
          ...(numeric && sc ? { state_class: sc } : {}),
          ...(DIAGNOSTIC.has(r.category) ? { entity_category: 'diagnostic' } : {}),
        }));
      }
      for (const [obj, name] of [['fw_control', 'Control firmware'], ['fw_bms', 'BMS firmware'], ['fw_inverter', 'Inverter firmware'], ['fw_mppt', 'MPPT firmware']]) e('sensor', obj, name, { entity_category: 'diagnostic' });
    }
    const id = 'endpoint';
    const st = `${c.topicPrefix}/endpoint/state`;
    const dev = { identifiers: ['mep_endpoint'], name: 'Marstek Offline Endpoint', manufacturer: 'Community project', model: 'Offline Endpoint', sw_version: version };
    const e = (comp, obj, name, extra) => out.push(ent(c, comp, id, obj, { name, state_topic: st, value_template: v(obj), device: dev, ...extra }));
    e('sensor', 'running_since', 'Running since', { device_class: 'timestamp', entity_category: 'diagnostic' });
    e('binary_sensor', 'network', 'Network', { device_class: 'connectivity', payload_on: 'ON', payload_off: 'OFF' });
    e('sensor', 'availability_7d', 'Availability, 7 days', { unit_of_measurement: '%', state_class: 'measurement' });
    e('sensor', 'outages_7d', 'Outages, 7 days', { state_class: 'measurement' });
    e('sensor', 'version', 'Version', { entity_category: 'diagnostic' });
    return out;
  }

  function states(c) {
    const out = [];
    const onoff = (b) => (b ? 'ON' : 'OFF');
    for (const d of devices.list()) {
      const id = hid(d.uid);
      const ps = pingStatus(d.uid);
      const m = Object.fromEntries((lastRows(d.uid)).filter((r) => ['dn', 'bm', 'iv', 'mv'].includes(r.key)).map((r) => [r.key, r.raw]));
      const fw = d.fw || {};
      out.push({
        topic: `${c.topicPrefix}/${id}/state`,
        payload: {
          last_upload: d.lastUpload ? new Date(d.lastUpload).toISOString() : null,
          upload_interval_s: d.uploadIntervalS ?? null,
          reachable: ps ? onoff(ps.state === 'up') : 'OFF',
          upload_overdue: onoff(overdue(d.uid)),
          tls_handshake_ms: d.handshakeMs ?? null,
          tls_errors: d.tlsErrorCount ?? 0,
          fw_control: m.dn ?? fw.sv ?? null,
          fw_bms: m.bm ?? fw.sbv ?? null,
          fw_inverter: m.iv ?? fw.inv ?? null,
          fw_mppt: m.mv ?? fw.mpptv ?? null,
        },
      });
    }
    for (const d of devices.list()) {
      const rows = chosen(c, lastRows(d.uid));
      if (!rows.length) continue;
      out.push({ topic: `${c.topicPrefix}/${hid(d.uid)}/values`, payload: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
    }
    const e = endpointInfo();
    out.push({
      topic: `${c.topicPrefix}/endpoint/state`,
      payload: { running_since: new Date(e.startedAt).toISOString(), network: onoff(e.network !== 'down'), availability_7d: e.availability ?? null, outages_7d: e.outages ?? 0, version },
    });
    return out;
  }

  function publishAll() {
    if (!cl || !cl.isConnected()) return;
    runCache = new Map();
    try {
      publishRun();
    } finally {
      runCache = null;
    }
  }

  function publishRun() {
    const c = cfg();
    const disc = discovery(c);
    const sig = JSON.stringify(disc.map((x) => [x.topic, x.payload.device.name, x.payload.name, x.payload.unit_of_measurement || '']));
    if (sig !== announced) {
      // entities that are no longer announced (a key switched off, a category dropped) are removed from Home Assistant
      const now = new Set(disc.map((x) => x.topic));
      for (const old of announcedTopics) if (!now.has(old)) cl.publish(old, '', true);
      if (!swept) {
        // the broker keeps the entities of earlier runs: clear every measurement entity that is not announced now
        for (const d of devices.list()) {
          const keys = new Set([...SEED.map((x) => x[0]), ...(lastRows(d.uid)).map((r) => r.key)]);
          for (const k of keys) {
            const t = ent(c, 'sensor', hid(d.uid), `m_${objId(k)}`, {}).topic;
            if (!now.has(t)) cl.publish(t, '', true);
          }
        }
        swept = true;
      }
      announcedTopics = now;
      for (const d of disc) cl.publish(d.topic, d.payload, true);
      cl.publish(`${c.topicPrefix}/status`, 'online', true);
      announced = sig;
    }
    for (const s of states(c)) cl.publish(s.topic, s.payload, true);
    status.lastPublish = Date.now();
  }

  function begin() {
    connectIfNeeded();
    timer = setInterval(() => {
      try {
        connectIfNeeded();
        status.connected = !!(cl && cl.isConnected());
        if (cl && cl.lastError) status.lastError = cl.lastError;
        publishAll();
      } catch (e) {
        log(`web   mqtt: ${e.message}`);
      }
    }, PUBLISH_MS);
    timer.unref();
  }

  /** How many entities per device the settings would publish, for the page: current choice, only-extra, everything. */
  function preview() {
    const c = cfg();
    const list = devices.list();
    if (!list.length) return { devices: 0, current: 0, extra: 0, all: 0 };
    const rows = measurementsLatest(list[0].uid) || [];
    const n = (mode) => chosen({ ...c, measurements: { ...c.measurements, mode } }, rows).length;
    return { devices: list.length, current: chosen(c, rows).length, extra: n('extra'), all: n('all'), custom: n('custom') };
  }

  /** Which of these rows (as returned by measurementsLatest) go out under the current settings, for the Measurements page. */
  function sentKeys(rows) {
    return chosen(cfg(), rows).map((r) => r.key);
  }

  /** Apply a changed setting now instead of at the next tick. */
  function reload() {
    connectIfNeeded();
  }

  /** Announce and send again right away (the selection or a name changed). */
  function refresh() {
    try { publishAll(); } catch (e) { log(`web   mqtt: ${e.message}`); }
  }

  /** Connect with the given settings, publish one message, disconnect: tells the owner if the broker accepts them. */
  async function test(c0, secrets) {
    const c = normalise(c0);
    if (!c.host) return { ok: false, error: 'notConfigured' };
    const t = client({ host: c.host, port: c.port, tls: c.tls, insecure: c.insecure, username: c.username, password: secrets.mqttPassword || '', clientId: `marstek-endpoint-test-${crypto.randomBytes(3).toString('hex')}`, reconnect: false });
    const r = await t.connect();
    if (r.ok) {
      t.publish(`${c.topicPrefix}/test`, 'ok', false);
      await new Promise((res) => setTimeout(res, 300));
    }
    t.close();
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  return { begin, reload, refresh, test, preview, sentKeys, status: () => ({ ...status, connected: !!(cl && cl.isConnected()) }), shutdown: () => { clearInterval(timer); if (cl) { try { cl.publish(`${cfg().topicPrefix}/status`, 'offline', true); } catch { /* closing */ } cl.close(); } } };
}

module.exports = { create, client, normalise, validate, DEFAULTS, CATEGORIES };
