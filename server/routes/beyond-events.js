/**
 * Beyond Brain — the door events come in through.
 *
 *   POST /api/beyond-events/:route
 *
 * No JWT: each route carries its own auth (shared secret or HMAC over the raw
 * body), configured in the brain's `system/udalosti.json`. The body is read
 * raw so the signature can be checked on the exact bytes.
 *
 * The answer is quick and honest: 202 when a run is queued or folded into a
 * waiting one, 200 with `ignored` when the route chose not to act, 401/404/429
 * when it should not have been called. The sender never waits for the agent.
 */
import express from 'express';

import { intake } from '../services/beyond-events.js';

const router = express.Router();

router.post('/:route', express.raw({ type: () => true, limit: '2mb' }), (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : '';
  let result;
  try {
    result = intake(req.params.route, req, rawBody);
  } catch (err) {
    console.error('[events] intake selhal', err);
    return res.status(500).json({ ok: false, error: err?.message || 'intake selhal' });
  }

  if (result.status === 'rejected') {
    console.warn(`[events] ${req.params.route}: odmítnuto (${result.reason})`);
    return res.status(result.http || 400).json({ ok: false, error: result.reason });
  }
  if (result.status === 'ignored') {
    return res.status(200).json({ ok: true, status: 'ignored', reason: result.reason });
  }
  console.log(`[events] ${req.params.route}: ${result.status} #${result.id}`);
  return res.status(202).json({ ok: true, status: result.status, id: result.id, waitSeconds: result.waitSeconds ?? 0 });
});

export default router;
