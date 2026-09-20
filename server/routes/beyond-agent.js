/**
 * Beyond Brain — agent endpoints for non-browser callers.
 *
 * Mounted at `/api/beyond-agent`. These routes are protected by
 * `authenticateAgent` (shared secret + optional Telegram allow-list) — not
 * the JWT used by the browser SPA. Intended for n8n workflows wrapping a
 * Telegram bot, scheduled briefs, and any future programmatic surface.
 *
 * Single-shot only: each request maps to one Claude Agent SDK run via
 * `runSdkOneShot` (non-streaming). The response includes the SDK-issued
 * `sessionId` so callers (and the shared session store) can resume the
 * same thread next time.
 *
 * Slug routing:
 *   1. Caller may pass an explicit `slug` (e.g. `ivana-jurikova`). We use it.
 *   2. Otherwise we try a tiny first-name heuristic against known active
 *      clients ("co Ivana" → ivana-jurikova).
 *   3. Otherwise we synthesize a Telegram-scoped slug from
 *      `meta.telegramChatId` so each chat gets its own thread.
 */

import express from 'express';

import { runSdkOneShot } from '../claude-sdk.js';
import {
  AGENT_SLUG_RE,
  getSessionIndex,
  recordNewSession,
  touchSession,
} from '../services/beyond-sessions-store.js';
import { createTelegramProgressEmitter } from '../services/telegram-progress.js';
import { listClientSlugs } from '../services/beyond-clients.js';
import { brainPathExists, resolveBrainPath } from '../utils/brain-path.js';

const router = express.Router();

const BRAIN_PATH = resolveBrainPath();

// After this much idle time on a Telegram thread we start a fresh Claude
// session instead of resuming the previous one. Prevents per-Telegram-chat
// JSONLs from growing unboundedly (which would force auto-compact every turn
// and pay full cache_creation cost on a huge history).
// Override with `BEYOND_AGENT_IDLE_RESET_MS` env (e.g. `0` to disable).
const AGENT_IDLE_RESET_MS =
  process.env.BEYOND_AGENT_IDLE_RESET_MS !== undefined
    ? parseInt(process.env.BEYOND_AGENT_IDLE_RESET_MS, 10)
    : 60 * 60 * 1000; // 1 hour

// Idempotency window for inbound requests. Telegram retries a webhook every
// 60s if the receiver doesn't ack — when the SDK answer takes longer than
// that, n8n re-fires the same query and the SDK runs twice on identical
// input. We coalesce duplicates by (chatId, messageId) for this window: the
// 2nd request awaits the same in-flight promise and returns its result.
// Override with `BEYOND_AGENT_IDEMPOTENCY_MS` env (`0` disables).
const IDEMPOTENCY_WINDOW_MS =
  process.env.BEYOND_AGENT_IDEMPOTENCY_MS !== undefined
    ? parseInt(process.env.BEYOND_AGENT_IDEMPOTENCY_MS, 10)
    : 10 * 60 * 1000; // 10 min

// key → { promise: Promise<responseBody>, evictTimer: NodeJS.Timeout | null }
const inflightRequests = new Map();

function requestDedupKey(meta) {
  if (meta && meta.telegramChatId != null && meta.telegramMessageId != null) {
    return `tg:${meta.telegramChatId}:${meta.telegramMessageId}`;
  }
  return null;
}

function scheduleEviction(key) {
  const entry = inflightRequests.get(key);
  if (!entry) return;
  if (entry.evictTimer) clearTimeout(entry.evictTimer);
  entry.evictTimer = setTimeout(() => {
    inflightRequests.delete(key);
  }, IDEMPOTENCY_WINDOW_MS);
}

/** The live roster from the brain repo (see services/beyond-clients.js). */
async function knownClientSlugs() {
  return listClientSlugs();
}

/** Tries to match an active client by first-name mention in the text. Returns
 *  the matching slug or `null`. Czech-insensitive (no diacritics in slugs).
 *
 *  Longest first name wins, so a roster containing both `jakub-bolek` and
 *  `jakub-privara` does not let whichever sorts first swallow every "Jakub".
 *  Ambiguous mentions (same first name, no surname in the text) stay unmatched
 *  and fall through to the Telegram-scoped thread rather than guessing wrong. */
async function inferClientSlug(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const lowered = text.toLowerCase();
  const slugs = await knownClientSlugs();

  // Full slug spelled out ("jakub privara", "jakub-privara") is unambiguous.
  for (const slug of slugs) {
    if (lowered.includes(slug) || lowered.includes(slug.replace(/-/g, ' '))) {
      return slug;
    }
  }

  // Otherwise fall back to the first name, but only when it identifies exactly
  // one client on the roster.
  const byFirstName = new Map();
  for (const slug of slugs) {
    const fn = slug.split('-')[0];
    byFirstName.set(fn, (byFirstName.get(fn) || []).concat(slug));
  }
  for (const [fn, matches] of byFirstName) {
    if (matches.length === 1 && lowered.includes(fn)) return matches[0];
  }
  return null;
}

/** Synthesizes a per-Telegram-chat slug so each conversation thread is its
 *  own SDK session. Caps length and sanitizes to fit AGENT_SLUG_RE. */
function telegramSlug(chatId) {
  if (chatId == null) return null;
  const safe = String(chatId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  if (!safe) return null;
  return `__telegram__:${safe}`;
}

async function resolveSlug({ slug, text, meta }) {
  // Explicit slug wins, after validation. Note we use the wider AGENT_SLUG_RE
  // so callers can pass agent-flavoured slugs like `__telegram__:123`.
  if (typeof slug === 'string' && slug.trim()) {
    const s = slug.trim();
    if (AGENT_SLUG_RE.test(s)) return s;
  }
  const inferred = await inferClientSlug(text);
  if (inferred) return inferred;
  if (meta && meta.telegramChatId != null) {
    return telegramSlug(meta.telegramChatId);
  }
  return null;
}

router.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    brainPath: BRAIN_PATH,
    brainPathExists: brainPathExists(),
    knownClients: await knownClientSlugs(),
  });
});

router.post('/query', async (req, res) => {
  const body = req.body || {};
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) {
    return res.status(400).json({ error: 'Missing `text`' });
  }

  const source = typeof body.source === 'string' ? body.source : 'unknown';
  const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
  const slug = await resolveSlug({ slug: body.slug, text, meta });
  const dedupKey = IDEMPOTENCY_WINDOW_MS > 0 ? requestDedupKey(meta) : null;
  const tgUser = req.agent?.telegramUserId || '-';

  // Dedup: if the same (chatId, messageId) is in flight or recently completed,
  // attach to that promise instead of starting another SDK run. The original
  // request's progress emitter has already been driving the Telegram status
  // message; the dupe just needs to wait for the answer.
  if (dedupKey) {
    const cached = inflightRequests.get(dedupKey);
    if (cached) {
      console.log(`[agent] dedup hit ${dedupKey} tgUser=${tgUser} — replaying result`);
      try {
        const result = await cached.promise;
        return res.json(result);
      } catch {
        // Original run failed. Fall through and try again — the cache entry
        // will be overwritten below.
      }
    }
  }

  // Pick the session to resume: explicit body.sessionId wins, otherwise the
  // store's activeUuid for this slug. New SDK session if both are absent.
  let resumeId = null;
  let idleReset = false;
  if (typeof body.sessionId === 'string' && body.sessionId.trim()) {
    resumeId = body.sessionId.trim();
  } else if (slug) {
    try {
      const index = await getSessionIndex(slug);
      const activeUuid = index.activeUuid || null;
      if (activeUuid && AGENT_IDLE_RESET_MS > 0) {
        // Active session exists — check its idle time. If it's been quiet for
        // longer than the threshold, ignore it and start fresh so the JSONL
        // doesn't keep accumulating across unrelated conversations.
        const active = (index.sessions || []).find((s) => s && s.uuid === activeUuid);
        const lastUsedAt = active && typeof active.lastUsedAt === 'number' ? active.lastUsedAt : 0;
        const idleMs = Date.now() - lastUsedAt;
        if (lastUsedAt > 0 && idleMs > AGENT_IDLE_RESET_MS) {
          idleReset = true;
        } else {
          resumeId = activeUuid;
        }
      } else if (activeUuid) {
        resumeId = activeUuid;
      }
    } catch (err) {
      console.warn('[agent] failed to read session index', err);
    }
  }

  console.log(
    `[agent] query source=${source} slug=${slug || '(none)'} resume=${resumeId ? resumeId.slice(0, 8) : '(new)'}${idleReset ? ' (idle-reset)' : ''} tgUser=${tgUser}${dedupKey ? ` dedup=${dedupKey}` : ''}`,
  );

  // For Telegram-sourced queries, push live progress into the chat while the
  // SDK runs. The final answer still comes back as the HTTP response and is
  // delivered by n8n's TelegramSend node — this is just a status breadcrumb.
  const progress =
    source === 'telegram' && meta.telegramChatId
      ? createTelegramProgressEmitter({
          chatId: meta.telegramChatId,
          replyToMessageId: meta.telegramMessageId, // optional; harmless if absent
        })
      : null;

  // Prefix Telegram-bound queries with a `[TG]` marker so the brain CLAUDE.md
  // "Formátování odpovědí" rule has an unambiguous signal to switch from
  // markdown to Telegram HTML. TG-bound = anything that ends up rendered by
  // Telegram client: direct chats, voice transcripts, Morning Brief.
  // wa-debounce-* and other cron jobs writing to disk keep raw text →
  // markdown by default.
  const goesToTelegram =
    source === 'telegram' ||
    source === 'voice' ||
    (slug || '').startsWith('__telegram__:') ||
    slug === 'cron-morning-brief';
  const command = goesToTelegram ? `[TG] ${text}` : text;

  const runRequest = async () => {
    const result = await runSdkOneShot({
      command,
      sessionId: resumeId || undefined,
      skipPermissions: true,
      onProgress: progress || undefined,
      beyond: {
        source: source === 'telegram' || source === 'voice' ? 'telegram' : source,
        actor: tgUser && tgUser !== '-' ? `tg:${tgUser}` : source,
        label: slug || null,
        origin: meta?.telegramChatId != null ? { telegramChatId: String(meta.telegramChatId) } : null,
        allowSchedule: true,
      },
    });

    if (progress) {
      // Don't await — the SDK already returned, we just want the final tick
      // to land. Fire-and-forget so we don't add latency to the HTTP reply.
      progress.finish().catch((err) => console.warn('[agent] progress.finish failed', err));
    }

    // Persist the (possibly newly minted) session uuid for this slug so the
    // next turn can resume it. We never persist `__universal__` (the store
    // helpers no-op on it) — agent slugs are fine.
    if (slug && result.sessionId) {
      try {
        if (resumeId && resumeId === result.sessionId) {
          await touchSession(slug, result.sessionId);
        } else {
          await recordNewSession(slug, result.sessionId, shortTitle(text));
        }
      } catch (err) {
        console.warn('[agent] failed to update session store', err);
      }
    }

    return {
      ok: true,
      text: result.text,
      sessionId: result.sessionId,
      slug,
      source,
      durationMs: result.durationMs,
      model: result.model,
      finishReason: result.finishReason,
    };
  };

  // Register in-flight promise BEFORE awaiting it, so a duplicate request
  // arriving while the SDK is still working attaches to the same promise.
  const promise = runRequest();
  if (dedupKey) {
    inflightRequests.set(dedupKey, { promise, evictTimer: null });
    promise.then(
      () => scheduleEviction(dedupKey),
      () => inflightRequests.delete(dedupKey), // evict immediately on failure → retry allowed
    );
  }

  // When BB itself can deliver the final answer to Telegram (progress emitter
  // is wired up), respond 202 immediately and finish the work in the
  // background. This bypasses Cloudflare's 100 s timeout entirely — n8n gets
  // a fast ack, no 524 error, no retry, no duplicate. The actual answer
  // lands in Telegram via `progress.finalAnswer()` once the SDK is done.
  if (progress) {
    res.status(202).json({
      ok: true,
      deferred: true,
      slug,
      source,
      note: 'BB delivers the final answer directly to Telegram; do not post the response body.',
    });
    promise.then(
      (result) => {
        progress
          .finalAnswer(result.text)
          .catch((err) => console.warn('[agent-async] finalAnswer failed', err?.message || err));
        console.log(`[agent-async] job done slug=${slug || '(none)'} durationMs=${result.durationMs} sid=${(result.sessionId || '').slice(0, 8)}`);
      },
      (err) => {
        console.error(`[agent-async] job failed slug=${slug || '(none)'}`, err?.message || err);
        progress
          .finish({ okLine: '⚠️ Něco se rozbilo: ' + (err?.message || 'SDK error').slice(0, 200) })
          .catch((flushErr) => console.warn('[agent-async] progress.finish on error failed', flushErr));
      },
    );
    return;
  }

  // Non-Telegram callers (n8n cron jobs that need a response body, manual
  // curl probes, future API consumers) still get the synchronous path.
  try {
    const result = await promise;
    res.json(result);
  } catch (err) {
    console.error('[agent] /query failed', err);
    res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : 'SDK call failed',
      slug,
    });
  }
});

function shortTitle(text) {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? oneLine.slice(0, 60) + '…' : oneLine;
}

export default router;
