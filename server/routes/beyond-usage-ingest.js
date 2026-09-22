/**
 * Beyond Brain — external usage ingest.
 *
 * Mounted at `/api/beyond-agent/usage` behind the shared agent token (no
 * Telegram allow-list: this caller is a machine, not a person). A small
 * reporter on each machine where you run your own Claude Code sums the local
 * transcripts and POSTs them here, so the app can separate the account's
 * usage into "the brain" and "you" (see `services/beyond-usage.js`).
 *
 * Body: { machine?: string, source?: string, events: Turn[] }
 *   Turn: { ts, sessionId?, model?, input?, output?, cacheRead?, cacheWrite?,
 *           costUsd?, dedupeKey? }
 */

import express from 'express';

import { recordExternalUsage } from '../services/beyond-usage.js';

const router = express.Router();

router.post('/', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const events = Array.isArray(body.events) ? body.events : [];
  const machine = typeof body.machine === 'string' && body.machine.trim() ? body.machine.trim() : 'unknown';
  const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'claude-code';
  try {
    const stored = recordExternalUsage(events, { machine, source });
    res.json({ ok: true, machine, received: events.length, stored });
  } catch (err) {
    console.error('[usage-ingest] failed', err);
    res.status(500).json({ ok: false, error: err?.message || 'usage ingest failed' });
  }
});

export default router;