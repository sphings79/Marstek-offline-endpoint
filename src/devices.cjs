'use strict';
/**
 * The device list of the web interface.
 *
 * Devices are not configured, they are recognised: the telemetry upload carries
 * the device id in its URL and the time request carries it in the query string,
 * together with the firmware versions. The upload body carries `sn`, which on the
 * Venus is the MAC address. The source address comes from the socket and may
 * change (DHCP) without the device changing: the id stays, the address is simply
 * updated on the next request.
 *
 * Connection and TLS events only know the address, so they are attributed to the
 * device that last used that address.
 *
 * A device can be removed (it comes back by itself when it talks again) and one
 * device id can be merged into another, for a board that was replaced and now
 * reports a new id. A merged id is remembered as an alias, so its later requests
 * land on the device it was merged into.
 *
 * Kept in memory, written to devices.json (debounced). At the first start the last
 * two days of the request log are replayed, so the list is filled right after an
 * update.
 */
const fs = require('fs');
const path = require('path');
const store = require('./store.cjs');

const RING = 40;
const UPLOAD_RE = /^\/data-upload\/v1\/venus\/([0-9A-Za-z]+)/;

function cleanIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '');
}

function create(dataDir) {
  const file = path.join(dataDir, 'devices.json');
  const saved = store.read(file, {});
  // older files were a bare uid -> device map
  const devices = new Map(Object.entries(saved.devices || (saved.aliases ? {} : saved)));
  const aliases = new Map(Object.entries(saved.aliases || {}));
  const byIp = new Map();
  for (const [uid, d] of devices) if (d.ip) byIp.set(d.ip, uid);
  let timer = null;

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    store.write(file, { devices: Object.fromEntries(devices), aliases: Object.fromEntries(aliases) });
  }
  function schedule() {
    if (timer) return;
    timer = setTimeout(flush, 20000);
    timer.unref();
  }

  const resolve = (uid) => aliases.get(uid) || uid;

  function ensure(uid, ip, ts) {
    let d = devices.get(uid);
    if (!d) {
      d = {
        uid,
        name: null,
        ip: null,
        mac: null,
        model: null,
        aid: null,
        firstSeen: ts,
        lastSeen: ts,
        fw: {},
        uploads: [],
        times: [],
        uploadCount: 0,
        timeCount: 0,
        handshakes: [],
        connections: 0,
        tlsErrors: [],
        lastUploadBytes: null,
        merged: [],
        pingOn: true,
      };
      devices.set(uid, d);
    }
    if (ip && d.ip !== ip) {
      d.ip = ip;
      byIp.set(ip, uid);
    }
    return d;
  }

  const push = (arr, v) => {
    arr.push(v);
    if (arr.length > RING) arr.splice(0, arr.length - RING);
  };

  /** `sn=682499ef041c` inside the upload body is the device's MAC address. */
  function macFromBody(body) {
    const text = body && typeof body === 'object' ? body.d : null;
    if (typeof text !== 'string') return null;
    const m = /(?:^|&)sn=([0-9A-Fa-f]{12})(?:&|$)/.exec(text);
    return m ? m[1].toLowerCase() : null;
  }

  /** A telemetry upload or a time request from a device. */
  function noteRequest({ url, remote, ts, bytes, body }) {
    const t = Date.parse(ts) || Date.now();
    const ip = cleanIp(remote);
    let uid = null;
    let kind = null;
    let query = null;
    const up = UPLOAD_RE.exec(url || '');
    if (up) {
      uid = up[1];
      kind = 'upload';
    } else if (/\/getDateInfo/.test(url || '')) {
      try {
        query = new URL(url, 'http://x').searchParams;
      } catch {
        return;
      }
      uid = query.get('uid');
      kind = 'time';
    }
    if (!uid || !kind) return;
    uid = resolve(uid);
    const known = devices.get(uid);
    const last = known && (kind === 'upload' ? known.uploads[known.uploads.length - 1] : known.times[known.times.length - 1]);
    if (last && t <= last) return; // already counted (log replay)
    const dev = ensure(uid, ip, t);
    dev.lastSeen = Math.max(dev.lastSeen, t);
    if (kind === 'upload') {
      push(dev.uploads, t);
      dev.uploadCount += 1;
      dev.lastUploadBytes = bytes ?? null;
      const mac = macFromBody(body);
      if (mac) dev.mac = mac;
    } else {
      push(dev.times, t);
      dev.timeCount += 1;
      // `aid=VNSD-0`: the first part is the model family (VNSD, VNSA, VNSE3), the rest a variant number
      const aid = query.get('aid');
      const fam = aid && /^([A-Za-z0-9]{2,12})(?:-|$)/.exec(aid);
      if (fam) {
        dev.aid = aid.slice(0, 20);
        dev.model = fam[1].toUpperCase();
      }
      const fw = {};
      for (const k of ['sv', 'fcv', 'sbv', 'mv', 'inv', 'mpptv']) if (query.get(k)) fw[k] = query.get(k);
      dev.fw = { ...dev.fw, ...fw };
    }
    schedule();
  }

  function deviceFor(remote) {
    const uid = byIp.get(cleanIp(remote));
    return uid ? devices.get(uid) : null;
  }

  function noteConnection({ remote, handshakeMs, tlsError }) {
    const d = deviceFor(remote);
    if (!d) return;
    d.connections += 1;
    if (typeof handshakeMs === 'number') push(d.handshakes, handshakeMs);
    if (tlsError) push(d.tlsErrors, { ts: Date.now(), code: tlsError });
    schedule();
  }

  function noteTlsError({ remote, code }) {
    const d = deviceFor(remote);
    if (!d) return;
    push(d.tlsErrors, { ts: Date.now(), code });
    schedule();
  }

  /** Devices for the ping watch: every one with a known address, flagged on or off. */
  function watchTargets() {
    return [...devices.values()].map((d) => ({ uid: d.uid, ip: d.ip, on: d.pingOn !== false }));
  }
  function setPing(uid, on) {
    const d = devices.get(uid);
    if (!d) return false;
    d.pingOn = !!on;
    flush(); // a switch the owner flipped must not be lost to a crash within the debounce window
    return true;
  }
  /** The device family of a device (or of the one an old id was merged into); '' while unknown. */
  function modelOf(uid) {
    const d = devices.get(resolve(uid));
    return d && d.model ? d.model : '';
  }
  function ipOf(uid) {
    const d = devices.get(uid);
    return d ? d.ip : null;
  }

  function rename(uid, name) {
    const d = devices.get(uid);
    if (!d) return false;
    d.name = name ? String(name).trim().slice(0, 40) || null : null;
    schedule();
    return true;
  }

  /** Forget a device. It shows up again by itself if it talks to the endpoint again. */
  function remove(uid) {
    const d = devices.get(uid);
    if (!d) return false;
    devices.delete(uid);
    if (d.ip && byIp.get(d.ip) === uid) byIp.delete(d.ip);
    for (const [from, to] of [...aliases]) if (to === uid || from === uid) aliases.delete(from);
    flush();
    return true;
  }

  /** Fold `fromUid` into `intoUid`; later requests under the old id count for the target. */
  function merge(intoUid, fromUid) {
    const into = devices.get(intoUid);
    const from = devices.get(fromUid);
    if (!into || !from || intoUid === fromUid) return false;
    const join = (a, b) => [...a, ...b].sort((x, y) => x - y).slice(-RING);
    into.uploads = join(into.uploads, from.uploads);
    into.times = join(into.times, from.times);
    into.uploadCount += from.uploadCount;
    into.timeCount += from.timeCount;
    into.connections += from.connections;
    into.handshakes = [...from.handshakes, ...into.handshakes].slice(-RING);
    into.tlsErrors = [...from.tlsErrors, ...into.tlsErrors].sort((x, y) => x.ts - y.ts).slice(-RING);
    into.firstSeen = Math.min(into.firstSeen, from.firstSeen);
    into.lastSeen = Math.max(into.lastSeen, from.lastSeen);
    into.mac = into.mac || from.mac;
    into.model = into.model || from.model;
    into.merged = [...new Set([...(into.merged || []), fromUid, ...(from.merged || [])])];
    for (const u of into.merged) aliases.set(u, intoUid);
    devices.delete(fromUid);
    if (from.ip && byIp.get(from.ip) === fromUid) byIp.set(from.ip, intoUid);
    flush();
    return true;
  }

  /** The ids whose log lines belong to this device (itself plus everything merged into it). */
  function idsOf(uid) {
    const d = devices.get(uid);
    return d ? [uid, ...(d.merged || [])] : [];
  }

  function median(values) {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  function gaps(ring) {
    const out = [];
    for (let i = 1; i < ring.length; i++) out.push(Math.round((ring[i] - ring[i - 1]) / 1000));
    return out.slice(-20);
  }

  function summary(d) {
    const hs = d.handshakes.slice(-20);
    return {
      uid: d.uid,
      name: d.name,
      ip: d.ip,
      mac: d.mac || null,
      model: d.model || null,
      firstSeen: d.firstSeen,
      lastSeen: d.lastSeen,
      fw: d.fw,
      lastUpload: d.uploads[d.uploads.length - 1] || null,
      lastTime: d.times[d.times.length - 1] || null,
      uploadCount: d.uploadCount,
      timeCount: d.timeCount,
      uploadIntervalS: median(gaps(d.uploads)),
      timeIntervalS: median(gaps(d.times)),
      handshakeMs: hs.length ? Math.round(hs.reduce((a, b) => a + b, 0) / hs.length) : null,
      handshakeMaxMs: hs.length ? Math.max(...hs) : null,
      tlsErrorCount: d.tlsErrors.length,
      lastTlsError: d.tlsErrors[d.tlsErrors.length - 1] || null,
      lastUploadBytes: d.lastUploadBytes,
      mergedCount: (d.merged || []).length,
      pingOn: d.pingOn !== false,
    };
  }

  function list() {
    return [...devices.values()].map(summary).sort((a, b) => (a.name || a.ip || a.uid).localeCompare(b.name || b.ip || b.uid));
  }

  function get(uid) {
    const d = devices.get(uid);
    if (!d) return null;
    const sameMac = d.mac ? [...devices.values()].filter((o) => o.uid !== uid && o.mac === d.mac).map((o) => o.uid) : [];
    return {
      ...summary(d),
      recentHandshakes: d.handshakes.slice(-20),
      tlsErrors: d.tlsErrors.slice(-10),
      merged: d.merged || [],
      sameMac,
      others: [...devices.values()].filter((o) => o.uid !== uid).map((o) => ({ uid: o.uid, name: o.name, ip: o.ip, mac: o.mac || null, lastSeen: o.lastSeen })),
    };
  }

  /** Replay the last days of the request log so a restart does not start empty. */
  function backfill(days = 2) {
    let files = [];
    try {
      files = fs.readdirSync(dataDir).filter((f) => /^requests-\d{4}-\d\d-\d\d\.jsonl$/.test(f)).sort().slice(-days);
    } catch {
      return;
    }
    for (const f of files) {
      let text = '';
      try {
        text = fs.readFileSync(path.join(dataDir, f), 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line) continue;
        let r;
        try {
          r = JSON.parse(line);
        } catch {
          continue;
        }
        if (r.kind === 'connection') noteConnection({ remote: r.remote, handshakeMs: r.handshakeMs, tlsError: r.tlsError });
        else if (r.kind === 'tls-error') noteTlsError({ remote: r.remote, code: r.code });
        else if (r.url && r.accepted) noteRequest({ url: r.url, remote: r.remote, ts: r.ts, bytes: typeof r.body === 'string' ? r.body.length : null, body: r.body });
      }
    }
  }

  return { modelOf, noteRequest, noteConnection, noteTlsError, rename, remove, merge, idsOf, ipOf, watchTargets, setPing, list, get, backfill, flush, count: () => devices.size };
}

module.exports = { create };
