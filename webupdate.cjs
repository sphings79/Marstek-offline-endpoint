'use strict';
/**
 * Web updates: a new version of the web side (web.cjs and its modules, the page files) from a GitHub release
 * of this repository, installed without touching the image and without restarting the endpoint that answers the
 * batteries. Only the web process is restarted.
 *
 * What makes this safe to do:
 *   - It is always an action of the owner (a button), never automatic.
 *   - A release carries three assets: the bundle (a .tar.gz), a manifest (.manifest.json) that names the
 *     bundle and its SHA-256, and a signature (.manifest.sig) over the exact manifest bytes. The signature is
 *     Ed25519; the public key is part of the image (webupdate.pub). Whoever can publish a release on GitHub
 *     but does not hold the private key cannot make an endpoint install anything.
 *   - Downloads come from github.com and its asset hosts only, over HTTPS, with a size limit.
 *   - The manifest says which IPC version of the main process and which container version the bundle needs.
 *     A bundle that does not fit is refused.
 *   - The archive is read by a small reader that accepts regular files with plain relative paths from the
 *     manifest's list, nothing else (no links, no absolute or ".." paths, no extra files).
 *   - The new files are written to <data>/web-override/<version>/ and only then made current. If the new
 *     code crashes, the supervisor marks it as failed and the files of the image run again.
 */
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const zlib = require('zlib');

const HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com']);
const MAX_BUNDLE = 6 * 1024 * 1024;
const MAX_SMALL = 64 * 1024;
const NAME = 'marstek-endpoint-web';
const KEEP_VERSIONS = 2;

const parts = (v) => String(v || '').split('.').map((x) => parseInt(x, 10) || 0);
const newer = (a, b) => { const x = parts(a); const y = parts(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
const baseVersion = (v) => { const m = /^v?(\d+\.\d+\.\d+)/.exec(String(v || '')); return m ? m[1] : null; };

/** GET with redirects limited to the allowed hosts; resolves to a Buffer or throws an Error whose message is a short code. */
function download(url, limit, hops = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('badUrl')); }
    if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) return reject(new Error('hostNotAllowed'));
    const req = https.get(u, { headers: { 'User-Agent': 'marstek-offline-endpoint-web-update', Accept: 'application/octet-stream' }, timeout: 20000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (hops >= 3) return reject(new Error('tooManyRedirects'));
        return download(new URL(res.headers.location, u).toString(), limit, hops + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`http ${res.statusCode}`)); }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > limit) req.destroy(new Error('tooLarge'));
        else chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** Minimal ustar reader: returns [{name, data}] for regular files, throws on anything else. */
function readTar(buf) {
  const out = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const prefix = h.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(h.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    if (!Number.isFinite(size) || size < 0 || off + 512 + size > buf.length) throw new Error('badArchive');
    if (type === '0' || type === '\0') out.push({ name: prefix ? `${prefix}/${name}` : name, data: buf.subarray(off + 512, off + 512 + size) });
    else if (type !== '5') throw new Error('badArchive'); // links, devices, pax headers: not accepted
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** A relative path made of plain names, nothing that climbs out of the target directory. */
const safeName = (n) => typeof n === 'string' && n.length > 0 && n.length < 200 && !n.startsWith('/') && n.split('/').every((p) => /^[A-Za-z0-9._-]+$/.test(p) && p !== '.' && p !== '..');

function create({ dataDir, imageDir, containerVersion, ipcVersion, log, fetchAsset = download }) {
  const overDir = path.join(dataDir, 'web-override');
  const pubFile = path.join(imageDir, 'webupdate.pub');
  const state = { busy: false, last: null };

  const publicKey = () => {
    try { return crypto.createPublicKey(fs.readFileSync(pubFile, 'utf8')); } catch { return null; }
  };

  /** The three assets of a release, by name, or null when it is not a complete web release. */
  function assetsOf(release) {
    const ver = baseVersion(String(release.tag || '').replace(/^web-/, ''));
    if (!ver || !/^web-v/.test(release.tag)) return null;
    const find = (suffix) => (release.assets || []).find((a) => a.name === `${NAME}-${ver}${suffix}`);
    const bundle = find('.tar.gz');
    const manifest = find('.manifest.json');
    const sig = find('.manifest.sig');
    return bundle && manifest && sig ? { version: ver, bundle, manifest, sig } : null;
  }

  /** Download, verify, extract, make current. Resolves with {ok, version} or {ok:false, error}. */
  async function install(release) {
    if (state.busy) return { ok: false, error: 'busy' };
    state.busy = true;
    try {
      const key = publicKey();
      if (!key) return { ok: false, error: 'noPublicKey' };
      const a = assetsOf(release);
      if (!a) return { ok: false, error: 'noAssets' };
      const manifestBytes = await fetchAsset(a.manifest.url, MAX_SMALL);
      const sig = Buffer.from((await fetchAsset(a.sig.url, MAX_SMALL)).toString('utf8').trim(), 'base64');
      if (!crypto.verify(null, manifestBytes, key, sig)) return { ok: false, error: 'badSignature' };
      let manifest;
      try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { return { ok: false, error: 'badManifest' }; }
      if (manifest.name !== NAME || manifest.version !== a.version || !manifest.tar || !/^[0-9a-f]{64}$/.test(String(manifest.tar.sha256)) || !Array.isArray(manifest.files) || !manifest.files.every(safeName)) return { ok: false, error: 'badManifest' };
      const need = manifest.requires || {};
      if (need.ipc !== ipcVersion) return { ok: false, error: 'incompatibleIpc' };
      const cv = baseVersion(containerVersion);
      if (need.minContainer && cv && newer(need.minContainer, cv)) return { ok: false, error: 'containerTooOld', need: need.minContainer };
      const bundle = await fetchAsset(a.bundle.url, MAX_BUNDLE);
      if (crypto.createHash('sha256').update(bundle).digest('hex') !== manifest.tar.sha256) return { ok: false, error: 'badChecksum' };
      let files;
      try { files = readTar(zlib.gunzipSync(bundle, { maxOutputLength: 24 * 1024 * 1024 })); } catch { return { ok: false, error: 'badArchive' }; }
      const listed = new Set(manifest.files);
      if (files.length !== listed.size || !files.every((f) => listed.has(f.name))) return { ok: false, error: 'badArchive' };
      // all checks passed: write next to the others, then switch
      fs.mkdirSync(overDir, { recursive: true });
      const dir = path.join(overDir, a.version);
      const tmp = `${dir}.tmp`;
      fs.rmSync(tmp, { recursive: true, force: true });
      for (const f of files) {
        const target = path.join(tmp, f.name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, f.data, { mode: 0o644 });
      }
      fs.writeFileSync(path.join(tmp, 'manifest.json'), manifestBytes);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(tmp, dir);
      // a version that failed before may be tried again once it was installed anew
      try {
        const failed = JSON.parse(fs.readFileSync(path.join(overDir, 'failed.json'), 'utf8')).filter((x) => x.version !== a.version);
        fs.writeFileSync(path.join(overDir, 'failed.json'), JSON.stringify(failed));
      } catch { /* no failures recorded */ }
      fs.writeFileSync(path.join(overDir, 'current.json'), JSON.stringify({ version: a.version, installedAt: Date.now(), tag: release.tag }));
      prune(a.version);
      log(`web   update ${a.version} installed (signature and checksum verified)`);
      state.last = { ts: Date.now(), version: a.version, ok: true };
      return { ok: true, version: a.version };
    } catch (e) {
      state.last = { ts: Date.now(), ok: false, error: e.message };
      log(`web   update failed: ${e.message}`);
      return { ok: false, error: e.message };
    } finally {
      state.busy = false;
    }
  }

  /** Keep the current and the one before it. */
  function prune(current) {
    try {
      const dirs = fs.readdirSync(overDir).filter((d) => /^\d+\.\d+\.\d+$/.test(d)).sort((x, y) => (newer(x, y) ? -1 : 1));
      for (const d of dirs.slice(KEEP_VERSIONS)) if (d !== current) fs.rmSync(path.join(overDir, d), { recursive: true, force: true });
    } catch { /* nothing to prune */ }
  }

  /** Go back to the files of the image: forget the installed update. */
  function rollback() {
    try { fs.unlinkSync(path.join(overDir, 'current.json')); } catch { /* none */ }
    state.last = { ts: Date.now(), ok: true, rolledBack: true };
    return { ok: true };
  }

  return { install, rollback, assetsOf, publicKey: () => !!publicKey(), state: () => ({ ...state }) };
}

module.exports = { create, readTar, safeName, baseVersion, newer, download };
