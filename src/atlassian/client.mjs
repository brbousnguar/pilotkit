import { VERSION } from '../config.mjs';

// A thin, read-only client for Jira Cloud and Confluence Cloud with basic auth (email + API token).
// It only issues GET requests: pilotkit never changes anything in Atlassian.

export class AtlassianError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const HINTS = {
  401: 'Atlassian rejected the email or API token: it expired or was revoked. Run "pilotkit add atlassian --new-token" in a terminal.',
  403: 'Your Atlassian account cannot see this. Ask the project admin for access.',
  404: 'Not found, or your account cannot see it.',
  410: 'Atlassian retired this API: update pilotkit.',
};

export function createAtlassian({ site, email, token, fetchImpl = fetch }) {
  if (!site || !email || !token) throw new Error('Atlassian is not set up: run "pilotkit setup".');
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

  async function get(path, query = {}) {
    const url = new URL(path, site);
    for (const [k, v] of Object.entries(query)) {
      if (v == null || v === '') continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, String(v));
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, {
        headers: { Authorization: auth, Accept: 'application/json', 'User-Agent': `pilotkit/${VERSION}` },
      });
      // Atlassian throttles per user: wait as told, twice at most, then give up with the reason.
      if (res.status === 429 && attempt < 2) {
        const wait = Math.min(Number(res.headers.get('retry-after')) || 2 ** (attempt + 1), 20);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (!res.ok) {
        let detail = '';
        try {
          const body = await res.json();
          detail = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {}), body.message].filter(Boolean).join('; ');
        } catch {
          // not JSON
        }
        throw new AtlassianError(res.status, [`${res.status} on ${url.pathname}`, detail, HINTS[res.status]].filter(Boolean).join(' — '));
      }
      return res.json();
    }
  }

  return {
    site,
    get,
    myself: () => get('/rest/api/3/myself'),
    // The enhanced JQL search (the old /search endpoint is retired on Jira Cloud).
    searchIssues: ({ jql, fields, maxResults = 20, nextPageToken, expand }) => get('/rest/api/3/search/jql', {
      jql, fields: fields.join(','), maxResults, nextPageToken, expand,
    }),
    issue: (key) => get(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: '*all', expand: 'names' }),
    // The summary and the latest changes (Jira returns up to 100, newest first).
    issueChanges: (key) => get(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: 'summary', expand: 'changelog' }),
    projects: ({ query, maxResults = 50 }) => get('/rest/api/3/project/search', { query, maxResults, orderBy: 'name' }),
    confluenceSearch: ({ cql, limit = 10 }) => get('/wiki/rest/api/search', { cql, limit, excerpt: 'highlight' }),
    page: (id) => get(`/wiki/api/v2/pages/${encodeURIComponent(id)}`, { 'body-format': 'storage' }),
    space: (id) => get(`/wiki/api/v2/spaces/${encodeURIComponent(id)}`),
  };
}
