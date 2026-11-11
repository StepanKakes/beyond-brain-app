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
import crypto from 'crypto';
import express from 'express';

import { intake } from '../services/beyond-events.js';
import { listMeetings } from '../services/beyond-google.js';

const router = express.Router();

/**
 *   GET /api/beyond-events/kalendar-ucastnici?od=ISO&do=ISO
 *
 * Who was invited to what on the Beyond calendar in a window. The n8n Fathom
 * workflow asks this when a recording came in as an "impromptu" meeting: the
 * event sat on the shared calendar, not on Tim's, so Fathom saw no invitees
 * and could not tell which client it was. Same secret as the `fathom` route.
 */
router.get('/kalendar-ucastnici', async (req, res) => {
  const expected = process.env.BEYOND_EVENT_SECRET_N8N || '';
  const given = String(req.get('X-Beyond-Secret') || '');
  const ok = expected && given.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return res.status(401).json({ ok: false, error: 'bad secret' });
  try {
    const events = await listMeetings({ od: String(req.query.od || ''), do: String(req.query.do || '') });
    return res.json({
      ok: true,
      udalosti: events.map((e) => ({
        nazev: e.nazev,
        zacatek: e.zacatek,
        konec: e.konec,
        emaily: (e.ucastnici || []).map((u) => u.email).filter(Boolean),
      })),
    });
  } catch (err) {
    console.error('[events] kalendar-ucastnici selhal', err);
    return res.status(502).json({ ok: false, error: err?.message || 'kalendář nejde přečíst' });
  }
});

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
