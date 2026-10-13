import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_NAME, RECORD_ID, checkSoql, checkSosl, withLimit } from './soql.mjs';
import { SfError, listOrgs, runSf } from './sf.mjs';

// The reads the tools need, each one sf command on one org of the allowlist set up by
// "pilotkit add salesforce". Any other org is refused before sf runs.

export const orgLabel = (o) => o.alias ?? o.username;

// What logs an org in again when sf lost or expired its login.
export const loginCommand = (o) => `sf org login web${o.alias ? ` --alias ${o.alias}` : ''}${o.kind !== 'org' && o.instanceUrl ? ` --instance-url ${o.instanceUrl}` : ''}`;

export function createSalesforce({ sf, orgs, defaultOrg, run = runSf }) {
  if (!sf || !orgs?.length) throw new Error('Salesforce is not set up: run "pilotkit add salesforce".');

  const pick = (name) => {
    if (!name) return orgs.find((o) => o.username === defaultOrg) ?? orgs[0];
    const n = String(name).trim().toLowerCase();
    const org = orgs.find((o) => o.alias?.toLowerCase() === n || o.username.toLowerCase() === n);
    if (!org) throw new SfError(`"${name}" is not an org pilotkit may read. It reads: ${orgs.map(orgLabel).join(', ')}.`, 'OrgNotAllowed');
    return org;
  };
  const check = (re, value, what) => {
    if (!re.test(String(value ?? ''))) throw new SfError(`"${value}" is not ${what}`);
    return value;
  };
  // A query goes to sf in a file of its own, deleted right after.
  const withFile = async (text, fn) => {
    const dir = mkdtempSync(join(tmpdir(), 'pilotkit-sf-'));
    const file = join(dir, 'query.txt');
    writeFileSync(file, text, { mode: 0o600 });
    try {
      return await fn(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const on = (org, tooling) => ['--target-org', org.username, ...(tooling ? ['--use-tooling-api'] : []), '--json'];

  return {
    orgs,
    pick,
    defaultOrg: pick(),
    known: () => listOrgs(sf, run),
    query: async (org, soql, { tooling = false, max = 50 } = {}) => withFile(withLimit(checkSoql(soql), max),
      // sf fetches up to 50,000 records unless told otherwise.
      (file) => run(sf, ['data', 'query', '--file', file, ...on(org, tooling)], { env: { SF_ORG_MAX_QUERY_LIMIT: String(max) } })),
    search: async (org, sosl) => withFile(checkSosl(sosl), (file) => run(sf, ['data', 'search', '--file', file, ...on(org)])),
    describe: async (org, object, { tooling = false } = {}) => run(sf, ['sobject', 'describe', '--sobject', check(API_NAME, object, 'an object API name'), ...on(org, tooling)]),
    listObjects: async (org, kind = 'all') => run(sf, ['sobject', 'list', '--sobject', check(/^(all|custom|standard)$/, kind, 'all, custom or standard'), ...on(org)]),
    getRecord: async (org, object, id, { tooling = false } = {}) => run(sf, ['data', 'get', 'record', '--sobject', check(API_NAME, object, 'an object API name'),
      '--record-id', check(RECORD_ID, id, 'a record id (15 or 18 letters and digits)'), ...on(org, tooling)]),
  };
}
