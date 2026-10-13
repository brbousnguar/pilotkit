import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const home = mkdtempSync(join(tmpdir(), 'pk-sf-home-'));
process.env.PILOTKIT_HOME = home;
const { checkSoql, checkSosl, withLimit } = await import('../src/salesforce/soql.mjs');
const { describeText, flatten, recordLines, recordsTable } = await import('../src/salesforce/text.mjs');
const { SAFE_ARG, isLoginError, listOrgs, runSf } = await import('../src/salesforce/sf.mjs');
const { createSalesforce, loginCommand } = await import('../src/salesforce/client.mjs');
const { TOOLS } = await import('../src/salesforce/tools.mjs');
const { findConnector } = await import('../src/connectors/index.mjs');
const { deskGuide } = await import('../src/desk/runner.mjs');

const tool = (name) => TOOLS.find((t) => t.name === name);
const URL_ = 'https://demo.my.salesforce.com';
const ORGS = [
  { username: 'demo@example.test', alias: 'pk-demo', instanceUrl: URL_, kind: 'org' },
  { username: 'sb@example.test', alias: 'pk-sb', instanceUrl: 'https://demo--uat.sandbox.my.salesforce.com', kind: 'sandbox' },
];

// A stand-in for the sf CLI: answers the read commands like sf --json does, and says what it got.
const fakeDir = mkdtempSync(join(tmpdir(), 'pk-fake-sf-'));
const fakeSf = join(fakeDir, 'sf');
writeFileSync(fakeSf, `#!/usr/bin/env node
const { readFileSync } = require('node:fs');
const args = process.argv.slice(2);
const flag = (f) => args[args.indexOf(f) + 1];
const out = (result) => { console.log(JSON.stringify({ status: 0, result, warnings: [] })); };
const fail = (name, message) => { console.log(JSON.stringify({ status: 1, name, message })); process.exit(1); };
const cmd = args.slice(0, args.findIndex((a) => a.startsWith('-'))).join(' ');
if (flag('--target-org') === 'expired@example.test') fail('RefreshTokenAuthError', 'Error authenticating with the refresh token due to: expired access/refresh token');
if (cmd === 'org list') out({ nonScratchOrgs: [{ username: 'demo@example.test', alias: 'pk-demo', instanceUrl: '${URL_}', isDefaultUsername: true }, { username: 'sb@example.test', isSandbox: true }], sandboxes: [{ username: 'sb@example.test', alias: 'pk-sb', isSandbox: true }], scratchOrgs: [], devHubs: [{ username: 'demo@example.test' }], other: [] });
else if (cmd === 'data query') out({ totalSize: 1, done: true, records: [{ attributes: { type: 'Organization' }, Name: 'Demo Org', Query: readFileSync(flag('--file'), 'utf8'), File: flag('--file'), Max: process.env.SF_ORG_MAX_QUERY_LIMIT, Tooling: args.includes('--use-tooling-api') }] });
else if (cmd === 'sobject describe') fail('NOT_FOUND', 'The requested resource does not exist');
else fail('Unexpected', 'unexpected ' + cmd);
`);
chmodSync(fakeSf, 0o755);
const unix = process.platform !== 'win32';

test('SOQL: SELECT only, no clause that changes records, quoted values left alone', () => {
  assert.equal(checkSoql('  SELECT Id FROM Account '), 'SELECT Id FROM Account');
  assert.throws(() => checkSoql('DELETE FROM Account'), /Only SELECT/);
  assert.throws(() => checkSoql('SELECT Id FROM Account FOR UPDATE'), /pilotkit only reads/);
  assert.throws(() => checkSoql('SELECT Id FROM Account FOR VIEW'), /pilotkit only reads/);
  assert.throws(() => checkSoql('SELECT Id FROM KnowledgeArticleVersion UPDATE VIEWSTAT'), /pilotkit only reads/);
  assert.doesNotThrow(() => checkSoql("SELECT Id FROM Account WHERE Name = 'for update \\' or for view'"));
  assert.equal(checkSosl('FIND {for update} RETURNING Account(Name)'), 'FIND {for update} RETURNING Account(Name)');
  assert.throws(() => checkSosl('SELECT Id FROM Account'), /Only SOSL/);
  assert.throws(() => checkSosl('FIND {x} RETURNING Account UPDATE TRACKING'), /pilotkit only reads/);
});

test('SOQL: a LIMIT is added only where SOQL allows it and it does not change the answer', () => {
  assert.equal(withLimit('SELECT Id FROM Account', 50), 'SELECT Id FROM Account LIMIT 50');
  assert.equal(withLimit('SELECT Id FROM Account LIMIT 5', 50), 'SELECT Id FROM Account LIMIT 5');
  assert.equal(withLimit('SELECT Id, (SELECT Id FROM Contacts LIMIT 2) FROM Account', 50), 'SELECT Id, (SELECT Id FROM Contacts LIMIT 2) FROM Account LIMIT 50');
  assert.equal(withLimit("SELECT Id FROM Account WHERE Name = 'limit 3'", 9), "SELECT Id FROM Account WHERE Name = 'limit 3' LIMIT 9");
  assert.equal(withLimit('SELECT COUNT() FROM Case', 50), 'SELECT COUNT() FROM Case');
  assert.equal(withLimit('SELECT Id FROM Account OFFSET 10', 50), 'SELECT Id FROM Account OFFSET 10');
});

test('records become one level of columns, with a link per id', () => {
  const rec = {
    attributes: { type: 'Opportunity' }, Id: '006000000000001AAA', Name: 'Big | deal', Owner: { attributes: { type: 'User' }, Name: 'Ann' },
    Contacts: { totalSize: 2, records: [{ Name: 'A' }, { Name: 'B' }] }, BillingAddress: { city: 'Lyon', country: 'FR', geocodeAccuracy: null },
  };
  assert.deepEqual(flatten(rec), { Id: '006000000000001AAA', Name: 'Big | deal', 'Owner.Name': 'Ann', Contacts: '2 record(s): A, B', BillingAddress: 'Lyon, FR' });
  const table = recordsTable([rec, { attributes: { type: 'Opportunity' }, Id: '006000000000002AAA', Name: 'Small' }], URL_);
  assert.match(table, /^\| Id \| Name \| Owner\.Name \| Contacts \| BillingAddress \|/);
  assert.match(table, /\[006000000000001AAA\]\(https:\/\/demo\.my\.salesforce\.com\/006000000000001AAA\) \| Big \\\| deal \| Ann/);
  const one = recordLines({ ...rec, Description: 'x'.repeat(2500), Empty__c: null }, URL_);
  assert.match(one, /^Opportunity \[006000000000001AAA\]/);
  assert.match(one, /Description: x{2000}… \(500 more characters\)/);
  assert.match(one, /\(1 empty field\(s\) not shown\)/);
});

test('describe keeps what a query writer needs', () => {
  const d = {
    name: 'Invoice__c', label: 'Invoice', custom: true, keyPrefix: 'a01', queryable: true,
    fields: [
      { name: 'Id', label: 'Record ID', type: 'id', nillable: false, createable: false },
      { name: 'Account__c', label: 'Account', type: 'reference', referenceTo: ['Account'], relationshipName: 'Account__r', nillable: false, createable: true },
      { name: 'Status__c', label: 'Status', type: 'picklist', picklistValues: [{ value: 'Draft', active: true }, { value: 'Old', active: false }, { value: 'Paid', active: true }] },
      { name: 'Total__c', label: 'Total', type: 'currency', calculated: true },
    ],
    childRelationships: [{ relationshipName: 'Lines__r', childSObject: 'Invoice_Line__c' }, { relationshipName: null, childSObject: 'X' }],
  };
  const text = describeText(d);
  assert.match(text, /^Invoice \(Invoice__c\), custom, key prefix a01/);
  assert.match(text, /\| Account__c \| Account \| reference \| → Account \(Account__r\); required \|/);
  assert.match(text, /\| Status__c \| Status \| picklist \| Draft, Paid \|/);
  assert.match(text, /\| Total__c \| Total \| currency \| formula \|/);
  assert.match(text, /Child relationships \(for subqueries\): Lines__r \(Invoice_Line__c\)$/);
  const filtered = describeText(d, { filter: 'stat' });
  assert.match(filtered, /1 field\(s\) matching "stat"/);
  assert.doesNotMatch(filtered, /Account__c|Child relationships/);
});

test('runSf only runs read commands, with arguments a shell cannot misread', async () => {
  await assert.rejects(runSf(fakeSf, ['data', 'delete', 'record', '--json']), /not a read command/);
  await assert.rejects(runSf(fakeSf, ['project', 'deploy', 'start']), /not a read command/);
  for (const arg of ['a&b', '%PATH%', 'x"y', 'a|b', '(x)', 'a^b', 'a\nb', 'a!b']) {
    assert.equal(SAFE_ARG.test(arg), false, arg);
    await assert.rejects(runSf(fakeSf, ['data', 'query', '--target-org', arg, '--json']), /does not pass/);
  }
  for (const arg of ['pk-demo', 'first.last+sf@example.test', 'C:\\Users\\Brâhim Ü\\AppData\\Local\\Temp\\pilotkit-sf-x\\query.txt', '/tmp/a b/query.txt']) {
    assert.equal(SAFE_ARG.test(arg), true, arg);
  }
});

test('runSf reads sf --json answers and errors', { skip: !unix }, async () => {
  const orgs = await listOrgs(fakeSf);
  assert.deepEqual(orgs, [
    { username: 'sb@example.test', alias: 'pk-sb', instanceUrl: null, kind: 'sandbox', isDefault: false },
    { username: 'demo@example.test', alias: 'pk-demo', instanceUrl: URL_, kind: 'org', isDefault: true },
  ]);
  const err = await runSf(fakeSf, ['data', 'query', '--target-org', 'expired@example.test', '--json']).catch((e) => e);
  assert.equal(err.sfName, 'RefreshTokenAuthError');
  assert.ok(isLoginError(err));
  assert.equal(isLoginError(new Error("No such column 'Foo' on entity 'Account'")), false);
  await assert.rejects(runSf(join(fakeDir, 'missing'), ['org', 'list', '--json']), /not at .* any more/);
});

test('a query reaches sf in a file that is gone afterwards, with a fetch limit', { skip: !unix }, async () => {
  const api = createSalesforce({ sf: fakeSf, orgs: ORGS, defaultOrg: 'demo@example.test' });
  const res = await api.query(api.pick(), "SELECT Name FROM Account WHERE Name LIKE '%A & B (x)|y%'", { max: 7, tooling: true });
  const rec = res.records[0];
  assert.equal(rec.Query, "SELECT Name FROM Account WHERE Name LIKE '%A & B (x)|y%' LIMIT 7");
  assert.equal(rec.Max, '7');
  assert.equal(rec.Tooling, true);
  assert.equal(existsSync(rec.File), false);
});

test('the client reads only the orgs of the allowlist', async () => {
  const calls = [];
  const run = async (sf, args, opts) => { calls.push({ args, opts }); return {}; };
  const api = createSalesforce({ sf: '/bin/sf', orgs: ORGS, defaultOrg: 'sb@example.test', run });
  assert.equal(api.defaultOrg.alias, 'pk-sb');
  assert.equal(api.pick('PK-DEMO').username, 'demo@example.test');
  assert.equal(api.pick('demo@example.test').alias, 'pk-demo');
  assert.throws(() => api.pick('client-prod'), /not an org pilotkit may read\. It reads: pk-demo, pk-sb/);
  await api.describe(api.pick(), 'Account');
  assert.deepEqual(calls[0].args, ['sobject', 'describe', '--sobject', 'Account', '--target-org', 'sb@example.test', '--json']);
  await assert.rejects(api.describe(api.pick(), 'Account; drop'), /not an object API name/);
  await assert.rejects(api.getRecord(api.pick(), 'Account', '001&calc'), /not a record id/);
  assert.throws(() => createSalesforce({ sf: null, orgs: [] }), /pilotkit add salesforce/);
  assert.equal(loginCommand(ORGS[0]), 'sf org login web --alias pk-demo');
  assert.equal(loginCommand(ORGS[1]), 'sf org login web --alias pk-sb --instance-url https://demo--uat.sandbox.my.salesforce.com');
});

test('the tools answer in compact text', async () => {
  const records = (n) => Array.from({ length: n }, (_, i) => ({ attributes: { type: 'Account' }, Id: `001000000000${String(i).padStart(3, '0')}AAA`, Name: `Acme ${i}` }));
  const api = {
    orgs: ORGS, defaultOrg: ORGS[0],
    pick: (name) => (name ? ORGS.find((o) => o.alias === name) : ORGS[0]),
    known: async () => [ORGS[0]],
    query: async (org, soql, { max }) => (/COUNT\(\)/.test(soql) ? { totalSize: 42, records: [] } : { totalSize: 120, records: records(Math.min(max, 120)) }),
    search: async () => ({ searchRecords: [...records(2), { attributes: { type: 'Contact' }, Id: '003000000000001AAA', Name: 'Ann' }] }),
    listObjects: async () => ['Account', 'Invoice__c', 'Invoice_Line__c', 'Contact'],
  };
  const many = await tool('salesforce_query').run(api, { soql: 'SELECT Id, Name FROM Account', max: 3 });
  assert.match(many, /^3 of 120 record\(s\) from pk-demo\nOnly the first 3: narrow the WHERE clause/);
  assert.match(many, /\| \[001000000000000AAA\]\(https:\/\/demo\.my\.salesforce\.com\/001000000000000AAA\) \| Acme 0 \|/);
  assert.match(await tool('salesforce_query').run(api, { soql: 'SELECT Id FROM Account', max: 1 }), /^1 of 120 record\(s\) from pk-demo[\s\S]*\n\nAccount \[001000000000000AAA\]/);
  assert.equal(await tool('salesforce_query').run(api, { soql: 'SELECT COUNT() FROM Case' }), 'Count: 42 (pk-demo)');
  const found = await tool('salesforce_search').run(api, { sosl: 'FIND {Acme}' });
  assert.match(found, /^3 result\(s\) from pk-demo\n\nAccount \(2\)\n\n\| Id \| Name \|[\s\S]*\nContact \(1\)\n/);
  assert.equal(await tool('salesforce_list_objects').run(api, { filter: 'invoice' }), '2 object(s) matching "invoice" in pk-demo:\nInvoice__c, Invoice_Line__c');
  const orgs = await tool('salesforce_orgs').run(api, {});
  assert.match(orgs, /\| pk-demo \| demo@example\.test \| org \| https:\/\/demo\.my\.salesforce\.com \| default \|/);
  assert.match(orgs, /\| pk-sb \|.*sf no longer has this login: run "sf org login web --alias pk-sb --instance-url/);
});

test('the connector: doctor check per org, summary and desk lines', { skip: !unix }, async () => {
  const sf = findConnector('salesforce');
  const config = { connectors: ['salesforce'], atlassian: {}, salesforce: { sf: fakeSf, orgs: ORGS.slice(0, 1), defaultOrg: 'demo@example.test' }, desk: {} };
  assert.equal(sf.configured(config), true);
  assert.deepEqual(await sf.check(config), { ok: true, message: 'Salesforce pk-demo: Demo Org' });
  const expired = { ...config, salesforce: { ...config.salesforce, orgs: [...ORGS.slice(0, 1), { username: 'expired@example.test', alias: 'old', kind: 'org' }] } };
  const res = await sf.check(expired);
  assert.equal(res.ok, false);
  assert.match(res.message, /old: Error authenticating with the refresh token/);
  assert.equal(res.fix, 'The sf CLI login expired: run "sf org login web --alias old".');
  assert.deepEqual((await sf.check({ ...config, salesforce: { ...config.salesforce, sf: join(fakeDir, 'gone') } })).fix, 'Run "pilotkit add salesforce" to find it again.');
  assert.deepEqual(sf.summary(config), { where: 'pk-demo', link: URL_ });
  const guide = deskGuide({ brand: { product: 'pilotkit desk' }, connectors: [findConnector('atlassian'), sf], config: { ...config, atlassian: { site: 'https://acme.atlassian.net' } } });
  assert.match(guide, /their Jira issues and Confluence pages and their Salesforce records and metadata/);
  assert.match(guide, /pilotkit-salesforce tools to read the Salesforce org pk-demo; they cannot change a record/);
  assert.match(guide, /Link every issue and page and record you mention/);
});

test('config.json keeps the Salesforce allowlist and survives a bad one', async () => {
  const { loadConfig, saveConfig } = await import('../src/config.mjs');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ connectors: ['salesforce'], salesforce: { sf: '/x/sf', orgs: 'nope' } }));
  assert.deepEqual(loadConfig().salesforce, { sf: '/x/sf', orgs: [], defaultOrg: null });
  const config = loadConfig();
  config.salesforce = { sf: '/x/sf', orgs: ORGS, defaultOrg: 'demo@example.test' };
  saveConfig(config);
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).salesforce.orgs, ORGS);
});
