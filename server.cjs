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
 * It also polls a time endpoint every ~20 s. The real cloud answers it like this
 * (captured 2026-08-25 from eu.hamedata.com, Content-Type text/html):
 *
 *     _2026_08_25_07_23_25_04_0_0_0
 *      ^^^^ ^^ ^^ ^^ ^^ ^^ ^^^^^^^^
 *      year mo dy hh mm ss  constant across calls
 *
 * HTTP_ParseServerDateTime_UpdateRTC finds the underscore and reads fixed
 * offsets from it; the separators themselves are not checked. The four trailing
 * fields do not change while the time does, so they are parameters rather than
 * time values — most likely what HexChar_To_TimeOffsetIndex() reads, which
 * decides whether the device arms a timer or takes an immediate path. They are
 * mirrored verbatim rather than invented.
 *
 * The real server answers in UTC, so this one does too by default.
 *
 * Node core modules only — no dependencies to audit.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
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

// MQTT probe. The device keeps an MQTT session with AWS IoT that this endpoint
// cannot serve — that path verifies the server certificate against a CA in flash
// (mbedTLS_SSL_Conf_Authmode(conf, 2)) and presents a client certificate, so it
// cannot be answered without the AWS signing key. What this listener does is
// narrower and purely diagnostic: point the broker's hostname here, and every
// connection attempt gets logged with a timestamp. If those attempts line up
// with dropouts you are seeing, the MQTT path is what causes them.
//
// Set MQTT_PORT=0 to switch it off.
const MQTT_PORT = Number(process.env.MQTT_PORT ?? 8883);

/** Best-effort SNI from a TLS ClientHello, so the log names the host the device
 *  asked for. Returns null for anything that is not a parseable ClientHello. */
function sniFromClientHello(buf) {
  try {
    if (buf.length < 45 || buf[0] !== 0x16) return null; // not a TLS handshake
    let p = 5; // skip record header
    if (buf[p] !== 0x01) return null; // not ClientHello
    p += 4 + 2 + 32; // handshake header, version, random
    p += 1 + buf[p]; // session id
    p += 2 + buf.readUInt16BE(p); // cipher suites
    p += 1 + buf[p]; // compression methods
    if (p + 2 > buf.length) return null;
    const extEnd = p + 2 + buf.readUInt16BE(p);
    p += 2;
    while (p + 4 <= Math.min(extEnd, buf.length)) {
      const type = buf.readUInt16BE(p);
      const len = buf.readUInt16BE(p + 2);
      if (type === 0x0000) {
        // server_name: list length, name type, name length, name
        const nameLen = buf.readUInt16BE(p + 7);
        return buf.toString('utf8', p + 9, p + 9 + nameLen);
      }
      p += 4 + len;
    }
  } catch {
    /* malformed — fall through */
  }
  return null;
}

// The time endpoint. Answering it sets the device's RTC — which is a real change
// to the device, so it can be switched off. On by default: without a cloud the
// battery has no other time source, and a drifting clock is the worse outcome.
const ANSWER_TIME = process.env.ANSWER_TIME !== '0';
const TIME_PATH = /\/getDateInfo/;

/** Local wall-clock stamp for the console, so it lines up with the rest of your
 *  logs. The JSONL keeps ISO-8601 UTC, which stays unambiguous for machines. */
function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ` +
    `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
  );
}

// Trailing fields, copied from a real cloud response. Constant across calls, and
// what they mean is unknown — so they are mirrored rather than guessed at.
const TIME_SUFFIX = process.env.TIME_SUFFIX ?? '04_0_0_0';

// The real server answers in UTC. Set TIME_LOCAL=1 to serve this machine's local
// time instead, if you would rather have the battery's clock and its schedules
// run on wall-clock time.
const TIME_LOCAL = process.env.TIME_LOCAL === '1';

/** The time string in exactly the shape the real endpoint returns. */
function timeResponse(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const [y, mo, d, h, mi, s] = TIME_LOCAL
    ? [now.getFullYear(), now.getMonth() + 1, now.getDate(),
       now.getHours(), now.getMinutes(), now.getSeconds()]
    : [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(),
       now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()];
  return `_${y}_${p(mo)}_${p(d)}_${p(h)}_${p(mi)}_${p(s)}_${TIME_SUFFIX}`;
}

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
      const isTime = ANSWER_TIME && TIME_PATH.test(req.url || '');
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
        httpVersion: req.httpVersion,
        host: req.headers.host || null,
        url: req.url,
        remote: req.socket.remoteAddress,
        headers: req.headers,
        truncated: tooBig || undefined,
        accepted: accept || isTime,
        answeredWith: isTime ? 'time' : accept ? 'code0' : undefined,
        body,
      });

      const tag = isTime ? 'TIME  ' : accept ? 'ACCEPT' : 'log   ';
      console.log(
        `${stamp()} ${tag} ${scheme} ${req.method} ` +
          `${req.headers.host || '-'}${req.url} from ${req.socket.remoteAddress} ` +
          `(${size} B)`
      );

      if (isTime) {
        // Framing matters here, and it is copied from a raw capture of the real
        // endpoint (2026-08-25). It answers chunked, with keep-alive and no
        // Content-Length, so the response ends with the terminating chunk
        // "0\r\n\r\n".
        //
        // That trailing CRLF is the point. HTTPS_POST_ReceiveResponseData
        // (0x08015744) only leaves its receive loop early when data has
        // arrived, 21 consecutive polls came back empty, AND the last two bytes
        // in the buffer are CR LF. With a Content-Length reply ending in "0"
        // the loop never exited early: it sat out the full timeout that
        // Cloud_Report_URL_Builder(1, 0x14) passes -- 20 s -- and the firmware
        // gave up after four tries, so the clock was never set.
        //
        // Omitting Content-Length is what makes Node chunk it. Do not "fix"
        // that by adding the header back.
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(timeResponse());
      } else if (accept) {
        // "code":0 is what FUN_0801774c looks for. The shape mirrors the real
        // endpoint, which answers e.g. {"code":51,"message":"...","data":null}
        // when a request is rejected.
        // Chunked for the same reason as the time reply -- see above. The
        // upload host was not captured raw, so this mirrors the framing that is
        // known to work rather than inventing a second variant.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"code":0,"message":"success","data":null}');
      } else {
        // Headers alone already end with CRLF CRLF, so the receive loop is
        // satisfied without a body.
        res.writeHead(404, { 'Content-Length': 0 });
        res.end();
      }
    });
  };
}

if (MQTT_PORT > 0) {
  net
    .createServer((socket) => {
      const remote = socket.remoteAddress;
      const chunks = [];
      let size = 0;

      const finish = (reason) => {
        if (socket.destroyed) return;
        const first = Buffer.concat(chunks);
        const sni = sniFromClientHello(first);
        logRequest({
          ts: new Date().toISOString(),
          scheme: 'mqtt',
          method: 'CONNECT',
          host: sni,
          url: `:${MQTT_PORT}`,
          remote,
          bytes: size,
          hexPrefix: first.subarray(0, 48).toString('hex') || undefined,
          closedBy: reason,
        });
        console.log(
          `${stamp()} MQTT   tcp  CONNECT :${MQTT_PORT} from ${remote} ` +
            `(${size} B${sni ? `, sni ${sni}` : ''})`
        );
        socket.destroy();
      };

      socket.on('data', (chunk) => {
        size += chunk.length;
        if (chunks.length < 8) chunks.push(chunk);
        if (size >= 512) finish('enough-data');
      });
      socket.on('error', () => finish('error'));
      socket.on('end', () => finish('peer-closed'));
      // Do not leave the device hanging: log what came in, then drop it. A fast
      // failure is also the friendlier answer if a stalled handshake is what
      // blocks the device's network stack.
      setTimeout(() => finish('timeout'), 2000).unref();
    })
    .listen(MQTT_PORT, () =>
      console.log(`mqtt  probe listening on :${MQTT_PORT} (log only, no TLS)`)
    );
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
console.log(
  ANSWER_TIME
    ? `time endpoint answered:   ${TIME_PATH}  -> ${timeResponse()}`
    : 'time endpoint answered:   no (ANSWER_TIME=0)'
);
console.log(`accept everything: ${ACCEPT_ALL ? 'yes (ACCEPT_ALL=1)' : 'no'}`);
console.log(`logs: ${LOG_DIR}`);
