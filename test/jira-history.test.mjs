import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOOLS, historyLines, sinceDate } from '../src/atlassian/tools.mjs';

const history = TOOLS.find((t) => t.name === 'jira_issue_history');
const now = new Date('2026-10-13T12:00:00Z');
const change = (created, who, ...items) => ({ created, author: who && { displayName: who }, items: items.map(([field, from, to]) => ({ field, fromString: from, toString: to })) });
// Newest first, as Jira returns them.
const histories = [
  change('2026-10-12T15:02:00.000+0200', 'Ana Lima', ['status', 'To Do', 'In Progress'], ['assignee', null, 'Ana Lima']),
  change('2026-10-11T09:40:00.000+0200', 'Demo User', ['description', 'old text', 'x'.repeat(500)]),
  change('2026-10-10T08:00:00.000+0200', null, ['priority', 'Medium', 'High']),
  change('2026-09-01T10:00:00.000+0200', 'Ana Lima', ['status', 'Backlog', 'To Do']),
];

test('sinceDate reads relative times and dates, and nothing else', () => {
  assert.equal(sinceDate('-7d', now).toISOString(), '2026-10-06T12:00:00.000Z');
  assert.equal(sinceDate('-24h', now).toISOString(), '2026-10-12T12:00:00.000Z');
  assert.equal(sinceDate('-2w', now).toISOString(), '2026-09-29T12:00:00.000Z');
  assert.equal(sinceDate('- 30m', now), null);
  assert.ok(sinceDate('2026-10-01') instanceof Date);
  assert.ok(sinceDate('2026-10-01 14:00') instanceof Date);
  for (const bad of ['last week', '2026-13-45', '7d', 'startOfWeek()']) assert.equal(sinceDate(bad, now), null, bad);
});

test('historyLines: one line per change, newest first, filtered by time and field', () => {
  const all = historyLines(histories, { max: 10 });
  assert.equal(all.total, 4);
  assert.equal(all.shown[0], '- 2026-10-12 15:02 Ana Lima: status: To Do → In Progress; assignee: (none) → Ana Lima');
  assert.equal(all.shown[1], '- 2026-10-11 09:40 Demo User: description edited');
  assert.equal(all.shown[2], '- 2026-10-10 08:00 Jira: priority: Medium → High');
  assert.deepEqual([...all.people], [['Ana Lima', 2], ['Demo User', 1], ['Jira', 1]]);
  assert.equal(historyLines(histories, { since: new Date('2026-10-01T00:00:00Z'), max: 10 }).total, 3);
  const status = historyLines(histories, { fields: ['Status'], max: 1 });
  assert.equal(status.total, 2);
  assert.deepEqual(status.shown, ['- 2026-10-12 15:02 Ana Lima: status: To Do → In Progress']);
});

test('jira_issue_history: one issue, or a JQL query with a count per person', async () => {
  const calls = [];
  const api = {
    site: 'https://acme.atlassian.net',
    issueChanges: async (key) => { calls.push(['issue', key]); return { key, fields: { summary: 'Renewal quote' }, changelog: { histories } }; },
    searchIssues: async (q) => {
      calls.push(['search', q]);
      return {
        issues: [
          { key: 'HS-12', fields: { summary: 'Renewal quote' }, changelog: { histories } },
          { key: 'HS-18', fields: { summary: 'Quiet one' }, changelog: { histories: [histories[3]] } },
        ],
        nextPageToken: 'abc',
      };
    },
  };
  const one = await history.run(api, { key: 'hs-12', since: '2026-10-11' });
  assert.deepEqual(calls[0], ['issue', 'HS-12']);
  assert.match(one, /^\[HS-12\]\(https:\/\/acme\.atlassian\.net\/browse\/HS-12\) Renewal quote\n2 change\(s\) since 2026-10-11, newest first:/);
  assert.doesNotMatch(one, /priority/);

  const many = await history.run(api, { jql: 'project = HS AND updated >= -7d', fields: ['status', 'priority'] });
  assert.deepEqual(calls[1][1], { jql: 'project = HS AND updated >= -7d', fields: ['summary'], maxResults: 10, expand: 'changelog' });
  // The default window for a query is the last 7 days, from the real clock: the September change is out.
  assert.match(many, /^\d of 2 issue\(s\) changed in the last 7 days, for: project = HS AND updated >= -7d/);
  assert.match(many, /More issues match/);

  assert.match(await history.run(api, {}), /either "key"/);
  assert.match(await history.run(api, { key: 'HS-1', jql: 'x' }), /either "key"/);
  assert.match(await history.run(api, { key: 'HS-1', since: 'last week' }), /is not a time/);
});
