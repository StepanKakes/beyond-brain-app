/**
 * Beyond Brain — what was said, searchable.
 *
 * The brain remembers clients; nothing remembered the conversations with the
 * agent itself. A chat, a Telegram question, a scheduled run: each was a JSONL
 * file somewhere and none could be asked "co jsme minulý týden řešili u Petra".
 *
 * This is the cheapest possible answer: every message that passes through the
 * SDK goes into SQLite, full-text indexed, and one tool searches it. No
 * embeddings, no model call, a few milliseconds. The transcript is the memory
 * of last resort; the curated files stay the memory of first resort.
 *
 * Derived data, kept out of git. It can be rebuilt from nothing and losing it
 * costs recall, not truth.
 */
import { getConnection } from '../modules/database/connection.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS beyond_sessions (
  id         TEXT PRIMARY KEY,
  source     TEXT NOT NULL,
  label      TEXT,
  user       TEXT,
  started_at TEXT NOT NULL,
  last_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_beyond_sessions_last ON beyond_sessions(last_at DESC);

CREATE TABLE IF NOT EXISTS beyond_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  tool_name  TEXT,
  ts         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_beyond_messages_session ON beyond_messages(session_id, id);

CREATE VIRTUAL TABLE IF NOT EXISTS beyond_messages_fts USING fts5(
  content, tool_name, content='beyond_messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS beyond_messages_ai AFTER INSERT ON beyond_messages BEGIN
  INSERT INTO beyond_messages_fts(rowid, content, tool_name) VALUES (new.id, new.content, new.tool_name);
END;
CREATE TRIGGER IF NOT EXISTS beyond_messages_ad AFTER DELETE ON beyond_messages BEGIN
  INSERT INTO beyond_messages_fts(beyond_messages_fts, rowid, content, tool_name) VALUES ('delete', old.id, old.content, old.tool_name);
END;
`;

const RETENTION_DAYS = 180;
const MAX_CONTENT = 20_000;

let ready = false;
function db() {
  const conn = getConnection();
  if (!ready) {
    conn.exec(SCHEMA);
    ready = true;
  }
  return conn;
}

/** Make sure a session row exists and bump its last activity. */
export function touchSession({ id, source, label = null, user = null }) {
  if (!id) return;
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO beyond_sessions (id, source, label, user, started_at, last_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_at=excluded.last_at,
                                     label=COALESCE(excluded.label, beyond_sessions.label),
                                     user=COALESCE(excluded.user, beyond_sessions.user)`,
    )
    .run(id, source, label, user, now, now);
}

/** Store one message. Tool calls are stored as role 'tool' with a short input. */
export function record({ sessionId, role, content, toolName = null }) {
  if (!sessionId || !content) return;
  const text = String(content).slice(0, MAX_CONTENT);
  if (!text.trim()) return;
  db()
    .prepare(`INSERT INTO beyond_messages (session_id, role, content, tool_name, ts) VALUES (?, ?, ?, ?, ?)`)
    .run(sessionId, role, text, toolName, new Date().toISOString());
  db().prepare('UPDATE beyond_sessions SET last_at=? WHERE id=?').run(new Date().toISOString(), sessionId);
}

/** Turn a loose query into FTS5 syntax without letting it blow up. */
function ftsQuery(q) {
  const raw = String(q || '').trim();
  if (!raw) return null;
  // Keep quoted phrases, OR / NOT, prefix*; quote everything else per token.
  const tokens = raw.match(/"[^"]+"|\S+/g) || [];
  return tokens
    .map((t) => {
      if (/^"[^"]+"$/.test(t)) return t;
      if (/^(OR|NOT|AND)$/i.test(t)) return t.toUpperCase();
      const star = t.endsWith('*');
      const clean = t.replace(/[^\p{L}\p{N}]/gu, '');
      if (!clean) return null;
      if (star) return `"${clean}"*`;
      // Czech declines everything, so "miniatura" must also find "miniaturu"
      // and "Kuba" must find "Kubou". No stemmer here; the crude version is
      // to drop the trailing vowels and prefix-match the stem.
      if (clean.length >= 4) {
        const stem = clean.replace(/[aeiouyáéěíóúůý]{1,2}$/iu, '');
        if (stem.length >= 3) return `"${stem}"*`;
      }
      return `"${clean}"`;
    })
    .filter(Boolean)
    .join(' ');
}

/**
 * Search across sessions. Returns the best hits grouped by session with a
 * little context around each, newest first.
 */
export function search({ query, limit = 8, roles = ['user', 'assistant'], sessionId = null } = {}) {
  const fq = ftsQuery(query);
  if (!fq) return [];
  const conn = db();
  const roleSql = roles?.length ? `AND m.role IN (${roles.map(() => '?').join(',')})` : '';
  const sessionSql = sessionId ? 'AND m.session_id=?' : '';
  let rows;
  try {
    rows = conn
      .prepare(
        `SELECT m.id, m.session_id, m.role, m.ts, m.tool_name,
                snippet(beyond_messages_fts, 0, '«', '»', ' … ', 24) AS snip,
                bm25(beyond_messages_fts) AS rank
           FROM beyond_messages_fts f
           JOIN beyond_messages m ON m.id = f.rowid
          WHERE beyond_messages_fts MATCH ? ${roleSql} ${sessionSql}
          ORDER BY rank LIMIT ?`,
      )
      .all(fq, ...(roles || []), ...(sessionId ? [sessionId] : []), limit * 3);
  } catch (err) {
    return [{ error: `dotaz se nedá vyhodnotit: ${err?.message || err}` }];
  }

  // One best hit per session, then a small window around it.
  const bySession = new Map();
  for (const r of rows) {
    if (!bySession.has(r.session_id)) bySession.set(r.session_id, r);
    if (bySession.size >= limit) break;
  }
  const out = [];
  for (const hit of bySession.values()) {
    const session = conn.prepare('SELECT * FROM beyond_sessions WHERE id=?').get(hit.session_id);
    const around = conn
      .prepare(
        `SELECT id, role, ts, tool_name, substr(content, 1, 400) AS content
           FROM beyond_messages WHERE session_id=? AND id BETWEEN ? AND ? ORDER BY id`,
      )
      .all(hit.session_id, hit.id - 2, hit.id + 2);
    out.push({
      sessionId: hit.session_id,
      source: session?.source || null,
      label: session?.label || null,
      at: hit.ts,
      snippet: hit.snip,
      around,
    });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Read one session, or a window around a message id. */
export function readSession(sessionId, { aroundId = null, window = 10, limit = 60 } = {}) {
  const conn = db();
  const session = conn.prepare('SELECT * FROM beyond_sessions WHERE id=?').get(sessionId);
  if (!session) return null;
  const rows = aroundId
    ? conn
        .prepare(`SELECT id, role, ts, tool_name, substr(content, 1, 1500) AS content FROM beyond_messages WHERE session_id=? AND id BETWEEN ? AND ? ORDER BY id`)
        .all(sessionId, Number(aroundId) - window, Number(aroundId) + window)
    : conn
        .prepare(`SELECT id, role, ts, tool_name, substr(content, 1, 1500) AS content FROM beyond_messages WHERE session_id=? ORDER BY id DESC LIMIT ?`)
        .all(sessionId, limit)
        .reverse();
  return { session: { id: session.id, source: session.source, label: session.label, startedAt: session.started_at, lastAt: session.last_at }, messages: rows };
}

export function recentSessions({ limit = 15, source = null } = {}) {
  const conn = db();
  return source
    ? conn.prepare('SELECT * FROM beyond_sessions WHERE source=? ORDER BY last_at DESC LIMIT ?').all(source, limit)
    : conn.prepare('SELECT * FROM beyond_sessions ORDER BY last_at DESC LIMIT ?').all(limit);
}

/** Drop old sessions so the file does not grow for ever. */
export function pruneHistory() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const conn = db();
  const old = conn.prepare('SELECT id FROM beyond_sessions WHERE last_at < ?').all(cutoff);
  if (!old.length) return 0;
  const del = conn.prepare('DELETE FROM beyond_messages WHERE session_id=?');
  const delS = conn.prepare('DELETE FROM beyond_sessions WHERE id=?');
  const tx = conn.transaction((ids) => {
    for (const { id } of ids) {
      del.run(id);
      delS.run(id);
    }
  });
  tx(old);
  return old.length;
}
