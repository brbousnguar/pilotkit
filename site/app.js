import { $, api, esc, fmtCredits, fmtInt, fmtMs, loadShell, showQuota } from './common.js';
import { render } from './md.js';

// The chat page. A chat is a Copilot session on the server; this page lists them, shows one by
// turns with what each turn cost, and follows the running one through /api/stream.

const EXAMPLES = [
  'What are my open Jira issues, by priority?',
  'Which of my issues changed in the last 7 days?',
  'Summarize the issue KEY-123 and its last comments',
  'Find Confluence pages about onboarding',
  'Draft a stand-up update from my issues in progress',
];

const ui = {
  list: $('#chat-list'), messages: $('#messages'), form: $('#composer'), prompt: $('#prompt'),
  model: $('#model'), cap: $('#cap'), send: $('#send'), stop: $('#stop'), chats: $('#chats'), menu: $('#menu'),
};
let state = null;
let chats = [];
let currentId = null;
let current = null;
let streaming = '';
let flash = null;
// Cost panels the reader opened stay open while the thread redraws.
const openCosts = new Set();

const store = {
  get: (k) => { try { return localStorage.getItem(`pilotkit.${k}`); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(`pilotkit.${k}`, v); } catch { /* private window */ } },
};
const idFromHash = () => (location.hash.match(/^#c=([0-9a-f-]{36})$/) ?? [])[1] ?? null;
const running = (chat) => chat && (chat.status === 'running' || chat.status === 'stopping');
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function debounce(fn, ms) {
  let t;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

// ---- Chat list ----

async function loadChats() {
  chats = await api('/api/chats');
  ui.list.innerHTML = chats.length ? chats.map((c) => `
    <li><a href="#c=${c.id}" ${c.id === currentId ? 'aria-current="true"' : ''}>
      <span class="title">${running(c) ? '● ' : ''}${esc(c.title)}</span>
      <span class="meta">${day(c.started_at)} · ${fmtCredits(c.credits)} credits${c.status === 'failed' ? ' · failed' : ''}</span>
    </a></li>`).join('') : '<li class="empty">No chats yet.</li>';
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
  return m.scrollHeight - m.scrollTop - m.clientHeight < 120;
}

function renderThread() {
  const stick = nearBottom();
  ui.messages.innerHTML = (flash ? `<div class="banner">${esc(flash)}</div>` : '') + (current ? threadHtml() : welcomeHtml());
  syncComposer();
  if (stick || !current) ui.messages.scrollTop = ui.messages.scrollHeight;
}

function welcomeHtml() {
  const b = state.brand;
  const warn = [];
  if (!state.copilot.authenticated) warn.push('Copilot is not signed in on this PC. Run <code>pilotkit setup</code> in a terminal, then reopen the desk.');
  if (!state.atlassian.site) warn.push('Atlassian is not set up yet. Run <code>pilotkit setup</code> in a terminal.');
  return `
    ${warn.map((w) => `<div class="banner">${w}</div>`).join('')}
    <section class="welcome">
      <img src="/brand/logo" alt="${esc(b.name)}">
      <h1>${esc(b.product)}</h1>
      <p>${esc(b.welcome)}</p>
      <div class="examples">${EXAMPLES.map((x) => `<button type="button" data-example="${esc(x)}">${esc(x)}</button>`).join('')}</div>
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
  const body = [...turns.entries()].sort(([a], [b]) => a - b).map(([n, t]) => turnHtml(n, t, n === last && running(chat))).join('');
  return `
    <div class="thread-head">
      <div><strong>${esc(chat.title)}</strong>
        <span class="muted">${fmtCredits(chat.credits)} credits · ${chat.turns} ${chat.turns === 1 ? 'question' : 'questions'} · cap ${chat.max_credits}</span></div>
      <button class="btn" type="button" id="archive" ${running(chat) ? 'disabled' : ''}>Archive</button>
    </div>
    ${body}
    ${chat.status === 'failed' && chat.error ? `<div class="note error">${esc(chat.error)}</div>` : ''}`;
}

function turnHtml(n, t, live) {
  const parts = t.events.map((e) => {
    if (e.kind === 'user') return `<div class="msg user"><div class="bubble">${esc(e.text)}</div></div>`;
    if (e.kind === 'assistant') return `<div class="msg assistant"><div class="bubble">${render(e.text)}</div></div>`;
    return `<div class="msg"><div class="note ${e.kind === 'error' ? 'error' : ''}">${esc(e.text)}</div></div>`;
  });
  if (live) {
    if (streaming) parts.push(`<div class="msg assistant"><div class="bubble" id="streaming">${render(streaming)}</div></div>`);
    const pending = [...t.tools].reverse().find((x) => x.success == null && !x.refused);
    const doing = current.chat.status === 'stopping' ? 'Stopping…' : pending ? `Reading with ${esc(pending.name)}…` : streaming ? 'Writing…' : 'Thinking…';
    parts.push(`<div class="msg working"><span class="dot"></span>${doing}</div>`);
  }
  if (t.calls.length || t.tools.length) parts.push(costHtml(n, t, live));
  return parts.join('');
}

function costHtml(n, t, live) {
  const credits = t.calls.reduce((s, c) => s + c.credits, 0);
  const estimated = t.calls.some((c) => c.estimated);
  const stamps = [...t.events, ...t.calls, ...t.tools].map((x) => Date.parse(x.at)).filter(Number.isFinite);
  const took = stamps.length > 1 ? Math.max(...stamps) - Math.min(...stamps) : null;
  const calls = t.calls.map((c) => `<tr>
      <td>${c.seq}</td><td>${esc(c.model ?? '?')}</td>
      <td class="num">${fmtInt(c.prompt_tokens)}</td><td class="num">${fmtInt(c.cache_read)}</td><td class="num">${fmtInt(c.output_tokens)}</td>
      <td class="num">${c.estimated ? '≈' : ''}${fmtCredits(c.credits)}</td><td class="num">${fmtMs(c.duration_ms)}</td>
      <td>${esc(c.tools ?? '')}</td></tr>`).join('');
  const tools = t.tools.map((x) => `<tr>
      <td>${esc(x.name ?? '?')}</td><td class="args">${esc(x.args ?? '')}</td>
      <td class="num">${x.result_chars == null ? '' : fmtInt(x.result_chars)}</td><td class="num">${fmtMs(x.duration_ms)}</td>
      <td>${x.refused ? `<span class="refused">refused: ${esc(x.refused)}</span>` : x.success == null ? 'running' : x.success ? 'ok' : '<span class="refused">failed</span>'}</td></tr>`).join('');
  return `<details class="cost" data-turn="${n}" ${openCosts.has(`${currentId}:${n}`) ? 'open' : ''}>
    <summary><span class="credits">${estimated ? '≈' : ''}${fmtCredits(credits)} credits${live ? ' so far' : ''}</span>
      <span>${t.calls.length} model ${t.calls.length === 1 ? 'call' : 'calls'}</span>
      <span>${t.tools.length} tool ${t.tools.length === 1 ? 'call' : 'calls'}</span>
      ${took != null && !live ? `<span>${fmtMs(took)}</span>` : ''}</summary>
    ${calls ? `<table><thead><tr><th>#</th><th>Model</th><th class="num">Input tokens</th><th class="num">From cache</th><th class="num">Output</th><th class="num">Credits</th><th class="num">Time</th><th>Asked for</th></tr></thead><tbody>${calls}</tbody></table>` : ''}
    ${tools ? `<table><thead><tr><th>Tool</th><th>Arguments</th><th class="num">Chars back</th><th class="num">Time</th><th>Result</th></tr></thead><tbody>${tools}</tbody></table>` : ''}
    ${estimated ? '<p>≈ Copilot sent no cost for a call; it is estimated from the model\'s published prices.</p>' : ''}
  </details>`;
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
  const signedIn = state.copilot.authenticated;
  const busy = running(chat);
  ui.send.disabled = !signedIn || busy;
  ui.stop.hidden = !busy;
  ui.stop.disabled = chat?.status === 'stopping';
  ui.prompt.placeholder = chat ? 'Ask a follow-up…' : 'Ask about your Jira issues or Confluence pages…';
  const model = chat?.model ?? store.get('model') ?? state.defaults.model;
  if ([...ui.model.options].some((o) => o.value === model)) ui.model.value = model;
  if (chat) {
    ui.cap.value = chat.max_credits;
    ui.cap.disabled = true;
    ui.cap.parentElement.title = 'The cap is set when a chat starts; start a new chat for another cap.';
  } else {
    ui.cap.disabled = false;
    ui.cap.value = store.get('cap') ?? state.defaults.maxCredits;
    ui.cap.parentElement.title = `The chat stops when it has spent this many AI credits (Copilot's minimum is ${state.defaults.minCredits}).`;
  }
}

function fillModels() {
  const per = (p) => `${fmtCredits(p.inputPrice)} in / ${fmtCredits(p.outputPrice)} out per ${fmtInt(p.batchSize ?? 1e6)} tokens`;
  const models = state.models.length ? state.models : [{ id: state.defaults.model, name: state.defaults.model, prices: null }];
  ui.model.innerHTML = models.map((m) => `<option value="${esc(m.id)}" title="${esc(m.prices ? per(m.prices) : 'Copilot picks a model for each call')}">${esc(m.id === 'auto' ? 'Auto' : m.name)}</option>`).join('');
}

async function submit(e) {
  e?.preventDefault();
  const text = ui.prompt.value.trim();
  if (!text || ui.send.disabled) return;
  ui.send.disabled = true;
  flash = null;
  try {
    if (currentId) {
      await api(`/api/chats/${currentId}/messages`, { method: 'POST', body: { text, model: ui.model.value } });
    } else {
      const cap = Math.max(state.defaults.minCredits, Number(ui.cap.value) || state.defaults.maxCredits);
      store.set('cap', String(cap));
      const { id } = await api('/api/chats', { method: 'POST', body: { text, model: ui.model.value, maxCredits: cap } });
      location.hash = `c=${id}`;
    }
    store.set('model', ui.model.value);
    ui.prompt.value = '';
    autosize();
  } catch (err) {
    flash = err.message;
    renderThread();
  }
}

function autosize() {
  ui.prompt.style.height = 'auto';
  ui.prompt.style.height = `${Math.min(ui.prompt.scrollHeight + 2, window.innerHeight * 0.4)}px`;
}

// ---- Live updates ----

const reloadThread = debounce(loadThread, 120);
const reloadChats = debounce(loadChats, 300);
const reloadQuota = debounce(showQuota, 3000);

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
    if (e.kind === 'chat') reloadQuota();
  };
}

async function route() {
  currentId = idFromHash();
  streaming = '';
  flash = null;
  ui.chats.classList.remove('open');
  ui.menu.setAttribute('aria-expanded', 'false');
  await Promise.all([loadThread(), loadChats()]);
  ui.prompt.focus();
}

async function main() {
  state = await loadShell();
  fillModels();
  ui.form.addEventListener('submit', submit);
  ui.prompt.addEventListener('input', autosize);
  ui.prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) submit(e);
  });
  ui.stop.addEventListener('click', () => api(`/api/chats/${currentId}/stop`, { method: 'POST' }).catch((err) => { flash = err.message; renderThread(); }));
  $('#new-chat').addEventListener('click', () => {
    if (location.hash) location.hash = '';
    else route();
  });
  ui.menu.addEventListener('click', () => {
    const open = ui.chats.classList.toggle('open');
    ui.menu.setAttribute('aria-expanded', String(open));
  });
  ui.messages.addEventListener('click', async (e) => {
    const example = e.target.closest('[data-example]');
    if (example) {
      ui.prompt.value = example.dataset.example;
      autosize();
      ui.prompt.focus();
    }
    if (e.target.id === 'archive') {
      await api(`/api/chats/${currentId}/archive`, { method: 'POST' }).catch((err) => { flash = err.message; });
      location.hash = '';
    }
  });
  ui.messages.addEventListener('toggle', (e) => {
    const turn = e.target.dataset?.turn;
    if (!turn) return;
    const key = `${currentId}:${turn}`;
    if (e.target.open) openCosts.add(key);
    else openCosts.delete(key);
  }, true);
  window.addEventListener('hashchange', route);
  listen();
  showQuota();
  await route();
}

main().catch((err) => {
  ui.messages.innerHTML = `<div class="banner">The desk did not load: ${esc(err.message)}. Is <code>pilotkit start</code> still running?</div>`;
});
