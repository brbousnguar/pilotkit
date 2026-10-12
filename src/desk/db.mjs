import { DatabaseSync } from 'node:sqlite';

// One SQLite file in ~/.pilotkit holds the conversations of the desk and what each one cost:
// a chat has turns, a turn has model calls (with their credits) and tool calls. It also keeps the
// readings of the Copilot allowance that the Credits page plans the month with.

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      session_id TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      turns INTEGER NOT NULL DEFAULT 0,
      calls INTEGER NOT NULL DEFAULT 0,
      tool_calls INTEGER NOT NULL DEFAULT 0,
      credits REAL NOT NULL DEFAULT 0,
      max_credits INTEGER NOT NULL,
      error TEXT,
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      chat_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      turn INTEGER NOT NULL,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT,
      PRIMARY KEY (chat_id, seq)
    );
    CREATE TABLE IF NOT EXISTS calls (
      chat_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      turn INTEGER NOT NULL,
      at TEXT NOT NULL,
      model TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      credits REAL NOT NULL DEFAULT 0,
      -- 1 when Copilot sent no cost for the call and the credits come from the model's published prices
      estimated INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      tools TEXT,
      PRIMARY KEY (chat_id, seq)
    );
    CREATE TABLE IF NOT EXISTS tools (
      chat_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      turn INTEGER NOT NULL,
      at TEXT NOT NULL,
      name TEXT,
      args TEXT,
      success INTEGER,
      result_chars INTEGER,
      duration_ms INTEGER,
      refused TEXT,
      PRIMARY KEY (chat_id, call_id)
    );
    CREATE INDEX IF NOT EXISTS calls_at ON calls (at);
    -- The Copilot allowance as GitHub reported it, every 10 minutes while the desk runs (month.mjs)
    CREATE TABLE IF NOT EXISTS quota_snapshots (
      at TEXT PRIMARY KEY,
      used REAL NOT NULL,
      entitlement REAL NOT NULL
    );
  `);
  // A desk that stopped mid-turn left chats "running"; nothing runs them any more.
  db.prepare(`UPDATE chats SET status = 'ready' WHERE status IN ('running', 'stopping')`).run();
  return db;
}

export function creditsReport(db, days = 30) {
  const sum = (where, ...args) => db.prepare(`SELECT COALESCE(SUM(credits), 0) credits, COUNT(*) calls FROM calls WHERE ${where}`).get(...args);
  return {
    today: sum(`date(at, 'localtime') = date('now', 'localtime')`),
    month: sum(`strftime('%Y-%m', at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')`),
    total: sum('1 = 1'),
    byDay: db.prepare(`SELECT date(at, 'localtime') day, SUM(credits) credits, COUNT(*) calls FROM calls
      WHERE at >= datetime('now', ?) GROUP BY day ORDER BY day`).all(`-${days} days`),
    byModel: db.prepare(`SELECT COALESCE(model, '?') model, SUM(credits) credits, COUNT(*) calls,
      SUM(prompt_tokens) prompt_tokens, SUM(output_tokens) output_tokens FROM calls
      WHERE at >= datetime('now', ?) GROUP BY model ORDER BY credits DESC`).all(`-${days} days`),
    topChats: db.prepare(`SELECT id, title, credits, turns, started_at FROM chats WHERE started_at >= datetime('now', ?)
      ORDER BY credits DESC LIMIT 10`).all(`-${days} days`),
  };
}
