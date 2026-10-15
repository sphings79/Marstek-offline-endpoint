'use strict';
/**
 * Reads the endpoint's own availability record (endpoint-YYYY-MM-DD.jsonl, written by uptime.cjs in the
 * main process) and turns it into periods in which the endpoint was off or had no network. Pure reading,
 * so the web interface can use it without owning the record.
 */
const fs = require('fs');
const path = require('path');

const FILE = /^endpoint-(\d{4})-(\d\d)-(\d\d)\.jsonl$/;

/**
 * Periods in which the endpoint was off or had no network, clipped to the range.
 * @returns {{periods:{kind:'off'|'nonet',start:number,end:number,cause:string|null}[], trackedSince:number|null}}
 */
function history(dataDir, sinceMs) {
  const since = sinceMs;
  let files = [];
  try {
    files = fs.readdirSync(dataDir).filter((f) => FILE.test(f)).sort();
  } catch {
    return { periods: [], trackedSince: null };
  }
  const evs = [];
  let trackedSince = null;
  for (const f of files) {
    const [, y, mo, d] = FILE.exec(f);
    let text;
    try {
      text = fs.readFileSync(path.join(dataDir, f), 'utf8');
    } catch {
      continue;
    }
    const endOfDay = Date.UTC(Number(y), Number(mo) - 1, Number(d)) + 86400e3;
    for (const line of text.split('\n')) {
      if (!line) continue;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      const ts = Date.parse(r.ts);
      if (!ts) continue;
      if (r.ev === 'start' && trackedSince === null) trackedSince = ts;
      if (endOfDay < since) continue;
      evs.push({ ...r, ts, from: r.from ? Date.parse(r.from) : null });
    }
  }
  evs.sort((a, b) => a.ts - b.ts);
  const periods = [];
  let netOpen = null;
  const closeNet = (end) => {
    if (netOpen !== null) periods.push({ kind: 'nonet', start: netOpen, end, cause: null });
    netOpen = null;
  };
  for (const e of evs) {
    if (e.ev === 'start') {
      closeNet(e.from || e.ts);
      if (e.prev !== 'none' && e.from && e.from < e.ts) periods.push({ kind: 'off', start: e.from, end: e.ts, cause: e.prev === 'crash' ? 'crash' : 'restart' });
    } else if (e.ev === 'stop') closeNet(e.ts);
    else if (e.ev === 'net_down') netOpen = netOpen ?? e.ts;
    else if (e.ev === 'net_up') {
      if (netOpen !== null) closeNet(e.ts);
      else periods.push({ kind: 'nonet', start: Math.max(since, trackedSince || since), end: e.ts, cause: null });
    }
  }
  if (netOpen !== null) closeNet(Date.now());
  const clipped = periods
    .filter((p) => p.end > since)
    .map((p) => ({ ...p, start: Math.max(p.start, since) }))
    .sort((a, b) => a.start - b.start);
  return { periods: clipped, trackedSince };
}

module.exports = { history };
