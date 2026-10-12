// What every page of the desk shares: the API helper, number formats, the brand (name, logo, accent)
// and the credits meter in the header.

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const $ = (sel, root = document) => root.querySelector(sel);

const nf = new Intl.NumberFormat('en-US');
// Credits: whole above 100, one decimal above 10, two below; a dash when there is no figure.
export const fmtCredits = (n) => (n == null ? '–' : n > 0 && n < 0.01 ? '<0.01'
  : Number.isInteger(n) || n >= 100 ? nf.format(Math.round(n)) : n < 10 ? n.toFixed(2) : n.toFixed(1));
export const fmtInt = (n) => nf.format(Math.round(n ?? 0));
export const fmtTokens = (n) => (n == null ? '–' : n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : nf.format(n));
export const fmtMs = (ms) => (ms == null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export const store = {
  get: (k) => { try { return localStorage.getItem(`pilotkit.${k}`); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(`pilotkit.${k}`, v); } catch { /* private window */ } },
};

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Pilotkit': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

export async function loadShell() {
  const state = await api('/api/state');
  const { brand } = state;
  if (brand.accent) document.documentElement.style.setProperty('--accent', brand.accent);
  document.title = `${document.body.dataset.page ? `${document.body.dataset.page} · ` : ''}${brand.product}`;
  const product = $('#product');
  if (product) product.textContent = brand.product;
  $('#logo')?.setAttribute('alt', brand.name);
  return state;
}

// The header meter: the account's credits this month against its allowance, as /api/month reads them
// (GitHub's figure when Copilot reports one, else what this desk spent). It links to the Credits page.
export async function showMeter() {
  const el = $('#meter');
  if (!el) return;
  try {
    const r = await api('/api/month');
    const pct = r.budget ? Math.min(100, (r.used / r.budget) * 100) : 0;
    const over = r.budget && r.paceNow != null && r.used > r.paceNow + Math.max(1, r.budget * 0.01);
    const label = r.budget
      ? `${fmtCredits(r.used)} of ${fmtInt(r.budget)} credits used this month, all Copilot clients together. The plan for now is ${fmtCredits(r.paceNow)}.`
      : `${fmtCredits(r.used)} credits spent on this desk this month. Copilot reports no monthly allowance to plan against.`;
    el.innerHTML = `
      <a class="meter-link" href="/credits" title="${esc(label)} Open Credits for the pace, the daily plan and your habits.">
        <div class="meter-num">${fmtCredits(r.used)}<small>${r.budget ? `of ${fmtInt(r.budget)} credits this month` : 'credits this month'}</small></div>
        ${r.budget ? `<div class="meter-track"><div class="meter-fill${over ? ' over' : ''}" style="width:${pct}%"></div></div>` : ''}
      </a>`;
  } catch {
    el.innerHTML = '';
  }
}
