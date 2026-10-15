'use strict';
/**
 * Notifications: tells the owner when something about the uploads is not right.
 *
 * Channels: Telegram (bot API), Pushover, Home Assistant `notify` (REST API with a long-lived token) and a
 * webhook (POST to a URL of your choice, JSON or plain text, optional Authorization header). The webhook
 * address often carries a secret (a token in the path), so it is kept with the secrets, not in the settings.
 * Nothing but the request to the configured address leaves the container, and a message names
 * the device as the owner named it (or "Venus <last four of the MAC>"), never the device id,
 * the address or any measurement.
 *
 * Rules, checked every 30 s:
 *   uploadMissing  a device has not uploaded for 3x its usual spacing, at least minMinutes. The clock
 *                  starts again when the endpoint itself starts, so a restart never counts as a missing upload.
 *   pingDown       the ping to a device has been down for `seconds`.
 *   endpoint       the endpoint started after an unclean stop (and, optionally, any restart);
 *                  the endpoint had no network (the message waits in the queue until it is back).
 *   firmware       the control, BMS, inverter or MPPT firmware of a device changed (off by default).
 *   updates        a new container version or a new web version was released (each off by default; one message
 *                  per version).
 *   recovery       say so when an incident is over.
 * One message per incident; incidents are remembered across restarts, so a dead device does not
 * report again with every start. A message that cannot be delivered waits in a queue (retried every
 * minute, at most 24 h, at most 50 messages). At most 30 messages per hour leave the container.
 *
 * Secrets (bot token, HA token) live in secrets.json (owner-only) and are never sent back to the page.
 */
const http = require('http');
const https = require('https');
const path = require('path');
const store = require('./store.cjs');

const TICK_MS = 30000;
const QUEUE_MAX = 50;
const QUEUE_AGE_MS = 24 * 3600e3;
const PER_HOUR = 30;

const MSG = {
  en: {
    uploadMissing: (n, min, usual) => `⚠ ${n}: no upload for ${min} min (usually every ${usual} min).`,
    uploadBack: (n, min) => `✅ ${n}: uploading again after ${min} min.`,
    pingDown: (n, s) => `⚠ ${n}: not answering ping for ${s} s.`,
    pingBack: (n, dur) => `✅ ${n}: reachable again after ${dur}.`,
    crash: (dur) => `⚠ The Marstek endpoint started after an unclean stop (${dur} without a sign of life).`,
    restart: (dur) => `ℹ The Marstek endpoint restarted (${dur} off).`,
    netDown: () => '⚠ The endpoint has no network (gateway not reachable).',
    netBack: (dur) => `✅ The endpoint has its network back after ${dur}.`,
    firmware: (n, part, from, to) => `ℹ ${n}: ${part} firmware ${from} → ${to}.`,
    updateContainer: (tag, cur) => `ℹ A new container version is available: ${tag} (running ${cur}). Pull the new image to update.`,
    updateWeb: (tag, cur) => `ℹ A new web version is available: ${tag} (running ${cur}). Install it under Settings, Updates: the endpoint that answers the batteries keeps running.`,
    parts: { control: 'control', bms: 'BMS', inverter: 'inverter', mppt: 'MPPT' },
    test: () => '✅ Test message from the Marstek Offline Endpoint.',
    title: 'Marstek Offline Endpoint',
    dur: (s) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 360) / 10} h`),
  },
  de: {
    uploadMissing: (n, min, usual) => `⚠ ${n}: seit ${min} Min kein Upload (sonst alle ${usual} Min).`,
    uploadBack: (n, min) => `✅ ${n}: lädt wieder hoch, nach ${min} Min.`,
    pingDown: (n, s) => `⚠ ${n}: antwortet seit ${s} s nicht auf Ping.`,
    pingBack: (n, dur) => `✅ ${n}: wieder erreichbar, nach ${dur}.`,
    crash: (dur) => `⚠ Der Marstek-Endpoint ist nach einem unsauberen Stopp gestartet (${dur} ohne Lebenszeichen).`,
    restart: (dur) => `ℹ Der Marstek-Endpoint wurde neu gestartet (${dur} aus).`,
    netDown: () => '⚠ Der Endpoint hat kein Netz (Gateway nicht erreichbar).',
    netBack: (dur) => `✅ Der Endpoint hat sein Netz zurück, nach ${dur}.`,
    firmware: (n, part, from, to) => `ℹ ${n}: ${part}-Firmware ${from} → ${to}.`,
    updateContainer: (tag, cur) => `ℹ Eine neue Container-Version ist verfügbar: ${tag} (läuft ${cur}). Zum Aktualisieren das neue Image holen.`,
    updateWeb: (tag, cur) => `ℹ Eine neue Web-Version ist verfügbar: ${tag} (läuft ${cur}). Installieren unter Einstellungen, Updates: Der Endpoint, der die Batterien beantwortet, läuft dabei weiter.`,
    parts: { control: 'Steuer', bms: 'BMS', inverter: 'Wechselrichter', mppt: 'MPPT' },
    test: () => '✅ Testnachricht vom Marstek Offline Endpoint.',
    title: 'Marstek Offline Endpoint',
    dur: (s) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} Min` : `${String(Math.round(s / 360) / 10).replace('.', ',')} h`),
  },
};

const DEFAULTS = {
  enabled: false,
  lang: 'en',
  telegram: { enabled: false, chatId: '' },
  ha: { enabled: false, url: '', service: 'notify' },
  pushover: { enabled: false, priority: 0 },
  webhook: { enabled: false, format: 'json', insecure: false },
  rules: { uploadMissing: { on: true, minMinutes: 15 }, pingDown: { on: true, seconds: 60 }, endpoint: { on: true, restart: false }, firmware: { on: false }, updates: { container: false, web: false }, recovery: { on: true } },
};

/** Merge a stored/partial config into the defaults and drop anything that is not a known setting. */
function normalise(c = {}) {
  const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
  const r = c.rules || {};
  return {
    enabled: c.enabled === true,
    lang: c.lang === 'de' ? 'de' : 'en',
    telegram: { enabled: !!(c.telegram && c.telegram.enabled), chatId: String((c.telegram && c.telegram.chatId) || '').trim().slice(0, 64) },
    ha: { enabled: !!(c.ha && c.ha.enabled), insecure: !!(c.ha && c.ha.insecure), url: String((c.ha && c.ha.url) || '').trim().replace(/\/+$/, '').slice(0, 200), service: String((c.ha && c.ha.service) || 'notify').trim().replace(/^notify\./i, '').slice(0, 80) },
    pushover: { enabled: !!(c.pushover && c.pushover.enabled), priority: [-1, 0, 1].includes(Number(c.pushover && c.pushover.priority)) ? Number(c.pushover.priority) : 0 },
    webhook: { enabled: !!(c.webhook && c.webhook.enabled), format: c.webhook && c.webhook.format === 'text' ? 'text' : 'json', insecure: !!(c.webhook && c.webhook.insecure) },
    rules: {
      uploadMissing: { on: (r.uploadMissing ? r.uploadMissing.on : DEFAULTS.rules.uploadMissing.on) !== false, minMinutes: num(r.uploadMissing && r.uploadMissing.minMinutes, 15, 5, 1440) },
      pingDown: { on: (r.pingDown ? r.pingDown.on : DEFAULTS.rules.pingDown.on) !== false, seconds: num(r.pingDown && r.pingDown.seconds, 60, 10, 3600) },
      endpoint: { on: (r.endpoint ? r.endpoint.on : DEFAULTS.rules.endpoint.on) !== false, restart: !!(r.endpoint && r.endpoint.restart) },
      firmware: { on: !!(r.firmware && r.firmware.on) },
      updates: { container: !!(r.updates && r.updates.container), web: !!(r.updates && r.updates.web) },
      recovery: { on: (r.recovery ? r.recovery.on : DEFAULTS.rules.recovery.on) !== false },
    },
  };
}

const URL_RE = /^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/;
/** @returns {string|null} the reason the config is not acceptable, or null */
function validate(c) {
  if (c.telegram.chatId && !/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/.test(c.telegram.chatId)) return 'badChatId';
  if (c.ha.url && !URL_RE.test(c.ha.url)) return 'badUrl';
  if (!/^[a-z0-9_]{1,80}$/.test(c.ha.service)) return 'badService';
  return null;
}

/** One HTTP(S) request with a timeout, no redirects. */
function request({ method, url, headers = {}, body, timeoutMs = 10000, insecure = false }) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return resolve({ ok: false, error: 'badUrl' });
    }
    const lib = u.protocol === 'https:' ? https : http;
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = lib.request(u, { method, headers: { ...headers, ...(data ? { 'Content-Length': data.length } : {}) }, timeout: timeoutMs, rejectUnauthorized: !insecure }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8').slice(0, 2000) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
    if (data) req.write(data);
    req.end();
  });
}

function create({ dataDir, log, getConfig, getSecrets, devices, pingStatus, endpointStatus, firmwareHistory, updateStatus = () => null, send = null }) {
  const stateFile = path.join(dataDir, 'notify-state.json');
  const state = { active: {}, fw: {}, updSeen: {}, queue: [], sentHour: [], lastSent: null, lastError: null, bootHandled: false, ...store.read(stateFile, {}) };
  let timer = null;
  const save = () => store.write(stateFile, state);
  const TELEGRAM = () => process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

  const cfg = () => normalise(getConfig());
  const L = () => MSG[cfg().lang];

  async function sendTelegram(c, secrets, text) {
    if (!secrets.telegramToken || !c.telegram.chatId) return { ok: false, error: 'notConfigured' };
    const r = await request({ method: 'POST', url: `${TELEGRAM()}/bot${secrets.telegramToken}/sendMessage`, headers: { 'Content-Type': 'application/json' }, body: { chat_id: c.telegram.chatId, text, disable_web_page_preview: true } });
    return r.ok ? r : { ...r, error: r.error || `http ${r.status}` };
  }
  async function sendPushover(c, secrets, text) {
    if (!secrets.pushoverToken || !secrets.pushoverUser) return { ok: false, error: 'notConfigured' };
    const r = await request({
      method: 'POST', url: `${process.env.PUSHOVER_API_BASE || 'https://api.pushover.net'}/1/messages.json`, headers: { 'Content-Type': 'application/json' },
      body: { token: secrets.pushoverToken, user: secrets.pushoverUser, title: MSG[c.lang].title, message: text, priority: c.pushover.priority },
    });
    let ok = r.ok;
    if (r.ok) { try { ok = JSON.parse(r.body).status === 1; } catch { ok = false; } }
    return ok ? r : { ...r, ok: false, error: r.error || (r.status ? `http ${r.status}` : 'refused') };
  }
  async function sendHa(c, secrets, text) {
    if (!secrets.haToken || !c.ha.url) return { ok: false, error: 'notConfigured' };
    const r = await request({
      method: 'POST', url: `${c.ha.url}/api/services/notify/${c.ha.service}`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secrets.haToken}` },
      body: { message: text, title: MSG[c.lang].title },
      insecure: !!c.ha.insecure,
    });
    if (r.status === 404) return { ...r, ok: false, error: `http 404: notify.${c.ha.service} does not exist in Home Assistant` };
    return r.ok ? r : { ...r, error: r.error || `http ${r.status}` };
  }
  async function sendWebhook(c, secrets, text, meta = {}) {
    if (!secrets.webhookUrl) return { ok: false, error: 'notConfigured' };
    const headers = secrets.webhookAuth ? { Authorization: secrets.webhookAuth } : {};
    const isText = c.webhook.format === 'text';
    const r = await request({
      method: 'POST', url: secrets.webhookUrl, insecure: !!c.webhook.insecure,
      headers: { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json', Title: MSG[c.lang].title, ...headers },
      body: isText ? text : { title: MSG[c.lang].title, message: text, event: meta.event || 'test', device: meta.device || null, time: new Date().toISOString() },
    });
    return r.ok ? r : { ...r, error: r.error || `http ${r.status}` };
  }
  const deliverOne = send || (async (channel, c, secrets, text, meta) => (channel === 'telegram' ? sendTelegram(c, secrets, text) : channel === 'pushover' ? sendPushover(c, secrets, text) : channel === 'webhook' ? sendWebhook(c, secrets, text, meta) : sendHa(c, secrets, text)));

  /** Try every enabled channel; return the channels that did not take it. */
  async function deliver(text, only, meta) {
    const c = cfg();
    const secrets = getSecrets();
    const channels = [];
    if (c.telegram.enabled) channels.push('telegram');
    if (c.ha.enabled) channels.push('ha');
    if (c.pushover.enabled) channels.push('pushover');
    if (c.webhook.enabled) channels.push('webhook');
    const failed = [];
    for (const ch of channels.filter((x) => !only || only.includes(x))) {
      const r = await deliverOne(ch, c, secrets, text, meta);
      if (r.ok) { state.lastSent = Date.now(); state.lastError = null; } else { failed.push(ch); state.lastError = { ts: Date.now(), channel: ch, error: r.error }; log(`web   notification via ${ch} failed: ${r.error}`); }
    }
    return failed;
  }

  /** Send now, or queue when it cannot be delivered or when the hourly limit is reached. */
  async function notify(text, meta = {}) {
    const c = cfg();
    if (!c.enabled || (!c.telegram.enabled && !c.ha.enabled && !c.pushover.enabled && !c.webhook.enabled)) return;
    const now = Date.now();
    state.sentHour = state.sentHour.filter((t) => now - t < 3600e3);
    if (state.sentHour.length >= PER_HOUR) { log('web   notification dropped: hourly limit reached'); return; }
    state.sentHour.push(now);
    const failed = await deliver(text, undefined, meta);
    if (failed.length && state.queue.length < QUEUE_MAX) state.queue.push({ ts: now, text, meta, channels: failed });
    save();
  }

  async function retryQueue() {
    const now = Date.now();
    state.queue = state.queue.filter((q) => now - q.ts < QUEUE_AGE_MS);
    if (!state.queue.length) return;
    const keep = [];
    for (const q of state.queue) {
      const failed = await deliver(q.text, q.channels, q.meta);
      if (failed.length) keep.push({ ...q, channels: failed });
    }
    state.queue = keep;
    save();
  }

  const nameOf = (d) => d.name || (d.mac ? `Venus ${d.mac.slice(-4)}` : 'Venus');
  const open = (key, extra = {}) => { state.active[key] = { since: Date.now(), ...extra }; };

  async function tick() {
    const c = cfg();
    if (!c.enabled) return;
    const now = Date.now();
    const ep = endpointStatus();
    const t = L();

    // the endpoint itself
    if (c.rules.endpoint.on && !state.bootHandled && ep.start) {
      state.bootHandled = true;
      const offS = ep.start.from ? Math.max(0, (ep.startedAt - ep.start.from) / 1000) : 0;
      if (ep.start.prev === 'crash') await notify(t.crash(t.dur(offS)), { event: 'endpoint_unclean_start' });
      else if (ep.start.prev === 'clean' && c.rules.endpoint.restart) await notify(t.restart(t.dur(offS)), { event: 'endpoint_restart' });
    }
    state.bootHandled = true;
    if (c.rules.endpoint.on && ep.network === 'down' && ep.networkSince && now - ep.networkSince >= 60000 && !state.active.net) {
      open('net', { since: ep.networkSince });
      await notify(t.netDown(), { event: 'network_down' });
    } else if (ep.network === 'up' && state.active.net) {
      const s = (now - state.active.net.since) / 1000;
      delete state.active.net;
      if (c.rules.recovery.on) await notify(t.netBack(t.dur(s)), { event: 'network_up' });
    }

    // new releases: one message per version
    if (c.rules.updates.container || c.rules.updates.web) {
      const u = updateStatus();
      if (u) {
        if (c.rules.updates.container && u.updateAvailable && state.updSeen.container !== u.updateAvailable) {
          state.updSeen.container = u.updateAvailable;
          await notify(t.updateContainer(u.updateAvailable, u.current), { event: 'update_container' });
        }
        if (c.rules.updates.web && u.web && u.web.available && state.updSeen.web !== u.web.available) {
          state.updSeen.web = u.web.available;
          await notify(t.updateWeb(u.web.available, `web-v${u.web.current}`), { event: 'update_web' });
        }
      }
    }

    for (const d of devices.list()) {
      const name = nameOf(d);
      // uploads
      if (c.rules.uploadMissing.on && d.lastUpload) {
        const usualS = d.uploadIntervalS || 300;
        const limit = Math.max(c.rules.uploadMissing.minMinutes * 60e3, 3 * usualS * 1000);
        const ref = Math.max(d.lastUpload, ep.startedAt);
        const key = `up:${d.uid}`;
        if (now - ref > limit && !state.active[key]) {
          open(key, { since: d.lastUpload });
          await notify(t.uploadMissing(name, Math.round((now - d.lastUpload) / 60e3), Math.round(usualS / 60)), { event: 'upload_missing', device: name });
        } else if (state.active[key] && d.lastUpload > state.active[key].since + 1000 && now - d.lastUpload < limit) {
          const min = Math.round((now - state.active[key].since) / 60e3);
          delete state.active[key];
          if (c.rules.recovery.on) await notify(t.uploadBack(name, min), { event: 'upload_back', device: name });
        }
      }
      // ping
      if (c.rules.pingDown.on) {
        const st = pingStatus(d.uid);
        const key = `ping:${d.uid}`;
        if (st && st.state === 'down' && now - st.since >= c.rules.pingDown.seconds * 1000 && !state.active[key]) {
          open(key, { since: st.since });
          await notify(t.pingDown(name, c.rules.pingDown.seconds), { event: 'ping_down', device: name });
        } else if (st && st.state === 'up' && state.active[key]) {
          const s = (now - state.active[key].since) / 1000;
          delete state.active[key];
          if (c.rules.recovery.on) await notify(t.pingBack(name, t.dur(s)), { event: 'ping_up', device: name });
        }
      }
      // firmware
      if (c.rules.firmware.on) {
        const changes = firmwareHistory(d.uid).filter((x) => x.from !== null);
        const cursor = state.fw[d.uid];
        const last = changes.length ? changes[changes.length - 1].ts : 0;
        if (cursor === undefined) state.fw[d.uid] = last; // first look: what is already in the history is not news
        else if (last > cursor) {
          for (const x of changes.filter((y) => y.ts > cursor)) await notify(t.firmware(name, t.parts[x.part] || x.part, x.from, x.to), { event: 'firmware_changed', device: name });
          state.fw[d.uid] = last;
        }
      }
    }
    save();
    await retryQueue();
  }

  function begin() {
    timer = setInterval(() => tick().catch((e) => log(`web   notify tick failed: ${e.message}`)), TICK_MS);
    timer.unref();
    setTimeout(() => tick().catch(() => {}), 20000).unref(); // after the first uploads had a chance to arrive
  }

  /** A test message through one channel; resolves with {ok, error?}. */
  async function test(channel) {
    const c = cfg();
    const secrets = getSecrets();
    const text = MSG[c.lang].test();
    const ch = ['ha', 'webhook', 'pushover'].includes(channel) ? channel : 'telegram';
    const r = await deliverOne(ch, { ...c, [ch]: { ...c[ch], enabled: true } }, secrets, text, { event: 'test' });
    return { ok: !!r.ok, error: r.ok ? undefined : r.error };
  }

  function status() {
    return { queue: state.queue.length, lastSent: state.lastSent, lastError: state.lastError, active: Object.keys(state.active).map((k) => ({ kind: k.split(':')[0], since: state.active[k].since })) };
  }

  return { begin, tick, test, status, notify, state, shutdown: () => clearInterval(timer) };
}

module.exports = { create, normalise, validate, request, DEFAULTS, URL_RE };
