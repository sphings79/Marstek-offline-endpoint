'use strict';
/**
 * The last console lines of the endpoint, kept in memory for the support package.
 * A container does not know its own `docker logs`, so the endpoint remembers its
 * output itself. Never holds the one-time setup code.
 */
const util = require('util');

const MAX = 4000;
const lines = [];

let onLine = null;

function push(line) {
  const s = String(line);
  if (/SETUP CODE/.test(s)) return;
  lines.push(s);
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
}

/**
 * Mirror console.log and console.error into the buffer, unchanged otherwise. `forward`, if given, also gets
 * every line: the main process hands its lines to the web process this way, which keeps the support
 * package's console log complete although the web interface runs in a process of its own.
 */
function capture(forward) {
  onLine = forward || null;
  for (const name of ['log', 'error']) {
    const original = console[name].bind(console);
    console[name] = (...args) => {
      const line = util.format(...args);
      push(line);
      if (onLine && !/SETUP CODE/.test(line)) onLine(line);
      original(...args);
    };
  }
}

module.exports = { capture, push, dump: () => [...lines], setForward: (fn) => { onLine = fn; } };
