import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { DEFAULT_PORT, PKG_DIR, loadConfig } from '../config.mjs';
import { bad, bold, info, ok } from './ui.mjs';

// `pilotkit container <action>` runs the desk in a container built from docker/ in this package, with
// Docker (Docker Desktop) or, when there is none, Podman. Each action is one or two compose commands.
export const COMPOSE_FILE = join(PKG_DIR, 'docker', 'compose.yaml');
export const ACTIONS = ['setup', 'up', 'down', 'status', 'logs', 'run'];

const BASE = ['compose', '-f', COMPOSE_FILE, '-p', 'pilotkit'];

export function composeCommands(action, rest = []) {
  const base = BASE;
  const run = [...base, 'run', '--rm', 'desk', 'pilotkit'];
  return {
    setup: [[...base, 'build', 'desk'], [...run, 'setup', ...rest]],
    up: [[...base, 'up', '-d', '--build', 'desk']],
    down: [[...base, 'down']],
    status: [[...base, 'ps']],
    logs: [[...base, 'logs', '--tail', '200', ...rest]],
    run: [[...run, ...rest]],
  }[action];
}

const answers = (cmd) => spawnSync(cmd, ['compose', 'version'], { stdio: 'ignore', windowsHide: true }).status === 0;
export const findEngine = (has = answers) => ['docker', 'podman'].find(has) ?? null;

const portOpen = (port) => new Promise((resolve) => {
  const s = createConnection({ port, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});

// --port and --no-open belong to "up"; everything else after the action goes to compose or to pilotkit in the container.
export function containerArgs(argv) {
  const [action, ...more] = argv;
  const rest = [];
  let port;
  let open = true;
  for (let i = 0; i < more.length; i++) {
    if (action === 'up' && more[i] === '--port') port = Number(more[++i]);
    else if (action === 'up' && more[i] === '--no-open') open = false;
    else rest.push(more[i]);
  }
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new Error('--port needs a port number');
  return { action, rest, port, open };
}

export async function container(argv) {
  const { action, rest, port: wanted, open } = containerArgs(argv);
  if (!ACTIONS.includes(action)) throw new Error(`"pilotkit container ${action ?? ''}": use ${ACTIONS.join(', ')}`);
  const engine = findEngine();
  if (!engine) throw new Error('Docker or Podman is needed: install Docker Desktop (or Podman Desktop), start it, and try again.');
  const port = wanted ?? loadConfig().desk.port ?? DEFAULT_PORT;
  const env = { ...process.env, PILOTKIT_PORT: String(port) };

  // Something else on the port, not this desk's own container: "pilotkit start", most likely.
  if (action === 'up' && await portOpen(port)) {
    const ours = spawnSync(engine, [...BASE, 'port', 'desk', String(port)], { env, encoding: 'utf8', windowsHide: true }).stdout?.trim();
    if (!ours?.endsWith(`:${port}`)) throw new Error(`port ${port} is taken: is "pilotkit start" open? Close it, or use "pilotkit container up --port <n>".`);
  }
  for (const args of composeCommands(action, rest)) {
    const res = spawnSync(engine, args, { stdio: 'inherit', env });
    if (res.error) throw new Error(`${engine} did not start: ${res.error.message}`);
    if (res.status !== 0) return res.status ?? 1;
  }
  if (action !== 'up') return 0;

  // Docker opens the port before the desk listens behind it, so wait for an answer, not a connection.
  const url = `http://127.0.0.1:${port}/`;
  const ready = () => fetch(`${url}api/state`).then((r) => r.ok, () => false);
  for (let i = 0; i < 60 && !(await ready()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await ready())) {
    bad(`The desk did not answer on ${url} after 30 s.`);
    info('"pilotkit container logs" shows what it said.');
    return 1;
  }
  ok(`The desk runs in its container on ${bold(url)}`);
  info('"pilotkit container down" stops it; your chats and settings stay in its volume.');
  if (open) (await import('../desk/server.mjs')).openBrowser(url);
  return 0;
}
