import { existsSync } from 'node:fs';
import { runTool } from '../clients.mjs';
import { ask, bad, bold, confirm, dim, info, ok, warn } from '../cli/ui.mjs';
import { createSalesforce, loginCommand, orgLabel } from '../salesforce/client.mjs';
import { SAFE_ARG, findSf, isLoginError, listOrgs, sfEnv, sfVersion } from '../salesforce/sf.mjs';
import { TOOLS } from '../salesforce/tools.mjs';

// Salesforce, read through the Salesforce CLI (sf) with the logins it already has. pilotkit keeps no
// Salesforce credential: only the path of sf and the orgs it may read (an allowlist) in config.json.

const ALIAS = /^[A-Za-z0-9][\w.-]{0,39}$/;
const list = (orgs) => orgs.map(orgLabel).join(', ');

// The org's own name, which proves the login works (one cheap query).
async function orgName(api, org) {
  const res = await api.query(org, 'SELECT Name FROM Organization', { max: 1 });
  return res.records?.[0]?.Name ?? 'connected';
}

// "1, pk-demo" → orgs, by number, alias or username.
function pickOrgs(answer, orgs) {
  const words = [].concat(answer).flatMap((a) => String(a).split(',')).map((s) => s.trim()).filter(Boolean);
  const picked = words.map((w) => {
    const n = Number(w);
    const org = Number.isInteger(n) && n >= 1 && n <= orgs.length ? orgs[n - 1]
      : orgs.find((o) => o.alias?.toLowerCase() === w.toLowerCase() || o.username.toLowerCase() === w.toLowerCase());
    if (!org) throw new Error(`"${w}" is not one of the orgs the sf CLI knows (${list(orgs)})`);
    return org;
  });
  return [...new Map(picked.map((o) => [o.username, o])).values()];
}

export const salesforce = {
  id: 'salesforce',
  title: 'Salesforce',
  server: 'pilotkit-salesforce',
  replaces: [],
  // sf on a Linux PC without a keyring reads its own key file when this says so.
  env: ['SF_USE_GENERIC_UNIX_KEYCHAIN', 'SFDX_USE_GENERIC_UNIX_KEYCHAIN'],
  tools: TOOLS.map((t) => t.name),
  example: 'which Salesforce orgs can I read?',
  configured: (config) => config.salesforce.orgs.length > 0,

  // The sf CLI, a login, then the orgs pilotkit may read; each one checked before anything is saved.
  async setup(config, { opts }) {
    let sf = config.salesforce.sf && existsSync(config.salesforce.sf) ? config.salesforce.sf : findSf();
    if (!sf) {
      warn('pilotkit reads Salesforce through the Salesforce CLI (sf), with the logins it already has. It is not installed.');
      if (await confirm('Install it now with "npm install -g @salesforce/cli"?')) {
        runTool('npm', ['install', '-g', '@salesforce/cli'], { inherit: true });
        sf = findSf();
      }
    }
    if (!sf) throw new Error('no Salesforce CLI: install it ("npm install -g @salesforce/cli"), then run "pilotkit add salesforce" again');
    if (!SAFE_ARG.test(sf)) throw new Error(`pilotkit cannot run sf from ${sf}: move it to a folder without special characters`);
    ok(`Salesforce CLI ${sfVersion(sf) ?? ''} ${dim(sf)}`);

    let orgs = (await listOrgs(sf)).filter((o) => SAFE_ARG.test(o.username));
    if (!orgs.length) {
      info('The sf CLI is not logged in to any org yet.');
      if (await confirm('Log in to one now? Your browser opens the Salesforce login page.')) {
        const alias = await ask('A short name for this org', { def: 'my-org' });
        if (!ALIAS.test(alias)) throw new Error(`"${alias}" is not a usable alias: letters, digits, dots, dashes and underscores`);
        const sandbox = await confirm('Is it a sandbox?', false);
        runTool(sf, ['org', 'login', 'web', '--alias', alias, ...(sandbox ? ['--instance-url', 'https://test.salesforce.com'] : [])], { inherit: true, env: sfEnv() });
        orgs = (await listOrgs(sf)).filter((o) => SAFE_ARG.test(o.username));
      }
    }
    if (!orgs.length) throw new Error('the sf CLI knows no org: run "sf org login web --alias <name>", then "pilotkit add salesforce" again');

    // pilotkit reads only the orgs picked here, whatever else sf is logged in to.
    console.log('');
    orgs.forEach((o, i) => console.log(`    ${i + 1}. ${bold(orgLabel(o))}  ${o.alias ? `${o.username}  ` : ''}${dim(`${o.kind}${o.isDefault ? ', sf default' : ''}`)}`));
    const before = config.salesforce.orgs.map((o) => o.username).filter((u) => orgs.some((o) => o.username === u));
    const def = before.length ? before : [(orgs.find((o) => o.isDefault) ?? orgs[0]).username];
    const answer = opts.org?.length ? opts.org
      : await ask('Orgs pilotkit may read (numbers or aliases, comma-separated)', { def: list(orgs.filter((o) => def.includes(o.username))) });
    const chosen = pickOrgs(answer, orgs);
    if (!chosen.length) throw new Error('no org chosen');

    const api = createSalesforce({ sf, orgs: chosen, defaultOrg: chosen[0].username });
    for (const org of chosen) {
      try {
        ok(`${orgLabel(org)}: ${bold(await orgName(api, org))} ${dim(org.instanceUrl ?? '')}`);
      } catch (err) {
        bad(`${orgLabel(org)}: ${err.message}`);
        throw new Error(isLoginError(err) ? `log in to ${orgLabel(org)} again ("${loginCommand(org)}"), then run "pilotkit add salesforce" again` : `${orgLabel(org)} did not answer`);
      }
    }
    config.salesforce = {
      sf,
      orgs: chosen.map(({ username, alias, instanceUrl, kind }) => ({ username, alias, instanceUrl, kind })),
      defaultOrg: chosen[0].username,
    };
    if (chosen.length > 1) info(`${orgLabel(chosen[0])} is the default; a question can name another org.`);
  },

  /** For doctor and the desk: { ok, message, fix }. */
  async check(config) {
    const { sf, orgs, defaultOrg } = config.salesforce;
    if (!orgs.length) return { ok: false, message: 'Salesforce is not set up', fix: 'Run "pilotkit add salesforce".' };
    if (!sf || !existsSync(sf)) return { ok: false, message: `The Salesforce CLI is not at ${sf ?? '(unknown)'} any more`, fix: 'Run "pilotkit add salesforce" to find it again.' };
    const api = createSalesforce({ sf, orgs, defaultOrg });
    const results = await Promise.all(orgs.map((org) => orgName(api, org).then((name) => ({ org, name }), (err) => ({ org, err }))));
    const failed = results.filter((r) => r.err);
    if (!failed.length) return { ok: true, message: `Salesforce ${results.map((r) => `${orgLabel(r.org)}: ${r.name}`).join(', ')}` };
    const logins = failed.filter((r) => isLoginError(r.err)).map((r) => loginCommand(r.org));
    return {
      ok: false,
      message: `Salesforce ${failed.map((r) => `${orgLabel(r.org)}: ${r.err.message}`).join('; ')}`,
      fix: logins.length ? `The sf CLI login expired: run ${logins.map((c) => `"${c}"`).join(' and ')}.` : 'Run "pilotkit add salesforce" again.',
    };
  },

  forget: () => 'pilotkit kept no Salesforce credential: the sf CLI keeps its own logins ("sf org logout" signs out)',

  summary: (config) => ({
    where: config.salesforce.orgs.length ? list(config.salesforce.orgs) : null,
    link: config.salesforce.orgs[0]?.instanceUrl ?? null,
  }),

  desk: (config) => {
    const { orgs, defaultOrg } = config.salesforce;
    const def = orgs.find((o) => o.username === defaultOrg) ?? orgs[0];
    return {
      about: 'their Salesforce records and metadata',
      read: `Use the pilotkit-salesforce tools to read the Salesforce org${orgs.length > 1 ? `s ${list(orgs)} (${orgLabel(def)} unless the user names another)` : def ? ` ${orgLabel(def)}` : ''}; they cannot change a record or any metadata.`,
      economy: 'in SOQL select only the fields you need with a small "max", count with SELECT COUNT(), and describe an object before guessing its field names',
      links: 'record',
    };
  },

  async serve() {
    const { runMcp } = await import('../salesforce/mcp.mjs');
    return runMcp();
  },
};
