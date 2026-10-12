import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../src/desk/db.mjs';
import { monthReport, quotaUsed, saveSnapshot } from '../src/desk/month.mjs';

function deskWith(calls) {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO chats (id, title, model, status, started_at, turns, credits, max_credits) VALUES ('c1', 'A chat', 'm', 'ready', ?, 1, ?, 60)`)
    .run(calls[0]?.at ?? '2026-10-01T09:00:00.000Z', calls.reduce((s, c) => s + c.credits, 0));
  calls.forEach((c, i) => db.prepare(`INSERT INTO calls (chat_id, seq, turn, at, model, prompt_tokens, cache_read, credits) VALUES ('c1', ?, ?, ?, 'claude-x', 1000, ?, ?)`)
    .run(i + 1, c.turn ?? 1, c.at, c.read ?? 900, c.credits));
  return db;
}

test('quotaUsed: the used figure, or null without a monthly limit', () => {
  assert.equal(quotaUsed({ entitlementRequests: 7000, usedRequests: 98 }), 98);
  assert.equal(quotaUsed({ entitlementRequests: 1000, remainingPercentage: 75 }), 250);
  assert.equal(quotaUsed({ isUnlimitedEntitlement: true, entitlementRequests: 0 }), null);
  assert.equal(quotaUsed(null), null);
});

test('without a snapshot, the month only has the desk and no plan', () => {
  const db = deskWith([{ at: '2026-10-02T10:00:00.000Z', credits: 1.5 }, { at: '2026-10-12T08:00:00.000Z', credits: 0.5 }]);
  const r = monthReport(db, { now: new Date('2026-10-12T12:00:00.000Z') });
  assert.equal(r.month.days, 31);
  assert.equal(r.month.today, 12);
  assert.equal(r.budget, null);
  assert.equal(r.plan, null);
  assert.equal(r.used, 2);
  assert.equal(r.perDay[1].desk, 1.5);
  assert.equal(r.perDay[1].other, null);
  assert.equal(r.perDay[12].future, true);
  assert.equal(r.habits.chats.n, 1);
});

test('snapshots split each day into the desk and other Copilot use', () => {
  const db = deskWith([
    { at: '2026-10-10T09:00:00.000Z', credits: 2 },
    { at: '2026-10-11T09:00:00.000Z', credits: 3 },
    { at: '2026-10-12T09:00:00.000Z', credits: 1 },
  ]);
  const q = (used) => ({ entitlementRequests: 3100, usedRequests: used });
  saveSnapshot(db, q(50), new Date('2026-10-10T20:00:00.000Z')); // first reading: 48 earlier use + 2 desk
  saveSnapshot(db, q(60), new Date('2026-10-11T20:00:00.000Z')); // +10: 3 desk, 7 other
  saveSnapshot(db, q(61), new Date('2026-10-12T10:00:00.000Z')); // +1: 1 desk, 0 other
  const r = monthReport(db, { now: new Date('2026-10-12T12:00:00.000Z') });
  assert.equal(r.budget, 3100);
  assert.equal(r.used, 61);
  assert.equal(r.firstTracked, 10);
  assert.equal(r.perDay[9].other, 48);
  assert.equal(r.perDay[10].other, 7);
  assert.equal(r.perDay[11].other, 0);
  assert.equal(r.todayUse, 1);
  assert.equal(r.plan, 100);
  assert.ok(Math.abs(r.paceNow - 3100 * (11.5 / 31)) < 1e-9);
  assert.equal(r.leftPerDay, (3100 - 61) / 20);
});

test('a follow-up after the prompt cache expired is counted as cold', () => {
  const db = deskWith([
    { at: '2026-10-12T09:00:00.000Z', credits: 1, turn: 1 },
    { at: '2026-10-12T09:20:00.000Z', credits: 2, turn: 2, read: 100 },
  ]);
  const r = monthReport(db, { now: new Date('2026-10-12T12:00:00.000Z') });
  assert.deepEqual(r.habits.cold, { count: 1, credits: 2 });
});
