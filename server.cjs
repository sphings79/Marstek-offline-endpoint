'use strict';
/**
 * Marstek Local Cloud — answers the telemetry upload the device's watchdog waits for.
 *
 * Why this exists: on firmware v150 the Control firmware buffers telemetry records
 * and hardware-resets its own network chip when the buffer does not drain —
 * every 1800 s on Ethernet, every 900 s on WiFi. During that reset the chip is
 * gone, so Modbus TCP dies and even ping stops. Answering the upload keeps the
 * buffer empty, so the reset never fires and no telemetry leaves the LAN.
 *
 * What the device needs, from the decompiled firmware:
 *   - TLS on port 443, certificate NOT verified (mbedTLS_SSL_Conf_Authmode(conf, 0))
 *   - a response body containing  "code":0   (FUN_0801774c: strstr + atoi)
 * Anything else about the response is not inspected.
 *
 * Node core modules only — no dependencies to audit.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const HTTPS_PORT = Number(process.env.HTTPS_PORT || 443);
const HTTP_PORT = Number(process.env.HTTP_PORT || 80);
const LOG_DIR = process.env.LOG_DIR || '/data';
const CERT_DIR = process.env.CERT_DIR || '/certs';
const MAX_BODY = Number(process.env.MAX_BODY || 256 * 1024);

// The one endpoint the watchdog depends on. Everything else is logged but not
// answered with a success code — pretending to be an endpoint whose expected
// reply we do not know could change device behaviour in ways nobody has tested.
const UPLOAD_PATH = /^\/data-upload\/v1\/venus\//;

// Opt-in: answer every request with {"code":0}. Off by default, deliberately.
const ACCEPT_ALL = process.env.ACCEPT_ALL === '1';

fs.mkdirSync(LOG_DIR, { recursive: true });

function logRequest(record) {
  const day = new Date(record.ts).toISOString().slice(0, 10);
  const file = path.join(LOG_DIR, `requests-${day}.jsonl`);
  fs.appendFile(file, JSON.stringify(record) + '\n', (err) => {
    if (err) console.error('log write failed:', err.message);
  });
}

function handle(scheme) {
  return (req, res) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        tooBig = true;
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const isUpload = UPLOAD_PATH.test(req.url || '');
      const accept = isUpload || ACCEPT_ALL;

      let body = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        /* keep the raw string — the device is not obliged to send JSON */
      }

      logRequest({
        ts: new Date().toISOString(),
        scheme,
        method: req.method,
        host: req.headers.host || null,
        url: req.url,
        remote: req.socket.remoteAddress,
        headers: req.headers,
        truncated: tooBig || undefined,
        accepted: accept,
        body,
      });

      const tag = accept ? 'ACCEPT' : 'log   ';
      console.log(
        `${new Date().toISOString()} ${tag} ${scheme} ${req.method} ` +
          `${req.headers.host || '-'}${req.url} from ${req.socket.remoteAddress} ` +
          `(${size} B)`
      );

      if (accept) {
        // "code":0 is what FUN_0801774c looks for. Nothing else is parsed.
        const payload = Buffer.from('{"code":0,"msg":"ok"}');
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        });
        res.end(payload);
      } else {
        res.writeHead(404, { 'Content-Length': 0 });
        res.end();
      }
    });
  };
}

const key = fs.readFileSync(path.join(CERT_DIR, 'server.key'));
const cert = fs.readFileSync(path.join(CERT_DIR, 'server.crt'));

https
  .createServer(
    {
      key,
      cert,
      // The device pins its TLS min/max version in firmware and the exact values
      // were not resolvable from the image, so accept the whole 1.0–1.2 range.
      // SECLEVEL=0 allows the older cipher suites an mbedTLS build of that
      // vintage offers. This server talks to one embedded client on the LAN and
      // serves nothing worth attacking — but do not expose it to the internet.
      minVersion: 'TLSv1',
      maxVersion: 'TLSv1.2',
      ciphers: 'DEFAULT:@SECLEVEL=0',
    },
    handle('https')
  )
  .listen(HTTPS_PORT, () => console.log(`https listening on :${HTTPS_PORT}`));

// The older hamedata endpoints are plain http. Logged only, so you can see what
// else your device asks for.
http
  .createServer(handle('http'))
  .listen(HTTP_PORT, () => console.log(`http  listening on :${HTTP_PORT}`));

console.log(`upload endpoint answered: ${UPLOAD_PATH}`);
console.log(`accept everything: ${ACCEPT_ALL ? 'yes (ACCEPT_ALL=1)' : 'no'}`);
console.log(`logs: ${LOG_DIR}`);
