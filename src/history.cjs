'use strict';
/**
 * Event history for the web interface, read straight from the daily request logs
 * (requests-YYYY-MM-DD.jsonl). Nothing is kept in memory: a lookup scans the day
 * files that cover the range and skips most lines with a plain substring test
 * before it parses anything, so a month of three devices stays well under a second.
 */
const fs = require('fs');
const path = require('path');

const RANGES = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3, all: Infinity };
const FILE = /^requests-(\d{4})-(\d\d)-(\d\d)\.jsonl$/;

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * @param {string} dataDir
 * @param {string[]} uids   the device id and everything merged into it
 * @param {'upload'|'time'} kind
 * @param {string} range    one of RANGES
 * @returns {{ts:number, bytes:number|null}[]} oldest first
 */
function events(dataDir, uids, kind, range) {
  const span = RANGES[range] ?? RANGES['24h'];
  const since = span === Infinity ? 0 : Date.now() - span;
  const needles = uids.map((u) => (kind === 'upload' ? `/venus/${u}` : `uid=${u}`));
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(dataDir).filter((f) => FILE.test(f)).sort();
  } catch {
    return out;
  }
  for (const f of files) {
    const [, y, mo, d] = FILE.exec(f);
    // a file holds one UTC day; skip the ones that end before the range starts
    if (Date.UTC(Number(y), Number(mo) - 1, Number(d)) + 86400e3 < since) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(dataDir, f), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line || !needles.some((n) => line.includes(n))) continue;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (!r.accepted || !r.url || r.kind) continue;
      const isUpload = /^\/data-upload\/v1\/venus\//.test(r.url);
      const isTime = /\/getDateInfo/.test(r.url);
      if ((kind === 'upload' && !isUpload) || (kind === 'time' && !isTime)) continue;
      const ts = Date.parse(r.ts);
      if (!ts || ts < since) continue;
      out.push({ ts, bytes: typeof r.headers?.['content-length'] === 'string' ? Number(r.headers['content-length']) : null });
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** Newest first, with the gap to the previous event, plus summary figures for the whole range. */
function page(list, offset, limit, expectedS) {
  const gapsS = [];
  const rows = list.map((e, i) => {
    const gapS = i > 0 ? Math.round((e.ts - list[i - 1].ts) / 1000) : null;
    if (gapS !== null) gapsS.push(gapS);
    return { ts: e.ts, bytes: e.bytes, gapS };
  });
  const med = median(gapsS);
  const base = expectedS || med || 300;
  return {
    total: rows.length,
    events: rows.reverse().slice(offset, offset + limit),
    stats: {
      count: rows.length,
      medianGapS: med,
      maxGapS: gapsS.length ? Math.max(...gapsS) : null,
      // gaps of more than twice the usual spacing: an upload or request that never arrived
      missed: gapsS.filter((g) => g > base * 2).length,
    },
  };
}

/** Day files of one kind, oldest first, skipping the ones that end before `since`. */
function dayFiles(dataDir, prefix, since) {
  let names = [];
  try {
    names = fs.readdirSync(dataDir);
  } catch {
    return [];
  }
  const re = new RegExp(`^${prefix}(\\d{4})-(\\d\\d)-(\\d\\d)\\.jsonl$`);
  const out = [];
  for (const f of names) {
    const m = re.exec(f);
    if (!m) continue;
    if (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + 86400e3 < since) continue;
    out.push(f);
  }
  return out.sort();
}

function sinceOf(range) {
  const span = RANGES[range] ?? RANGES['24h'];
  return span === Infinity ? 0 : Date.now() - span;
}

/**
 * Outages and watched periods from the ping logs of a device (and everything merged into it).
 * @returns {{outages:{start:number,end:number|null}[], watched:{start:number,end:number|null}[]}}
 */
function pingHistory(dataDir, uids, range) {
  const since = sinceOf(range);
  const evs = [];
  for (const uid of uids) {
    for (const f of dayFiles(dataDir, `ping-${uid}-`, since)) {
      let text;
      try {
        text = fs.readFileSync(path.join(dataDir, f), 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const r = JSON.parse(line);
          const ts = Date.parse(r.ts);
          if (ts) evs.push({ ts, ev: r.ev });
        } catch {
          /* skip a damaged line */
        }
      }
    }
  }
  evs.sort((a, b) => a.ts - b.ts);
  const outages = [];
  const watched = [];
  let openOutage = null;
  let openWatch = null;
  for (const e of evs) {
    if (e.ev === 'start') openWatch = openWatch ?? e.ts;
    else if (e.ev === 'stop') {
      if (openWatch !== null) watched.push({ start: openWatch, end: e.ts });
      openWatch = null;
      if (openOutage !== null) { outages.push({ start: openOutage, end: e.ts }); openOutage = null; }
    } else if (e.ev === 'down') openOutage = openOutage ?? e.ts;
    else if (e.ev === 'up' && openOutage !== null) { outages.push({ start: openOutage, end: e.ts }); openOutage = null; }
  }
  if (openWatch !== null) watched.push({ start: openWatch, end: null });
  if (openOutage !== null) outages.push({ start: openOutage, end: null });
  const clip = (list) => list.filter((x) => (x.end ?? Date.now()) >= since);
  return { outages: clip(outages), watched: clip(watched) };
}

/** Handshake times and TLS errors of the connections that came from one address. */
function connectionHistory(dataDir, ip, range) {
  const since = sinceOf(range);
  const handshakes = [];
  const tlsErrors = [];
  if (!ip) return { handshakes, tlsErrors };
  const needle = ip;
  for (const f of dayFiles(dataDir, 'requests-', since)) {
    let text;
    try {
      text = fs.readFileSync(path.join(dataDir, f), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line || !line.includes(needle) || (!line.includes('"connection"') && !line.includes('"tls-error"'))) continue;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (String(r.remote || '').replace(/^::ffff:/, '') !== ip) continue;
      const ts = Date.parse(r.ts);
      if (!ts || ts < since) continue;
      if (r.kind === 'connection' && typeof r.handshakeMs === 'number') handshakes.push({ ts, ms: r.handshakeMs });
      if (r.kind === 'tls-error') tlsErrors.push({ ts, code: r.code });
      else if (r.kind === 'connection' && r.tlsError) tlsErrors.push({ ts, code: r.tlsError });
    }
  }
  return { handshakes, tlsErrors };
}

module.exports = { events, page, pingHistory, connectionHistory, RANGES, sinceOf };
