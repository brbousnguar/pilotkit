import { existsSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { loadBrand } from '../brand.mjs';
import { copilotRegistered, copilotVersion, serverLaunch, vscodeEntry, vscodeUserDirs } from '../clients.mjs';
import { CONNECTORS, addedConnectors, offeredConnectors } from '../connectors/index.mjs';
import { HOME, IN_CONTAINER, VERSION, loadConfig, saveConfig } from '../config.mjs';
import { copilotStatus, quotaLine } from './copilot.mjs';
import { unregisterAll } from './setup.mjs';
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
  } else fail(`Copilot not signed in${status.message ? ` (${status.message})` : ''}`, IN_CONTAINER ? 'Run "pilotkit container setup" on the PC.' : 'Run "copilot login", or "pilotkit setup".');

  const connectors = addedConnectors(config);
  if (!connectors.length) fail('No system is connected', IN_CONTAINER ? 'Run "pilotkit container setup" on the PC.' : `Run "pilotkit setup", or "pilotkit add <${offeredConnectors().map((c) => c.id).join('|')}>".`);
  const dirs = IN_CONTAINER ? [] : vscodeUserDirs();
  for (const c of connectors) {
    const res = await c.check(config);
    if (res.ok) ok(res.message);
    else fail(res.message, res.fix);

    const launch = serverLaunch(c.id);
    const oldName = (has) => c.replaces.find((name) => has(name));
    if (cli && !IN_CONTAINER) {
      const known = copilotRegistered(c.server);
      const old = known ? null : oldName(copilotRegistered);
      if (known) ok(`The Copilot CLI knows ${c.server}`);
      else if (old) {
        warn(`The Copilot CLI has ${c.title} under its old name "${old}": it works, but run "pilotkit setup" to rename it ${c.server}.`);
      } else fail(`The Copilot CLI does not know ${c.server}`, `Run "pilotkit add ${c.id}".`);
    }
    for (const dir of dirs) {
      const old = vscodeEntry(dir, c.server) ? null : oldName((name) => vscodeEntry(dir, name));
      const entry = vscodeEntry(dir, c.server) ?? (old && vscodeEntry(dir, old));
      if (!entry) {
        fail(`VS Code (${dir}) does not know ${c.server}`, `Run "pilotkit add ${c.id}".`);
        continue;
      }
      // A Node upgrade or a move of the global npm folder leaves the old paths behind.
      const stale = entry.command !== 'npx' && (!existsSync(entry.command) || !existsSync(entry.args?.[0] ?? ''));
      if (stale) fail(`VS Code starts ${c.server} from a path that is gone (${entry.command})`, 'Run "pilotkit setup" again.');
      else if (old) warn(`VS Code has ${c.title} under its old name "${old}": it works, but run "pilotkit setup" to rename it ${c.server}.`);
      else ok(`VS Code knows ${c.server}${entry.command === launch.command ? '' : ' (from another install)'}`);
    }
  }

  const port = config.desk.port;
  if (IN_CONTAINER) info('In a container: the Copilot CLI and VS Code on your PC are checked by "pilotkit doctor" there.');
  else if (await portOpen(port)) info(`Something listens on ${port}: the desk is open, or "pilotkit start --port <n>" picks another port.`);
  else ok(`Port ${port} is free for the desk`);

  console.log(failed ? `\n${failed} problem(s).` : '\nAll good.');
  return failed ? 1 : 0;
}

export async function unlink({ purge = false } = {}) {
  const config = loadConfig();
  unregisterAll();
  for (const c of CONNECTORS.filter((x) => x.configured(config))) {
    const forgot = c.forget(config);
    if (forgot) ok(forgot);
  }
  config.connectors = [];
  saveConfig(config);
  if (purge) {
    rmSync(HOME, { recursive: true, force: true });
    ok(`Deleted ${HOME} (settings, brand and desk history)`);
  } else {
    info(`Settings and desk history stay in ${HOME}; "pilotkit unlink --purge" deletes them.`);
  }
  return 0;
}
