import { $, api, esc, fmtCredits, fmtInt, loadShell, quotaText } from './common.js';

// The credits page: totals, credits by day (one bar per day, empty days kept), by model, and the
// chats that cost the most. The readout above the bars keeps one height so the plot never moves.

const store = {
  get: (k) => { try { return localStorage.getItem(`pilotkit.${k}`); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(`pilotkit.${k}`, v); } catch { /* private window */ } },
};
const plural = (n, one, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const label = (day, opts) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, opts);

let days = Number(store.get('days')) || 30;
let series = [];
let picked = null;
const HINT = 'Point at a day, or use the arrow keys, to read its credits.';

function tile(title, value, sub) {
  return `<div class="tile"><div class="label">${esc(title)}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
}

function fillDays(byDay) {
  const have = new Map(byDay.map((d) => [d.day, d]));
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  for (let i = 0; i < days; i++, d.setDate(d.getDate() + 1)) {
    const key = isoDay(d);
    out.push(have.get(key) ?? { day: key, credits: 0, calls: 0 });
  }
  return out;
}

function drawBars() {
  const max = Math.max(...series.map((d) => d.credits), 0);
  const peak = max > 0 ? series.findIndex((d) => d.credits === max) : -1;
  $('#bars').innerHTML = series.map((d, i) => {
    const h = max > 0 ? Math.max(d.credits > 0 ? 2 : 0, (d.credits / max) * 100) : 0;
    return `<div class="bar${i === peak ? ' peak' : ''}${i === picked ? ' picked' : ''}" style="height:${h}%"></div>`;
  }).join('');
  const first = series[0]?.day;
  const lastDay = series.at(-1)?.day;
  $('#axis').innerHTML = first ? `<span>${label(first, { day: 'numeric', month: 'short' })}</span><span>${label(lastDay, { day: 'numeric', month: 'short' })}</span>` : '';
  drawReadout();
}

function drawReadout() {
  const d = series[picked];
  $('#readout').textContent = d
    ? `${label(d.day, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtCredits(d.credits)} credits · ${plural(d.calls, 'model call')}`
    : HINT;
  $('#bars').dataset.picking = d ? 'true' : 'false';
  [...$('#bars').children].forEach((el, i) => el.classList.toggle('picked', i === picked));
}

function pickAt(clientX) {
  const box = $('#bars').getBoundingClientRect();
  const i = Math.floor(((clientX - box.left) / box.width) * series.length);
  picked = Math.min(series.length - 1, Math.max(0, i));
  drawReadout();
}

function wireChart() {
  const bars = $('#bars');
  bars.addEventListener('pointermove', (e) => pickAt(e.clientX));
  bars.addEventListener('pointerdown', (e) => pickAt(e.clientX));
  // A finger lifting is not leaving the chart: on touch the last pick stays.
  bars.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'touch') return;
    picked = null;
    drawReadout();
  });
  bars.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.key === 'ArrowLeft' ? -1 : 1;
      picked = picked == null ? series.length - 1 : Math.min(series.length - 1, Math.max(0, picked + step));
      drawReadout();
    }
    if (e.key === 'Escape') {
      picked = null;
      drawReadout();
    }
  });
  bars.addEventListener('blur', () => {
    picked = null;
    drawReadout();
  });
}

async function load() {
  for (const b of document.querySelectorAll('#period button')) b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days));
  const r = await api(`/api/credits?days=${days}`);
  const period = r.byDay.reduce((s, d) => ({ credits: s.credits + d.credits, calls: s.calls + d.calls }), { credits: 0, calls: 0 });
  const q = quotaText(r.quota);
  $('#tiles').innerHTML = [
    tile('Today', fmtCredits(r.today.credits), plural(r.today.calls, 'model call')),
    tile(`Last ${days} days`, fmtCredits(period.credits), plural(period.calls, 'model call')),
    tile('This month', fmtCredits(r.month.credits), 'on this desk'),
    q ? tile('Copilot allowance', esc(q.short.replace(' used', '')), 'used this month, all Copilot clients')
      : tile('Copilot allowance', '–', 'not available'),
  ].join('');

  series = fillDays(r.byDay);
  picked = null;
  drawBars();

  $('#models').innerHTML = r.byModel.length
    ? `<thead><tr><th>Model</th><th class="num">Credits</th><th class="num">Calls</th><th class="num">Input tokens</th><th class="num">Output tokens</th></tr></thead><tbody>${
      r.byModel.map((m) => `<tr><td>${esc(m.model)}</td><td class="num">${fmtCredits(m.credits)}</td><td class="num">${fmtInt(m.calls)}</td><td class="num">${fmtInt(m.prompt_tokens)}</td><td class="num">${fmtInt(m.output_tokens)}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="muted">Nothing spent in this period.</td></tr></tbody>';
  $('#chats').innerHTML = r.topChats.length
    ? `<thead><tr><th>Chat</th><th class="num">Credits</th><th class="num">Questions</th><th>Started</th></tr></thead><tbody>${
      r.topChats.map((c) => `<tr><td><a href="/#c=${c.id}">${esc(c.title)}</a></td><td class="num">${fmtCredits(c.credits)}</td><td class="num">${fmtInt(c.turns)}</td><td>${label(c.started_at.slice(0, 10), { day: 'numeric', month: 'short' })}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="muted">No chats in this period.</td></tr></tbody>';
}

async function main() {
  await loadShell();
  wireChart();
  $('#period').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-days]');
    if (!b) return;
    days = Number(b.dataset.days);
    store.set('days', String(days));
    load();
  });
  await load();
}

main().catch((err) => {
  $('#tiles').innerHTML = `<div class="banner">The credits did not load: ${esc(err.message)}. Is <code>pilotkit start</code> still running?</div>`;
});
