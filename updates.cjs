'use strict';
/**
 * Update notice: asks GitHub which releases exist and shows what changed.
 *
 * On by default, switchable in Settings. Once a day it makes one HTTPS request to
 * api.github.com -- the public releases list of this repository. The promise of this
 * project is that your measurements stay in your network; this request carries none:
 * no identifier of yours or of a device is sent, GitHub sees the address the request
 * comes from, like for any download. Failures are silent: a missing internet
 * connection is fine and the endpoint keeps working.
 *
 * The check itself only reads release notes: nothing is downloaded by it. Releases of two kinds are
 * told apart: `vX.Y.Z` (a new container image, which you pull yourself) and `web-vX.Y.Z` (a new web side that
 * can be installed from the interface without restarting the endpoint, see webupdate.cjs). Installing is
 * always a button you press; it is never done by the check.
 */
const https = require('https');
const path = require('path');
const store = require('./store.cjs');
const webUpdate = require('./webupdate.cjs');

const REPO = 'sphings79/marstek-offline-endpoint';
const MAX_BYTES = 512 * 1024;
const KEEP = 20;

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

function create({ dataDir, version, webVersion: initialWeb = null, ipcVersion = 1, isEnabled, log, isInstallable = () => true }) {
  const file = path.join(dataDir, 'updates.json');
  let webVersion = initialWeb;
  let cache = store.read(file, { checkedAt: null, releases: [], error: null });
  let timer = null;
  let running = null;

  function fetchReleases() {
    return new Promise((resolve) => {
      const req = https.get(
        {
          hostname: 'api.github.com',
          path: `/repos/${REPO}/releases?per_page=${KEEP}`,
          headers: { 'User-Agent': 'marstek-offline-endpoint-update-check', Accept: 'application/vnd.github+json' },
          timeout: 8000,
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on('data', (c) => {
            size += c.length;
            if (size > MAX_BYTES) {
              req.destroy(new Error('too large'));
            } else chunks.push(c);
          });
          res.on('end', () => {
            if (res.statusCode !== 200) return resolve({ error: `http ${res.statusCode}` });
            try {
              const list = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              resolve({
                releases: list
                  .filter((r) => !r.draft && !r.prerelease)
                  .map((r) => ({
                    tag: String(r.tag_name || ''),
                    name: String(r.name || r.tag_name || ''),
                    date: r.published_at || null,
                    url: String(r.html_url || ''),
                    body: String(r.body || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 8000),
                    assets: (Array.isArray(r.assets) ? r.assets : []).slice(0, 12).map((a) => ({ name: String(a.name || ''), url: String(a.browser_download_url || ''), size: Number(a.size) || 0 })),
                  })),
              });
            } catch {
              resolve({ error: 'bad response' });
            }
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (e) => resolve({ error: e.message }));
    });
  }

  /** One lookup; concurrent calls share it. */
  function check() {
    if (running) return running;
    running = (async () => {
      const r = await fetchReleases();
      if (!r.error) {
        // what a web release asks of the container, read from its manifest (the install checks it again, signed)
        for (const rel of r.releases.filter((x) => /^web-v\d/.test(x.tag)).slice(0, 3)) {
          const m = rel.assets.find((a) => /\.manifest\.json$/.test(a.name));
          if (!m) continue;
          try {
            const manifest = JSON.parse((await webUpdate.download(m.url, 64 * 1024)).toString('utf8'));
            if (manifest && manifest.requires && typeof manifest.requires === 'object') rel.requires = { ipc: manifest.requires.ipc ?? null, minContainer: manifest.requires.minContainer ?? null };
          } catch { /* the install will say what is wrong */ }
        }
      }
      cache = r.error
        ? { ...cache, checkedAt: Date.now(), error: r.error }
        : { checkedAt: Date.now(), releases: r.releases, error: null };
      store.write(file, cache);
      if (r.error) log(`web   update check failed: ${r.error}`);
      running = null;
      return status();
    })();
    return running;
  }

  const isWeb = (r) => /^web-v\d/.test(r.tag);
  /** What the interface shows: the container releases and the web releases, each marked as newer / installed / older. */
  function status() {
    const mark = (list, installed) => list.map((r) => {
      const v = parseVersion(isWeb(r) ? r.tag.replace(/^web-/, '') : r.tag);
      let state = 'unknown';
      if (installed && v) {
        const c = compare(v, installed);
        state = c > 0 ? 'newer' : c === 0 ? 'installed' : 'older';
      }
      return { ...r, state };
    });
    const releases = mark(cache.releases.filter((r) => !isWeb(r)), parseVersion(version));
    const webReleases = mark(cache.releases.filter(isWeb), parseVersion(webVersion))
      .map((r) => {
        const need = r.requires || null;
        const container = webUpdate.baseVersion(version);
        const fits = !need || (need.ipc === ipcVersion && (!need.minContainer || !container || !webUpdate.newer(need.minContainer, container)));
        return { ...r, compatible: fits, needsContainer: need && need.minContainer && !fits ? need.minContainer : null, installable: fits && isInstallable(r), assets: undefined };
      });
    const newer = releases.filter((r) => r.state === 'newer');
    const webNewer = webReleases.filter((r) => r.state === 'newer');
    return {
      enabled: isEnabled(),
      current: version,
      localBuild: /\+|dev/.test(String(version)),
      checkedAt: cache.checkedAt,
      error: cache.error,
      updateAvailable: newer.length ? newer[0].tag : null,
      releases,
      web: { current: webVersion, available: webNewer.length ? webNewer[0].tag : null, releases: webReleases },
    };
  }

  /** The cached release (with its asset links) for an install; never taken from the request. */
  const releaseByTag = (tag) => cache.releases.find((r) => r.tag === tag && isWeb(r)) || null;

  function schedule() {
    clearInterval(timer);
    if (!isEnabled()) return;
    const due = !cache.checkedAt || Date.now() - cache.checkedAt > 20 * 3600e3;
    if (due) setTimeout(() => isEnabled() && check(), 5000).unref();
    timer = setInterval(() => isEnabled() && check(), 24 * 3600e3);
    timer.unref();
  }

  schedule();
  return { check, status, schedule, releaseByTag, setWebVersion: (v) => { webVersion = v; } };
}

module.exports = { create, parseVersion, compare };
