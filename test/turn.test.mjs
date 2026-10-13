import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNote, splitMessages } from '../site/turn.js';

const m = (text) => ({ kind: 'assistant', text });

test('a short single line is a note, anything longer is answer', () => {
  assert.equal(isNote('Let me look up your open issues.'), true);
  assert.equal(isNote('x'.repeat(300)), true);
  assert.equal(isNote('x'.repeat(301)), false);
  assert.equal(isNote('| Key | Status |\n|---|---|\n| HS-1 | Done |'), false);
  assert.equal(isNote('One line.\n'), true);
});

test('a finished turn: the last message and the long earlier ones are the answer, in order', () => {
  const table = m('| Key | Status |\n|---|---|\n| HS-1 | Done |');
  const { notes, answer } = splitMessages([m('Looking it up.'), table, m('Anything else?')], false);
  assert.deepEqual(notes.map((x) => x.text), ['Looking it up.']);
  assert.deepEqual(answer, [table, m('Anything else?')]);
  assert.deepEqual(splitMessages([m('Done.')], false), { notes: [], answer: [m('Done.')] });
  assert.deepEqual(splitMessages([], false), { notes: [], answer: [] });
});

test('a running turn shows the long messages so far, never the short ones', () => {
  const table = m('Here is the list:\n\n- HS-1\n- HS-2');
  const { notes, answer } = splitMessages([m('Looking it up.'), table], true);
  assert.deepEqual(notes.map((x) => x.text), ['Looking it up.']);
  assert.deepEqual(answer, [table]);
});
