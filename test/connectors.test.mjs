import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// config.mjs reads PILOTKIT_HOME when it loads, so it is set before the import.
const home = mkdtempSync(join(tmpdir(), 'pk-home-'));
process.env.PILOTKIT_HOME = home;
const { loadConfig, saveConfig } = await import('../src/config.mjs');
const { CONNECTORS, addedConnectors, findConnector, markAdded, markRemoved } = await import('../src/connectors/index.mjs');
const { deskGuide, deskServers } = await import('../src/desk/runner.mjs');

const brand = { product: 'pilotkit desk' };

test('every connector has a server named pilotkit-<id> and the parts the CLI and the desk use', () => {
  for (const c of CONNECTORS) {
    assert.equal(c.server, `pilotkit-${c.id}`);
    for (const fn of ['configured', 'setup', 'check', 'forget', 'desk', 'serve']) assert.equal(typeof c[fn], 'function', `${c.id}.${fn}`);
    assert.ok(c.tools.length > 0 && c.tools.length < 20, `${c.id} keeps its tool list short`);
  }
  assert.throws(() => findConnector('nope'), /not a pilotkit connector\. Connectors: atlassian/);
});

test('a 0.2 config with Atlassian set up counts as the atlassian connector', () => {
  writeFileSync(join(home, 'config.json'), JSON.stringify({ atlassian: { site: 'https://acme.atlassian.net', email: 'a@acme.test' } }));
  assert.deepEqual(loadConfig().connectors, ['atlassian']);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ desk: { port: 8800 } }));
  assert.deepEqual(loadConfig().connectors, []);
});

test('add and remove keep the list in config.json', () => {
  writeFileSync(join(home, 'config.json'), '{}');
  const config = loadConfig();
  const atlassian = findConnector('atlassian');
  markAdded(config, atlassian);
  markAdded(config, atlassian);
  saveConfig(config);
  assert.deepEqual(loadConfig().connectors, ['atlassian']);
  markRemoved(config, atlassian);
  saveConfig(config);
  assert.deepEqual(loadConfig().connectors, []);
  // Removed means removed, even though the Atlassian settings stay.
  config.atlassian = { site: 'https://acme.atlassian.net', email: 'a@acme.test' };
  saveConfig(config);
  assert.deepEqual(addedConnectors(loadConfig()), []);
});

test('the desk starts one server per added connector and names its tools in the guide', () => {
  const config = { connectors: ['atlassian'], atlassian: { site: 'https://acme.atlassian.net', email: 'a@acme.test' }, desk: {} };
  const connectors = addedConnectors(config);
  const servers = deskServers(connectors);
  assert.deepEqual(Object.keys(servers), ['pilotkit-atlassian']);
  assert.deepEqual(servers['pilotkit-atlassian'].args.slice(-2), ['mcp', 'atlassian']);
  assert.equal(servers['pilotkit-atlassian'].env.PILOTKIT_HOME, home);
  const guide = deskGuide({ brand, connectors, config });
  assert.match(guide, /their Jira issues and Confluence pages/);
  assert.match(guide, /pilotkit-atlassian tools to read the Atlassian site https:\/\/acme\.atlassian\.net/);
  assert.match(guide, /Link every issue and page you mention/);
  const none = deskGuide({ brand, connectors: [], config });
  assert.doesNotMatch(none, /Atlassian|Link every/);
});

test('doctor says to replace the Atlassian token when Atlassian answers 401', async () => {
  const realFetch = globalThis.fetch;
  process.env.PILOTKIT_ATLASSIAN_TOKEN = 'not-a-real-token';
  globalThis.fetch = async () => new Response('{"message":"Unauthorized"}', { status: 401 });
  try {
    const res = await findConnector('atlassian').check({ atlassian: { site: 'https://acme.atlassian.net', email: 'a@acme.test' } });
    assert.equal(res.ok, false);
    assert.match(res.message, /refused the email and token/);
    assert.match(res.fix, /pilotkit add atlassian --new-token/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.PILOTKIT_ATLASSIAN_TOKEN;
  }
});
