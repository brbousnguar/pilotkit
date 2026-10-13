// Salesforce records as compact text: a Markdown table for many, labelled lines for one, a link per
// record. Every character is re-sent with each later model call, so long values are cut.

export const clip = (s, n) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}… (${t.length - n} more characters)` : t;
};
const cell = (v, n = 100) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export const recordUrl = (instanceUrl, id) => (instanceUrl && id ? `${instanceUrl.replace(/\/+$/, '')}/${id}` : null);
const linked = (instanceUrl, id) => (recordUrl(instanceUrl, id) ? `[${id}](${recordUrl(instanceUrl, id)})` : id);

// One level of columns: Owner { Name } becomes "Owner.Name", a subquery "3 records: A, B, C", an
// address or location its parts; "attributes" goes.
export function flatten(record, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(record ?? {})) {
    if (k === 'attributes') continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (Array.isArray(v.records)) {
        const names = v.records.slice(0, 5).map((r) => r.Name ?? r.Subject ?? r.Id).filter(Boolean);
        out[key] = `${v.totalSize ?? v.records.length} record(s)${names.length ? `: ${names.join(', ')}` : ''}`;
      } else if (v.attributes) Object.assign(out, flatten(v, key));
      else out[key] = Object.values(v).filter((x) => x != null && typeof x !== 'object').join(', ');
    } else out[key] = v;
  }
  return out;
}

export function recordsTable(records, instanceUrl) {
  if (!records.length) return 'No records.';
  const rows = records.map((r) => flatten(r));
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const show = (col, v) => (col === 'Id' && v ? linked(instanceUrl, v) : cell(v));
  return [
    `| ${columns.join(' | ')} |`,
    `|${columns.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${columns.map((c) => show(c, r[c])).join(' | ')} |`),
  ].join('\n');
}

// One record: every field with a value, long text cut at 2,000 characters.
export function recordLines(record, instanceUrl) {
  const type = record?.attributes?.type ?? 'Record';
  const fields = flatten(record);
  const filled = Object.entries(fields).filter(([, v]) => v !== null && v !== undefined && v !== '');
  const empty = Object.keys(fields).length - filled.length;
  const head = `${type} ${fields.Id ? linked(instanceUrl, fields.Id) : ''}`.trim();
  return [head, ...filled.filter(([k]) => k !== 'Id').map(([k, v]) => `${k}: ${clip(v, 2000)}`),
    ...(empty ? [`(${empty} empty field(s) not shown)`] : [])].join('\n');
}

// The fields of an object, with what a query writer needs: type, lookups, picklist values.
export function describeText(d, { filter, max = 120 } = {}) {
  const needle = filter?.trim().toLowerCase();
  const all = d.fields ?? [];
  const fields = needle ? all.filter((f) => f.name.toLowerCase().includes(needle) || String(f.label).toLowerCase().includes(needle)) : all;
  const notes = (f) => [
    f.type === 'reference' && f.referenceTo?.length ? `→ ${f.referenceTo.join('/')}${f.relationshipName ? ` (${f.relationshipName})` : ''}` : null,
    (f.type === 'picklist' || f.type === 'multipicklist') && f.picklistValues?.length
      ? (() => { const v = f.picklistValues.filter((p) => p.active !== false).map((p) => p.value); return `${v.slice(0, 10).join(', ')}${v.length > 10 ? ` (+${v.length - 10})` : ''}`; })()
      : null,
    ['string', 'textarea', 'url', 'email', 'phone'].includes(f.type) && f.length ? `${f.length} chars` : null,
    f.nillable === false && f.createable && !f.defaultedOnCreate ? 'required' : null,
    f.calculated ? 'formula' : null,
    f.externalId ? 'external id' : null,
    f.unique ? 'unique' : null,
  ].filter(Boolean).join('; ');
  const shown = fields.slice(0, max);
  const children = (d.childRelationships ?? []).filter((r) => r.relationshipName);
  return [
    `${d.label} (${d.name})${d.custom ? ', custom' : ''}, key prefix ${d.keyPrefix ?? 'none'}${d.queryable === false ? ', not queryable' : ''}`,
    `${fields.length} field(s)${needle ? ` matching "${filter.trim()}"` : ''}${shown.length < fields.length ? `, the first ${shown.length} (use filter to narrow)` : ''}:`,
    '',
    '| API name | Label | Type | Notes |',
    '|---|---|---|---|',
    ...shown.map((f) => `| ${f.name} | ${cell(f.label, 60)} | ${f.type} | ${cell(notes(f), 160)} |`),
    ...(children.length && !needle
      ? ['', `Child relationships (for subqueries): ${children.slice(0, 40).map((r) => `${r.relationshipName} (${r.childSObject})`).join(', ')}${children.length > 40 ? ` (+${children.length - 40})` : ''}`]
      : []),
  ].join('\n');
}
