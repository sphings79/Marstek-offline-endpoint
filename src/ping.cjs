'use strict';
/**
 * Ping watch for the devices the endpoint has seen.
 *
 * One long-running `ping -i 1` per device (the BusyBox ping of the Alpine image, which
 * needs the NET_RAW capability Docker grants by default). Only changes are written,
 * as JSON lines in <data>/ping-<deviceId>-YYYY-MM-DD.jsonl:
 *
 *   {"ts":"…","ev":"start","ip":"…"}                    watching began
 *   {"ts":"…","ev":"down","ip":"…"}                     the first lost reply
 *   {"ts":"…","ev":"up","ip":"…","downAt":"…","durationS":3.1}
 *   {"ts":"…","ev":"stop","ip":"…"}                     watching ended
 *
 * A reply that arrives 2.5 s late is a dropout; a single missing sequence number is
 * a lost packet and counts too (a reset of the device's network chip shows as two to
 * five seconds, a lost packet as about one).
 *
 * The set of watched devices follows the device list: new device -> watched, address
 * changed -> restarted, removed or switched off -> stopped. PING=0 turns the whole
 * feature off (for networks where the container cannot send ICMP).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SILENCE_MS = 2500;

function create({ dataDir, devices, log }) {
  const enabled = process.env.PING !== '0';
  const watchers = new Map();
  let syncTimer = null;

  function write(uid, rec) {
    const iso = new Date(rec.ts).toISOString();
    const file = path.join(dataDir, `ping-${uid}-${iso.slice(0, 10)}.jsonl`);
    fs.appendFile(file, `${JSON.stringify({ ...rec, ts: iso, downAt: rec.downAt ? new Date(rec.downAt).toISOString() : undefined })}\n`, (err) => {
      if (err) log(`ping  log write failed: ${err.message}`);
    });
  }

  function start(uid, ip) {
    const w = { uid, ip, state: 'unknown', since: Date.now(), startedAt: Date.now(), lastReply: 0, lastSeq: null, downAt: null, proc: null, tick: null, stopped: false, buf: '' };
    write(uid, { ts: Date.now(), ev: 'start', ip });

    const markDown = (at) => {
      if (w.state === 'down') return;
      w.state = 'down';
      w.since = at;
      w.downAt = at;
      write(uid, { ts: at, ev: 'down', ip });
    };
    const onReply = (ts, seq) => {
      if (w.state === 'down') {
        write(uid, { ts, ev: 'up', ip, downAt: w.downAt, durationS: Math.round((ts - w.downAt) / 100) / 10 });
        w.state = 'up';
        w.since = ts;
        w.downAt = null;
      } else if (w.state === 'unknown') {
        w.state = 'up';
        w.since = ts;
      } else if (w.lastSeq !== null && seq > w.lastSeq + 1) {
        // replies stopped for a moment without crossing the silence limit: lost packet(s)
        const at = w.lastReply + 1000;
        write(uid, { ts: at, ev: 'down', ip });
        write(uid, { ts, ev: 'up', ip, downAt: at, durationS: Math.round((ts - at) / 100) / 10 });
      }
      w.lastReply = ts;
      w.lastSeq = seq;
    };

    const run = () => {
      if (w.stopped) return;
      const proc = spawn('ping', ['-i', '1', '-s', '16', ip], { stdio: ['ignore', 'pipe', 'ignore'] });
      w.proc = proc;
      proc.stdout.on('data', (chunk) => {
        w.buf += chunk.toString('utf8');
        let nl;
        while ((nl = w.buf.indexOf('\n')) >= 0) {
          const line = w.buf.slice(0, nl);
          w.buf = w.buf.slice(nl + 1);
          const m = /bytes from .*seq=(\d+)/.exec(line);
          if (m) onReply(Date.now(), Number(m[1]));
        }
      });
      proc.on('error', (e) => log(`ping  cannot run ping for ${ip}: ${e.message}`));
      proc.on('exit', () => {
        w.lastSeq = null; // a new process starts counting at 0 again
        if (!w.stopped) setTimeout(run, 3000).unref();
      });
    };
    run();

    w.tick = setInterval(() => {
      const now = Date.now();
      if (w.state === 'up' && now - w.lastReply > SILENCE_MS) markDown(w.lastReply + 1000);
      else if (w.state === 'unknown' && now - w.startedAt > 3000) markDown(w.startedAt);
    }, 500);
    w.tick.unref();
    watchers.set(uid, w);
  }

  function stop(uid) {
    const w = watchers.get(uid);
    if (!w) return;
    w.stopped = true;
    clearInterval(w.tick);
    if (w.proc) w.proc.kill();
    write(uid, { ts: Date.now(), ev: 'stop', ip: w.ip });
    watchers.delete(uid);
  }

  /** Make the running watchers match the device list. */
  function sync() {
    if (!enabled) return;
    const want = new Map();
    for (const d of devices.watchTargets()) if (d.on && d.ip) want.set(d.uid, d.ip);
    for (const [uid, w] of [...watchers]) if (!want.has(uid) || want.get(uid) !== w.ip) stop(uid);
    for (const [uid, ip] of want) if (!watchers.has(uid)) start(uid, ip);
  }

  function begin() {
    if (!enabled) {
      log('ping  off (PING=0)');
      return;
    }
    setTimeout(sync, 2000).unref();
    syncTimer = setInterval(sync, 15000);
    syncTimer.unref();
  }

  function shutdown() {
    clearInterval(syncTimer);
    for (const uid of [...watchers.keys()]) stop(uid);
  }

  /** Current state of one device: 'up' | 'down' | 'unknown', or null when it is not watched. */
  function status(uid) {
    const w = watchers.get(uid);
    return w ? { state: w.state, since: w.since } : null;
  }

  return { begin, sync, shutdown, status, available: enabled };
}

module.exports = { create };
