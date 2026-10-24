/* Calling Seva — volunteer calling PWA
 * Backend: Google Apps Script web app over a Google Sheet.
 * Setup arrives as a link/QR:  <app url>#setup=<base64url {"e": endpoint, "c": google client id, "n": org name}>
 * Nothing about the endpoint is stored in this code.
 */
'use strict';

const VERSION = '1.6.0';
const NEEDS_SERVER = '1.6.0'; // oldest Apps Script version this app works with
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
  pending: store.get('pending', null),  // call in progress {campaign_id, contact_id, t, person?}
  people: store.get('people', {}),      // person pages seen recently (works offline, kept 24 hours)
  recent: store.get('recent', null),    // my recent people from the Sheet (kept 24 hours)
  today: store.get('today', []),        // what I did on this phone (kept 24 hours)
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
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
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
  checkServerVersion(j.v);
  if (!j.ok && j.code === 'BAD_REQUEST' && /^Unknown action/.test(j.message || '')) {
    throw Object.assign(new Error(serverOldMessage(j.v)), { code: 'SERVER_OLD' });
  }
  if (!j.ok) {
    const err = Object.assign(new Error(j.message || j.code), { code: j.code });
    if (j.code === 'AUTH') authLost(j.message);
    throw err;
  }
  return j;
}

function verNum(v) { return String(v || '0').split('.').map(n => parseInt(n, 10) || 0).reduce((a, n) => a * 1000 + n, 0); }
function serverOldMessage(v) {
  return `The centre's Google script is out of date (${v ? 'v' + v : 'old version'}; this app needs v${NEEDS_SERVER} or newer). Ask the coordinator to deploy a new version in Apps Script. Your calls and new people are kept on this phone until then.`;
}
let serverWarned = false;
function checkServerVersion(v) {
  if (!v || serverWarned || verNum(v) >= verNum(NEEDS_SERVER)) return;
  serverWarned = true;
  const b = $('#banner');
  if (!b) return;
  b.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = serverOldMessage(v);
  const btn = document.createElement('button');
  btn.textContent = 'OK';
  btn.onclick = () => { b.hidden = true; };
  b.appendChild(span); b.appendChild(btn);
  b.hidden = false;
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

/**
 * Sends everything queued on this phone in one request. With {claim: campaignId} it also
 * asks for more contacts in the same request (and throws if that fails, so the caller can say so).
 */
let syncPromise = null;
async function syncOutbox(opts = {}) {
  if (!S.session || !S.user) return null;
  if (syncPromise) { try { await syncPromise; } catch (e) { /* ignore */ } if (!opts.claim && !myOutbox().length) return null; }
  const evs = myOutbox().slice(0, 40);
  if (!evs.length && !opts.claim) return null;
  const strip = ev => { const o = Object.assign({}, ev); delete o.by; delete o.contact_name; delete o.campaign_name; return o; };
  const run = (async () => {
    S.syncing = true;
    paintTopbarState();
    try {
      const r = await api('sync', Object.assign({ events: evs.map(strip) }, opts.claim ? { claim: opts.claim } : {}));
      const done = new Set([].concat(r.accepted || [], r.dup || []));
      let failedN = 0;
      (r.rejected || []).forEach(x => {
        done.add(x.id);
        const ev = S.outbox.find(e => e.id === x.id);
        if (ev) { S.failed.push(Object.assign({}, ev, { status: ev.status || ({ add: 'New person', edit: 'Edit', release: 'Give back' })[ev.kind] || '', reason: x.reason })); failedN++; }
      });
      (r.results || []).forEach(x => {
        const ev = S.outbox.find(e => e.id === x.id);
        if (!ev || ev.kind !== 'add' || !x.ok) return;
        noteTodayAdded(ev.id, x.contact_id);
        if (x.existed) toast(`${x.name} was already in the list, so their details were added to the existing entry`, 4000);
        else if (x.blocked) toast(`${x.name} is marked "do not call", so they were not added to a campaign`, 4000);
      });
      const touched = new Set(evs.filter(ev => done.has(ev.id)).map(ev => ev.contact_id).filter(Boolean));
      S.outbox = S.outbox.filter(ev => !done.has(ev.id));
      save('outbox', 'failed');
      setState(r.state);
      if (failedN) toast((failedN === 1 ? '1 item' : failedN + ' items') + " couldn't be saved. See Settings.", 4000);
      if (S.view && S.view.view === 'person' && touched.has(S.view.params.contact_id)) loadPerson(S.view.params.contact_id, true);
      rerender();
      return r;
    } finally {
      S.syncing = false;
      paintTopbarState();
    }
  })();
  syncPromise = run;
  try {
    const r = await run;
    syncPromise = null;
    if (myOutbox().length) setTimeout(() => syncOutbox(), 300);
    return r;
  } catch (e) {
    syncPromise = null;
    if (opts.claim) throw e;
    return null; // everything stays queued; we retry later
  }
}
setInterval(() => { if (myOutbox().length) syncOutbox(); }, 20000);

/* ───────── what this phone did in the last 24 hours (deleted after that) ───────── */
const DAY_MS = 24 * 3600e3;
function rememberToday(entry) {
  entry.at = entry.at || Date.now();
  S.today = [entry].concat(S.today.filter(t => !((entry.contact_id && t.contact_id === entry.contact_id) || (entry.phone && t.phone === entry.phone)))).slice(0, 150);
  save('today');
}
function noteTodayAdded(evId, contactId) {
  const t = S.today.find(x => x.ev === evId);
  if (t && contactId) { t.contact_id = contactId; save('today'); }
}
function pruneLocal() {
  const cutoff = Date.now() - DAY_MS;
  S.today = S.today.filter(t => t.at > cutoff);
  Object.keys(S.people).forEach(id => { if (!(S.people[id]._at > cutoff)) delete S.people[id]; });
  if (S.recent && !(store.get('recentAt', 0) > cutoff)) { S.recent = null; store.del('recent'); }
  save('today', 'people');
  try {
    Object.keys(localStorage).filter(k => k.startsWith('seva:draft:')).forEach(k => {
      const d = store.get(k.slice(5), null);
      if (!d || !(d._t > cutoff)) localStorage.removeItem(k);
    });
  } catch (e) { /* ignore */ }
}
function clearLocalPeople() {
  S.today = []; S.people = {}; S.recent = null;
  store.del('today'); store.del('people'); store.del('recent'); store.del('recentAt');
  try { Object.keys(localStorage).filter(k => k.startsWith('seva:draft:')).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
}
setInterval(pruneLocal, 3600e3);

/** A person page built from what the phone already knows, so it opens instantly and offline. */
function personFromClaim(x, c, result) {
  const per = Object.assign({}, S.people[x.contact.contact_id] || {});
  per.contact_id = x.contact.contact_id;
  per.name = x.contact.name; per.phone = x.contact.phone;
  per.contact = JSON.parse(JSON.stringify(x.contact));
  per.area = (x.contact.values || {}).area || per.area || '';
  per.history = per.history && per.history.length ? per.history : (x.history || []).slice();
  const camps = (per.campaigns || []).filter(m => m.campaign_id !== c.id);
  camps.unshift({ campaign_id: c.id, name: c.name, usable: true, status: result ? result.label : x.status, state: result ? result.outcome : x.state, last_called_at: result ? Date.now() : x.last_called_at, last_called_by: result ? S.user.name : x.last_called_by });
  (x.others || []).forEach(o => { if (!camps.find(m => m.name === o.campaign)) camps.push({ campaign_id: '', name: o.campaign, usable: false, status: o.status }); });
  per.campaigns = camps;
  return per;
}

/* ───────── derived data ───────── */
function campaign(id) { return S.data && S.data.campaigns.find(c => c.id === id); }
/** Give contacts back right away on the phone; the Sheet is updated in the background. */
function releaseLocal(campaignId, ids) {
  if (!ids.length || !S.data) return;
  const before = S.data.claims.length;
  S.data.claims = S.data.claims.filter(x => !(x.campaign_id === campaignId && ids.includes(x.contact.contact_id)));
  const n = before - S.data.claims.length;
  const c = campaign(campaignId);
  if (c && c.counts && n) { c.counts.mine = Math.max(0, (c.counts.mine || 0) - n); c.counts.due = (c.counts.due || 0) + n; }
  save('data');
  S.outbox.push({ kind: 'release', id: uid(), by: S.user.email, campaign_id: campaignId, contact_ids: ids });
  save('outbox');
  syncOutbox();
}
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
  const h = (c.history || []).find(x => x.at > cutoff && (!x.kind || x.kind === 'call'));
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
/* The app keeps its own copy of the back-stack, so a save can return to the screen it came from
   instead of piling up stale screens that the Back button would walk through. */
const trail = [];
let trailIdx = 0;
let afterPop = null;
function nav(view, params = {}, replace = false) {
  S.view = { view, params };
  const i = replace ? trailIdx : trailIdx + 1;
  const st = { view, params, i };
  try {
    if (replace) history.replaceState(st, '');
    else history.pushState(st, '');
  } catch (e) { /* ignore */ }
  trailIdx = i;
  trail.length = i;
  trail[i] = { view, params };
  render();
  window.scrollTo(0, 0);
}
/** Go back to the nearest earlier screen matching view/test; then() runs once it is shown. False if none. */
function goBackTo(view, test, then) {
  for (let j = trailIdx - 1; j >= 0; j--) {
    const t = trail[j];
    if (t && t.view === view && (!test || test(t.params || {}))) {
      afterPop = then || null;
      history.go(j - trailIdx);
      return true;
    }
  }
  return false;
}
window.addEventListener('popstate', e => {
  if (e.state && e.state.view) {
    S.view = { view: e.state.view, params: e.state.params || {} };
    trailIdx = typeof e.state.i === 'number' ? e.state.i : 0;
    trail[trailIdx] = { view: S.view.view, params: S.view.params };
  } else {
    S.view = { view: startView(), params: {} };
    trailIdx = 0;
  }
  render();
  if (afterPop) { const f = afterPop; afterPop = null; f(); }
});
function startView() {
  if (!S.cfg) return 'setup';
  if (!S.session) return 'signin';
  return 'home';
}
function rerender() {
  // re-render the current view unless the person is typing in a form
  if (!S.view) return;
  if (['log', 'add', 'edit', 'find', 'setup', 'signin'].includes(S.view.view)) return;
  render();
}
function render() {
  if (!S.view) S.view = { view: startView(), params: {} };
  const v = S.view.view;
  // guard routes
  if (v !== 'setup' && !S.cfg) { S.view = { view: 'setup', params: {} }; return render(); }
  if (!['setup', 'signin'].includes(v) && !S.session) { S.view = { view: 'signin', params: {} }; return render(); }
  const views = { setup: viewSetup, signin: viewSignin, home: viewHome, campaign: viewCampaign, contact: viewContact, log: viewLog, add: viewAdd, find: viewFind, person: viewPerson, edit: viewEdit, settings: viewSettings };
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
        <p class="hello">${name ? 'Hi ' + esc(name) + '.' : ''} ${queued ? `${queued} saved on this phone, sending when online.` : ''}</p>
        ${installTip()}
        ${body}
      </main>
      <div class="bottombar"><div class="inner">
        <div class="row">
          <button class="btn" id="findperson">${ICON.search} Find a person</button>
          <button class="btn" id="addperson">${ICON.plus} Add a person</button>
        </div>
      </div></div></div>`;
  bindTopbar(app());
  $('#addperson').addEventListener('click', () => nav('add', {}));
  $('#findperson').addEventListener('click', () => nav('find', {}));
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
        <div class="h2row"><h2>Your list</h2><button class="linkbtn" id="addhere">${ICON.plus} Add a person</button></div>
        ${people}
      </main>
      <div class="bottombar"><div class="inner">
        <button class="btn primary" id="get" ${canGet ? '' : 'disabled'}>${canGet ? `Get ${Math.min(room, k.due)} contact${Math.min(room, k.due) > 1 ? 's' : ''}` : (room === 0 ? 'Call your list first' : 'Nobody due right now')}</button>
        ${list.length ? '<button class="btn ghost" id="giveback">Give my list back</button>' : ''}
      </div></div>
    </div>`;
  bindTopbar(app());
  app().querySelectorAll('[data-contact]').forEach(b => b.addEventListener('click', () => nav('contact', { campaign_id: c.id, contact_id: b.dataset.contact })));
  $('#addhere').addEventListener('click', () => nav('add', { campaign_id: c.id }));
  $('#get').addEventListener('click', async e => {
    const btn = e.currentTarget;
    busy(btn, true);
    try {
      const r = await syncOutbox({ claim: c.id });
      toast(r && r.given ? `${r.given} added to your list` : 'Nobody new to give right now');
    } catch (err) { toast(err.message, 3500); }
    finally { render(); }
  });
  const gb = $('#giveback');
  if (gb) gb.addEventListener('click', () => {
    if (!confirm('Give these contacts back so other volunteers can call them?')) return;
    releaseLocal(c.id, list.map(x => x.contact.contact_id));
    toast('List given back');
    render();
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
        <button class="linkbtn" id="openperson">Full page: all campaigns, edit details</button><br>
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
  $('#openperson').addEventListener('click', () => nav('person', { contact_id: x.contact.contact_id }));
  $('#giveone').addEventListener('click', () => {
    releaseLocal(c.id, [x.contact.contact_id]);
    toast('Given back');
    if (!goBackTo('campaign', pr => pr.id === c.id)) nav('campaign', { id: c.id }, true);
  });
}

/* When they come back from the dialer, open the log form straight away */
function checkReturnFromCall() {
  const pnd = S.pending;
  if (!pnd || !S.session) return;
  if (Date.now() - pnd.t > PENDING_MAX_MS) { S.pending = null; save('pending'); return; }
  if (Date.now() - pnd.t < 1500) return; // dialer hasn't opened yet
  if (S.view && S.view.view === 'log') return;
  if (pnd.person) {
    if (!S.people[pnd.contact_id]) { S.pending = null; save('pending'); return; }
    nav('log', { person: true, contact_id: pnd.contact_id, campaign_id: pnd.campaign_id || '', returned: true });
    return;
  }
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

function personCampaignChoice(per, wanted) {
  const usable = (per.campaigns || []).filter(m => m.usable && campaign(m.campaign_id));
  if (wanted && campaign(wanted)) return wanted;
  if (usable.length) return usable[0].campaign_id;
  return ((S.data && S.data.campaigns) || [])[0] ? S.data.campaigns[0].id : '';
}

function viewLog(p) {
  const personMode = !!p.person;
  let x, per = null, membership = null;
  if (personMode) {
    per = S.people[p.contact_id];
    if (!per) { nav('person', { contact_id: p.contact_id }, true); return; }
    const cid = personCampaignChoice(per, p.campaign_id);
    if (!cid) { toast('No campaign is open for you to log this call'); history.back(); return; }
    if (cid !== p.campaign_id) { p = Object.assign({}, p, { campaign_id: cid }); try { history.replaceState({ view: 'log', params: p }, ''); } catch (e) { } S.view.params = p; }
    membership = (per.campaigns || []).find(m => m.campaign_id === cid) || null;
    x = { campaign_id: cid, contact: per.contact, history: per.history || [], status: membership ? membership.status : '', state: membership ? membership.state : '', others: [] };
  } else {
    x = findClaim(p.campaign_id, p.contact_id);
  }
  const c = campaign(p.campaign_id);
  if (!x || !c) { S.pending = null; save('pending'); nav('home', {}, true); return; }
  const correction = personMode && !!p.correction;
  const nm = firstName(x.contact.name);
  const pnd = S.pending && S.pending.contact_id === p.contact_id && (personMode ? S.pending.person : S.pending.campaign_id === p.campaign_id) ? S.pending : null;
  const notesF = noteFields().filter(f => f.editable);
  const notesRO = noteFields().filter(f => !f.editable && f.show_on_card);
  const editable = (S.data.fields || []).filter(f => f.editable && f.key !== 'phone' && f.type !== 'note');
  const blanks = editable.filter(f => { const v = x.contact.values[f.key]; return v === '' || v === null || v === undefined; }).length;
  const draft = store.get('draft:' + p.campaign_id + ':' + p.contact_id, {});
  const choices = callbackChoices();
  const hist = x.history || [];
  const facts = cardFacts(x, 4);
  const next = personMode ? null : nextClaim(c.id, x.contact.contact_id);
  const moreDue = !personMode && ((c.counts || {}).due || 0) > 0;
  const canNext = !!next || moreDue;
  const usableAll = personMode ? ((S.data && S.data.campaigns) || []) : [];
  const campPicker = personMode ? `<div class="field"><label for="campsel">${correction ? 'Fix the result for' : 'Log this for'}</label>
      <select class="input" id="campsel">${usableAll.map(k => {
        const m = (per.campaigns || []).find(mm => mm.campaign_id === k.id);
        if (correction && !m) return '';
        return `<option value="${esc(k.id)}" ${k.id === c.id ? 'selected' : ''}>${esc(k.name)}${m ? (m.status ? ' (now: ' + esc(m.status) + ')' : ' (not called yet)') : ' (will add them)'}</option>`;
      }).join('')}</select></div>` : '';
  const incomingBox = personMode && !correction ? `<label class="checkrow"><input type="checkbox" id="incoming" ${pnd ? '' : 'checked'}> They called me</label>` : '';
  const nextLabel = next ? 'Save, next: ' + esc(firstName(next.contact.name) || fmtPhone(next.contact.phone)) : 'Save, get next';

  app().innerHTML = `<div class="screen tall">
      ${topbar(x.contact.name || 'Call', correction ? 'Fix the last result' : (personMode ? 'Log a call' : c.name), { back: true, noTools: true })}
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

        ${campPicker ? `<div style="margin-top:22px">${campPicker}</div>` : ''}
        <p class="ask" id="ask">${correction ? 'What should the result be?' : 'How did it go?'}</p>
        ${incomingBox}
        <div class="tiles" role="group" aria-label="Call result">
          ${c.statuses.map((st, i) => `<button class="tile o-${esc(st.outcome)}" data-status="${i}" aria-pressed="${draft.status === st.label}">${esc(st.label)}</button>`).join('')}
        </div>
        <div class="field" id="cbwrap" hidden>
          <span class="lbl">When should we call back?</span>
          <div class="quick" id="quick">${choices.map((q, i) => `<button type="button" data-q="${i}">${esc(q[0])}</button>`).join('')}</div>
          <input class="input" type="datetime-local" id="cbat">
        </div>
        <div class="field">
          <label for="notes">${correction ? 'Why are you changing it? (optional)' : 'Notes from this call'}</label>
          <textarea class="input" id="notes" rows="3" placeholder="${correction ? 'e.g. tapped the wrong button' : 'What did they say? Whoever calls next will see this.'}">${esc(draft.notes || '')}</textarea>
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
          ${canNext ? `<button class="btn" id="saveonly">Save</button><button class="btn primary" id="savenext">${nextLabel}</button>` : `<button class="btn primary" id="saveonly">${correction ? 'Save correction' : 'Save call'}</button>`}
        </div>
      </div></div>
    </div>`;
  $('[data-act="back"]').addEventListener('click', () => { S.pending = null; save('pending'); history.back(); });
  $('#redial').addEventListener('click', () => { S.pending = { campaign_id: c.id, contact_id: x.contact.contact_id, t: pnd ? pnd.t : Date.now(), channel: 'phone', person: personMode }; save('pending'); const ib = $('#incoming'); if (ib) ib.checked = false; });
  $('#wa2').addEventListener('click', () => { if (!pnd) { S.pending = { campaign_id: c.id, contact_id: x.contact.contact_id, t: Date.now(), channel: 'whatsapp', person: personMode }; save('pending'); } });
  const cs = $('#campsel');
  if (cs) cs.addEventListener('change', () => { persistDraft(); nav('log', Object.assign({}, p, { campaign_id: cs.value }), true); });

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
    const d = { status: picked ? picked.label : draft.status, notes: $('#notes').value, _t: Date.now() };
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
      away_sec: pnd ? Math.round((Date.now() - pnd.t) / 1000) : null,
      incoming: !!($('#incoming') && $('#incoming').checked),
      correction: correction || undefined,
      prev_status: correction && membership ? membership.status : undefined
    });
    S.pending = null;
    save('outbox', 'pending');
    store.del('draft:' + p.campaign_id + ':' + p.contact_id);
    rememberToday({ contact_id: x.contact.contact_id, name: x.contact.name, phone: x.contact.phone, status: picked.label + (correction ? ' (corrected)' : ''), campaign: c.name });
    if (!personMode) {
      const per = personFromClaim(x, c, picked);
      Object.keys(changes).forEach(k => { per.contact.values[k] = changes[k]; if (k === 'name') { per.contact.name = changes[k]; per.name = changes[k]; } });
      per.history = [{ at: Date.now(), by: S.user.name, campaign: c.name, status: picked.label, notes: $('#notes').value.trim(), kind: 'call', pending: true }].concat(per.history || []);
      rememberPerson(per);
    }
    const savedMsg = navigator.onLine ? 'Saved' : 'Saved on this phone. It will send when you are online.';
    if (personMode) {
      // show the change on the person page straight away; the server copy replaces it after sending
      if (per) {
        let m = (per.campaigns || []).find(mm => mm.campaign_id === c.id);
        if (!m) { m = { campaign_id: c.id, name: c.name, usable: true }; per.campaigns = (per.campaigns || []).concat([m]); }
        m.status = picked.label;
        (per.history = per.history || []).unshift({ at: Date.now(), by: S.user.name, campaign: c.name, status: correction ? picked.label + ' (corrected)' : picked.label, notes: $('#notes').value.trim(), kind: correction ? 'correction' : 'call', pending: true });
        Object.keys(changes).forEach(k => { per.contact.values[k] = changes[k]; if (k === 'name') { per.contact.name = changes[k]; per.name = changes[k]; } });
        rememberPerson(per);
      }
      toast(savedMsg);
      // go back to the person page this screen was opened from, rather than stacking another copy
      if (!goBackTo('person', pr => pr.contact_id === p.contact_id)) nav('person', { contact_id: p.contact_id }, true);
      syncOutbox();
      return;
    }
    const backToList = then => { if (!goBackTo('campaign', pr => pr.id === c.id, then)) { nav('campaign', { id: c.id }, true); if (then) then(); } };
    if (!goNext) { toast(savedMsg); backToList(); syncOutbox(); return; }

    if (next) {
      toast(savedMsg + '. Next: ' + (next.contact.name || fmtPhone(next.contact.phone)));
      backToList(() => nav('contact', { campaign_id: c.id, contact_id: next.contact.contact_id }));
      syncOutbox();
      return;
    }
    // list finished: send this call, then ask for more people
    const btn = $('#savenext');
    busy(btn, true);
    try {
      const r = await syncOutbox({ claim: c.id });
      const first = myClaims(c.id)[0];
      if (first) {
        toast(`${savedMsg}. ${r.given} more added to your list`);
        backToList(() => nav('contact', { campaign_id: c.id, contact_id: first.contact.contact_id }));
        return;
      }
      toast(savedMsg + '. Nobody else is due right now.', 3500);
    } catch (err) {
      toast(savedMsg + ". Couldn't get more people: " + err.message, 4000);
    }
    backToList();
  };
  $('#saveonly').addEventListener('click', () => doSave(false));
  const sn = $('#savenext');
  if (sn) sn.addEventListener('click', () => doSave(true));
}

/* ───────── views: add a person met in person ───────── */
function normPhoneLocal(raw) {
  const s = String(raw || '').trim();
  let d = s.replace(/\D/g, '');
  if (!d) return '';
  if (s.startsWith('+')) return d.length >= 8 && d.length <= 15 ? '+' + d : '';
  if (d.startsWith('00')) return d.length >= 10 ? '+' + d.slice(2) : '';
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) return '+91' + d;
  if (d.length === 12 && d.startsWith('91')) return '+' + d;
  return '';
}

function viewAdd(p) {
  const camps = (S.data && S.data.campaigns) || [];
  const fields = ((S.data && S.data.fields) || []).filter(f => f.editable && f.key !== 'name' && f.key !== 'phone');
  const notes = fields.filter(f => f.type === 'note');
  const others = fields.filter(f => f.type !== 'note');
  const recentTags = store.get('recentTags', []);
  const lastTag = store.get('lastTag', '');
  const lastCamps = store.get('lastAddCamps', null);
  const pre = p.campaign_id ? [p.campaign_id] : (lastCamps || []);
  const countToday = store.get('addedToday', { day: '', n: 0 });
  const today = new Date().toDateString();
  const n = countToday.day === today ? countToday.n : 0;

  app().innerHTML = `<div class="screen tall">
      ${topbar('Add a person', n ? `${n} added today on this phone` : 'Someone you met in person', { back: true, noTools: true })}
      <main>
        <div class="field">
          <label for="a_name">Name</label>
          <input class="input" id="a_name" autocomplete="off" autocapitalize="words" enterkeyhint="next">
        </div>
        <div class="field">
          <label for="a_phone">Phone</label>
          <input class="input" id="a_phone" type="tel" inputmode="tel" autocomplete="off" placeholder="10-digit mobile" enterkeyhint="next">
          <span class="hint small" id="a_phone_hint"></span>
        </div>
        <div class="field">
          <label for="a_tag">Where did you meet? <span class="muted small">(stays for the next person)</span></label>
          <input class="input" id="a_tag" value="${esc(lastTag)}" placeholder="e.g. Infopark stall, 26 Oct" autocomplete="off">
          ${recentTags.length ? `<div class="quick" id="tagchips">${recentTags.map(t => `<button type="button" data-tag="${esc(t)}" aria-pressed="${t === lastTag}">${esc(t)}</button>`).join('')}</div>` : ''}
        </div>
        ${camps.length ? `<div class="field"><span class="lbl">Add to campaign</span>
          <div class="checks" id="a_camps">${camps.map(c => `<label><input type="checkbox" value="${esc(c.id)}" ${pre.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div>
          <span class="hint small">Volunteers will call them from that campaign's list.</span></div>` : ''}
        ${notes.map(f => `<div class="field pnote"><label for="f_${esc(f.key)}">${esc(f.label)}</label>${`<textarea class="input" rows="2" id="f_${esc(f.key)}" data-key="${esc(f.key)}" data-orig="" placeholder="Interests, timing, anything useful"></textarea>`}</div>`).join('')}
        ${others.length ? `<details class="note" style="margin-top:16px" id="moredetails"><summary>More details (optional)</summary>
          <div class="body" style="white-space:normal">${others.map(f => `<div class="field"><label for="f_${esc(f.key)}">${esc(f.label)}</label>${fieldInput(f, '')}</div>`).join('')}</div></details>` : ''}
        <p class="err" id="a_err" hidden></p>
      </main>
      <div class="bottombar"><div class="inner"><div class="row" style="grid-template-columns:1fr 2fr;grid-auto-flow:row">
        <button class="btn" id="a_done">Save</button>
        <button class="btn primary" id="a_next">Save, add another</button>
      </div></div></div>
    </div>`;
  bindTopbar(app());

  const phoneEl = $('#a_phone');
  const hint = $('#a_phone_hint');
  const checkPhone = () => {
    const v = phoneEl.value.trim();
    if (!v) { hint.textContent = ''; return; }
    const norm = normPhoneLocal(v);
    hint.textContent = norm ? 'Saved as ' + fmtPhone(norm) : 'Check the number: 10 digits, or start with + for other countries';
    hint.classList.toggle('err', !norm);
  };
  phoneEl.addEventListener('input', checkPhone);
  const tagEl = $('#a_tag');
  app().querySelectorAll('[data-tag]').forEach(b => b.addEventListener('click', () => {
    tagEl.value = b.dataset.tag;
    app().querySelectorAll('[data-tag]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));

  const submit = another => {
    const err = $('#a_err');
    const name = $('#a_name').value.trim();
    const phone = normPhoneLocal(phoneEl.value);
    const problems = [];
    if (!name) problems.push('Enter their name.');
    if (!phone) problems.push('Enter a valid phone number.');
    if (problems.length) { err.textContent = problems.join(' '); err.hidden = false; (name ? phoneEl : $('#a_name')).focus(); return; }
    err.hidden = true;
    const dupe = S.outbox.find(ev => ev.kind === 'add' && ev.values && ev.values.phone === phone);
    if (dupe) { err.textContent = `You already added ${dupe.values.name} with this number. It's waiting to send.`; err.hidden = false; return; }

    const values = { name, phone };
    app().querySelectorAll('[data-key]').forEach(el => { const v = readField(el); if (v) values[el.dataset.key] = v; });
    const tag = tagEl.value.trim();
    const campIds = [...app().querySelectorAll('#a_camps input:checked')].map(i => i.value);
    const evId = uid();
    S.outbox.push({ kind: 'add', id: evId, by: S.user.email, values, tags: tag, campaign_ids: campIds, added_at: Date.now() });
    save('outbox');
    rememberToday({ ev: evId, name, phone, status: 'Added', campaign: tag || '' });
    store.set('lastTag', tag);
    if (tag) store.set('recentTags', [tag].concat(recentTags.filter(t => t !== tag)).slice(0, 5));
    if (!p.campaign_id) store.set('lastAddCamps', campIds);
    store.set('addedToday', { day: today, n: n + 1 });
    syncOutbox();
    toast(`${name} saved${navigator.onLine ? '' : ' on this phone. It will send when you are online'}`);
    if (another) { nav('add', p, true); setTimeout(() => { const el = $('#a_name'); if (el) el.focus(); }, 50); }
    else history.back();
  };
  $('#a_next').addEventListener('click', () => submit(true));
  $('#a_done').addEventListener('click', () => submit(false));
  $('#a_name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); phoneEl.focus(); } });
  setTimeout(() => $('#a_name').focus(), 50);
}

/* ───────── finding people again ───────── */
function rememberPerson(per) {
  S.people[per.contact_id] = Object.assign({}, per, { _at: Date.now() });
  const ids = Object.keys(S.people).sort((a, b) => (S.people[b]._at || 0) - (S.people[a]._at || 0));
  ids.slice(40).forEach(id => { delete S.people[id]; });
  save('people');
}

async function loadPerson(id, quiet) {
  try {
    const r = await api('person', { contact_id: id });
    rememberPerson(r.person);
    if (S.view && ['person', 'edit'].includes(S.view.view) && S.view.params.contact_id === id && S.view.view === 'person') render();
    return r.person;
  } catch (e) {
    if (!quiet) toast(e.code === 'NET' ? 'Offline: showing what this phone saved last time' : e.message, 3500);
    if (e.code === 'NOT_FOUND' || e.code === 'NO_ACCESS') { delete S.people[id]; save('people'); }
    return null;
  }
}

function personRow(x, sub) {
  const camps = (x.campaigns || []).map(m => m.name + (m.status ? ': ' + m.status : '')).join(', ');
  const flag = x.do_not_call ? '<span class="chip noanswer">Do not call</span>' : x.bad_number ? '<span class="chip noanswer">Wrong number</span>' : '';
  return `<button class="person" data-person="${esc(x.contact_id)}">
      <span class="nm">${esc(x.name || fmtPhone(x.phone))}</span>${flag || `<span class="muted small">${esc(fmtPhone(x.phone))}</span>`}
      <span class="ln">${sub ? sub + '<br>' : ''}${esc([x.area, camps].filter(Boolean).join(' · '))}</span>
    </button>`;
}

let findTimer = null;
function viewFind(p) {
  const q = p.q || '';
  app().innerHTML = `<div class="screen">
      ${topbar('Find a person', 'For call-backs and corrections', { back: true, noTools: true })}
      <main>
        <div class="field" style="margin-top:4px">
          <label for="q" class="sr">Name or number</label>
          <input class="input" id="q" type="search" value="${esc(q)}" placeholder="Name or last 4 digits" autocomplete="off" enterkeyhint="search">
        </div>
        <div id="results"></div>
        <div class="h2row"><h2>You called or added recently</h2></div>
        <div id="recent"><p class="muted">Loading…</p></div>
      </main></div>`;
  bindTopbar(app());
  const input = $('#q');
  const bindRows = root => root.querySelectorAll('[data-person]').forEach(b => b.addEventListener('click', () => {
    try { history.replaceState({ view: 'find', params: { q: input.value } }, ''); } catch (e) { }
    nav('person', { contact_id: b.dataset.person });
  }));
  const showRecent = list => {
    const el = $('#recent');
    if (!el) return;
    pruneLocal();
    const local = S.today.map(t => ({ contact_id: t.contact_id || '', name: t.name, phone: t.phone, campaigns: [], area: t.campaign || '', my_last: { at: t.at, status: t.status }, _local: true }));
    const seen = new Set(local.map(x => x.contact_id).filter(Boolean));
    const seenPhone = new Set(local.map(x => x.phone));
    const merged = local.concat((list || []).filter(x => !seen.has(x.contact_id) && !seenPhone.has(x.phone)));
    el.innerHTML = merged.length
      ? `<div class="people">${merged.map(x => x.contact_id ? personRow(x, x.my_last ? esc(x.my_last.status) + ', ' + esc(ago(x.my_last.at)) : '')
          : `<div class="person static"><span class="nm">${esc(x.name)}</span><span class="muted small">${esc(fmtPhone(x.phone))}</span><span class="ln">${esc(x.my_last.status)}, ${esc(ago(x.my_last.at))}. Waiting to send.</span></div>`).join('')}</div>`
      : '<div class="empty">Nobody yet. People you call or add appear here.</div>';
    bindRows(el);
  };
  showRecent(S.recent);
  api('recent').then(r => { S.recent = r.results; save('recent'); store.set('recentAt', Date.now()); showRecent(S.recent); }).catch(() => { if (!S.recent && !S.today.length) $('#recent').innerHTML = '<div class="empty">Connect to the internet to see this list.</div>'; });

  const run = async () => {
    const v = input.value.trim();
    const res = $('#results');
    const digits = v.replace(/\D/g, ''), text = v.replace(/[\d+()\-\s]/g, '');
    if (digits.length < 4 && text.length < 3) { res.innerHTML = v ? '<p class="muted small">Keep typing: 3 letters of the name or 4 digits of the number.</p>' : ''; return; }
    res.innerHTML = '<p class="muted small">Searching…</p>';
    try {
      const r = await api('search', { q: v });
      if (input.value.trim() !== v) return;
      res.innerHTML = r.results.length
        ? `<h2>Found ${r.results.length}${r.more ? '+' : ''}</h2><div class="people">${r.results.map(x => personRow(x)).join('')}</div>${r.more ? `<p class="muted small">${r.more} more. Type more of the name or number.</p>` : ''}`
        : `<div class="empty"><strong>Nobody found</strong>${r.scope === 'mine' ? 'You can only find people you called or added.' : 'Check the spelling, or try the last digits of the number.'}<br><button class="linkbtn" id="addinstead">Add them as a new person</button></div>`;
      bindRows(res);
      const ai = $('#addinstead');
      if (ai) ai.addEventListener('click', () => nav('add', {}));
    } catch (e) {
      res.innerHTML = `<p class="err">${esc(e.code === 'NET' ? 'Searching needs internet. Recent people below work offline.' : e.message)}</p>`;
    }
  };
  input.addEventListener('input', () => { clearTimeout(findTimer); findTimer = setTimeout(run, 350); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(findTimer); run(); } });
  if (q) run(); else setTimeout(() => input.focus(), 50);
}

function viewPerson(p) {
  const per = S.people[p.contact_id];
  if (!per) {
    app().innerHTML = `<div class="screen">${topbar('Person', '', { back: true, noTools: true })}<main><div class="empty"><strong>Loading…</strong></div></main></div>`;
    bindTopbar(app());
    loadPerson(p.contact_id).then(x => { if (x) render(); else if (S.view.view === 'person') history.back(); });
    return;
  }
  const nm = firstName(per.name) || 'them';
  const x = { contact: per.contact, campaign_id: '' };
  const facts = cardFacts(x);
  const blocked = per.do_not_call ? 'Marked "do not call".' : per.bad_number ? 'Marked as a wrong number.' : '';
  const camps = per.campaigns || [];
  const canLog = (S.data && S.data.campaigns || []).length > 0;
  const queued = S.outbox.filter(ev => ev.contact_id === per.contact_id).length;

  app().innerHTML = `<div class="screen tall">
      ${topbar(per.name || 'Person', queued ? queued + ' change(s) waiting to send' : '', { back: true })}
      <main class="callmain">
        <section class="callcard">
          <div class="cc-row">
            <div class="cc-who"><div class="cc-name">${esc(per.name || fmtPhone(per.phone))}</div><div class="cc-phone">${esc(fmtPhone(per.phone))}</div></div>
            <a class="round wa" id="pwa" href="${esc(waHref(per.phone))}" target="_blank" rel="noopener" aria-label="WhatsApp ${esc(nm)}">${ICON.wa}</a>
          </div>
          ${per.tags ? `<div class="cc-facts">${per.tags.split(',').map(t => `<span>${esc(t.trim())}</span>`).join('')}</div>` : ''}
        </section>
        ${blocked ? `<div class="alert bad">${blocked} If that was a mistake, use "Fix result" on the campaign below.</div>` : ''}
        ${personNotesHtml(x)}
        ${facts.length ? `<dl class="facts">${facts.map(f => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl>` : ''}
        <button class="btn" id="editdetails" style="margin-top:14px">${ICON.edit} Edit details or add a note</button>

        <h2>Campaigns</h2>
        ${camps.length ? `<div class="people">${camps.map(m => `<div class="person static">
            <span class="nm">${esc(m.name)}</span>${m.status ? `<span class="chip ${({ callback: 'callback', noanswer: 'noanswer', exhausted: 'noanswer', bad_number: 'bad', dnc: 'bad', final: 'done' })[m.state] || 'retry'}">${esc(m.status)}</span>` : '<span class="chip new">Not called</span>'}
            <span class="ln">${[m.last_called_at ? 'Last call ' + esc(ago(m.last_called_at)) + (m.last_called_by ? ' by ' + esc(m.last_called_by) : '') : '', m.callback_at && m.state === 'callback' ? 'Call back ' + esc(when(m.callback_at)) : '', m.held_by ? '<span class="warn">On ' + esc(m.held_by) + '\'s list right now</span>' : '', m.mine ? '<b>On your list</b>' : ''].filter(Boolean).join('<br>')}</span>
            ${m.usable && m.status ? `<span class="acts"><button class="linkbtn" data-fix="${esc(m.campaign_id)}">Fix result</button></span>` : ''}
          </div>`).join('')}</div>` : '<p class="muted">Not in any campaign yet. Logging a call adds them.</p>'}

        <h2>History</h2>
        ${(per.history || []).length ? timelineHtml(per.history, '') : '<p class="muted">Nothing logged yet.</p>'}
      </main>
      <div class="bottombar"><div class="inner"><div class="row">
        <a class="btn call" id="pcall" href="${esc(telHref(per.phone))}">${ICON.phone} Call</a>
        ${canLog ? '<button class="btn primary" id="plog">Log a call</button>' : ''}
      </div></div></div>
    </div>`;
  bindTopbar(app());
  $('#editdetails').addEventListener('click', () => nav('edit', { contact_id: per.contact_id }));
  app().querySelectorAll('[data-fix]').forEach(b => b.addEventListener('click', () => nav('log', { person: true, contact_id: per.contact_id, campaign_id: b.dataset.fix, correction: true })));
  const pl = $('#plog');
  if (pl) pl.addEventListener('click', () => nav('log', { person: true, contact_id: per.contact_id }));
  $('#pcall').addEventListener('click', () => {
    S.pending = { person: true, contact_id: per.contact_id, campaign_id: '', t: Date.now(), channel: 'phone' };
    save('pending');
    setTimeout(() => { if (S.view && S.view.view === 'person') nav('log', { person: true, contact_id: per.contact_id }); }, 600);
  });
  if (!p._loaded) { S.view.params._loaded = true; loadPerson(per.contact_id, true); }
}

function viewEdit(p) {
  const per = S.people[p.contact_id];
  if (!per) { nav('person', { contact_id: p.contact_id }, true); return; }
  const fields = ((S.data && S.data.fields) || []).filter(f => f.editable && f.key !== 'phone');
  const noteF = fields.filter(f => f.type === 'note');
  const others = fields.filter(f => f.type !== 'note');
  const v = per.contact.values || {};
  app().innerHTML = `<div class="screen tall">
      ${topbar('Edit details', per.name, { back: true, noTools: true })}
      <main>
        ${noteF.map(f => `<div class="field pnote"><label for="f_${esc(f.key)}">${esc(f.label)}</label><textarea class="input" rows="3" id="f_${esc(f.key)}" data-key="${esc(f.key)}" data-orig="${esc(v[f.key] || '')}">${esc(v[f.key] || '')}</textarea></div>`).join('')}
        ${others.map(f => `<div class="field"><label for="f_${esc(f.key)}">${esc(f.label)}</label>${fieldInput(f, f.key === 'name' ? (v.name || per.name) : v[f.key])}</div>`).join('')}
        <div class="field">
          <label for="enote">Add a note to the history <span class="muted small">(optional)</span></label>
          <textarea class="input" id="enote" rows="2" placeholder="e.g. met at satsang, confirmed Saturday batch"></textarea>
        </div>
        <p class="muted small">The phone number can only be changed by the coordinator in the Sheet. Every change is kept in the Calls log.</p>
      </main>
      <div class="bottombar"><div class="inner"><button class="btn primary" id="esave">Save changes</button></div></div>
    </div>`;
  bindTopbar(app());
  const els = [...app().querySelectorAll('[data-key]')];
  const mark = () => els.forEach(el => el.classList.toggle('changed', readField(el) !== el.dataset.orig));
  els.forEach(el => { el.addEventListener('input', mark); el.addEventListener('change', mark); });
  $('#esave').addEventListener('click', () => {
    const changes = {};
    els.forEach(el => {
      const val = readField(el);
      if (val === el.dataset.orig) return;
      const f = fields.find(ff => ff.key === el.dataset.key);
      if (f && f.key === 'name' && !val) return;
      changes[el.dataset.key] = f && f.type === 'yesno' ? (val === 'yes' ? true : val === 'no' ? false : '') : val;
    });
    const note = $('#enote').value.trim();
    if (!Object.keys(changes).length && !note) { history.back(); return; }
    S.outbox.push({ kind: 'edit', id: uid(), by: S.user.email, contact_id: per.contact_id, contact_name: per.name, changes, note });
    save('outbox');
    rememberToday({ contact_id: per.contact_id, name: per.name, phone: per.phone, status: Object.keys(changes).length ? 'Details updated' : 'Note added', campaign: '' });
    Object.keys(changes).forEach(k => { per.contact.values[k] = changes[k]; if (k === 'name') { per.name = changes[k]; per.contact.name = changes[k]; } });
    (per.history = per.history || []).unshift({ at: Date.now(), by: S.user.name, status: Object.keys(changes).length ? 'Details updated' : 'Note', notes: note, kind: 'edit', pending: true });
    rememberPerson(per);
    toast(navigator.onLine ? 'Saved' : 'Saved on this phone. It will send when you are online.');
    history.back();
    syncOutbox();
  });
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
          <div><span class="k">Waiting to send (calls, new people, edits, give-backs)</span><span class="v">${q.length}${others ? ` <span class="muted small">(+${others} from another account on this phone)</span>` : ''}</span>
            ${q.length ? '<button class="btn" id="sendnow">Send now</button>' : ''}</div>
          ${S.failed.length ? `<div><span class="k">Calls the server could not save</span>
            ${S.failed.map(f => `<span class="small">${esc(f.contact_name || (f.values && f.values.name) || f.contact_id)}, ${esc(f.status)}: ${esc(f.reason)}</span>`).join('<br>')}
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
  $('#signout').addEventListener('click', () => {
    if (q.length && !confirm(`${q.length} item${q.length > 1 ? 's are' : ' is'} not sent yet. They stay on this phone and send after you sign in again. Sign out?`)) return;
    api('signout').catch(() => { /* offline is fine */ });
    clearLocalPeople();
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
  pruneLocal();
  S.view = { view: startView(), params: {} };
  history.replaceState({ view: S.view.view, params: {}, i: 0 }, '');
  trail[0] = { view: S.view.view, params: {} };
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
