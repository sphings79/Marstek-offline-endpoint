'use strict';
/**
 * The support package: one .tar.gz a user can attach to a bug report.
 *
 *   README.txt            what is inside and what was masked
 *   info.json             version, platform, settings (no secrets), disk usage
 *   endpoint.csv          periods in which the endpoint was off or had no network
 *   container.log         the last console lines of the endpoint
 *   device-N/summary.json what the endpoint knows about the device
 *   device-N/events.csv   uploads, time requests, ping outages, handshakes, TLS errors
 *   device-N/raw/...      only with "raw data": the request log lines of that device
 *
 * Masking: device ids, serial/MAC numbers, IP addresses and device names become
 * device-N / ip-N / mac-N. Tokens and e-mail addresses are removed ALWAYS, also in
 * raw mode -- they show up in requests from the phone app and are credentials.
 *
 * tar (ustar) is written by hand and compressed with zlib: no dependency.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const history = require('./history.cjs');

const gzip = promisify(zlib.gzip);

// --- tar ---------------------------------------------------------------------
function tarEntry(name, content, mtime) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const header = Buffer.alloc(512, 0);
  const put = (str, off, len) => header.write(str, off, Math.min(len, Buffer.byteLength(str)), 'utf8');
  const octal = (n, len) => `${n.toString(8).padStart(len - 1, '0')}\0`;
  put(name.slice(0, 100), 0, 100);
  put(octal(0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(body.length, 12), 124, 12);
  put(octal(Math.floor(mtime / 1000), 12), 136, 12);
  header.fill(0x20, 148, 156); // checksum field counts as spaces while summing
  put('0', 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  let sum = 0;
  for (const b of header) sum += b;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512, 0);
  return Buffer.concat([header, body, pad]);
}
const tarEnd = () => Buffer.alloc(1024, 0);

// --- masking -----------------------------------------------------------------
function makeMasker(devices, raw) {
  const ids = new Map();
  const macs = new Map();
  const ips = new Map();
  devices.forEach((d, i) => {
    ids.set(d.uid, `device-${i + 1}`);
    for (const m of d.merged || []) ids.set(m, `device-${i + 1}`);
    if (d.mac) macs.set(d.mac, `mac-${i + 1}`);
    if (d.ip) ips.set(d.ip, `ip-${i + 1}`);
  });
  let other = 0;
  const unknownIp = (ip) => {
    if (!ips.has(ip)) ips.set(ip, `ip-other-${++other}`);
    return ips.get(ip);
  };

  /** Credentials: removed in every mode. */
  const secrets = (text) =>
    String(text)
      .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '<token>')
      .replace(/([?&;\s"'](?:token|access_token|refresh_token|authorization|password|passwd|secret|key)=)[^&\s"';]+/gi, '$1<removed>')
      .replace(/"(authorization|cookie|set-cookie|x-csrf-token)"\s*:\s*"[^"]*"/gi, '"$1":"<removed>"')
      .replace(/[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');

  /** Identity: removed unless the owner asked for raw data. */
  const identity = (text) => {
    let s = String(text);
    for (const [uid, alias] of ids) s = s.split(uid).join(alias);
    for (const [mac, alias] of macs) s = s.split(mac).join(alias);
    s = s.replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, '<mac>');
    s = s.replace(/(\bsn=)[0-9A-Fa-f]{12}\b/g, '$1<mac>');
    s = s.replace(/((?:\buid|\bdevid|\bdi|\bmac)=)[0-9A-Za-z]{6,}/g, '$1<id>');
    s = s.replace(/\/venus\/[0-9A-Za-z]{6,}/g, '/venus/<id>');
    s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (ip) => (ip === '127.0.0.1' || ip === '0.0.0.0' ? ip : ips.get(ip) || unknownIp(ip)));
    return s;
  };
  const text = (value) => (raw ? secrets(value) : identity(secrets(value)));
  return { text, secrets, idAlias: (uid) => ids.get(uid), ipAlias: (ip) => ips.get(ip), macAlias: (mac) => macs.get(mac) };
}

// --- csv ---------------------------------------------------------------------
const q = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header, rows) => `${[header, ...rows].map((r) => r.map(q).join(',')).join('\n')}\n`;
const iso = (ms) => new Date(ms).toISOString();

// --- the package ----------------------------------------------------------------
/**
 * @param {object} ctx  dataDir, devices (registry), version, config, listener, disk, pingStatus, logLines
 * @param {{devices:'all'|string, range:string, raw:boolean, measurements?:boolean}} opts
 */
async function build(ctx, opts) {
  const now = Date.now();
  const range = Object.hasOwn(history.RANGES, opts.range) ? opts.range : '7d';
  const all = ctx.devices.list().map((d) => ctx.devices.get(d.uid));
  const picked = opts.devices === 'all' ? all : all.filter((d) => d.uid === opts.devices);
  const mask = makeMasker(all, !!opts.raw);
  const files = [];
  const add = (name, content) => files.push(tarEntry(`marstek-endpoint-support/${name}`, content, now));

  // per device
  let n = 0;
  for (const d of picked) {
    n += 1;
    const dir = opts.raw ? `device-${all.indexOf(d) + 1}` : mask.idAlias(d.uid);
    const ids = ctx.devices.idsOf(d.uid);
    const up = history.events(ctx.dataDir, ids, 'upload', range);
    const tm = history.events(ctx.dataDir, ids, 'time', range);
    const conn = history.connectionHistory(ctx.dataDir, d.ip, range);
    const ph = history.pingHistory(ctx.dataDir, ids, range);

    const gapRows = (list, kind) => list.map((e, i) => [iso(e.ts), kind, i ? Math.round((e.ts - list[i - 1].ts) / 1000) : '', e.bytes ?? '']);
    const events = [
      ...gapRows(up, 'upload').map((r) => [r[0], r[1], `gap_s=${r[2]} bytes=${r[3]}`]),
      ...gapRows(tm, 'time_request').map((r) => [r[0], r[1], `gap_s=${r[2]}`]),
      ...conn.handshakes.map((h) => [iso(h.ts), 'tls_handshake', `ms=${h.ms}`]),
      ...conn.tlsErrors.map((e) => [iso(e.ts), 'tls_error', e.code]),
      ...ph.outages.flatMap((o) => [[iso(o.start), 'ping_down', ''], o.end ? [iso(o.end), 'ping_up', `down_s=${Math.round((o.end - o.start) / 100) / 10}`] : null].filter(Boolean)),
      ...ph.watched.flatMap((w) => [[iso(w.start), 'ping_watch_start', ''], w.end ? [iso(w.end), 'ping_watch_stop', ''] : null].filter(Boolean)),
    ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    add(`${dir}/events.csv`, csv(['time_utc', 'type', 'detail'], events));

    if (opts.measurements && ctx.measurements) {
      // decoded values that changed, with the names as the owner edited them
      const rows = ctx.measurements.exportRows(new Map(ids.map((i) => [i, dir])), history.sinceOf(range));
      add(`${dir}/firmware-history.csv`, csv(['time_utc', 'part', 'from', 'to'], ctx.measurements.firmwareHistory(ids).map((c) => [iso(c.ts), c.part, c.from ?? '', c.to])));
      add(`${dir}/measurements.csv`, mask.text(csv(['time_utc', 'key', 'name', 'value', 'unit', 'raw', 'model', 'firmware', 'confirmed_for_this'], rows.map((r) => [iso(r.ts), r.key, r.name, r.value, r.unit, r.raw, r.model, r.fw, r.confirmed ? 'yes' : 'no']))));
    }

    add(`${dir}/summary.json`, JSON.stringify({
      name: opts.raw ? d.name : undefined,
      id: opts.raw ? d.uid : undefined,
      mac: opts.raw ? d.mac : undefined,
      ip: opts.raw ? d.ip : mask.ipAlias(d.ip),
      firmware: d.fw,
      firstSeen: iso(d.firstSeen),
      lastSeen: iso(d.lastSeen),
      uploadCount: d.uploadCount,
      timeRequestCount: d.timeCount,
      uploadIntervalS: d.uploadIntervalS,
      timeRequestIntervalS: d.timeIntervalS,
      handshakeAvgMs: d.handshakeMs,
      handshakeMaxMs: d.handshakeMaxMs,
      tlsErrors: d.tlsErrorCount,
      mergedIds: d.mergedCount,
      pingEnabled: d.pingOn,
      ping: ctx.pingStatus(d.uid),
      range,
      periodCounts: { uploads: up.length, timeRequests: tm.length, pingOutages: ph.outages.length, handshakes: conn.handshakes.length, tlsErrors: conn.tlsErrors.length },
    }, null, 2));

    if (opts.raw) {
      // the request log lines of this device, with credentials removed
      const needles = [...ids, d.ip].filter(Boolean);
      const since = history.sinceOf(range);
      let names = [];
      try { names = fs.readdirSync(ctx.dataDir); } catch { /* nothing to add */ }
      for (const f of names.sort()) {
        const rq = /^requests-(\d{4})-(\d\d)-(\d\d)\.jsonl$/.exec(f);
        const pg = /^ping-.*-(\d{4})-(\d\d)-(\d\d)\.jsonl$/.exec(f);
        const m = rq || pg;
        if (!m || Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + 86400e3 < since) continue;
        if (pg && !ids.some((id) => f.startsWith(`ping-${id}-`))) continue;
        let text;
        try { text = fs.readFileSync(path.join(ctx.dataDir, f), 'utf8'); } catch { continue; }
        const keep = pg ? text.split('\n') : text.split('\n').filter((l) => l && needles.some((x) => l.includes(x)));
        if (keep.length) add(`${dir}/raw/${f}`, `${mask.text(keep.join('\n'))}\n`);
      }
    }
  }

  // header files
  add('info.json', JSON.stringify({
    generated: iso(now),
    version: ctx.version,
    web: ctx.webInfo ? { version: ctx.webInfo.version, source: ctx.webInfo.root, safeMode: !!ctx.webInfo.safeMode, failedUpdates: (ctx.webInfo.failed || []).map((f) => f.version) } : undefined,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    uptimeS: Math.round(process.uptime()),
    timezone: process.env.TZ || 'UTC',
    range,
    rawData: !!opts.raw,
    devicesInPackage: picked.length,
    devicesKnown: all.length,
    settings: {
      retentionDays: ctx.config.retentionDays,
      updateCheck: !!ctx.config.updateCheck,
      notifications: !!(ctx.config.notify && ctx.config.notify.enabled),
      mqtt: !!(ctx.config.mqtt && ctx.config.mqtt.enabled),
      measurementsDb: ctx.config.measurements !== false && !!(ctx.measurements && ctx.measurements.available),
      webPort: ctx.listener.port,
      webTls: ctx.listener.tls,
      basePathSet: ctx.listener.basePath !== '/',
      trustedProxies: ctx.listener.trustProxy.length,
      ping: process.env.PING !== '0',
      acceptAll: process.env.ACCEPT_ALL === '1',
      mqttProbePort: Number(process.env.MQTT_PORT ?? 8883),
      logConnections: process.env.LOG_CONNECTIONS !== '0',
      logHandshake: process.env.LOG_HANDSHAKE !== '0',
    },
    logFiles: ctx.disk,
  }, null, 2));
  if (ctx.endpoint) {
    const e = ctx.endpoint;
    const rows = [['time_utc', 'type', 'detail']];
    rows.push([iso(e.trackedSince || now), 'recorded_since', e.trackedSince ? '' : 'nothing recorded yet']);
    rows.push([iso(now), 'summary', `availability_pct=${e.stats.availabilityPct ?? ''} running_pct=${e.stats.runningPct ?? ''} outages=${e.stats.outages} off_s=${e.stats.offS} no_network_s=${e.stats.noNetS}`]);
    for (const p of e.periods) rows.push([iso(p.start), p.kind === 'off' ? `endpoint_off_${p.cause}` : 'endpoint_no_network', `duration_s=${Math.round((p.end - p.start) / 1000)} until=${iso(p.end)}`]);
    add('endpoint.csv', `${rows.map((r) => r.join(',')).join('\n')}\n`);
  }
  add('container.log', `${mask.text(ctx.logLines.join('\n'))}\n`);
  add('README.txt', [
    'Marstek Offline Endpoint - support package',
    `Created ${iso(now)}, version ${ctx.version}, period ${range}.`,
    '',
    'What is inside: info.json (settings, no secrets), endpoint.csv (when the endpoint itself was off or had no\n    network), container.log (the last console lines),',
    'and one folder per device with summary.json and events.csv (uploads, time requests, ping',
    'outages, TLS handshakes and errors, all in UTC)' + (opts.measurements ? ' and measurements.csv (the decoded values that changed, with the names set in the interface).' : '.'),
    '',
    opts.raw
      ? 'RAW DATA IS INCLUDED: device ids, serial/MAC numbers, IP addresses and the request log lines of the device.\nTokens and e-mail addresses are removed anyway. Only share this with someone you trust.'
      : 'Masked: device ids, serial/MAC numbers, IP addresses and names are replaced by device-N, mac-N and ip-N.\nNo request bodies are included. Tokens and e-mail addresses are always removed.',
    '',
    'Nothing here is sent anywhere. Look through it before you attach it to an issue.',
    '',
  ].join('\n'));

  const tar = Buffer.concat([...files, tarEnd()]);
  const body = await gzip(tar, { level: 9 });
  return { body, devices: picked.length };
}

module.exports = { build, makeMasker, tarEntry, tarEnd };
