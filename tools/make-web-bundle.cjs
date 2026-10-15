#!/usr/bin/env node
'use strict';
/**
 * Builds the three release assets of a web update and signs them.
 *
 *   node tools/make-web-bundle.cjs --key ~/.config/marstek-endpoint/web-signing.key [--out dist]
 *
 * The version and the minimum container version come from web-version.json. Output, in --out:
 *   marstek-endpoint-web-<version>.tar.gz        the files of the web side
 *   marstek-endpoint-web-<version>.manifest.json name, version, requirements, file list, SHA-256 of the archive
 *   marstek-endpoint-web-<version>.manifest.sig  base64 Ed25519 signature over the manifest bytes
 * Upload the three files to a GitHub release tagged web-v<version>. The endpoint verifies the signature with
 * webupdate.pub (the matching public key, part of the image) before it installs anything.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { tarEntry, tarEnd } = require('../support.cjs');

const ROOT = path.join(__dirname, '..');
const IPC_VERSION = 1;
// everything the web process loads from its code root; webproc.cjs, server.cjs, supervisor.cjs and uptime.cjs stay in the image
const MODULES = ['web.cjs', 'auth.cjs', 'devices.cjs', 'history.cjs', 'updates.cjs', 'ping.cjs', 'db.cjs', 'keydefs.cjs', 'notify.cjs', 'mqtt.cjs', 'support.cjs', 'store.cjs', 'logbuf.cjs', 'uptime-history.cjs', 'webupdate.cjs', 'web-version.json'];

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const keyFile = arg('key');
const out = path.resolve(arg('out', path.join(ROOT, 'dist')));
if (!keyFile) { console.error('usage: make-web-bundle.cjs --key <private key file> [--out dir]'); process.exit(2); }

const info = JSON.parse(fs.readFileSync(path.join(ROOT, 'web-version.json'), 'utf8'));
if (arg('version')) info.version = arg('version'); // for tests; a release takes it from web-version.json
if (arg('min-container')) info.minContainer = arg('min-container');
if (!/^\d+\.\d+\.\d+$/.test(info.version)) { console.error('web-version.json: "version" must look like 1.2.3'); process.exit(2); }
const files = [...MODULES];
for (const f of fs.readdirSync(path.join(ROOT, 'web')).sort()) if (fs.statSync(path.join(ROOT, 'web', f)).isFile()) files.push(`web/${f}`);

const now = Date.now();
const parts = files.map((f) => tarEntry(f, fs.readFileSync(path.join(ROOT, f)), now));
const tar = zlib.gzipSync(Buffer.concat([...parts, tarEnd()]), { level: 9 });
const base = `marstek-endpoint-web-${info.version}`;
const manifest = Buffer.from(JSON.stringify({
  name: 'marstek-endpoint-web',
  version: info.version,
  requires: { ipc: IPC_VERSION, minContainer: info.minContainer || null },
  built: new Date(now).toISOString(),
  tar: { file: `${base}.tar.gz`, sha256: crypto.createHash('sha256').update(tar).digest('hex'), size: tar.length },
  files,
}, null, 2));
const sig = crypto.sign(null, manifest, crypto.createPrivateKey(fs.readFileSync(keyFile, 'utf8')));
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, `${base}.tar.gz`), tar);
fs.writeFileSync(path.join(out, `${base}.manifest.json`), manifest);
fs.writeFileSync(path.join(out, `${base}.manifest.sig`), `${sig.toString('base64')}\n`);
console.log(`web ${info.version}: ${files.length} files, ${tar.length} bytes -> ${out}`);
