import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { loadBrand, logoType } from '../brand.mjs';
import { IN_CONTAINER, PKG_DIR, VERSION, ensureHome, loadConfig, paths } from '../config.mjs';
import { addedConnectors } from '../connectors/index.mjs';
import { openDb } from './db.mjs';
import { monthReport, saveSnapshot, startSnapshots } from './month.mjs';
import { MIN_CREDITS, Runner } from './runner.mjs';

const SITE = join(PKG_DIR, 'site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const PAGES = { '/': 'index.html', '/credits': 'credits.html', '/start': 'start.html' };
// In a container, 127.0.0.1 is the container's own loopback: the desk listens on the container's network and
// compose publishes the port on the PC's 127.0.0.1 only (docker/compose.yaml). The Host check below still applies.
const BIND = IN_CONTAINER ? '0.0.0.0' : '127.0.0.1';
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const httpError = (status, message) => Object.assign(new Error(message), { status });

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw httpError(413, 'message too long');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw httpError(400, 'the body is not JSON');
  }
}

function serveFile(res, file, type) {
  res.writeHead(200, {
    'Content-Type': type, 'Content-Length': statSync(file).size, 'Cache-Control': 'no-cache',
    'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  });
  createReadStream(file).pipe(res);
}

export async function startDesk({ port: wantedPort, open = true, log = console.log } = {}) {
  ensureHome();
  const config = loadConfig();
  const brand = loadBrand();
  const port = wantedPort ?? config.desk.port;
  const db = openDb(paths.db);
  const runner = new Runner({ db, brand, config });
  await runner.start();
  const stopSnapshots = startSnapshots(db, () => runner.quota());
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  // Each connector's doctor check, for the Start page. Kept 30 s, so reloading the page does not
  // call Atlassian or Salesforce again.
  let checked = null;
  const connections = async () => {
    if (checked && Date.now() - checked.at < 30_000) return checked.list;
    const list = await Promise.all(addedConnectors(config).map(async (c) => {
      const timeout = new Promise((resolve) => setTimeout(resolve, 20_000, { ok: false, message: `${c.title} did not answer within 20 s` }).unref());
      const res = await Promise.race([c.check(config).catch((err) => ({ ok: false, message: err.message })), timeout]);
      return { id: c.id, title: c.title, ok: res.ok, message: res.message, fix: res.fix ?? null, account: res.account ?? null };
    }));
    checked = { at: Date.now(), list };
    return list;
  };

  const api = async (req, res, path) => {
    const method = req.method;
    // Only this page may spend credits: a write needs a header a cross-site form or image cannot send.
    if (method !== 'GET' && req.headers['x-pilotkit'] !== '1') throw httpError(403, 'missing X-Pilotkit header');

    if (path === '/api/state' && method === 'GET') {
      return send(res, 200, {
        version: VERSION,
        brand: { name: brand.name, product: brand.product, accent: brand.accent, welcome: brand.welcome, links: brand.links, custom: brand.custom },
        copilot: { authenticated: Boolean(runner.auth?.isAuthenticated), login: runner.auth?.login ?? null, message: runner.auth?.statusMessage ?? null },
        connectors: addedConnectors(config).map((c) => ({ id: c.id, title: c.title, server: c.server, ...c.summary(config) })),
        models: runner.modelList(),
        defaults: { model: config.desk.model, maxCredits: Math.max(MIN_CREDITS, config.desk.maxCredits), minCredits: MIN_CREDITS },
      });
    }
    if (path === '/api/connections' && method === 'GET') return send(res, 200, await connections());
    if (path === '/api/chats' && method === 'GET') {
      return send(res, 200, db.prepare(`SELECT id, title, model, status, started_at, ended_at, turns, credits FROM chats
        WHERE archived_at IS NULL ORDER BY started_at DESC LIMIT 200`).all());
    }
    if (path === '/api/chats' && method === 'POST') {
      if (!runner.auth?.isAuthenticated) throw httpError(409, 'Copilot is not signed in: run "pilotkit setup".');
      const { text, model, maxCredits } = await readJson(req);
      if (!text?.trim()) throw httpError(400, 'write a question first');
      const id = runner.create({ text: text.trim(), model: model || config.desk.model, maxCredits: Number(maxCredits) || config.desk.maxCredits });
      return send(res, 201, { id });
    }
    if (path === '/api/month' && method === 'GET') {
      saveSnapshot(db, await runner.quota());
      return send(res, 200, monthReport(db, { models: runner.modelList() }));
    }
    const m = path.match(/^\/api\/chats\/([0-9a-f-]{36})(?:\/(messages|stop|archive))?$/);
    if (m) {
      const [, id, action] = m;
      const chat = runner.chat(id);
      if (!chat) throw httpError(404, 'no such chat');
      if (!action && method === 'GET') {
        const q = (table) => db.prepare(`SELECT * FROM ${table} WHERE chat_id = ? ORDER BY seq`).all(id);
        return send(res, 200, { chat, events: q('events'), calls: q('calls'), tools: q('tools') });
      }
      if (action === 'messages' && method === 'POST') {
        const { text, model } = await readJson(req);
        if (!text?.trim()) throw httpError(400, 'write a message first');
        await runner.say(id, text.trim(), { model });
        return send(res, 202, { id });
      }
      if (action === 'stop' && method === 'POST') return send(res, 200, { stopped: await runner.abort(id) });
      if (action === 'archive' && method === 'POST') {
        db.prepare('UPDATE chats SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), id);
        await runner.release(id);
        return send(res, 200, { archived: true });
      }
    }
    throw httpError(404, 'no such API');
  };

  const server = createServer(async (req, res) => {
    try {
      // Bound to 127.0.0.1, and the Host must say so too: a web page cannot reach the desk by renaming itself.
      if (!hosts.has(req.headers.host ?? '')) throw httpError(421, 'wrong host');
      const path = new URL(req.url, 'http://x').pathname;
      if (path === '/api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        const onChange = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
        const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
        runner.events.on('change', onChange);
        req.on('close', () => {
          clearInterval(ping);
          runner.events.off('change', onChange);
        });
        return;
      }
      if (path.startsWith('/api/')) return await api(req, res, path);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'method not allowed');
      if (path === '/brand/logo') return serveFile(res, brand.logoFile, logoType(brand.logoFile));
      const rel = PAGES[path] ?? path.slice(1);
      const file = normalize(join(SITE, rel));
      if (!file.startsWith(SITE + sep) || !existsSync(file) || !statSync(file).isFile()) throw httpError(404, 'not found');
      return serveFile(res, file, TYPES[extname(file)] ?? 'application/octet-stream');
    } catch (err) {
      if (!res.headersSent) send(res, err.status ?? 500, { error: err.message });
      else res.end();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', (err) => reject(err.code === 'EADDRINUSE'
      ? new Error(`port ${port} is taken: is the desk already open? Try http://127.0.0.1:${port}/ or "pilotkit start --port <another>".`)
      : err));
    server.listen(port, BIND, resolve);
  });
  const url = `http://127.0.0.1:${port}/`;
  log(`${brand.product} is open on ${url}  (Ctrl+C to close it)`);
  if (!runner.auth?.isAuthenticated) log(`Copilot is not signed in: the desk shows your history, but run "pilotkit ${IN_CONTAINER ? 'container setup' : 'setup'}" to ask questions.`);
  if (open && !IN_CONTAINER) openBrowser(url);

  const close = async () => {
    stopSnapshots();
    server.close();
    await runner.stop();
    db.close();
  };
  return { url, close, runner, server };
}

export function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
}
