/* Calling Seva — volunteer calling PWA
 * Backend: Google Apps Script web app over a Google Sheet.
 * Setup arrives as a link/QR:  <app url>#setup=<base64url {"e": endpoint, "c": google client id, "n": org name}>
 * Nothing about the endpoint is stored in this code.
 */
'use strict';

const VERSION = '1.2.0';
const RECENT_DEFAULT_H = 24;
const PENDING_MAX_MS = 3 * 3600e3;

/* ───────── storage (never throws) ───────── */
const store = {
  get(k, d) { try { const v = localStorage.getItem('seva:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('seva:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  del(k) { try { localStorage.removeItem('seva:' + k); } catch (e) { /* ignore */ } }
};

const S = {
  cfg: store.get('cfg', null),          // {e, c, n}
  session: store.get('session', null),
  user: store.get('user', null),        // {email, name}
  data: store.get('data', null),        // last bootstrap state
  outbox: store.get('outbox', []),      // unsent call logs
  failed: store.get('failed', []),      // logs the server refused
  pending: store.get('pending', null),  // call in progress {campaign_id, contact_id, t}
  device: store.get('device', null),
  view: null,
  syncing: false,
  loading: false,
  online: navigator.onLine,
  installPrompt: null,
  lastRefresh: 0
};
if (!S.device) {
  const ua = navigator.userAgent;
  const kind = /iphone|ipad/i.test(ua) ? 'iPhone' : /android/i.test(ua) ? 'Android' : 'Browser';
  S.device = kind + '-' + Math.random().toString(36).slice(2, 6);
  store.set('device', S.device);
}
const save = (...keys) => keys.forEach(k => store.set(k, S[k]));

/* ───────── small helpers ───────── */
const $ = sel => document.querySelector(sel);
const app = () => $('#app');
const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'them';

const ICON = {
  phone: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/></svg>',
  wa: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1 2.7.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>',
  mark: '<svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="27" fill="#e8a317"/><path fill="#2b3670" d="M20.3 24.3a19 19 0 0 0 8.4 8.4l2.8-2.8c.4-.4.9-.5 1.3-.3 1.4.5 2.9.7 4.5.7.7 0 1.3.6 1.3 1.3v4.4c0 .7-.6 1.3-1.3 1.3A21.4 21.4 0 0 1 15.9 16c0-.7.6-1.3 1.3-1.3h4.4c.7 0 1.3.6 1.3 1.3 0 1.6.2 3.1.7 4.5.1.4 0 .9-.3 1.3z"/></svg>'
};

function fmtPhone(p) {
  const s = String(p || '');
  const m = s.match(/^\+91(\d{5})(\d{5})$/);
  return m ? '+91 ' + m[1] + ' ' + m[2] : s;
}
function telHref(p) { return 'tel:' + String(p || '').replace(/[^\d+]/g, ''); }
function waHref(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;
  return 'https://wa.me/' + d;
}
function ago(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const m = Math.round(diff / 60000);
  if (diff < 0) return 'in ' + when(ms);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return d + ' days ago';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function when(ms) {
  const d = new Date(ms);
  const now = new Date();
  const tom = new Date(now); tom.setDate(now.getDate() + 1);
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'today ' + t;
  if (d.toDateString() === tom.toDateString()) return 'tomorrow ' + t;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + t;
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ───────── setup link ───────── */
function b64uDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function parseSetup(text) {
  const m = String(text || '').match(/setup=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const cfg = JSON.parse(b64uDecode(m[1]));
    if (!cfg.e || !/^https:\/\/|^http:\/\/localhost[:/]|^http:\/\/127\.0\.0\.1[:/]/.test(cfg.e)) return null;
    return { e: String(cfg.e), c: String(cfg.c || ''), n: String(cfg.n || 'Calling Seva') };
  } catch (e) { return null; }
}
function setupLink() {
  if (!S.cfg) return '';
  const json = JSON.stringify(S.cfg);
  const b = new TextEncoder().encode(json);
  let bin = '';
  b.forEach(x => { bin += String.fromCharCode(x); });
  return location.href.split('#')[0] + '#setup=' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function applySetup(cfg) {
  const changed = !S.cfg || S.cfg.e !== cfg.e;
  S.cfg = cfg;
  save('cfg');
  if (changed) {
    S.session = null; S.user = null; S.data = null;
    save('session', 'user', 'data');
  }
}

/* ───────── API ───────── */
async function api(action, payload = {}) {
  if (!S.cfg) throw Object.assign(new Error('Not set up'), { code: 'NO_CFG' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    // text/plain keeps this a "simple" request, so Apps Script needs no CORS preflight
    res = await fetch(S.cfg.e, {
      method: 'POST',
      body: JSON.stringify(Object.assign({ action, session: S.session }, payload)),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      signal: ctrl.signal
    });
  } catch (e) {
    throw Object.assign(new Error("Can't reach the server. Check your internet connection."), { code: 'NET' });
  } finally {
    clearTimeout(timer);
  }
  let j;
  try { j = await res.json(); } catch (e) {
    throw Object.assign(new Error('The server sent an unexpected reply. Check the Apps Script deployment is set to "Anyone".'), { code: 'BAD_REPLY' });
  }
  S.online = true;
  if (!j.ok) {
    const err = Object.assign(new Error(j.message || j.code), { code: j.code });
    if (j.code === 'AUTH') authLost(j.message);
    throw err;
  }
  return j;
}

function authLost(message) {
  S.session = null;
  S.data = null;
  save('session', 'data');
  nav('signin', { message: message || 'Please sign in again.' }, true);
}

function setState(state) {
  if (!state) return;
  S.data = state;
  S.user = state.user;
  S.lastRefresh = Date.now();
  save('data', 'user');
}

async function refresh(quiet) {
  if (!S.session || S.loading) return;
  S.loading = true;
  paintTopbarState();
  try {
    const r = await api('bootstrap');
    setState(r.state);
    rerender();
  } catch (e) {
    if (!quiet && e.code !== 'AUTH') toast(e.message, 3500);
  } finally {
    S.loading = false;
    paintTopbarState();
  }
}

/* ───────── outbox (calls saved on the phone until the server confirms) ───────── */
function myOutbox() { return S.outbox.filter(ev => S.user && ev.by === S.user.email); }

async function syncOutbox() {
  if (S.syncing || !S.session || !S.user) return;
  const evs = myOutbox();
  if (!evs.length) return;
  S.syncing = true;
  paintTopbarState();
  try {
    const batch = evs.slice(0, 25).map(ev => {
      const o = Object.assign({}, ev);
      delete o.by; delete o.contact_name; delete o.campaign_name;
      return o;
    });
    const r = await api('log', { events: batch });
    const done = new Set([].concat(r.accepted || [], r.dup || []));
    (r.rejected || []).forEach(x => {
      const ev = S.outbox.find(e => e.id === x.id);
      if (ev) S.failed.push(Object.assign({}, ev, { reason: x.reason }));
      done.add(x.id);
    });
    S.outbox = S.outbox.filter(ev => !done.has(ev.id));
    save('outbox', 'failed');
    setState(r.state);
    if ((r.rejected || []).length) toast((r.rejected.length === 1 ? '1 call' : r.rejected.length + ' calls') + " couldn't be saved. See Settings.", 4000);
    rerender();
    if (myOutbox().length) setTimeout(syncOutbox, 500);
  } catch (e) {
    // keep everything; we'll retry
  } finally {
    S.syncing = false;
    paintTopbarState();
  }
}
setInterval(() => { if (myOutbox().length) syncOutbox(); }, 20000);

/* ───────── derived data ───────── */
function campaign(id) { return S.data && S.data.campaigns.find(c => c.id === id); }
function isQueued(campaignId, contactId) {
  return S.outbox.some(ev => ev.campaign_id === campaignId && ev.contact_id === contactId);
}
function myClaims(campaignId) {
  if (!S.data) return [];
  const rank = c => c.state === 'callback' ? 0 : !c.state ? 1 : c.state === 'noanswer' ? 2 : 3;
  return S.data.claims
    .filter(c => (!campaignId || c.campaign_id === campaignId) && !isQueued(c.campaign_id, c.contact.contact_id))
    .sort((a, b) => rank(a) - rank(b) || (a.callback_at || a.last_called_at || 0) - (b.callback_at || b.last_called_at || 0));
}
function findClaim(campaignId, contactId) {
  return S.data && S.data.claims.find(c => c.campaign_id === campaignId && c.contact.contact_id === contactId);
}
function stateChip(c) {
  if (c.state === 'callback') {
    const due = !c.callback_at || c.callback_at <= Date.now();
    return `<span class="chip callback">${due ? 'Call back now' : 'Call back ' + esc(when(c.callback_at))}</span>`;
  }
  if (!c.state) return '<span class="chip new">New</span>';
  if (c.state === 'noanswer') return `<span class="chip noanswer">No answer${c.unreached > 1 ? ' ×' + c.unreached : ''}</span>`;
  return `<span class="chip retry">${esc(c.status || 'Called before')}</span>`;
}
/** Someone from the centre spoke to this person recently (any campaign)? */
function recentCall(c) {
  const hours = (S.data && S.data.recent_call_hours) || RECENT_DEFAULT_H;
  const cutoff = Date.now() - hours * 3600e3;
  const camp = campaign(c.campaign_id);
  const h = (c.history || []).find(x => x.at > cutoff);
  if (h) return { at: h.at, by: h.by, campaign: h.campaign, same: camp && h.campaign === camp.name };
  if (c.contact.last_contacted_at > cutoff) return { at: c.contact.last_contacted_at, by: c.contact.last_contacted_by, campaign: '' };
  return null;
}
function cardFacts(c, limit) {
  const vals = c.contact.values || {};
  const out = [];
  (S.data.fields || []).forEach(f => {
    if (!f.show_on_card || f.key === 'name' || f.key === 'phone' || f.type === 'note') return;
    const v = vals[f.key];
    if (v === '' || v === null || v === undefined || v === false) return;
    out.push({ label: f.label, value: v === true ? 'Yes' : String(v) });
  });
  return limit ? out.slice(0, limit) : out;
}

function noteFields() { return (S.data.fields || []).filter(f => f.type === 'note' && (f.show_on_card || f.editable)); }
function personNotesHtml(x) {
  return noteFields().filter(f => f.show_on_card).map(f => {
    const v = x.contact.values[f.key];
    return v ? `<div class="pnote-read"><div class="lbl">${esc(f.label)}</div><div class="txt">${esc(v)}</div></div>` : '';
  }).join('');
}
function timelineHtml(list, campName) {
  return `<ul class="timeline">${list.map(h => `<li><div class="when">${esc(ago(h.at))}, ${esc(h.by || 'someone')}${h.campaign && h.campaign !== campName ? ', ' + esc(h.campaign) : ''}</div><div class="what">${esc(h.status)}</div>${h.notes ? `<div class="said">${esc(h.notes)}</div>` : ''}</li>`).join('')}</ul>`;
}
function nextClaim(campaignId, exceptId) {
  return myClaims(campaignId).find(y => y.contact.contact_id !== exceptId) || null;
}

/* ───────── router ───────── */
function nav(view, params = {}, replace = false) {
  S.view = { view, params };
  const st = { view, params };
  try {
    if (replace) history.replaceState(st, '');
    else history.pushState(st, '');
  } catch (e) { /* ignore */ }
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', e => {
  if (e.state && e.state.view) { S.view = e.state; render(); }
  else { S.view = { view: startView(), params: {} }; render(); }
});
function startView() {
  if (!S.cfg) return 'setup';
  if (!S.session) return 'signin';
  return 'home';
}
function rerender() {
  // re-render the current view unless the person is typing in a form
  if (!S.view) return;
  if (S.view.view === 'log' || S.view.view === 'setup' || S.view.view === 'signin') return;
  render();
}
function render() {
  if (!S.view) S.view = { view: startView(), params: {} };
  const v = S.view.view;
  // guard routes
  if (v !== 'setup' && !S.cfg) { S.view = { view: 'setup', params: {} }; return render(); }
  if (!['setup', 'signin'].includes(v) && !S.session) { S.view = { view: 'signin', params: {} }; return render(); }
  const views = { setup: viewSetup, signin: viewSignin, home: viewHome, campaign: viewCampaign, contact: viewContact, log: viewLog, settings: viewSettings };
  (views[v] || viewHome)(S.view.params || {});
  paintTopbarState();
}

function topbar(title, sub, opts = {}) {
  const back = opts.back ? `<button class="iconbtn" data-act="back" aria-label="Back">${ICON.back}</button>` : '';
  const right = opts.noTools ? '' : `
    <button class="iconbtn" data-act="refresh" aria-label="Refresh" id="tb-refresh">${ICON.refresh}<span class="badge" id="tb-badge" hidden></span></button>
    <button class="iconbtn" data-act="settings" aria-label="Settings">${ICON.gear}</button>`;
  return `<header class="topbar">${back}<h1>${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</h1>${right}</header>`;
}
function paintTopbarState() {
  const b = $('#tb-badge');
  const r = $('#tb-refresh');
  if (!b || !r) return;
  const n = myOutbox().length;
  b.hidden = !n;
  b.textContent = n;
  r.classList.toggle('spin', S.loading || S.syncing);
  r.setAttribute('aria-label', n ? n + ' calls waiting to send. Tap to send and refresh.' : 'Refresh');
}
function bindTopbar(root) {
  root.querySelectorAll('[data-act="back"]').forEach(b => b.addEventListener('click', () => history.back()));
  root.querySelectorAll('[data-act="refresh"]').forEach(b => b.addEventListener('click', async () => { await syncOutbox(); await refresh(); }));
  root.querySelectorAll('[data-act="settings"]').forEach(b => b.addEventListener('click', () => nav('settings')));
}
function busy(btn, on) {
  if (!btn) return;
  btn.classList.toggle('busy', on);
  btn.disabled = on;
}

/* ───────── views: setup ───────── */
let scanStream = null;
function stopScan() {
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
}

function viewSetup(p) {
  stopScan();
  app().innerHTML = `
    <div class="screen">
      <section class="hero">
        <div class="mark">${ICON.mark}</div>
        <h1>Calling Seva</h1>
        <p>Open the setup link from your coordinator, or scan its QR code.</p>
      </section>
      <div class="panel">
        ${p.message ? `<p class="err">${esc(p.message)}</p>` : ''}
        <button class="btn primary" id="scan">Scan setup QR code</button>
        <video class="scan" id="video" playsinline muted hidden></video>
        <div class="field">
          <label for="paste">Or paste the setup link</label>
          <textarea class="input" id="paste" rows="3" placeholder="https://…#setup=…"></textarea>
        </div>
        <button class="btn" id="usepaste">Use this link</button>
        <p class="muted small">The link only tells the app where your centre's sheet is. You still sign in with your own Gmail.</p>
      </div>
    </div>`;
  $('#usepaste').addEventListener('click', () => trySetup($('#paste').value));
  $('#paste').addEventListener('input', e => { if (/setup=[A-Za-z0-9_-]{20,}/.test(e.target.value)) trySetup(e.target.value); });
  $('#scan').addEventListener('click', startScan);
}

async function trySetup(text) {
  const cfg = parseSetup(text);
  if (!cfg) { toast("That doesn't look like a setup link."); return; }
  stopScan();
  applySetup(cfg);
  nav(S.session ? 'home' : 'signin', {}, true);
  try {
    const r = await api('ping');
    if (r.name && r.name !== S.cfg.n) { S.cfg.n = r.name; save('cfg'); if (S.view.view === 'signin') render(); }
  } catch (e) {
    if (e.code === 'NET') toast("Saved. Couldn't reach the server yet — check your connection.", 4000);
    else toast(e.message, 4000);
  }
}

async function startScan() {
  const video = $('#video');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This browser cannot use the camera. Paste the link instead.'); return; }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (e) {
    toast('Camera permission was not given. Paste the link instead.', 3500);
    return;
  }
  video.hidden = false;
  video.srcObject = scanStream;
  await video.play().catch(() => {});
  let detect;
  if ('BarcodeDetector' in window) {
    try {
      const bd = new window.BarcodeDetector({ formats: ['qr_code'] });
      detect = async () => { const r = await bd.detect(video); return r[0] && r[0].rawValue; };
    } catch (e) { detect = null; }
  }
  if (!detect) {
    try { await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'); } catch (e) { toast("Couldn't load the QR reader. Paste the link instead."); stopScan(); return; }
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true });
    detect = async () => {
      if (!video.videoWidth) return null;
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      g.drawImage(video, 0, 0);
      const img = g.getImageData(0, 0, canvas.width, canvas.height);
      const r = window.jsQR(img.data, img.width, img.height);
      return r && r.data;
    };
  }
  const tick = async () => {
    if (!scanStream) return;
    try {
      const text = await detect();
      if (text && parseSetup(text)) { if (navigator.vibrate) navigator.vibrate(60); trySetup(text); return; }
    } catch (e) { /* keep scanning */ }
    setTimeout(tick, 250);
  };
  tick();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ───────── views: sign in ───────── */
function installTip() {
  if (isStandalone()) return '';
  if (S.installPrompt) return `<div class="alert info"><b>Install the app</b><br>So it opens from your home screen like any other app.<br><button class="btn primary" id="install" style="margin-top:10px">Install Calling Seva</button></div>`;
  if (isIOS()) return `<div class="alert info"><b>On iPhone: install first, then sign in</b>
      <ol class="steps small" style="margin-top:6px"><li>Tap <b>Copy setup link</b> below.</li><li>Tap Share, then <b>Add to Home Screen</b>.</li><li>Open Calling Seva from the home screen and paste the link.</li></ol>
      <button class="btn" id="copylink" style="margin-top:10px">Copy setup link</button></div>`;
  return '';
}
function bindInstallTip() {
  const ib = $('#install');
  if (ib) ib.addEventListener('click', async () => {
    const pr = S.installPrompt;
    S.installPrompt = null;
    pr.prompt();
    await pr.userChoice.catch(() => {});
    render();
  });
  const cl = $('#copylink');
  if (cl) cl.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(setupLink()); toast('Setup link copied'); }
    catch (e) { prompt('Copy this link', setupLink()); }
  });
}

function viewSignin(p) {
  const hasGoogle = S.cfg && S.cfg.c;
  app().innerHTML = `
    <div class="screen">
      <section class="hero">
        <div class="mark">${ICON.mark}</div>
        <h1>${esc((S.cfg && S.cfg.n) || 'Calling Seva')}</h1>
        <p>Sign in with the Gmail your coordinator added to the volunteer list.</p>
      </section>
      <div class="panel">
        ${p.message ? `<p class="err" id="signin-msg">${esc(p.message)}</p>` : '<p class="err" id="signin-msg" hidden></p>'}
        ${installTip()}
        ${hasGoogle ? '<div class="gbtn" id="gbtn"><span class="muted small">Loading Google sign-in…</span></div>' : '<p class="muted">Google sign-in is not set up for this centre yet. Use a sign-in code.</p>'}
        <div id="codeform" ${hasGoogle ? 'hidden' : ''}>
          <div class="field">
            <label for="code">Sign-in code</label>
            <input class="input codeinput" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••">
          </div>
          <button class="btn primary" id="usecode" style="margin-top:12px">Sign in with code</button>
          <p class="muted small">Get a code from the coordinator, or from Settings on another phone where you're already signed in.</p>
        </div>
        ${hasGoogle ? '<button class="linkbtn" id="showcode">Google sign-in not working? Use a code</button>' : ''}
        <button class="linkbtn" id="resetup">Use a different setup link</button>
      </div>
    </div>`;
  bindInstallTip();
  const sc = $('#showcode');
  if (sc) sc.addEventListener('click', () => { $('#codeform').hidden = false; sc.hidden = true; $('#code').focus(); });
  $('#resetup').addEventListener('click', () => nav('setup'));
  $('#usecode').addEventListener('click', async e => {
    const btn = e.currentTarget;
    const code = $('#code').value.replace(/\D/g, '');
    if (code.length !== 6) { signinError('The code has 6 digits.'); return; }
    busy(btn, true);
    try {
      const r = await api('redeemCode', { code, device: S.device });
      await signedIn(r);
    } catch (err) {
      signinError(err.message);
    } finally { busy(btn, false); }
  });
  if (hasGoogle) mountGoogleButton();
}

function signinError(msg) {
  const m = $('#signin-msg');
  if (m) { m.textContent = msg; m.hidden = false; }
}

async function mountGoogleButton() {
  try {
    await loadScript('https://accounts.google.com/gsi/client');
  } catch (e) {
    const g = $('#gbtn');
    if (g) g.innerHTML = '<span class="muted small">Google sign-in could not load. Check your connection, or use a code.</span>';
    return;
  }
  const g = $('#gbtn');
  if (!g || !window.google || !google.accounts) return;
  google.accounts.id.initialize({
    client_id: S.cfg.c,
    callback: onGoogleCredential,
    auto_select: false,
    cancel_on_tap_outside: true,
    ux_mode: 'popup',
    itp_support: true
  });
  g.innerHTML = '';
  google.accounts.id.renderButton(g, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', logo_alignment: 'left', width: Math.min(320, g.clientWidth || 300) });
}

async function onGoogleCredential(resp) {
  const g = $('#gbtn');
  if (g) g.innerHTML = '<span class="muted">Checking the volunteer list…</span>';
  try {
    const r = await api('login', { id_token: resp.credential, device: S.device });
    await signedIn(r);
  } catch (e) {
    signinError(e.message);
    mountGoogleButton();
  }
}

async function signedIn(r) {
  S.session = r.session;
  S.user = r.user;
  save('session', 'user');
  nav('home', {}, true);
  await syncOutbox();
  await refresh();
}

/* ───────── views: home ───────── */
function viewHome() {
  const d = S.data;
  const name = S.user ? firstName(S.user.name) : '';
  let body;
  if (!d) {
    body = `<div class="empty"><strong>Loading campaigns…</strong>Make sure you're online.</div>`;
  } else if (!d.campaigns.length) {
    body = `<div class="empty"><strong>No campaigns open for you</strong>The coordinator opens campaigns in the Sheet. Pull down or tap refresh later.</div>`;
  } else {
    body = `<div class="camps">` + d.campaigns.map(c => {
      const mine = myClaims(c.id).length;
      const k = c.counts || {};
      const meta = [];
      if (mine) meta.push(`<b>${mine} with you</b>`);
      if (k.later) meta.push(`${k.later} waiting for later`);
      if (k.done) meta.push(`${k.done} done`);
      return `<button class="camp" data-camp="${esc(c.id)}">
          <div><div class="name">${esc(c.name)}${c.type === 'one-off' ? '<span class="kind">one-off</span>' : ''}</div>
          <div class="meta">${meta.join(', ') || (k.total ? k.total + ' people' : 'No one added yet')}</div></div>
          <div class="due ${k.due ? '' : 'zero'}"><div class="n">${k.due || 0}</div><div class="l">to call</div></div>
        </button>`;
    }).join('') + `</div>`;
  }
  const queued = myOutbox().length;
  app().innerHTML = `<div class="screen">
      ${topbar((S.cfg && S.cfg.n) || 'Calling Seva')}
      <main>
        <p class="hello">${name ? 'Hi ' + esc(name) + '.' : ''} ${queued ? `${queued} call${queued > 1 ? 's' : ''} saved on this phone, sending when online.` : ''}</p>
        ${installTip()}
        ${body}
      </main></div>`;
  bindTopbar(app());
  bindInstallTip();
  app().querySelectorAll('[data-camp]').forEach(b => b.addEventListener('click', () => nav('campaign', { id: b.dataset.camp })));
  if (d && Date.now() - S.lastRefresh > 30000) refresh(true);
}

/* ───────── views: campaign ───────── */
function viewCampaign(p) {
  const c = campaign(p.id);
  if (!c) { nav('home', {}, true); return; }
  const list = myClaims(c.id);
  const k = c.counts || {};
  const room = Math.max(0, c.batch_size - list.length);
  const canGet = room > 0 && k.due > 0;
  const people = list.length ? `<div class="people">` + list.map(x => {
    const facts = cardFacts(x, 2).map(f => esc(f.value)).join(', ');
    const rc = recentCall(x);
    const note = x.last_note ? '“' + esc(x.last_note.slice(0, 70)) + (x.last_note.length > 70 ? '…' : '') + '”' : '';
    return `<button class="person" data-contact="${esc(x.contact.contact_id)}">
        <span class="nm">${esc(x.contact.name || fmtPhone(x.contact.phone))}</span>${stateChip(x)}
        <span class="ln">${rc && !rc.same ? `<span class="warn">Called ${esc(ago(rc.at))}${rc.campaign ? ' for ' + esc(rc.campaign) : ''}.</span> ` : ''}${facts}${facts && note ? '<br>' : ''}${note}</span>
      </button>`;
  }).join('') + `</div>`
    : `<div class="empty"><strong>${k.due ? 'Your list is empty' : 'Nobody to call right now'}</strong>${k.due ? `Tap "Get contacts" and the app reserves up to ${c.batch_size} people for you, so no one else calls them.` : (k.later ? `${k.later} people are waiting for a later call or a call-back time.` : 'Everyone in this campaign has been called.')}</div>`;

  app().innerHTML = `<div class="screen tall">
      ${topbar(c.name, c.type === 'one-off' ? 'One-off campaign' : '', { back: true })}
      <main>
        <div class="stats"><span><b>${k.due || 0}</b> to call</span><span><b>${k.later || 0}</b> later</span><span><b>${k.done || 0}</b> done</span>${c.end_date ? `<span>Ends ${esc(new Date(c.end_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</span>` : ''}</div>
        ${c.script ? `<details class="note"><summary>What to say</summary><div class="body">${esc(c.script)}</div></details>` : ''}
        <h2>Your list</h2>
        ${people}
      </main>
      <div class="bottombar"><div class="inner">
        <button class="btn primary" id="get" ${canGet ? '' : 'disabled'}>${canGet ? `Get ${Math.min(room, k.due)} contact${Math.min(room, k.due) > 1 ? 's' : ''}` : (room === 0 ? 'Call your list first' : 'Nobody due right now')}</button>
        ${list.length ? '<button class="btn ghost" id="giveback">Give my list back</button>' : ''}
      </div></div>
    </div>`;
  bindTopbar(app());
  app().querySelectorAll('[data-contact]').forEach(b => b.addEventListener('click', () => nav('contact', { campaign_id: c.id, contact_id: b.dataset.contact })));
  $('#get').addEventListener('click', async e => {
    const btn = e.currentTarget;
    busy(btn, true);
    try {
      const r = await api('claim', { campaign_id: c.id });
      setState(r.state);
      toast(r.given ? `${r.given} added to your list` : 'Nobody new to give right now');
    } catch (err) { toast(err.message, 3500); }
    finally { render(); }
  });
  const gb = $('#giveback');
  if (gb) gb.addEventListener('click', async e => {
    const btn = e.currentTarget;
    if (!confirm('Give these contacts back so other volunteers can call them?')) return;
    busy(btn, true);
    try {
      const r = await api('release', { campaign_id: c.id, contact_ids: list.map(x => x.contact.contact_id) });
      setState(r.state);
      toast('List given back');
    } catch (err) { toast(err.message, 3500); }
    finally { render(); }
  });
}

/* ───────── views: contact ───────── */
function viewContact(p) {
  const x = findClaim(p.campaign_id, p.contact_id);
  const c = campaign(p.campaign_id);
  if (!x || !c || isQueued(p.campaign_id, p.contact_id)) { nav('campaign', { id: p.campaign_id }, true); return; }
  const nm = x.contact.name || 'this person';
  const facts = cardFacts(x);
  const rc = recentCall(x);
  const others = (x.others || []);
  const held = x.claimed_until && x.claimed_until > Date.now();
  app().innerHTML = `<div class="screen tall">
      ${topbar(c.name, '', { back: true })}
      <main>
        <section class="who">
          <p class="big">${esc(nm)}</p>
          <div class="phone">${esc(fmtPhone(x.contact.phone))}</div>
          <div style="margin-top:8px">${stateChip(x)}</div>
        </section>
        ${rc ? `<div class="alert">Already called ${esc(ago(rc.at))}${rc.by ? ' by ' + esc(rc.by) : ''}${rc.campaign ? ' for ' + esc(rc.campaign) : ''}. ${rc.same ? '' : 'Mention both if you call now, or come back later.'}</div>` : ''}
        ${others.length ? `<div class="alert info">Also in ${others.map(o => `<b>${esc(o.campaign)}</b>${o.status ? ' (' + esc(o.status) + ')' : ''}`).join(', ')}.</div>` : ''}
        ${!held ? `<div class="alert bad">Your hold on this contact has run out. Another volunteer may get them; refresh before calling.</div>` : ''}
        ${personNotesHtml(x)}
        ${facts.length ? `<dl class="facts">${facts.map(f => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl>` : ''}
        ${c.script ? `<details class="note" style="margin-top:14px"><summary>What to say</summary><div class="body">${esc(c.script)}</div></details>` : ''}
        <h2>Earlier calls</h2>
        ${(x.history || []).length ? timelineHtml(x.history, c.name) : '<p class="muted">No calls yet. You\'re the first.</p>'}
        <p style="margin-top:20px"><button class="linkbtn" id="logonly">Called another way? Log it here</button><br>
        <button class="linkbtn" id="giveone">Not now — give this contact back</button></p>
      </main>
      <div class="bottombar"><div class="inner">
        <a class="btn call" id="call" href="${esc(telHref(x.contact.phone))}">${ICON.phone} Call ${esc(firstName(nm))}</a>
        <a class="btn" id="wa" href="${esc(waHref(x.contact.phone))}" target="_blank" rel="noopener">${ICON.wa} WhatsApp</a>
      </div></div>
    </div>`;
  bindTopbar(app());
  const mark = channel => {
    S.pending = { campaign_id: c.id, contact_id: x.contact.contact_id, t: Date.now(), channel };
    save('pending');
  };
  $('#call').addEventListener('click', () => {
    mark('phone');
    // open the call screen behind the dialer, so switching back mid-call shows notes and result buttons
    setTimeout(() => { if (S.view && S.view.view === 'contact') nav('log', { campaign_id: c.id, contact_id: x.contact.contact_id }); }, 600);
  });
  $('#wa').addEventListener('click', () => mark('whatsapp'));
  $('#logonly').addEventListener('click', () => nav('log', { campaign_id: c.id, contact_id: x.contact.contact_id }));
  $('#giveone').addEventListener('click', async e => {
    const btn = e.currentTarget;
    busy(btn, true);
    try {
      const r = await api('release', { campaign_id: c.id, contact_ids: [x.contact.contact_id] });
      setState(r.state);
      toast('Given back');
      history.back();
    } catch (err) { toast(err.message, 3500); busy(btn, false); }
  });
}

/* When they come back from the dialer, open the log form straight away */
function checkReturnFromCall() {
  const pnd = S.pending;
  if (!pnd || !S.session) return;
  if (Date.now() - pnd.t > PENDING_MAX_MS) { S.pending = null; save('pending'); return; }
  if (Date.now() - pnd.t < 1500) return; // dialer hasn't opened yet
  if (S.view && S.view.view === 'log') return;
  if (!findClaim(pnd.campaign_id, pnd.contact_id)) { S.pending = null; save('pending'); return; }
  nav('log', { campaign_id: pnd.campaign_id, contact_id: pnd.contact_id, returned: true });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  checkReturnFromCall();
  if (myOutbox().length) syncOutbox();
  if (S.session && Date.now() - S.lastRefresh > 60000 && (!S.view || S.view.view !== 'log')) refresh(true);
});
window.addEventListener('focus', () => setTimeout(checkReturnFromCall, 300));

/* ───────── views: log the call ───────── */
function fieldInput(f, value) {
  const id = 'f_' + f.key;
  const v = value === null || value === undefined ? '' : value;
  const attrs = `id="${id}" data-key="${esc(f.key)}" data-orig="${esc(f.type === 'yesno' ? (v === true ? 'yes' : v === false ? 'no' : '') : v)}"`;
  switch (f.type) {
    case 'dropdown': {
      const opts = f.options.slice();
      if (v && !opts.includes(String(v))) opts.unshift(String(v));
      return `<select class="input" ${attrs}><option value="">—</option>${opts.map(o => `<option ${String(v) === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    }
    case 'multi': {
      const cur = String(v).split(',').map(s => s.trim()).filter(Boolean);
      const opts = f.options.slice();
      cur.forEach(x => { if (!opts.includes(x)) opts.push(x); });
      return `<div class="checks" ${attrs} data-multi="1">${opts.map(o => `<label><input type="checkbox" value="${esc(o)}" ${cur.includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div>`;
    }
    case 'yesno':
      return `<select class="input" ${attrs}><option value="">—</option><option value="yes" ${v === true ? 'selected' : ''}>Yes</option><option value="no" ${v === false ? 'selected' : ''}>No</option></select>`;
    case 'date':
      return `<input class="input" type="date" ${attrs} value="${esc(v)}">`;
    case 'number':
      return `<input class="input" type="number" inputmode="decimal" ${attrs} value="${esc(v)}">`;
    case 'phone':
      return `<input class="input" type="tel" inputmode="tel" ${attrs} value="${esc(v)}">`;
    default:
      return `<input class="input" type="text" ${attrs} value="${esc(v)}" autocomplete="off">`;
  }
}
function readField(el) {
  if (el.dataset.multi) return [...el.querySelectorAll('input:checked')].map(i => i.value).join(', ');
  return el.value.trim();
}

function callbackChoices() {
  const out = [];
  const now = new Date();
  const at = (days, h) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.getTime(); };
  if (now.getHours() < 17) out.push(['This evening', at(0, 18)]);
  out.push(['Tomorrow morning', at(1, 10)], ['Tomorrow evening', at(1, 18)], ['In 3 days', at(3, 18)], ['Next week', at(7, 18)]);
  return out;
}
function toLocalInput(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function viewLog(p) {
  const x = findClaim(p.campaign_id, p.contact_id);
  const c = campaign(p.campaign_id);
  if (!x || !c) { S.pending = null; save('pending'); nav('home', {}, true); return; }
  const nm = firstName(x.contact.name);
  const pnd = S.pending && S.pending.contact_id === p.contact_id && S.pending.campaign_id === p.campaign_id ? S.pending : null;
  const notesF = noteFields().filter(f => f.editable);
  const notesRO = noteFields().filter(f => !f.editable && f.show_on_card);
  const editable = (S.data.fields || []).filter(f => f.editable && f.key !== 'phone' && f.type !== 'note');
  const blanks = editable.filter(f => { const v = x.contact.values[f.key]; return v === '' || v === null || v === undefined; }).length;
  const draft = store.get('draft:' + p.campaign_id + ':' + p.contact_id, {});
  const choices = callbackChoices();
  const hist = x.history || [];
  const facts = cardFacts(x, 4);
  const next = nextClaim(c.id, x.contact.contact_id);
  const moreDue = ((c.counts || {}).due || 0) > 0;
  const canNext = !!next || moreDue;
  const nextLabel = next ? 'Save, next: ' + esc(firstName(next.contact.name) || fmtPhone(next.contact.phone)) : 'Save, get next';

  app().innerHTML = `<div class="screen tall">
      ${topbar(x.contact.name || 'Call', c.name, { back: true, noTools: true })}
      <main class="callmain">
        <section class="callcard">
          <div class="cc-row">
            <div class="cc-who"><div class="cc-name">${esc(x.contact.name || fmtPhone(x.contact.phone))}</div><div class="cc-phone">${esc(fmtPhone(x.contact.phone))}</div></div>
            <a class="round call" id="redial" href="${esc(telHref(x.contact.phone))}" aria-label="Call ${esc(nm)} again">${ICON.phone}</a>
            <a class="round wa" id="wa2" href="${esc(waHref(x.contact.phone))}" target="_blank" rel="noopener" aria-label="WhatsApp ${esc(nm)}">${ICON.wa}</a>
          </div>
          ${facts.length ? `<div class="cc-facts">${facts.map(f => `<span>${esc(f.value)}</span>`).join('')}</div>` : ''}
        </section>
        ${notesRO.map(f => x.contact.values[f.key] ? `<div class="pnote-read"><div class="lbl">${esc(f.label)}</div><div class="txt">${esc(x.contact.values[f.key])}</div></div>` : '').join('')}
        ${notesF.map(f => `<div class="field pnote">
            <label for="f_${esc(f.key)}">${esc(f.label)}</label>
            <textarea class="input" id="f_${esc(f.key)}" data-key="${esc(f.key)}" data-orig="${esc(x.contact.values[f.key] || '')}" rows="2" placeholder="Anything worth remembering about ${esc(nm)}, for every campaign">${esc(draft['f:' + f.key] !== undefined ? draft['f:' + f.key] : (x.contact.values[f.key] || ''))}</textarea>
          </div>`).join('')}
        ${hist.length ? `<div class="lastcall"><div class="when">Last call ${esc(ago(hist[0].at))}, ${esc(hist[0].by || 'someone')}${hist[0].campaign && hist[0].campaign !== c.name ? ', ' + esc(hist[0].campaign) : ''}: <b>${esc(hist[0].status)}</b></div>${hist[0].notes ? `<div class="said">${esc(hist[0].notes)}</div>` : ''}</div>
          ${hist.length > 1 ? `<details class="note"><summary>All earlier calls (${hist.length})</summary><div class="body" style="white-space:normal">${timelineHtml(hist, c.name)}</div></details>` : ''}`
          : '<p class="muted small">First call to this person.</p>'}
        ${c.script ? `<details class="note"><summary>What to say</summary><div class="body">${esc(c.script)}</div></details>` : ''}

        <p class="ask" id="ask">How did it go?</p>
        <div class="tiles" role="group" aria-label="Call result">
          ${c.statuses.map((st, i) => `<button class="tile o-${esc(st.outcome)}" data-status="${i}" aria-pressed="${draft.status === st.label}">${esc(st.label)}</button>`).join('')}
        </div>
        <div class="field" id="cbwrap" hidden>
          <span class="lbl">When should we call back?</span>
          <div class="quick" id="quick">${choices.map((q, i) => `<button type="button" data-q="${i}">${esc(q[0])}</button>`).join('')}</div>
          <input class="input" type="datetime-local" id="cbat">
        </div>
        <div class="field">
          <label for="notes">Notes from this call</label>
          <textarea class="input" id="notes" rows="3" placeholder="What did they say? Whoever calls next will see this.">${esc(draft.notes || '')}</textarea>
        </div>
        ${editable.length ? `<details class="note" style="margin-top:18px" id="details">
          <summary>Update ${esc(nm)}'s details${blanks ? ` (${blanks} blank)` : ''}</summary>
          <div class="body" style="white-space:normal">
            ${editable.map(f => `<div class="field"><label for="f_${esc(f.key)}">${esc(f.label)}</label>${fieldInput(f, x.contact.values[f.key])}</div>`).join('')}
          </div>
        </details>` : ''}
      </main>
      <div class="bottombar"><div class="inner">
        <div class="pickfirst" id="pickfirst">Pick a result above to save</div>
        <div class="row" id="saverow" hidden>
          ${canNext ? `<button class="btn" id="saveonly">Save</button><button class="btn primary" id="savenext">${nextLabel}</button>` : '<button class="btn primary" id="saveonly">Save call</button>'}
        </div>
      </div></div>
    </div>`;
  $('[data-act="back"]').addEventListener('click', () => { S.pending = null; save('pending'); history.back(); });
  $('#redial').addEventListener('click', () => { S.pending = { campaign_id: c.id, contact_id: x.contact.contact_id, t: pnd ? pnd.t : Date.now(), channel: 'phone' }; save('pending'); });
  $('#wa2').addEventListener('click', () => { if (!pnd) { S.pending = { campaign_id: c.id, contact_id: x.contact.contact_id, t: Date.now(), channel: 'whatsapp' }; save('pending'); } });

  let picked = null;
  let cbAt = null;
  const cbwrap = $('#cbwrap');
  const cbInput = $('#cbat');
  const setCb = ms => {
    cbAt = ms;
    cbInput.value = ms ? toLocalInput(ms) : '';
    $('#quick').querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(choices[i][1] === ms)));
  };
  const fieldEls = [...app().querySelectorAll('[data-key]')];
  const persistDraft = () => {
    const d = { status: picked ? picked.label : draft.status, notes: $('#notes').value };
    notesF.forEach(f => { const el = $('#f_' + f.key); if (el) d['f:' + f.key] = el.value; });
    store.set('draft:' + p.campaign_id + ':' + p.contact_id, d);
  };
  const pick = i => {
    picked = c.statuses[i];
    app().querySelectorAll('.tile').forEach((t, j) => t.setAttribute('aria-pressed', String(j === i)));
    cbwrap.hidden = picked.outcome !== 'callback';
    if (picked.outcome === 'callback' && !cbAt) setCb(choices.find(q => q[0] === 'Tomorrow evening')[1]);
    $('#pickfirst').hidden = true;
    $('#saverow').hidden = false;
    persistDraft();
  };
  app().querySelectorAll('.tile').forEach(t => t.addEventListener('click', () => pick(Number(t.dataset.status))));
  $('#quick').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setCb(choices[Number(b.dataset.q)][1])));
  cbInput.addEventListener('change', () => { const ms = new Date(cbInput.value).getTime(); setCb(isNaN(ms) ? null : ms); });
  $('#pickfirst').addEventListener('click', () => $('#ask').scrollIntoView({ behavior: 'smooth', block: 'start' }));

  const markChanged = () => fieldEls.forEach(el => el.classList.toggle('changed', readField(el) !== el.dataset.orig));
  fieldEls.forEach(el => { el.addEventListener('change', markChanged); el.addEventListener('input', () => { markChanged(); persistDraft(); }); });
  markChanged();
  $('#notes').addEventListener('input', persistDraft);
  if (draft.status) {
    const i = c.statuses.findIndex(st => st.label === draft.status);
    if (i >= 0) pick(i);
  }

  const doSave = async goNext => {
    if (!picked) { $('#ask').scrollIntoView({ behavior: 'smooth', block: 'start' }); toast('Pick how the call went'); return; }
    if (picked.outcome === 'callback' && !cbAt) { toast('Pick when to call back'); return; }
    if (picked.outcome === 'dnc' && !confirm(`Mark ${nm || 'this person'} as "do not call"? Nobody from the centre will be asked to call them again.`)) return;
    const changes = {};
    fieldEls.forEach(el => {
      const v = readField(el);
      if (v !== el.dataset.orig) {
        const f = (S.data.fields || []).find(ff => ff.key === el.dataset.key);
        changes[el.dataset.key] = f && f.type === 'yesno' ? (v === 'yes' ? true : v === 'no' ? false : '') : v;
      }
    });
    S.outbox.push({
      id: uid(),
      by: S.user.email,
      campaign_id: c.id,
      contact_id: x.contact.contact_id,
      contact_name: x.contact.name,
      campaign_name: c.name,
      status: picked.label,
      callback_at: picked.outcome === 'callback' ? cbAt : null,
      notes: $('#notes').value.trim(),
      changes,
      called_at: pnd ? pnd.t : Date.now(),
      away_sec: pnd ? Math.round((Date.now() - pnd.t) / 1000) : null
    });
    S.pending = null;
    save('outbox', 'pending');
    store.del('draft:' + p.campaign_id + ':' + p.contact_id);
    const savedMsg = navigator.onLine ? 'Saved' : 'Saved on this phone. It will send when you are online.';
    if (!goNext) { toast(savedMsg); nav('campaign', { id: c.id }, true); syncOutbox(); return; }

    if (next) {
      toast(savedMsg + '. Next: ' + (next.contact.name || fmtPhone(next.contact.phone)));
      nav('contact', { campaign_id: c.id, contact_id: next.contact.contact_id }, true);
      syncOutbox();
      return;
    }
    // list finished: send this call, then ask for more people
    const btn = $('#savenext');
    busy(btn, true);
    await syncOutbox();
    try {
      const r = await api('claim', { campaign_id: c.id });
      setState(r.state);
      const first = myClaims(c.id)[0];
      if (first) {
        toast(`${savedMsg}. ${r.given} more added to your list`);
        nav('contact', { campaign_id: c.id, contact_id: first.contact.contact_id }, true);
        return;
      }
      toast(savedMsg + '. Nobody else is due right now.', 3500);
    } catch (err) {
      toast(savedMsg + ". Couldn't get more people: " + err.message, 4000);
    }
    nav('campaign', { id: c.id }, true);
  };
  $('#saveonly').addEventListener('click', () => doSave(false));
  const sn = $('#savenext');
  if (sn) sn.addEventListener('click', () => doSave(true));
}

/* ───────── views: settings ───────── */
function viewSettings() {
  const q = myOutbox();
  const others = S.outbox.length - q.length;
  app().innerHTML = `<div class="screen">
      ${topbar('Settings', '', { back: true })}
      <main>
        <div class="list">
          <div><span class="k">Signed in as</span><span class="v">${esc(S.user ? S.user.name : '')}<br><span class="muted small">${esc(S.user ? S.user.email : '')}</span></span></div>
          <div><span class="k">Centre</span><span class="v">${esc(S.cfg ? S.cfg.n : '')}</span></div>
          <div><span class="k">Calls waiting to send</span><span class="v">${q.length}${others ? ` <span class="muted small">(+${others} from another account on this phone)</span>` : ''}</span>
            ${q.length ? '<button class="btn" id="sendnow">Send now</button>' : ''}</div>
          ${S.failed.length ? `<div><span class="k">Calls the server could not save</span>
            ${S.failed.map(f => `<span class="small">${esc(f.contact_name || f.contact_id)}, ${esc(f.status)}: ${esc(f.reason)}</span>`).join('<br>')}
            <button class="btn" id="clearfailed">Clear this list</button></div>` : ''}
        </div>
        <h2>Another phone</h2>
        <div class="list"><div>
          <span class="small">Use this when Google sign-in won't work on a phone (for example, an iPhone home-screen app). The code works once, for 15 minutes.</span>
          <div id="paircode"></div>
          <button class="btn" id="pair">Get a sign-in code</button>
        </div></div>
        ${installTip()}
        <h2>This phone</h2>
        <div class="list">
          <div><button class="btn" id="signout">Sign out</button></div>
          <div><button class="btn ghost" id="resetup">Use a different setup link</button><span class="muted small">App version ${VERSION}</span></div>
        </div>
      </main></div>`;
  bindTopbar(app());
  bindInstallTip();
  const sn = $('#sendnow');
  if (sn) sn.addEventListener('click', async e => {
    const btn = e.currentTarget; busy(btn, true); await syncOutbox(); render(); });
  const cf = $('#clearfailed');
  if (cf) cf.addEventListener('click', () => { S.failed = []; save('failed'); render(); });
  $('#pair').addEventListener('click', async e => {
    const btn = e.currentTarget;
    busy(btn, true);
    try {
      const r = await api('pairCode');
      $('#paircode').innerHTML = `<div class="codebox">${esc(r.code)}</div><span class="muted small">Enter it on the other phone under "Use a code".</span>`;
      btn.textContent = 'Get a new code';
    } catch (err) { toast(err.message, 3500); }
    finally { busy(btn, false); }
  });
  $('#signout').addEventListener('click', async e => {
    const btn = e.currentTarget;
    if (q.length && !confirm(`${q.length} call${q.length > 1 ? 's are' : ' is'} not sent yet. They stay on this phone and send after you sign in again. Sign out?`)) return;
    busy(btn, true);
    try { await api('signout'); } catch (err) { /* offline is fine */ }
    S.session = null; S.data = null;
    save('session', 'data');
    try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (err) { /* ignore */ }
    nav('signin', {}, true);
  });
  $('#resetup').addEventListener('click', () => {
    if (!confirm('Forget this centre\'s setup on this phone?')) return;
    S.cfg = null; S.session = null; S.data = null;
    save('cfg', 'session', 'data');
    nav('setup', {}, true);
  });
}

/* ───────── on-screen keyboard (iPhone): keep the fixed bar from covering what you type ───────── */
document.addEventListener('focusin', e => {
  if (isIOS() && e.target.matches && e.target.matches('textarea, input:not([type=checkbox]):not([type=radio]), select')) document.body.classList.add('typing');
});
document.addEventListener('focusout', () => { setTimeout(() => { if (!document.activeElement || !document.activeElement.matches('textarea, input, select')) document.body.classList.remove('typing'); }, 50); });

/* ───────── service worker + install ───────── */
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  S.installPrompt = e;
  rerender();
});
window.addEventListener('appinstalled', () => { S.installPrompt = null; rerender(); });
window.addEventListener('online', () => { S.online = true; syncOutbox(); });
window.addEventListener('offline', () => { S.online = false; });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(reg => {
    const offer = w => {
      const b = $('#banner');
      b.innerHTML = 'A new version of the app is ready.<button>Update</button>';
      b.hidden = false;
      b.querySelector('button').onclick = () => { w.postMessage('skipWaiting'); b.hidden = true; };
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}

/* ───────── start ───────── */
(function start() {
  const fromHash = parseSetup(location.hash);
  if (fromHash) {
    applySetup(fromHash);
    history.replaceState(null, '', location.pathname + location.search);
  }
  S.view = { view: startView(), params: {} };
  history.replaceState(S.view, '');
  render();
  if (S.session) {
    syncOutbox().then(() => refresh(true)).then(checkReturnFromCall);
  } else if (fromHash) {
    api('ping').then(r => { if (r.name) { S.cfg.n = r.name; save('cfg'); if (S.view.view === 'signin') render(); } }).catch(() => {});
  }
  // a setup link opened while the app is already open only changes the hash
  window.addEventListener('hashchange', () => {
    const hash = location.hash;
    if (!parseSetup(hash)) return;
    history.replaceState(null, '', location.pathname + location.search);
    trySetup(hash);
  });
  window.__seva = { S, render, nav, syncOutbox, refresh, checkReturnFromCall };
})();
