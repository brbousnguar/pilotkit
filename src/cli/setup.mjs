import { installBrand, loadBrand } from '../brand.mjs';
import {
  copilotVersion, registerCopilot, registerVSCode, runTool, serverLaunch, unregisterCopilot, unregisterVSCode, vscodeUserDirs,
} from '../clients.mjs';
import { CONNECTORS, addedConnectors, findConnector, markAdded, markRemoved, offeredConnector } from '../connectors/index.mjs';
import { DEFAULT_PORT, IN_CONTAINER, loadConfig, saveConfig } from '../config.mjs';
import { copilotStatus, quotaLine } from './copilot.mjs';
import { bad, bold, confirm, dim, info, ok, step, warn } from './ui.mjs';

// `pilotkit setup` signs in to Copilot, then sets up the connectors this PC already has (Jira and
// Confluence on a first run) and registers each one with the Copilot clients.
export async function setup(opts) {
  const config = loadConfig();
  let brand = loadBrand();
  if (opts.brand) {
    brand = await installBrand(opts.brand);
    console.log(`Brand pack applied: ${bold(brand.product)}`);
  }
  const added = addedConnectors(config);
  const connectors = added.length ? added : [findConnector('atlassian')];
  const total = connectors.length + 3;
  console.log(`\n${bold(`${brand.product} setup`)} ${dim(`— GitHub Copilot + ${connectors.map((c) => c.title).join(' + ')} on this PC`)}`);

  // 1. Copilot: the CLI (it also opens the Copilot app), then a signed-in account.
  step(1, total, 'GitHub Copilot');
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
    info(IN_CONTAINER ? 'Run "pilotkit container setup" again.' : 'Run "copilot login" (or "gh auth login"), then "pilotkit setup" again.');
  }

  // 2. Each connector: its account and credentials, checked before anything is saved.
  let n = 1;
  for (const c of connectors) {
    step(++n, total, c.title);
    await c.setup(config, { brand, opts });
    markAdded(config, c);
    saveConfig(config);
  }
  config.desk.port = opts.port ?? config.desk.port ?? DEFAULT_PORT;
  saveConfig(config);

  // 3. The clients: the Copilot CLI and VS Code. A container has neither: they live on the PC.
  step(++n, total, 'Copilot clients');
  registerClients(connectors, { cli, opts });

  // 4. What to do next.
  step(++n, total, 'Ready');
  const port = config.desk.port;
  if (IN_CONTAINER) {
    console.log(`
  ${bold('pilotkit container up')}   starts the ${brand.product} in its container, on http://127.0.0.1:${Number(process.env.PILOTKIT_PORT) || port}/ of this PC
`);
    return;
  }
  console.log(`
  ${bold('pilotkit start')}   opens the ${brand.product} on http://127.0.0.1:${port}/
                   chat about ${connectors.map((c) => c.title).join(' and ')}, and see the AI credits of every answer
  ${bold('VS Code')}          open Copilot Chat, choose Agent, ask "${connectors[0].example}"
                   (VS Code asks once to trust each pilotkit server)
  ${bold('copilot')}          the same question in a terminal; "copilot app" opens the Copilot app
  ${bold('pilotkit doctor')}  checks all of this again
`);
}

// `pilotkit add <connector>`: its credentials, then its server in the Copilot clients.
export async function add(id, opts) {
  const c = offeredConnector(id);
  const config = loadConfig();
  const brand = loadBrand();
  console.log(`\n${bold(`Add ${c.title}`)} ${dim(`— the ${c.server} tools for Copilot on this PC`)}`);
  await c.setup(config, { brand, opts });
  markAdded(config, c);
  saveConfig(config);
  const cli = copilotVersion();
  if (!cli && !opts.skipCopilot) warn('No Copilot CLI on this PC: run "pilotkit setup" to install it and sign in.');
  registerClients([c], { cli, opts });
  console.log(`\n  ${bold('pilotkit start')} opens the desk; restart it if it is already open.\n`);
}

// `pilotkit remove <connector>`: out of the Copilot clients and its credentials deleted. Its
// settings stay, so adding it again only asks for what is missing.
export async function remove(id) {
  const c = findConnector(id);
  const config = loadConfig();
  unregisterClients(c);
  const forgot = c.forget(config);
  if (forgot) ok(forgot);
  markRemoved(config, c);
  saveConfig(config);
  info(`Its settings stay in config.json; "pilotkit add ${c.id}" brings it back.`);
  return 0;
}

export function registerClients(connectors, { cli, opts }) {
  if (IN_CONTAINER) {
    info('In a container: the Copilot CLI and VS Code on your PC have their own setup ("pilotkit setup" on the PC).');
    return;
  }
  const dirs = opts.skipVscode ? [] : vscodeUserDirs();
  if (!dirs.length && !opts.skipVscode) info('VS Code not found on this PC: skipped.');
  let npxNoted = false;
  for (const c of connectors) {
    const launch = serverLaunch(c.id);
    if (launch.viaNpx && !npxNoted) {
      npxNoted = true;
      warn('You ran pilotkit through npx, so the clients start it with npx each time (slower).');
      info('For a faster, stable setup: npm install -g pilotkit, then pilotkit setup.');
    }
    if (cli && !opts.skipCopilot) {
      try {
        const gone = registerCopilot(c.server, launch, { replaces: c.replaces });
        ok(`Copilot CLI: ${c.server} added (check with "copilot mcp list")`);
        if (gone.length) info(`Removed the old "${gone.join('", "')}" entry it replaces.`);
      } catch (err) {
        bad(`Copilot CLI: ${err.message}`);
      }
    }
    for (const dir of dirs) {
      try {
        const res = registerVSCode(dir, c.server, launch, { replaces: c.replaces });
        ok(`VS Code: ${c.server} added to ${res.file}`);
        if (res.replaced.length) info(`Removed the old "${res.replaced.join('", "')}" entry it replaces.`);
        if (res.hadComments) info(`Comments in that file were not kept; the original is in ${res.backup}`);
      } catch (err) {
        bad(`VS Code (${dir}): ${err.message}`);
      }
    }
  }
}

// A connector's server and the old names it replaced, out of both clients.
export function unregisterClients(c) {
  if (IN_CONTAINER) return;
  for (const name of [c.server, ...c.replaces]) {
    if (unregisterCopilot(name)) ok(`Removed ${name} from the Copilot CLI`);
    for (const dir of vscodeUserDirs()) if (unregisterVSCode(dir, name)) ok(`Removed ${name} from VS Code (${dir})`);
  }
}

// Every server pilotkit may have registered, whether this PC added it or not.
export function unregisterAll() {
  for (const c of CONNECTORS) unregisterClients(c);
}
