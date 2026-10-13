import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Everything pilotkit keeps lives in one folder: ~/.pilotkit on every OS. PILOTKIT_HOME moves it
// (tests, or a second profile on the same machine).
export const HOME = resolve(process.env.PILOTKIT_HOME || join(homedir(), '.pilotkit'));
export const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = join(PKG_DIR, 'bin', 'pilotkit.mjs');
export const VERSION = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')).version;
export const DEFAULT_PORT = 8717;
// Set by the image in docker/: the desk runs in a container, and the Copilot clients live on the PC outside it.
export const IN_CONTAINER = process.env.PILOTKIT_CONTAINER === '1';

export const paths = {
  config: join(HOME, 'config.json'),
  brand: join(HOME, 'brand'),
  db: join(HOME, 'desk.db'),
  // The working directory of desk sessions: empty on purpose, the desk reads the connected systems, not files.
  workspace: join(HOME, 'workspace'),
  tokenFile: join(HOME, 'atlassian.token'),
};

export function ensureHome() {
  mkdirSync(HOME, { recursive: true });
  mkdirSync(paths.workspace, { recursive: true });
}

const DEFAULTS = {
  atlassian: { site: null, email: null },
  // sf: full path of the Salesforce CLI; orgs: the ones pilotkit may read ({ username, alias, instanceUrl, kind }).
  salesforce: { sf: null, orgs: [], defaultOrg: null },
  desk: { port: DEFAULT_PORT, model: 'auto', maxCredits: 60 },
};

export function loadConfig() {
  let saved = {};
  if (existsSync(paths.config)) {
    try {
      saved = JSON.parse(readFileSync(paths.config, 'utf8'));
    } catch (err) {
      throw new Error(`${paths.config} is not valid JSON (${err.message}). Fix it or run "pilotkit setup" again.`);
    }
  }
  return {
    // The connectors this PC added. A 0.2 config has none listed but may have Atlassian set up.
    connectors: Array.isArray(saved.connectors) ? saved.connectors : saved.atlassian?.site ? ['atlassian'] : [],
    atlassian: { ...DEFAULTS.atlassian, ...saved.atlassian },
    salesforce: { ...DEFAULTS.salesforce, ...saved.salesforce, orgs: Array.isArray(saved.salesforce?.orgs) ? saved.salesforce.orgs : [] },
    desk: { ...DEFAULTS.desk, ...saved.desk },
  };
}

export function saveConfig(config) {
  ensureHome();
  const tmp = `${paths.config}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, paths.config);
  try {
    chmodSync(paths.config, 0o600);
  } catch {
    // Windows has no POSIX modes; the file sits in the user's profile.
  }
}

// https://acme.atlassian.net, acme.atlassian.net/jira/... → https://acme.atlassian.net
export function normalizeSite(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  return `https://${url.host.toLowerCase()}`;
}
