/**
 * Beyond Brain — one question to the agent, from outside the browser.
 *
 * This is what a Telegram message becomes, whether it arrived through the
 * in-app bot (`beyond-telegram-bot.js`) or through the HTTP route that n8n
 * used to call. Both go through `askAgent`: pick the client thread, resume or
 * reset the session, run the SDK, deliver progress and the answer into the
 * chat, and remember the session for next time.
 *
 * Slug routing:
 *   1. Caller may pass an explicit `slug` (e.g. `ivana-jurikova`). We use it.
 *   2. Otherwise we try a tiny first-name heuristic against known active
 *      clients ("co Ivana" → ivana-jurikova).
 *   3. Otherwise we synthesize a Telegram-scoped slug from
 *      `meta.telegramChatId` so each chat gets its own thread.
 */
import { runSdkOneShot } from '../claude-sdk.js';
import {
  AGENT_SLUG_RE,
  getSessionIndex,
  recordNewSession,
  touchSession,
} from './beyond-sessions-store.js';
import { createTelegramProgressEmitter } from './telegram-progress.js';
import { listClientSlugs } from './beyond-clients.js';

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


function shortTitle(text) {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? oneLine.slice(0, 60) + '…' : oneLine;
}

/**
 * Ask the agent. Returns { slug, source, progress, promise } where `promise`
 * resolves to the answer record. When `progress` is non-null the answer is
 * also delivered into the Telegram chat by this function; the caller need
 * not post it.
 */
export async function askAgent({ text, source = 'unknown', meta = {}, slug: explicitSlug = null, sessionId = null, tgUser = null }) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Missing `text`');
  const slug = await resolveSlug({ slug: explicitSlug, text, meta });
  const dedupKey = IDEMPOTENCY_WINDOW_MS > 0 ? requestDedupKey(meta) : null;

  if (dedupKey) {
    const cached = inflightRequests.get(dedupKey);
    if (cached) {
      console.log(`[agent] dedup hit ${dedupKey} tgUser=${tgUser || '-'} — replaying result`);
      return { slug, source, progress: null, promise: cached.promise, deduped: true };
    }
  }

  let resumeId = null;
  let idleReset = false;
  if (typeof sessionId === 'string' && sessionId.trim()) {
    resumeId = sessionId.trim();
  } else if (slug) {
    try {
      const index = await getSessionIndex(slug);
      const activeUuid = index.activeUuid || null;
      if (activeUuid && AGENT_IDLE_RESET_MS > 0) {
        const active = (index.sessions || []).find((s) => s && s.uuid === activeUuid);
        const lastUsedAt = active && typeof active.lastUsedAt === 'number' ? active.lastUsedAt : 0;
        const idleMs = Date.now() - lastUsedAt;
        if (lastUsedAt > 0 && idleMs > AGENT_IDLE_RESET_MS) idleReset = true;
        else resumeId = activeUuid;
      } else if (activeUuid) {
        resumeId = activeUuid;
      }
    } catch (err) {
      console.warn('[agent] failed to read session index', err);
    }
  }

  console.log(
    `[agent] query source=${source} slug=${slug || '(none)'} resume=${resumeId ? resumeId.slice(0, 8) : '(new)'}${idleReset ? ' (idle-reset)' : ''} tgUser=${tgUser || '-'}${dedupKey ? ` dedup=${dedupKey}` : ''}`,
  );

  const progress =
    (source === 'telegram' || source === 'voice') && meta.telegramChatId
      ? createTelegramProgressEmitter({ chatId: meta.telegramChatId, replyToMessageId: meta.telegramMessageId })
      : null;

  // `[TG]` tells the brain's CLAUDE.md to answer in Telegram HTML, not markdown.
  const goesToTelegram =
    source === 'telegram' || source === 'voice' || (slug || '').startsWith('__telegram__:') || slug === 'cron-morning-brief';
  const command = goesToTelegram ? `[TG] ${text}` : text;

  const runRequest = async () => {
    const result = await runSdkOneShot({
      command,
      sessionId: resumeId || undefined,
      skipPermissions: true,
      onProgress: progress || undefined,
      beyond: {
        source: source === 'telegram' || source === 'voice' ? 'telegram' : source,
        actor: tgUser ? `tg:${tgUser}` : source,
        label: slug || null,
        origin: meta?.telegramChatId != null ? { telegramChatId: String(meta.telegramChatId) } : null,
        allowSchedule: true,
      },
    });
    if (progress) progress.finish().catch((err) => console.warn('[agent] progress.finish failed', err));
    if (slug && result.sessionId) {
      try {
        if (resumeId && resumeId === result.sessionId) await touchSession(slug, result.sessionId);
        else await recordNewSession(slug, result.sessionId, shortTitle(text));
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

  const promise = runRequest();
  if (dedupKey) {
    inflightRequests.set(dedupKey, { promise, evictTimer: null });
    promise.then(
      () => scheduleEviction(dedupKey),
      () => inflightRequests.delete(dedupKey),
    );
  }

  if (progress) {
    promise.then(
      (result) => {
        progress.finalAnswer(result.text).catch((err) => console.warn('[agent-async] finalAnswer failed', err?.message || err));
        console.log(`[agent-async] job done slug=${slug || '(none)'} durationMs=${result.durationMs} sid=${(result.sessionId || '').slice(0, 8)}`);
      },
      (err) => {
        console.error(`[agent-async] job failed slug=${slug || '(none)'}`, err?.message || err);
        progress
          .finish({ okLine: 'Něco se rozbilo: ' + (err?.message || 'SDK error').slice(0, 200) })
          .catch((flushErr) => console.warn('[agent-async] progress.finish on error failed', flushErr));
      },
    );
  }

  return { slug, source, progress, promise, deduped: false };
}
