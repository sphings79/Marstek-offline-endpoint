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
const crypto = require('crypto');
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

// Diagnostic passthrough, off by default.
//
// Set PROXY_TIME_IP to the real endpoint's address and the *time* request is
// forwarded there and its answer returned to the device byte for byte -- status
// line, headers and body exactly as received, with no rewriting by Node. That
// is the point: it answers whether the device behaves differently when the
// reply is genuine, which no amount of imitation can settle.
//
// The telemetry upload is NEVER proxied. It stays local, always. What leaves
// the LAN in this mode is the time GET alone, which carries the device id and
// the firmware versions -- no measurements.
//
// An address rather than a hostname on purpose: this container is what the
// device's DNS points at, so resolving the name here would loop straight back.
// Find the real one from a machine that is not using your rewrite:
//   curl -s -H 'accept: application/dns-json' \
//        'https://1.1.1.1/dns-query?name=eu.hamedata.com&type=A'
const PROXY_TIME_IP = process.env.PROXY_TIME_IP || '';
const PROXY_TIME_HOST = process.env.PROXY_TIME_HOST || 'eu.hamedata.com';
const PROXY_TIME_PORT = Number(process.env.PROXY_TIME_PORT || 80);
const PROXY_TIME_MS = Number(process.env.PROXY_TIME_MS || 8000);


/** Build a reply byte for byte the way the real endpoint does.
 *
 *  Captured from eu.hamedata.com on 2026-08-25, proxied through this container:
 *
 *    HTTP/1.1 200 OK\r\n
 *    Date: Tue, 25 Aug 2026 20:05:42 GMT\r\n
 *    Content-Type: text/html; charset=utf-8\r\n
 *    Transfer-Encoding: chunked\r\n
 *    Connection: keep-alive\r\n
 *    Trace-Id: 1439e17e1325cf18e7cffa2adba9ea8d\r\n
 *    \r\n
 *    1d\r\n_2026_08_25_22_05_42_04_0_0_0\r\n0\r\n\r\n
 *
 *  This is assembled by hand instead of through res.writeHead/res.end because
 *  Node adds "Keep-Alive: timeout=5", which the real endpoint does not send, and
 *  orders the headers differently. With Node's framing the device retried four
 *  times and gave up; proxying the genuine answer through, it accepted on the
 *  first try. Rather than guess which detail mattered, this reproduces all of
 *  them. Measured, not assumed -- do not "simplify" it back to res.end().
 */
function rawReply(contentType, body, extraHeaders = '') {
  const b = Buffer.from(body, 'latin1');
  const head =
    'HTTP/1.1 200 OK\r\n' +
    `Date: ${new Date().toUTCString()}\r\n` +
    `Content-Type: ${contentType}\r\n` +
    'Transfer-Encoding: chunked\r\n' +
    'Connection: keep-alive\r\n' +
    `Trace-Id: ${crypto.randomBytes(16).toString('hex')}\r\n` +
    extraHeaders +
    '\r\n';
  return Buffer.concat([
    Buffer.from(head, 'latin1'),
    Buffer.from(`${b.length.toString(16)}\r\n`, 'latin1'),
    b,
    Buffer.from('\r\n0\r\n\r\n', 'latin1'),
  ]);
}

/** The upload host sits behind a Kong API gateway and adds these on top of the
 *  headers the time endpoint sends. Captured 2026-08-25 with a POST carrying an
 *  empty body, which the gateway answered
 *  {"code":51,"message":"The d field is required","data":null}.
 *
 *  They look inconsequential. So did the two headers that separated a working
 *  time reply from a rejected one, which is exactly why they are reproduced. */
function kongHeaders() {
  return (
    'vary: Origin\r\n' +
    'Access-Control-Allow-Credentials: true\r\n' +
    'X-Kong-Upstream-Latency: 2\r\n' +
    'X-Kong-Proxy-Latency: 0\r\n' +
    'Via: 1.1 kong/3.9.1\r\n' +
    `X-Kong-Request-Id: ${crypto.randomBytes(16).toString('hex')}\r\n` +
    'Strict-Transport-Security: max-age=31536000; includeSubDomains\r\n'
  );
}

/** Write a raw reply and deal with the connection afterwards.
 *
 *  The two transports need opposite things, and both are read out of firmware.
 *
 *  Plain HTTP (the time endpoint) is read by HTTPS_POST_ReceiveResponseData
 *  (0x08015744), which stops as soon as the buffer ends in CR LF and roughly a
 *  second has passed with nothing arriving. The real endpoint answers
 *  keep-alive and leaves the connection up, so this does the same and only
 *  reaps the socket afterwards to avoid leaking it.
 *
 *  TLS (the telemetry upload) is read by mbedTLS_SSL_Recv_WithRetry
 *  (0x08015914), and that loop has no such condition. Its only early exit with
 *  data is mbedTLS_SSL_Read returning 0xFFFF8780 -- MBEDTLS_ERR_SSL_PEER_CLOSE_
 *  NOTIFY. Absent that the device sits out its full 20 s timeout on every
 *  upload -- and the real endpoint does exactly that: a raw capture on
 *  2026-08-25 showed it answering keep-alive and never closing, so a 20 s wait
 *  per upload is normal and not a fault to fix.
 *
 *  What must not happen is cutting the connection while the device is still in
 *  that loop. Any error other than WANT_READ/WANT_WRITE is returned as the
 *  result, discarding the bytes already received, and the caller then stores it
 *  as a length -- so a hard reset at six seconds had llhttp parsing tens of
 *  thousands of bytes out of a 3 KB buffer. Guaranteed parse failure, which is
 *  return code -10, which is the error branch in FUN_08015bd0 where count is
 *  never decremented.
 *
 *  So: hold the connection well past the device's own timeout, then end it
 *  cleanly. Never destroy() it.
 */
function sendRaw(res, buf) {
  res.socket.write(buf);
  // 25 s: past the firmware's 20 s receive timeout, so the shutdown can never
  // land mid-read. end() is a clean close (close_notify on TLS), not destroy().
  setTimeout(() => res.socket && !res.socket.destroyed && res.socket.end(), 25000);
}

/** Fetch the time endpoint upstream over plain HTTP and hand back the raw
 *  bytes. Deliberately a bare socket: an http.request would re-encode the
 *  response and destroy the very detail under investigation. */
function proxyTime(url, done) {
  const started = Date.now();
  const chunks = [];
  let size = 0;
  let settled = false;

  const finish = (reason) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    upstream.destroy();
    done(Buffer.concat(chunks), reason, Date.now() - started);
  };

  const upstream = net.connect(PROXY_TIME_PORT, PROXY_TIME_IP);
  const timer = setTimeout(() => finish('timeout'), PROXY_TIME_MS);

  upstream.on('connect', () =>
    upstream.write(`GET ${url} HTTP/1.1\r\nHost: ${PROXY_TIME_HOST}\r\n\r\n`)
  );

  upstream.on('data', (c) => {
    chunks.push(c);
    size += c.length;
    if (size > MAX_BODY) return finish('too big');
    const buf = Buffer.concat(chunks);
    const head = buf.indexOf('\r\n\r\n');
    if (head < 0) return;
    const headers = buf.subarray(0, head).toString('latin1').toLowerCase();
    if (headers.includes('transfer-encoding: chunked')) {
      if (buf.subarray(head).includes('\r\n0\r\n\r\n')) finish('complete');
    } else {
      const m = headers.match(/content-length:\s*(\d+)/);
      if (m && buf.length - (head + 4) >= Number(m[1])) finish('complete');
    }
  });

  upstream.on('error', (e) => finish(`error: ${e.message}`));
  upstream.on('close', () => finish('upstream closed'));
}

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

// The real server answers in the device's LOCAL time, not UTC. Measured
// 2026-08-25 by proxying a genuine reply through this container: its Date header
// read "Tue, 25 Aug 2026 20:05:42 GMT" while the body read
// _2026_08_25_22_05_42_04_0_0_0 -- two hours ahead, i.e. CEST.
//
// An earlier capture appeared to be UTC, but that request went out with a
// made-up uid; the service most likely did not know which device, and therefore
// which timezone, was asking. With the real uid it answers local time.
//
// So local is the default. Set TZ for the container (e.g. TZ=Europe/Berlin) --
// without it the container's local time IS UTC and you gain nothing. Set
// TIME_LOCAL=0 to force UTC.
const TIME_LOCAL = process.env.TIME_LOCAL !== '0';

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

      if (isTime && PROXY_TIME_IP) {
        proxyTime(req.url, (raw, reason, ms) => {
          if (raw.length) {
            // Verbatim, straight onto the socket. Going through res.writeHead
            // and res.end would let Node re-frame the reply, which is exactly
            // the detail this mode exists to preserve.
            res.socket.write(raw);
            // The real endpoint answers keep-alive and leaves the connection
            // up, so do the same rather than closing early -- but do not leak
            // the socket either.
            setTimeout(() => res.socket && res.socket.destroy(), 6000);
          } else {
            // Upstream unreachable. Answer locally rather than leave the device
            // waiting out its 20 s timeout.
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(timeResponse());
          }
          logRequest({
            ts: new Date().toISOString(),
            scheme,
            kind: 'proxy-time',
            url: req.url,
            upstream: `${PROXY_TIME_IP}:80`,
            reason,
            ms,
            bytes: raw.length,
            raw: raw.toString('latin1'),
          });
          console.log(
            `${stamp()} PROXY  ${scheme} ${PROXY_TIME_IP} ${reason} ` +
              `${ms} ms, ${raw.length} B${raw.length ? '' : ' -> answered locally'}`
          );
        });
        return;
      }

      if (isTime) {
        // Byte-for-byte as the real endpoint answers -- see rawReply().
        sendRaw(res, rawReply('text/html; charset=utf-8', timeResponse()));
      } else if (accept) {
        // "code":0 is what FUN_0801774c looks for. The shape mirrors the real
        // endpoint, which answers e.g. {"code":51,"message":"...","data":null}
        // when a request is rejected.
        //
        // Same framing as the time reply. That much is an extrapolation: the
        // upload host was never captured raw, so this assumes it runs on the
        // same stack as eu.hamedata.com.
        //
        // The connection handling, though, is not a guess and is not shared.
        // This path is TLS, and the firmware reads it with
        // mbedTLS_SSL_Recv_WithRetry (0x08015914), whose only early exit is a
        // close_notify from us -- see sendRaw().
        sendRaw(
          res,
          rawReply(
            'application/json',
            '{"code":0,"message":"success","data":null}',
            kongHeaders()
          )
        );
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
  PROXY_TIME_IP
    ? `time endpoint PROXIED to ${PROXY_TIME_IP}:${PROXY_TIME_PORT} ` +
      `(Host: ${PROXY_TIME_HOST}) -- uploads stay local`
    : ANSWER_TIME
      ? `time endpoint answered:   ${TIME_PATH}  -> ${timeResponse()}`
      : 'time endpoint answered:   no (ANSWER_TIME=0)'
);
console.log(`accept everything: ${ACCEPT_ALL ? 'yes (ACCEPT_ALL=1)' : 'no'}`);
console.log(`logs: ${LOG_DIR}`);
