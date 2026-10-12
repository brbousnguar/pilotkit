// What every page of the desk shares: the API helper, the brand (name, logo, accent) and the header.

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const $ = (sel, root = document) => root.querySelector(sel);

const nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const fmtCredits = (n) => (n > 0 && n < 0.01 ? '<0.01' : nf2.format(n ?? 0));
export const fmtInt = (n) => nf0.format(n ?? 0);
export const fmtMs = (ms) => (ms == null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

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

// The Copilot allowance snapshot; GitHub can take a while to count recent use.
export function quotaText(q) {
  if (!q) return null;
  if (q.isUnlimitedEntitlement) return { short: 'Unlimited allowance', long: 'Your Copilot plan has no monthly limit.' };
  if (!q.entitlementRequests) return null;
  const short = `${fmtInt(q.usedRequests ?? 0)} / ${fmtInt(q.entitlementRequests)} used`;
  const over = q.overage ? `, ${fmtInt(q.overage)} over` : '';
  return { short, long: `Copilot monthly allowance: ${short}${over}, across every Copilot client. GitHub's count can lag a little.` };
}

export async function loadShell() {
  const state = await api('/api/state');
  const { brand } = state;
  if (brand.accent) document.documentElement.style.setProperty('--accent', brand.accent);
  document.title = `${document.body.dataset.page ? `${document.body.dataset.page} · ` : ''}${brand.product}`;
  const product = $('#product');
  if (product) product.textContent = brand.product;
  $('#logo')?.setAttribute('alt', brand.name);
  const login = $('#login');
  if (login) {
    login.textContent = state.copilot.authenticated ? state.copilot.login ?? 'signed in' : 'Copilot not signed in';
    login.classList.toggle('pill', !state.copilot.authenticated);
    login.classList.toggle('bad', !state.copilot.authenticated);
    login.title = state.atlassian.site ? `Atlassian: ${state.atlassian.site} as ${state.atlassian.email}` : 'Atlassian is not set up';
  }
  return state;
}

export async function showQuota() {
  const el = $('#quota');
  if (!el) return;
  try {
    const { quota } = await api('/api/credits?days=1');
    const t = quotaText(quota);
    el.hidden = !t;
    if (t) {
      el.textContent = t.short;
      el.title = t.long;
    }
  } catch {
    el.hidden = true;
  }
}
