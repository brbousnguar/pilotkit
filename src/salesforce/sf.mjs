import { exec, execFile } from 'node:child_process';
import { delimiter, dirname } from 'node:path';
import { quote, runTool } from '../clients.mjs';

// pilotkit reads Salesforce through the Salesforce CLI (`sf`) and the logins it already has: it never
// sees a Salesforce password or token. Each read is one `sf … --json` run.
// - Only the read commands below run.
// - Nothing a model writes goes on the command line: a SOQL or SOSL query travels in a file
//   (--file), and names, ids and usernames must match SAFE_ARG. On Windows sf is a .cmd, which
//   Node only starts through cmd.exe, and cmd.exe would act on & | % ( ) in a query.

const win = process.platform === 'win32';
export const READ_COMMANDS = ['org list', 'data query', 'data search', 'data get record', 'sobject describe', 'sobject list'];
// Letters (any script), digits, and . _ @ : + / \ = ~ - and spaces: enough for flags, aliases,
// usernames and a temp file path, and nothing cmd.exe treats as syntax.
export const SAFE_ARG = /^[\p{L}\p{N}_.@:+/\\=~ -]+$/u;

export class SfError extends Error {
  constructor(message, name = 'SfError') {
    super(message);
    this.sfName = name;
  }
}

// A login sf can no longer use: expired, revoked, or removed with "sf org logout".
export const isLoginError = (err) => /RefreshTokenAuthError|NamedOrgNotFound|NoAuthInfoFound|AuthInfo|INVALID_SESSION_ID|NoOrgFound/i.test(err?.sfName ?? '')
  || /expired|invalid_grant|refresh token|no authorization information|INVALID_SESSION_ID/i.test(err?.message ?? '');

// The environment sf runs in: this Node first on the PATH (an npm-installed sf starts with
// "#!/usr/bin/env node", and a client may start pilotkit with a short PATH), no update notice,
// no colours.
export function sfEnv(base = process.env, extra = {}) {
  const env = { ...base, SF_SKIP_NEW_VERSION_CHECK: 'true', SF_AUTOUPDATE_DISABLE: 'true', NO_COLOR: '1', FORCE_COLOR: '0', ...extra };
  const key = Object.keys(base).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[key] = [dirname(process.execPath), base[key]].filter(Boolean).join(delimiter);
  return env;
}

export function runSf(sf, args, { env, timeoutMs = 60_000 } = {}) {
  const command = READ_COMMANDS.find((c) => args.join(' ').startsWith(`${c} `) || args.join(' ') === c);
  if (!command) return Promise.reject(new SfError(`"sf ${args.slice(0, 3).join(' ')}" is not a read command pilotkit runs`));
  const bad = args.find((a) => !SAFE_ARG.test(a));
  if (bad !== undefined) return Promise.reject(new SfError(`pilotkit does not pass "${bad}" to sf`));
  const opts = { env: sfEnv(process.env, env), timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' };
  return new Promise((resolve, reject) => {
    const done = (err, stdout = '', stderr = '') => {
      if (err?.code === 'ENOENT') return reject(new SfError(`the Salesforce CLI is not at ${sf} any more: run "pilotkit add salesforce"`, 'NoSf'));
      let json = null;
      try {
        json = JSON.parse(stdout.slice(stdout.indexOf('{')));
      } catch {
        const why = err?.killed ? `sf did not answer within ${timeoutMs / 1000} s` : (stderr || err?.message || 'sf gave no answer').trim().split('\n').slice(-2).join(' ');
        return reject(new SfError(why, 'NoJson'));
      }
      if (json.status === 0) resolve(json.result);
      else reject(new SfError(String(json.message ?? 'sf failed').trim(), json.name));
    };
    if (win) exec([sf, ...args].map(quote).join(' '), opts, done);
    else execFile(sf, args, opts, done);
  });
}

// The sf on this PC, by full path, so a client with a short PATH still finds it.
export function findSf() {
  const res = runTool(win ? 'where' : 'which', ['sf']);
  if (!res.ok) return null;
  const found = res.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return (win ? found.find((p) => /\.(cmd|exe)$/i.test(p)) : found[0]) ?? null;
}

export function sfVersion(sf) {
  const res = runTool(sf, ['--version'], { env: sfEnv() });
  return res.ok ? res.out.match(/@salesforce\/cli\/(\S+)/)?.[1] ?? res.out.trim().split('\n')[0] : null;
}

// The orgs sf is logged in to, once each, without contacting them. sf lists an org in every group it
// belongs to (a Dev Hub is also a non-scratch org), so the groups are merged.
export async function listOrgs(sf, run = runSf) {
  const res = await run(sf, ['org', 'list', '--skip-connection-status', '--json']);
  const seen = new Map();
  const kinds = [['scratchOrgs', 'scratch org'], ['sandboxes', 'sandbox'], ['devHubs', 'org'], ['nonScratchOrgs', 'org'], ['other', 'org']];
  for (const [group, kind] of kinds) {
    for (const o of res?.[group] ?? []) {
      if (!o?.username) continue;
      const was = seen.get(o.username);
      seen.set(o.username, {
        username: o.username,
        alias: was?.alias ?? (o.alias || null),
        instanceUrl: was?.instanceUrl ?? (o.instanceUrl || null),
        kind: o.isSandbox ? 'sandbox' : was?.kind ?? kind,
        isDefault: Boolean(was?.isDefault || o.isDefaultUsername),
      });
    }
  }
  return [...seen.values()];
}
