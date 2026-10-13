import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LEGACY_SERVER, parseJsonc, registerVSCode, serverLaunch, stableNode, unregisterVSCode, vscodeRegistered } from '../src/clients.mjs';

const SERVER = 'pilotkit-atlassian';

const launch = { command: '/usr/bin/node', args: ['/opt/pilotkit/bin/pilotkit.mjs', 'mcp', 'atlassian'] };

test('parseJsonc: comments and trailing commas, but not inside strings', () => {
  const text = `{
    // a comment
    "servers": { /* block */ "a": { "url": "https://example.com//x", "note": "/* not a comment */", }, },
  }`;
  assert.deepEqual(parseJsonc(text), { servers: { a: { url: 'https://example.com//x', note: '/* not a comment */' } } });
  assert.deepEqual(parseJsonc('{"a":"quote \\" // still string"}'), { a: 'quote " // still string' });
});

test('registerVSCode creates mcp.json when there is none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pk-vscode-'));
  const res = registerVSCode(dir, SERVER, launch);
  assert.equal(res.backup, null);
  const data = JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8'));
  assert.deepEqual(data.servers[SERVER], { type: 'stdio', ...launch });
  assert.ok(vscodeRegistered(dir, SERVER));
});

test('registerVSCode keeps other servers, backs up, and unregister removes only pilotkit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pk-vscode-'));
  const file = join(dir, 'mcp.json');
  writeFileSync(file, '{\n  // mine\n  "servers": { "other": { "type": "http", "url": "https://example.com/mcp" }, },\n  "inputs": []\n}\n');
  const res = registerVSCode(dir, SERVER, launch);
  assert.ok(res.hadComments);
  assert.ok(existsSync(res.backup));
  const data = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(data.servers).sort(), ['other', SERVER]);
  assert.deepEqual(data.inputs, []);

  assert.equal(unregisterVSCode(dir, SERVER), true);
  const after = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(after.servers), ['other']);
  assert.equal(unregisterVSCode(dir, SERVER), false);
});

test('registerVSCode renames a 0.2 "pilotkit" entry in one write, and leaves other servers alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pk-vscode-'));
  const file = join(dir, 'mcp.json');
  const old = { type: 'stdio', command: '/usr/bin/node', args: ['/opt/pilotkit/bin/pilotkit.mjs', 'mcp'] };
  writeFileSync(file, JSON.stringify({ servers: { [LEGACY_SERVER]: old, other: { type: 'http', url: 'https://example.com/mcp' } } }));
  const res = registerVSCode(dir, SERVER, launch, { replaces: [LEGACY_SERVER] });
  assert.deepEqual(res.replaced, [LEGACY_SERVER]);
  assert.deepEqual(JSON.parse(readFileSync(res.backup, 'utf8')).servers[LEGACY_SERVER], old);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(data.servers).sort(), ['other', SERVER]);
  assert.deepEqual(registerVSCode(dir, SERVER, launch, { replaces: [LEGACY_SERVER] }).replaced, []);
});

test('serverLaunch names the connector after mcp', () => {
  const l = serverLaunch('atlassian');
  assert.deepEqual(l.args.slice(-2), ['mcp', 'atlassian']);
  assert.equal(l.viaNpx, false);
});

test('stableNode swaps a Homebrew Cellar path for its opt link, when the link exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'pk-brew-'));
  const opt = join(root, 'opt', 'node@24', 'bin');
  mkdirSync(opt, { recursive: true });
  writeFileSync(join(opt, 'node'), '');
  assert.equal(stableNode(`${root}/Cellar/node@24/24.21.0/bin/node`), `${root}/opt/node@24/bin/node`);
  assert.equal(stableNode('/usr/local/bin/node'), '/usr/local/bin/node');
  assert.equal(stableNode(`${root}/Cellar/node/25.0.0/bin/node`), `${root}/Cellar/node/25.0.0/bin/node`);
});
