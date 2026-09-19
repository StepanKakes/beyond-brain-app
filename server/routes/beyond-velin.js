/**
 * Beyond Brain — the velín's read API.
 *
 * Mounted at `/api/beyond/velin` behind the usual JWT. Everything here is
 * derived from the brain repo plus Cal.com; nothing writes. The heavy lifting
 * lives in the services, so these handlers only shape responses and keep the
 * client from having to know how the brain is laid out.
 */
import express from 'express';

import { getBrainIndex, invalidateBrainIndex, daysSince } from '../services/brain-index.js';
import { inbox, signalsForClient } from '../services/brain-signals.js';
import { getCalls, isConfigured as callsConfigured } from '../services/beyond-calls.js';
import { getPeople, personForUser } from '../services/beyond-people.js';

const router = express.Router();

/** Everything the dashboards need, fetched once. */
async function load({ force = false } = {}) {
  const index = await getBrainIndex({ force });
  const people = getPeople();
  const calls = await getCalls({ clients: index.clients, people, force });
  return { index, people, calls };
}

/** Strip a client down to what a board card renders. */
function clientCard(client, row, calls) {
  const next = calls.calls.find((c) => c.clientSlug === client.slug) || null;
  const latest = client.measurements[0] || null;
  return {
    slug: client.slug,
    name: client.name,
    initials: client.initials,
    stav: client.stav,
    programWeek: client.programWeek,
    totalWeeks: client.totalWeeks,
    daysToEnd: client.daysToEnd,
    endIso: client.endIso,
    priceCzk: client.priceCzk,
    notionUrl: client.notionUrl,
    spine: client.spine,
    latestWeek: latest ? { isoWeek: latest.isoWeek, range: latest.range, values: latest.values } : null,
    history: client.measurements.slice(0, 8).map((w) => ({ isoWeek: w.isoWeek, values: w.values })),
    openOurs: client.promises.ours.length,
    openTheirs: client.promises.theirs.length,
    openFlags: client.flags.filter((f) => f.open).length,
    lastInboundIso: client.whatsappRaw?.lastInboundIso || null,
    waBroken: Boolean(client.whatsappRaw?.syncedButEmpty),
    lastCallIso: client.calls[0]?.dateIso || null,
    nextCall: next,
    score: row.score,
    worst: row.worst,
    counts: row.counts,
    /** Severity excluding roster-wide conditions — what the board's chip uses. */
    ownCounts: row.ownCounts || row.counts,
    systemicTypes: row.systemicTypes || [],
    signals: row.signals,
    missing: Object.entries(client.has)
      .filter(([, present]) => !present)
      .map(([k]) => k),
  };
}

/**
 * The velín. Three lists plus the systemic conditions, the calls for today and
 * whatever is live right now.
 */
router.get('/', async (req, res) => {
  try {
    const { index, people, calls } = await load({ force: req.query.force === '1' });
    const me = personForUser(req.user);
    const { needsUs, risks, agent, systemic, rows } = inbox(index.clients, {
      upcomingCalls: calls.calls,
    });

    const today = new Date().toISOString().slice(0, 10);
    const todaysCalls = calls.calls.filter((c) => c.startIso.slice(0, 10) === today);

    res.json({
      builtAt: index.builtAt,
      brainPath: index.brainPath,
      exists: index.exists,
      me: me ? { key: me.key, displayName: me.displayName } : null,
      people: people.map((p) => ({ key: p.key, displayName: p.displayName })),
      needsUs,
      risks,
      agent,
      systemic,
      calls: {
        configured: calls.configured,
        error: calls.error,
        today: todaysCalls,
        live: calls.live,
        next: calls.calls.find((c) => !c.live) || null,
      },
      totals: {
        clients: index.clients.length,
        critical: rows.filter((r) => r.counts.critical > 0).length,
        needsUs: needsUs.length,
      },
    });
  } catch (err) {
    console.error('[velin] / failed', err);
    res.status(500).json({ error: err?.message || 'velín selhal' });
  }
});

/** The client board, already ordered by how much attention each one needs. */
router.get('/board', async (req, res) => {
  try {
    const { index, calls } = await load();
    const { rows } = inbox(index.clients, { upcomingCalls: calls.calls });
    res.json({
      builtAt: index.builtAt,
      clients: rows.map((row) => clientCard(row.client, row, calls)),
    });
  } catch (err) {
    console.error('[velin] /board failed', err);
    res.status(500).json({ error: err?.message || 'board selhal' });
  }
});

/**
 * One client in full, including the merged timeline.
 *
 * The timeline is the piece that does not exist anywhere else: calls, WhatsApp
 * summaries, Fathom recordings and booked calls are four separate files, and
 * only interleaved do they read as the story of the relationship.
 */
router.get('/client/:slug', async (req, res) => {
  try {
    const { index, calls } = await load();
    const client = index.clients.find((c) => c.slug === req.params.slug);
    if (!client) return res.status(404).json({ error: 'Klient nenalezen' });

    const sig = signalsForClient(client, { upcomingCalls: calls.calls });
    const now = Date.now();

    const timeline = [
      ...client.calls.map((c) => ({
        kind: 'call',
        dateIso: c.dateIso,
        title: c.title || 'Call',
        excerpt: c.excerpt,
      })),
      ...client.whatsappSummaries.map((w) => ({
        kind: 'whatsapp',
        dateIso: w.dateIso,
        title: 'WhatsApp',
        excerpt: w.excerpt,
      })),
      ...client.fathom.map((f) => ({
        kind: 'fathom',
        dateIso: f.dateIso,
        title: 'Fathom přepis',
        excerpt: f.file,
      })),
      ...calls.calls
        .filter((c) => c.clientSlug === client.slug)
        .map((c) => ({
          kind: 'booked',
          dateIso: c.startIso.slice(0, 10),
          title: c.title,
          excerpt: `${c.host?.name || 'neznámý host'} · ${c.durationMin ?? '?'} min`,
          future: true,
        })),
    ].sort((a, b) => b.dateIso.localeCompare(a.dateIso));

    res.json({
      client: {
        ...client,
        daysSinceLastCall: client.calls[0] ? daysSince(client.calls[0].dateIso, now) : null,
      },
      signals: sig.signals,
      score: sig.score,
      timeline,
      calls: calls.calls.filter((c) => c.clientSlug === client.slug),
    });
  } catch (err) {
    console.error('[velin] /client failed', err);
    res.status(500).json({ error: err?.message || 'klient selhal' });
  }
});

/** Booked calls, grouped by day, with whatever is running right now. */
router.get('/calls', async (req, res) => {
  try {
    const { index, people, calls } = await load({ force: req.query.force === '1' });
    const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
    const full = await getCalls({ clients: index.clients, people, days });

    const byDay = new Map();
    for (const c of full.calls) {
      const day = c.startIso.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(c);
    }

    res.json({
      configured: full.configured,
      error: full.error,
      fetchedAt: full.fetchedAt,
      live: full.live,
      days: [...byDay.entries()].map(([day, items]) => ({ day, calls: items })),
      people: people.map((p) => ({ key: p.key, displayName: p.displayName })),
      unmatched: full.calls.filter((c) => !c.clientSlug).length,
    });
  } catch (err) {
    console.error('[velin] /calls failed', err);
    res.status(500).json({ error: err?.message || 'hovory selhaly' });
  }
});

/** Force a rebuild after a sync. Cheap: the whole parse is milliseconds. */
router.post('/refresh', async (_req, res) => {
  try {
    invalidateBrainIndex();
    const index = await getBrainIndex({ force: true });
    res.json({ ok: true, builtAt: index.builtAt, clients: index.clients.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'refresh selhal' });
  }
});

/** Whether the calendar is wired up at all, for the settings surface. */
router.get('/status', (_req, res) => {
  res.json({ calcom: callsConfigured() });
});

export default router;
