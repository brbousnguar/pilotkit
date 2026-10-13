// How one turn's assistant messages are shown. The last one is the answer. An earlier one is usually a short
// note on the work ("Let me look up your open issues.") and goes in the work panel. But a model sometimes writes
// the answer, say a table, and then a short closing line, so a longer earlier message is shown as answer too.

const NOTE_MAX = 300;

export const isNote = (text) => text.length <= NOTE_MAX && !text.trim().includes('\n');

// While the turn runs, every message so far is an earlier one: the answer is still being written.
export function splitMessages(messages, live) {
  const earlier = live ? messages : messages.slice(0, -1);
  const last = live ? [] : messages.slice(-1);
  return {
    notes: earlier.filter((m) => isNote(m.text)),
    answer: [...earlier.filter((m) => !isNote(m.text)), ...last],
  };
}
