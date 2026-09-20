/**
 * Beyond Brain — things that happen, as they happen.
 *
 * Until now the agent learned about the world by polling: every ten minutes
 * look for a new transcript, every morning pull yesterday's WhatsApp. This is
 * the other half. WAHA, Fathom and Cal.com all push; a message from a client,
 * a finished recording or a new booking arrives here within seconds and picks
 * the job that knows what to do with it.
 *
 * The routes are data in the brain (`system/udalosti.json`), for the same
 * reason the jobs are: the agent can read them, propose changes, and git keeps
 * the history. A route says who may call it (auth), what it accepts (events,
 * filters), how to fold a burst into one run (coalesce), which job to run and
 * what context to hand it.
 *
 * Three rules:
 *
 *   1. A payload is foreign text. It reaches the model only through the
 *      context template, never as an instruction, and runs from events get
 *      the same tools as scheduled runs, nothing more.
 *   2. One event, one run, at most once. Duplicates (retries from the sender)
 *      are dropped by delivery id or body hash for an hour.
 *   3. A burst is one run. A client sending six messages in a minute produces
 *      one sync, after the burst has settled, not six.
 *
 * Events wait in SQLite so a restart during the window loses nothing; the
 * scheduler drains them before it looks at the clock.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { getConnection } from '../modules/database/connection.js';
import { resolveBrainPath } from '../utils/brain-path.js';

const FILE = path.join('system', 'udalosti.json');
const DEDUPE_MS = 60 * 60 * 1000;
const RATE_PER_MINUTE = 120;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS beyond_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  route        TEXT NOT NULL,
  event        TEXT,
  dedupe_key   TEXT,
  coalesce_key TEXT,
  job          TEXT NOT NULL,
  context      TEXT,
  payload      TEXT,
  status       TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 1,
  received_at  TEXT NOT NULL,
  due_at       TEXT,
  deadline_at  TEXT,
  started_at   TEXT,
  finished_at  TEXT,
  run_id       INTEGER,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_beyond_events_status ON beyond_events(status, due_at);
CREATE INDEX IF NOT EXISTS idx_beyond_events_dedupe ON beyond_events(dedupe_key, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_beyond_events_coalesce ON beyond_events(route, coalesce_key, status);
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

/* ------------------------------------------------------------------ */
/* routes                                                              */
/* ------------------------------------------------------------------ */

let cache = { mtimeMs: -1, data: null };

function filePath() {
  return path.join(resolveBrainPath(), FILE);
}

export function readRoutesFile() {
  const p = filePath();
  let stat;
  try {
    stat = fs.statSync(p);
  } catch {
    return { cesty: {} };
  }
  if (cache.data && cache.mtimeMs === stat.mtimeMs) return cache.data;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    cache = { mtimeMs: stat.mtimeMs, data: { cesty: parsed.cesty && typeof parsed.cesty === 'object' ? parsed.cesty : {} } };
  } catch (err) {
    console.warn('[events] system/udalosti.json se nedá přečíst:', err?.message || err);
    cache = { mtimeMs: stat.mtimeMs, data: { cesty: {} } };
  }
  return cache.data;
}

export function listRoutes() {
  const { cesty } = readRoutesFile();
  return Object.entries(cesty).map(([name, r]) => ({
    name,
    description: r.popis || null,
    events: r.events || null,
    job: r.job || null,
    enabled: r.enabled !== false,
    coalesce: r.coalesce || null,
    auth: r.auth?.kind || 'secret',
    configured: Boolean(secretFor(r)),
  }));
}

export function getRoute(name) {
  const r = readRoutesFile().cesty[name];
  return r ? { name, ...r } : null;
}

function secretFor(route) {
  const env = route.auth?.secretEnv;
  const value = (env && process.env[env]) || process.env.BEYOND_EVENT_SECRET;
  return value && value.trim() ? value.trim() : null;
}

/* ------------------------------------------------------------------ */
/* auth                                                                */
/* ------------------------------------------------------------------ */

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function header(req, name) {
  const v = req.headers[String(name).toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Verify the caller. Returns null when OK, otherwise a reason. `rawBody` is
 * the exact bytes received, because every HMAC scheme signs those.
 */
export function verifyAuth(route, req, rawBody) {
  const auth = route.auth || { kind: 'secret', header: 'X-Beyond-Secret' };
  const kind = String(auth.kind || 'secret').toLowerCase();
  if (kind === 'none') {
    // Only ever acceptable from the box itself.
    const ip = req.ip || req.socket?.remoteAddress || '';
    return /^(::1|127\.|::ffff:127\.)/.test(ip) ? null : 'bez ověření jen z localhostu';
  }
  const secret = secretFor(route);
  if (!secret) return 'route nemá nastavený secret (env proměnná chybí)';

  if (kind === 'secret') {
    const got = header(req, auth.header || 'X-Beyond-Secret') || req.query?.secret;
    return got && safeEqual(got, secret) ? null : 'špatný nebo chybějící secret';
  }
  if (kind === 'hmac') {
    const algorithm = String(auth.algorithm || 'sha256').toLowerCase();
    const got = header(req, auth.header || 'X-Webhook-Hmac');
    if (!got) return `chybí hlavička ${auth.header || 'X-Webhook-Hmac'}`;
    const expectedHex = createHmac(algorithm, secret).update(rawBody).digest('hex');
    const expectedB64 = createHmac(algorithm, secret).update(rawBody).digest('base64');
    const value = String(got).replace(/^(sha256|sha512|sha1)=/i, '');
    return safeEqual(value.toLowerCase(), expectedHex) || safeEqual(value, expectedB64) ? null : 'podpis nesedí';
  }
  if (kind === 'standard-webhooks') {
    // https://www.standardwebhooks.com: webhook-id, webhook-timestamp, webhook-signature "v1,<b64>"
    const id = header(req, 'webhook-id');
    const ts = header(req, 'webhook-timestamp');
    const sig = header(req, 'webhook-signature');
    if (!id || !ts || !sig) return 'chybí standard-webhooks hlavičky';
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return 'timestamp mimo toleranci 5 min';
    const key = secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret);
    const expected = createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest('base64');
    const ok = String(sig)
      .split(/\s+/)
      .some((part) => {
        const [, value] = part.split(',');
        return value && safeEqual(value, expected);
      });
    return ok ? null : 'podpis nesedí';
  }
  return `neznámý druh ověření „${auth.kind}"`;
}

/* ------------------------------------------------------------------ */
/* templates and filters                                               */
/* ------------------------------------------------------------------ */

function getPath(obj, dotted) {
  return String(dotted)
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/**
 * `{a.b.c}` inside a string is replaced by the value; a string that is
 * exactly one `{path}` yields the value itself (so an object can pass
 * through). `{__raw__}` is the whole payload as JSON, capped.
 */
export function render(template, payload) {
  if (template == null) return template;
  if (typeof template === 'string') {
    const whole = /^\{([^{}]+)\}$/.exec(template.trim());
    if (whole) {
      const v = whole[1] === '__raw__' ? JSON.stringify(payload).slice(0, 4000) : getPath(payload, whole[1]);
      return v === undefined ? template : v;
    }
    return template.replace(/\{([^{}]+)\}/g, (m, key) => {
      if (key === '__raw__') return JSON.stringify(payload).slice(0, 4000);
      const v = getPath(payload, key);
      if (v === undefined) return m;
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(template)) return template.map((t) => render(t, payload));
  if (typeof template === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(template)) out[k] = render(v, payload);
    return out;
  }
  return template;
}

/** All filters must pass. Unknown operators fail closed. */
export function passesFilters(filters, payload) {
  if (!Array.isArray(filters) || !filters.length) return true;
  return filters.every((f) => {
    const v = getPath(payload, f.field);
    if ('equals' in f) return v === f.equals;
    if ('notEquals' in f) return v !== f.notEquals;
    if ('in' in f) return Array.isArray(f.in) && f.in.includes(v);
    if ('contains' in f) return typeof v === 'string' && v.includes(String(f.contains));
    if ('exists' in f) return (v !== undefined && v !== null) === Boolean(f.exists);
    if ('regex' in f) {
      try {
        return new RegExp(f.regex).test(String(v ?? ''));
      } catch {
        return false;
      }
    }
    return false;
  });
}

/* ------------------------------------------------------------------ */
/* intake                                                              */
/* ------------------------------------------------------------------ */

const rate = new Map(); // route → { minute, count }

function rateLimited(route) {
  const minute = Math.floor(Date.now() / 60_000);
  const slot = rate.get(route);
  if (!slot || slot.minute !== minute) {
    rate.set(route, { minute, count: 1 });
    return false;
  }
  slot.count += 1;
  return slot.count > RATE_PER_MINUTE;
}

function dedupeKeyFor(req, rawBody) {
  const id =
    header(req, 'x-github-delivery') ||
    header(req, 'webhook-id') ||
    header(req, 'svix-id') ||
    header(req, 'x-request-id') ||
    header(req, 'x-cal-delivery-id');
  if (id) return `id:${id}`;
  return `sha:${createHash('sha256').update(rawBody).digest('hex')}`;
}

/**
 * Take one HTTP delivery and either queue a run or say why not.
 * Returns { status: 'queued'|'coalesced'|'ignored'|'rejected', reason?, id? }.
 */
export function intake(routeName, req, rawBody) {
  const route = getRoute(routeName);
  if (!route) return { status: 'rejected', http: 404, reason: 'neznámá route' };
  if (route.enabled === false) return { status: 'ignored', reason: 'route vypnutá' };
  if (rateLimited(routeName)) return { status: 'rejected', http: 429, reason: 'příliš mnoho událostí' };

  const authError = verifyAuth(route, req, rawBody);
  if (authError) return { status: 'rejected', http: 401, reason: authError };

  let payload;
  try {
    payload = rawBody.length ? JSON.parse(rawBody) : {};
  } catch {
    return { status: 'rejected', http: 400, reason: 'tělo není JSON' };
  }

  const event =
    (route.eventHeader && header(req, route.eventHeader)) ||
    (route.eventField ? getPath(payload, route.eventField) : null) ||
    payload.event ||
    payload.type ||
    payload.triggerEvent ||
    null;
  if (Array.isArray(route.events) && route.events.length && !route.events.includes(event)) {
    return { status: 'ignored', reason: `událost ${event || '(žádná)'} není v seznamu` };
  }
  if (!passesFilters(route.filters, payload)) return { status: 'ignored', reason: 'filtr' };

  const job = render(route.job, payload);
  if (!job || typeof job !== 'string') return { status: 'rejected', http: 400, reason: 'route nemá job' };

  const context = render(route.context || {}, payload);
  const now = new Date();
  const dedupeKey = dedupeKeyFor(req, rawBody);

  const conn = db();
  const seen = conn
    .prepare('SELECT id FROM beyond_events WHERE dedupe_key=? AND received_at>=? LIMIT 1')
    .get(dedupeKey, new Date(now.getTime() - DEDUPE_MS).toISOString());
  if (seen) return { status: 'ignored', reason: 'duplicitní doručení', id: seen.id };

  const coalesce = route.coalesce || null;
  const coalesceKey = coalesce?.key ? String(render(coalesce.key, payload)) : null;
  const windowMs = Math.max(0, Number(coalesce?.windowSeconds ?? 0)) * 1000;
  const maxWaitMs = Math.max(windowMs, Number(coalesce?.maxWaitSeconds ?? 0) * 1000);

  if (coalesceKey && windowMs > 0) {
    const open = conn
      .prepare(`SELECT * FROM beyond_events WHERE route=? AND coalesce_key=? AND status='waiting' LIMIT 1`)
      .get(routeName, coalesceKey);
    if (open) {
      const deadline = Date.parse(open.deadline_at);
      const due = Math.min(now.getTime() + windowMs, deadline);
      conn
        .prepare(
          `UPDATE beyond_events SET count=count+1, payload=?, context=?, due_at=?, dedupe_key=? WHERE id=?`,
        )
        .run(JSON.stringify(payload).slice(0, 20000), JSON.stringify(context), new Date(due).toISOString(), dedupeKey, open.id);
      return { status: 'coalesced', id: open.id };
    }
    const info = conn
      .prepare(
        `INSERT INTO beyond_events (route, event, dedupe_key, coalesce_key, job, context, payload, status, received_at, due_at, deadline_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`,
      )
      .run(
        routeName,
        event,
        dedupeKey,
        coalesceKey,
        job,
        JSON.stringify(context),
        JSON.stringify(payload).slice(0, 20000),
        now.toISOString(),
        new Date(now.getTime() + windowMs).toISOString(),
        new Date(now.getTime() + maxWaitMs).toISOString(),
      );
    return { status: 'queued', id: Number(info.lastInsertRowid), waitSeconds: windowMs / 1000 };
  }

  const info = conn
    .prepare(
      `INSERT INTO beyond_events (route, event, dedupe_key, coalesce_key, job, context, payload, status, received_at, due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(routeName, event, dedupeKey, coalesceKey, job, JSON.stringify(context), JSON.stringify(payload).slice(0, 20000), now.toISOString(), now.toISOString());
  return { status: 'queued', id: Number(info.lastInsertRowid) };
}

/**
 * Queue a run from inside the app (no HTTP), e.g. a job chaining another.
 */
export function enqueueInternal({ route = 'app', job, context = {}, event = null }) {
  const now = new Date().toISOString();
  const info = db()
    .prepare(
      `INSERT INTO beyond_events (route, event, dedupe_key, job, context, payload, status, received_at, due_at)
       VALUES (?, ?, NULL, ?, ?, '{}', 'pending', ?, ?)`,
    )
    .run(route, event, job, JSON.stringify(context || {}), now, now);
  return Number(info.lastInsertRowid);
}

/* ------------------------------------------------------------------ */
/* for the scheduler                                                   */
/* ------------------------------------------------------------------ */

/** Oldest event whose wait is over. Marks it running. */
export function takeDueEvent(now = new Date()) {
  const conn = db();
  const row = conn
    .prepare(
      `SELECT * FROM beyond_events
        WHERE (status='pending' OR (status='waiting' AND due_at<=?))
        ORDER BY received_at ASC LIMIT 1`,
    )
    .get(now.toISOString());
  if (!row) return null;
  conn.prepare(`UPDATE beyond_events SET status='running', started_at=? WHERE id=?`).run(now.toISOString(), row.id);
  return shape(row);
}

export function finishEvent(id, { runId = null, error = null } = {}) {
  db()
    .prepare(`UPDATE beyond_events SET status=?, finished_at=?, run_id=?, error=? WHERE id=?`)
    .run(error ? 'error' : 'done', new Date().toISOString(), runId, error ? String(error).slice(0, 1000) : null, id);
}

export function listEvents({ limit = 40 } = {}) {
  return db().prepare('SELECT * FROM beyond_events ORDER BY received_at DESC LIMIT ?').all(limit).map(shape);
}

export function pendingEventCount() {
  const row = db().prepare(`SELECT COUNT(*) AS n FROM beyond_events WHERE status IN ('pending','waiting')`).get();
  return row?.n || 0;
}

/** Events stuck in `running` when the process died. */
export function reapOrphanedEvents() {
  const info = db()
    .prepare(`UPDATE beyond_events SET status='error', finished_at=?, error='Služba se restartovala během běhu' WHERE status='running'`)
    .run(new Date().toISOString());
  return info.changes;
}

function shape(row) {
  let context = {};
  try {
    context = row.context ? JSON.parse(row.context) : {};
  } catch {
    context = {};
  }
  return {
    id: row.id,
    route: row.route,
    event: row.event,
    job: row.job,
    context,
    status: row.status,
    count: row.count,
    coalesceKey: row.coalesce_key,
    receivedAt: row.received_at,
    dueAt: row.due_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    runId: row.run_id,
    error: row.error,
  };
}
