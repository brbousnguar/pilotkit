import { createAtlassian } from '../atlassian/client.mjs';
import { TOOLS } from '../atlassian/tools.mjs';
import { ask, bad, bold, confirm, info, ok } from '../cli/ui.mjs';
import { normalizeSite } from '../config.mjs';
import { deleteToken, readToken, saveToken, storeName } from '../secrets.mjs';

const TOKEN_PAGE = 'https://id.atlassian.com/manage-profile/security/api-tokens';

// Jira and Confluence Cloud, read with the user's own API token.
export const atlassian = {
  id: 'atlassian',
  title: 'Jira and Confluence',
  server: 'pilotkit-atlassian',
  // Before connectors, this server was the only one and was registered as `pilotkit`.
  replaces: ['pilotkit'],
  // What the server needs from the desk's environment, besides the basics.
  env: ['PILOTKIT_ATLASSIAN_TOKEN'],
  example: 'what are my open Jira issues?',
  tools: TOOLS.map((t) => t.name),

  configured: (config) => Boolean(config.atlassian.site && config.atlassian.email),

  // Site, email, API token; checked against Jira before anything is saved.
  async setup(config, { brand, opts }) {
    const site = normalizeSite(opts.site ?? await ask('Atlassian site, for example acme.atlassian.net', { def: config.atlassian.site ?? brand.atlassianSite ?? undefined }));
    if (!site) throw new Error('that is not an Atlassian site address (it looks like https://acme.atlassian.net)');
    const email = (opts.email ?? await ask('Your Atlassian email', { def: config.atlassian.email ?? undefined })).trim();
    if (!/^[^\s@"]+@[^\s@"]+\.[^\s@"]+$/.test(email)) throw new Error(`"${email}" is not an email address`);

    let token = process.env.PILOTKIT_ATLASSIAN_TOKEN?.trim() || null;
    const saved = token ? null : readToken(email);
    const same = config.atlassian.site === site && config.atlassian.email === email;
    if (!token && saved && same && !opts.newToken && await confirm('Keep the API token saved on this PC?')) token = saved;
    let me = null;
    for (let attempt = 1; attempt <= 3 && !me; attempt++) {
      if (!token) {
        info(`Create a token at ${TOKEN_PAGE}`);
        info('("Create API token", any name, then copy it). It is stored in ' + storeName() + ', never in a file you share.');
        token = await ask('Paste the API token (it stays hidden)', { hidden: true });
      }
      try {
        me = await createAtlassian({ site, email, token }).myself();
      } catch (err) {
        bad(err.status === 401 ? 'Atlassian refused this email and token: check both, or create a new token.' : err.message);
        if (err.status !== 401 || process.env.PILOTKIT_ATLASSIAN_TOKEN) throw new Error('could not reach Atlassian with these details');
        token = null;
      }
    }
    if (!me) throw new Error('Atlassian refused the token three times');
    ok(`Signed in to ${site} as ${bold(me.displayName)}`);
    if (!process.env.PILOTKIT_ATLASSIAN_TOKEN) {
      // Another account: its token goes, or remove and unlink would leave it behind.
      if (config.atlassian.email && config.atlassian.email !== email) deleteToken(config.atlassian.email);
      saveToken(email, token);
      ok(`Token saved in ${storeName()}`);
    }
    config.atlassian = { site, email };
  },

  /** For doctor: { ok, message, fix }. */
  async check(config) {
    const { site, email } = config.atlassian;
    if (!site || !email) return { ok: false, message: 'Atlassian is not set up', fix: 'Run "pilotkit add atlassian".' };
    const token = readToken(email);
    if (!token) return { ok: false, message: `No Atlassian token in ${storeName()}`, fix: 'Run "pilotkit add atlassian" to enter one.' };
    try {
      const me = await createAtlassian({ site, email, token }).myself();
      return { ok: true, message: `Atlassian ${site}: ${me.displayName}`, account: me.displayName };
    } catch (err) {
      if (err.status === 401) {
        return { ok: false, message: `Atlassian ${site} refused the email and token`, fix: 'The token expired or was revoked: run "pilotkit add atlassian --new-token".' };
      }
      return { ok: false, message: `Atlassian ${site}: ${err.message}` };
    }
  },

  forget(config) {
    deleteToken(config.atlassian.email);
    return 'Atlassian token deleted';
  },

  // Where it reads, from config.json alone (no network): the desk pages show it.
  summary: (config) => ({
    where: config.atlassian.site ? config.atlassian.site.replace(/^https:\/\//, '') : null,
    link: config.atlassian.site,
  }),

  // The desk's lines about this connector.
  desk: (config) => ({
    about: 'their Jira issues and Confluence pages',
    read: `Use the pilotkit-atlassian tools to read ${config.atlassian.site ? `the Atlassian site ${config.atlassian.site}` : 'Atlassian'}; they cannot change a ticket or a page.`,
    economy: 'prefer jira_my_issues and jira_search with a small "max"; read a page or issue only when the question needs it',
    links: 'issue and page',
  }),

  async serve() {
    const { runMcp } = await import('../atlassian/mcp.mjs');
    return runMcp();
  },
};
