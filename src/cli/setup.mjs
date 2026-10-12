import { installBrand, loadBrand } from '../brand.mjs';
import { createAtlassian } from '../atlassian/client.mjs';
import { copilotVersion, registerCopilot, registerVSCode, runTool, serverLaunch, vscodeUserDirs } from '../clients.mjs';
import { DEFAULT_PORT, loadConfig, normalizeSite, saveConfig } from '../config.mjs';
import { readToken, saveToken, storeName } from '../secrets.mjs';
import { copilotStatus, quotaLine } from './copilot.mjs';
import { ask, bad, bold, confirm, dim, info, ok, step, warn } from './ui.mjs';

const TOKEN_PAGE = 'https://id.atlassian.com/manage-profile/security/api-tokens';
const TOTAL = 4;

export async function setup(opts) {
  const config = loadConfig();
  let brand = loadBrand();
  if (opts.brand) {
    brand = await installBrand(opts.brand);
    console.log(`Brand pack applied: ${bold(brand.product)}`);
  }
  console.log(`\n${bold(`${brand.product} setup`)} ${dim('— GitHub Copilot + Jira and Confluence on this PC')}`);

  // 1. Copilot: the CLI (it also opens the Copilot app), then a signed-in account.
  step(1, TOTAL, 'GitHub Copilot');
  let cli = copilotVersion();
  if (!cli && !opts.skipCopilot) {
    warn('The GitHub Copilot CLI is not installed. It signs you in, and it also opens the Copilot app.');
    if (await confirm('Install it now with "npm install -g @github/copilot"?')) {
      runTool('npm', ['install', '-g', '@github/copilot'], { inherit: true });
      cli = copilotVersion();
    }
  }
  if (cli) ok(`Copilot CLI ${cli}`);
  else warn('No Copilot CLI: the desk still works if you are signed in with the GitHub CLI (gh auth login).');

  let status = await copilotStatus();
  if (!status.authenticated && cli) {
    info('Sign in with the GitHub account that holds your Copilot seat. A browser page asks for a short code.');
    runTool('copilot', ['login'], { inherit: true });
    status = await copilotStatus();
  }
  if (status.authenticated) {
    ok(`Signed in to Copilot as ${bold(status.login ?? 'you')}${status.models ? ` · ${status.models} models available` : ''}`);
    const quota = quotaLine(status.quota);
    if (quota) info(quota);
  } else {
    bad(`Copilot is not signed in${status.message ? `: ${status.message}` : ''}.`);
    info('Run "copilot login" (or "gh auth login"), then "pilotkit setup" again.');
  }

  // 2. Atlassian: site, email, API token; checked against Jira before anything is saved.
  step(2, TOTAL, 'Jira and Confluence');
  const site = normalizeSite(opts.site ?? await ask('Atlassian site, for example acme.atlassian.net', { def: config.atlassian.site ?? brand.atlassianSite ?? undefined }));
  if (!site) throw new Error('that is not an Atlassian site address (it looks like https://acme.atlassian.net)');
  const email = (opts.email ?? await ask('Your Atlassian email', { def: config.atlassian.email ?? undefined })).trim();
  if (!/^[^\s@"]+@[^\s@"]+\.[^\s@"]+$/.test(email)) throw new Error(`"${email}" is not an email address`);

  let token = process.env.PILOTKIT_ATLASSIAN_TOKEN?.trim() || null;
  const saved = token ? null : readToken(email);
  if (!token && saved && config.atlassian.site === site && !opts.newToken && await confirm('Keep the API token saved on this PC?')) token = saved;
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
      bad(err.message);
      if (err.status !== 401 || process.env.PILOTKIT_ATLASSIAN_TOKEN) throw new Error('could not reach Atlassian with these details');
      token = null;
    }
  }
  if (!me) throw new Error('Atlassian refused the token three times');
  ok(`Signed in to ${site} as ${bold(me.displayName)}`);
  if (!process.env.PILOTKIT_ATLASSIAN_TOKEN) {
    saveToken(email, token);
    ok(`Token saved in ${storeName()}`);
  }
  config.atlassian = { site, email };
  config.desk.port = opts.port ?? config.desk.port ?? DEFAULT_PORT;
  saveConfig(config);

  // 3. The clients: the Copilot CLI and VS Code.
  step(3, TOTAL, 'Copilot clients');
  const launch = serverLaunch();
  if (launch.viaNpx) {
    warn('You ran pilotkit through npx, so the clients start it with npx each time (slower).');
    info('For a faster, stable setup: npm install -g pilotkit, then pilotkit setup.');
  }
  if (cli && !opts.skipCopilot) {
    try {
      registerCopilot(launch);
      ok('Copilot CLI: pilotkit tools added (check with "copilot mcp list")');
    } catch (err) {
      bad(`Copilot CLI: ${err.message}`);
    }
  }
  const dirs = opts.skipVscode ? [] : vscodeUserDirs();
  if (!dirs.length && !opts.skipVscode) info('VS Code not found on this PC: skipped.');
  for (const dir of dirs) {
    try {
      const res = registerVSCode(dir, launch);
      ok(`VS Code: pilotkit added to ${res.file}`);
      if (res.hadComments) info(`Comments in that file were not kept; the original is in ${res.backup}`);
    } catch (err) {
      bad(`VS Code (${dir}): ${err.message}`);
    }
  }

  // 4. What to do next.
  step(4, TOTAL, 'Ready');
  const port = config.desk.port;
  console.log(`
  ${bold('pilotkit start')}   opens the ${brand.product} on http://127.0.0.1:${port}/
                   chat about your tickets, and see the AI credits of every answer
  ${bold('VS Code')}          open Copilot Chat, choose Agent, ask "what are my open Jira tickets?"
                   (VS Code asks once to trust the pilotkit server)
  ${bold('copilot')}          the same question in a terminal; "copilot app" opens the Copilot app
  ${bold('pilotkit doctor')}  checks all of this again
`);
}
