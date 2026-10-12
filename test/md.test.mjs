import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inline, render } from '../site/md.js';

test('escapes HTML everywhere', () => {
  assert.equal(render('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(render('```\n<b>x</b>\n```'), '<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>');
});

test('links: only http(s) become anchors', () => {
  assert.match(inline('[KEY-1](https://acme.atlassian.net/browse/KEY-1)'), /<a href="https:\/\/acme.atlassian.net\/browse\/KEY-1" target="_blank" rel="noopener noreferrer">KEY-1<\/a>/);
  assert.equal(inline('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.match(inline('see https://example.com/a.'), /<a href="https:\/\/example.com\/a"[^>]*>https:\/\/example.com\/a<\/a>\.$/);
});

test('a link label cannot smuggle attributes', () => {
  const html = inline('[a" onmouseover="x](https://example.com/")');
  assert.doesNotMatch(html, /" onmouseover="/);
});

test('bold, italics and code', () => {
  assert.equal(inline('**bold** and *it* and `a*b*c`'), '<strong>bold</strong> and <em>it</em> and <code>a*b*c</code>');
  assert.equal(inline('snake_case_name stays'), 'snake_case_name stays');
});

test('tables', () => {
  const html = render('| Key | Status |\n|---|---|\n| KEY-1 | Done |');
  assert.equal(html, '<div class="table"><table><thead><tr><th class="nw">Key</th><th class="nw">Status</th></tr></thead><tbody><tr><td class="nw">KEY-1</td><td class="nw">Done</td></tr></tbody></table></div>');
  assert.match(render('| Key |\n|---|\n| [KEY-12345](https://acme.atlassian.net/browse/KEY-12345) |'), /<td class="nw"><a /);
  assert.match(render('| Summary |\n|---|\n| A long summary that is allowed to wrap between words |'), /<td>A long summary/);
});

test('nested lists and headings', () => {
  assert.equal(render('## Plan\n- one\n  - one.a\n- two'), '<h4>Plan</h4>\n<ul><li>one<ul><li>one.a</li></ul></li><li>two</li></ul>');
  assert.equal(render('1. first\n2. second'), '<ol><li>first</li><li>second</li></ol>');
});

test('paragraph lines join with line breaks', () => {
  assert.equal(render('a\nb\n\nc'), '<p>a<br>b</p>\n<p>c</p>');
});
