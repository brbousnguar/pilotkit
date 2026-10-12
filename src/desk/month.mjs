// The Credits page's month: the Copilot allowance against an even plan, day by day, and the habits of
// this desk. GitHub only gives the account's running total (account.getQuota), so the desk saves it
// every 10 minutes in quota_snapshots; the days before the first snapshot only have this desk's calls.
// The month is the billing month: it starts on the 1st at 00:00 UTC, when the allowance resets.
const DAY = 86_400_000;
const CACHE_MS = 5 * 60 * 1000;

/** The used figure of a quota snapshot, or null when there is no monthly limit to plan against. */
export function quotaUsed(q) {
  if (!q || q.isUnlimitedEntitlement || !q.entitlementRequests) return null;
  return Number.isFinite(q.usedRequests) ? q.usedRequests : ((100 - (q.remainingPercentage ?? 100)) / 100) * q.entitlementRequests;
}

export function saveSnapshot(db, q, at = new Date()) {
  const used = quotaUsed(q);
  if (used == null) return false;
  db.prepare('INSERT OR REPLACE INTO quota_snapshots (at, used, entitlement) VALUES (?, ?, ?)').run(at.toISOString(), used, q.entitlementRequests);
  return true;
}

export function startSnapshots(db, readQuota, everyMs = 10 * 60 * 1000) {
  const take = async () => {
    try {
      saveSnapshot(db, await readQuota());
    } catch {
      // Copilot not signed in or offline: the next round tries again.
    }
  };
  take();
  const timer = setInterval(take, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

export function monthReport(db, { now = new Date(), models = [] } = {}) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const days = Math.round((end - start) / DAY);
  const elapsed = (now - start) / DAY; // days since the reset, with the fraction of today
  const today = Math.min(days, Math.floor(elapsed) + 1);
  const iso = start.toISOString();

  // This desk, per day, from every recorded model call.
  const desk = new Array(days).fill(0);
  for (const r of db.prepare('SELECT substr(at, 1, 10) day, SUM(credits) c FROM calls WHERE at >= ? AND at < ? GROUP BY day').all(iso, end.toISOString())) {
    const i = Math.round((Date.parse(`${r.day}T00:00:00Z`) - start) / DAY);
    if (i >= 0 && i < days) desk[i] = r.c;
  }
  const deskUsed = desk.reduce((a, b) => a + b, 0);

  // The account, from the snapshots: its total at the end of each tracked day.
  const snaps = db.prepare('SELECT at, used, entitlement FROM quota_snapshots WHERE at >= ? AND at < ? ORDER BY at').all(iso, end.toISOString());
  const last = snaps.at(-1) ?? null;
  const accountEnd = new Array(days).fill(null);
  for (const s of snaps) accountEnd[Math.floor((Date.parse(s.at) - start) / DAY)] = s.used;

  // Other Copilot use (VS Code, the CLI, the app) per day = what the account grew by, minus this desk.
  // The first tracked day also carries the month's earlier use, which no snapshot can split by day.
  const other = new Array(days).fill(null);
  let prev = null;
  let deskSoFar = 0;
  let firstTracked = null;
  for (let i = 0; i < today; i++) {
    deskSoFar += desk[i];
    if (accountEnd[i] == null) continue;
    if (prev == null) {
      other[i] = Math.max(0, accountEnd[i] - deskSoFar);
      firstTracked = i + 1;
    } else {
      other[i] = Math.max(0, accountEnd[i] - accountEnd[prev] - desk[i]);
    }
    prev = i;
  }

  const budget = last?.entitlement ?? null;
  const used = last ? Math.max(last.used, 0) : deskUsed;
  const plan = budget ? budget / days : null;
  const report = {
    month: { start: iso, end: end.toISOString(), days, today, elapsed },
    budget,
    used,
    usedAt: last?.at ?? null,
    deskUsed,
    plan,
    paceNow: budget ? budget * (elapsed / days) : null,
    todayUse: desk[today - 1] + (other[today - 1] ?? 0),
    leftPerDay: budget ? Math.max(0, budget - used) / Math.max(1, days - today + 1) : null,
    projected: (used / Math.max(1, elapsed)) * days,
    firstTracked,
    perDay: Array.from({ length: days }, (_, i) => ({ day: i + 1, desk: desk[i], other: other[i], future: i + 1 > today })),
  };

  // Habits: this desk this month.
  const byModel = db.prepare(`SELECT COALESCE(model, '?') model, COUNT(*) calls, SUM(credits) credits FROM calls WHERE at >= ?
    GROUP BY model ORDER BY credits DESC`).all(iso);
  const chats = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(credits), 0) credits, COALESCE(SUM(turns), 0) turns FROM chats WHERE started_at >= ?').get(iso);
  const top = db.prepare('SELECT id, title, credits, turns FROM chats WHERE started_at >= ? ORDER BY credits DESC LIMIT 3').all(iso);
  const tokens = db.prepare('SELECT COALESCE(SUM(prompt_tokens), 0) prompt, COALESCE(SUM(cache_read), 0) read FROM calls WHERE at >= ?').get(iso);

  // A follow-up after the 5-minute prompt cache expired: the first call of a later turn, more than
  // 5 minutes after the call before it, that read less than half of its prompt from the cache.
  let coldCount = 0;
  let coldCredits = 0;
  let before = null;
  for (const c of db.prepare('SELECT chat_id, turn, seq, at, prompt_tokens, cache_read, credits FROM calls WHERE at >= ? ORDER BY chat_id, seq').all(iso)) {
    if (before && before.chat_id === c.chat_id && c.turn > before.turn && Date.parse(c.at) - Date.parse(before.at) > CACHE_MS
      && c.cache_read < c.prompt_tokens / 2) {
      coldCount++;
      coldCredits += c.credits;
    }
    before = c;
  }

  report.habits = {
    byModel,
    chats,
    top,
    tokens,
    cold: { count: coldCount, credits: coldCredits },
    prices: Object.fromEntries(models.filter((m) => m.prices).map((m) => [m.id, m.prices])),
  };
  return report;
}
