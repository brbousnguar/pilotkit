// Checks on the queries a model sends, before sf runs them. SOQL and SOSL cannot insert, update or
// delete, but a few clauses still change something: FOR UPDATE locks records, FOR VIEW and FOR
// REFERENCE update "last viewed", UPDATE TRACKING and UPDATE VIEWSTAT write Knowledge statistics.

export const API_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
export const RECORD_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

// The query without its quoted values and {search terms}: a WHERE value may say anything.
export const outsideLiterals = (q) => String(q).replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/\{(?:[^}\\]|\\.)*\}/g, '{}');

// The part of a query outside its subqueries.
function topLevel(q) {
  let depth = 0;
  let top = '';
  for (const ch of outsideLiterals(q)) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) top += ch;
  }
  return top;
}

const WRITES = /\b(for\s+(update|view|reference)|update\s+(tracking|viewstat))\b/i;

export function checkSoql(soql) {
  const q = String(soql ?? '').trim();
  const bare = outsideLiterals(q);
  if (!/^select\b/i.test(bare)) throw new Error('Only SELECT queries: SOQL that starts with SELECT.');
  if (WRITES.test(bare)) throw new Error('FOR UPDATE, FOR VIEW, FOR REFERENCE, UPDATE TRACKING and UPDATE VIEWSTAT change records; pilotkit only reads. Leave the clause out.');
  return q;
}

export function checkSosl(sosl) {
  const q = String(sosl ?? '').trim();
  const bare = outsideLiterals(q);
  if (!/^find\b/i.test(bare)) throw new Error('Only SOSL searches: FIND {words} IN … RETURNING ….');
  if (WRITES.test(bare)) throw new Error('UPDATE TRACKING and UPDATE VIEWSTAT write statistics; pilotkit only reads. Leave the clause out.');
  return q;
}

// A query with no LIMIT of its own gets one, so sf does not fetch every record. Not for COUNT(),
// whose LIMIT would cap the count, and not after an OFFSET, where LIMIT cannot go.
export function withLimit(soql, max) {
  const top = topLevel(soql);
  if (/\blimit\s+\d+/i.test(top) || /\boffset\b/i.test(top) || /\bcount\s*\(\s*\)/i.test(outsideLiterals(soql))) return soql;
  return `${soql.trim()} LIMIT ${max}`;
}
