import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { BIN, VERSION } from './config.mjs';

// Registers the pilotkit MCP server with the Copilot clients on this PC:
// - the Copilot CLI, through `copilot mcp add` (it writes ~/.copilot/mcp-config.json);
// - VS Code (and VS Code Insiders), in the user's mcp.json, so every workspace gets the tools.

export const SERVER_NAME = 'pilotkit';
const win = process.platform === 'win32';

// npm installs CLIs as .cmd shims on Windows, which Node only starts through a shell. Arguments are
// fixed words and file paths here, so quoting each one is enough.
const quote = (a) => (/^[\w./:=@\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);

export function runTool(cmd, args = [], { inherit = false, env } = {}) {
  const opts = { encoding: 'utf8', windowsHide: true, env: env ?? process.env, stdio: inherit ? 'inherit' : 'pipe' };
  const res = win
    ? spawnSync([cmd, ...args].map(quote).join(' '), { ...opts, shell: true })
    : spawnSync(cmd, args, opts);
  if (res.error) return { ok: false, status: null, out: '', err: res.error.message };
  return { ok: res.status === 0, status: res.status, out: res.stdout ?? '', err: res.stderr ?? '' };
}

// How a client starts the server. A global install runs this Node with this file, so it works
// even when the client's PATH does not know npm. An npx run lives in a cache npm may clear,
// so it registers an npx command instead.
export function serverLaunch() {
  if (BIN.includes(`${sep}_npx${sep}`)) return { command: 'npx', args: ['-y', `pilotkit@${VERSION}`, 'mcp'], viaNpx: true };
  return { command: stableNode(), args: [BIN, 'mcp'], viaNpx: false };
}

// Homebrew's Node runs from a folder named after its version (…/Cellar/node@24/24.21.0/bin/node),
// which the next upgrade deletes; the opt/ link next to it follows upgrades.
export function stableNode(execPath = process.execPath) {
  const m = execPath.match(/^(.*)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/);
  const opt = m && `${m[1]}/opt/${m[2]}/bin/node`;
  return opt && existsSync(opt) ? opt : execPath;
}

// ---- Copilot CLI ----

export function copilotVersion() {
  const res = runTool('copilot', ['--version']);
  return res.ok ? (res.out.match(/\d+\.\d+\.\d+/)?.[0] ?? res.out.trim()) : null;
}

export function copilotRegistered() {
  return runTool('copilot', ['mcp', 'get', SERVER_NAME]).ok;
}

export function registerCopilot(launch = serverLaunch()) {
  if (copilotRegistered()) runTool('copilot', ['mcp', 'remove', SERVER_NAME]);
  const res = runTool('copilot', ['mcp', 'add', SERVER_NAME, '--', launch.command, ...launch.args]);
  if (!res.ok) throw new Error((res.err || res.out).trim() || `copilot mcp add exited with ${res.status}`);
}

export function unregisterCopilot() {
  return copilotRegistered() && runTool('copilot', ['mcp', 'remove', SERVER_NAME]).ok;
}

// ---- VS Code ----

export function vscodeUserDirs() {
  if (process.env.PILOTKIT_VSCODE_USER_DIR) return [process.env.PILOTKIT_VSCODE_USER_DIR];
  const base = win ? process.env.APPDATA
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
      : (process.env.XDG_CONFIG_HOME || join(homedir(), '.config'));
  if (!base) return [];
  return ['Code', 'Code - Insiders'].map((p) => join(base, p, 'User')).filter((d) => existsSync(d));
}

// mcp.json is JSONC: comments and trailing commas are allowed. Strip both outside strings, then parse.
export function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1') || '{}');
}

function readMcpJson(file) {
  if (!existsSync(file)) return { data: { servers: {} }, hadComments: false };
  const text = readFileSync(file, 'utf8');
  return { data: text.trim() ? parseJsonc(text) : {}, hadComments: /\/\/|\/\*/.test(text.replace(/"(?:[^"\\]|\\.)*"/g, '""')) };
}

export function vscodeRegistered(dir) {
  try {
    return Boolean(readMcpJson(join(dir, 'mcp.json')).data.servers?.[SERVER_NAME]);
  } catch {
    return false;
  }
}

/** Adds or replaces the pilotkit entry. Returns where the original file was copied, if it existed. */
export function registerVSCode(dir, launch = serverLaunch()) {
  const file = join(dir, 'mcp.json');
  const { data, hadComments } = readMcpJson(file);
  let backup = null;
  if (existsSync(file)) {
    backup = `${file}.pilotkit-backup`;
    copyFileSync(file, backup);
  }
  data.servers ??= {};
  data.servers[SERVER_NAME] = { type: 'stdio', command: launch.command, args: launch.args };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return { file, backup, hadComments };
}

export function unregisterVSCode(dir) {
  const file = join(dir, 'mcp.json');
  if (!existsSync(file)) return false;
  const { data } = readMcpJson(file);
  if (!data.servers?.[SERVER_NAME]) return false;
  copyFileSync(file, `${file}.pilotkit-backup`);
  delete data.servers[SERVER_NAME];
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return true;
}
