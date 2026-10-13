import { z } from 'zod';
import { adfToText, clip, storageToText } from './text.mjs';

// Every tool is read-only and answers in compact text: a Markdown table or a few labelled lines,
// with a link per ticket or page. Long bodies are cut, and the model can ask for more.

const day = (iso) => (iso ? String(iso).slice(0, 10) : '');
const cell = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
const name = (u) => u?.displayName ?? 'unassigned';
const ISSUE_FIELDS = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'updated'];

function issueTable(api, issues) {
  if (!issues.length) return 'No issues.';
  const rows = issues.map((i) => {
    const f = i.fields ?? {};
    return `| [${i.key}](${api.site}/browse/${i.key}) | ${cell(f.issuetype?.name)} | ${cell(f.status?.name)} | ${cell(f.priority?.name)} | ${cell(name(f.assignee))} | ${day(f.updated)} | ${cell(f.summary)} |`;
  });
  return ['| Key | Type | Status | Priority | Assignee | Updated | Summary |', '|---|---|---|---|---|---|---|', ...rows].join('\n');
}

async function search(api, jql, max, nextPageToken) {
  const res = await api.searchIssues({ jql, fields: ISSUE_FIELDS, maxResults: max, nextPageToken });
  const issues = res.issues ?? [];
  const more = res.nextPageToken ? `\n\nMore results: call again with nextPageToken "${res.nextPageToken}".` : '';
  return `${issues.length} issue(s) for: ${jql}\n\n${issueTable(api, issues)}${more}`;
}

// Fields whose id differs per Jira site; they are found by their display name.
function namedField(issue, ...labels) {
  const names = issue.names ?? {};
  for (const [id, label] of Object.entries(names)) {
    if (labels.some((l) => l.toLowerCase() === String(label).toLowerCase()) && issue.fields?.[id] != null) return issue.fields[id];
  }
  return null;
}

function sprintText(value) {
  if (!Array.isArray(value) || !value.length) return null;
  return value.map((s) => (typeof s === 'string' ? (s.match(/name=([^,]+)/)?.[1] ?? s) : `${s.name} (${s.state})`)).join(', ');
}

export function pageIdFrom(input) {
  const s = String(input).trim();
  return s.match(/\/pages\/(?:edit-v2\/)?(\d+)/)?.[1] ?? s.match(/[?&]pageId=(\d+)/)?.[1] ?? (/^\d+$/.test(s) ? s : null);
}

const quote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

// "-7d", "-24h", "-2w", "-30m", or a date ("2026-10-01", "2026-10-01 14:00", local time) as a Date.
export function sinceDate(since, now = new Date()) {
  const s = String(since).trim();
  const rel = s.match(/^-(\d+)\s*([mhdw])$/i);
  if (rel) return new Date(now.getTime() - Number(rel[1]) * { m: 6e4, h: 3.6e6, d: 8.64e7, w: 6.048e8 }[rel[2].toLowerCase()]);
  const abs = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/);
  if (!abs) return null;
  const d = new Date(`${abs[1]}T${abs[2] ?? '00:00'}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Long text fields change as a whole: say so instead of quoting both versions.
const TEXT_FIELDS = new Set(['description', 'environment']);
const value = (s) => {
  const v = cell(s);
  return !v ? '(none)' : v.length > 80 ? `${v.slice(0, 80)}…` : v;
};
const when = (iso) => String(iso ?? '').replace('T', ' ').slice(0, 16);
const UNITS = { m: 'minute', h: 'hour', d: 'day', w: 'week' };
// "in the last 7 days", "since 2026-10-01": the window as the user gave it.
const windowText = (since) => {
  const rel = String(since).trim().match(/^-(\d+)\s*([mhdw])$/i);
  if (!rel) return ` since ${String(since).trim()}`;
  const n = Number(rel[1]);
  return ` in the last ${n === 1 ? '' : `${n} `}${UNITS[rel[2].toLowerCase()]}${n === 1 ? '' : 's'}`;
};

// One line per change, newest first: "- 2026-10-12 15:02 Ana Lima: Status: To Do → In Progress".
export function historyLines(histories, { since, fields, max }) {
  const only = fields?.length ? new Set(fields.map((f) => f.toLowerCase())) : null;
  const lines = [];
  const people = new Map();
  for (const h of histories ?? []) {
    if (since && new Date(h.created) < since) continue;
    const items = (h.items ?? []).filter((it) => !only || only.has(String(it.field).toLowerCase()) || only.has(String(it.fieldId ?? '').toLowerCase()));
    if (!items.length) continue;
    const who = h.author?.displayName ?? 'Jira';
    people.set(who, (people.get(who) ?? 0) + 1);
    const what = items.map((it) => (TEXT_FIELDS.has(String(it.field).toLowerCase())
      ? `${it.field} edited` : `${it.field}: ${value(it.fromString)} → ${value(it.toString)}`)).join('; ');
    lines.push(`- ${when(h.created)} ${who}: ${what}`);
  }
  return { shown: lines.slice(0, max), total: lines.length, people };
}

export const TOOLS = [
  {
    name: 'whoami',
    title: 'Who am I in Atlassian',
    description: 'Show which Atlassian site and account the tools use. Call it first when the user asks about access or setup.',
    input: {},
    run: async (api) => {
      const me = await api.myself();
      return `Site: ${api.site}\nSigned in as: ${me.displayName} (${me.emailAddress ?? 'email hidden'})\nTime zone: ${me.timeZone ?? 'unknown'}\nAccount id: ${me.accountId}`;
    },
  },
  {
    name: 'jira_my_issues',
    title: 'My Jira issues',
    description: 'Jira issues assigned to the signed-in user, most recently updated first. Open ones by default.',
    input: {
      include_done: z.boolean().optional().describe('Also list issues in a Done status. Default false.'),
      max: z.number().int().min(1).max(50).optional().describe('How many issues, 1-50. Default 20.'),
    },
    run: (api, { include_done = false, max = 20 }) => search(api,
      `assignee = currentUser()${include_done ? '' : ' AND statusCategory != Done'} ORDER BY updated DESC`, max),
  },
  {
    name: 'jira_search',
    title: 'Search Jira with JQL',
    description: 'Search Jira issues with a JQL query, for example: project = ABC AND status = "In Progress" ORDER BY priority DESC. '
      + 'Returns key, type, status, priority, assignee, last update and summary.',
    input: {
      jql: z.string().min(1).describe('The JQL query.'),
      max: z.number().int().min(1).max(50).optional().describe('How many issues, 1-50. Default 20.'),
      nextPageToken: z.string().optional().describe('From a previous call, to get the next page.'),
    },
    run: (api, { jql, max = 20, nextPageToken }) => search(api, jql, max, nextPageToken),
  },
  {
    name: 'jira_get_issue',
    title: 'Read a Jira issue',
    description: 'Read one Jira issue: status, people, sprint, description, the latest comments, links and sub-tasks.',
    input: {
      key: z.string().regex(ISSUE_KEY).describe('Issue key, for example ABC-123.'),
      comments: z.number().int().min(0).max(20).optional().describe('How many of the latest comments, 0-20. Default 5.'),
      max_chars: z.number().int().min(500).max(30000).optional().describe('Cut the description at this length. Default 6000.'),
    },
    run: async (api, { key, comments = 5, max_chars = 6000 }) => {
      const i = await api.issue(key.toUpperCase());
      const f = i.fields ?? {};
      const points = namedField(i, 'Story Points', 'Story point estimate');
      const sprint = sprintText(namedField(i, 'Sprint'));
      const lines = [
        `# [${i.key}](${api.site}/browse/${i.key}) ${f.summary ?? ''}`,
        `Type: ${f.issuetype?.name ?? '?'} · Status: ${f.status?.name ?? '?'} · Priority: ${f.priority?.name ?? '—'}`,
        `Assignee: ${name(f.assignee)} · Reporter: ${name(f.reporter)}`,
        `Created: ${day(f.created)} · Updated: ${day(f.updated)}${f.duedate ? ` · Due: ${f.duedate}` : ''}`,
        sprint && `Sprint: ${sprint}`,
        points != null && `Story points: ${points}`,
        f.parent && `Parent: ${f.parent.key} ${f.parent.fields?.summary ?? ''}`,
        f.labels?.length && `Labels: ${f.labels.join(', ')}`,
        f.components?.length && `Components: ${f.components.map((c) => c.name).join(', ')}`,
        f.fixVersions?.length && `Fix versions: ${f.fixVersions.map((v) => v.name).join(', ')}`,
      ].filter(Boolean);
      const out = [lines.join('\n'), `## Description\n${clip(adfToText(f.description) || '(empty)', max_chars)}`];
      const links = (f.issuelinks ?? []).map((l) => {
        const other = l.outwardIssue ?? l.inwardIssue;
        const verb = l.outwardIssue ? l.type?.outward : l.type?.inward;
        return other && `- ${verb} ${other.key} (${other.fields?.status?.name ?? '?'}) ${other.fields?.summary ?? ''}`;
      }).filter(Boolean);
      if (links.length) out.push(`## Links\n${links.join('\n')}`);
      const subtasks = (f.subtasks ?? []).map((s) => `- ${s.key} (${s.fields?.status?.name ?? '?'}) ${s.fields?.summary ?? ''}`);
      if (subtasks.length) out.push(`## Sub-tasks\n${subtasks.join('\n')}`);
      const all = f.comment?.comments ?? [];
      if (comments > 0 && all.length) {
        const shown = all.slice(-comments).map((c) => `- ${name(c.author)}, ${day(c.created)}: ${clip(adfToText(c.body), 1500).replace(/\n/g, '\n  ')}`);
        out.push(`## Comments (latest ${shown.length} of ${all.length})\n${shown.join('\n')}`);
      }
      return out.join('\n\n');
    },
  },
  {
    name: 'jira_issue_history',
    title: 'Jira change history',
    description: 'Who changed what in Jira, and when: status, assignee, priority, sprint and other field changes, newest first. '
      + 'Give "key" for one issue, or "jql" for several, for example: project = ABC AND updated >= -7d. Jira keeps the latest 100 changes per issue here.',
    input: {
      key: z.string().regex(ISSUE_KEY).optional().describe('One issue key, for example ABC-123.'),
      jql: z.string().min(1).optional().describe('Several issues: a JQL query with a restriction, for example project = ABC AND updated >= -7d.'),
      since: z.string().max(20).optional().describe('Only changes after this: -7d, -24h, -2w, or a date such as 2026-10-01. Default: every change for one issue, -7d for a JQL query.'),
      fields: z.array(z.string().min(1).max(60)).max(10).optional().describe('Only changes to these fields, for example ["status", "assignee"].'),
      max: z.number().int().min(1).max(25).optional().describe('Issues for a JQL query, 1-25. Default 10.'),
      per_issue: z.number().int().min(1).max(50).optional().describe('Changes shown per issue, 1-50. Default 10.'),
    },
    run: async (api, { key, jql, since, fields, max = 10, per_issue = 10 }) => {
      if (!key === !jql) return 'Give either "key" (one issue) or "jql" (several issues).';
      const from = since ?? (jql ? '-7d' : null);
      const after = from ? sinceDate(from) : null;
      if (from && !after) return `"${from}" is not a time: use -7d, -24h, -2w, or a date such as 2026-10-01.`;
      const window = after ? windowText(from) : '';
      const head = (i) => `[${i.key}](${api.site}/browse/${i.key}) ${cell(i.fields?.summary)}`;

      if (key) {
        const i = await api.issueChanges(key.toUpperCase());
        const { shown, total } = historyLines(i.changelog?.histories, { since: after, fields, max: per_issue });
        if (!total) return `${head(i)}\nNo change${fields?.length ? ` to ${fields.join(', ')}` : ''}${window}.`;
        const older = total > shown.length ? `\n(${total - shown.length} older change(s) not shown: raise per_issue.)` : '';
        return `${head(i)}\n${total} change(s)${window}, newest first:\n${shown.join('\n')}${older}`;
      }

      const res = await api.searchIssues({ jql, fields: ['summary'], maxResults: max, expand: 'changelog' });
      const issues = res.issues ?? [];
      const people = new Map();
      const blocks = [];
      const quiet = [];
      for (const i of issues) {
        const h = historyLines(i.changelog?.histories, { since: after, fields, max: per_issue });
        for (const [who, n] of h.people) people.set(who, (people.get(who) ?? 0) + n);
        if (!h.total) quiet.push(i.key);
        else blocks.push(`${head(i)} (${h.total} change(s))\n${h.shown.join('\n')}${h.total > h.shown.length ? `\n- … ${h.total - h.shown.length} more` : ''}`);
      }
      const byPerson = [...people].sort((a, b) => b[1] - a[1]).map(([who, n]) => `${who} ${n}`).join(', ');
      return [
        `${blocks.length} of ${issues.length} issue(s) changed${window}, for: ${jql}`,
        byPerson && `Changes by person: ${byPerson}`,
        ...blocks,
        quiet.length && `No change${window}: ${quiet.join(', ')}`,
        res.nextPageToken && 'More issues match: narrow the JQL or raise max.',
      ].filter(Boolean).join('\n\n');
    },
  },
  {
    name: 'jira_list_projects',
    title: 'List Jira projects',
    description: 'Jira projects the user can see, with their keys. Use it to find the project key for a JQL query.',
    input: { query: z.string().optional().describe('Part of a project name or key.') },
    run: async (api, { query }) => {
      const res = await api.projects({ query });
      const rows = (res.values ?? []).map((p) => `| ${p.key} | ${cell(p.name)} | ${cell(p.projectTypeKey)} |`);
      return rows.length ? ['| Key | Name | Type |', '|---|---|---|', ...rows].join('\n') : 'No projects.';
    },
  },
  {
    name: 'confluence_search',
    title: 'Search Confluence',
    description: 'Search Confluence pages and blog posts by words, or with a CQL query. Returns title, space, last update, link and an excerpt.',
    input: {
      query: z.string().optional().describe('Words to look for.'),
      cql: z.string().optional().describe('A full CQL query instead of words, for example: space = DEV AND title ~ "release".'),
      space: z.string().optional().describe('Only this space key.'),
      max: z.number().int().min(1).max(25).optional().describe('How many results, 1-25. Default 10.'),
    },
    run: async (api, { query, cql, space, max = 10 }) => {
      if (!query && !cql) return 'Give words in "query" or a CQL query in "cql".';
      const q = cql ?? [`type in (page, blogpost)`, `text ~ ${quote(query)}`, space && `space = ${quote(space)}`].filter(Boolean).join(' AND ');
      const res = await api.confluenceSearch({ cql: q, limit: max });
      const rows = (res.results ?? []).map((r) => {
        const c = r.content ?? {};
        const link = r.url ? `${api.site}/wiki${r.url}` : '';
        const excerpt = cell(r.excerpt?.replace(/@@@(end)?hl@@@/g, '')).slice(0, 200);
        return `- [${cell(c.title ?? r.title)}](${link}) · id ${c.id ?? '?'} · ${cell(r.resultGlobalContainer?.title ?? '')} · ${day(r.lastModified)}\n  ${excerpt}`;
      });
      return rows.length ? `${rows.length} result(s) for: ${q}\n\n${rows.join('\n')}` : `No results for: ${q}`;
    },
  },
  {
    name: 'confluence_get_page',
    title: 'Read a Confluence page',
    description: 'Read a Confluence page as text, by page id or by its link.',
    input: {
      page: z.string().min(1).describe('Page id (digits) or the page link.'),
      max_chars: z.number().int().min(500).max(60000).optional().describe('Cut the page at this length. Default 8000.'),
    },
    run: async (api, { page, max_chars = 8000 }) => {
      const id = pageIdFrom(page);
      if (!id) return `"${page}" is not a page id or a Confluence page link.`;
      const p = await api.page(id);
      let space = '';
      try {
        space = p.spaceId ? (await api.space(p.spaceId)).name : '';
      } catch {
        // the page is enough without its space name
      }
      const link = p._links?.webui ? `${api.site}/wiki${p._links.webui}` : '';
      const head = `# [${p.title}](${link})\nSpace: ${space || '?'} · Version ${p.version?.number ?? '?'} · Updated ${day(p.version?.createdAt)}`;
      return `${head}\n\n${clip(storageToText(p.body?.storage?.value) || '(empty page)', max_chars)}`;
    },
  },
];
