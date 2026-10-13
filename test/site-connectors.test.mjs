import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVITY, CONNECTOR_UI, connectorsOf, joinWords, suggestionsOf } from '../site/connectors.js';
import { CONNECTORS } from '../src/connectors/index.mjs';

test('the desk pages have wording and activity lines for every connector and tool', () => {
  for (const c of CONNECTORS) {
    const ui = CONNECTOR_UI[c.id];
    assert.ok(ui, `site/connectors.js knows ${c.id}`);
    assert.ok(ui.suggestions.length >= 2 && ui.examples.length >= 2, `${c.id} has suggestions and examples`);
    for (const tool of c.tools) assert.equal(typeof ACTIVITY[tool], 'function', `activity line for ${tool}`);
  }
});

test('joinWords and the suggestions shared out between connectors', () => {
  assert.equal(joinWords([]), '');
  assert.equal(joinWords(['Jira']), 'Jira');
  assert.equal(joinWords(['Jira', 'Confluence']), 'Jira or Confluence');
  assert.equal(joinWords(['Jira', 'Confluence', 'Salesforce'], 'and'), 'Jira, Confluence and Salesforce');
  const one = connectorsOf({ connectors: [{ id: 'atlassian', title: 'Jira and Confluence' }] });
  assert.equal(suggestionsOf(one).length, 6);
  const two = connectorsOf({ connectors: [{ id: 'atlassian', title: 'A' }, { id: 'unknown', title: 'Later' }] });
  assert.equal(two[1].ui.reads, 'Later');
  assert.deepEqual(suggestionsOf(two), CONNECTOR_UI.atlassian.suggestions.slice(0, 3));
  assert.deepEqual(suggestionsOf([]), []);
});
