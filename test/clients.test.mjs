import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SERVER_NAME, parseJsonc, registerVSCode, stableNode, unregisterVSCode, vscodeRegistered } from '../src/clients.mjs';

const launch = { command: '/usr/bin/node', args: ['/opt/pilotkit/bin/pilotkit.mjs', 'mcp'] };

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
  const res = registerVSCode(dir, launch);
  assert.equal(res.backup, null);
  const data = JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8'));
  assert.deepEqual(data.servers[SERVER_NAME], { type: 'stdio', ...launch });
  assert.ok(vscodeRegistered(dir));
});

test('registerVSCode keeps other servers, backs up, and unregister removes only pilotkit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pk-vscode-'));
  const file = join(dir, 'mcp.json');
  writeFileSync(file, '{\n  // mine\n  "servers": { "other": { "type": "http", "url": "https://example.com/mcp" }, },\n  "inputs": []\n}\n');
  const res = registerVSCode(dir, launch);
  assert.ok(res.hadComments);
  assert.ok(existsSync(res.backup));
  const data = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(data.servers).sort(), ['other', SERVER_NAME]);
  assert.deepEqual(data.inputs, []);

  assert.equal(unregisterVSCode(dir), true);
  const after = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(after.servers), ['other']);
  assert.equal(unregisterVSCode(dir), false);
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
