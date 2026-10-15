'use strict';
/**
 * Single-account login for the web interface.
 *
 * Follows the OWASP ASVS V2/V3 requirements and the Password Storage and Session
 * Management cheat sheets, using Node core only:
 *   - scrypt (N=2^15, r=8, p=1) with a random 16-byte salt, compared in constant time
 *   - minimum 8 characters, long passwords allowed, a short list of well-known weak
 *     ones is refused
 *   - first start: the account does not exist yet. Setting the password ("claim")
 *     needs a one-time setup code that is only printed to the container log, so
 *     whoever is first on the LAN cannot take the interface over
 *   - sessions: 256-bit random id, idle timeout 30 min, absolute timeout 12 h,
 *     server-side only; changing the password ends every other session
 *   - failed logins are slowed down and, per client address, locked out after five
 *     failures in 15 minutes
 *   - a CSRF token is bound to every session
 *
 * Forgotten password: delete auth.json in the data directory and restart the
 * container; the interface is unclaimed again and prints a new setup code.
 */
const crypto = require('crypto');
const path = require('path');
const { promisify } = require('util');
const fs = require('fs');
const store = require('./store.cjs');

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };
const MIN_LENGTH = 8;
const MAX_LENGTH = 256;
const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const LOCK_AFTER = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

const WEAK = new Set([
  'password', 'passwort', '12345678', '123456789', '1234567890', 'qwertzui', 'qwertyui',
  'password1', 'passwort1', 'marstek1', 'marstek123', 'letmein1', 'iloveyou', 'abcd1234',
  '00000000', '11111111', 'admin123', 'welcome1', 'changeme', 'test1234',
]);

function create(dataDir, log) {
  const file = path.join(dataDir, 'auth.json');
  let account = store.read(file, null);
  let setupCode = null;
  // Sessions survive a restart of the web process (an update must not sign you out): they are kept in
  // sessions.json (owner-only), under the SHA-256 of the session id, so the file alone is no use as a cookie.
  const sessFile = path.join(dataDir, 'sessions.json');
  const sessions = new Map(Object.entries(store.read(sessFile, {})));
  const hid = (id) => crypto.createHash('sha256').update(String(id)).digest('hex');
  let dirty = false;
  let saveTimer = null;
  function saveSessions() {
    clearTimeout(saveTimer);
    saveTimer = null;
    dirty = false;
    try { store.write(sessFile, Object.fromEntries(sessions)); } catch (e) { log(`web   sessions not saved: ${e.message}`); }
  }
  /** Writing on every request would be wasteful: the last-seen time is saved at most once a minute. */
  function touch() {
    dirty = true;
    if (!saveTimer) { saveTimer = setTimeout(saveSessions, 60000); saveTimer.unref(); }
  }
  const failures = new Map(); // ip -> [timestamps]

  function newSetupCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (const b of crypto.randomBytes(8)) code += alphabet[b % alphabet.length];
    return `${code.slice(0, 4)}-${code.slice(4)}`;
  }

  function announceSetup() {
    if (account) return;
    if (!setupCode) setupCode = newSetupCode();
    log(`web   SETUP CODE ${setupCode} -- needed once to set the web interface password`);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * "Forgot the password" = delete auth.json. Checked on every call, so no restart is
   * needed: the account is forgotten, every session ends and a new setup code is
   * printed to the log.
   */
  function syncFile() {
    if (account && !fs.existsSync(file)) {
      account = null;
      sessions.clear();
      saveSessions();
      failures.clear();
      log('web   auth.json was removed: password reset, all sessions ended');
      announceSetup();
    }
  }

  function weakReason(password) {
    if (typeof password !== 'string') return 'invalid';
    if (password.length < MIN_LENGTH) return 'tooShort';
    if (password.length > MAX_LENGTH) return 'tooLong';
    if (WEAK.has(password.toLowerCase())) return 'weak';
    if (/^(.)\1+$/.test(password)) return 'weak';
    return null;
  }

  async function hash(password) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password.normalize('NFKC'), salt, PARAMS.keylen, PARAMS);
    return { salt: salt.toString('hex'), hash: key.toString('hex'), params: { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, keylen: PARAMS.keylen } };
  }

  async function verifyPassword(password) {
    if (!account || typeof password !== 'string' || password.length > MAX_LENGTH) return false;
    const p = account.params;
    const key = await scrypt(password.normalize('NFKC'), Buffer.from(account.salt, 'hex'), p.keylen, { N: p.N, r: p.r, p: p.p, maxmem: PARAMS.maxmem });
    const want = Buffer.from(account.hash, 'hex');
    return key.length === want.length && crypto.timingSafeEqual(key, want);
  }

  // --- lockout ----------------------------------------------------------------
  function recentFailures(ip) {
    const now = Date.now();
    const list = (failures.get(ip) || []).filter((t) => now - t < LOCK_WINDOW_MS);
    failures.set(ip, list);
    return list;
  }
  function lockedFor(ip) {
    const list = recentFailures(ip);
    if (list.length < LOCK_AFTER) return 0;
    return Math.max(0, LOCK_WINDOW_MS - (Date.now() - list[list.length - LOCK_AFTER]));
  }
  let writeTimer = null;
  function persistSoon() {
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
      writeTimer = null;
      // a deleted file means "reset": never write it back from a stale counter
      if (account && fs.existsSync(file)) store.write(file, account);
    }, 3000);
    writeTimer.unref();
  }
  /** One failed attempt: feeds the lockout and the "failed since last login" counter. */
  function fail(ip, countOnly = false) {
    if (!countOnly) recentFailures(ip).push(Date.now());
    if (account) {
      const f = account.failed || { count: 0 };
      account.failed = { count: f.count + 1, lastTs: Date.now(), lastIp: ip };
      persistSoon();
    }
  }
  /** What the owner should see right after signing in, taken before it is reset. */
  function loginInfo() {
    const info = { previous: account.lastLogin || null, failed: account.failed || { count: 0 } };
    return info;
  }
  function recordLogin(ip) {
    account.lastLogin = { ts: Date.now(), ip };
    account.failed = { count: 0 };
    store.write(file, account);
  }

  // --- sessions ---------------------------------------------------------------
  function startSession(ip, info) {
    const id = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    sessions.set(hid(id), { csrf: crypto.randomBytes(24).toString('hex'), created: now, last: now, ip, info });
    saveSessions();
    return id;
  }
  function getSession(id) {
    syncFile();
    const key = id && hid(id);
    const s = key && sessions.get(key);
    if (!s) return null;
    const now = Date.now();
    if (now - s.last > IDLE_MS || now - s.created > ABSOLUTE_MS) {
      sessions.delete(key);
      touch();
      return null;
    }
    s.last = now;
    touch();
    return s;
  }
  function endSession(id) {
    sessions.delete(hid(id));
    saveSessions();
  }
  setInterval(() => {
    const now = Date.now();
    for (const [k, s] of sessions) if (now - s.last > IDLE_MS || now - s.created > ABSOLUTE_MS) { sessions.delete(k); dirty = true; }
    if (dirty) saveSessions();
  }, 5 * 60 * 1000).unref();

  // --- operations -------------------------------------------------------------
  /** @returns {Promise<{ok:boolean, error?:string, retryAfter?:number, session?:string}>} */
  async function claim(password, code, ip) {
    syncFile();
    if (account) return { ok: false, error: 'alreadyClaimed' };
    const wait = lockedFor(ip);
    if (wait) return { ok: false, error: 'locked', retryAfter: Math.ceil(wait / 1000) };
    const given = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const a = Buffer.from(given);
    const b = Buffer.from(setupCode || '');
    if (!setupCode || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      fail(ip);
      await sleep(500);
      return { ok: false, error: 'badCode' };
    }
    const weak = weakReason(password);
    if (weak) return { ok: false, error: weak };
    account = { ...(await hash(password)), createdAt: new Date().toISOString() };
    store.write(file, account);
    setupCode = null;
    log('web   password set, the interface is now protected');
    recordLogin(ip);
    return { ok: true, session: startSession(ip, { previous: null, failed: { count: 0 } }) };
  }

  async function login(password, ip) {
    syncFile();
    if (!account) return { ok: false, error: 'notClaimed' };
    const wait = lockedFor(ip);
    if (wait) {
      fail(ip, true);
      return { ok: false, error: 'locked', retryAfter: Math.ceil(wait / 1000) };
    }
    if (await verifyPassword(password)) {
      const info = loginInfo();
      recordLogin(ip);
      return { ok: true, session: startSession(ip, info) };
    }
    fail(ip);
    await sleep(400 + Math.floor(Math.random() * 300));
    return { ok: false, error: 'badLogin' };
  }

  async function changePassword(currentSessionId, current, next, ip) {
    const wait = lockedFor(ip);
    if (wait) return { ok: false, error: 'locked', retryAfter: Math.ceil(wait / 1000) };
    if (!(await verifyPassword(current))) {
      fail(ip);
      await sleep(400);
      return { ok: false, error: 'badLogin' };
    }
    const weak = weakReason(next);
    if (weak) return { ok: false, error: weak };
    account = { ...(await hash(next)), createdAt: account.createdAt, changedAt: new Date().toISOString(), lastLogin: account.lastLogin, failed: account.failed };
    store.write(file, account);
    for (const k of [...sessions.keys()]) if (k !== hid(currentSessionId)) sessions.delete(k);
    saveSessions();
    log('web   password changed, other sessions ended');
    return { ok: true };
  }

  return {
    isClaimed: () => {
      syncFile();
      return !!account;
    },
    announceSetup,
    claim,
    login,
    changePassword,
    getSession,
    endSession,
    currentLogin: () => (account ? account.lastLogin || null : null),
    flush: () => { if (dirty) saveSessions(); },
    constants: { MIN_LENGTH, IDLE_MS, ABSOLUTE_MS },
  };
}

module.exports = { create };
