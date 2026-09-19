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
import { JOBS } from '../services/beyond-jobs.js';
import { getJobState, listRuns, setJobEnabled } from '../services/beyond-runs.js';
import { runJob, schedulerStatus, setPaused } from '../services/beyond-scheduler.js';
import {
  countPending,
  editProposal,
  getProposal,
  listProposals,
  markFailed,
  markSent,
  rejectProposal,
} from '../services/beyond-proposals.js';
import { isConfigured as wahaConfigured, sendText } from '../services/beyond-waha.js';

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
    isActive: client.isActive,
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
      proposals: { waiting: countPending(), canSend: wahaConfigured() },
      totals: {
        clients: index.clients.filter((c) => c.isActive !== false).length,
        finished: index.clients.filter((c) => c.isActive === false).length,
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

/* ------------------------------------------------------------------ */
/* prepared messages                                                   */
/* ------------------------------------------------------------------ */

/** What is written and waiting for a click. */
router.get('/navrhy', (req, res) => {
  try {
    res.json({
      canSend: wahaConfigured(),
      pending: listProposals({ status: 'pending' }),
      recent: listProposals({ status: 'all', limit: 20 }).filter((p) => p.status !== 'pending'),
    });
  } catch (err) {
    console.error('[velin] /navrhy failed', err);
    res.status(500).json({ error: err?.message || 'návrhy selhaly' });
  }
});

/** Edit the text before sending. */
router.patch('/navrhy/:id', (req, res) => {
  try {
    const updated = editProposal(Number(req.params.id), req.body?.body, req.user?.username);
    res.json({ ok: true, proposal: updated });
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || 'úprava selhala' });
  }
});

router.post('/navrhy/:id/zahodit', (req, res) => {
  try {
    res.json({ ok: true, proposal: rejectProposal(Number(req.params.id), req.user?.username) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || 'nešlo zahodit' });
  }
});

/**
 * Send it. The stored text goes out untouched — the point of the click is that
 * what was read is what leaves, so nothing re-renders it here.
 */
router.post('/navrhy/:id/odeslat', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const p = getProposal(id);
    if (!p) return res.status(404).json({ ok: false, error: 'Návrh neexistuje' });
    if (p.status !== 'pending') {
      return res.status(409).json({ ok: false, error: `Návrh je ve stavu ${p.status}` });
    }
    if (p.channel !== 'whatsapp') {
      return res.status(400).json({ ok: false, error: `Kanál ${p.channel} zatím neumíme` });
    }
    console.log(`[velin] ${req.user?.username} odesílá návrh ${id} klientovi ${p.clientSlug}`);
    await sendText({ chatId: p.target, text: p.body });
    res.json({ ok: true, proposal: markSent(id, req.user?.username) });
  } catch (err) {
    const message = err?.message || 'odeslání selhalo';
    console.error(`[velin] odeslání návrhu ${id} selhalo:`, message);
    try {
      markFailed(id, message);
    } catch { /* keep the original error */ }
    res.status(502).json({ ok: false, error: message });
  }
});

/* ------------------------------------------------------------------ */
/* the agent                                                           */
/* ------------------------------------------------------------------ */

/** What the agent does, when it last did it, and how the last runs went. */
router.get('/agent', (_req, res) => {
  try {
    res.json({
      scheduler: schedulerStatus(),
      jobs: JOBS.map((j) => {
        const state = getJobState(j.name);
        return {
          name: j.name,
          title: j.title,
          description: j.description,
          cadence: j.everyMs
            ? `každých ${Math.round(j.everyMs / 60000)} min`
            : j.dailyAt
              ? `denně ${String(j.dailyAt.hour).padStart(2, '0')}:${String(j.dailyAt.minute).padStart(2, '0')}`
              : j.weeklyAt
                ? `týdně, ${['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'][j.weeklyAt.weekday]} ${String(j.weeklyAt.hour).padStart(2, '0')}:${String(j.weeklyAt.minute).padStart(2, '0')}`
                : 'ručně',
          enabled: state.enabled,
          lastRunAt: state.lastRunAt,
        };
      }),
      runs: listRuns({ limit: 30 }),
    });
  } catch (err) {
    console.error('[velin] /agent failed', err);
    res.status(500).json({ error: err?.message || 'agent selhal' });
  }
});

/** Run one job now. Answers immediately; the run shows up in the log. */
router.post('/agent/run/:job', async (req, res) => {
  try {
    const name = req.params.job;
    console.log(`[velin] ${req.user?.username} spustil ručně ${name}`);
    res.json({ ok: true, started: name });
    runJob(name, { triggerKind: 'manual', triggerDetail: req.user?.username || null }).catch(
      (err) => console.error('[velin] ruční běh selhal', err?.message || err),
    );
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || 'nešlo spustit' });
  }
});

/** Turn a single job on or off. */
router.post('/agent/job/:job', (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  setJobEnabled(req.params.job, enabled);
  console.log(`[velin] ${req.user?.username} ${enabled ? 'zapnul' : 'vypnul'} ${req.params.job}`);
  res.json({ ok: true, job: req.params.job, enabled });
});

/** The kill switch for everything at once. */
router.post('/agent/pause', (req, res) => {
  const paused = setPaused(Boolean(req.body?.paused));
  console.log(`[velin] ${req.user?.username} ${paused ? 'pozastavil' : 'pustil'} agenta`);
  res.json({ ok: true, paused });
});

/** Whether the calendar is wired up at all, for the settings surface. */
router.get('/status', (_req, res) => {
  res.json({ calcom: callsConfigured() });
});

export default router;
