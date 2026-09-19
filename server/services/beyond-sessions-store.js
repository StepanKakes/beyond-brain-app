/**
 * Beyond Brain — per-slug session index store.
 *
 * Persists `{ activeUuid, sessions: [{uuid, title, lastUsedAt}] }` per slug in
 * a JSON file alongside auth.db. Two consumers:
 *   1. `/api/beyond/sessions/:slug` (browser chat) — direct GET/PUT.
 *   2. `/api/beyond/agent/query` (Telegram / scheduled callers) — read on
 *      every turn to resume, write after the SDK returns a new UUID.
 *
 * Extracted out of `routes/beyond.js` so both can share the same file lock-
 * free, atomic-write logic. The universal slug (`__universal__`) is persisted
 * like any other slug — global chats now have a real history (multi-thread
 * variant C), each thread is its own context window.
 *
 * Concurrency: the index is shared across everyone on the (single, shared)
 * Beyond login — multiple browsers/devices mutate the same per-slug list at
 * once. Two hazards are handled here:
 *   1. Lost updates: every browser PUT used to *replace* the whole array from
 *      its own (possibly stale) snapshot, so a second writer working from an
 *      older view silently dropped sessions another writer had just added
 *      ("the older chat disappears"). Browser writes now go through
 *      `mergeSessionIndex`, which unions the incoming list with what's on disk
 *      (dedupe by uuid, newest `lastUsedAt` wins) and only removes uuids the
 *      caller *explicitly* lists in `deletedUuids`.
 *   2. Interleaved read-modify-write: all mutators run under `withStoreLock`,
 *      a single in-process promise chain, so concurrent requests can't read the
 *      same store, both modify it, and clobber each other on write.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { writeFileAtomic } from '../utils/atomic-write.js';

export const BEYOND_SESSIONS_FILE = path.join(
  os.homedir(),
  '.cloudcli',
  'beyond-sessions.json',
);

/** Per-slug regex: lowercase/uppercase letters, digits, dashes; underscores
 *  allowed only for the special `__telegram__:...` flavours used by the
 *  agent (browser-issued slugs are always plain). */
export const BROWSER_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;
export const AGENT_SLUG_RE = /^[a-z0-9_][a-z0-9_:.\-]{0,127}$/i;
export const UNIVERSAL_SLUG = '__universal__';

export async function readSessionsStore() {
  try {
    const raw = await fs.readFile(BEYOND_SESSIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    console.error('[beyond-sessions] read failed', err);
    return {};
  }
}

export async function writeSessionsStore(store) {
  // Windows-safe atomic write: retries the rename through transient AV/indexer
  // locks and falls back to an in-place overwrite. Previously a bare rename hit
  // EPERM and the write was lost → a new chat vanished on refresh.
  await writeFileAtomic(BEYOND_SESSIONS_FILE, JSON.stringify(store, null, 2));
}

// ---------------------------------------------------------------------------
// Serialization: all read-modify-write mutations run one-at-a-time so two
// concurrent callers can't both read the store, both edit, and lose one set of
// changes on write. Single Node process → a single in-process promise chain is
// enough; no cross-process locking needed.
//
// Callers MUST NOT nest `withStoreLock` (e.g. a locked fn calling another
// locked fn) — the inner call would queue behind the outer and deadlock. Each
// public mutator below does its full RMW inline against the unlocked
// `readSessionsStore`/`writeSessionsStore` primitives.
// ---------------------------------------------------------------------------
let _storeChain = Promise.resolve();
function withStoreLock(fn) {
  const run = _storeChain.then(fn, fn);
  // Keep the chain alive whether `fn` resolved or rejected, and never leak an
  // unhandled rejection from the internal bookkeeping promise.
  _storeChain = run.then(() => {}, () => {});
  return run;
}

export function normalizeSessions(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const s of input) {
    if (!s || typeof s !== 'object') continue;
    const uuid = typeof s.uuid === 'string' ? s.uuid.trim() : '';
    const title = typeof s.title === 'string' ? s.title : '';
    const lastUsedAt = typeof s.lastUsedAt === 'number' ? s.lastUsedAt : Date.now();
    if (!uuid) continue;
    out.push({ uuid, title, lastUsedAt });
  }
  // De-dupe by uuid, keep most-recently used.
  const byUuid = new Map();
  for (const s of out) {
    const prev = byUuid.get(s.uuid);
    if (!prev || prev.lastUsedAt < s.lastUsedAt) byUuid.set(s.uuid, s);
  }
  return [...byUuid.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/** Resolve a desired active uuid against a session list: an explicit non-empty
 *  uuid wins, otherwise fall back to the previous one; either way it must be a
 *  real entry in the list or we clear it. */
function resolveActive(desired, fallback, sessions) {
  let active = null;
  if (typeof desired === 'string' && desired.trim()) {
    active = desired.trim();
  } else if (typeof fallback === 'string' && fallback.trim()) {
    active = fallback.trim();
  }
  if (active && !sessions.some((s) => s.uuid === active)) active = null;
  return active;
}

/** Look up a slug's session entry; returns `{activeUuid, sessions}` defaulting
 *  to an empty index. Pure read — safe to call without the lock. */
export async function getSessionIndex(slug) {
  const store = await readSessionsStore();
  const entry = store[slug] || { activeUuid: null, sessions: [] };
  return {
    activeUuid: typeof entry.activeUuid === 'string' ? entry.activeUuid : null,
    sessions: normalizeSessions(entry.sessions),
  };
}

/** Destructive replace of `{activeUuid, sessions}` for a slug. The incoming
 *  list becomes the slug's entire list — callers that don't have an
 *  authoritative full view (e.g. a browser working from a stale snapshot)
 *  should use `mergeSessionIndex` instead to avoid dropping other writers'
 *  sessions. Kept for callers that genuinely own the full state. */
export function setSessionIndex(slug, { activeUuid, sessions }) {
  return withStoreLock(async () => {
    const normalized = normalizeSessions(sessions);
    const active = resolveActive(activeUuid, null, normalized);
    const store = await readSessionsStore();
    if (normalized.length === 0 && !active) {
      delete store[slug];
    } else {
      store[slug] = { activeUuid: active, sessions: normalized };
    }
    await writeSessionsStore(store);
    return { activeUuid: active, sessions: normalized };
  });
}

/** Non-destructive update for a slug — the path browser PUTs take.
 *
 *  - `sessions`: unioned with what's already on disk (dedupe by uuid, newest
 *    `lastUsedAt` wins). Sessions on disk that the caller didn't send are
 *    PRESERVED — this is what stops a concurrent writer from dropping them.
 *  - `deletedUuids`: the only way to remove sessions. Removed after the merge.
 *  - `activeUuid`: an explicit non-empty value sets the shared active pointer;
 *    null/absent keeps the existing one (so one user opening a fresh chat
 *    doesn't blank out another user's active session). Cleared if it ends up
 *    pointing at a session that no longer exists. */
export function mergeSessionIndex(slug, { activeUuid, sessions, deletedUuids } = {}) {
  return withStoreLock(async () => {
    const store = await readSessionsStore();
    const existing = store[slug] || { activeUuid: null, sessions: [] };
    const deleted = new Set(
      Array.isArray(deletedUuids)
        ? deletedUuids.filter((u) => typeof u === 'string' && u.trim()).map((u) => u.trim())
        : [],
    );
    // Incoming first so a fresh title/lastUsedAt can win a tie; normalize then
    // dedupes by uuid keeping the newest lastUsedAt (a stale incoming entry
    // loses to a newer on-disk one — exactly the lost-update guard we want).
    let merged = normalizeSessions([
      ...(Array.isArray(sessions) ? sessions : []),
      ...(Array.isArray(existing.sessions) ? existing.sessions : []),
    ]);
    if (deleted.size) merged = merged.filter((s) => !deleted.has(s.uuid));
    const active = resolveActive(activeUuid, existing.activeUuid, merged);
    if (merged.length === 0 && !active) {
      delete store[slug];
    } else {
      store[slug] = { activeUuid: active, sessions: merged };
    }
    await writeSessionsStore(store);
    return { activeUuid: active, sessions: merged };
  });
}

/** Record a freshly-issued SDK session UUID for a slug — used by the agent
 *  route after `runSdkOneShot` returns a brand-new sessionId. Appends to the
 *  list (if absent) and marks it active. Atomic RMW under the store lock. */
export function recordNewSession(slug, uuid, title) {
  if (!uuid) return Promise.resolve();
  return withStoreLock(async () => {
    const store = await readSessionsStore();
    const existing = store[slug] || { activeUuid: null, sessions: [] };
    const current = normalizeSessions(existing.sessions);
    if (current.some((s) => s.uuid === uuid)) {
      // Already known — just bump active.
      store[slug] = { activeUuid: uuid, sessions: current };
      await writeSessionsStore(store);
      return;
    }
    const entry = {
      uuid,
      title: title || `Chat ${new Date().toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
      lastUsedAt: Date.now(),
    };
    const merged = normalizeSessions([entry, ...current]);
    store[slug] = { activeUuid: uuid, sessions: merged };
    await writeSessionsStore(store);
  });
}

/** Bump the `lastUsedAt` for an existing session uuid (so the most-recently
 *  active thread surfaces at the top of the UI dropdown). No-ops if the
 *  uuid isn't in the index yet. Atomic RMW under the store lock. */
export function touchSession(slug, uuid) {
  if (!uuid) return Promise.resolve();
  return withStoreLock(async () => {
    const store = await readSessionsStore();
    const existing = store[slug] || { activeUuid: null, sessions: [] };
    const current = normalizeSessions(existing.sessions);
    if (!current.some((s) => s.uuid === uuid)) return;
    const next = current.map((s) =>
      s.uuid === uuid ? { ...s, lastUsedAt: Date.now() } : s,
    );
    const merged = normalizeSessions(next);
    store[slug] = { activeUuid: uuid, sessions: merged };
    await writeSessionsStore(store);
  });
}
