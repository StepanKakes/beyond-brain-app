/**
 * Beyond Brain — prepared messages waiting for one click.
 *
 * This is the piece that turns the agent from something that writes into the
 * brain into something that acts. It never sends on its own: it writes a draft,
 * says who it is for and why, and waits.
 *
 * The one rule everything else follows from: **the approved text is sent
 * verbatim.** No model sees it again between the click and the wire. If the
 * text could change after you read it, reading it was pointless.
 */
import { getConnection } from '../modules/database/connection.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS beyond_proposals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,
  client_slug  TEXT,
  client_name  TEXT,
  channel      TEXT NOT NULL,
  target       TEXT,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  original_body TEXT NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TEXT NOT NULL,
  created_by   TEXT,
  decided_at   TEXT,
  decided_by   TEXT,
  sent_at      TEXT,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON beyond_proposals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_client ON beyond_proposals(client_slug, status);
`;

/** A draft older than this was written about a situation that has moved on. */
const EXPIRE_AFTER_HOURS = 48;

let ready = false;

function db() {
  const conn = getConnection();
  if (!ready) {
    conn.exec(SCHEMA);
    ready = true;
  }
  return conn;
}

function shape(row) {
  return {
    id: row.id,
    kind: row.kind,
    clientSlug: row.client_slug,
    clientName: row.client_name,
    channel: row.channel,
    target: row.target,
    title: row.title,
    body: row.body,
    originalBody: row.original_body,
    edited: row.body !== row.original_body,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    sentAt: row.sent_at,
    error: row.error,
  };
}

/**
 * Queue a draft.
 *
 * Refuses when the same client already has something waiting: two unanswered
 * messages queued for one person is how an assistant turns into a nuisance, and
 * whoever clicks should never have to work out which of two drafts supersedes
 * the other.
 */
export function createProposal({
  kind,
  clientSlug = null,
  clientName = null,
  channel,
  target = null,
  title,
  body,
  reason = null,
  createdBy = 'agent',
}) {
  if (!body || !body.trim()) throw new Error('Návrh bez textu');
  if (clientSlug) {
    const existing = db()
      .prepare(`SELECT id FROM beyond_proposals WHERE client_slug=? AND status='pending'`)
      .get(clientSlug);
    if (existing) {
      return { skipped: 'u klienta už něco čeká', existingId: existing.id };
    }
  }
  const info = db()
    .prepare(
      `INSERT INTO beyond_proposals
        (kind, client_slug, client_name, channel, target, title, body, original_body, reason, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      kind,
      clientSlug,
      clientName,
      channel,
      target,
      title,
      body.trim(),
      body.trim(),
      reason,
      new Date().toISOString(),
      createdBy,
    );
  return { id: Number(info.lastInsertRowid) };
}

export function listProposals({ status = 'pending', limit = 50 } = {}) {
  expireStale();
  const rows =
    status === 'all'
      ? db().prepare('SELECT * FROM beyond_proposals ORDER BY created_at DESC LIMIT ?').all(limit)
      : db()
          .prepare('SELECT * FROM beyond_proposals WHERE status=? ORDER BY created_at DESC LIMIT ?')
          .all(status, limit);
  return rows.map(shape);
}

export function getProposal(id) {
  const row = db().prepare('SELECT * FROM beyond_proposals WHERE id=?').get(id);
  return row ? shape(row) : null;
}

export function countPending() {
  expireStale();
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM beyond_proposals WHERE status='pending'`)
    .get();
  return row?.n || 0;
}

/** Edit the text before sending. Keeps the original so the diff is visible. */
export function editProposal(id, body, who) {
  if (!body || !body.trim()) throw new Error('Text nesmí být prázdný');
  const p = getProposal(id);
  if (!p) throw new Error('Návrh neexistuje');
  if (p.status !== 'pending') throw new Error(`Návrh je ve stavu ${p.status}`);
  db()
    .prepare('UPDATE beyond_proposals SET body=?, decided_by=? WHERE id=?')
    .run(body.trim(), who || null, id);
  return getProposal(id);
}

export function rejectProposal(id, who) {
  const p = getProposal(id);
  if (!p) throw new Error('Návrh neexistuje');
  db()
    .prepare(`UPDATE beyond_proposals SET status='rejected', decided_at=?, decided_by=? WHERE id=?`)
    .run(new Date().toISOString(), who || null, id);
  return getProposal(id);
}

export function markSent(id, who) {
  db()
    .prepare(
      `UPDATE beyond_proposals SET status='sent', decided_at=COALESCE(decided_at, ?), decided_by=COALESCE(?, decided_by), sent_at=? WHERE id=?`,
    )
    .run(new Date().toISOString(), who || null, new Date().toISOString(), id);
  return getProposal(id);
}

export function markFailed(id, error) {
  db()
    .prepare(`UPDATE beyond_proposals SET status='failed', error=? WHERE id=?`)
    .run(String(error).slice(0, 1000), id);
  return getProposal(id);
}

/**
 * Drop drafts nobody acted on. A nudge written two days ago is about a
 * situation that has moved, and sending it late is worse than not sending it.
 */
export function expireStale() {
  const cutoff = new Date(Date.now() - EXPIRE_AFTER_HOURS * 3600_000).toISOString();
  db()
    .prepare(`UPDATE beyond_proposals SET status='expired' WHERE status='pending' AND created_at < ?`)
    .run(cutoff);
}

/** Slugs that already have something waiting, so a job can skip them. */
export function slugsWithPending() {
  const rows = db()
    .prepare(`SELECT DISTINCT client_slug FROM beyond_proposals WHERE status='pending' AND client_slug IS NOT NULL`)
    .all();
  return new Set(rows.map((r) => r.client_slug));
}

/** Was anything sent to this client in the last N hours? Keeps nudges apart. */
export function sentRecently(clientSlug, hours = 72) {
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  const row = db()
    .prepare(`SELECT id FROM beyond_proposals WHERE client_slug=? AND status='sent' AND sent_at > ?`)
    .get(clientSlug, cutoff);
  return Boolean(row);
}
