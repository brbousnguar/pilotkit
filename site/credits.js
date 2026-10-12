import { api, esc, fmtCredits as fmt, loadShell } from './common.js';

// The Credits page: the month of the Copilot allowance against an even plan, credits per day (this desk
// and the rest of the account), the month line against the plan, and the habits of this desk.
// Data: GET /api/month (src/desk/month.mjs). Without a monthly allowance (Copilot not signed in, or a
// plan without a limit) the page shows this desk alone, with no plan.

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const nf = new Intl.NumberFormat('en-US');
const dayName = (startIso, day) => new Date(Date.parse(startIso) + (day - 1) * 86400000)
  .toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const svg = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.appendChild(n);
  return n;
};
// A clean axis maximum at or above v: 1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten.
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((m) => m >= v * 0.9999) ?? 10 * p;
}
const tickText = (v, max) => (max >= 8 ? nf.format(Math.round(v)) : String(+v.toFixed(2)));

// ── Tooltip ─────────────────────────────────────────────────────────
const tip = $('tooltip');
function showTip(event, head, rows, note) {
  tip.replaceChildren();
  const h = document.createElement('div');
  h.className = 'tt-head';
  h.textContent = head;
  tip.append(h);
  for (const { value, label, color, dash } of rows) {
    const row = document.createElement('div');
    row.className = 'tt-row';
    const key = document.createElement('i');
    key.className = `tt-key${dash ? ' dash' : ''}`;
    key.style.borderColor = color;
    const b = document.createElement('b');
    b.textContent = value;
    const s = document.createElement('span');
    s.textContent = label;
    row.append(key, b, s);
    tip.append(row);
  }
  if (note) {
    const n = document.createElement('div');
    n.className = 'tt-note';
    n.textContent = note;
    tip.append(n);
  }
  tip.hidden = false;
  const w = tip.offsetWidth;
  const hgt = tip.offsetHeight;
  tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, event.clientX + 14))}px`;
  tip.style.top = `${Math.max(8, event.clientY - hgt - 12 < 8 ? event.clientY + 18 : event.clientY - hgt - 12)}px`;
}
const hideTip = () => { tip.hidden = true; };

// ── Tiles ───────────────────────────────────────────────────────────
const ICON = {
  good: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M7.8 12.3l2.8 2.8 5.6-6"/></svg>',
  bad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.4v.1"/></svg>',
  even: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M7.5 12h9"/></svg>',
};
const paceState = (r) => {
  const gap = r.paceNow - r.used;
  const band = Math.max(1, r.budget * 0.01);
  return { gap, band, state: gap > band ? 'good' : gap < -band ? 'bad' : 'even' };
};

function tiles(r) {
  const endDay = dayName(r.month.start, r.month.days);
  const atRate = `
    <div class="tile">
      <span class="label">At this rate</span>
      <span class="value">≈ ${fmt(r.projected)}</span>
      <span class="note">by ${esc(endDay)}${r.budget ? `: ${Math.round((r.projected / r.budget) * 100)}% of the allowance${r.projected > r.budget ? ', over it' : ''}` : ' on this desk'}.</span>
    </div>`;
  if (!r.budget) {
    $('tiles').className = 'tiles short';
    $('tiles').innerHTML = `
      <div class="tile lead">
        <span class="label">Used this month · this desk</span>
        <span class="value">${fmt(r.deskUsed)}<small>credits</small></span>
        <span class="note">Copilot reports no monthly allowance here (not signed in, or a plan without a limit), so there is no plan to compare against, and Copilot in VS Code, the CLI or the app is not counted.</span>
      </div>
      <div class="tile">
        <span class="label">Today</span>
        <span class="value">${fmt(r.todayUse)}</span>
        <span class="note">credits on this desk today.</span>
      </div>${atRate}`;
    return;
  }
  const { gap, band, state } = paceState(r);
  const statusText = { good: 'Below plan', bad: 'Ahead of plan', even: 'On plan' }[state];
  const statusNote = state === 'good' ? `${fmt(gap)} credits under the plan for now (${fmt(r.paceNow)}).`
    : state === 'bad' ? `${fmt(-gap)} credits over the plan for now (${fmt(r.paceNow)}).`
      : `Within ${fmt(band)} credits of the plan for now (${fmt(r.paceNow)}).`;
  const pct = Math.min(100, (r.used / r.budget) * 100);
  const pacePct = Math.min(100, (r.paceNow / r.budget) * 100);
  const read = r.usedAt ? new Date(r.usedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : null;
  const todayPct = Math.min(100, (r.todayUse / r.plan) * 100);
  $('tiles').className = 'tiles';
  $('tiles').innerHTML = `
    <div class="tile lead">
      <span class="label">Used this month · your Copilot account</span>
      <span class="value">${fmt(r.used)}<small>of ${nf.format(r.budget)} credits</small></span>
      <div class="cmeter" role="img" aria-label="${fmt(r.used)} of ${nf.format(r.budget)} used; the plan for now is ${fmt(r.paceNow)}">
        <div class="fill ${state === 'bad' ? 'over' : ''}" style="width:${pct}%"></div>
        <div class="pace" style="left:calc(${pacePct}% - 1px)" title="Plan for now: ${fmt(r.paceNow)}"></div>
      </div>
      <div class="meter-scale"><span>0</span><span>plan for now ${fmt(r.paceNow)}</span><span>${nf.format(r.budget)}</span></div>
      <span class="note">${read ? `GitHub's figure, read at ${read}, for every Copilot client together.` : ''} This desk made ${fmt(r.deskUsed)} of it.</span>
    </div>
    <div class="tile">
      <span class="label">Pace</span>
      <span class="status ${state}">${ICON[state]}${statusText}</span>
      <span class="note">${statusNote}</span>
    </div>
    <div class="tile">
      <span class="label">Today</span>
      <span class="value">${fmt(r.todayUse)}<small>of ${fmt(r.plan)}</small></span>
      <div class="minibar" role="img" aria-label="${fmt(r.todayUse)} of the daily plan ${fmt(r.plan)}"><i class="${r.todayUse > r.plan ? 'over' : ''}" style="width:${todayPct}%"></i></div>
      <span class="note">${r.todayUse > r.plan ? `${fmt(r.todayUse - r.plan)} over the daily plan.` : `${fmt(r.plan - r.todayUse)} left in today's plan.`}${r.firstTracked === r.month.today ? ' Includes the earlier use of the month, which the desk could not split by day.' : ''}</span>
    </div>
    <div class="tile">
      <span class="label">Left per day</span>
      <span class="value">${fmt(r.leftPerDay)}</span>
      <span class="note">credits a day until ${esc(endDay)}, today included.</span>
    </div>${atRate}`;
}

// Charts are drawn at the width of their card (and again on resize), so their text keeps its size on a phone.
const sizeOf = (id) => {
  const W = Math.max(300, Math.round($(id).clientWidth || 960));
  return { W, narrow: W < 640 };
};

// ── Chart 1: credits per day ────────────────────────────────────────
function dailyChart(r) {
  const { W, narrow } = sizeOf('daily');
  const H = narrow ? 230 : 280, ml = 42, mr = narrow ? 58 : 112, mt = 14, mb = 30;
  const pw = W - ml - mr, ph = H - mt - mb;
  const total = (d) => d.desk + (d.other ?? 0);
  const max = niceMax(Math.max(r.plan ? r.plan * 1.2 : 0, ...r.perDay.map(total)) * 1.05);
  const y = (v) => mt + ph - (v / max) * ph;
  const band = pw / r.month.days;
  const bw = Math.min(24, band * 0.62);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': `Credits per day this month, this desk and other Copilot use${r.plan ? `, against a daily plan of ${fmt(r.plan)}` : ''}` });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    svg('line', { class: i ? 'grid' : 'axis', x1: ml, x2: ml + pw, y1: y(v), y2: y(v) }, root);
    svg('text', { class: 'tick', x: ml - 8, y: y(v) + 4, 'text-anchor': 'end' }, root).textContent = tickText(v, max);
  }
  const bars = svg('g', {}, root);
  const hits = svg('g', {}, root);
  const groups = [];
  for (const d of r.perDay) {
    const cx = ml + band * (d.day - 0.5);
    const step = narrow ? 10 : 5;
    const lbl = d.day === r.month.today ? 'today'
      : (d.day === 1 || d.day % step === 0) && Math.abs(d.day - r.month.today) > (narrow ? 3 : 1) ? String(d.day) : null;
    if (lbl) svg('text', { class: `tick ${d.day === r.month.today ? 'today' : ''}`, x: cx, y: H - 8, 'text-anchor': 'middle' }, root).textContent = lbl;
    if (d.future) continue;
    const g = svg('g', { class: 'day' }, bars);
    groups.push(g);
    // Stacked from the baseline: this desk, then other use, a 2px gap between them, a round top.
    const segs = [[d.desk, 'var(--s-desk)'], [d.other ?? 0, 'var(--s-other)']].filter(([v]) => v > 0);
    let base = 0;
    segs.forEach(([v, color], k) => {
      const top = k === segs.length - 1;
      const y0 = y(base) - (k ? 2 : 0);
      const y1 = Math.min(y(base + v), y0 - 1);
      const h = y0 - y1;
      const x0 = cx - bw / 2;
      const rr = top ? Math.min(4, h, bw / 2) : 0;
      svg('path', { class: 'bar-in', fill: color, d: `M${x0},${y0} V${y1 + rr} Q${x0},${y1} ${x0 + rr},${y1} H${x0 + bw - rr} Q${x0 + bw},${y1} ${x0 + bw},${y1 + rr} V${y0} Z` }, g);
      base += v;
    });
    const hit = svg('rect', { class: 'hit', x: cx - band / 2, y: mt, width: band, height: ph, tabindex: 0, role: 'img',
      'aria-label': `${dayName(r.month.start, d.day)}: ${fmt(total(d))} credits` }, hits);
    const show = (e) => {
      groups.forEach((x) => x.classList.toggle('dim', x !== g));
      const rows = [{ value: fmt(d.desk), label: 'this desk', color: 'var(--s-desk)' }];
      if (r.budget) rows.push({ value: d.other == null ? 'not tracked' : fmt(d.other), label: 'other Copilot use', color: 'var(--s-other)' });
      if (r.plan) rows.push({ value: fmt(r.plan), label: 'daily plan', color: 'var(--ink-2)', dash: true });
      const note = d.day === r.firstTracked ? 'Other use includes the earlier use of the month, not split by day.' : null;
      showTip(e, `${dayName(r.month.start, d.day)} · ${fmt(total(d))} credits`, rows, note);
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('focus', () => { const b = hit.getBoundingClientRect(); show({ clientX: b.left + b.width / 2, clientY: b.top + 30 }); });
    const out = () => { groups.forEach((x) => x.classList.remove('dim')); hideTip(); };
    hit.addEventListener('pointerleave', out);
    hit.addEventListener('blur', out);
  }
  if (r.plan) {
    svg('line', { class: 'ref', x1: ml, x2: ml + pw, y1: y(r.plan), y2: y(r.plan) }, root);
    svg('text', { class: 'reflabel', x: ml + pw + 8, y: y(r.plan) + 4 }, root).textContent = narrow ? fmt(r.plan) : `daily plan ${fmt(r.plan)}`;
  }
  $('daily').replaceChildren(root);
  $('daily-legend').innerHTML = `
    <span><i class="key-rect" style="background:var(--s-desk)"></i>This desk</span>
    ${r.budget ? '<span><i class="key-rect" style="background:var(--s-other)"></i>Other Copilot use</span>' : ''}
    ${r.plan ? '<span><i class="key-line dash" style="border-color:var(--ink-2)"></i>Daily plan</span>' : ''}`;
  const rows = r.perDay.filter((d) => !d.future).map((d) => `<tr><td>${esc(dayName(r.month.start, d.day))}</td><td>${fmt(d.desk)}</td>${r.budget
    ? `<td>${d.other == null ? 'not tracked' : fmt(d.other)}</td><td>${fmt(total(d))}</td><td>${fmt(r.plan)}</td>` : ''}</tr>`).join('');
  $('daily-table').innerHTML = `<table><thead><tr><th>Day</th><th>This desk</th>${r.budget ? '<th>Other use</th><th>Total</th><th>Plan</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`;
  $('daily-sub').textContent = r.budget
    ? 'Each day against the daily plan: the monthly allowance spread evenly over the month.'
    : 'Each day of the month on this desk.';
}

// ── Chart 2: the month against the plan ─────────────────────────────
function monthChart(r) {
  const { W, narrow } = sizeOf('month');
  const H = narrow ? 230 : 280, ml = 48, mr = narrow ? 64 : 112, mt = 16, mb = 30;
  const pw = W - ml - mr, ph = H - mt - mb;
  const D = r.month.days;
  const max = niceMax(Math.max(r.budget ?? 0, r.projected, r.used) * 1.02);
  const x = (t) => ml + (t / D) * pw;
  const y = (v) => mt + ph - (v / max) * ph;
  // Used at the end of each past day, then now: the last point is GitHub's figure (or this desk's total).
  // Before the first reading of the account (firstTracked) the days are unknown: one dashed segment from the reset.
  const gap = r.budget && r.firstTracked > 1 ? r.firstTracked : 0;
  const pts = [[0, 0]];
  let sum = 0;
  for (const d of r.perDay) {
    if (d.day >= r.month.today) break;
    sum += d.desk + (r.budget ? d.other ?? 0 : 0);
    if (d.day >= gap) pts.push([d.day, sum]);
  }
  pts.push([r.month.elapsed, r.used]);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': `Credits used since the reset: ${fmt(r.used)}${r.budget ? `, against a plan of ${fmt(r.paceNow)} for now and ${nf.format(r.budget)} for the month` : ''}` });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    svg('line', { class: i ? 'grid' : 'axis', x1: ml, x2: ml + pw, y1: y(v), y2: y(v) }, root);
    svg('text', { class: 'tick', x: ml - 8, y: y(v) + 4, 'text-anchor': 'end' }, root).textContent = tickText(v, max);
  }
  for (const d of (narrow ? [1, 10, 20, 30] : [1, 5, 10, 15, 20, 25, 30]).filter((d) => d <= D)) {
    svg('text', { class: 'tick', x: x(d - 0.5), y: H - 8, 'text-anchor': 'middle' }, root).textContent = String(d);
  }
  if (r.budget) {
    svg('line', { class: 'ref', x1: x(0), y1: y(0), x2: x(D), y2: y(r.budget) }, root);
    svg('text', { class: 'reflabel', x: x(D) + 8, y: y(r.budget) + 4 }, root).textContent = narrow ? nf.format(r.budget) : `plan ${nf.format(r.budget)}`;
  }
  svg('path', { class: 'proj', d: `M${x(r.month.elapsed)},${y(r.used)} L${x(D)},${y(r.projected)}` }, root);
  svg('text', { class: 'reflabel', x: x(D) + 8, y: Math.min(y(r.projected) + 4, y(0) - 4) }, root).textContent = `≈ ${fmt(r.projected)}`;
  const path = (list) => list.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t)},${y(v)}`).join(' ');
  const line = path(pts);
  svg('path', { class: 'area', d: `${line} L${x(r.month.elapsed)},${y(0)} L${x(0)},${y(0)} Z` }, root);
  if (gap) {
    svg('path', { class: 'untracked', d: path(pts.slice(0, 2)) }, root);
    if (pts.length > 2) svg('path', { class: 'total', d: path(pts.slice(1)) }, root);
  } else svg('path', { class: 'total', d: line }, root);
  svg('circle', { class: 'endmark', cx: x(r.month.elapsed), cy: y(r.used), r: 5 }, root);
  svg('text', { class: 'endlabel', x: x(r.month.elapsed) + 10, y: y(r.used) - 10 }, root).textContent = `${fmt(r.used)} now`;
  // Crosshair: the pointer finds the day; the readout gives what was used and the plan at the end of that day (or now).
  const cross = svg('line', { class: 'cross', x1: 0, x2: 0, y1: mt, y2: mt + ph, visibility: 'hidden' }, root);
  const hit = svg('rect', { class: 'hit', x: ml, y: mt, width: pw, height: ph, tabindex: 0, role: 'img', 'aria-label': 'Move along the month to read the credits used and the plan' }, root);
  const at = (t) => {
    if (t >= r.month.elapsed) return r.used;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][0] >= t) { const [t0, v0] = pts[i - 1]; const [t1, v1] = pts[i]; return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0 || 1); }
    }
    return r.used;
  };
  const show = (e, t) => {
    const k = Math.min(D, Math.max(1, Math.ceil(t)));
    const now = k >= r.month.today;
    const tt = now ? r.month.elapsed : k;
    cross.setAttribute('x1', x(tt)); cross.setAttribute('x2', x(tt)); cross.setAttribute('visibility', 'visible');
    const rows = k > r.month.today
      ? [{ value: `≈ ${fmt(r.used + ((r.projected - r.used) * (k - r.month.elapsed)) / Math.max(1e-9, D - r.month.elapsed))}`, label: 'at this rate', color: 'var(--ink-3)', dash: true }]
      : gap && tt < pts[1][0]
        ? [{ value: `≈ ${fmt(at(tt))}`, label: 'used, before the first reading', color: 'var(--s-total)', dash: true }]
        : [{ value: fmt(at(tt)), label: 'used', color: 'var(--s-total)' }];
    if (r.budget) rows.push({ value: fmt((r.budget * (k > r.month.today ? k : tt)) / D), label: 'plan', color: 'var(--ink-2)', dash: true });
    showTip(e, now && k === r.month.today ? `${dayName(r.month.start, k)} · now` : `End of ${dayName(r.month.start, k)}`, rows);
  };
  hit.addEventListener('pointermove', (e) => {
    const b = root.getBoundingClientRect();
    show(e, ((((e.clientX - b.left) / b.width) * W - ml) / pw) * D);
  });
  hit.addEventListener('focus', () => {
    const b = root.getBoundingClientRect();
    show({ clientX: b.left + (x(r.month.elapsed) / W) * b.width, clientY: b.top + (y(r.used) / H) * b.height }, r.month.elapsed);
  });
  const out = () => { cross.setAttribute('visibility', 'hidden'); hideTip(); };
  hit.addEventListener('pointerleave', out);
  hit.addEventListener('blur', out);
  $('month').replaceChildren(root);
  $('month-legend').innerHTML = `
    <span><i class="key-line" style="border-color:var(--s-total)"></i>Used${r.budget ? ' (your Copilot account)' : ' (this desk)'}</span>
    ${r.budget ? '<span><i class="key-line dash" style="border-color:var(--ink-2)"></i>Plan</span>' : ''}
    <span><i class="key-line dot" style="border-color:var(--ink-3)"></i>At this rate</span>`;
  const rows = pts.slice(1).map(([t, v]) => {
    const isNow = t === r.month.elapsed;
    const label = isNow ? `${esc(dayName(r.month.start, r.month.today))} (now)` : `End of ${esc(dayName(r.month.start, t))}`;
    return `<tr><td>${label}</td><td>${fmt(v)}</td>${r.budget ? `<td>${fmt((r.budget * t) / D)}</td>` : ''}</tr>`;
  }).join('');
  $('month-table').innerHTML = `<table><thead><tr><th>When</th><th>Used</th>${r.budget ? '<th>Plan</th>' : ''}</tr></thead><tbody>${rows}
    <tr><td>End of ${esc(dayName(r.month.start, D))} at this rate</td><td>≈ ${fmt(r.projected)}</td>${r.budget ? `<td>${nf.format(r.budget)}</td>` : ''}</tr></tbody></table>`;
  $('month-title').textContent = r.budget ? 'The month against the plan' : 'The month so far';
  $('month-sub').textContent = r.budget
    ? `Credits used since the reset, the plan line to the allowance, and where the current pace ends.${gap ? ` The desk first read your account on ${dayName(r.month.start, gap)}: the dashed start is a straight line, not the real days.` : ''}`
    : 'Credits this desk used since the 1st, and where the current pace ends.';
}

// ── Habits ──────────────────────────────────────────────────────────
function habits(r) {
  const h = r.habits;
  const deskTotal = h.byModel.reduce((a, m) => a + m.credits, 0) || 1;
  const maxModel = Math.max(...h.byModel.map((m) => m.credits), 0.001);
  const perChat = h.chats.n ? h.chats.credits / h.chats.n : 0;
  const perMsg = h.chats.turns ? h.chats.credits / h.chats.turns : 0;
  const readShare = h.tokens.prompt ? h.tokens.read / h.tokens.prompt : 0;

  // Tips from the figures: the costliest model, follow-ups after the cache expired, the pace; then two that always hold.
  const tips = [];
  const top = h.byModel[0];
  const p = top && h.prices[top.model];
  if (p && top.credits / deskTotal > 0.5) {
    const [cheap, q] = Object.entries(h.prices).filter(([id, x]) => id !== top.model && x.inputPrice > 0 && x.inputPrice < p.inputPrice)
      .sort((a, b) => a[1].inputPrice - b[1].inputPrice)[0] ?? [];
    if (cheap) {
      tips.push(`${top.model} made ${Math.round((top.credits / deskTotal) * 100)}% of this desk's credits. ${cheap} costs ${+(p.inputPrice / q.inputPrice).toFixed(1)}× less per input token: pick it in the settings (the gear) for lookups, and keep ${top.model} for long summaries.`);
    }
  }
  if (h.cold.count) tips.push(`${h.cold.count} follow-up${h.cold.count > 1 ? 's' : ''} came after the 5-minute prompt cache had expired (${fmt(h.cold.credits)} credits): the whole chat was sent again at full price. After a pause, a new chat for a new subject costs less.`);
  if (r.budget) {
    if (r.projected <= r.budget) {
      const room = perChat ? Math.floor((r.budget - r.projected) / perChat) : 0;
      tips.push(`At this pace your account uses about ${Math.round((r.projected / r.budget) * 100)}% of the month's allowance${room ? `: room for about ${nf.format(room)} more chats like your average one here` : ''}.`);
    } else {
      const day = Math.ceil(r.budget / (r.used / Math.max(1, r.month.elapsed)));
      tips.push(`At this pace your account reaches ${nf.format(r.budget)} around ${dayName(r.month.start, Math.min(day, r.month.days))}.`);
    }
  }
  tips.push('Name the issue key or paste the page link: the assistant reads one item instead of searching.');
  tips.push('Every model call sends the whole chat again, so a long chat costs more with each question.');

  $('habits').innerHTML = `
    <article class="card habit">
      <h3>Where the credits go · by model</h3>
      ${h.byModel.map((m) => `
        <div class="hbar">
          <div class="hl"><span class="mono">${esc(m.model)}</span><b>${fmt(m.credits)}</b></div>
          <div class="track"><i style="width:${(m.credits / maxModel) * 100}%"></i></div>
          <span class="hs">${Math.round((m.credits / deskTotal) * 100)}% · ${m.calls} call${m.calls === 1 ? '' : 's'}</span>
        </div>`).join('') || '<p class="muted small">No call yet this month.</p>'}
    </article>
    <article class="card habit">
      <h3>Chats</h3>
      <span class="big">${fmt(perChat)}<small>credits per chat</small></span>
      <p class="muted small">${h.chats.n} chat${h.chats.n === 1 ? '' : 's'}, ${h.chats.turns} question${h.chats.turns === 1 ? '' : 's'}, ${fmt(perMsg)} credits per question.</p>
      <ul class="top-list">${h.top.map((t) => `<li><a href="/#c=${esc(t.id)}"><span>${esc(t.title)}</span><b>${fmt(t.credits)}</b></a></li>`).join('')}</ul>
    </article>
    <article class="card habit">
      <h3>Prompt cache</h3>
      <span class="big">${Math.round(readShare * 100)}%<small>of the input read from the cache</small></span>
      <div class="share" role="img" aria-label="${Math.round(readShare * 100)}% of the input tokens read from the cache"><i style="width:${readShare * 100}%"></i></div>
      <p class="muted small">${nf.format(h.tokens.read)} of ${nf.format(h.tokens.prompt)} input tokens. A token read from the cache costs a fraction of a fresh one.</p>
    </article>
    <article class="card habit">
      <h3>Tips from your month</h3>
      <ul class="tips">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </article>`;
}

// ── Load ────────────────────────────────────────────────────────────
let report = null;
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (report) { dailyChart(report); monthChart(report); } }, 150);
});

async function load() {
  const main = $('credits');
  main.setAttribute('aria-busy', 'true');
  const r = await api('/api/month');
  report = r;
  const month = new Date(r.month.start).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const reset = new Date(r.month.end).toLocaleString(undefined, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  $('cr-sub').textContent = r.budget
    ? `${month} · day ${r.month.today} of ${r.month.days} · ${nf.format(r.budget)} credits, reset on ${reset} (your time)`
    : `${month} · day ${r.month.today} of ${r.month.days} · this desk only`;
  tiles(r);
  dailyChart(r);
  monthChart(r);
  habits(r);
  main.setAttribute('aria-busy', 'false');
}

async function main() {
  await loadShell();
  await load();
  setInterval(() => load().catch(() => {}), 5 * 60 * 1000);
}

main().catch((err) => {
  $('tiles').innerHTML = `<div class="banner">The credits did not load: ${esc(err.message)}. Is <code>pilotkit start</code> still running?</div>`;
});
