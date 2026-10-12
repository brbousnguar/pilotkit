import { CopilotClient } from '@github/copilot-sdk';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { TOOLS } from '../atlassian/tools.mjs';
import { BIN, HOME, paths } from '../config.mjs';
import { DESK_SERVER, deskPolicy } from './policy.mjs';

const TURN_TIMEOUT_MS = 10 * 60 * 1000;
const IDLE_MS = 15 * 60 * 1000;
// Copilot refuses a session credit limit under 30.
export const MIN_CREDITS = 30;
const now = () => new Date().toISOString();
const clip = (s, n) => (s == null ? null : s.length > n ? `${s.slice(0, n)}…` : s);

// What the MCP server needs to find its config and the OS credential store, whether the runtime
// merges this with its own environment or uses it alone.
const PASS_ENV = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'TEMP', 'TMP',
  'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'DBUS_SESSION_BUS_ADDRESS', 'PILOTKIT_ATLASSIAN_TOKEN'];
function mcpEnv() {
  const env = { PILOTKIT_HOME: HOME };
  for (const k of PASS_ENV) if (process.env[k]) env[k] = process.env[k];
  return env;
}

export function deskGuide({ brand, site }) {
  return `You are the ${brand.product} assistant. You help consultants with their Jira issues and Confluence pages.
Use the pilotkit tools to read ${site ? `the Atlassian site ${site}` : 'Atlassian'}; they only read, so you cannot change a ticket or a page: when the user wants a change, write the comment, description or update for them to paste.
Every model call is billed in AI credits and re-sends the whole conversation, so be economical:
- call independent tools in the same step, not one per message;
- prefer jira_my_issues and jira_search with a small "max"; read a page or issue only when the question needs it;
- stop as soon as you can answer; do not announce what you are about to do.
Link every issue and page you mention, as Markdown links. Answer in the language of the user, short, with tables for lists.`;
}

// A chat is one Copilot session. Its turns, the model calls of each turn (with their credits) and
// its tool calls are recorded as they happen, and the page follows them through `events`.
export class Runner {
  constructor({ db, brand, config }) {
    this.db = db;
    this.brand = brand;
    this.config = config;
    this.events = new EventEmitter();
    this.events.setMaxListeners(100);
    this.live = new Map();
    this.models = [];
    this.auth = null;
  }

  async start() {
    this.client = new CopilotClient({ logLevel: 'error' });
    await this.client.start();
    this.auth = await this.client.getAuthStatus();
    if (!this.auth?.isAuthenticated) return;
    this.models = await this.client.listModels();
  }

  async stop() {
    for (const { session } of this.live.values()) await session.abort().catch(() => {});
    await this.client?.stop().catch(() => {});
  }

  // `auto` lets Copilot pick a model per call and has no price of its own; every call records the model it used.
  modelList() {
    return this.models
      .filter((m) => m.id === 'auto' || m.billing?.tokenPrices)
      .map((m) => ({ id: m.id, name: m.name ?? m.id, prices: m.billing?.tokenPrices ?? null }));
  }

  async quota() {
    try {
      const q = await this.client.rpc.account.getQuota({});
      return q.quotaSnapshots?.premium_interactions ?? null;
    } catch {
      return null;
    }
  }

  // Fallback when a call carries no Copilot cost: the model's published price per batch of tokens.
  estimate(model, d) {
    const p = this.models.find((m) => m.id === model)?.billing?.tokenPrices;
    if (!p) return 0;
    const cacheRead = d.cacheReadTokens ?? 0;
    const cacheWrite = d.cacheWriteTokens ?? 0;
    const fresh = Math.max(0, (d.inputTokens ?? 0) - cacheRead - cacheWrite);
    return (fresh * p.inputPrice + cacheRead * (p.cacheReadPrice ?? p.cachePrice ?? 0)
      + cacheWrite * (p.cacheWritePrice || p.inputPrice) + (d.outputTokens ?? 0) * p.outputPrice) / (p.batchSize ?? 1e6);
  }

  chat(id) {
    return this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
  }

  create({ text, model, maxCredits }) {
    const id = randomUUID();
    const title = clip(text.replace(/\s+/g, ' ').trim(), 80);
    this.db.prepare(`INSERT INTO chats (id, title, model, status, started_at, max_credits) VALUES (?, ?, ?, 'running', ?, ?)`)
      .run(id, title, model, now(), Math.max(MIN_CREDITS, maxCredits));
    this.notify(id, 'chat');
    this.turn(id, text).catch((err) => this.fail(id, err));
    return id;
  }

  async say(id, text, { model } = {}) {
    const chat = this.chat(id);
    if (!chat) throw Object.assign(new Error('not found'), { status: 404 });
    if (chat.status === 'running' || chat.status === 'stopping') throw Object.assign(new Error('an answer is still running'), { status: 409 });
    this.db.prepare(`UPDATE chats SET status = 'running', error = NULL WHERE id = ?`).run(id);
    this.notify(id, 'chat');
    (async () => {
      if (model && model !== chat.model) {
        const live = await this.session(id);
        await live.session.setModel(model);
        this.db.prepare('UPDATE chats SET model = ? WHERE id = ?').run(model, id);
      }
      await this.turn(id, text);
    })().catch((err) => this.fail(id, err));
  }

  async session(id) {
    const existing = this.live.get(id);
    if (existing) return existing;
    const chat = this.chat(id);
    const max = (table) => this.db.prepare(`SELECT COALESCE(MAX(seq), 0) n FROM ${table} WHERE chat_id = ?`).get(id).n;
    const live = { session: null, turn: chat.turns, callSeq: max('calls'), toolSeq: max('tools'), eventSeq: max('events'), timer: null };
    const config = {
      model: chat.model,
      streaming: true,
      workingDirectory: paths.workspace,
      skipCustomInstructions: true,
      systemMessage: { mode: 'append', content: deskGuide({ brand: this.brand, site: this.config.atlassian.site }) },
      mcpServers: {
        [DESK_SERVER]: {
          type: 'local',
          command: process.execPath,
          args: [BIN, 'mcp'],
          env: mcpEnv(),
          workingDirectory: paths.workspace,
          tools: ['*'],
        },
      },
      availableTools: TOOLS.map((t) => `${DESK_SERVER}-${t.name}`),
      sessionLimits: { maxAiCredits: chat.max_credits },
      onPermissionRequest: deskPolicy((req, reason) => this.refused(id, live, req, reason)),
    };
    live.session = chat.session_id
      ? await this.client.resumeSession(chat.session_id, { ...config, suppressResumeEvent: true })
      : await this.client.createSession(config);
    this.live.set(id, live);
    this.db.prepare('UPDATE chats SET session_id = ? WHERE id = ?').run(live.session.sessionId, id);
    live.session.on((e) => this.record(id, live, e));
    return live;
  }

  async turn(id, prompt) {
    const live = await this.session(id);
    clearTimeout(live.timer);
    live.turn += 1;
    this.db.prepare(`UPDATE chats SET status = 'running', turns = ?, ended_at = NULL WHERE id = ?`).run(live.turn, id);
    this.addEvent(id, live, 'user', prompt);
    let error = null;
    try {
      await live.session.sendAndWait({ prompt }, TURN_TIMEOUT_MS);
    } catch (err) {
      error = err;
    }
    const stopped = this.chat(id)?.status === 'stopping';
    if (error && !stopped) this.addEvent(id, live, 'error', String(error.message ?? error));
    if (stopped) this.addEvent(id, live, 'stopped', 'Stopped by you.');
    this.db.prepare(`UPDATE chats SET status = 'ready', ended_at = ?, error = ? WHERE id = ?`)
      .run(now(), error && !stopped ? clip(String(error.message ?? error), 1000) : null, id);
    live.timer = setTimeout(() => this.release(id), IDLE_MS);
    this.notify(id, 'chat');
  }

  // The session stays on disk and is resumed by the next message.
  async release(id) {
    const live = this.live.get(id);
    if (!live) return;
    this.live.delete(id);
    await live.session.disconnect().catch(() => {});
  }

  record(id, live, e) {
    const d = e.data ?? {};
    switch (e.type) {
      case 'assistant.usage': {
        // Copilot reports what each model call cost in nano AI units: 1e9 of them make one credit.
        const reported = d.copilotUsage?.totalNanoAiu != null;
        const credits = reported ? d.copilotUsage.totalNanoAiu / 1e9 : this.estimate(d.model, d);
        this.db.prepare(`INSERT INTO calls (chat_id, seq, turn, at, model, prompt_tokens, cache_read, output_tokens, credits, estimated, duration_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, ++live.callSeq, live.turn, now(), d.model ?? null, d.inputTokens ?? 0, d.cacheReadTokens ?? 0,
            d.outputTokens ?? 0, credits, reported ? 0 : 1, Math.round(d.duration ?? 0));
        this.db.prepare('UPDATE chats SET calls = calls + 1, credits = credits + ? WHERE id = ?').run(credits, id);
        this.notify(id, 'call');
        break;
      }
      case 'assistant.message_delta':
        if (!d.parentToolCallId && d.deltaContent) this.events.emit('change', { chatId: id, kind: 'delta', text: d.deltaContent });
        break;
      case 'assistant.message':
        if (d.toolRequests?.length) {
          this.db.prepare('UPDATE calls SET tools = ? WHERE chat_id = ? AND seq = ?')
            .run(d.toolRequests.map((t) => t.name).join(', '), id, live.callSeq);
        }
        if (d.content?.trim() && !d.parentToolCallId) this.addEvent(id, live, 'assistant', d.content);
        break;
      case 'tool.execution_start':
        this.db.prepare(`INSERT INTO tools (chat_id, call_id, seq, turn, at, name, args) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(chat_id, call_id) DO UPDATE SET name = excluded.name, args = excluded.args`)
          .run(id, d.toolCallId, ++live.toolSeq, live.turn, now(), d.mcpToolName ?? d.toolName ?? null,
            clip(JSON.stringify(d.arguments ?? {}), 2000));
        this.db.prepare('UPDATE chats SET tool_calls = tool_calls + 1 WHERE id = ?').run(id);
        this.notify(id, 'tool');
        break;
      case 'tool.execution_complete': {
        const content = d.result?.content ?? d.error?.message ?? '';
        this.db.prepare(`UPDATE tools SET success = ?, result_chars = ?,
          duration_ms = CAST((julianday(?) - julianday(at)) * 86400000 AS INTEGER) WHERE chat_id = ? AND call_id = ?`)
          .run(d.success ? 1 : 0, content.length, now(), id, d.toolCallId);
        this.notify(id, 'tool');
        break;
      }
      case 'session.error':
        this.addEvent(id, live, 'error', d.message ?? JSON.stringify(d));
        break;
    }
  }

  refused(id, live, req, reason) {
    const callId = req.toolCallId ?? `refused-${live.toolSeq + 1}`;
    this.db.prepare(`INSERT OR REPLACE INTO tools (chat_id, call_id, seq, turn, at, name, refused) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, callId, ++live.toolSeq, live.turn, now(), req.kind === 'mcp' ? req.toolName : req.kind, reason);
    this.notify(id, 'tool');
  }

  addEvent(id, live, kind, text) {
    this.db.prepare('INSERT INTO events (chat_id, seq, turn, at, kind, text) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, ++live.eventSeq, live.turn, now(), kind, text);
    this.notify(id, 'event');
  }

  fail(id, err) {
    const chat = this.chat(id);
    const status = chat?.session_id ? 'ready' : 'failed';
    this.db.prepare(`UPDATE chats SET status = ?, ended_at = ?, error = ? WHERE id = ?`)
      .run(status, now(), clip(String(err?.message ?? err), 1000), id);
    if (status === 'failed') this.release(id);
    this.notify(id, 'chat');
  }

  async abort(id) {
    const live = this.live.get(id);
    if (!live || this.chat(id)?.status !== 'running') return false;
    this.db.prepare(`UPDATE chats SET status = 'stopping' WHERE id = ?`).run(id);
    this.notify(id, 'chat');
    await live.session.abort();
    return true;
  }

  notify(chatId, kind) {
    this.events.emit('change', { chatId, kind });
  }
}
