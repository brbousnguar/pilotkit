import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adfToText, clip, decodeEntities, storageToText } from '../src/atlassian/text.mjs';

const doc = (...content) => ({ type: 'doc', version: 1, content });
const p = (...content) => ({ type: 'paragraph', content });
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });

test('ADF: paragraphs, headings, marks and links', () => {
  const out = adfToText(doc(
    { type: 'heading', attrs: { level: 2 }, content: [t('Context')] },
    p(t('See '), t('the spec', [{ type: 'link', attrs: { href: 'https://example.com/spec' } }]), t(' and run '), t('npm test', [{ type: 'code' }])),
    p({ type: 'mention', attrs: { text: '@Ada' } }, t(' please check')),
  ));
  assert.equal(out, '## Context\n\nSee [the spec](https://example.com/spec) and run `npm test`\n\n@Ada please check');
});

test('ADF: nested lists and task lists', () => {
  const out = adfToText(doc(
    { type: 'bulletList', content: [
      { type: 'listItem', content: [p(t('one')), { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('one.a'))] }] }] },
      { type: 'listItem', content: [p(t('two'))] },
    ] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { state: 'DONE' }, content: [t('done')] }, { type: 'taskItem', attrs: { state: 'TODO' }, content: [t('todo')] }] },
  ));
  assert.equal(out, '- one\n  1. one.a\n- two\n\n- [x] done\n- [ ] todo');
});

test('ADF: a table becomes one Markdown row per table row', () => {
  const cell = (s) => ({ type: 'tableCell', content: [p(t(s))] });
  const out = adfToText(doc({ type: 'table', content: [
    { type: 'tableRow', content: [cell('Key'), cell('Value')] },
    { type: 'tableRow', content: [cell('a|b'), cell('2')] },
  ] }));
  assert.equal(out, '| Key | Value |\n| a\\|b | 2 |');
});

test('ADF: empty and plain inputs', () => {
  assert.equal(adfToText(null), '');
  assert.equal(adfToText('already text'), 'already text');
});

test('storage format: headings, lists, bold, links and entities', () => {
  const html = '<h1>Deploy</h1><p>Read <a href="https://example.com/runbook">the runbook</a> &amp; <strong>then</strong>:</p>'
    + '<ul><li>build</li><li>ship&nbsp;it</li></ul>';
  assert.equal(storageToText(html), '# Deploy\n\nRead [the runbook](https://example.com/runbook) & **then**:\n\n- build\n- ship it');
});

test('storage format: table cells with paragraphs stay on one row', () => {
  const html = '<table><tbody><tr><th><p>Step</p></th><th><p>Owner</p></th></tr>'
    + '<tr><td><p>Build</p><p>and test</p></td><td>Ops<br/>team</td></tr></tbody></table>';
  assert.equal(storageToText(html), '| Step | Owner |\n| Build and test | Ops team |');
});

test('storage format: code macros keep their body, macro parameters go', () => {
  const html = '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">bash</ac:parameter>'
    + '<ac:plain-text-body><![CDATA[npm run build]]></ac:plain-text-body></ac:structured-macro>';
  assert.equal(storageToText(html), '```\nnpm run build\n```');
});

test('entities and clip', () => {
  assert.equal(decodeEntities('&lt;a&gt; &#233; &#x41; &unknown;'), '<a> é A &unknown;');
  assert.equal(clip('abcdef', 3), 'abc\n…(cut at 3 characters; ask for more if you need it)');
  assert.equal(clip('abc', 3), 'abc');
});
