'use strict';
/* Web interface of the Marstek Offline Endpoint. Plain DOM, no framework. Every
   piece of text from the server goes through textContent, never innerHTML, so a
   device name or a log value can not inject markup. */
(() => {
  const ICONS = {
    lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
    key: 'M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
    tune: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
    battery: 'M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z',
    logout: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
    storage: 'M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm-4 7h20v-4H2v4zm2-3h2v2H4v-2z',
    shield: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z',
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    upload: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
    star: 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z',
    coffee: 'M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z',
    menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    bell: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
    upload: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
    check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    system: 'M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z',
    light: 'M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z',
    dark: 'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z',
    theme: 'M20 8.69V4h-4.69L12 .69 8.69 4H4v4.69L.69 12 4 15.31V20h4.69L12 23.31 15.31 20H20v-4.69L23.31 12 20 8.69zM12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm0-10v8c2.21 0 4-1.79 4-4s-1.79-4-4-4z',
    refresh: 'M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    folder: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
    lan: 'M13 22h8v-7h-3v-4h-5V9h3V2H8v7h3v2H6v4H3v7h8v-7H8v-2h8v2h-3v7z',
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function icon(name, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', cls || 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', ICONS[name] || ICONS.info);
    svg.appendChild(p);
    return svg;
  }

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => {
      if (Array.isArray(c)) c.forEach(add);
      else if (c === null || c === undefined || c === false) return;
      else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    };
    children.forEach(add);
    return el;
  }

  /** An iOS-style switch: a checkbox underneath (keyboard and screen reader work), announced as a switch. */
  function toggleSwitch(id, checked) {
    const box = h('input', { type: 'checkbox', id, class: 'switch', role: 'switch' });
    box.checked = !!checked;
    box.setAttribute('aria-checked', String(!!checked));
    box.addEventListener('change', () => box.setAttribute('aria-checked', String(box.checked)));
    return box;
  }

  // --- state, language ---------------------------------------------------------
  const state = { lang: 'en', session: null, timer: null, flash: null };
  try {
    const saved = localStorage.getItem('mep_lang');
    state.lang = saved && window.I18N[saved] ? saved : (navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
  } catch {
    state.lang = (navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
  }

  function lookup(lang, path) {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), window.I18N[lang]);
  }
  function t(path, vars) {
    let s = lookup(state.lang, path);
    if (s === undefined) s = lookup('en', path);
    if (s === undefined) return path;
    for (const [k, v] of Object.entries(vars || {})) s = s.replace(`{${k}}`, v);
    return s;
  }
  function errText(data) {
    const e = data && data.error;
    if (e === 'locked') return t('err.locked', { s: data.retryAfter || '?' });
    return lookup(state.lang, `err.${e}`) !== undefined ? t(`err.${e}`) : t('err.generic');
  }

  // --- formatting --------------------------------------------------------------
  const num = (n, digits = 0) => Number(n).toLocaleString(state.lang, { maximumFractionDigits: digits });
  function duration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return `${s} ${t('units.s')}`;
    if (s < 3600) return `${Math.floor(s / 60)} ${t('units.min')}`;
    if (s < 86400) {
      const m = Math.floor((s % 3600) / 60);
      return `${Math.floor(s / 3600)} ${t('units.h')}${m ? ` ${m} ${t('units.min')}` : ''}`;
    }
    const hh = Math.floor((s % 86400) / 3600);
    return `${Math.floor(s / 86400)} ${t('units.d')}${hh ? ` ${hh} ${t('units.h')}` : ''}`;
  }
  const ago = (ms, now) => t('ago', { x: duration((now - ms) / 1000) });
  const clock = (ms) => new Date(ms).toLocaleString(state.lang, { dateStyle: 'short', timeStyle: 'medium' });
  /** "from – to"; the end shows only the time when it is the same day, and "ongoing" when there is none. */
  function span(start, end) {
    if (end === null || end === undefined) return `${clock(start)} – ${t('devices.ongoing')}`;
    const a = new Date(start), b = new Date(end);
    const sameDay = a.toDateString() === b.toDateString();
    return `${clock(start)} – ${sameDay ? b.toLocaleTimeString(state.lang, { timeStyle: 'medium' }) : clock(end)}`;
  }
  function bytes(n) {
    if (n < 1024) return `${num(n)} ${t('units.b')}`;
    if (n < 1024 * 1024) return `${num(n / 1024, 1)} ${t('units.kb')}`;
    return `${num(n / 1024 / 1024, 1)} ${t('units.mb')}`;
  }
  // The last digits of the ids are identical on these devices, so the address is the default label.
  const verLabel = (v) => (/^v/i.test(String(v)) ? String(v) : `v ${v}`);
  const shortName = (d) => d.name || (d.ip ? `Marstek ${d.ip}` : `Marstek ${String(d.uid).slice(0, 6)}…`);
  const maskedId = (uid) => `${String(uid).slice(0, 6)}…`;

  // Release notes are markdown. Only headings, bullets, **bold** and `code` are drawn;
  // links and images are reduced to their text, anything else stays literal text.
  function mdInline(text) {
    const out = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(m[0].startsWith('**') ? h('strong', { text: m[0].slice(2, -2) }) : h('code', { text: m[0].slice(1, -1) }));
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  function md(text) {
    const clean = String(text || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    const wrap = h('div', { class: 'md' });
    let ul = null;
    let para = [];
    let fence = null;
    let table = null;
    // release notes are hard-wrapped: consecutive lines belong to one paragraph, a blank line ends it
    const flush = () => {
      if (para.length) wrap.appendChild(h('p', {}, mdInline(para.join(' '))));
      para = [];
    };
    const flushTable = () => {
      if (!table) return;
      const rows = table.filter((r) => !/^[\s|:-]+$/.test(r)).map((r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()));
      const [head, ...body] = rows;
      if (head) {
        wrap.appendChild(h('div', { class: 'tablewrap' }, h('table', { class: 'list mdtable' },
          h('thead', {}, h('tr', {}, head.map((c) => h('th', {}, mdInline(c))))),
          h('tbody', {}, body.map((r) => h('tr', {}, r.map((c) => h('td', {}, mdInline(c)))))))));
      }
      table = null;
    };
    for (const raw of clean.split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (/^\s*```/.test(line)) {
        if (fence === null) { flush(); flushTable(); ul = null; fence = []; }
        else { wrap.appendChild(h('pre', { class: 'code', text: fence.join('\n') })); fence = null; }
        continue;
      }
      if (fence !== null) { fence.push(raw); continue; }
      if (/^\s*\|/.test(line)) { flush(); ul = null; (table = table || []).push(line); continue; }
      flushTable();
      const li = /^\s*[-*]\s+(.*)$/.exec(line);
      if (li) {
        flush();
        if (!ul) { ul = h('ul'); wrap.appendChild(ul); }
        ul.appendChild(h('li', {}, mdInline(li[1])));
        continue;
      }
      ul = null;
      const hd = /^#{1,6}\s+(.*)$/.exec(line);
      if (hd) { flush(); wrap.appendChild(h('h4', {}, mdInline(hd[1]))); }
      else if (!line.trim() || /^[-=_*]{3,}$/.test(line.trim())) flush();
      else para.push(line.trim());
    }
    if (fence !== null) wrap.appendChild(h('pre', { class: 'code', text: fence.join('\n') }));
    flush();
    flushTable();
    return wrap;
  }

  // --- api ---------------------------------------------------------------------
  async function api(path, body) {
    const opts = { credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      if (state.session && state.session.csrf) opts.headers['X-CSRF-Token'] = state.session.csrf;
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(`api/${path}`, opts);
    } catch {
      return { status: 0, data: { error: 'generic' } };
    }
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    if (res.status === 401 && data.error === 'unauthenticated' && state.session) {
      state.session.authenticated = false;
      state.session.csrf = null;
      render();
    }
    return { status: res.status, data };
  }
  async function loadSession() {
    const { data } = await api('session');
    state.session = data;
  }

  // --- building blocks ---------------------------------------------------------
  function card(color, ic, title, body, headerExtra) {
    return h('section', { class: `card c-${color}` }, h('header', {}, h('div', { class: 't' }, icon(ic), h('span', { text: title })), headerExtra || null), h('div', { class: 'body' }, body));
  }
  /** Label/value rows. `stack`: the value goes on its own line below the label (for long values). */
  function kv(rows, opts) {
    return h('dl', { class: `kv${opts && opts.stack ? ' stack' : ''}` }, rows.filter(Boolean).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  }
  function field(label, input, help, err) {
    return h('div', { class: `field${err ? ' err' : ''}` }, h('label', { text: label }), input, h('div', { class: 'help', text: help || '' }));
  }
  const alert = (kind, text) => h('div', { class: `alert ${kind}`, role: kind === 'error' ? 'alert' : null, text });
  function flash() {
    const f = state.flash;
    state.flash = null;
    return f ? alert(f.kind, f.text) : null;
  }

  // --- login / claim -----------------------------------------------------------
  function forgotBlock() {
    const box = h('div', { class: 'forgot', hidden: true },
      h('h4', { text: t('auth.forgotTitle') }),
      h('p', { text: t('auth.forgotIntro') }),
      h('p', { text: t('auth.forgotStep1') }),
      h('pre', { class: 'code', text: 'docker exec <container> rm /data/auth.json' }),
      h('p', { text: t('auth.forgotStep2') }),
      h('pre', { class: 'code', text: 'docker logs <container> 2>&1 | grep SETUP' }),
      h('p', { class: 'small muted', text: t('auth.forgotNote') }));
    const link = h('button', { class: 'linkbtn', type: 'button', text: t('auth.forgot'), on: { click: () => { box.hidden = !box.hidden; } } });
    return h('div', { class: 'forgot-wrap' }, link, box);
  }

  function loginView() {
    const claiming = !state.session.claimed;
    const min = state.session.minLength || 8;
    const code = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', autofocus: claiming });
    const pw = h('input', { type: 'password', autocomplete: claiming ? 'new-password' : 'current-password', autofocus: !claiming });
    const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const msg = h('div', {});
    const btn = h('button', { class: 'btn big', type: 'submit', text: t(claiming ? 'auth.setPassword' : 'auth.unlock') });
    const helpPw = h('div', { class: 'help' });
    const helpPw2 = h('div', { class: 'help' });
    const wPw = h('div', { class: 'field' }, h('label', { text: t('auth.password') }), pw, helpPw);
    const wPw2 = h('div', { class: 'field' }, h('label', { text: t('auth.repeat') }), pw2, helpPw2);

    function validate() {
      const short = pw.value.length > 0 && pw.value.length < min;
      const mismatch = claiming && pw2.value.length > 0 && pw.value !== pw2.value;
      wPw.classList.toggle('err', short);
      helpPw.textContent = short ? t('auth.tooShort', { n: min }) : '';
      wPw2.classList.toggle('err', mismatch);
      helpPw2.textContent = mismatch ? t('auth.mismatch') : '';
      btn.disabled = pw.value.length < min || (claiming && (pw.value !== pw2.value || !code.value.trim()));
    }
    [pw, pw2, code].forEach((i) => i.addEventListener('input', validate));
    validate();

    const form = h('form', {
      on: {
        submit: async (e) => {
          e.preventDefault();
          if (btn.disabled) return;
          btn.disabled = true;
          btn.textContent = t('auth.wait');
          msg.replaceChildren();
          const { status, data } = await api(claiming ? 'claim' : 'login', claiming ? { password: pw.value, code: code.value } : { password: pw.value });
          if (status === 200) {
            await loadSession();
            location.hash = '#/';
            render();
          } else {
            btn.textContent = t(claiming ? 'auth.setPassword' : 'auth.unlock');
            msg.replaceChildren(alert('error', errText(data)));
            pw.value = '';
            pw2.value = '';
            validate();
            pw.focus();
          }
        },
      },
    },
    !state.session.secure ? alert('info', t('auth.plainHttp')) : null,
    msg,
    claiming ? field(t('auth.code'), code, t('auth.codeHelp')) : null,
    wPw, claiming ? wPw2 : null, btn,
    claiming ? null : forgotBlock());

    return h('div', { class: 'center' },
      h('div', { class: 'card' }, h('div', { class: 'body' },
        icon(claiming ? 'key' : 'lock', 'icon big-icon'),
        h('h1', { text: t(claiming ? 'auth.claimTitle' : 'auth.lockedTitle') }),
        h('p', { class: 'lead', text: t(claiming ? 'auth.claimDesc' : 'auth.lockedDesc') }),
        form)),
    );
  }

  // --- overview ----------------------------------------------------------------
  function statusOf(d, now) {
    if (!d.lastUpload) return { cls: 'warn', text: t('devices.statusSilent') };
    const every = d.uploadIntervalS || 300;
    const age = (now - d.lastUpload) / 1000;
    if (age < every * 2.5) return { cls: 'ok', text: t('devices.statusOk') };
    if (age < every * 12) return { cls: 'warn', text: t('devices.statusSilent') };
    return { cls: 'bad', text: t('devices.statusLost') };
  }

  function pingText(p, now) {
    if (p.state === 'up') return t('devices.pingUp');
    if (p.state === 'down') return `${t('devices.pingDown')} ${t('devices.pingSince', { x: duration((now - p.since) / 1000) })}`;
    if (p.state === 'off') return t('devices.pingOff');
    return t('devices.pingStarting');
  }

  function deviceCard(d, now) {
    const st = statusOf(d, now);
    const fw = d.fw && d.fw.sv ? `v${d.fw.sv}${d.fw.sbv ? ` · BMS ${d.fw.sbv}` : ''}` : '–';
    const hs = d.handshakeMs !== null ? `${num(d.handshakeMs)} ${t('units.ms')} (${t('devices.max')} ${num(d.handshakeMaxMs)})` : '–';
    const body = kv([
      [t('devices.ip'), d.ip || '–'],
      d.model ? [t('devices.model'), d.model] : null,
      [t('devices.firmware'), fw],
      [t('devices.lastUpload'), d.lastUpload ? ago(d.lastUpload, now) : t('devices.never')],
      [t('devices.uploadEvery'), d.uploadIntervalS ? duration(d.uploadIntervalS) : '–'],
      [t('devices.lastTime'), d.lastTime ? ago(d.lastTime, now) : t('devices.never')],
      [t('devices.handshake'), hs],
      [t('devices.tlsErrors'), String(d.tlsErrorCount)],
      d.ping && d.ping.available ? [t('devices.pingTitle'), pingText(d.ping, now)] : null,
    ]);
    const el = card('blue', 'battery', shortName(d), body, h('span', { class: `chip ${st.cls}`, text: st.text }));
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'link');
    const open = () => { location.hash = `#/device/${d.uid}`; };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    el.classList.add('clickable');
    return el;
  }

  function systemCard(sys) {
    return card('purple', 'info', t('system.title'), kv([
      [t('system.endpointVersion'), sys.version],
      sys.web ? [t('system.webVersion'), `web-v${sys.web.version || '?'}${sys.web.root === 'override' ? ` · ${t('updates.webFromUpdate')}` : ''}`] : null,
      [t('system.uptime'), duration(sys.uptimeS)],
      [t('system.retention'), t('system.days', { n: sys.retentionDays })],
      [t('system.disk'), `${t('system.files', { n: sys.disk.files })} · ${bytes(sys.disk.bytes)}`],
    ]));
  }

  /** Availability of the endpoint itself: running time, share, and the list of outages with their cause. */
  function endpointCard() {
    const st = { range: '7d' };
    const chips = h('div', { class: 'chips' });
    const stats = h('div', { class: 'stats' });
    const listBox = h('div', {});
    const body = h('div', {}, h('p', { class: 'small muted', text: t('endpoint.intro') }), chips, stats, listBox);
    const el = card('green', 'shield', t('endpoint.title'), body);
    el.classList.add('span-all');
    function drawChips() {
      chips.replaceChildren(...RANGE_KEYS.map((k) => h('button', { class: `pill${st.range === k ? ' on' : ''}`, type: 'button', text: t(`devices.ranges.${k}`), on: { click: () => { st.range = k; drawChips(); load(); } } })));
    }
    async function load() {
      const { status, data: e } = await api(`endpoint?range=${st.range}`);
      if (status !== 200) return;
      const pct = (v) => (v === null ? '–' : `${num(v, 2)} %`);
      const netText = !e.now.networkCheck ? t('endpoint.netOff') : e.now.network === 'up' ? t('endpoint.netUp') : e.now.network === 'down' ? t('endpoint.noNet') : t('endpoint.netUnknown');
      stats.replaceChildren(kv([
        [t('endpoint.runningSince'), clock(e.startedAt)],
        [t('endpoint.network'), `${netText}${e.now.gateway ? ` (${e.now.gateway})` : ''}`],
        [t('endpoint.recordedSince'), e.trackedSince ? clock(e.trackedSince) : '–'],
        [t('endpoint.availability'), pct(e.stats.availabilityPct)],
        [t('endpoint.runningShare'), pct(e.stats.runningPct)],
        [t('endpoint.outages'), `${num(e.stats.outages)}${e.stats.outages ? ` · ${t('endpoint.longest')} ${duration(e.stats.longestS)}` : ''}`],
      ]));
      const rows = [...e.periods].reverse();
      listBox.replaceChildren(rows.length
        ? h('div', {}, h('div', { class: 'section', text: t('endpoint.list') }),
          h('table', { class: 'list' }, h('tbody', {}, rows.map((p) => h('tr', {},
            h('td', { text: span(p.start, p.end) }),
            h('td', { text: duration(Math.round((p.end - p.start) / 1000)) }),
            h('td', { text: p.kind === 'off' ? t(p.cause === 'crash' ? 'endpoint.offCrash' : 'endpoint.offRestart') : t('endpoint.noNet') }))))))
        : h('p', { class: 'muted small', text: e.trackedSince ? t('endpoint.none') : t('endpoint.notRecorded') }));
    }
    drawChips();
    load();
    return el;
  }

  async function overviewView(root) {
    const wrap = h('div', {});
    root.appendChild(wrap);
    async function load() {
      const { status, data } = await api('overview');
      if (status !== 200) return;
      const now = data.system.time;
      // replaceChildren turns a null into the text "null", so only real nodes go in
      wrap.replaceChildren(...[
        updateBanner(data.updateAvailable),
        webUpdateBanner(data.webUpdateAvailable),
        h('h2', { class: 'page', text: t('devices.title') }),
        data.devices.length
          ? h('div', { class: 'grid' }, data.devices.map((d) => deviceCard(d, now)), systemCard(data.system))
          : h('div', { class: 'grid' }, card('blue', 'battery', t('devices.title'), h('div', { class: 'empty', text: t('devices.none') })), systemCard(data.system)),
        h('div', { class: 'grid below' }, endpointCard()),
      ].filter(Boolean));
    }
    await load();
    state.timer = setInterval(load, 15000);
  }

  // --- modal -------------------------------------------------------------------
  function modal(title, bodyNodes, makeActions, opts = {}) {
    const previous = document.activeElement;
    const titleId = `m${Math.random().toString(36).slice(2, 8)}`;
    let close;
    const actions = h('div', { class: 'mactions' });
    const dlg = h('div', { class: `modal${opts.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('h3', { id: titleId, text: title }), h('div', { class: 'mbody' }, bodyNodes), actions);
    const backdrop = h('div', { class: 'backdrop', on: { mousedown: (e) => { if (e.target === backdrop) close(); } } }, dlg);
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const f = [...dlg.querySelectorAll('button, input, select, a[href]')].filter((x) => !x.disabled);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    close = () => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      if (previous && previous.focus) previous.focus();
    };
    actions.append(...makeActions(close));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    const firstInput = dlg.querySelector('input, select') || dlg.querySelector('button');
    if (firstInput) firstInput.focus();
    return close;
  }

  function renameModal(d, done) {
    const input = h('input', { type: 'text', maxlength: '40', value: d.name || '', placeholder: shortName({ ...d, name: null }) });
    const msg = h('div', {});
    return modal(t('devices.renameTitle'), [msg, field(t('devices.rename'), input, t('devices.renameHelp'))], (close) => {
      const save = h('button', { class: 'btn', type: 'button', text: t('devices.save'), on: { click: async () => {
        save.disabled = true;
        const r = await api(`device/${encodeURIComponent(d.uid)}`, { name: input.value });
        if (r.status === 200) { close(); done(); } else { msg.replaceChildren(alert('error', errText(r.data))); save.disabled = false; }
      } } });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
      return [h('button', { class: 'btn text', type: 'button', text: t('devices.cancel'), on: { click: close } }), save];
    });
  }

  // --- device ------------------------------------------------------------------
  const RANGE_KEYS = ['1h', '6h', '24h', '7d', '30d', 'all'];

  /** One history card (uploads or time requests): range chips, summary, list, "show more". */
  function eventsCard(color, ic, title, uid, kind) {
    const st = { range: '24h', offset: 0, rows: [], total: 0, stats: null, retention: null, median: null };
    const chips = h('div', { class: 'chips' });
    const stats = h('div', { class: 'stats small' });
    const list = h('table', { class: 'list' });
    const more = h('button', { class: 'btn outline', type: 'button', text: t('devices.more') });
    const note = h('div', { class: 'small muted' });
    const body = h('div', {}, chips, stats, list, h('div', { class: 'row' }, more), note);
    const el = card(color, ic, title, body);

    function drawChips() {
      chips.replaceChildren(...RANGE_KEYS.map((k) => h('button', { class: `pill${st.range === k ? ' on' : ''}`, type: 'button', text: t(`devices.ranges.${k}`), on: { click: () => { st.range = k; load(true); } } })));
    }
    function draw() {
      if (st.stats) {
        const s = st.stats;
        stats.replaceChildren(kv([
          [t('devices.statCount'), num(s.count)],
          [t('devices.statMedian'), s.medianGapS ? duration(s.medianGapS) : '–'],
          [t('devices.statMax'), s.maxGapS ? duration(s.maxGapS) : '–'],
          [t('devices.statMissed'), num(s.missed)],
        ]));
      }
      const late = (st.median || 300) * 2;
      list.replaceChildren(h('tbody', {}, st.rows.length
        ? st.rows.map((r) => h('tr', {}, h('td', { text: clock(r.ts) }), h('td', { class: r.gapS !== null && r.gapS > late ? 'late' : '', text: r.gapS !== null ? `+${duration(r.gapS)}` : '' })))
        : h('tr', {}, h('td', { class: 'muted', text: t('devices.noEvents') }), h('td', {}))));
      more.hidden = st.rows.length >= st.total;
      more.textContent = `${t('devices.more')} (${t('devices.shown', { a: st.rows.length, b: st.total })})`;
      note.textContent = st.retention ? t('devices.retainedNote', { n: st.retention }) : '';
      drawChips();
    }
    async function load(reset) {
      if (reset) { st.offset = 0; st.rows = []; }
      more.disabled = true;
      const r = await api(`device/${encodeURIComponent(uid)}/events?kind=${kind}&range=${st.range}&offset=${st.offset}&limit=25`);
      more.disabled = false;
      if (r.status !== 200) return;
      st.rows = st.rows.concat(r.data.events);
      st.offset = st.rows.length;
      st.total = r.data.total;
      st.stats = r.data.stats;
      st.median = r.data.stats.medianGapS;
      st.retention = r.data.retentionDays;
      draw();
    }
    more.addEventListener('click', () => load(false));
    drawChips();
    load(true);
    return el;
  }

  // --- timeline ----------------------------------------------------------------
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
    for (const k of kids.flat()) if (k) el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    return el;
  }
  const withTitle = (el, text) => { el.appendChild(svg('title', {}, text)); return el; };

  function axisLabel(ms, span) {
    const d = new Date(ms);
    return span <= 36 * 3600e3
      ? d.toLocaleTimeString(state.lang, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(state.lang, { day: '2-digit', month: '2-digit' });
  }

  /** Several fine bins into coarser ones, so each bin covers at least two usual intervals. */
  function regroup(counts, expectedPerBin) {
    const g = Math.max(1, Math.ceil(2 / Math.max(expectedPerBin, 0.0001)));
    if (g === 1) return { counts, expected: expectedPerBin, group: 1 };
    const out = [];
    for (let i = 0; i < counts.length; i += g) out.push(counts.slice(i, i + g).reduce((a, b) => a + b, 0));
    return { counts: out, expected: expectedPerBin * g, group: g };
  }

  /**
   * The timeline is drawn at the real pixel width of its container, so text keeps its size on a
   * phone. Narrow layout: the row labels sit above the strips instead of in a left column.
   * Tapping (or clicking) the chart reports what happened at that moment, since a phone has no hover.
   */
  function epPeriodText(p) {
    const secs = Math.round((p.end - p.start) / 1000);
    const what = p.kind === 'off' ? t(p.cause === 'crash' ? 'endpoint.offCrash' : 'endpoint.offRestart') : t('endpoint.noNet');
    return `${what}: ${clock(p.start)} – ${clock(p.end)} (${duration(secs)})`;
  }

  function drawTimeline(tl, W) {
    const compact = W < 520;
    const X0 = compact ? 30 : 104;
    const X1 = W - (compact ? 8 : 8);
    const span = tl.to - tl.from;
    const x = (ts) => X0 + ((Math.min(Math.max(ts, tl.from), tl.to) - tl.from) / span) * (X1 - X0);
    const SH = compact ? 20 : 18;                                  // strip height
    const block = compact ? 46 : 26;                               // distance between rows
    const labelDy = compact ? 12 : 13;
    const top = 12;
    const rows = { ep: top, up: top + block, time: top + 2 * block, ping: top + 3 * block, tls: top + 4 * block };
    const hy0 = rows.tls + (compact ? 52 : 40);                    // handshake chart top
    const hh = compact ? 84 : 66;
    const H = hy0 + hh + 36;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img', 'aria-label': t('devices.timeline') });
    const label = (y, text) => root.appendChild(compact
      ? svg('text', { x: 4, y: y + 10, 'font-size': 12, fill: 'var(--c-text)' }, text)
      : svg('text', { x: 0, y: y + labelDy, 'font-size': 12, fill: 'var(--c-text)' }, text));
    // in the narrow layout a label needs its own line above the strip
    const sy = (r) => (compact ? r + 14 : r);
    label(rows.ep, t('endpoint.row')); label(rows.up, t('devices.rowUploads')); label(rows.time, t('devices.rowTimes')); label(rows.ping, t('devices.rowPing')); label(rows.tls, t('devices.rowTls'));

    const strip = (r, counts, expectedPerBin, what) => {
      const y = sy(r);
      const g = regroup(counts, expectedPerBin);
      const binMs = tl.binMs * g.group;
      const w = (X1 - X0) / g.counts.length;
      g.counts.forEach((c, i) => {
        const start = tl.from + i * binMs;
        const end = start + binMs;
        let exp = g.expected;
        if (end > tl.to) exp = g.expected * Math.max(0, (tl.to - start) / binMs);
        let fill = 'var(--c-empty)';
        if (end >= tl.firstSeen) {
          const ratio = exp > 0 ? c / exp : 1;
          fill = ratio >= 0.75 ? 'var(--c-ok)' : c > 0 ? 'var(--c-warn)' : 'var(--c-bad)';
        }
        root.appendChild(withTitle(svg('rect', { x: (X0 + i * w).toFixed(2), y, width: Math.max(1, w - 0.6).toFixed(2), height: SH, fill, opacity: fill === 'var(--c-bad)' ? 0.55 : 1 }), `${clock(start)} – ${c} ${what}`));
      });
    };
    strip(rows.up, tl.uploads, tl.expectedUpload, t('devices.rowUploads'));
    strip(rows.time, tl.times, tl.expectedTime, t('devices.rowTimes'));

    // endpoint: green = running, dark = off, amber = running without network, grey = not recorded yet
    const ep = tl.endpoint || { periods: [], trackedSince: null };
    const ey = sy(rows.ep);
    root.appendChild(svg('rect', { x: X0, y: ey, width: X1 - X0, height: SH, fill: 'var(--c-empty)' }));
    if (ep.trackedSince) {
      const a = x(ep.trackedSince);
      root.appendChild(withTitle(svg('rect', { x: a, y: ey, width: Math.max(1, X1 - a), height: SH, fill: 'var(--c-ok)' }), t('endpoint.running')));
    }
    const defs = svg('defs', {});
    const pat = svg('pattern', { id: 'epoff', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pat.appendChild(svg('rect', { width: 6, height: 6, fill: 'var(--surface)', opacity: 0.55 }));
    pat.appendChild(svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--c-text)', 'stroke-width': 2 }));
    defs.appendChild(pat);
    root.appendChild(defs);
    for (const p of ep.periods) {
      const a = x(p.start), b = x(p.end);
      const off = p.kind === 'off';
      root.appendChild(withTitle(svg('rect', { x: a, y: ey, width: Math.max(3, b - a), height: SH, fill: off ? 'var(--c-off)' : 'var(--c-warn)' }), epPeriodText(p)));
      // what is missing from the device rows during that time is not the device's fault
      for (const r of [rows.up, rows.time, rows.ping]) {
        root.appendChild(withTitle(svg('rect', { x: a, y: sy(r), width: Math.max(3, b - a), height: SH, fill: 'url(#epoff)' }), epPeriodText(p)));
      }
    }
    // firmware changes (control, BMS, inverter, MPPT): a dashed line through the rows, a diamond on the endpoint row
    for (const c of (tl.firmware || []).filter((c) => c.from !== null && c.ts >= tl.from)) {
      const fx = x(c.ts);
      root.appendChild(svg('line', { x1: fx, x2: fx, y1: sy(rows.ep) - 2, y2: sy(rows.tls) + SH + 2, stroke: 'var(--c-warn)', 'stroke-width': 1.2, 'stroke-dasharray': '4 3' }));
      root.appendChild(withTitle(svg('rect', { x: fx - 4, y: sy(rows.ep) - 8, width: 8, height: 8, fill: 'var(--c-warn)', transform: `rotate(45 ${fx} ${sy(rows.ep) - 4})` }), `${clock(c.ts)} · ${t(`meas.fwPart.${c.part}`)}: ${c.from} → ${c.to}`));
    }
    // ping: light band = watched, red = outage
    const py = sy(rows.ping);
    root.appendChild(svg('rect', { x: X0, y: py, width: X1 - X0, height: SH, fill: 'var(--c-empty)' }));
    for (const wch of tl.ping.watched) {
      const a = x(wch.start), b = x(wch.end ?? tl.to);
      root.appendChild(withTitle(svg('rect', { x: a, y: py, width: Math.max(1, b - a), height: SH, fill: 'var(--c-watch)' }), t('devices.rowPing')));
    }
    for (const o of tl.ping.outages) {
      const a = x(o.start), b = x(o.end ?? tl.to);
      const secs = Math.round(((o.end ?? tl.to) - o.start) / 100) / 10;
      root.appendChild(withTitle(svg('rect', { x: a, y: py, width: Math.max(3, b - a), height: SH, fill: 'var(--c-bad)' }), `${t('devices.pingDown')}: ${clock(o.start)} – ${o.end ? clock(o.end) : t('devices.ongoing')} (${num(secs, 1)} ${t('units.s')})`));
    }
    // TLS errors
    const ty = sy(rows.tls) + SH / 2;
    root.appendChild(svg('line', { x1: X0, x2: X1, y1: ty, y2: ty, stroke: 'var(--c-empty)', 'stroke-width': 1 }));
    for (const e of tl.tls) root.appendChild(withTitle(svg('circle', { cx: x(e.ts), cy: ty, r: compact ? 5 : 4, fill: 'var(--c-bad)' }), `${clock(e.ts)} · ${e.code}`));

    // handshake time
    const maxMs = Math.max(8000, ...tl.handshakes.map((p) => p.ms));
    const y = (ms) => hy0 + hh - (ms / maxMs) * hh;
    root.appendChild(svg('text', { x: compact ? 4 : X0, y: hy0 - 8, 'font-size': 12, fill: 'var(--c-text)' }, t('devices.handshakeTitle')));
    for (const v of [0, 4000, 8000].filter((q) => q <= maxMs)) {
      root.appendChild(svg('line', { x1: X0, x2: X1, y1: y(v), y2: y(v), stroke: 'var(--c-grid)', 'stroke-width': 1 }));
      root.appendChild(svg('text', { x: X0 - 4, y: y(v) + 4, 'font-size': 10, 'text-anchor': 'end', fill: 'var(--c-text2)' }, `${num(v / 1000)}s`));
    }
    if (tl.handshakes.length > 1) {
      root.appendChild(svg('polyline', { points: tl.handshakes.map((p) => `${x(p.ts).toFixed(1)},${y(p.ms).toFixed(1)}`).join(' '), fill: 'none', stroke: 'var(--c-line)', 'stroke-width': 1.4 }));
    }
    for (const p of tl.handshakes) root.appendChild(withTitle(svg('circle', { cx: x(p.ts), cy: y(p.ms), r: p.ms > 6000 ? 3.4 : 2, fill: p.ms > 6000 ? 'var(--c-bad)' : 'var(--c-line)' }), `${clock(p.ts)} · ${num(p.ms)} ${t('units.ms')}`));

    // time axis: fewer labels when narrow
    const ay = H - 8;
    root.appendChild(svg('line', { x1: X0, x2: X1, y1: ay - 14, y2: ay - 14, stroke: 'var(--c-axis)', 'stroke-width': 1 }));
    const marks = compact ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    for (const f of marks) {
      root.appendChild(svg('text', { x: X0 + f * (X1 - X0), y: ay, 'font-size': 11, fill: 'var(--c-text2)', 'text-anchor': f === 0 ? 'start' : f === 1 ? 'end' : 'middle' }, axisLabel(tl.from + span * f, span)));
    }

    // tap / click: a cursor line and what was going on at that moment
    const cursor = svg('line', { x1: 0, x2: 0, y1: 0, y2: H - 22, stroke: 'var(--c-text)', 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' });
    root.appendChild(cursor);
    root.__hit = (px) => {
      const cx = Math.min(Math.max(px, X0), X1);
      const ts = tl.from + ((cx - X0) / (X1 - X0)) * span;
      cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
      const i = Math.min(tl.bins - 1, Math.max(0, Math.floor((ts - tl.from) / tl.binMs)));
      const out = tl.ping.outages.find((o) => ts >= o.start && ts <= (o.end ?? tl.to));
      const watched = tl.ping.watched.some((wch) => ts >= wch.start && ts <= (wch.end ?? tl.to));
      const near = (list, key) => list.filter((e) => Math.abs(e[key] - ts) <= tl.binMs * 1.5).sort((a, b) => Math.abs(a[key] - ts) - Math.abs(b[key] - ts))[0];
      const hsPoint = near(tl.handshakes.map((p) => ({ ...p, k: p.ts })), 'k');
      const tlsPoint = near(tl.tls.map((e) => ({ ...e, k: e.ts })), 'k');
      const epP = ep.periods.find((p) => ts >= p.start && ts <= p.end);
      return [
        [t('devices.cursorTime'), `${clock(tl.from + i * tl.binMs)} – ${clock(Math.min(tl.to, tl.from + (i + 1) * tl.binMs))}`],
        [t('endpoint.row'), epP ? epPeriodText(epP) : ep.trackedSince && ts >= ep.trackedSince ? t('endpoint.running') : t('endpoint.notRecorded')],
        [t('devices.rowUploads'), String(tl.uploads[i])],
        [t('devices.rowTimes'), String(tl.times[i])],
        [t('devices.rowPing'), out ? `${t('devices.pingDown')} (${num(Math.round(((out.end ?? tl.to) - out.start) / 100) / 10, 1)} ${t('units.s')})` : watched ? t('devices.pingUp') : t('devices.pingNotWatched')],
        hsPoint ? [t('devices.handshakeTitle'), `${num(hsPoint.ms)} ${t('units.ms')}`] : null,
        tlsPoint ? [t('devices.rowTls'), tlsPoint.code] : null,
      ];
    };
    return root;
  }

  function timelineCard(d, onPingChange) {
    const uid = d.uid;
    const st = { range: '24h' };
    const chips = h('div', { class: 'chips' });
    const chartBox = h('div', { class: 'chartwrap' }, h('p', { class: 'muted', text: t('devices.loading') }));
    const tip = h('div', { class: 'tipinfo', hidden: true });
    let last = null;
    let drawnW = 0;
    function redraw() {
      if (!last) return;
      drawnW = Math.round(chartBox.clientWidth) || 640;
      const chart = drawTimeline(last, drawnW);
      chart.addEventListener('click', (e) => {
        const r = chart.getBoundingClientRect();
        const rows = chart.__hit(e.clientX - r.left).filter(Boolean);
        tip.replaceChildren(kv(rows));
        tip.hidden = false;
      });
      tip.hidden = true;
      chartBox.replaceChildren(chart);
    }
    // redraw when the width changes (phone turned, window resized), at most every 150 ms
    let resizeTimer = null;
    new ResizeObserver(() => {
      if (!last || Math.abs(Math.round(chartBox.clientWidth) - drawnW) < 12) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(redraw, 150);
    }).observe(chartBox);
    const stats = h('div', { class: 'stats small' });
    const outageBox = h('div', {});
    const pingRow = h('div', { class: 'check' });
    const state = h('span', {});
    const body = h('div', {}, pingRow, chips, chartBox, tip, h('p', { class: 'small muted', text: t('devices.legend') }), stats, outageBox);
    const el = card('blue', 'clock', t('devices.timeline'), body);
    el.classList.add('span-all');

    const box = toggleSwitch('ping-on', d.ping ? d.ping.on : true);
    box.addEventListener('change', async () => {
      box.disabled = true;
      await api(`device/${encodeURIComponent(uid)}/ping`, { on: box.checked });
      box.disabled = false;
      load();
    });
    pingRow.append(box, h('label', { for: 'ping-on', text: t('devices.pingThis') }), ' ', state);
    if (d.ping && !d.ping.available) { box.disabled = true; body.prepend(alert('info', t('devices.pingUnavailable'))); }

    function drawChips() {
      chips.replaceChildren(...RANGE_KEYS.map((k) => h('button', { class: `pill${st.range === k ? ' on' : ''}`, type: 'button', text: t(`devices.ranges.${k}`), on: { click: () => { st.range = k; load(); } } })));
    }
    async function load() {
      const r = await api(`device/${encodeURIComponent(uid)}/timeline?range=${st.range}`);
      if (r.status !== 200) return;
      const tl = r.data;
      drawChips();
      last = tl;
      redraw();
      const p = tl.ping;
      box.checked = p.on;
      box.setAttribute('aria-checked', String(p.on));
      const now = tl.to;
      state.replaceChildren(...[h('span', { class: `chip ${p.state === 'up' ? 'ok' : p.state === 'down' ? 'bad' : 'info'} tiny`, text: p.state === 'up' ? t('devices.pingUp') : p.state === 'down' ? t('devices.pingDown') : p.state === 'off' ? t('devices.pingOff') : t('devices.pingStarting') }),
        p.since && (p.state === 'up' || p.state === 'down') ? h('span', { class: 'small muted', text: ` ${t('devices.pingSince', { x: duration((now - p.since) / 1000) })}` }) : null].filter(Boolean));
      const ps = p.stats;
      stats.replaceChildren(kv([
        [t('devices.pingOutages'), num(ps.outages)],
        [t('devices.pingDowntime'), ps.downtimeS ? duration(ps.downtimeS) : '0 s'],
        [t('devices.pingLongest'), ps.longestS ? `${num(ps.longestS, 1)} ${t('units.s')}` : '–'],
        [t('devices.pingAvail'), ps.availability === null ? t('devices.pingNotWatched') : `${num(ps.availability, 2)} %`],
      ]));
      const list = [...p.outages].reverse().slice(0, 20);
      outageBox.replaceChildren(list.length
        ? h('div', {}, h('div', { class: 'section', text: t('devices.outageList') }), h('table', { class: 'list' }, h('tbody', {}, list.map((o) => h('tr', {}, h('td', { text: span(o.start, o.end) }), h('td', { text: o.end ? `${num(Math.round((o.end - o.start) / 100) / 10, 1)} ${t('units.s')}` : t('devices.ongoing') }))))))
        : h('p', { class: 'muted small', text: t('devices.pingNone') }));
      onPingChange && onPingChange(p);
    }
    drawChips();
    load();
    // keep the ping state fresh while this page is open; stops by itself once it is gone
    const refresh = setInterval(() => { if (!el.isConnected) clearInterval(refresh); else load(); }, 15000);
    return el;
  }

  async function deviceView(root, uid) {
    const { status, data: d } = await api(`device/${encodeURIComponent(uid)}`);
    if (status !== 200) {
      location.hash = '#/';
      return;
    }
    let revealed = false;
    const idText = h('span', { class: 'mono', text: maskedId(d.uid) });
    const reveal = h('button', { class: 'linkbtn', type: 'button', text: t('devices.show'), on: { click: () => {
      revealed = !revealed;
      idText.textContent = revealed ? d.uid : maskedId(d.uid);
      reveal.textContent = t(revealed ? 'devices.hide' : 'devices.show');
    } } });
    const rename = () => renameModal(d, () => render());
    const hs = d.recentHandshakes.length
      ? kv([[t('devices.handshake'), `${num(d.handshakeMs)} ${t('units.ms')} ${t('devices.avg')}`], [t('devices.max'), `${num(d.handshakeMaxMs)} ${t('units.ms')}`]])
      : h('div', { class: 'muted', text: t('devices.noEvents') });
    const tls = d.tlsErrors.length
      ? h('table', { class: 'list' }, h('tbody', {}, [...d.tlsErrors].reverse().map((e) => h('tr', {}, h('td', { text: clock(e.ts) }), h('td', { class: 'mono', text: e.code })))))
      : null;

    // --- manage: remove and merge
    const removeBtn = h('button', { class: 'btn danger', type: 'button', text: t('devices.remove'), on: { click: () => {
      modal(t('devices.remove'), [h('p', { text: t('devices.removeAsk') }), h('p', { class: 'small muted', text: t('devices.removeHelp') })], (close) => {
        const yes = h('button', { class: 'btn danger', type: 'button', text: t('devices.remove'), on: { click: async () => {
          yes.disabled = true;
          await api(`device/${encodeURIComponent(d.uid)}/remove`, {});
          close();
          location.hash = '#/';
        } } });
        return [h('button', { class: 'btn text', type: 'button', text: t('devices.cancel'), on: { click: close } }), yes];
      });
    } } });
    const label = (o) => `${o.name || o.ip || maskedId(o.uid)}${o.ip && o.name ? ` · ${o.ip}` : ''}${o.mac && d.mac && o.mac === d.mac ? ` — ${t('devices.sameMac')}` : ''}`;
    const pick = h('select', {}, d.others.map((o) => h('option', { value: o.uid, text: label(o) })));
    const mergeBtn = h('button', { class: 'btn outline', type: 'button', text: t('devices.mergeButton'), on: { click: () => {
      const other = d.others.find((o) => o.uid === pick.value);
      if (!other) return;
      modal(t('devices.merge'), [h('p', { text: t('devices.mergeAsk', { name: other.name || other.ip || maskedId(other.uid) }) }), h('p', { class: 'small muted', text: t('devices.mergeHelp') })], (close) => {
        const yes = h('button', { class: 'btn', type: 'button', text: t('devices.mergeButton'), on: { click: async () => {
          yes.disabled = true;
          await api(`device/${encodeURIComponent(d.uid)}/merge`, { from: other.uid });
          close();
          render();
        } } });
        return [h('button', { class: 'btn text', type: 'button', text: t('devices.cancel'), on: { click: close } }), yes];
      });
    } } });
    const mergeBlock = d.others.length
      ? h('div', {}, h('div', { class: 'section', text: t('devices.merge') }), field(t('devices.mergePick'), pick, t('devices.mergeHelp')), mergeBtn)
      : h('p', { class: 'muted small', text: t('devices.noOthers') });

    root.appendChild(h('div', {},
      h('button', { class: 'back', type: 'button', on: { click: () => { location.hash = '#/'; } } }, icon('back'), t('devices.back')),
      h('div', { class: 'page-title' }, h('h2', { class: 'page', text: shortName(d) }), h('button', { class: 'linkbtn', type: 'button', text: t('devices.change'), on: { click: rename } })),
      h('div', { class: 'grid' },
        wide(card('blue', 'battery', t('devices.device'), kv([
          [t('devices.name'), h('span', {}, d.name || '–', ' ', h('button', { class: 'linkbtn', type: 'button', text: t('devices.change'), on: { click: rename } }))],
          [t('devices.id'), h('span', {}, idText, ' ', reveal)],
          [t('devices.mac'), d.mac ? h('span', { class: 'mono', text: d.mac.replace(/(..)(?=.)/g, '$1:') }) : '–'],
          [t('devices.ip'), d.ip || '–'],
          [t('devices.model'), d.model || '–'],
          [t('devices.firmware'), d.fw && d.fw.sv ? `v${d.fw.sv}` : '–'],
          [t('devices.firstSeen'), clock(d.firstSeen)],
          [t('devices.counts'), `${num(d.uploadCount)} / ${num(d.timeCount)}`],
        ]))),
        timelineCard(d),
        eventsCard('purple', 'upload', t('devices.uploads'), d.uid, 'upload'),
        eventsCard('info', 'clock', t('devices.times'), d.uid, 'time'),
        card('orange', 'shield', t('devices.tls'), h('div', {}, hs, tls)),
        card('grey', 'tune', t('devices.manage'), h('div', {}, h('button', { class: 'btn outline', type: 'button', text: t('support.forDevice'), on: { click: () => supportModal(d) } }), h('hr', { class: 'sep' }), h('div', { class: 'section', text: t('devices.remove') }), h('p', { class: 'small muted', text: t('devices.removeHelp') }), removeBtn, h('hr', { class: 'sep' }), mergeBlock)))));
  }

  /** Let a card span the whole grid row. */
  function wide(node) {
    node.classList.add('span-all');
    return node;
  }

  // --- support package -----------------------------------------------------------
  /** The form for a support package; `preset` selects one device. Returns the node and the chosen options. */
  function supportForm(deviceList, preset) {
    const sel = h('select', {}, h('option', { value: 'all', text: t('support.all') }), deviceList.map((d) => h('option', { value: d.uid, text: shortName(d) })));
    if (preset) sel.value = preset;
    const range = h('select', {}, ['24h', '7d', '30d', 'all'].map((k) => h('option', { value: k, text: t(`support.ranges.${k}`) })));
    range.value = '7d';
    const raw = toggleSwitch('support-raw', false);
    const meas = toggleSwitch('support-meas', false);
    const warn = alert('warning', t('support.rawWarn'));
    warn.hidden = true;
    raw.addEventListener('change', () => { warn.hidden = !raw.checked; });
    const node = h('div', {},
      preset ? null : field(t('support.device'), sel),
      field(t('support.range'), range),
      h('div', { class: 'check' }, h('label', { for: 'support-raw', text: t('support.raw') }), raw),
      h('div', { class: 'check' }, h('label', { for: 'support-meas', text: t('support.measurements') }), meas),
      warn,
      h('p', { class: 'small muted', text: t('support.masked') }));
    return { node, options: () => ({ devices: sel.value, range: range.value, raw: raw.checked, measurements: meas.checked }) };
  }

  /** POST, then hand the file to the browser as a download. */
  async function downloadSupport(options, btn, msg) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('support.building');
    msg.replaceChildren();
    try {
      const res = await fetch('api/support', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.session.csrf }, body: JSON.stringify(options) });
      if (!res.ok) {
        let data = {};
        try { data = await res.json(); } catch { /* no body */ }
        msg.replaceChildren(alert('error', errText(data)));
        return;
      }
      const blob = await res.blob();
      const name = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || 'marstek-endpoint-support.tar.gz';
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      msg.replaceChildren(alert('success', t('support.done', { name, size: bytes(blob.size) })));
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function supportCard(deviceList) {
    const form = supportForm(deviceList, null);
    const msg = h('div', {});
    const btn = h('button', { class: 'btn', type: 'button', text: t('support.download'), on: { click: () => downloadSupport(form.options(), btn, msg) } });
    return card('info', 'download', t('support.title'), h('div', {}, h('p', { text: t('support.intro') }), h('p', { class: 'small muted', text: t('support.contents') }), msg, form.node, btn));
  }

  function supportModal(d) {
    const form = supportForm([], d.uid);
    const msg = h('div', {});
    modal(t('support.forDevice'), [msg, form.node], (close) => {
      const btn = h('button', { class: 'btn', type: 'button', text: t('support.download'), on: { click: () => downloadSupport(form.options(), btn, msg) } });
      return [h('button', { class: 'btn text', type: 'button', text: t('updates.close'), on: { click: close } }), btn];
    });
  }

  // --- settings ----------------------------------------------------------------
  /** Release notes: newer versions, the installed one and the one before it are open; the rest is folded away. */
  function releaseNotes(u) {
    const box = h('div', {});
    const idx = u.releases.findIndex((r) => r.state === 'installed');
    const shown = (r, i) => r.state === 'newer' || r.state === 'installed' || (idx >= 0 ? i === idx + 1 : i < 3);
    const open = u.releases.filter(shown);
    const rest = u.releases.filter((r, i) => !shown(r, i));
    const stateChip = (r) => (r.state === 'newer' ? h('span', { class: 'chip warn tiny', text: t('updates.newer') }) : r.state === 'installed' ? h('span', { class: 'chip ok tiny', text: t('updates.current') }) : null);
    const entry = (r, isOpen) => h('details', { class: 'rel', open: isOpen ? true : null },
      h('summary', {}, h('strong', { text: r.name || r.tag }), ' ', stateChip(r), r.date ? h('span', { class: 'muted small', text: ` · ${new Date(r.date).toLocaleDateString(state.lang)}` }) : null),
      r.body ? md(r.body) : h('p', { class: 'muted small', text: t('updates.noReleases') }),
      r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', class: 'small', text: t('updates.open') }) : null);
    open.forEach((r) => box.appendChild(entry(r, true)));
    if (rest.length) {
      const older = h('div', { hidden: true }, rest.map((r) => entry(r, false)));
      const more = h('button', { class: 'linkbtn', type: 'button', text: t('updates.showOlder'), on: { click: () => { older.hidden = false; more.remove(); } } });
      box.append(more, older);
    }
    return box;
  }

  /** The changelog in a dialog, reachable from every page (footer and burger menu). */
  async function openChangelog() {
    const content = h('div', {}, h('p', { class: 'muted', text: t('updates.loadingNotes') }));
    modal(t('updates.notes'), [content], (close) => [h('button', { class: 'btn text', type: 'button', text: t('updates.close'), on: { click: close } })], { wide: true });
    async function fill() {
      let { data: u } = await api('updates');
      if (u && u.enabled && !u.checkedAt) {
        const r = await api('updates/check', {});
        if (r.status === 200) u = r.data;
      }
      const parts = [];
      if (!u || u.enabled === undefined) { content.replaceChildren(alert('error', t('err.generic'))); return; }
      parts.push(kv([[t('updates.installed'), h('span', {}, u.current, u.localBuild ? h('span', { class: 'chip info tiny', text: t('updates.localBuild') }) : null)]]));
      if (!u.enabled) {
        parts.push(alert('info', t('updates.off')));
        parts.push(h('button', { class: 'btn', type: 'button', text: t('updates.enableNow'), on: { click: async (e) => { e.target.disabled = true; await api('updates', { enabled: true }); fill(); } } }));
      } else {
        if (u.error) parts.push(alert('warning', t('updates.failed', { e: u.error })));
        else if (u.updateAvailable) parts.push(alert('info', t('updates.available', { tag: u.updateAvailable })));
        else if (u.checkedAt) parts.push(alert('success', t('updates.upToDate')));
        if (u.releases.length) parts.push(h('div', { class: 'section', text: t('updates.containerTitle') }), releaseNotes(u));
        if (u.web && u.web.releases.length) parts.push(h('div', { class: 'section', text: t('updates.webTitle') }), releaseNotes({ releases: u.web.releases }));
        parts.push(h('p', { class: 'small muted', text: u.checkedAt ? `${t('updates.checkedAt')}: ${clock(u.checkedAt)}` : '' }));
      }
      content.replaceChildren(...parts);
    }
    fill();
  }

  /** Install a new web side without restarting the endpoint: shows what runs, what is available and why not. */
  function webUpdateSection(u, reload) {
    const wu = u.webUpdate || {};
    const web = u.web || { releases: [], current: null, available: null };
    const msg = h('div', {});
    const box = h('div', { class: 'webupd' }, msg);
    const origin = wu.root === 'override' ? t('updates.webFromUpdate') : t('updates.webFromImage');
    box.appendChild(kv([[t('updates.installed'), h('span', {}, `web-v${web.current || '?'}`, ' ', h('span', { class: 'chip info tiny', text: origin }))]]));
    box.appendChild(h('p', { class: 'small muted', text: t('updates.webHelp') }));
    if (wu.safeMode) box.appendChild(alert('warning', t('updates.webSafe')));
    if (wu.incompatible) box.appendChild(alert('warning', t('updates.webIncompatible', { v: wu.incompatible })));
    if ((wu.failed || []).length) box.appendChild(alert('warning', t('updates.webFailed', { v: wu.failed.map((f) => f.version).join(', ') })));
    if (!u.enabled) return box;
    const next = web.releases.find((r) => r.state === 'newer');
    if (!next) {
      box.appendChild(alert('success', t('updates.webUpToDate')));
    } else {
      box.appendChild(alert('info', t('updates.webAvailable', { tag: next.tag })));
      const reasons = [];
      if (!wu.supervised) reasons.push(t('updates.whyNoSupervisor'));
      if (!wu.publicKey) reasons.push(t('updates.whyNoKey'));
      if (next.needsContainer) reasons.push(t('updates.whyContainer', { v: next.needsContainer }));
      else if (next.compatible === false) reasons.push(t('updates.whyIpc'));
      if (!reasons.length && !next.installable) reasons.push(t('updates.whyAssets'));
      const btn = h('button', { class: 'btn', type: 'button', text: t('updates.webInstallTag', { tag: next.tag }), disabled: !next.installable ? true : null, on: { click: () => confirmWebInstall(next, btn, msg, reload) } });
      box.appendChild(h('div', { class: 'row-gap' }, btn));
      if (reasons.length) box.appendChild(h('p', { class: 'small muted', text: reasons.join(' ') }));
    }
    if (wu.root === 'override') {
      const back = h('button', { class: 'btn outline', type: 'button', text: t('updates.webRollback'), on: { click: async () => {
        back.disabled = true;
        const r = await api('web-update/rollback', {});
        if (r.status !== 200) { msg.replaceChildren(alert('error', errText(r.data))); back.disabled = false; return; }
        waitForWeb(msg);
      } } });
      box.appendChild(h('div', { class: 'row-gap' }, back));
    }
    return box;
  }
  function confirmWebInstall(rel, btn, msg, reload) {
    modal(t('updates.webInstallTag', { tag: rel.tag }), [h('p', { text: t('updates.webConfirm') }), rel.body ? md(rel.body) : null].filter(Boolean), (close) => {
      const go = h('button', { class: 'btn', type: 'button', text: t('updates.webInstall'), on: { click: async () => {
        go.disabled = true;
        close();
        btn.disabled = true;
        msg.replaceChildren(alert('info', t('updates.webInstalling')));
        const r = await api('web-update/install', { tag: rel.tag });
        if (r.status !== 200) {
          btn.disabled = false;
          msg.replaceChildren(alert('error', t(`updates.err.${r.data.error}`, { v: r.data.need || '' }) === `updates.err.${r.data.error}` ? errText(r.data) : t(`updates.err.${r.data.error}`, { v: r.data.need || '' })));
          return;
        }
        waitForWeb(msg);
      } } });
      return [h('button', { class: 'btn text', type: 'button', text: t('devices.cancel'), on: { click: close } }), go];
    }, { wide: true });
  }
  /** The web process restarts for a moment (the endpoint does not); wait until it answers again, then reload. */
  async function waitForWeb(msg) {
    msg.replaceChildren(alert('info', t('updates.webRestarting')));
    await new Promise((r) => setTimeout(r, 2500));
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch('api/session', { credentials: 'same-origin' });
        if (res.ok) { location.reload(); return; }
      } catch { /* still restarting */ }
      await new Promise((r) => setTimeout(r, 750));
    }
    msg.replaceChildren(alert('error', t('updates.webNoAnswer')));
  }

  /** Two cards: the endpoint (the container image) and the web interface, each with its own update. */
  function updatesCards(u, reload) {
    const body = h('div', {});
    const msg = h('div', {});
    const box = toggleSwitch('upd-on', u.enabled);
    box.addEventListener('change', async () => {
      box.disabled = true;
      const r = await api('updates', { enabled: box.checked });
      if (r.status !== 200) { msg.replaceChildren(alert('error', errText(r.data))); box.checked = !box.checked; box.setAttribute('aria-checked', String(box.checked)); box.disabled = false; return; }
      reload();
    });
    const toggle = h('div', { class: 'check' }, box, h('label', { for: 'upd-on', text: t('updates.enable') }));
    body.append(msg, toggle, h('p', { class: 'small muted', text: t('updates.enableHelp') }));

    const rows = [[t('updates.installed'), h('span', {}, u.current, u.localBuild ? h('span', { class: 'chip info tiny', text: t('updates.localBuild') }) : null)]];
    if (u.enabled) rows.push([t('updates.checkedAt'), u.checkedAt ? clock(u.checkedAt) : t('updates.never')]);
    body.appendChild(kv(rows));

    const webBody = h('div', {});
    if (!u.enabled) {
      body.appendChild(h('p', { class: 'muted small', text: t('updates.off') }));
      return [card('green', 'refresh', t('updates.endpointTitle'), body), card('blue', 'refresh', t('updates.webCardTitle'), h('div', {}, webUpdateSection(u, reload), h('p', { class: 'muted small', text: t('updates.off') })))];
    }
    if (u.error) body.appendChild(alert('warning', t('updates.failed', { e: u.error })));
    else if (u.checkedAt) body.appendChild(alert(u.updateAvailable ? 'info' : 'success', u.updateAvailable ? t('updates.available', { tag: u.updateAvailable }) : t('updates.upToDate')));

    const check = h('button', { class: 'btn outline', type: 'button', text: t('updates.checkNow'), on: { click: async () => {
      check.disabled = true;
      await api('updates/check', {});
      reload();
    } } });
    body.appendChild(h('div', { class: 'row-gap' }, check));
    if (u.updateAvailable) {
      body.appendChild(h('p', { class: 'small', text: t('updates.howTo') }));
      body.appendChild(h('pre', { class: 'code', text: 'docker compose pull && docker compose up -d' }));
    }

    const notes = () => h('button', { class: 'btn outline', type: 'button', text: t('updates.showNotes'), on: { click: () => openChangelog() } });
    if (u.releases.length) body.append(notes());
    webBody.append(webUpdateSection(u, reload));
    if (u.web && u.web.releases.length) webBody.append(notes());
    return [card('green', 'refresh', t('updates.endpointTitle'), body), card('blue', 'refresh', t('updates.webCardTitle'), webBody)];
  }

  /** On/off for the measurements database, what it holds, and a rebuild from the logs. */
  function measurementsCard(m, reload) {
    const body = h('div', {});
    const msg = h('div', {});
    if (!m.available) {
      body.append(alert('warning', t('meas.unavailable')));
      return card('purple', 'storage', t('meas.title'), body);
    }
    const box = toggleSwitch('meas-on', m.enabled);
    box.addEventListener('change', async () => {
      box.disabled = true;
      const r = await api('measurements', { enabled: box.checked });
      if (r.status !== 200) msg.replaceChildren(alert('error', errText(r.data)));
      reload();
    });
    body.append(msg, h('div', { class: 'check' }, box, h('label', { for: 'meas-on', text: t('meas.enable') })), h('p', { class: 'small muted', text: t('meas.help') }));
    body.appendChild(kv([
      [t('meas.values'), num(m.rows || 0)],
      [t('meas.keys'), num(m.keys || 0)],
      [t('meas.since'), m.first ? clock(m.first) : '–'],
      [t('meas.size'), bytes(m.bytes || 0)],
    ]));
    if (m.importing) body.appendChild(alert('info', t('meas.importing')));
    const rebuild = h('button', { class: 'btn outline', type: 'button', text: t('meas.rebuild'), on: { click: () => {
      modal(t('meas.rebuild'), [h('p', { text: t('meas.rebuildHelp') })], (close) => {
        const yes = h('button', { class: 'btn danger', type: 'button', text: t('meas.rebuildYes'), on: { click: async () => { yes.disabled = true; await api('measurements/import', {}); close(); setTimeout(reload, 1500); } } });
        return [h('button', { class: 'btn text', type: 'button', text: t('devices.cancel'), on: { click: close } }), yes];
      });
    } } });
    body.append(h('div', { class: 'row-gap' }, rebuild), h('p', { class: 'small' }, h('a', { href: '#/measurements', text: t('meas.open') })));
    return card('purple', 'storage', t('meas.title'), body);
  }

  const FW_PART_KEYS = ['control', 'bms', 'inverter', 'mppt'];
  const CATS = ['firmware', 'power', 'energy', 'battery', 'bms', 'temperature', 'grid', 'pv', 'status', 'errors', 'network', 'system', 'other'];
  const CAT_LOOK = { firmware: ['orange', 'refresh'], power: ['blue', 'battery'], energy: ['green', 'battery'], battery: ['purple', 'battery'], bms: ['info', 'shield'], temperature: ['orange', 'info'], grid: ['grey', 'tune'], pv: ['orange', 'info'], status: ['grey', 'info'], errors: ['red', 'shield'], network: ['blue', 'info'], system: ['grey', 'info'], other: ['grey', 'info'] };
  const fwChangeText = (c) => `${t(`meas.fwPart.${c.part}`)}: ${c.from === null ? t('meas.firstSeen') : c.from} → ${c.to}`;

  /** A step curve of one key with the firmware changes marked as dashed lines. Colours come from CSS variables. */
  function drawSeries(res, fwChanges, W, unit) {
    const pts = res.points.filter((p) => p.value !== null);
    const H = 240, L = 46, R = 10, T = 22, B = 26;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img' });
    if (!pts.length) return null;
    const from = res.from, to = res.to;
    const t0 = res.range === 'all' ? Math.min(from > 0 ? from : pts[0].ts, pts[0].ts) : from;
    const span = Math.max(1, to - t0);
    let lo = Math.min(...pts.map((p) => p.value)), hi = Math.max(...pts.map((p) => p.value));
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const x = (ts) => L + ((Math.min(Math.max(ts, t0), to) - t0) / span) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    for (const f of [0, 0.5, 1]) {
      const v = lo + (hi - lo) * f;
      root.appendChild(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--c-grid)', 'stroke-width': 1 }));
      root.appendChild(svg('text', { x: L - 4, y: y(v) + 4, 'font-size': 10, 'text-anchor': 'end', fill: 'var(--c-text2)' }, num(v, Math.abs(hi - lo) < 10 ? 2 : 0)));
    }
    for (const f of [0, 0.5, 1]) {
      root.appendChild(svg('text', { x: L + f * (W - L - R), y: H - 8, 'font-size': 11, fill: 'var(--c-text2)', 'text-anchor': f === 0 ? 'start' : f === 1 ? 'end' : 'middle' }, axisLabel(t0 + span * f, span)));
    }
    // firmware changes: dashed line, diamond on top, text on tap
    for (const c of fwChanges.filter((c) => c.ts >= t0 && c.from !== null)) {
      root.appendChild(svg('line', { x1: x(c.ts), x2: x(c.ts), y1: T - 6, y2: H - B, stroke: 'var(--c-warn)', 'stroke-width': 1.2, 'stroke-dasharray': '4 3' }));
      root.appendChild(withTitle(svg('rect', { x: x(c.ts) - 4, y: T - 12, width: 8, height: 8, fill: 'var(--c-warn)', transform: `rotate(45 ${x(c.ts)} ${T - 8})` }), `${clock(c.ts)} · ${fwChangeText(c)}`));
    }
    // step line
    let d = '';
    pts.forEach((p, i) => { d += `${i ? `H${x(p.ts).toFixed(1)}V` : `M${x(p.ts).toFixed(1)},`}${y(p.value).toFixed(1)}`; });
    d += `H${x(to).toFixed(1)}`;
    root.appendChild(svg('path', { d, fill: 'none', stroke: 'var(--c-line)', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }));
    const cursor = svg('line', { x1: 0, x2: 0, y1: T - 6, y2: H - B, stroke: 'var(--c-text)', 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' });
    root.appendChild(cursor);
    root.__hit = (px) => {
      const cx = Math.min(Math.max(px, L), W - R);
      const ts = t0 + ((cx - L) / (W - L - R)) * span;
      cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
      let cur = null;
      for (const p of pts) if (p.ts <= ts) cur = p;
      const near = fwChanges.find((c) => c.from !== null && Math.abs(x(c.ts) - cx) < 8);
      return [[t('devices.cursorTime'), clock(ts)], [t('meas.value'), cur ? `${num(cur.value, 3)}${unit ? ` ${unit}` : ''}` : '–'], near ? [t('meas.firmware'), fwChangeText(near)] : null];
    };
    return root;
  }

  /** Curve of one key: range chips, the chart, and what the firmware did meanwhile. */
  function seriesModal(uid, r, fwChanges) {
    const st = { range: '7d' };
    const chips = h('div', { class: 'chips' });
    const box = h('div', { class: 'chartwrap' }, h('p', { class: 'muted', text: t('devices.loading') }));
    const tip = h('div', { class: 'tipinfo', hidden: true });
    let res = null;
    function drawNow() {
      if (!res) return;
      const chart = drawSeries(res, fwChanges, Math.max(300, Math.round(box.clientWidth) || 640), r.unit);
      if (!chart) { box.replaceChildren(h('p', { class: 'muted', text: t('meas.noCurve') })); return; }
      chart.addEventListener('click', (e) => {
        const bb = chart.getBoundingClientRect();
        tip.replaceChildren(kv(chart.__hit(e.clientX - bb.left).filter(Boolean)));
        tip.hidden = false;
      });
      tip.hidden = true;
      box.replaceChildren(chart);
    }
    async function load() {
      chips.replaceChildren(...['24h', '7d', '30d', 'all'].map((k) => h('button', { class: `pill${st.range === k ? ' on' : ''}`, type: 'button', text: t(`devices.ranges.${k}`), on: { click: () => { st.range = k; load(); } } })));
      const q = await api(`device/${encodeURIComponent(uid)}/series?key=${encodeURIComponent(r.key)}&range=${st.range}`);
      if (q.status !== 200) return;
      res = q.data;
      drawNow();
    }
    modal(`${r.name}`, [h('p', { class: 'small muted mono', text: r.key }), chips, box, tip, h('p', { class: 'small muted', text: t('meas.curveHelp') })], (close) => [h('button', { class: 'btn text', type: 'button', text: t('updates.close'), on: { click: close } })], { wide: true });
    load();
  }

  /** Page: the newest value of every key for one device, grouped by category, with curves and the firmware history. */
  async function measurementsView(root) {
    const { data: ov } = await api('overview');
    const list = (ov && ov.devices) || [];
    const wrap = h('div', {});
    root.appendChild(wrap);
    if (!list.length) {
      wrap.append(h('h2', { class: 'page', text: t('meas.page') }), card('purple', 'storage', t('meas.title'), h('div', { class: 'empty', text: t('devices.none') })));
      return;
    }
    const st = { uid: (state.measDevice && list.some((d) => d.uid === state.measDevice)) ? state.measDevice : list[0].uid, all: false };
    const sel = h('select', {}, list.map((d) => h('option', { value: d.uid, text: `${shortName(d)}${d.model ? ` (${d.model})` : ''}` })));
    sel.value = st.uid;
    sel.addEventListener('change', () => { st.uid = sel.value; state.measDevice = st.uid; load(); });
    const onlyKnown = toggleSwitch('meas-known', true);
    onlyKnown.addEventListener('change', () => { st.all = !onlyKnown.checked; draw(); });
    const body = h('div', { class: 'grid below' });
    const fwBox = h('div', {});
    let data = null;
    let fw = [];
    const fwNote = h('div', {});
    const catName = (c) => t(`meas.cat.${c}`);
    const fmtVal = (r) => (typeof r.value === 'number' ? `${num(r.value, 3)}${r.unit ? ` ${r.unit}` : ''}` : `${r.value}${r.unit ? ` ${r.unit}` : ''}`);
    function drawFw() {
      fwBox.replaceChildren(card('orange', 'refresh', t('meas.fwHistory'), fw.length
        ? h('table', { class: 'list' }, h('tbody', {}, [...fw].reverse().map((c) => h('tr', {}, h('td', { text: clock(c.ts) }), h('td', { text: fwChangeText(c) }))))) : h('p', { class: 'muted', text: t('meas.noFw') })));
    }
    function draw() {
      if (!data) return;
      // key meanings were confirmed on certain firmware versions only: say so when this device runs another
      const cur = (data.values.find((r) => r.key === 'dn') || {}).raw;
      const model = (data.device && data.device.model) || '';
      const pairs = data.verified || [];
      const okHere = pairs.some((p) => p.fw === cur && (p.model === model || p.model === '*'));
      const pairText = pairs.map((p) => `${p.model === '*' ? t('meas.anyModel') : p.model} / ${t('meas.firmware')} ${p.fw}`).join(', ') || '–';
      fwNote.replaceChildren(...[
        cur ? h('p', { class: 'small', text: `${t('devices.model')}: ${model || '–'} · ${t('meas.firmware')}: ${cur}` }) : null,
        cur && !okHere ? alert('warning', t('meas.otherFw', { model: model || '–', fw: cur, list: pairText })) : null,
      ].filter(Boolean));
      if (!data.stats.available) { body.replaceChildren(alert('warning', t('meas.unavailable'))); return; }
      const rows = data.values.filter((r) => st.all || r.confirmed);
      if (!rows.length) { body.replaceChildren(h('p', { class: 'muted', text: data.stats.rows ? t('meas.noneShown') : t('meas.empty') })); return; }
      const groups = new Map();
      for (const r of rows) { const c = r.category || 'other'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(r); }
      body.replaceChildren(...CATS.filter((c) => groups.has(c)).map((c) => {
        const items = groups.get(c);
        const [color, ic] = CAT_LOOK[c] || CAT_LOOK.other;
        const custom = data.mqtt && data.mqtt.mode === 'custom';
        const sentSet = new Set((data.mqtt && data.mqtt.sent) || []);
        const bulk = (on) => async () => {
          await api('mqtt/select', { keys: items.map((r) => r.key), on });
          items.forEach((r) => { if (on) sentSet.add(r.key); else sentSet.delete(r.key); });
          data.mqtt.sent = [...sentSet];
          draw();
        };
        const extra = custom ? h('span', { class: 'hdrlinks' }, h('button', { class: 'linkbtn light', type: 'button', text: t('meas.mqttAll'), on: { click: bulk(true) } }), ' · ', h('button', { class: 'linkbtn light', type: 'button', text: t('meas.mqttNone'), on: { click: bulk(false) } })) : null;
        return card(color, ic, `${catName(c)} (${items.length})`, h('table', { class: 'list meas' }, h('tbody', {}, items.map((r) => h('tr', {},
          h('td', {}, h('button', { class: 'linkbtn plain', type: 'button', title: t('meas.showCurve'), on: { click: () => seriesModal(st.uid, r, fw) } }, r.name), sentSet.has(r.key) ? h('span', { class: 'mqsym', title: t('meas.mqttSent') }, icon('upload')) : null, h('div', { class: 'small muted mono', text: `${r.key} · ${t(`meas.ev.${r.evidence || 'none'}`)}${r.scope && r.scope !== 'general' ? ` · ${scopeText(r.scope, r)}` : ''}` })),
          h('td', { class: 'num', text: fmtVal(r) }),
          h('td', { class: 'hide-narrow small', text: clock(r.ts) }),
          h('td', {}, h('button', { class: 'linkbtn', type: 'button', text: t('devices.change'), on: { click: () => editKey(r) } }),
            custom ? h('label', { class: 'mqpick small' }, (() => {
              const cb = h('input', { type: 'checkbox' });
              cb.checked = sentSet.has(r.key);
              cb.addEventListener('change', async () => {
                await api('mqtt/select', { keys: [r.key], on: cb.checked });
                if (cb.checked) sentSet.add(r.key); else sentSet.delete(r.key);
                data.mqtt.sent = [...sentSet];
                draw();
              });
              return cb;
            })(), ' MQTT') : null))))), extra);
      }));
    }
    /** A short label for how specific the rule that gives a value its meaning is. */
    function scopeText(scope, r) {
      return scope === 'model+fw' ? `${r.model} / ${r.fw}` : scope === 'model' ? r.model : scope === 'fw' ? `${t('meas.firmware')} ${r.fw}` : '';
    }
    function editKey(r) {
      // the scopes of a rule: everything, one firmware, one model, one model with one firmware
      const opts = [['*|*', t('meas.scopeAll')]];
      if (r.fw) opts.push([`*|${r.fw}`, t('meas.scopeFw', { fw: r.fw })]);
      if (r.model) opts.push([`${r.model}|*`, t('meas.scopeModel', { model: r.model })]);
      if (r.model && r.fw) opts.push([`${r.model}|${r.fw}`, t('meas.scopeModelFw', { model: r.model, fw: r.fw })]);
      const scope = h('select', {}, opts.map(([v, text]) => h('option', { value: v, text })));
      scope.value = { 'model+fw': `${r.model}|${r.fw}`, model: `${r.model}|*`, fw: `*|${r.fw}` }[r.scope] || '*|*';
      const cat = h('select', {}, CATS.map((c) => h('option', { value: c, text: catName(c) })));
      cat.value = r.category || 'other';
      const ok = toggleSwitch('meas-ok', r.confirmed);
      const name = h('input', { type: 'text', maxlength: '60', value: r.name });
      const unit = h('input', { type: 'text', maxlength: '12', value: r.unit });
      const scale = h('input', { type: 'text', inputmode: 'decimal', value: String(r.scale) });
      const desc = h('input', { type: 'text', maxlength: '200', value: r.description || '' });
      const msg = h('div', {});
      modal(`${r.key}`, [msg, field(t('meas.appliesTo'), scope, t('meas.appliesHelp')), field(t('meas.name'), name), field(t('meas.category'), cat), field(t('meas.unit'), unit), field(t('meas.scale'), scale, t('meas.scaleHelp')), field(t('meas.description'), desc),
        h('div', { class: 'check' }, h('label', { for: 'meas-ok', text: t('meas.confirmedFor') }), ok),
        h('p', { class: 'small muted', text: `${t('meas.raw')}: ${r.raw}` })].filter(Boolean), (close) => {
        const save = h('button', { class: 'btn', type: 'button', text: t('devices.save'), on: { click: async () => {
          const sc = Number(String(scale.value).replace(',', '.'));
          if (!name.value.trim() || !Number.isFinite(sc) || sc === 0) { msg.replaceChildren(alert('error', t('err.generic'))); return; }
          save.disabled = true;
          const res = await api('keys', { key: r.key, model: scope.value.split('|')[0], fw: scope.value.split('|')[1], name: name.value, unit: unit.value, scale: sc, description: desc.value, confirmed: ok.checked, category: cat.value });
          if (res.status === 200) { close(); load(); } else { msg.replaceChildren(alert('error', errText(res.data))); save.disabled = false; }
        } } });
        return [h('button', { class: 'btn text', type: 'button', text: t('devices.cancel'), on: { click: close } }), save];
      });
    }
    async function load() {
      const [r, f] = await Promise.all([api(`device/${encodeURIComponent(st.uid)}/values`), api(`device/${encodeURIComponent(st.uid)}/firmware`)]);
      if (r.status !== 200) return;
      data = r.data;
      fw = f.status === 200 ? f.data.changes : [];
      draw();
      drawFw();
    }
    wrap.append(h('h2', { class: 'page', text: t('meas.page') }),
      card('purple', 'storage', t('meas.title'), h('div', {},
        h('p', { class: 'small muted', text: t('meas.pageIntro') }),
        field(t('support.device'), sel),
        fwNote,
        h('div', { class: 'check' }, h('label', { for: 'meas-known', text: t('meas.onlyKnown') }), onlyKnown))),
      body,
      h('div', { class: 'grid below' }, fwBox));
    await load();
  }

  /** A row of "switch + label" (the project's iOS-style switch). */
  const switchRow = (id, label, checked) => { const box = toggleSwitch(id, checked); return { box, node: h('div', { class: 'check' }, h('label', { for: id, text: label }), box) }; };
  const when = (ms) => (ms ? clock(ms) : '–');

  /** Notifications: channels, rules, test buttons. Tokens are write-only: the page never gets them back. */
  function notifyCard(n, reload) {
    const c = n.config;
    const msg = h('div', {});
    const master = switchRow('nt-on', t('notify.enable'), c.enabled);
    const lang = h('select', {}, h('option', { value: 'en', text: 'English' }), h('option', { value: 'de', text: 'Deutsch' }));
    lang.value = c.lang;
    const tgOn = switchRow('nt-tg', t('notify.telegram'), c.telegram.enabled);
    const tgChat = h('input', { type: 'text', value: c.telegram.chatId, placeholder: '123456789', autocomplete: 'off' });
    const tgTok = h('input', { type: 'password', autocomplete: 'off', placeholder: n.secrets.telegram ? t('notify.tokenSet') : '123456:ABC…' });
    const haOn = switchRow('nt-ha', t('notify.ha'), c.ha.enabled);
    const haUrl = h('input', { type: 'text', value: c.ha.url, placeholder: 'http://homeassistant.local:8123', autocomplete: 'off' });
    const haSvc = h('input', { type: 'text', value: c.ha.service, placeholder: 'notify', autocomplete: 'off' });
    const haTok = h('input', { type: 'password', autocomplete: 'off', placeholder: n.secrets.ha ? t('notify.tokenSet') : '' });
    const haInsecure = switchRow('nt-ha-insecure', t('notify.haInsecure'), c.ha.insecure);
    const poOn = switchRow('nt-po', t('notify.pushover'), c.pushover.enabled);
    const poUser = h('input', { type: 'password', autocomplete: 'off', placeholder: n.secrets.pushover ? t('notify.tokenSet') : '' });
    const poTok = h('input', { type: 'password', autocomplete: 'off', placeholder: n.secrets.pushover ? t('notify.tokenSet') : '' });
    const poPrio = h('select', {}, [-1, 0, 1].map((p) => h('option', { value: String(p), text: t(`notify.prio${p < 0 ? '_1' : p}`) })));
    poPrio.value = String(c.pushover.priority);
    const whOn = switchRow('nt-wh', t('notify.webhook'), c.webhook.enabled);
    const whUrl = h('input', { type: 'password', autocomplete: 'off', placeholder: n.secrets.webhook ? `${n.secrets.webhookHost} - ${t('notify.tokenSet')}` : 'https://example.org/hook' });
    const whAuth = h('input', { type: 'password', autocomplete: 'off', placeholder: n.secrets.webhookAuth ? t('notify.tokenSet') : 'Bearer …' });
    const whFmt = h('select', {}, h('option', { value: 'json', text: t('notify.whJson') }), h('option', { value: 'text', text: t('notify.whText') }));
    whFmt.value = c.webhook.format;
    const whInsecure = switchRow('nt-wh-insecure', t('notify.haInsecure'), c.webhook.insecure);
    const r = c.rules;
    const rUp = switchRow('nt-r-up', t('notify.rUpload'), r.uploadMissing.on);
    const rUpMin = h('input', { type: 'number', min: '5', max: '1440', value: String(r.uploadMissing.minMinutes) });
    const rPing = switchRow('nt-r-ping', t('notify.rPing'), r.pingDown.on);
    const rPingS = h('input', { type: 'number', min: '10', max: '3600', value: String(r.pingDown.seconds) });
    const rEp = switchRow('nt-r-ep', t('notify.rEndpoint'), r.endpoint.on);
    const rRestart = switchRow('nt-r-restart', t('notify.rRestart'), r.endpoint.restart);
    const rFw = switchRow('nt-r-fw', t('notify.rFirmware'), r.firmware.on);
    const rUpC = switchRow('nt-r-upc', t('notify.rUpdContainer'), r.updates.container);
    const rUpW = switchRow('nt-r-upw', t('notify.rUpdWeb'), r.updates.web);
    const rRec = switchRow('nt-r-rec', t('notify.rRecovery'), r.recovery.on);
    const collect = () => ({
      config: {
        enabled: master.box.checked, lang: lang.value,
        telegram: { enabled: tgOn.box.checked, chatId: tgChat.value },
        ha: { enabled: haOn.box.checked, url: haUrl.value, service: haSvc.value, insecure: haInsecure.box.checked },
        pushover: { enabled: poOn.box.checked, priority: Number(poPrio.value) },
        webhook: { enabled: whOn.box.checked, format: whFmt.value, insecure: whInsecure.box.checked },
        rules: { uploadMissing: { on: rUp.box.checked, minMinutes: Number(rUpMin.value) }, pingDown: { on: rPing.box.checked, seconds: Number(rPingS.value) }, endpoint: { on: rEp.box.checked, restart: rRestart.box.checked }, firmware: { on: rFw.box.checked }, updates: { container: rUpC.box.checked, web: rUpW.box.checked }, recovery: { on: rRec.box.checked } },
      },
      telegramToken: tgTok.value, haToken: haTok.value, webhookUrl: whUrl.value, webhookAuth: whAuth.value, pushoverUser: poUser.value, pushoverToken: poTok.value,
    });
    const save = async () => {
      const res = await api('notify', collect());
      if (res.status !== 200) { msg.replaceChildren(alert('error', errText(res.data))); return false; }
      // the secrets are write-only: empty the fields, but say that they are stored
      for (const el of [tgTok, haTok, whUrl, whAuth, poUser, poTok]) { if (el.value) el.placeholder = t('notify.tokenSet'); el.value = ''; }
      return true;
    };
    const testBtn = (ch) => { const b = h('button', { class: 'btn outline', type: 'button', text: t(`notify.test.${ch}`), on: { click: async () => {
      b.disabled = true;
      if (await save()) {
        const res = await api('notify/test', { channel: ch });
        msg.replaceChildren(res.data.ok ? alert('success', t('notify.testOk')) : alert('error', t('notify.testFail', { e: res.data.error || '?' })));
      }
      b.disabled = false;
    } } }); return b; };
    const clearBtn = (ch) => h('button', { class: 'linkbtn', type: 'button', text: t('notify.tokenRemove'), on: { click: async () => { await api('notify', { config: collect().config, clear: [ch] }); reload(); } } });
    const st = n.status;
    // The main switch is a pause button: the channels keep their settings but show as paused while it is off.
    // Switching a channel on switches the main switch on, since a channel that cannot send is a trap.
    const pausedNote = h('p', { class: 'small muted', text: t('notify.pausedNote') });
    const channelGrid = h('div', { class: 'grid' });
    const applyPause = () => { channelGrid.classList.toggle('paused', !master.box.checked); pausedNote.hidden = master.box.checked; };
    master.box.addEventListener('change', applyPause);
    for (const sw of [tgOn, haOn, poOn, whOn]) {
      sw.box.addEventListener('change', () => {
        if (sw.box.checked && !master.box.checked) { master.box.checked = true; applyPause(); msg.replaceChildren(alert('info', t('notify.autoOn'))); }
      });
    }
    const saveRow = () => { const b = h('button', { class: 'btn', type: 'button', text: t('devices.save'), on: { click: async () => { b.disabled = true; if (await save()) { msg.replaceChildren(alert('success', t('devices.saved'))); reload(); } b.disabled = false; } } }); return b; };
    return [
      h('div', { class: 'grid' }, card('orange', 'refresh', t('notify.title'), h('div', {},
        h('p', { class: 'small muted', text: t('notify.intro') }), msg, master.node, field(t('notify.lang'), lang), saveRow(),
        kv([[t('notify.lastSent'), when(st.lastSent)], [t('notify.queue'), String(st.queue)], [t('notify.open'), st.active.length ? st.active.map((a) => `${t(`notify.kind.${a.kind}`)} ${clock(a.since)}`).join(', ') : t('notify.none')], st.lastError ? [t('notify.lastError'), `${st.lastError.channel}: ${st.lastError.error}`] : null].filter(Boolean)))),
      card('green', 'info', t('notify.rules'), h('div', {}, rUp.node, field(t('notify.rUploadMin'), rUpMin, t('notify.rUploadHelp')), rPing.node, field(t('notify.rPingS'), rPingS), rEp.node, rRestart.node, rFw.node, rUpC.node, rUpW.node, h('p', { class: 'small muted', text: t('notify.rUpdHelp') }), rRec.node, saveRow()))),
      h('h3', { class: 'page', text: t('notify.channels') }),
      pausedNote,
      (channelGrid.append(
        card('blue', 'info', t('notify.telegram'), h('div', {}, tgOn.node, field(t('notify.chatId'), tgChat, t('notify.chatIdHelp')), field(t('notify.botToken'), tgTok, t('notify.tokenHelp')), h('p', { class: 'small' }, h('a', { href: `https://github.com/sphings79/marstek-offline-endpoint/blob/main/docs/TELEGRAM${state.lang === 'de' ? '.de' : ''}.md`, target: '_blank', rel: 'noopener noreferrer', text: t('notify.tgGuide') })), n.secrets.telegram ? h('p', { class: 'small' }, clearBtn('telegram')) : null, h('div', { class: 'row-gap' }, saveRow(), ' ', testBtn('telegram')))),
        card('orange', 'bell', t('notify.pushover'), h('div', {}, poOn.node, field(t('notify.poUser'), poUser, t('notify.poUserHelp')), field(t('notify.poToken'), poTok, t('notify.poTokenHelp')), field(t('notify.poPrio'), poPrio, t('notify.poPrioHelp')), n.secrets.pushover ? h('p', { class: 'small' }, clearBtn('pushover')) : null, h('div', { class: 'row-gap' }, saveRow(), ' ', testBtn('pushover')))),
        card('info', 'shield', t('notify.ha'), h('div', {}, haOn.node, field(t('notify.haUrl'), haUrl), field(t('notify.haService'), haSvc, t('notify.haServiceHelp')), field(t('notify.haToken'), haTok, t('notify.haTokenHelp')), haInsecure.node, n.secrets.ha ? h('p', { class: 'small' }, clearBtn('ha')) : null, h('div', { class: 'row-gap' }, saveRow(), ' ', testBtn('ha')))),
        card('purple', 'download', t('notify.webhook'), h('div', {}, whOn.node, field(t('notify.whUrl'), whUrl, t('notify.whUrlHelp')), field(t('notify.whAuth'), whAuth, t('notify.whAuthHelp')), field(t('notify.whFormat'), whFmt, t('notify.whFormatHelp')), whInsecure.node, n.secrets.webhook ? h('p', { class: 'small' }, clearBtn('webhook')) : null, h('div', { class: 'row-gap' }, saveRow(), ' ', testBtn('webhook'))))
      ), applyPause(), channelGrid),
    ];
  }

  /** Page: notifications, one card per channel plus the rules. */
  async function notificationsView(root) {
    const wrap = h('div', {});
    root.appendChild(wrap);
    async function load() {
      const { status, data } = await api('notify');
      if (status !== 200 || !data.config) return;
      wrap.replaceChildren(h('h2', { class: 'page', text: t('nav.notifications') }), ...notifyCard(data, load));
    }
    await load();
  }

  /** MQTT: health values for Home Assistant through discovery. */
  function mqttCard(m, reload) {
    const c = m.config;
    const msg = h('div', {});
    const on = switchRow('mq-on', t('mqtt.enable'), c.enabled);
    const host = h('input', { type: 'text', value: c.host, placeholder: 'homeassistant.local', autocomplete: 'off' });
    const port = h('input', { type: 'number', min: '1', max: '65535', value: String(c.port) });
    const tlsOn = switchRow('mq-tls', t('mqtt.tls'), c.tls);
    const insecure = switchRow('mq-insecure', t('mqtt.insecure'), c.insecure);
    const user = h('input', { type: 'text', value: c.username, autocomplete: 'off' });
    const pass = h('input', { type: 'password', autocomplete: 'off', placeholder: m.secrets.password ? t('notify.tokenSet') : '' });
    const prefix = h('input', { type: 'text', value: c.topicPrefix, autocomplete: 'off' });
    const disc = h('input', { type: 'text', value: c.discoveryPrefix, autocomplete: 'off' });
    const meas = c.measurements || { mode: 'off', categories: [] };
    const pv = m.preview || {};
    const mMode = h('select', {}, ['off', 'extra', 'all', 'custom'].map((v) => h('option', { value: v, text: `${t(`mqtt.mode.${v}`)}${v !== 'off' && pv[v] !== undefined ? ` (${pv[v]})` : ''}` })));
    mMode.value = meas.mode;
    const mCats = CATS.map((k) => ({ k, sw: switchRow(`mq-cat-${k}`, t(`meas.cat.${k}`), meas.categories.includes(k)) }));
    const collect = () => ({ config: { enabled: on.box.checked, host: host.value, port: Number(port.value), tls: tlsOn.box.checked, insecure: insecure.box.checked, username: user.value, topicPrefix: prefix.value, discoveryPrefix: disc.value, measurements: { mode: mMode.value, categories: mCats.filter((x) => x.sw.box.checked).map((x) => x.k) } }, password: pass.value });
    const save = async () => { const res = await api('mqtt', collect()); if (res.status !== 200) { msg.replaceChildren(alert('error', errText(res.data))); return false; } if (pass.value) pass.placeholder = t('notify.tokenSet'); pass.value = ''; return true; };
    const saveBtn = h('button', { class: 'btn', type: 'button', text: t('devices.save'), on: { click: async () => { saveBtn.disabled = true; if (await save()) { msg.replaceChildren(alert('success', t('devices.saved'))); reload(); } saveBtn.disabled = false; } } });
    const testBtn = h('button', { class: 'btn outline', type: 'button', text: t('mqtt.test'), on: { click: async () => {
      testBtn.disabled = true;
      if (await save()) {
        const res = await api('mqtt/test', {});
        msg.replaceChildren(res.data.ok ? alert('success', t('mqtt.testOk')) : alert('error', t('mqtt.testFail', { e: res.data.error || '?' })));
      }
      testBtn.disabled = false;
    } } });
    const clear = m.secrets.password ? h('p', { class: 'small' }, h('button', { class: 'linkbtn', type: 'button', text: t('notify.tokenRemove'), on: { click: async () => { await api('mqtt', { config: collect().config, clearPassword: true }); reload(); } } })) : null;
    const st = m.status;
    const saveRow = () => { const b = h('button', { class: 'btn', type: 'button', text: t('devices.save'), on: { click: async () => { b.disabled = true; if (await save()) { msg.replaceChildren(alert('success', t('devices.saved'))); reload(); } b.disabled = false; } } }); return b; };
    const list = (items) => h('ul', { class: 'bullets' }, items.map((x) => h('li', { text: x })));
    return [
      h('p', { class: 'muted', text: t('mqtt.intro') }), msg,
      h('div', { class: 'grid' },
        card('purple', 'storage', t('mqtt.connection'), h('div', {}, on.node, field(t('mqtt.host'), host), field(t('mqtt.port'), port), tlsOn.node, insecure.node, field(t('mqtt.user'), user), field(t('mqtt.password'), pass, t('notify.tokenHelp')), clear, h('div', { class: 'row-gap' }, saveRow(), ' ', testBtn))),
        card('blue', 'tune', t('mqtt.topics'), h('div', {}, field(t('mqtt.prefix'), prefix, t('mqtt.prefixHelp')), field(t('mqtt.discovery'), disc, t('mqtt.discoveryHelp')), h('div', { class: 'row-gap' }, saveRow()))),
        card(st.connected ? 'green' : 'grey', 'info', t('mqtt.state'), kv([[t('mqtt.state'), st.connected ? t('mqtt.connected') : t('mqtt.disconnected')], [t('mqtt.lastPublish'), when(st.lastPublish)], st.lastError ? [t('notify.lastError'), String(st.lastError)] : null].filter(Boolean))),
        card('orange', 'storage', t('mqtt.measurements'), h('div', {},
          h('p', { class: 'small muted', text: t('mqtt.measurementsHelp') }),
          field(t('mqtt.mmode'), mMode, t('mqtt.mmodeHelp')),
          (() => {
            const wrapCats = h('div', {}, h('div', { class: 'section', text: t('mqtt.mcats') }), h('div', { class: 'mcats' }, mCats.map((x) => x.sw.node)));
            const wrapPick = h('p', { class: 'small' }, t('mqtt.pickHelp'), ' ', h('a', { href: '#/measurements', text: t('nav.measurements') }));
            const sync = () => { wrapCats.hidden = mMode.value === 'custom'; wrapPick.hidden = mMode.value !== 'custom'; };
            mMode.addEventListener('change', sync);
            sync();
            return h('div', {}, wrapCats, wrapPick);
          })(),
          h('p', { class: 'small muted', text: t('mqtt.preview', { cur: m.preview.current, extra: m.preview.extra, all: m.preview.all, n: m.preview.devices }) }),
          h('div', { class: 'row-gap' }, saveRow()))),
        card('info', 'info', t('mqtt.publishes'), h('div', {}, h('div', { class: 'section', text: `${t('mqtt.always')}: ${t('mqtt.perDevice')}` }), list(t('mqtt.deviceItems').split('|')), h('div', { class: 'section', text: `${t('mqtt.always')}: ${t('mqtt.perEndpoint')}` }), list(t('mqtt.endpointItems').split('|')), h('div', { class: 'section', text: t('mqtt.optional') }), list([t('mqtt.optionalItems')]), h('p', { class: 'small muted', text: t('mqtt.onlyReports') })))),
    ];
  }

  /** Page: MQTT for Home Assistant. */
  async function mqttView(root) {
    const wrap = h('div', {});
    root.appendChild(wrap);
    async function load() {
      const { status, data } = await api('mqtt');
      if (status !== 200 || !data.config) return;
      wrap.replaceChildren(h('h2', { class: 'page', text: t('nav.mqtt') }), ...mqttCard(data, load));
    }
    await load();
    // keep the connection state fresh while the page is open
    const timer = setInterval(() => { if (!wrap.isConnected) clearInterval(timer); else if (!wrap.contains(document.activeElement) || document.activeElement === document.body) load(); }, 15000);
  }

  async function settingsView(root) {
    let [{ data: s }, { data: u }, { data: ov }, { data: meas }] = await Promise.all([api('settings'), api('updates'), api('overview'), api('measurements')]);
    if (!s || s.retentionDays === undefined) return;
    // switched on but never asked yet: ask now instead of showing an empty card
    if (u.enabled && !u.checkedAt) {
      const r = await api('updates/check', {});
      if (r.status === 200) u = r.data;
    }
    const days = h('input', { type: 'number', min: '1', max: '365', step: '1', value: String(s.retentionDays) });
    const retMsg = h('div', {});
    const used = h('dd', { text: `${t('system.files', { n: s.disk.files })} · ${bytes(s.disk.bytes)}` });
    const apply = h('button', { class: 'btn', type: 'button', text: t('settings.apply'), on: { click: async () => {
      const r = await api('settings', { retentionDays: Number(days.value) });
      if (r.status === 200) {
        used.textContent = `${t('system.files', { n: r.data.disk.files })} · ${bytes(r.data.disk.bytes)}`;
        retMsg.replaceChildren(alert('success', t('devices.saved')));
      } else retMsg.replaceChildren(alert('error', errText(r.data)));
    } } });

    const cur = h('input', { type: 'password', autocomplete: 'current-password' });
    const nw = h('input', { type: 'password', autocomplete: 'new-password' });
    const nw2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const pwMsg = h('div', {});
    const min = state.session.minLength || 8;
    const change = h('button', { class: 'btn', type: 'button', disabled: true, text: t('settings.changePassword'), on: { click: async () => {
      change.disabled = true;
      const r = await api('password', { current: cur.value, next: nw.value });
      if (r.status === 200) {
        pwMsg.replaceChildren(alert('success', t('settings.passwordChanged')));
        cur.value = ''; nw.value = ''; nw2.value = '';
      } else {
        pwMsg.replaceChildren(alert('error', errText(r.data)));
        change.disabled = false;
      }
    } } });
    const check = () => { change.disabled = !(cur.value && nw.value.length >= min && nw.value === nw2.value); };
    [cur, nw, nw2].forEach((i) => i.addEventListener('input', check));

    // last sign-in and failed attempts (as seen when this session started)
    const lg = state.session.login || {};
    const prev = lg.previous;
    const nFailed = lg.failed ? lg.failed.count : 0;
    const signIn = card('grey', 'lock', t('settings.securityTitle'), h('div', {},
      kv([
        [t('login.last'), prev ? `${clock(prev.ts)} · ${t('login.from', { ip: prev.ip })}` : t('login.first')],
        [t('login.lastFailed'), nFailed && lg.failed.lastTs ? `${clock(lg.failed.lastTs)} · ${t('login.from', { ip: lg.failed.lastIp })}` : '–'],
      ], { stack: true }),
      h('p', { class: nFailed ? 'late' : 'muted small', text: nFailed ? t(nFailed === 1 ? 'login.failed1' : 'login.failedN', { n: nFailed }) : t('login.noneFailed') })));

    const p = s.paths;
    // storage: what is in the data folder, by kind, and what is left on the volume
    const sg = s.storage;
    const KINDS = [['logs', 'var(--c-line)'], ['database', 'var(--c-ok)'], ['settings', 'var(--c-warn)'], ['other', 'var(--c-text2)']];
    const usedBytes = KINDS.reduce((sum, [k]) => sum + sg.groups[k].bytes, 0);
    const storageCard = card('purple', 'storage', t('storage.title'), h('div', {},
      usedBytes > 0 ? h('div', { class: 'stackbar', role: 'img', 'aria-label': t('storage.title') }, KINDS.filter(([k]) => sg.groups[k].bytes > 0).map(([k, color]) => {
        const seg = h('span', { title: `${t(`storage.${k}`)}: ${bytes(sg.groups[k].bytes)}` });
        seg.style.width = `${Math.max(1, (sg.groups[k].bytes / usedBytes) * 100)}%`;
        seg.style.background = color;
        return seg;
      })) : null,
      h('table', { class: 'list' }, h('tbody', {}, KINDS.map(([k, color]) => h('tr', {},
        h('td', {}, (() => { const d = h('span', { class: 'dot' }); d.style.background = color; return d; })(), t(`storage.${k}`)),
        h('td', { class: 'num', text: t('system.files', { n: sg.groups[k].files }) }),
        h('td', { class: 'num', text: bytes(sg.groups[k].bytes) }))))),
      kv([[t('storage.total'), bytes(usedBytes)], sg.disk ? [t('storage.free'), `${bytes(sg.disk.free)} ${t('storage.of')} ${bytes(sg.disk.total)}`] : null].filter(Boolean)),
      sg.files.length ? h('div', { class: 'section', text: t('settings.fileList') }) : null,
      sg.files.length ? kv(sg.files.map((f) => [h('span', { class: 'mono', text: f.name }), `${bytes(f.size)} · ${clock(f.mtime)}`]), { stack: true }) : null,
      h('p', { class: 'small muted', text: t('storage.logHelp') })));
    const filesCard = card('grey', 'folder', t('settings.filesTitle'), h('div', {},
      kv([
        [t('settings.dataDir'), h('span', { class: 'mono', text: p.dataDir })],
        [t('settings.hostDir'), p.hostDataDir ? h('span', { class: 'mono', text: p.hostDataDir }) : t('settings.hostUnknown')],
        [t('settings.certDir'), p.hostCertDir ? h('span', { class: 'mono', text: p.hostCertDir }) : t('settings.hostUnknown')],
        [t('settings.logFiles'), `${t('system.files', { n: p.logs.files })} · ${bytes(p.logs.bytes)}`],
      ], { stack: true }),
      h('p', { class: 'small muted', text: t('settings.logHelp') }),
      h('p', { class: 'small muted', text: t('settings.resetHelp') }),
      h('p', { class: 'small', text: t('settings.proxyHelp') })));

    const reload = () => { render(); };
    const l = s.listener;
    root.appendChild(h('div', {},
      h('h2', { class: 'page', text: t('settings.title') }),
      h('div', { class: 'grid' },
        ...updatesCards(u, reload),
        supportCard((ov && ov.devices) || []),
        measurementsCard(meas || { available: false }, reload),
        card('orange', 'storage', t('settings.retentionTitle'), h('div', {},
          retMsg,
          field(t('settings.retentionDays'), days, t('settings.retentionHelp')),
          h('dl', { class: 'kv' }, h('dt', { text: t('settings.used') }), used),
          apply)),
        signIn,
        card('grey', 'shield', t('settings.passwordTitle'), h('div', {},
          pwMsg,
          field(t('settings.current'), cur),
          field(t('settings.next'), nw, t('auth.tooShort', { n: min })),
          field(t('auth.repeat'), nw2, t('settings.passwordHelp')),
          change)),
        storageCard,
        filesCard,
        card('grey', 'lan', t('settings.listenerTitle'), h('div', {},
          kv([
            [t('settings.port'), String(l.port)],
            [t('settings.tls'), t(l.tls ? 'settings.tlsOn' : 'settings.tlsOff')],
            [t('settings.basePath'), l.basePath],
            [t('settings.proxies'), l.trustProxy.length ? l.trustProxy.join(', ') : t('settings.none')],
          ]),
          h('p', { class: 'small muted', text: t('settings.listenerHelp') }))))));
  }

  // --- notices ------------------------------------------------------------------
  const dismissed = { login: false, update: null };

  function loginBanner() {
    const l = state.session.login;
    if (!l || !l.failed || !l.failed.count || dismissed.login) return null;
    const n = l.failed.count;
    const prev = l.previous ? `${clock(l.previous.ts)}` : '';
    const text = `${t('login.bannerPre')}${prev ? ` (${prev})` : ''}: ${t(n === 1 ? 'login.bannerFailed1' : 'login.bannerFailedN', { n })}. ${t('login.lastFailed')}: ${clock(l.failed.lastTs)} ${t('login.from', { ip: l.failed.lastIp })}.`;
    const box = alert('warning', text);
    box.appendChild(document.createTextNode(' '));
    box.appendChild(h('button', { class: 'linkbtn', type: 'button', text: t('login.ok'), on: { click: () => { dismissed.login = true; box.remove(); } } }));
    return box;
  }
  function webUpdateBanner(tag) {
    if (!tag || dismissed.webUpdate === tag) return null;
    const box = alert('info', `${t('updates.webBanner', { tag })} `);
    box.appendChild(h('button', { class: 'linkbtn', type: 'button', text: t('updates.webInstall'), on: { click: () => { location.hash = '#/settings'; } } }));
    box.appendChild(document.createTextNode(' · '));
    box.appendChild(h('button', { class: 'linkbtn', type: 'button', text: t('login.dismiss'), on: { click: () => { dismissed.webUpdate = tag; box.remove(); } } }));
    return box;
  }
  function updateBanner(tag) {
    if (!tag || dismissed.update === tag) return null;
    const box = alert('info', `${t('updates.banner', { tag })} `);
    box.appendChild(h('button', { class: 'linkbtn', type: 'button', text: t('updates.see'), on: { click: () => { location.hash = '#/settings'; } } }));
    box.appendChild(document.createTextNode(' · '));
    box.appendChild(h('button', { class: 'linkbtn', type: 'button', text: t('login.dismiss'), on: { click: () => { dismissed.update = tag; box.remove(); } } }));
    return box;
  }

  // --- shell -------------------------------------------------------------------
  /** The footer links, shared by the page footer (desktop) and the burger menu (phones). */
  function footerLinks() {
    return [
      { href: 'https://github.com/sphings79/marstek-offline-endpoint', label: t('footer.star'), icon: 'star', strong: true },
      { href: 'https://buymeacoffee.com/sphings', label: t('footer.coffee'), icon: 'coffee', strong: true },
      { href: 'https://sphings-dev.de/', label: 'More tools' },
      { href: 'https://github.com/sphings79/marstek-modbus-suite', label: 'Modbus Suite (Home Assistant)' },
      { href: 'https://github.com/sphings79/marstek-ble-control', label: 'BLE Control' },
      { href: 'https://github.com/sphings79/marstek-ble-bridge', label: 'BLE Bridge' },
      { href: 'https://github.com/sphings79/marstek-firmware-archiv', label: 'Firmware Archive' },
      { href: 'https://github.com/sphings79/Marstek-Venus-Firmware-Reverse-Engineering', label: 'Reverse Engineering' },
    ];
  }

  async function signOut() {
    await api('logout', {});
    await loadSession();
    location.hash = '#/';
    render();
  }

  function topbar(route) {
    const authed = state.session.authenticated;
    const tab = (hash, label, ic, active) => h('button', { class: `tab${active ? ' active' : ''}`, type: 'button', on: { click: () => { location.hash = hash; } } }, icon(ic), label);
    const logout = h('button', { class: 'tab', type: 'button', title: t('nav.logout'), on: { click: signOut } }, icon('logout'), h('span', { class: 'lbl', text: t('nav.logout') }));

    // phones: one burger button, everything else (navigation, language, sign out, footer links) in the menu
    const menu = h('nav', { class: 'menu', id: 'menu', hidden: true, 'aria-label': t('appTitle') });
    const btn = h('button', { class: 'menu-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'menu', 'aria-label': 'Menu' }, icon('menu'));
    let open = false;
    const setOpen = (v) => {
      open = v;
      menu.hidden = !v;
      btn.setAttribute('aria-expanded', String(v));
      btn.replaceChildren(icon(v ? 'close' : 'menu'));
      if (v) (menu.querySelector('.menu-item') || btn).focus();
    };
    btn.addEventListener('click', () => setOpen(!open));
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setOpen(false); btn.focus(); } });
    const item = (label, ic, onClick, active) => h('button', { class: `menu-item${active ? ' active' : ''}`, type: 'button', on: { click: () => { setOpen(false); onClick(); } } }, icon(ic), label);
    if (authed) {
      menu.append(
        item(t('nav.devices'), 'battery', () => { location.hash = '#/'; }, route.name === 'overview' || route.name === 'device'),
        item(t('nav.measurements'), 'storage', () => { location.hash = '#/measurements'; }, route.name === 'measurements'),
        item(t('nav.notifications'), 'bell', () => { location.hash = '#/notifications'; }, route.name === 'notifications'),
        item(t('nav.mqtt'), 'refresh', () => { location.hash = '#/mqtt'; }, route.name === 'mqtt'),
        item(t('nav.settings'), 'tune', () => { location.hash = '#/settings'; }, route.name === 'settings'));
    }
    menu.append(item(`${t('updates.notesLink')} (${verLabel(state.session.version || '')})`, 'info', () => openChangelog()));
    menu.append(h('div', { class: 'small muted menu-note menu-head', text: t('theme.title') }));
    for (const v of THEMES) menu.append(item(t(`theme.${v}`), v, () => chooseTheme(v), themeNow() === v));
    menu.append(h('hr', { class: 'sep' }));
    menu.append(item(state.lang === 'de' ? 'Deutsch → English' : 'English → Deutsch', 'refresh', () => toggleLang()));
    if (authed) menu.append(item(t('nav.logout'), 'logout', signOut));
    menu.append(h('hr', { class: 'sep' }));
    for (const l of footerLinks()) {
      menu.append(h('a', { class: `menu-item${l.strong ? ' strong' : ''}`, href: l.href, target: '_blank', rel: 'noopener noreferrer' }, l.icon ? icon(l.icon) : h('span', { class: 'icon-gap' }), l.label));
    }
    menu.append(h('div', { class: 'small muted menu-note', text: t('footer.community') }));
    state.menu = { menu, btn, close: () => setOpen(false), isOpen: () => open };

    return h('div', { class: 'topbar' },
      btn,
      h('a', { class: 'brand', href: '#/', 'aria-label': t('appTitle') },
        h('img', { class: 'logo', src: 'favicon.svg', alt: '', width: '32', height: '32' }),
        h('span', { class: 'brand-text' }, h('span', { class: 'title', text: t('appTitle') }), h('span', { class: 'sub', text: verLabel(state.session.version || '') }))),
      authed
        ? h('div', { class: 'tabs' },
          tab('#/', t('nav.devices'), 'battery', route.name === 'overview' || route.name === 'device'),
          tab('#/measurements', t('nav.measurements'), 'storage', route.name === 'measurements'),
          tab('#/notifications', t('nav.notifications'), 'bell', route.name === 'notifications'),
          tab('#/mqtt', t('nav.mqtt'), 'refresh', route.name === 'mqtt'),
          tab('#/settings', t('nav.settings'), 'tune', route.name === 'settings'))
        : null,
      h('div', { class: 'actions' }, themeButton(), langButton(), authed ? logout : null),
      menu);
  }
  function toggleLang() {
    state.lang = state.lang === 'de' ? 'en' : 'de';
    try { localStorage.setItem('mep_lang', state.lang); } catch { /* private mode */ }
    document.documentElement.lang = state.lang;
    render();
  }
  const THEMES = ['system', 'light', 'dark'];
  const themeNow = () => (window.MEP_THEME ? window.MEP_THEME.get() : 'system');
  function chooseTheme(v) {
    window.MEP_THEME.set(v);
    render();
  }
  /** Icon button that opens a small popup with the three choices; the icon shows the current one. */
  function themeButton() {
    const label = `${t('theme.title')}: ${t(`theme.${themeNow()}`)}`;
    const pop = h('div', { class: 'popover', role: 'menu', hidden: true },
      THEMES.map((v) => h('button', { class: `pop-item${themeNow() === v ? ' on' : ''}`, type: 'button', role: 'menuitemradio', 'aria-checked': String(themeNow() === v), on: { click: () => chooseTheme(v) } },
        icon(v), h('span', { class: 'grow', text: t(`theme.${v}`) }), themeNow() === v ? icon('check') : null)));
    const btn = h('button', { class: 'tab', type: 'button', title: label, 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon(themeNow()));
    let open = false;
    const setOpen = (v) => {
      open = v;
      pop.hidden = !v;
      btn.setAttribute('aria-expanded', String(v));
    };
    btn.addEventListener('click', () => setOpen(!open));
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setOpen(false); btn.focus(); } });
    state.themePop = { pop, btn, close: () => setOpen(false), isOpen: () => open };
    return h('div', { class: 'popwrap' }, btn, pop);
  }
  function langButton() {
    return h('button', { class: 'tab', type: 'button', title: t('settings.language'), text: state.lang === 'de' ? 'DE · EN' : 'EN · DE', on: { click: toggleLang } });
  }
  function footer() {
    const link = (l) => h('a', { href: l.href, target: '_blank', rel: 'noopener noreferrer', class: l.strong ? 'strong' : null }, l.icon ? [icon(l.icon), ` ${l.label}`] : l.label);
    return h('footer', {},
      h('div', { class: 'foot-links' },
        h('button', { class: 'linkbtn strong', type: 'button', on: { click: openChangelog } }, `${verLabel(state.session.version || '')} · ${t('updates.notesLink')}`),
        footerLinks().map(link)),
      h('div', { class: 'small', text: t('footer.community') }));
  }

  function parseRoute() {
    const hash = location.hash || '#/';
    const dev = /^#\/device\/([0-9A-Za-z]+)$/.exec(hash);
    if (dev) return { name: 'device', uid: dev[1] };
    if (hash === '#/settings') return { name: 'settings' };
    if (hash === '#/measurements') return { name: 'measurements' };
    if (hash === '#/notifications') return { name: 'notifications' };
    if (hash === '#/mqtt') return { name: 'mqtt' };
    return { name: 'overview' };
  }

  async function render() {
    clearInterval(state.timer);
    const app = document.getElementById('app');
    document.title = t('appTitle');
    if (!state.session) {
      await loadSession();
    }
    const route = parseRoute();
    const main = h('main', {});
    app.replaceChildren(topbar(route), main, footer());
    if (!state.session.claimed || !state.session.authenticated) {
      main.appendChild(loginView());
      return;
    }
    const fl = flash();
    if (fl) main.appendChild(fl);
    const lb = loginBanner();
    if (lb) main.appendChild(lb);
    if (route.name === 'device') await deviceView(main, route.uid);
    else if (route.name === 'settings') await settingsView(main);
    else if (route.name === 'measurements') await measurementsView(main);
    else if (route.name === 'notifications') await notificationsView(main);
    else if (route.name === 'mqtt') await mqttView(main);
    else await overviewView(main);
  }

  // one listener for the burger menu: a click anywhere else closes it
  document.addEventListener('click', (e) => {
    const m = state.menu;
    const tp = state.themePop;
    // composedPath is fixed at dispatch time: the burger swaps its own icon while it handles the click,
    // so e.target may already be detached from the button by the time this listener runs
    const path = e.composedPath();
    if (m && m.isOpen() && !path.includes(m.menu) && !path.includes(m.btn)) m.close();
    if (tp && tp.isOpen() && !path.includes(tp.pop) && !path.includes(tp.btn)) tp.close();
  });
  window.addEventListener('hashchange', render);
  document.documentElement.lang = state.lang;
  render();
})();
