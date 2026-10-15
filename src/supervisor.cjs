'use strict';
/**
 * The main process keeps the part that must never be interrupted: answering the batteries, the log
 * files, and the record of the endpoint's own life (uptime.cjs). The web interface, the measurements
 * database, the notifications and the MQTT publisher run in a child process (webproc.cjs) that this
 * module starts, feeds and restarts. Restarting or updating the web side therefore does not touch the
 * batteries' endpoint.
 *
 * Main -> web (IPC, process.send):
 *   {t:'event', k:'request'|'connection'|'tls', d}   what happened at the endpoint
 *   {t:'uptime', s}                                   the endpoint's own status, every 5 s
 *   {t:'log', line} / {t:'logs', lines}               console lines, for the support package
 *   {t:'shutdown'}
 * Web -> main:
 *   {t:'ready', ipc, web}      the web side is up
 *   {t:'deviceIps', ips}       device addresses, to pick the gateway of the batteries' network
 *
 * The child exits with RESTART_CODE to ask for a restart (reload after an update). Any other exit is a
 * crash: it is restarted with a growing delay; three crashes within a minute while an update was being
 * tried mark that update as failed, and the next start uses the files of the image again. Events that
 * arrive while the child is down are queued (at most 5000) and delivered when it is back; whatever
 * was lost beyond that is in the daily request logs anyway.
 */
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const uptimeLib = require('./uptime.cjs');
const logbuf = require('./logbuf.cjs');

const IPC_VERSION = 1;
const RESTART_CODE = 75;
const QUEUE_MAX = 5000;

function start({ dataDir, log }) {
  let child = null;
  let ready = false;
  let stopping = false;
  let ips = [];
  let delay = 1000;
  let statusTimer = null;
  const queue = [];
  const exits = [];
  const overDir = path.join(dataDir, 'web-override');

  const up = uptimeLib.create({ dataDir, log, deviceIps: () => ips });
  up.begin();

  const send = (msg) => {
    if (child && child.connected) {
      try { child.send(msg); } catch { /* the child is going away */ }
    }
  };
  logbuf.setForward((line) => { if (ready) send({ t: 'log', line }); });

  /** Which update (if any) the crash loop belongs to: the one the web side noted before it loaded. */
  function blameUpdate() {
    try {
      const attempt = JSON.parse(fs.readFileSync(path.join(overDir, 'attempt.json'), 'utf8'));
      if (!attempt.version) return null;
      let failed = [];
      try { failed = JSON.parse(fs.readFileSync(path.join(overDir, 'failed.json'), 'utf8')); } catch { /* none yet */ }
      failed.push({ version: attempt.version, ts: Date.now(), reason: 'crash loop' });
      fs.writeFileSync(path.join(overDir, 'failed.json'), JSON.stringify(failed.slice(-10), null, 2));
      fs.unlinkSync(path.join(overDir, 'attempt.json'));
      return attempt.version;
    } catch {
      return null;
    }
  }

  function spawn() {
    if (stopping) return;
    child = fork(path.join(__dirname, 'webproc.cjs'), [], { env: process.env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    ready = false;
    child.on('message', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'ready') {
        ready = true;
        delay = 1000;
        log(`web   process ready (web ${m.web && m.web.version}, ${m.web && m.web.root})`);
        send({ t: 'logs', lines: logbuf.dump() });
        send({ t: 'uptime', s: up.status() });
        while (queue.length) send(queue.shift());
        statusTimer = setInterval(() => send({ t: 'uptime', s: up.status() }), 5000);
        statusTimer.unref();
      } else if (m.t === 'deviceIps' && Array.isArray(m.ips)) {
        ips = m.ips.filter((x) => typeof x === 'string');
      }
    });
    child.on('exit', (code, signal) => {
      ready = false;
      clearInterval(statusTimer);
      if (stopping) return;
      if (code === RESTART_CODE) {
        log('web   process restarting (reload)');
        setTimeout(spawn, 300);
        return;
      }
      const now = Date.now();
      exits.push(now);
      while (exits.length && now - exits[0] > 60000) exits.shift();
      log(`web   process exited (${code ?? signal}), starting it again`);
      if (exits.length >= 3) {
        exits.length = 0;
        const blamed = blameUpdate();
        if (blamed) log(`web   update ${blamed} keeps crashing: marked as failed, the files of the image are used again`);
      }
      delay = Math.min(15000, delay * 2);
      setTimeout(spawn, delay);
    });
  }
  spawn();

  const emit = (k, d) => {
    const msg = { t: 'event', k, d };
    if (ready) send(msg);
    else {
      queue.push(msg);
      if (queue.length > QUEUE_MAX) queue.shift();
    }
  };

  return {
    noteRequest: (d) => emit('request', d),
    noteConnection: (d) => emit('connection', d),
    noteTlsError: (d) => emit('tls', d),
    /** Ask the web side to stop, wait briefly, then stop the record of the endpoint's own life. */
    shutdown: () =>
      new Promise((resolve) => {
        stopping = true;
        clearInterval(statusTimer);
        const done = () => { up.shutdown(); resolve(); };
        if (!child || child.exitCode !== null || !child.connected) return done();
        child.once('exit', done);
        send({ t: 'shutdown' });
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } done(); }, 3000).unref();
      }),
    IPC_VERSION,
  };
}

module.exports = { start, IPC_VERSION, RESTART_CODE };
