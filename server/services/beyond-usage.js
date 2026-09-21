/**
 * Beyond Brain — what the brain spends, and how much of the account is left.
 *
 * Two questions, two sources. "Where did the tokens go" comes from the SDK:
 * every turn ends with a `result` that carries tokens, per-model usage and
 * the price it would have had on the API; one row per turn goes into
 * `beyond_usage`, tagged with where it came from (a chat, a job by name,
 * Telegram). "How much of the subscription is left" comes from the same
 * place Claude Code's /usage reads it: the account's usage endpoint, with
 * the OAuth token the CLI on the box already holds. Both degrade to
 * "unknown" rather than to zero.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getConnection } from '../modules/database/connection.js';
import { fromWall, todayIso } from './beyond-time.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS beyond_usage (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  source       TEXT NOT NULL,
  label        TEXT,
  actor        TEXT,
  session_id   TEXT,
  model        TEXT,
  input        INTEGER NOT NULL DEFAULT 0,
  output       INTEGER NOT NULL DEFAULT 0,
  cache_read   INTEGER NOT NULL DEFAULT 0,
  cache_write  INTEGER NOT NULL DEFAULT 0,
  cost_usd     REAL NOT NULL DEFAULT 0,
  duration_ms  INTEGER,
  turns        INTEGER,
  is_error     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_beyond_usage_ts ON beyond_usage(ts DESC);
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

/**
 * One row per finished turn. `result` is the SDK's result message; `ctx`
 * says where it ran: { source, label, actor, sessionId }.
 */
export function recordUsage(result, ctx = {}) {
  if (!result || result.type !== 'result') return;
  try {
    const usage = result.usage || {};
    const models = result.modelUsage && typeof result.modelUsage === 'object' ? Object.keys(result.modelUsage) : [];
    // The model that did the work: the one with the most output tokens.
    const model = models.sort((a, b) => (result.modelUsage[b]?.outputTokens || 0) - (result.modelUsage[a]?.outputTokens || 0))[0] || null;
    db().prepare(
      `INSERT INTO beyond_usage (ts, source, label, actor, session_id, model, input, output, cache_read, cache_write, cost_usd, duration_ms, turns, is_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      new Date().toISOString(),
      String(ctx.source || 'chat'),
      ctx.label != null ? String(ctx.label) : null,
      ctx.actor != null ? String(ctx.actor) : null,
      ctx.sessionId || result.session_id || null,
      model,
      Number(usage.input_tokens || 0),
      Number(usage.output_tokens || 0),
      Number(usage.cache_read_input_tokens || 0),
      Number(usage.cache_creation_input_tokens || 0),
      Number(result.total_cost_usd || 0),
      Number.isFinite(result.duration_ms) ? Math.round(result.duration_ms) : null,
      Number.isFinite(result.num_turns) ? result.num_turns : null,
      result.is_error ? 1 : 0,
    );
  } catch (err) {
    console.warn('[usage] záznam selhal', err?.message || err);
  }
}

const SUM = 'COUNT(*) AS runs, SUM(input) AS input, SUM(output) AS output, SUM(cache_read) AS cache_read, SUM(cache_write) AS cache_write, SUM(cost_usd) AS cost_usd, SUM(is_error) AS errors';

function since(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Totals for the panel: today, 7 days, 30 days; by source; by model; last runs. */
export function usageReport() {
  const conn = db();
  // Midnight of the app's today, as a real instant.
  const [y, m, d] = todayIso().split('-').map(Number);
  const startOfToday = fromWall(new Date(Date.UTC(y, m - 1, d))).toISOString();
  const periods = {
    today: conn.prepare(`SELECT ${SUM} FROM beyond_usage WHERE ts >= ?`).get(startOfToday),
    week: conn.prepare(`SELECT ${SUM} FROM beyond_usage WHERE ts >= ?`).get(since(7)),
    month: conn.prepare(`SELECT ${SUM} FROM beyond_usage WHERE ts >= ?`).get(since(30)),
  };
  const bySource = conn.prepare(
    `SELECT source, label, ${SUM} FROM beyond_usage WHERE ts >= ? GROUP BY source, label ORDER BY cost_usd DESC`,
  ).all(since(7));
  const byModel = conn.prepare(
    `SELECT model, ${SUM} FROM beyond_usage WHERE ts >= ? GROUP BY model ORDER BY cost_usd DESC`,
  ).all(since(7));
  const byDay = conn.prepare(
    `SELECT substr(ts, 1, 10) AS day, ${SUM} FROM beyond_usage WHERE ts >= ? GROUP BY day ORDER BY day`,
  ).all(since(14));
  const recent = conn.prepare(
    'SELECT ts, source, label, actor, model, input, output, cache_read, cache_write, cost_usd, duration_ms, turns, is_error FROM beyond_usage ORDER BY id DESC LIMIT 40',
  ).all();
  return { periods, bySource, byModel, byDay, recent };
}

/* ------------------------------------------------------------------ */
/* the subscription                                                    */
/* ------------------------------------------------------------------ */

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
let limitsCache = { at: 0, data: null };
const LIMITS_TTL_MS = 60_000;

function credentialsPath() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(home, '.claude', '.credentials.json');
}

function readOauthToken() {
  try {
    const raw = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8'));
    const o = raw?.claudeAiOauth || raw?.oauth || null;
    if (!o?.accessToken) return null;
    return { token: o.accessToken, expiresAt: o.expiresAt || null, subscription: o.subscriptionType || null };
  } catch {
    return null;
  }
}

/**
 * The account's windows as a list the UI can draw: the 5-hour session, the
 * week across models, and the week for whichever model has its own line
 * (the endpoint names it). Falls back to the two plain fields.
 */
function windows(body) {
  const out = [];
  if (Array.isArray(body.limits)) {
    for (const l of body.limits) {
      const model = l.scope?.model?.display_name || null;
      const label = l.kind === 'session' ? 'Aktuální 5 hodin' : l.kind === 'weekly_all' ? 'Týden, všechny modely' : model ? `Týden, ${model}` : l.kind;
      out.push({ kind: l.kind, label, percent: Number(l.percent) || 0, severity: l.severity || 'normal', resetsAt: l.resets_at || null });
    }
  }
  if (!out.length) {
    if (body.five_hour) out.push({ kind: 'session', label: 'Aktuální 5 hodin', percent: Number(body.five_hour.utilization) || 0, severity: 'normal', resetsAt: body.five_hour.resets_at || null });
    if (body.seven_day) out.push({ kind: 'weekly_all', label: 'Týden, všechny modely', percent: Number(body.seven_day.utilization) || 0, severity: 'normal', resetsAt: body.seven_day.resets_at || null });
  }
  return out;
}

/**
 * How much of the 5-hour and weekly windows is used, as the account reports
 * it. Needs the CLI's OAuth token on the box; without it, or when the
 * endpoint says no, the answer is `available: false` with the reason.
 */
export async function subscriptionLimits({ force = false } = {}) {
  if (!force && limitsCache.data && Date.now() - limitsCache.at < LIMITS_TTL_MS) return limitsCache.data;
  const cred = readOauthToken();
  if (!cred) {
    return { available: false, reason: 'Na stroji není přihlášení Claude (chybí ~/.claude/.credentials.json).' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${cred.token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'BeyondBrain/1.0',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const data = { available: false, reason: `Účet odpověděl ${res.status}${res.status === 401 ? ', token vypršel, obnoví se prvním během Claude' : ''}.` };
      limitsCache = { at: Date.now(), data };
      return data;
    }
    const body = await res.json();
    const data = {
      available: true,
      subscription: cred.subscription,
      fetchedAt: new Date().toISOString(),
      windows: windows(body),
      extra: body.extra_usage?.is_enabled ? { used: body.extra_usage.used_credits, limit: body.extra_usage.monthly_limit, currency: body.extra_usage.currency } : null,
    };
    limitsCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    return { available: false, reason: err?.name === 'AbortError' ? 'Účet neodpověděl do 8 s.' : err?.message || 'nedostupné' };
  } finally {
    clearTimeout(timer);
  }
}
