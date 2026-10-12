import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { ensureHome, paths } from './config.mjs';

// The Atlassian API token never goes into config.json or an MCP config file. It sits in the OS
// credential store and the MCP server reads it when it starts:
// - macOS: the login Keychain (`security`), the token passed on stdin, never on the command line;
// - Windows: a DPAPI blob in ~/.pilotkit, which only this Windows user on this PC can decrypt;
// - Linux: the Secret Service (`secret-tool`), or a 0600 file when there is none.
// PILOTKIT_ATLASSIAN_TOKEN overrides all of them (CI, a quick test).

const SERVICE = 'pilotkit-atlassian';
// By full path: an MCP client may start the server with a short PATH.
const SECURITY = '/usr/bin/security';

function run(cmd, args, input) {
  const res = spawnSync(cmd, args, { input, encoding: 'utf8', windowsHide: true });
  if (res.error) return { ok: false, out: '', err: res.error.message };
  return { ok: res.status === 0, out: res.stdout ?? '', err: res.stderr ?? '' };
}

// PowerShell reads the script from -EncodedCommand (UTF-16LE base64) and the secret from stdin.
function powershell(script, input) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], input);
}

const hasCommand = (cmd) => run(process.platform === 'win32' ? 'where' : 'which', [cmd]).ok;

export function storeName() {
  if (process.env.PILOTKIT_ATLASSIAN_TOKEN) return 'the PILOTKIT_ATLASSIAN_TOKEN variable';
  if (process.platform === 'darwin') return 'the macOS Keychain';
  if (process.platform === 'win32') return 'a Windows DPAPI file';
  return hasCommand('secret-tool') ? 'the Secret Service keyring' : `a private file (${paths.tokenFile})`;
}

export function saveToken(account, token) {
  if (!token || /[\r\n"]/.test(token)) throw new Error('the token is empty or has characters a token never has');
  ensureHome();
  if (process.platform === 'darwin') {
    const res = run(SECURITY, ['-i'], `add-generic-password -U -a "${account}" -s ${SERVICE} -w "${token}"\n`);
    if (!res.ok || /error/i.test(res.err)) throw new Error(`the Keychain refused the token: ${res.err.trim() || 'unknown error'}`);
    return;
  }
  if (process.platform === 'win32') {
    const res = powershell(
      '$t = [Console]::In.ReadToEnd().Trim(); ConvertTo-SecureString $t -AsPlainText -Force | ConvertFrom-SecureString',
      token,
    );
    if (!res.ok || !res.out.trim()) throw new Error(`PowerShell could not protect the token: ${res.err.trim() || 'no output'}`);
    writeFileSync(paths.tokenFile, res.out.trim() + '\n');
    return;
  }
  if (hasCommand('secret-tool')) {
    const res = run('secret-tool', ['store', '--label=pilotkit Atlassian token', 'service', SERVICE, 'account', account], token);
    if (res.ok) return;
  }
  writeFileSync(paths.tokenFile, token + '\n', { mode: 0o600 });
  chmodSync(paths.tokenFile, 0o600);
}

export function readToken(account) {
  if (process.env.PILOTKIT_ATLASSIAN_TOKEN) return process.env.PILOTKIT_ATLASSIAN_TOKEN.trim();
  if (!account) return null;
  if (process.platform === 'darwin') {
    const res = run(SECURITY, ['find-generic-password', '-a', account, '-s', SERVICE, '-w']);
    return res.ok ? res.out.trim() || null : null;
  }
  if (process.platform === 'win32') {
    if (!existsSync(paths.tokenFile)) return null;
    const res = powershell(
      '$b = [Console]::In.ReadToEnd().Trim(); $s = ConvertTo-SecureString $b; '
        + '[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))',
      readFileSync(paths.tokenFile, 'utf8'),
    );
    return res.ok ? res.out.trim() || null : null;
  }
  if (hasCommand('secret-tool')) {
    const res = run('secret-tool', ['lookup', 'service', SERVICE, 'account', account]);
    if (res.ok && res.out.trim()) return res.out.trim();
  }
  return existsSync(paths.tokenFile) ? readFileSync(paths.tokenFile, 'utf8').trim() || null : null;
}

export function deleteToken(account) {
  if (process.platform === 'darwin' && account) run(SECURITY, ['delete-generic-password', '-a', account, '-s', SERVICE]);
  if (process.platform === 'linux' && account && hasCommand('secret-tool')) {
    run('secret-tool', ['clear', 'service', SERVICE, 'account', account]);
  }
  rmSync(paths.tokenFile, { force: true });
}
