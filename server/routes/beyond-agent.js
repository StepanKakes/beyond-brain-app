/**
 * Beyond Brain — agent endpoints for non-browser callers.
 *
 * Mounted at `/api/beyond-agent`. These routes are protected by
 * `authenticateAgent` (shared secret + optional Telegram allow-list) — not
 * the JWT used by the browser SPA. Intended for n8n workflows wrapping a
 * Telegram bot, scheduled briefs, and any future programmatic surface.
 *
 * The work is in `services/beyond-agent-query.js` (`askAgent`), shared with
 * the in-app Telegram bot; this route is the HTTP face of it for n8n and
 * curl. The response includes the SDK-issued `sessionId` so callers can
 * resume the same thread next time.
 *
 * Slug routing:
 *   1. Caller may pass an explicit `slug` (e.g. `ivana-jurikova`). We use it.
 *   2. Otherwise we try a tiny first-name heuristic against known active
 *      clients ("co Ivana" → ivana-jurikova).
 *   3. Otherwise we synthesize a Telegram-scoped slug from
 *      `meta.telegramChatId` so each chat gets its own thread.
 */

import express from 'express';

import { askAgent } from '../services/beyond-agent-query.js';
import { listClientSlugs } from '../services/beyond-clients.js';
import { brainPathExists, resolveBrainPath } from '../utils/brain-path.js';

const router = express.Router();

router.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    brainPath: resolveBrainPath(),
    brainPathExists: brainPathExists(),
    knownClients: await listClientSlugs(),
  });
});

router.post('/query', async (req, res) => {
  const body = req.body || {};
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) return res.status(400).json({ error: 'Missing `text`' });

  const source = typeof body.source === 'string' ? body.source : 'unknown';
  const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
  const tgUser = req.agent?.telegramUserId && req.agent.telegramUserId !== '-' ? String(req.agent.telegramUserId) : null;

  let ask;
  try {
    ask = await askAgent({ text, source, meta, slug: body.slug, sessionId: body.sessionId, tgUser });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err?.message || 'bad request' });
  }

  // When BB itself delivers the answer into Telegram, ack now (202) and let
  // the run finish in the background; that is what dodges Cloudflare's 100 s.
  if (ask.progress) {
    return res.status(202).json({
      ok: true,
      deferred: true,
      slug: ask.slug,
      source,
      note: 'BB delivers the final answer directly to Telegram; do not post the response body.',
    });
  }

  try {
    res.json(await ask.promise);
  } catch (err) {
    console.error('[agent] /query failed', err);
    res.status(500).json({ ok: false, error: err?.message || 'SDK call failed', slug: ask.slug });
  }
});


export default router;
