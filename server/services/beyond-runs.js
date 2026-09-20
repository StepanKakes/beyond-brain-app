/**
 * Beyond Brain — the agent's run log.
 *
 * An agent that works on its own is only acceptable if you can see exactly what
 * it did. Every scheduled run lands here with what triggered it, what it
 * changed in the brain (as a git diff stat, so the claim is verifiable rather
 * than self-reported) and what it cost.
 *
 * This is also the kill switch: a job can be paused, and the whole scheduler
 * can be paused, from one place.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { getConnection } from '../modules/database/connection.js';
import { resolveBrainPath } from '../utils/brain-path.js';

const execFileAsync = promisify(execFile);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS beyond_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job           TEXT NOT NULL,
  trigger_kind  TEXT NOT NULL,
  trigger_detail TEXT,
  status        TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  duration_ms   INTEGER,
  summary       TEXT,
  changed       TEXT,
  error         TEXT,
  session_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_beyond_runs_started ON beyond_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_beyond_runs_job ON beyond_runs(job, started_at DESC);

CREATE TABLE IF NOT EXISTS beyond_job_state (
  job        TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_cursor TEXT
);
`;

let ready = false;

function db() {
  const conn = getConnection();
  if (!ready) {
    conn.exec(SCHEMA);
    ready = true;
  }
  return conn;
}

/** Head commit of the brain repo, used to diff what a run changed. */
async function brainHead() {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: resolveBrainPath(),
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * What changed in the brain between two points, as a short stat.
 * Includes uncommitted work, because the agent writes files and a human (or
 * the sync job) commits them later.
 */
async function brainDiff(sinceHead) {
  const cwd = resolveBrainPath();
  const lines = [];
  try {
    if (sinceHead) {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', '--stat', `${sinceHead}..HEAD`],
        { cwd },
      );
      if (stdout.trim()) lines.push(stdout.trim());
    }
    const { stdout: dirty } = await execFileAsync('git', ['status', '--short'], { cwd });
    if (dirty.trim()) lines.push(dirty.trim());
  } catch {
    return null;
  }
  return lines.length ? lines.join('\n').slice(0, 4000) : null;
}

/** Open a run. Returns a handle the caller finishes or fails. */
export async function startRun({ job, triggerKind, triggerDetail = null }) {
  const startedAt = new Date().toISOString();
  const headBefore = await brainHead();
  const info = db()
    .prepare(
      `INSERT INTO beyond_runs (job, trigger_kind, trigger_detail, status, started_at)
       VALUES (?, ?, ?, 'running', ?)`,
    )
    .run(job, triggerKind, triggerDetail, startedAt);
  const id = Number(info.lastInsertRowid);
  const t0 = Date.now();

  return {
    id,
    async finish({ summary = null, sessionId = null } = {}) {
      const changed = await brainDiff(headBefore);
      db()
        .prepare(
          `UPDATE beyond_runs
             SET status='ok', finished_at=?, duration_ms=?, summary=?, changed=?, session_id=?
           WHERE id=?`,
        )
        .run(new Date().toISOString(), Date.now() - t0, summary, changed, sessionId, id);
      return { id, changed };
    },
    async fail(err) {
      const message = err instanceof Error ? err.message : String(err);
      db()
        .prepare(
          `UPDATE beyond_runs
             SET status='error', finished_at=?, duration_ms=?, error=?
           WHERE id=?`,
        )
        .run(new Date().toISOString(), Date.now() - t0, message.slice(0, 2000), id);
      return { id, error: message };
    },
    async skip(reason) {
      db()
        .prepare(
          `UPDATE beyond_runs
             SET status='skipped', finished_at=?, duration_ms=?, summary=?
           WHERE id=?`,
        )
        .run(new Date().toISOString(), Date.now() - t0, reason, id);
      return { id, skipped: reason };
    },
  };
}

export function listRuns({ limit = 40, job = null } = {}) {
  const rows = job
    ? db()
        .prepare('SELECT * FROM beyond_runs WHERE job=? ORDER BY started_at DESC LIMIT ?')
        .all(job, limit)
    : db().prepare('SELECT * FROM beyond_runs ORDER BY started_at DESC LIMIT ?').all(limit);
  return rows.map((r) => ({
    id: r.id,
    job: r.job,
    trigger: { kind: r.trigger_kind, detail: r.trigger_detail },
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    summary: r.summary,
    changed: r.changed,
    error: r.error,
  }));
}

/** A job is on unless someone turned it off. */
export function isJobEnabled(job) {
  const row = db().prepare('SELECT enabled FROM beyond_job_state WHERE job=?').get(job);
  return row ? Boolean(row.enabled) : true;
}

export function setJobEnabled(job, enabled) {
  db()
    .prepare(
      `INSERT INTO beyond_job_state (job, enabled) VALUES (?, ?)
       ON CONFLICT(job) DO UPDATE SET enabled=excluded.enabled`,
    )
    .run(job, enabled ? 1 : 0);
}

export function markJobRan(job, cursor = null) {
  db()
    .prepare(
      `INSERT INTO beyond_job_state (job, last_run_at, last_cursor) VALUES (?, ?, ?)
       ON CONFLICT(job) DO UPDATE SET last_run_at=excluded.last_run_at,
                                      last_cursor=COALESCE(excluded.last_cursor, beyond_job_state.last_cursor)`,
    )
    .run(job, new Date().toISOString(), cursor);
}

export function getJobState(job) {
  const row = db().prepare('SELECT * FROM beyond_job_state WHERE job=?').get(job);
  return {
    job,
    enabled: row ? Boolean(row.enabled) : true,
    lastRunAt: row?.last_run_at || null,
    lastCursor: row?.last_cursor || null,
  };
}

/**
 * Close out runs that were in flight when the process died.
 *
 * The service restarts on every deploy, so a job caught mid-run leaves a row
 * that says "běží" for ever. The Agent screen would show a phantom job and the
 * operator would wait for something that is never coming back.
 */
export function reapOrphanedRuns() {
  const info = db()
    .prepare(
      `UPDATE beyond_runs
          SET status='error',
              finished_at=?,
              error='Služba se restartovala během běhu, výsledek není známý'
        WHERE status='running'`,
    )
    .run(new Date().toISOString());
  if (info.changes) {
    console.log(`[runs] ${info.changes} nedokončených běhů uzavřeno po restartu`);
  }
  return info.changes;
}

/** Did this job already run today (local time)? Used by the daily jobs. */
export function ranToday(job) {
  const state = getJobState(job);
  if (!state.lastRunAt) return false;
  const last = new Date(state.lastRunAt);
  const now = new Date();
  return (
    last.getFullYear() === now.getFullYear() &&
    last.getMonth() === now.getMonth() &&
    last.getDate() === now.getDate()
  );
}
