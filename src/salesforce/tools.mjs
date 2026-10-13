import { z } from 'zod';
import { loginCommand, orgLabel } from './client.mjs';
import { API_NAME, RECORD_ID } from './soql.mjs';
import { describeText, recordLines, recordsTable } from './text.mjs';

// Every tool is read-only and answers in compact text. The org is optional: the default org of the
// allowlist when left out.

const org = z.string().max(120).optional().describe('Alias or username of the org to read; the default org when left out');
const max = z.number().int().min(1).max(200).optional().describe('Records to return: 50 by default, 200 at most');
const tooling = z.boolean().optional().describe('Use the Tooling API (ApexClass, ApexTrigger, CustomField, FlowDefinitionView, ValidationRule…)');
const object = z.string().regex(API_NAME).describe('Object API name, e.g. Account, Opportunity, Invoice__c');

export const TOOLS = [
  {
    name: 'salesforce_orgs',
    title: 'Salesforce orgs I can read',
    description: 'List the Salesforce orgs pilotkit may read (alias, username, type, instance) and the default one. Call it first when the user asks which org, or about access.',
    input: {},
    run: async (api) => {
      const known = new Set((await api.known()).map((o) => o.username));
      const rows = api.orgs.map((o) => `| ${o.alias ?? ''} | ${o.username} | ${o.kind} | ${o.instanceUrl ?? ''} | ${[
        o === api.defaultOrg ? 'default' : '', known.has(o.username) ? '' : `sf no longer has this login: run "${loginCommand(o)}"`,
      ].filter(Boolean).join('; ')} |`);
      return ['| Alias | Username | Type | Instance | Note |', '|---|---|---|---|---|', ...rows].join('\n');
    },
  },
  {
    name: 'salesforce_query',
    title: 'Run a SOQL query',
    description: 'Run a read-only SOQL SELECT and get the records as a table (a single record: every field). Select only the fields you need; relationship fields (Owner.Name, Account.Name) and subqueries work. Count with SELECT COUNT() FROM … . Describe an object first when unsure of its field names.',
    input: { soql: z.string().min(1).max(20000).describe('SELECT … FROM … [WHERE …] [ORDER BY …] [LIMIT n]'), org, tooling, max },
    run: async (api, { soql, org: name, tooling: useTooling = false, max: n = 50 }) => {
      const o = api.pick(name);
      const res = await api.query(o, soql, { tooling: useTooling, max: n });
      const records = (res.records ?? []).slice(0, n);
      const total = res.totalSize ?? records.length;
      if (!records.length) return total ? `Count: ${total} (${orgLabel(o)})` : `No records in ${orgLabel(o)}.`;
      const more = total > records.length ? `\nOnly the first ${records.length}: narrow the WHERE clause, or raise "max" (200 at most).` : '';
      const body = records.length === 1 ? recordLines(records[0], o.instanceUrl) : recordsTable(records, o.instanceUrl);
      return `${records.length} of ${total} record(s) from ${orgLabel(o)}${useTooling ? ' (Tooling API)' : ''}${more}\n\n${body}`;
    },
  },
  {
    name: 'salesforce_search',
    title: 'Search Salesforce with SOSL',
    description: 'Full-text search across objects with SOSL, for a name or a word rather than an id, e.g. FIND {Acme} IN NAME FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email). Name the fields to return.',
    input: { sosl: z.string().min(1).max(20000).describe('FIND {words} IN … FIELDS RETURNING Object(fields), …'), org, max },
    run: async (api, { sosl, org: name, max: n = 50 }) => {
      const o = api.pick(name);
      const found = ((await api.search(o, sosl)).searchRecords ?? []).slice(0, n);
      if (!found.length) return `Nothing found in ${orgLabel(o)}.`;
      const byType = Map.groupBy(found, (r) => r.attributes?.type ?? 'Record');
      return [`${found.length} result(s) from ${orgLabel(o)}`, ...[...byType].map(([type, rows]) => `\n${type} (${rows.length})\n\n${recordsTable(rows, o.instanceUrl)}`)].join('\n');
    },
  },
  {
    name: 'salesforce_describe',
    title: 'Describe a Salesforce object',
    description: 'The fields of an object (API name, label, type, lookups, picklist values, required) and its child relationships. "filter" keeps the fields whose name or label contains it.',
    input: { object, org, filter: z.string().max(60).optional().describe('Part of a field name or label'), tooling },
    run: async (api, { object: sobject, org: name, filter, tooling: useTooling = false }) => {
      const o = api.pick(name);
      return describeText(await api.describe(o, sobject, { tooling: useTooling }), { filter });
    },
  },
  {
    name: 'salesforce_list_objects',
    title: 'List Salesforce objects',
    description: 'The API names of the objects in an org: all, custom or standard. "filter" keeps the names that contain it.',
    input: { kind: z.enum(['all', 'custom', 'standard']).optional(), filter: z.string().max(60).optional(), org },
    run: async (api, { kind = 'all', filter, org: name }) => {
      const o = api.pick(name);
      let names = await api.listObjects(o, kind);
      if (filter) names = names.filter((x) => x.toLowerCase().includes(filter.toLowerCase()));
      const shown = names.slice(0, 400);
      return `${names.length} ${kind === 'all' ? '' : `${kind} `}object(s)${filter ? ` matching "${filter}"` : ''} in ${orgLabel(o)}${shown.length < names.length ? `, the first ${shown.length} (use filter to narrow)` : ''}:\n${shown.join(', ')}`;
    },
  },
  {
    name: 'salesforce_get_record',
    title: 'Read a Salesforce record',
    description: 'Every filled field of one record, by object and id.',
    input: { object, id: z.string().regex(RECORD_ID).describe('15- or 18-character record id'), org, tooling },
    run: async (api, { object: sobject, id, org: name, tooling: useTooling = false }) => {
      const o = api.pick(name);
      return recordLines(await api.getRecord(o, sobject, id, { tooling: useTooling }), o.instanceUrl);
    },
  },
];
