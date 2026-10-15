'use strict';
/**
 * Web interface of the Marstek Offline Endpoint: login, device list, settings.
 *
 * Node core only. Lives on its own port, separate from the endpoint the batteries
 * talk to, and answers nothing the batteries need.
 *
 * Environment:
 *   WEB_PORT      8443; 0 switches the interface off
 *   WEB_TLS       1 (default) serves HTTPS with the endpoint's certificate; 0 serves
 *                 plain HTTP, for running behind a reverse proxy that terminates TLS
 *   BASE_PATH     e.g. /marstek, when the proxy mounts the interface under a sub-path
 *   TRUST_PROXY   comma separated proxy addresses or IPv4 CIDRs. Only requests that
 *                 arrive from one of them may set X-Forwarded-For/-Proto/-Host.
 *                 Unset: those headers are ignored, so nobody can fake a client address.
 * These are deliberately not changeable from the interface: a wrong value would lock
 * you out of the very page you would fix it on, and TRUST_PROXY is a security boundary.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const authLib = require('./auth.cjs');
const devicesLib = require('./devices.cjs');
const history = require('./history.cjs');
const updatesLib = require('./updates.cjs');
const pingLib = require('./ping.cjs');
const uptimeHistory = require('./uptime-history.cjs');
const dbLib = require('./db.cjs');
const notifyLib = require('./notify.cjs');
const webUpdateLib = require('./webupdate.cjs');
const mqttLib = require('./mqtt.cjs');
const supportLib = require('./support.cjs');
const logbuf = require('./logbuf.cjs');
const store = require('./store.cjs');

const WEB_DIR = path.join(__dirname, 'web');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const MAX_JSON = 8 * 1024;

const normIp = (ip) => String(ip || '').replace(/^::ffff:/, '');

function parseTrust(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [addr, bits] = entry.split('/');
      if (net.isIPv4(addr) && bits !== undefined) {
        const n = Number(bits);
        const toInt = (a) => a.split('.').reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0);
        const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
        return { test: (ip) => net.isIPv4(ip) && ((toInt(ip) & mask) >>> 0) === ((toInt(addr) & mask) >>> 0), text: entry };
      }
      return { test: (ip) => ip === addr, text: entry };
    });
}

function normaliseBase(value) {
  let b = String(value || '').trim();
  if (!b || b === '/') return '';
  if (!b.startsWith('/')) b = `/${b}`;
  return b.replace(/\/+$/, '');
}

function init({ dataDir, certDir, key, cert, version, log, ipc = null, webInfo = {} }) {
  const PORT = Number(process.env.WEB_PORT ?? 8443);
  if (!PORT) {
    log('web   interface off (WEB_PORT=0)');
    return null;
  }
  const TLS = process.env.WEB_TLS !== '0';
  const BASE = normaliseBase(process.env.BASE_PATH);
  const trusted = parseTrust(process.env.TRUST_PROXY);
  const isTrusted = (ip) => trusted.some((t) => t.test(ip));

  const configFile = path.join(dataDir, 'config.json');
  // the update check is on unless the owner switched it off: it only reads public release notes
  const config = { retentionDays: 30, updateCheck: true, measurements: true, notify: notifyLib.DEFAULTS, mqtt: mqttLib.DEFAULTS, ...store.read(configFile, {}) };
  const saveConfig = () => store.write(configFile, config);
  // tokens and passwords: owner-only file, never sent back to the page
  const secretsFile = path.join(dataDir, 'secrets.json');
  const getSecrets = () => store.read(secretsFile, {});
  /** What the page may know about the secrets: that they exist, and of the webhook only the host. */
  const secretFlags = (s) => {
    let host = null;
    try { host = s.webhookUrl ? new URL(s.webhookUrl).host : null; } catch { /* stored value is validated on save */ }
    return { telegram: !!s.telegramToken, ha: !!s.haToken, pushover: !!(s.pushoverToken && s.pushoverUser), webhook: !!s.webhookUrl, webhookHost: host, webhookAuth: !!s.webhookAuth };
  };
  const putSecrets = (patch) => {
    const next = { ...getSecrets(), ...patch };
    for (const k of Object.keys(next)) if (next[k] === null || next[k] === '') delete next[k];
    store.write(secretsFile, next);
  };

  const webUpdater = webUpdateLib.create({
    dataDir, imageDir: webInfo.imageDir || __dirname, containerVersion: version, ipcVersion: webInfo.ipcVersion || 1, log,
  });
  const updates = updatesLib.create({
    dataDir, version, webVersion: webInfo.version || null, ipcVersion: webInfo.ipcVersion || 1, isEnabled: () => !!config.updateCheck, log,
    isInstallable: (r) => !!ipc && webUpdater.publicKey() && !!webUpdater.assetsOf(r),
  });
  const auth = authLib.create(dataDir, log);
  const devices = devicesLib.create(dataDir);
  const pings = pingLib.create({ dataDir, devices, log });
  const measurements = dbLib.create({ dataDir, log, isEnabled: () => config.measurements !== false, modelOf: (uid) => (devices && devices.modelOf ? devices.modelOf(uid) : '') });
  // The endpoint's own life is tracked by the main process (the one that answers the batteries), so a
  // restart of this web process is not reported as the endpoint being off. Here only the latest status
  // that the main process sends is kept, and its record is read from the files.
  let mainStatus = { startedAt: Date.now(), start: { prev: 'none', from: null }, network: 'unknown', networkSince: null, networkCheck: false, gateway: null, gatewaySource: '' };
  const uptime = { status: () => mainStatus, history: (range, since) => uptimeHistory.history(dataDir, since) };
  if (ipc) {
    ipc.on('uptime', (s) => { mainStatus = s; });
    ipc.on('log', (line) => logbuf.push(line));
    ipc.on('logs', (lines) => { for (const l of lines) logbuf.push(l); });
    // the main process needs the device addresses to pick the gateway of the network the batteries are on
    const sendIps = () => ipc.send({ t: 'deviceIps', ips: devices.watchTargets().map((d) => d.ip).filter(Boolean) });
    setTimeout(sendIps, 3000).unref();
    setInterval(sendIps, 30000).unref();
  }
  if (devices.count() === 0) devices.backfill(2);
  auth.announceSetup();
  const notifier = notifyLib.create({
    dataDir, log, getConfig: () => config.notify, getSecrets, devices,
    pingStatus: (uid) => pings.status(uid), endpointStatus: () => uptime.status(),
    firmwareHistory: (uid) => measurements.firmwareHistory(devices.idsOf(uid)),
    updateStatus: () => updates.status(),
  });
  const mqttPub = mqttLib.create({
    log, getConfig: () => config.mqtt, getSecrets, version, devices,
    pingStatus: (uid) => pings.status(uid), measurementsLatest: (uid) => measurements.latest(devices.idsOf(uid)),
    overdue: (uid) => !!notifier.state.active[`up:${uid}`],
    selection: () => measurements.mqttSelection(),
    endpointInfo: () => {
      const e = endpointInfo('7d');
      return { startedAt: uptime.status().startedAt, network: uptime.status().network, availability: e.stats.availabilityPct, outages: e.stats.outages };
    },
  });

  const assets = new Map();
  for (const f of fs.readdirSync(WEB_DIR)) {
    const ext = path.extname(f);
    if (TYPES[ext]) assets.set(`/${f}`, { type: TYPES[ext], body: fs.readFileSync(path.join(WEB_DIR, f)) });
  }

  // --- request helpers ----------------------------------------------------------
  function viaProxy(req) {
    return trusted.length > 0 && isTrusted(normIp(req.socket.remoteAddress));
  }
  function clientIp(req) {
    const remote = normIp(req.socket.remoteAddress);
    if (!viaProxy(req)) return remote;
    const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    for (let i = chain.length - 1; i >= 0; i--) if (!isTrusted(normIp(chain[i]))) return normIp(chain[i]);
    return remote;
  }
  function isHttps(req) {
    if (TLS) return true;
    return viaProxy(req) && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  }
  function expectedOrigin(req) {
    const host = (viaProxy(req) && req.headers['x-forwarded-host']) || req.headers.host || '';
    return `${isHttps(req) ? 'https' : 'http'}://${String(host).split(',')[0].trim()}`;
  }
  function originOk(req) {
    const origin = req.headers.origin;
    if (origin) return origin === expectedOrigin(req);
    return req.headers['sec-fetch-site'] !== 'cross-site';
  }
  function cookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }
  function sessionCookie(req, value, maxAge) {
    const attrs = [`mep_session=${value}`, `Path=${BASE || '/'}`, 'HttpOnly', 'SameSite=Strict'];
    if (isHttps(req)) attrs.push('Secure');
    if (maxAge !== undefined) attrs.push(`Max-Age=${maxAge}`);
    return attrs.join('; ');
  }

  function baseHeaders(extra = {}) {
    return {
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
        "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      ...extra,
    };
  }
  function sendJson(res, status, data, extra = {}) {
    const body = Buffer.from(JSON.stringify(data));
    res.writeHead(status, baseHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, ...extra }));
    res.end(body);
  }
  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_JSON) {
          reject(new Error('too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch {
          reject(new Error('bad json'));
        }
      });
      req.on('error', reject);
    });
  }

  // --- disk usage and retention ------------------------------------------------
  const LOG_FILE = /^(requests|ping|endpoint)-?.*?(\d{4}-\d\d-\d\d)\.(jsonl|log)$/;
  function diskUsage() {
    let files = 0;
    let bytes = 0;
    for (const f of fs.readdirSync(dataDir)) {
      if (!LOG_FILE.test(f)) continue;
      files += 1;
      try {
        bytes += fs.statSync(path.join(dataDir, f)).size;
      } catch {
        /* vanished */
      }
    }
    return { files, bytes };
  }
  function cleanup() {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - config.retentionDays);
    let removed = 0;
    for (const f of fs.readdirSync(dataDir)) {
      const m = LOG_FILE.exec(f);
      if (!m) continue;
      const [y, mo, d] = m[2].split('-').map(Number);
      if (new Date(y, mo - 1, d) < cutoff) {
        try {
          fs.unlinkSync(path.join(dataDir, f));
          removed += 1;
        } catch {
          /* keep going */
        }
      }
    }
    if (removed) log(`web   retention ${config.retentionDays} days: removed ${removed} old log file(s)`);
    try {
      const gone = measurements.prune(cutoff.getTime());
      if (gone) log(`web   retention ${config.retentionDays} days: removed ${gone} old measurement value(s)`);
    } catch (e) {
      log(`web   measurements prune failed: ${e.message}`);
    }
  }
  cleanup();
  setInterval(cleanup, 6 * 60 * 60 * 1000).unref();

  // --- where things live -------------------------------------------------------
  /** Inside a container the real folder is hidden; /proc/self/mountinfo still names it. */
  function hostPath(mountPoint) {
    try {
      for (const line of fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n')) {
        const f = line.split(' ');
        if (f[4] === mountPoint && f[3] && f[3] !== '/') return f[3];
      }
    } catch {
      /* not Linux, or not readable */
    }
    return null;
  }
  function pathsInfo() {
    const files = [];
    for (const name of ['config.json', 'auth.json', 'devices.json', 'updates.json']) {
      try {
        const st = fs.statSync(path.join(dataDir, name));
        files.push({ name, size: st.size, mtime: st.mtimeMs });
      } catch {
        /* not written yet */
      }
    }
    return { dataDir, hostDataDir: hostPath(dataDir), certDir, hostCertDir: hostPath(certDir), files, logs: diskUsage() };
  }

  /** Everything in the data folder by kind, plus the free space of the volume it lives on. */
  function storageInfo() {
    const groups = { logs: { files: 0, bytes: 0 }, database: { files: 0, bytes: 0 }, settings: { files: 0, bytes: 0 }, other: { files: 0, bytes: 0 } };
    const files = [];
    let names = [];
    try { names = fs.readdirSync(dataDir); } catch { /* unreadable */ }
    for (const name of names) {
      let st;
      try { st = fs.statSync(path.join(dataDir, name)); } catch { continue; }
      if (!st.isFile()) continue;
      const group = LOG_FILE.test(name) ? 'logs' : /^measurements\.db(-wal|-shm)?$/.test(name) ? 'database' : /\.json$/.test(name) ? 'settings' : 'other';
      groups[group].files += 1;
      groups[group].bytes += st.size;
      if (group !== 'logs') files.push({ name, size: st.size, mtime: st.mtimeMs, group });
    }
    let disk = null;
    try {
      const s = fs.statfsSync(dataDir);
      disk = { total: Number(s.blocks) * Number(s.bsize), free: Number(s.bavail) * Number(s.bsize) };
    } catch { /* not supported here */ }
    return { groups, files: files.sort((a, b) => b.size - a.size), disk };
  }

  // --- ping and timeline --------------------------------------------------------
  function pingInfo(uid) {
    const st = pings.status(uid);
    const on = devices.watchTargets().find((t) => t.uid === uid)?.on !== false;
    return { available: pings.available, on, state: st ? st.state : on ? 'starting' : 'off', since: st ? st.since : null };
  }
  const withPing = (d) => ({ ...d, ping: pingInfo(d.uid) });

  /** Highest value per bucket, so a single slow handshake still shows when thinning a long range. */
  function thin(points, max) {
    if (points.length <= max) return points;
    const size = Math.ceil(points.length / max);
    const out = [];
    for (let i = 0; i < points.length; i += size) {
      const chunk = points.slice(i, i + size);
      out.push(chunk.reduce((a, b) => (b.ms > a.ms ? b : a)));
    }
    return out;
  }

  function pingStats(ph, from, now) {
    const watchedMs = ph.watched.reduce((sum, w) => sum + Math.max(0, (w.end ?? now) - Math.max(w.start, from)), 0);
    const lens = ph.outages.map((o) => Math.max(0, (o.end ?? now) - Math.max(o.start, from)));
    const down = lens.reduce((a, b) => a + b, 0);
    return {
      outages: ph.outages.length,
      downtimeS: Math.round(down / 1000),
      longestS: lens.length ? Math.round(Math.max(...lens) / 100) / 10 : 0,
      watchedS: Math.round(watchedMs / 1000),
      availability: watchedMs > 0 ? Math.max(0, Math.min(100, Math.round((1 - down / watchedMs) * 10000) / 100)) : null,
    };
  }

  /** The endpoint's own availability for a range: periods off / without network and the shares of time. */
  function endpointInfo(range) {
    const now = Date.now();
    const h = uptime.history(range, history.sinceOf(range));
    const from = Math.max(history.sinceOf(range), h.trackedSince ?? now);
    const span = Math.max(1, now - from);
    const sum = (kind) => h.periods.filter((p) => p.kind === kind).reduce((a, p) => a + Math.max(0, Math.min(p.end, now) - Math.max(p.start, from)), 0);
    const off = sum('off');
    const nonet = sum('nonet');
    const pct = (ms) => Math.max(0, Math.min(100, Math.round((1 - ms / span) * 10000) / 100));
    const st = uptime.status();
    return {
      range, from, to: now, trackedSince: h.trackedSince, periods: h.periods,
      stats: {
        offS: Math.round(off / 1000), noNetS: Math.round(nonet / 1000),
        outages: h.periods.length,
        longestS: h.periods.length ? Math.round(Math.max(...h.periods.map((p) => p.end - p.start)) / 1000) : 0,
        runningPct: h.trackedSince ? pct(off) : null,
        availabilityPct: h.trackedSince ? pct(off + nonet) : null,
      },
      now: st,
    };
  }

  function timeline(uid, range) {
    const d = devices.get(uid);
    const ids = devices.idsOf(uid);
    const up = history.events(dataDir, ids, 'upload', range);
    const tm = history.events(dataDir, ids, 'time', range);
    const conn = history.connectionHistory(dataDir, d.ip, range);
    const ph = history.pingHistory(dataDir, ids, range);
    const now = Date.now();
    let from = history.sinceOf(range);
    if (range === 'all' || from === 0) {
      const firsts = [up[0]?.ts, tm[0]?.ts, ph.watched[0]?.start, d.firstSeen].filter(Boolean);
      from = firsts.length ? Math.min(...firsts) : now - 86400e3;
    }
    const N = 120;
    const binMs = Math.max(1000, (now - from) / N);
    const bin = (list) => {
      const out = new Array(N).fill(0);
      for (const e of list) {
        const i = Math.min(N - 1, Math.floor((e.ts - from) / binMs));
        if (i >= 0) out[i] += 1;
      }
      return out;
    };
    return {
      range, from, to: now, bins: N, binMs,
      uploads: bin(up), times: bin(tm),
      expectedUpload: binMs / 1000 / (d.uploadIntervalS || 300),
      expectedTime: binMs / 1000 / (d.timeIntervalS || 600),
      firstSeen: d.firstSeen,
      ping: { ...pingInfo(uid), outages: ph.outages, watched: ph.watched, stats: pingStats(ph, from, now) },
      endpoint: (() => { const e = endpointInfo(range); return { periods: e.periods, trackedSince: e.trackedSince, network: e.now.network, networkCheck: e.now.networkCheck }; })(),
      firmware: measurements.firmwareHistory(ids).filter((c) => c.ts >= from),
      tls: conn.tlsErrors.slice(-60),
      handshakes: thin(conn.handshakes, 150),
    };
  }

  // --- routing -----------------------------------------------------------------
  async function api(req, res, route, url) {
    const ip = clientIp(req);
    const sid = cookies(req).mep_session;
    const session = auth.getSession(sid);
    const method = req.method;

    if (route === '/api/session' && method === 'GET') {
      return sendJson(res, 200, {
        claimed: auth.isClaimed(),
        authenticated: !!session,
        csrf: session ? session.csrf : null,
        login: session ? { ...session.info, current: auth.currentLogin() } : null,
        minLength: auth.constants.MIN_LENGTH,
        version,
        secure: isHttps(req),
      });
    }

    if (method !== 'POST' && method !== 'GET') return sendJson(res, 405, { error: 'method' });
    if (method === 'POST') {
      if (!originOk(req)) return sendJson(res, 403, { error: 'origin' });
    }

    let body = {};
    if (method === 'POST') {
      try {
        body = await readJson(req);
      } catch {
        return sendJson(res, 400, { error: 'badRequest' });
      }
    }

    const authReply = (result, okExtra = {}) => {
      if (!result.ok) {
        const status = result.error === 'locked' ? 429 : result.error === 'badLogin' || result.error === 'badCode' ? 401 : 400;
        return sendJson(res, status, { error: result.error, retryAfter: result.retryAfter }, result.retryAfter ? { 'Retry-After': result.retryAfter } : {});
      }
      const extra = result.session ? { 'Set-Cookie': sessionCookie(req, result.session) } : {};
      return sendJson(res, 200, { ok: true, ...okExtra }, extra);
    };

    if (route === '/api/claim' && method === 'POST') return authReply(await auth.claim(body.password, body.code, ip));
    if (route === '/api/login' && method === 'POST') return authReply(await auth.login(body.password, ip));

    // everything below needs a session
    if (!session) return sendJson(res, 401, { error: 'unauthenticated' });
    if (method === 'POST' && req.headers['x-csrf-token'] !== session.csrf) return sendJson(res, 403, { error: 'csrf' });

    if (route === '/api/logout' && method === 'POST') {
      auth.endSession(sid);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }
    if (route === '/api/password' && method === 'POST') {
      return authReply(await auth.changePassword(sid, body.current, body.next, ip));
    }
    if (route === '/api/overview' && method === 'GET') {
      return sendJson(res, 200, {
        devices: devices.list().map(withPing),
        system: { version, web: { version: webInfo.version || null, root: webInfo.root || 'bundled', bundledVersion: webInfo.bundledVersion || null, safeMode: !!webInfo.safeMode, failed: webInfo.failed || [], processUptimeS: Math.round(process.uptime()) }, uptimeS: Math.round((Date.now() - mainStatus.startedAt) / 1000), retentionDays: config.retentionDays, disk: diskUsage(), time: Date.now() },
        updateAvailable: config.updateCheck ? updates.status().updateAvailable : null,
        webUpdateAvailable: config.updateCheck && ipc ? ((u) => (u.web.releases.find((r) => r.state === 'newer' && r.installable) || {}).tag || null)(updates.status()) : null,
      });
    }
    if (route === '/api/endpoint' && method === 'GET') {
      const range = Object.hasOwn(history.RANGES, url.searchParams.get('range')) ? url.searchParams.get('range') : '24h';
      return sendJson(res, 200, { ...endpointInfo(range), startedAt: mainStatus.startedAt });
    }
    const dev = /^\/api\/device\/([0-9A-Za-z]+)(?:\/(events|remove|merge|ping|timeline|values|series|firmware))?$/.exec(route);
    if (dev) {
      const [, uid, action] = dev;
      const d = devices.get(uid);
      if (!d) return sendJson(res, 404, { error: 'notFound' });
      if (!action && method === 'GET') return sendJson(res, 200, withPing(d));
      if (!action && method === 'POST') {
        if (typeof body.name !== 'string') return sendJson(res, 400, { error: 'badRequest' });
        devices.rename(uid, body.name);
        return sendJson(res, 200, { ok: true });
      }
      if (action === 'events' && method === 'GET') {
        const kind = url.searchParams.get('kind') === 'time' ? 'time' : 'upload';
        const range = Object.hasOwn(history.RANGES, url.searchParams.get('range')) ? url.searchParams.get('range') : '24h';
        const offset = Math.max(0, parseInt(url.searchParams.get('offset'), 10) || 0);
        const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 25));
        const list = history.events(dataDir, devices.idsOf(uid), kind, range);
        const expected = kind === 'upload' ? d.uploadIntervalS : d.timeIntervalS;
        return sendJson(res, 200, { kind, range, retentionDays: config.retentionDays, ...history.page(list, offset, limit, expected) });
      }
      if (action === 'remove' && method === 'POST') {
        devices.remove(uid);
        pings.sync();
        return sendJson(res, 200, { ok: true });
      }
      if (action === 'ping' && method === 'POST') {
        if (typeof body.on !== 'boolean') return sendJson(res, 400, { error: 'badRequest' });
        devices.setPing(uid, body.on);
        pings.sync();
        return sendJson(res, 200, pingInfo(uid));
      }
      if (action === 'values' && method === 'GET') {
        const values = measurements.latest(devices.idsOf(uid));
        return sendJson(res, 200, { values, device: { model: d.model || null }, verified: measurements.verifiedPairs(), stats: measurements.stats(), firmware: measurements.firmware(), mqtt: { mode: mqttLib.normalise(config.mqtt).measurements.mode, enabled: mqttLib.normalise(config.mqtt).enabled, sent: mqttPub.sentKeys(values), selected: [...measurements.mqttSelection()] } });
      }
      if (action === 'firmware' && method === 'GET') return sendJson(res, 200, { changes: measurements.firmwareHistory(devices.idsOf(uid)) });
      if (action === 'series' && method === 'GET') {
        const key = url.searchParams.get('key') || '';
        const range = Object.hasOwn(history.RANGES, url.searchParams.get('range')) ? url.searchParams.get('range') : '24h';
        const to = Date.now();
        const from = range === 'all' ? 0 : history.sinceOf(range);
        return sendJson(res, 200, { range, from, to, ...measurements.series(devices.idsOf(uid), key, from, to) });
      }
      if (action === 'timeline' && method === 'GET') {
        const range = Object.hasOwn(history.RANGES, url.searchParams.get('range')) ? url.searchParams.get('range') : '24h';
        return sendJson(res, 200, timeline(uid, range));
      }
      if (action === 'merge' && method === 'POST') {
        if (typeof body.from !== 'string' || !/^[0-9A-Za-z]+$/.test(body.from)) return sendJson(res, 400, { error: 'badRequest' });
        const merged = devices.merge(uid, body.from);
        pings.sync();
        return merged ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'notFound' });
      }
      return sendJson(res, 405, { error: 'method' });
    }
    if (route === '/api/support' && method === 'POST') {
      const wanted = body.devices === 'all' || (typeof body.devices === 'string' && /^[0-9A-Za-z]+$/.test(body.devices)) ? body.devices : null;
      if (!wanted || typeof body.raw !== 'boolean' || !Object.hasOwn(history.RANGES, body.range) || (body.measurements !== undefined && typeof body.measurements !== 'boolean')) return sendJson(res, 400, { error: 'badRequest' });
      if (wanted !== 'all' && !devices.get(wanted)) return sendJson(res, 404, { error: 'notFound' });
      const pkg = await supportLib.build(
        {
          dataDir, devices, version, webInfo, config, disk: diskUsage(),
          listener: { port: PORT, tls: TLS, basePath: BASE || '/', trustProxy: trusted.map((t) => t.text) },
          pingStatus: pingInfo,
          logLines: logbuf.dump(),
          endpoint: endpointInfo(body.range),
          measurements,
        },
        { devices: wanted, range: body.range, raw: body.raw, measurements: body.measurements === true && measurements.available }
      );
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
      log(`web   support package built (${pkg.devices} device(s), range ${body.range}, raw ${body.raw}, ${pkg.body.length} B)`);
      res.writeHead(200, baseHeaders({
        'Content-Type': 'application/gzip',
        'Content-Length': pkg.body.length,
        'Content-Disposition': `attachment; filename="marstek-endpoint-support-${stamp}.tar.gz"`,
      }));
      return res.end(pkg.body);
    }
    if (route === '/api/web/reload' && method === 'POST') {
      if (!ipc) return sendJson(res, 400, { error: 'noSupervisor' });
      sendJson(res, 200, { ok: true });
      setTimeout(() => ipc.restart(), 300);
      return;
    }
    if (route === '/api/notify' && method === 'GET') {
      const s = getSecrets();
      return sendJson(res, 200, { config: notifyLib.normalise(config.notify), secrets: secretFlags(s), status: notifier.status() });
    }
    if (route === '/api/notify' && method === 'POST') {
      const next = notifyLib.normalise(body.config || config.notify);
      const bad = notifyLib.validate(next);
      if (bad) return sendJson(res, 400, { error: bad });
      const patch = {};
      if (typeof body.telegramToken === 'string' && body.telegramToken.trim()) {
        if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(body.telegramToken.trim())) return sendJson(res, 400, { error: 'badToken' });
        patch.telegramToken = body.telegramToken.trim();
      }
      if (typeof body.haToken === 'string' && body.haToken.trim()) {
        if (!/^[A-Za-z0-9._-]{20,2000}$/.test(body.haToken.trim())) return sendJson(res, 400, { error: 'badToken' });
        patch.haToken = body.haToken.trim();
      }
      for (const [field, secret] of [['pushoverUser', 'pushoverUser'], ['pushoverToken', 'pushoverToken']]) {
        if (typeof body[field] === 'string' && body[field].trim()) {
          if (!/^[A-Za-z0-9]{30}$/.test(body[field].trim())) return sendJson(res, 400, { error: 'badToken' });
          patch[secret] = body[field].trim();
        }
      }
      if (typeof body.webhookUrl === 'string' && body.webhookUrl.trim()) {
        if (!notifyLib.URL_RE.test(body.webhookUrl.trim())) return sendJson(res, 400, { error: 'badUrl' });
        patch.webhookUrl = body.webhookUrl.trim();
      }
      if (typeof body.webhookAuth === 'string' && body.webhookAuth.trim()) {
        if (!/^[\x21-\x7e ]{1,500}$/.test(body.webhookAuth.trim())) return sendJson(res, 400, { error: 'badToken' });
        patch.webhookAuth = body.webhookAuth.trim();
      }
      if (Array.isArray(body.clear)) {
        if (body.clear.includes('telegram')) patch.telegramToken = null;
        if (body.clear.includes('ha')) patch.haToken = null;
        if (body.clear.includes('pushover')) { patch.pushoverToken = null; patch.pushoverUser = null; }
        if (body.clear.includes('webhook')) { patch.webhookUrl = null; patch.webhookAuth = null; }
      }
      config.notify = next;
      saveConfig();
      putSecrets(patch);
      const s = getSecrets();
      return sendJson(res, 200, { config: notifyLib.normalise(config.notify), secrets: secretFlags(s), status: notifier.status() });
    }
    if (route === '/api/notify/test' && method === 'POST') {
      if (body.channel !== 'telegram' && body.channel !== 'ha' && body.channel !== 'webhook' && body.channel !== 'pushover') return sendJson(res, 400, { error: 'badRequest' });
      return sendJson(res, 200, await notifier.test(body.channel));
    }
    if (route === '/api/mqtt' && method === 'GET') {
      return sendJson(res, 200, { config: mqttLib.normalise(config.mqtt), secrets: { password: !!getSecrets().mqttPassword }, status: mqttPub.status(), preview: mqttPub.preview() });
    }
    if (route === '/api/mqtt' && method === 'POST') {
      const next = mqttLib.normalise(body.config || config.mqtt);
      const bad = mqttLib.validate(next);
      if (bad) return sendJson(res, 400, { error: bad });
      const patch = {};
      if (typeof body.password === 'string' && body.password) patch.mqttPassword = body.password.slice(0, 256);
      if (body.clearPassword === true) patch.mqttPassword = null;
      config.mqtt = next;
      saveConfig();
      putSecrets(patch);
      mqttPub.reload();
      return sendJson(res, 200, { config: mqttLib.normalise(config.mqtt), secrets: { password: !!getSecrets().mqttPassword }, status: mqttPub.status(), preview: mqttPub.preview() });
    }
    if (route === '/api/mqtt/select' && method === 'POST') {
      if (!Array.isArray(body.keys) || body.keys.length > 400 || !body.keys.every((k) => typeof k === 'string' && k.length < 40) || typeof body.on !== 'boolean') return sendJson(res, 400, { error: 'badRequest' });
      measurements.setMqttSelection(body.keys, body.on);
      const answer = sendJson(res, 200, { ok: true, selected: measurements.mqttSelection().size });
      setImmediate(() => mqttPub.refresh()); // the page must not wait for the broker work
      return answer;
    }
    if (route === '/api/mqtt/test' && method === 'POST') {
      return sendJson(res, 200, await mqttPub.test(config.mqtt, getSecrets()));
    }
    if (route === '/api/measurements' && method === 'GET') return sendJson(res, 200, measurements.stats());
    if (route === '/api/measurements' && method === 'POST') {
      if (typeof body.enabled !== 'boolean') return sendJson(res, 400, { error: 'badRequest' });
      config.measurements = body.enabled;
      saveConfig();
      return sendJson(res, 200, measurements.stats());
    }
    if (route === '/api/measurements/import' && method === 'POST') {
      if (!measurements.available) return sendJson(res, 400, { error: 'noDatabase' });
      measurements.importLogs().catch((e) => log(`web   measurements import failed: ${e.message}`));
      return sendJson(res, 202, { ok: true });
    }
    if (route === '/api/keys' && method === 'GET') return sendJson(res, 200, { keys: measurements.keys() });
    if (route === '/api/keys' && method === 'POST') {
      const scale = Number(body.scale);
      if (typeof body.key !== 'string' || typeof body.name !== 'string' || !body.name.trim() || typeof body.unit !== 'string' || typeof body.description !== 'string' || (body.category !== undefined && typeof body.category !== 'string') || !Number.isFinite(scale) || scale === 0) {
        return sendJson(res, 400, { error: 'badRequest' });
      }
      if (typeof body.fw !== 'string' || (body.model !== undefined && typeof body.model !== 'string') || (body.confirmed !== undefined && typeof body.confirmed !== 'boolean')) return sendJson(res, 400, { error: 'badRequest' });
      return measurements.setKey(body.key, body.model || '*', body.fw, { name: body.name.trim(), unit: body.unit.trim(), scale, description: body.description.trim(), confirmed: body.confirmed === true, category: body.category })
        ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'notFound' });
    }
    if (route === '/api/updates' && method === 'GET') {
      return sendJson(res, 200, { ...updates.status(), webUpdate: { ...webUpdater.state(), publicKey: webUpdater.publicKey(), supervised: !!ipc, root: webInfo.root || 'bundled', safeMode: !!webInfo.safeMode, failed: webInfo.failed || [], incompatible: webInfo.incompatible || null, bundledVersion: webInfo.bundledVersion || null } });
    }
    if (route === '/api/web-update/install' && method === 'POST') {
      if (!ipc) return sendJson(res, 400, { error: 'noSupervisor' });
      if (typeof body.tag !== 'string') return sendJson(res, 400, { error: 'badRequest' });
      const release = updates.releaseByTag(body.tag);
      if (!release) return sendJson(res, 404, { error: 'notFound' });
      const r = await webUpdater.install(release);
      if (!r.ok) return sendJson(res, 400, { error: r.error, need: r.need });
      sendJson(res, 200, { ok: true, version: r.version });
      setTimeout(() => ipc.restart(), 500);
      return;
    }
    if (route === '/api/web-update/rollback' && method === 'POST') {
      if (!ipc) return sendJson(res, 400, { error: 'noSupervisor' });
      webUpdater.rollback();
      sendJson(res, 200, { ok: true });
      setTimeout(() => ipc.restart(), 500);
      return;
    }
    if (route === '/api/updates' && method === 'POST') {
      if (typeof body.enabled !== 'boolean') return sendJson(res, 400, { error: 'badRequest' });
      config.updateCheck = body.enabled;
      saveConfig();
      updates.schedule();
      return sendJson(res, 200, body.enabled ? await updates.check() : updates.status());
    }
    if (route === '/api/updates/check' && method === 'POST') {
      if (!config.updateCheck) return sendJson(res, 400, { error: 'updatesOff' });
      return sendJson(res, 200, await updates.check());
    }
    if (route === '/api/settings' && method === 'GET') {
      return sendJson(res, 200, {
        retentionDays: config.retentionDays,
        disk: diskUsage(),
        listener: { port: PORT, tls: TLS, basePath: BASE || '/', trustProxy: trusted.map((t) => t.text) },
        paths: pathsInfo(),
        storage: storageInfo(),
      });
    }
    if (route === '/api/settings' && method === 'POST') {
      const days = Number(body.retentionDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) return sendJson(res, 400, { error: 'badRetention' });
      config.retentionDays = days;
      saveConfig();
      cleanup();
      return sendJson(res, 200, { ok: true, retentionDays: days, disk: diskUsage() });
    }
    return sendJson(res, 404, { error: 'notFound' });
  }

  async function handler(req, res) {
    try {
      let url;
      try {
        url = new URL(req.url, 'http://x');
      } catch {
        return sendJson(res, 400, { error: 'badRequest' });
      }
      let route = url.pathname;
      if (BASE && route === BASE) {
        // relative links in the page only resolve below a trailing slash
        res.writeHead(308, baseHeaders({ Location: `${BASE}/${url.search}` }));
        return res.end();
      }
      if (BASE) {
        if (route !== BASE && !route.startsWith(`${BASE}/`)) return sendJson(res, 404, { error: 'notFound' });
        route = route.slice(BASE.length) || '/';
      }
      if (route.startsWith('/api/')) return await api(req, res, route, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method' });
      const key = route === '/' ? '/index.html' : route;
      const asset = assets.get(key);
      if (!asset) return sendJson(res, 404, { error: 'notFound' });
      res.writeHead(200, baseHeaders({ 'Content-Type': asset.type, 'Content-Length': asset.body.length, 'Cache-Control': 'no-cache' }));
      res.end(req.method === 'HEAD' ? undefined : asset.body);
    } catch (err) {
      log(`web   error ${req.method} ${req.url}: ${err.message}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'server' });
      else res.end();
    }
  }

  const server = TLS
    ? https.createServer({ key, cert, minVersion: 'TLSv1.2' }, handler)
    : http.createServer(handler);
  server.listen(PORT, () => {
    log(
      `web   interface on ${TLS ? 'https' : 'http'}://:${PORT}${BASE || '/'}` +
        `${trusted.length ? ` (trusted proxies: ${trusted.map((t) => t.text).join(', ')})` : ''}`
    );
  });
  pings.begin();
  notifier.begin();
  mqttPub.begin();
  // readings stored before a device's model was known (its time request names it) get it as soon as it is
  const learnModels = () => {
    try {
      for (const d of devices.list()) if (d.model) measurements.assignModel(devices.idsOf(d.uid), d.model);
    } catch (e) {
      log(`web   measurements: ${e.message}`);
    }
  };
  let lastLearn = 0;
  setTimeout(learnModels, 5000).unref();
  setInterval(learnModels, 60000).unref();
  if (measurements.available && config.measurements !== false && (measurements.stats().rows === 0 || measurements.rebuildNeeded())) {
    measurements.importLogs().catch((e) => log(`web   measurements import failed: ${e.message}`));
  }
  server.on('tlsClientError', () => {
    /* browsers probing with the wrong protocol are not worth a log line */
  });

  return {
    noteRequest: (r) => {
      devices.noteRequest(r);
      measurements.noteRequest(r);
      // a time request names the device family (aid=VNSD-0): readings stored before that get it right away
      if (/getDateInfo/.test(r.url || '') && Date.now() - lastLearn > 10000) {
        lastLearn = Date.now();
        learnModels();
      }
    },
    noteConnection: (r) => devices.noteConnection(r),
    noteTlsError: (r) => devices.noteTlsError(r),
    flush: () => {
      auth.flush();
      pings.shutdown();
      notifier.shutdown();
      mqttPub.shutdown();
      measurements.close();
      devices.flush();
    },
  };
}

module.exports = { init };
