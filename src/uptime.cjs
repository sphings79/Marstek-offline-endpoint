'use strict';
/**
 * Availability of the endpoint itself, so a gap in the device history can be told apart
 * from a gap in the endpoint's own life.
 *
 * Three things are recorded:
 *  - a heartbeat every 30 s in <data>/uptime.json (overwritten, not appended), plus a flag
 *    for a clean stop. At the next start that file says how the last run ended:
 *      'clean'  -> stopped properly (restart, update): the endpoint was off from the stop
 *      'crash'  -> no clean stop: off from the last heartbeat (power loss, kill -9, host down)
 *      'none'   -> first run, nothing known before
 *  - events in <data>/endpoint-YYYY-MM-DD.jsonl:
 *      {"ts":"…","ev":"start","prev":"clean|crash|none","from":"…"}   from = when it went off
 *      {"ts":"…","ev":"stop"}
 *      {"ts":"…","ev":"net_down","gateway":"…"}  {"ts":"…","ev":"net_up","gateway":"…"}
 *  - the network check: the container pings the gateway of the network its devices are on (routes from
 *    /proc/net/route, see pickGateway; ENDPOINT_GATEWAY overrides) every 5 s. Three misses in a row, after at least one reply since the
 *    start, count as "no network"; the outage is dated to the first miss. A gateway that never
 *    answers ICMP stays "unknown" and writes nothing. PING=0 turns the check off.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const store = require('./store.cjs');

const BEAT_MS = 30000;
const CHECK_MS = 5000;
const MISSES = 3;

const ip2int = (ip) => ip.split('.').reduce((a, o) => ((a << 8) | Number(o)) >>> 0, 0);
const hexIp = (h) => [6, 4, 2, 0].map((i) => parseInt(h.slice(i, i + 2), 16)).join('.');

/** Default routes from /proc/net/route text: [{iface, gateway, metric}], lowest metric first. */
function parseRoutes(text) {
  const out = [];
  for (const line of String(text).split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length >= 8 && f[1] === '00000000' && (parseInt(f[3], 16) & 2)) out.push({ iface: f[0], gateway: hexIp(f[2]), metric: Number(f[6]) });
  }
  return out.sort((a, b) => a.metric - b.metric);
}

/**
 * Which gateway to watch. The batteries reach the endpoint over one network; with a second
 * network attached (a reverse proxy, say) the default route can sit on the other one, and
 * pinging that gateway would say nothing about the batteries' network. So: the interface whose
 * subnet holds the devices' addresses decides, and if it has no default route the check stays
 * off rather than watch the wrong thing. Without known devices the default route is used.
 * @returns {{gateway:string|null, source:string}}
 */
function pickGateway({ routes, ifaces, deviceIps, override }) {
  if (override) return { gateway: override, source: 'ENDPOINT_GATEWAY' };
  if (!routes.length) return { gateway: null, source: 'no default route' };
  const score = new Map();
  for (const [name, addrs] of Object.entries(ifaces || {})) {
    for (const a of addrs) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      const mask = ip2int(a.netmask);
      for (const ip of deviceIps) if (((ip2int(ip) & mask) >>> 0) === ((ip2int(a.address) & mask) >>> 0)) score.set(name, (score.get(name) || 0) + 1);
    }
  }
  if (score.size) {
    const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const r = routes.find((x) => x.iface === best);
    return r ? { gateway: r.gateway, source: `default route of ${best}` } : { gateway: null, source: `no default route on ${best}, where the devices are` };
  }
  return { gateway: routes[0].gateway, source: `default route of ${routes[0].iface}` };
}

function currentGateway(deviceIps) {
  let routes = [];
  try {
    routes = parseRoutes(fs.readFileSync('/proc/net/route', 'utf8'));
  } catch {
    /* no /proc (not Linux) */
  }
  return pickGateway({ routes, ifaces: os.networkInterfaces(), deviceIps, override: process.env.ENDPOINT_GATEWAY });
}

function create({ dataDir, log, deviceIps = () => [] }) {
  const stateFile = path.join(dataDir, 'uptime.json');
  const checkEnabled = process.env.PING !== '0';
  const net = { gateway: null, source: '', state: 'unknown', since: null, seen: false, fails: 0, firstFail: 0 };
  let lastResolve = 0;
  let startedAt = Date.now();
  let startInfo = { prev: 'none', from: null };
  let beatTimer = null;
  let checkTimer = null;
  let busy = false;

  function write(rec) {
    const iso = new Date(rec.ts).toISOString();
    const file = path.join(dataDir, `endpoint-${iso.slice(0, 10)}.jsonl`);
    try {
      fs.appendFileSync(file, `${JSON.stringify({ ...rec, ts: iso, from: rec.from ? new Date(rec.from).toISOString() : undefined })}\n`);
    } catch (e) {
      log(`web   uptime log write failed: ${e.message}`);
    }
  }
  const saveState = (extra) => store.write(stateFile, { startedAt, lastBeat: Date.now(), running: true, ...extra });

  /** Re-read the routes now and then: the devices may only show up after the start. */
  function resolveGateway() {
    lastResolve = Date.now();
    const g = currentGateway(deviceIps());
    if (g.gateway === net.gateway && g.source === net.source) return;
    if (net.state === 'down') write({ ts: Date.now(), ev: 'net_up', gateway: net.gateway });
    Object.assign(net, { gateway: g.gateway, source: g.source, state: 'unknown', since: null, seen: false, fails: 0 });
    log(g.gateway ? `web   network check: pinging ${g.gateway} (${g.source})` : `web   network check off: ${g.source}`);
  }

  function check() {
    if (Date.now() - lastResolve > 60000) resolveGateway();
    if (busy || !net.gateway) return;
    busy = true;
    execFile('ping', ['-c', '1', '-W', '2', net.gateway], { timeout: 4000 }, (err) => {
      busy = false;
      const now = Date.now();
      if (!err) {
        if (net.state === 'down') write({ ts: now, ev: 'net_up', gateway: net.gateway });
        if (net.state !== 'up') net.since = now;
        net.state = 'up';
        net.seen = true;
        net.fails = 0;
      } else {
        if (net.fails === 0) net.firstFail = now;
        net.fails += 1;
        if (net.seen && net.fails >= MISSES && net.state !== 'down') {
          net.state = 'down';
          net.since = net.firstFail;
          write({ ts: net.firstFail, ev: 'net_down', gateway: net.gateway });
        }
      }
    });
  }

  function begin() {
    const prev = store.read(stateFile, {});
    const kind = !prev.startedAt ? 'none' : prev.running ? 'crash' : 'clean';
    const from = kind === 'crash' ? prev.lastBeat : kind === 'clean' ? prev.stoppedAt : null;
    startedAt = Date.now();
    startInfo = { prev: kind, from: from || null };
    write({ ts: startedAt, ev: 'start', prev: kind, from: from || undefined });
    saveState();
    beatTimer = setInterval(() => saveState(), BEAT_MS);
    beatTimer.unref();
    if (checkEnabled) {
      resolveGateway();
      checkTimer = setInterval(check, CHECK_MS);
      checkTimer.unref();
      check();
    }
    if (kind === 'crash') log(`web   previous run did not stop cleanly (last sign of life ${new Date(from).toISOString()})`);
  }

  function shutdown() {
    clearInterval(beatTimer);
    clearInterval(checkTimer);
    const now = Date.now();
    if (net.state === 'down') write({ ts: now, ev: 'stop', gateway: net.gateway });
    else write({ ts: now, ev: 'stop' });
    store.write(stateFile, { startedAt, lastBeat: now, running: false, stoppedAt: now });
  }

  const status = () => ({ startedAt, start: startInfo, gateway: net.gateway, networkCheck: !!net.gateway && checkEnabled, gatewaySource: net.source, network: net.state, networkSince: net.since });

  return { begin, shutdown, status };
}

module.exports = { create, pickGateway, parseRoutes };
