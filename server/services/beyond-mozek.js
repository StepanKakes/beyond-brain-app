/**
 * Beyond Brain — proposed changes to the brain's own rules.
 *
 * The skills in `.claude/skills/` and the rules in `system/` are what the
 * agent is. Letting it rewrite them freely would be letting it rewrite itself
 * without anyone watching; never letting it touch them means it never learns
 * from the corrections it sees every day.
 *
 * So: the agent proposes, a person decides. A proposal is a full "after" text
 * for one file, with the "before" it was based on and one sentence of why.
 * The velín shows the diff, one click applies it (commit and push), one click
 * drops it. If the file moved on since the proposal was made, applying fails
 * loudly instead of clobbering.
 *
 * Same shape as the message queue on purpose: one place where things leave
 * the agent's hands, one gesture to let them through.
 */
import fs from 'node:fs';
import path from 'node:path';

import { getConnection } from '../modules/database/connection.js';
import { resolveBrainPath } from '../utils/brain-path.js';
import { commitBrain } from './beyond-git.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS beyond_mozek (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  before     TEXT,
  after      TEXT NOT NULL,
  reason     TEXT,
  source     TEXT,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  error      TEXT
);
CREATE INDEX IF NOT EXISTS idx_mozek_status ON beyond_mozek(status, created_at DESC);
`;

/** What the agent may propose to change. Everything else is off limits. */
const ALLOWED = [
  { prefix: '.claude/skills/', kind: 'skill' },
  { prefix: 'system/', kind: 'system' },
];
const FORBIDDEN = ['system/pamet-agenta.md', 'system/tim.md', 'system/ulohy.json'];
const MAX_PENDING = 20;

let ready = false;
function db() {
  const conn = getConnection();
  if (!ready) {
    conn.exec(SCHEMA);
    ready = true;
  }
  return conn;
}

function normalizePath(p) {
  const rel = String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
  if (rel.includes('..')) throw new Error('cesta nesmí obsahovat ..');
  if (!rel.endsWith('.md')) throw new Error('měnit jde jen markdown (.md)');
  if (FORBIDDEN.includes(rel)) throw new Error(`${rel} se mění jinak (paměť nástrojem pamet, úlohy nástrojem beyond_schedule)`);
  const rule = ALLOWED.find((a) => rel.startsWith(a.prefix));
  if (!rule) throw new Error(`návrh smí mířit jen do .claude/skills/ nebo system/, ne do ${rel}`);
  return { rel, kind: rule.kind };
}

export function readBrainFile(p) {
  const { rel } = normalizePath(p);
  try {
    return fs.readFileSync(path.join(resolveBrainPath(), rel), 'utf8');
  } catch {
    return null;
  }
}

export function listSkills() {
  const dir = path.join(resolveBrainPath(), '.claude', 'skills');
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        const desc = /^description:\s*(.+)$/m.exec(text)?.[1] || '';
        return { name: f.replace(/\.md$/, ''), path: `.claude/skills/${f}`, description: desc.slice(0, 200) };
      });
  } catch {
    return [];
  }
}

/**
 * Stage a change. `before` is what the agent saw; `after` is the whole new
 * file. A patch (old/new string) is turned into `after` here so the queue
 * only ever holds full texts, which is what makes the diff honest.
 */
export function propose({ path: p, after = null, patch = null, reason, source = 'agent' }) {
  const { rel, kind } = normalizePath(p);
  const current = readBrainFile(rel);
  let next = after;
  if (patch) {
    if (current == null) throw new Error(`${rel} neexistuje, patch nejde, pošli celý obsah`);
    const { oldString, newString } = patch;
    if (!oldString) throw new Error('patch potřebuje old_string');
    const count = current.split(oldString).length - 1;
    if (count === 0) throw new Error('old_string v souboru není (přesná shoda včetně mezer)');
    if (count > 1) throw new Error(`old_string sedí ${count}×, upřesni ho`);
    next = current.replace(oldString, newString ?? '');
  }
  if (typeof next !== 'string' || !next.trim()) throw new Error('výsledný obsah je prázdný');
  if (next === current) throw new Error('žádná změna');
  if (!reason || !String(reason).trim()) throw new Error('reason chybí: jedna věta, proč');

  const conn = db();
  const pending = conn.prepare(`SELECT COUNT(*) AS n FROM beyond_mozek WHERE status='pending'`).get().n;
  if (pending >= MAX_PENDING) throw new Error(`už čeká ${pending} návrhů, nejdřív ať je někdo projde`);
  const dup = conn.prepare(`SELECT id FROM beyond_mozek WHERE status='pending' AND path=? AND after=?`).get(rel, next);
  if (dup) return { id: dup.id, duplicate: true };

  const info = conn
    .prepare(
      `INSERT INTO beyond_mozek (path, kind, before, after, reason, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(rel, kind, current, next, String(reason).trim().slice(0, 500), String(source).slice(0, 120), new Date().toISOString());
  return { id: Number(info.lastInsertRowid), path: rel, kind };
}

export function listProposals({ status = 'pending', limit = 50 } = {}) {
  return db()
    .prepare('SELECT * FROM beyond_mozek WHERE status=? ORDER BY created_at DESC LIMIT ?')
    .all(status, limit)
    .map(shape);
}

export function countPending() {
  return db().prepare(`SELECT COUNT(*) AS n FROM beyond_mozek WHERE status='pending'`).get().n;
}

export function getProposal(id) {
  const row = db().prepare('SELECT * FROM beyond_mozek WHERE id=?').get(id);
  return row ? shape(row) : null;
}

/** Apply: write the file, commit, push. Refuses if the file changed meanwhile. */
export async function approve(id, who) {
  const row = db().prepare('SELECT * FROM beyond_mozek WHERE id=?').get(id);
  if (!row) throw new Error('návrh neexistuje');
  if (row.status !== 'pending') throw new Error(`návrh už je ${row.status}`);
  const current = readBrainFile(row.path);
  if ((row.before ?? null) !== (current ?? null)) {
    db().prepare(`UPDATE beyond_mozek SET error=? WHERE id=?`).run('soubor se mezitím změnil, návrh je zastaralý', id);
    throw new Error('soubor se mezitím změnil, návrh je zastaralý. Zahoď ho a nech vytvořit nový.');
  }
  const abs = path.join(resolveBrainPath(), row.path);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, row.after, 'utf8');
  const git = await commitBrain(`${row.kind === 'skill' ? 'Skill' : 'Systém'}: ${path.basename(row.path)} (schválil ${who})\n\n${row.reason || ''}`.trim(), {
    paths: [row.path],
  });
  db()
    .prepare(`UPDATE beyond_mozek SET status='approved', decided_at=?, decided_by=?, error=? WHERE id=?`)
    .run(new Date().toISOString(), who, git.note, id);
  return { ok: true, git };
}

export function reject(id, who) {
  const info = db()
    .prepare(`UPDATE beyond_mozek SET status='rejected', decided_at=?, decided_by=? WHERE id=? AND status='pending'`)
    .run(new Date().toISOString(), who, id);
  if (!info.changes) throw new Error('návrh neexistuje nebo už je rozhodnutý');
  return { ok: true };
}

function shape(row) {
  return {
    id: row.id,
    path: row.path,
    kind: row.kind,
    before: row.before,
    after: row.after,
    reason: row.reason,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    error: row.error,
  };
}
