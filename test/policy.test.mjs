import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageIdFrom } from '../src/atlassian/tools.mjs';
import { normalizeSite } from '../src/config.mjs';
import { deskPolicy } from '../src/desk/policy.mjs';

test('the desk approves the tools of the added connectors and refuses everything else', () => {
  const refused = [];
  const policy = deskPolicy(['pilotkit-atlassian'], (req, reason) => refused.push(reason));
  assert.deepEqual(policy({ kind: 'mcp', serverName: 'pilotkit-atlassian', toolName: 'jira_search' }), { kind: 'approve-once' });
  // A connector this PC did not add, or the 0.2 name, is refused like any other server.
  assert.equal(policy({ kind: 'mcp', serverName: 'pilotkit-salesforce', toolName: 'query' }).kind, 'reject');
  assert.equal(policy({ kind: 'mcp', serverName: 'pilotkit', toolName: 'jira_search' }).kind, 'reject');
  refused.length = 0;
  const shell = policy({ kind: 'shell', fullCommandText: 'rm -rf /' });
  assert.equal(shell.kind, 'reject');
  assert.match(shell.feedback, /shell access is off/);
  const other = policy({ kind: 'mcp', serverName: 'github', toolName: 'create_issue' });
  assert.equal(other.kind, 'reject');
  assert.match(other.feedback, /the github tool create_issue/);
  assert.equal(refused.length, 2);
});

test('pageIdFrom reads ids from Confluence links and plain ids', () => {
  assert.equal(pageIdFrom('https://acme.atlassian.net/wiki/spaces/ENG/pages/123456/Runbook'), '123456');
  assert.equal(pageIdFrom('https://acme.atlassian.net/wiki/spaces/ENG/pages/edit-v2/42'), '42');
  assert.equal(pageIdFrom('https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=987'), '987');
  assert.equal(pageIdFrom(' 555 '), '555');
  assert.equal(pageIdFrom('Runbook'), null);
});

test('normalizeSite keeps only the https origin', () => {
  assert.equal(normalizeSite('acme.atlassian.net'), 'https://acme.atlassian.net');
  assert.equal(normalizeSite('https://ACME.atlassian.net/jira/software/projects/KEY'), 'https://acme.atlassian.net');
  assert.equal(normalizeSite('http://acme.atlassian.net'), null);
  assert.equal(normalizeSite(''), null);
});
