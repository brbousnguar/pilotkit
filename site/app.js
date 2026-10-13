import { $, api, esc, fmtCredits, fmtMs, fmtTokens, loadShell, showMeter, store } from './common.js';
import { ACTIVITY, connectorsOf, joinWords, suggestionsOf } from './connectors.js';
import { render } from './md.js';

// The chat page. A chat is a Copilot session on the server; this page lists them, shows one by turns
// with the model calls and tool calls behind each answer, and follows the running one through /api/stream.

const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const ARCHIVE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5.5 8.5v10a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-10M10 12.5h4"/></svg>';
const STATUS = { running: 'working', stopping: 'stopping', ready: 'ready', failed: 'failed' };


const ui = {
  list: $('#chat-list'), messages: $('#messages'), head: $('#chat-head'), form: $('#composer'), prompt: $('#prompt'),
  send: $('#send'), hint: $('#hint'), history: $('#history'), menu: $('#menu'), scrim: $('#scrim'),
  gear: $('#gear'), settings: $('#settings'),
};
let state = null;
let connectors = [];
let suggestions = [];
let chats = [];
let currentId = null;
let current = null;
let streaming = '';
let flash = null;
let sending = false;
// Work panels the reader opened stay open while the thread redraws.
const openWork = new Set();
const NARROW = matchMedia('(max-width: 560px)');
const TINY = matchMedia('(max-width: 360px)');

const idFromHash = () => (location.hash.match(/^#c=([0-9a-f-]{36})$/) ?? [])[1] ?? null;
const running = (chat) => chat && (chat.status === 'running' || chat.status === 'stopping');
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
const args = (x) => { try { return JSON.parse(x.args ?? '{}'); } catch { return {}; } };

function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400 && new Date(iso).toDateString() === new Date().toDateString()) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function debounce(fn, ms) {
  let t;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

// ---- Settings: the model and the credit cap, kept in this browser ----

function settings() {
  const models = state.models.length ? state.models : [{ id: state.defaults.model, name: state.defaults.model, prices: null }];
  const saved = store.get('model');
  const model = models.find((m) => m.id === saved) ?? models.find((m) => m.id === state.defaults.model) ?? models[0];
  const cap = Number(store.get('cap'));
  return { models, model, cap: cap >= state.defaults.minCredits ? cap : state.defaults.maxCredits };
}
const modelName = (m) => (m.id === 'auto' ? 'Auto' : m.name);

function renderSettings() {
  const s = settings();
  const per = (p) => `${fmtCredits(p.inputPrice)} in / ${fmtCredits(p.outputPrice)} out`;
  ui.settings.innerHTML = `
    <h2>Settings</h2>
    <label class="field"><span>Model</span>
      <select id="set-model">${s.models.map((m) => `<option value="${esc(m.id)}" ${m.id === s.model.id ? 'selected' : ''}>${esc(modelName(m))} · ${m.prices ? per(m.prices) : 'Copilot picks one per call'}</option>`).join('')}</select>
      <span class="hint">Credits per million tokens, in and out. It applies from your next message.</span></label>
    <label class="field"><span>Stop a new chat after</span>
      <input id="set-cap" type="number" min="${state.defaults.minCredits}" step="10" inputmode="numeric" value="${s.cap}">
      <span class="hint">credits (Copilot's minimum is ${state.defaults.minCredits}). A chat keeps the cap it started with.</span></label>
    <div class="who">
      <span>Copilot: <b id="login">${esc(state.copilot.authenticated ? state.copilot.login ?? 'signed in' : 'not signed in')}</b></span>
      ${connectors.map((c) => `<span>${esc(c.title)}: <b>${esc(c.where ?? 'not set up')}</b></span>`).join('')}
      <span>pilotkit ${esc(state.version)}</span>
    </div>`;
  $('#set-model').addEventListener('change', (e) => { store.set('model', e.target.value); syncComposer(); });
  $('#set-cap').addEventListener('change', (e) => {
    const cap = Math.max(state.defaults.minCredits, Number(e.target.value) || state.defaults.maxCredits);
    e.target.value = cap;
    store.set('cap', String(cap));
    syncComposer();
  });
}

function toggleSettings(open = ui.settings.hidden) {
  if (open) renderSettings();
  ui.settings.hidden = !open;
  ui.gear.setAttribute('aria-expanded', String(open));
}

function toggleHistory(open = !ui.history.classList.contains('open')) {
  ui.history.classList.toggle('open', open);
  ui.scrim.hidden = !open;
  ui.menu.setAttribute('aria-expanded', String(open));
}

// ---- Chat list ----

function historyRow(c) {
  const busy = running(c);
  return `
    <div class="h-row">
      <a class="h-item" href="#c=${c.id}" ${c.id === currentId ? 'aria-current="page"' : ''}>
        <span class="h-title">${esc(c.title)}</span><span class="h-cr">${fmtCredits(c.credits)}</span>
        <span class="h-meta"><span class="dot ${esc(c.status)}"></span>${c.turns > 1 ? `${c.turns} questions · ` : ''}${ago(c.started_at)}</span>
      </a>
      ${busy ? '' : `<button type="button" class="h-act" data-archive="${c.id}" aria-label="Archive ${esc(c.title)}" title="Archive">${ARCHIVE_ICON}</button>`}
    </div>`;
}

async function loadChats() {
  chats = await api('/api/chats');
  const today = new Date().toDateString();
  const groups = [
    ['Today', chats.filter((c) => new Date(c.started_at).toDateString() === today)],
    ['Earlier', chats.filter((c) => new Date(c.started_at).toDateString() !== today)],
  ].filter(([, list]) => list.length);
  ui.list.innerHTML = groups.map(([name, list]) => `<div class="h-group">${name}</div>${list.map(historyRow).join('')}`).join('')
    || '<p class="h-empty">No chats yet.</p>';
}

// ---- One chat ----

async function loadThread() {
  if (!currentId) {
    current = null;
    return renderThread();
  }
  try {
    current = await api(`/api/chats/${currentId}`);
  } catch (err) {
    current = null;
    flash = err.message;
  }
  renderThread();
}

function nearBottom() {
  const m = ui.messages;
  return m.scrollHeight - m.scrollTop - m.clientHeight < 160;
}

function renderThread() {
  const stick = nearBottom();
  const banner = flash ? `<div class="banner">${esc(flash)}</div>` : '';
  if (current) {
    const { chat } = current;
    ui.head.hidden = false;
    ui.head.innerHTML = `
      <div class="chat-title">${esc(chat.title)}</div>
      <div class="chat-meta"><span class="dot ${esc(chat.status)}"></span>
        <span class="wide-only">${STATUS[chat.status] ?? esc(chat.status)}</span><span class="sep wide-only">·</span>
        <span class="mono">${esc(chat.model)}</span><span class="sep wide-only">·</span>
        <span class="wide-only">stops after ${chat.max_credits}</span><span class="sep">·</span>
        <span><b>${fmtCredits(chat.credits)}</b> credits</span></div>`;
    ui.messages.innerHTML = `<div class="thread-inner">${banner}${threadHtml()}</div>`;
  } else {
    ui.head.hidden = true;
    ui.messages.innerHTML = `${banner ? `<div class="thread-inner">${banner}</div>` : ''}${welcomeHtml()}`;
  }
  syncComposer();
  if (stick || !current) ui.messages.scrollTop = current ? ui.messages.scrollHeight : 0;
}

function defaultWelcome() {
  const about = joinWords(connectors.flatMap((c) => c.ui.long), 'and');
  return `${about ? `Ask about ${about}. ` : ''}Every answer shows the AI credits it cost.`;
}

function welcomeHtml() {
  const b = state.brand;
  const warn = [];
  if (!state.copilot.authenticated) warn.push('Copilot is not signed in on this PC. Run <code>pilotkit setup</code> in a terminal, then reopen the desk.');
  if (!connectors.length) warn.push('No system is connected yet. Run <code>pilotkit setup</code> in a terminal.');
  return `
    <section class="welcome">
      ${warn.map((w) => `<div class="banner">${w}</div>`).join('')}
      <h1>What do you want to know?</h1>
      <p>${esc(b.welcome ?? defaultWelcome())} Under each answer you see every model call and tool call behind it.</p>
      <div class="suggest">${suggestions.map(([q, sub], i) => `<button type="button" data-suggest="${i}">${esc(q.trim())}<span>${esc(sub)}</span></button>`).join('')}</div>
      ${b.links?.length ? `<p class="links">${b.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`).join(' · ')}</p>` : ''}
    </section>`;
}

function threadHtml() {
  const { chat, events, calls, tools } = current;
  const turns = new Map();
  const of = (t) => turns.get(t) ?? turns.set(t, { events: [], calls: [], tools: [] }).get(t);
  for (const e of events) of(e.turn).events.push(e);
  for (const c of calls) of(c.turn).calls.push(c);
  for (const t of tools) of(t.turn).tools.push(t);
  const last = Math.max(0, ...turns.keys());
  return [...turns.entries()].sort(([a], [b]) => a - b).map(([n, t]) => turnHtml(n, t, n === last && running(chat))).join('')
    + (chat.status === 'failed' && chat.error ? `<div class="turn-error">${esc(chat.error)}</div>` : '');
}

function turnHtml(n, t, live) {
  const user = t.events.find((e) => e.kind === 'user');
  const answers = t.events.filter((e) => e.kind === 'assistant');
  const final = live ? null : answers.at(-1);
  const notes = live ? answers : answers.slice(0, -1);
  let html = user ? `<div class="msg user"><div class="bubble">${esc(user.text)}</div></div>` : '';
  html += '<div class="msg assistant">';
  if (t.calls.length || t.tools.length) html += workHtml(n, t, notes, live);
  if (live) {
    const pending = [...t.tools].reverse().find((x) => x.success == null && !x.refused);
    const doing = current.chat.status === 'stopping' ? 'Stopping' : pending
      ? (ACTIVITY[pending.name] ?? (() => `Running ${pending.name}`))(args(pending)) : streaming ? 'Writing' : 'Thinking';
    html += `<div class="activity"><span class="spinner"></span>${esc(doing)}…</div>`;
    if (streaming) html += `<div class="answer live" id="streaming">${render(streaming)}</div>`;
  } else if (final) {
    html += `<div class="answer">${render(final.text)}</div>`;
  }
  for (const e of t.events.filter((x) => x.kind === 'error' || x.kind === 'stopped')) {
    html += `<div class="turn-error">${esc(e.kind === 'stopped' ? 'Stopped.' : e.text)}</div>`;
  }
  return `${html}</div>`;
}

function workHtml(n, t, notes, live) {
  const credits = t.calls.reduce((s, c) => s + c.credits, 0);
  const estimated = t.calls.some((c) => c.estimated);
  const refused = t.tools.filter((x) => x.refused).length;
  const key = `${currentId}:${n}`;
  return `<details class="work" data-turn="${n}" ${openWork.has(key) ? 'open' : ''}>
    <summary>${plural(t.calls.length, 'model call')} · ${plural(t.tools.length, 'tool')}${refused ? ` · ${refused} refused` : ''}
      · <b>${estimated ? '≈ ' : ''}${fmtCredits(credits)}</b> credits${live ? ' so far' : ''}</summary>
    ${notes.map((e) => `<div class="note-line">${esc(e.text)}</div>`).join('')}
    <div class="timeline">${timeline(t)}</div>
    ${estimated ? '<p class="est-note">≈ Copilot sent no cost for a call: it is estimated from the model\'s published prices.</p>' : ''}
  </details>`;
}

function argSummary(x) {
  const a = args(x);
  return a.key ?? a.jql ?? a.cql ?? a.query ?? a.page ?? (x.name === 'jira_my_issues' ? (a.include_done ? 'open and done' : 'open issues') : '');
}

// The calls and the tools of one turn, in the order they happened: a model call, then the tools it asked for.
function timeline(t) {
  const maxCr = Math.max(...t.calls.map((c) => c.credits), 0.0001);
  const rows = [...t.calls.map((c) => ({ at: c.at, k: 0, c })), ...t.tools.map((x) => ({ at: x.at, k: 1, x }))]
    .sort((a, b) => a.at.localeCompare(b.at) || a.k - b.k);
  return rows.map(({ c, x }) => (c ? `
    <div class="tl-call">
      <div class="tl-idx">#${c.seq}</div>
      <div class="tl-main">
        <div class="line1">Model call · <span class="mono">${esc(c.model ?? '?')}</span></div>
        <div class="line2">${fmtTokens(c.prompt_tokens)} in (${fmtTokens(c.cache_read)} from cache) · ${fmtTokens(c.output_tokens)} out${c.duration_ms ? ` · ${fmtMs(c.duration_ms)}` : ''}${c.tools ? ` · asks for ${esc(c.tools)}` : ''}</div>
        <div class="tl-bar" style="width:${(c.credits / maxCr) * 100}%"></div>
      </div>
      <div class="tl-cost"><b>${c.estimated ? '≈' : ''}${fmtCredits(c.credits)}</b><span>credits</span></div>
    </div>` : `
    <div class="tl-tool${x.refused ? ' refused' : ''}">
      <div class="tl-idx">tool</div>
      <div class="tl-main">
        <div class="line1">${esc(x.name ?? '?')}</div>
        <div class="line2 mono">${esc(x.refused ? `refused: ${x.refused}` : argSummary(x))}</div>
      </div>
      <div class="tl-cost">${x.refused ? '<span>refused</span>' : x.success == null ? '<span>running…</span>'
        : x.success ? `<b>${fmtTokens(Math.round((x.result_chars ?? 0) / 4))}</b><span>≈ tokens back${x.duration_ms != null ? ` · ${fmtMs(x.duration_ms)}` : ''}</span>`
          : '<span>failed</span>'}</div>
    </div>`)).join('') || '<p class="hint">Waiting for the first model call…</p>';
}

// Deltas only redraw the answer being written, not the whole thread.
let frame = 0;
function drawStreaming() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const el = $('#streaming');
    if (!el) return renderThread();
    const stick = nearBottom();
    el.innerHTML = render(streaming);
    if (stick) ui.messages.scrollTop = ui.messages.scrollHeight;
  });
}

// ---- Composer ----

function syncComposer() {
  const chat = current?.chat;
  const busy = running(chat);
  const s = settings();
  ui.send.classList.toggle('stop', Boolean(busy));
  ui.send.setAttribute('aria-label', busy ? 'Stop' : 'Send');
  ui.send.innerHTML = busy ? STOP_ICON : SEND_ICON;
  ui.send.disabled = busy ? chat.status === 'stopping' : !state.copilot.authenticated || sending || !ui.prompt.value.trim();
  const about = (key) => joinWords(connectors.flatMap((c) => c.ui[key]));
  ui.prompt.placeholder = chat ? 'Ask a follow-up…' : TINY.matches || !connectors.length ? 'Ask a question…' : `Ask about ${about(NARROW.matches ? 'short' : 'long')}…`;
  ui.hint.innerHTML = `<span class="wide-only">Enter to send · Shift+Enter for a new line</span>${chat
    ? `<span>Next message: ${esc(modelName(s.model))}</span>`
    : `<span>New chat: ${esc(modelName(s.model))} · stops after ${s.cap} credits</span>`}`;
}

async function submit(e) {
  e?.preventDefault();
  if (running(current?.chat)) {
    await api(`/api/chats/${currentId}/stop`, { method: 'POST' }).catch((err) => { flash = err.message; renderThread(); });
    return;
  }
  const text = ui.prompt.value.trim();
  if (!text || ui.send.disabled) return;
  const s = settings();
  sending = true;
  flash = null;
  syncComposer();
  try {
    if (currentId) {
      await api(`/api/chats/${currentId}/messages`, { method: 'POST', body: { text, model: s.model.id } });
    } else {
      const { id } = await api('/api/chats', { method: 'POST', body: { text, model: s.model.id, maxCredits: s.cap } });
      location.hash = `c=${id}`;
    }
    ui.prompt.value = '';
    autosize();
  } catch (err) {
    flash = err.message;
    renderThread();
  } finally {
    sending = false;
    syncComposer();
  }
}

function autosize() {
  ui.prompt.style.height = 'auto';
  ui.prompt.style.height = `${Math.min(ui.prompt.scrollHeight, 200)}px`;
}

// ---- Live updates ----

const reloadThread = debounce(loadThread, 120);
const reloadChats = debounce(loadChats, 300);
const reloadMeter = debounce(showMeter, 3000);

function listen() {
  const es = new EventSource('/api/stream');
  es.onmessage = (msg) => {
    const e = JSON.parse(msg.data);
    if (e.kind === 'delta') {
      if (e.chatId === currentId) {
        streaming += e.text;
        drawStreaming();
      }
      return;
    }
    if (e.chatId === currentId) {
      if (e.kind === 'event') streaming = '';
      reloadThread();
    }
    if (e.kind === 'chat' || e.kind === 'call') reloadChats();
    if (e.kind === 'chat') reloadMeter();
  };
}

async function route() {
  currentId = idFromHash();
  streaming = '';
  flash = null;
  toggleHistory(false);
  await Promise.all([loadThread(), loadChats()]);
  ui.prompt.focus();
}

async function main() {
  state = await loadShell();
  connectors = connectorsOf(state);
  suggestions = suggestionsOf(connectors);
  ui.form.addEventListener('submit', submit);
  ui.prompt.addEventListener('input', () => { autosize(); syncComposer(); });
  ui.prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!running(current?.chat)) submit();
    }
  });
  $('#new-chat').addEventListener('click', () => {
    if (location.hash) location.hash = '';
    else route();
  });
  ui.menu.addEventListener('click', () => toggleHistory());
  ui.scrim.addEventListener('click', () => toggleHistory(false));
  ui.gear.addEventListener('click', (e) => { e.stopPropagation(); toggleSettings(); });
  document.addEventListener('click', (e) => { if (!ui.settings.hidden && !ui.settings.contains(e.target)) toggleSettings(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { toggleSettings(false); toggleHistory(false); } });
  ui.list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-archive]');
    if (!b) return;
    e.preventDefault();
    b.disabled = true;
    try {
      await api(`/api/chats/${b.dataset.archive}/archive`, { method: 'POST' });
      if (b.dataset.archive === currentId) location.hash = '';
      await loadChats();
    } catch (err) {
      b.disabled = false;
      b.title = err.message;
    }
  });
  ui.messages.addEventListener('click', (e) => {
    const b = e.target.closest('[data-suggest]');
    if (!b) return;
    const [q, , send] = suggestions[b.dataset.suggest];
    ui.prompt.value = q;
    autosize();
    syncComposer();
    ui.prompt.focus();
    if (send) submit();
  });
  ui.messages.addEventListener('toggle', (e) => {
    const turn = e.target.dataset?.turn;
    if (!turn) return;
    const key = `${currentId}:${turn}`;
    if (e.target.open) openWork.add(key);
    else openWork.delete(key);
  }, true);
  window.addEventListener('hashchange', route);
  NARROW.addEventListener('change', syncComposer);
  TINY.addEventListener('change', syncComposer);
  listen();
  showMeter();
  await route();
}

main().catch((err) => {
  ui.messages.innerHTML = `<div class="thread-inner"><div class="banner">The desk did not load: ${esc(err.message)}. Is <code>pilotkit start</code> still running?</div></div>`;
});
