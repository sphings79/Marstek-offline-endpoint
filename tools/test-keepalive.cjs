#!/usr/bin/env node
/* Regression test: several requests over one keep-alive connection, as a
 * reverse proxy sends them. Starts src/server.cjs on free ports and checks
 * that every request is answered and the process stays up.
 *   node tools/test-keepalive.cjs
 */
const { spawn, execFileSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const server = path.join(__dirname, '..', 'src', 'server.cjs');
const port = 20000 + Math.floor(Math.random() * 20000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keepalive-'));
// the server reads a key pair at startup even though this test only talks HTTP
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=test',
  '-keyout', path.join(dir, 'server.key'), '-out', path.join(dir, 'server.crt')], { stdio: 'ignore' });
const child = spawn(process.execPath, [server], {
  env: { ...process.env, HTTP_PORT: String(port), HTTPS_PORT: '0', MQTT_PORT: '0', WEB_PORT: '0', LOG_DIR: dir, CERT_DIR: dir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
let exited = false;
child.on('exit', () => (exited = true));

const requests = [
  'GET /app/neng/getDateInfoeu.php?uid=x HTTP/1.1\r\nHost: t\r\n\r\n',
  'POST /data-upload/v1/venus/test HTTP/1.1\r\nHost: t\r\nContent-Type: application/json\r\nContent-Length: 18\r\n\r\n{"d":"sc=50&pb=1"}',
  'GET /something/else HTTP/1.1\r\nHost: t\r\n\r\n',
  'GET /app/neng/getDateInfoeu.php?uid=x HTTP/1.1\r\nHost: t\r\n\r\n',
];

function fail(msg) {
  console.error('FAIL: ' + msg + '\n--- server output ---\n' + out);
  child.kill();
  process.exit(1);
}

function run() {
  const s = net.connect(port, '127.0.0.1');
  let buf = '';
  let answered = 0;
  const next = () => (answered < requests.length ? s.write(requests[answered]) : done());
  s.on('connect', next);
  s.on('data', (d) => {
    buf += d;
    // every reply here ends the header block and has a body of known size or none
    let idx;
    while ((idx = buf.indexOf('\r\n\r\n')) >= 0) {
      const head = buf.slice(0, idx);
      const chunked = /transfer-encoding: chunked/i.test(head);
      const len = Number((/content-length: (\d+)/i.exec(head) || [0, 0])[1]);
      let rest = buf.slice(idx + 4);
      if (chunked) {
        const end = rest.indexOf('0\r\n\r\n');
        if (end < 0) return;
        buf = rest.slice(end + 5);
      } else {
        if (rest.length < len) return;
        buf = rest.slice(len);
      }
      answered++;
      next();
    }
  });
  s.on('error', (e) => fail('socket error ' + e.message));
  setTimeout(() => fail(`only ${answered}/${requests.length} requests answered`), 8000);
  function done() {
    s.destroy();
    setTimeout(() => {
      if (exited) return fail('server process exited');
      console.log(`OK: ${requests.length} requests on one connection answered, server still up`);
      child.kill();
      process.exit(0);
    }, 300);
  }
}

setTimeout(run, 1200);
