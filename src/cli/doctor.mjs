import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { loadBrand } from '../brand.mjs';
import { createAtlassian } from '../atlassian/client.mjs';
import {
  copilotRegistered, copilotVersion, parseJsonc, serverLaunch, unregisterCopilot, unregisterVSCode, vscodeRegistered, vscodeUserDirs, SERVER_NAME,
} from '../clients.mjs';
import { HOME, VERSION, loadConfig } from '../config.mjs';
import { deleteToken, readToken, storeName } from '../secrets.mjs';
import { copilotStatus, quotaLine } from './copilot.mjs';
import { bad, bold, info, ok, warn } from './ui.mjs';

const portOpen = (port) => new Promise((resolve) => {
  const s = createConnection({ port, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});

export async function doctor() {
  let failed = 0;
  const fail = (msg, fix) => { failed++; bad(msg); if (fix) info(fix); };
  const config = loadConfig();
  const brand = loadBrand();
  console.log(`\n${bold(`pilotkit ${VERSION} doctor`)}  (${HOME})\n`);

  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 13)) ok(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node} is too old`, 'Install Node 22.13 or newer (nodejs.org, LTS).');

  ok(`Brand: ${brand.product}${brand.custom ? '' : ' (default)'}`);

  const cli = copilotVersion();
  if (cli) ok(`Copilot CLI ${cli}`);
  else warn('Copilot CLI not found: "npm install -g @github/copilot" adds it.');

  const status = await copilotStatus();
  if (status.authenticated) {
    ok(`Copilot signed in as ${status.login ?? 'you'}`);
    const quota = quotaLine(status.quota);
    if (quota) info(quota);
  } else fail(`Copilot not signed in${status.message ? ` (${status.message})` : ''}`, 'Run "copilot login", or "pilotkit setup".');

  const { site, email } = config.atlassian;
  if (!site || !email) fail('Atlassian is not set up', 'Run "pilotkit setup".');
  else {
    const token = readToken(email);
    if (!token) fail(`No Atlassian token in ${storeName()}`, 'Run "pilotkit setup" to enter one.');
    else {
      try {
        const me = await createAtlassian({ site, email, token }).myself();
        ok(`Atlassian ${site}: ${me.displayName}`);
      } catch (err) {
        fail(`Atlassian ${site}: ${err.message}`);
      }
    }
  }

  const launch = serverLaunch();
  if (cli) {
    if (copilotRegistered()) ok('The Copilot CLI knows the pilotkit tools');
    else fail('The Copilot CLI does not know the pilotkit tools', 'Run "pilotkit setup".');
  }
  for (const dir of vscodeUserDirs()) {
    if (!vscodeRegistered(dir)) {
      fail(`VS Code (${dir}) does not know the pilotkit tools`, 'Run "pilotkit setup".');
      continue;
    }
    // A Node upgrade or a move of the global npm folder leaves the old paths behind.
    const entry = parseJsonc(readFileSync(join(dir, 'mcp.json'), 'utf8')).servers[SERVER_NAME];
    const stale = entry.command !== 'npx' && (!existsSync(entry.command) || !existsSync(entry.args?.[0] ?? ''));
    if (stale) fail(`VS Code starts pilotkit from a path that is gone (${entry.command})`, 'Run "pilotkit setup" again.');
    else ok(`VS Code knows the pilotkit tools${entry.command === launch.command ? '' : ' (from another install)'}`);
  }

  const port = config.desk.port;
  if (await portOpen(port)) info(`Something listens on ${port}: the desk is open, or "pilotkit start --port <n>" picks another port.`);
  else ok(`Port ${port} is free for the desk`);

  console.log(failed ? `\n${failed} problem(s).` : '\nAll good.');
  return failed ? 1 : 0;
}

export async function unlink({ purge = false } = {}) {
  const { email } = loadConfig().atlassian;
  if (unregisterCopilot()) ok('Removed from the Copilot CLI');
  for (const dir of vscodeUserDirs()) if (unregisterVSCode(dir)) ok(`Removed from VS Code (${dir})`);
  deleteToken(email);
  ok('Atlassian token deleted');
  if (purge) {
    rmSync(HOME, { recursive: true, force: true });
    ok(`Deleted ${HOME} (settings, brand and desk history)`);
  } else {
    info(`Settings and desk history stay in ${HOME}; "pilotkit unlink --purge" deletes them.`);
  }
  return 0;
}

