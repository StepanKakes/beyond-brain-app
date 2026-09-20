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
import { listRuns, setJobEnabled } from '../services/beyond-runs.js';
import { describeJobs, runJob, schedulerStatus, setPaused } from '../services/beyond-scheduler.js';
import { listEvents, listRoutes } from '../services/beyond-events.js';
import * as mozek from '../services/beyond-mozek.js';
import { createTask, removeTask, setScheduleOverride, updateTask } from '../services/beyond-tasks.js';
import { snapshot as memorySnapshot } from '../services/beyond-memory.js';
import * as ukoly from '../services/beyond-ukoly.js';
import { pullBrain } from '../services/beyond-git.js';
import { todayIso, tz } from '../services/beyond-time.js';
import fs from 'node:fs';
import path from 'node:path';
import { resolveBrainPath } from '../utils/brain-path.js';
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

    const today = todayIso();
    const todaysCalls = calls.calls.filter((c) => todayIso(new Date(c.startIso)) === today);

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
    const pulled = await pullBrain();
    if (pulled.note) console.warn('[velin] refresh:', pulled.note);
    invalidateBrainIndex();
    const index = await getBrainIndex({ force: true });
    res.json({ ok: true, builtAt: index.builtAt, clients: index.clients.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'refresh selhal' });
  }
});

/* ------------------------------------------------------------------ */
/* tasks: one list for the morning                                      */
/* ------------------------------------------------------------------ */

const DEFAULT_OWNER = () => process.env.BEYOND_DEFAULT_OWNER || getPeople()[0]?.key || 'tim';

function dueKind(due, today) {
  if (!due) return '';
  if (due < today) return 'over';
  if (due === today) return 'today';
  return '';
}

function dueLabel(due, today) {
  if (!due) return null;
  if (due === today) return 'dnes';
  const d = new Date(`${due}T12:00:00`);
  const t = new Date(`${today}T12:00:00`);
  const diff = Math.round((d - t) / 86_400_000);
  if (diff === 1) return 'zítra';
  if (diff === -1) return 'včera';
  if (diff > 1 && diff < 7) return ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'][d.getDay()];
  return `${d.getDate()}. ${d.getMonth() + 1}.`;
}

/**
 * The task list as the velín shows it: the stored tasks, plus every prepared
 * message and every proposed brain change folded in as a task with a prep.
 * Nothing is duplicated into the file; a sent message simply stops appearing.
 */
function composeTasks(index) {
  const today = todayIso();
  const nameOf = (slug) => index.clients.find((c) => c.slug === slug)?.name || null;
  const shapeClient = (slug) => (slug ? { slug, name: nameOf(slug) || slug } : null);

  const stored = ukoly.listTasks().map((t) => ({
    id: t.id,
    text: t.text,
    priority: t.priority,
    state: t.state,
    client: shapeClient(t.client),
    owner: t.owner,
    createdBy: t.createdBy,
    due: t.due,
    dueLabel: dueLabel(t.due, today),
    dueKind: dueKind(t.due, today),
    note: t.note,
    prep: t.prep,
    createdAt: t.createdAt,
    doneAt: t.doneAt,
    virtual: false,
  }));

  const messages = listProposals({ status: 'pending' }).map((p) => ({
    id: `navrh:${p.id}`,
    text: `${p.kind === 'shrnuti-callu' ? 'Poslat shrnutí callu' : p.kind === 'pripomenuti' ? 'Připomenout se' : 'Ozvat se'}${p.clientName ? ` ${p.clientName}` : ''}`,
    priority: p.kind === 'shrnuti-callu' ? 1 : 2,
    state: ukoly.virtualState(`navrh:${p.id}`),
    client: shapeClient(p.clientSlug),
    owner: DEFAULT_OWNER(),
    createdBy: 'agent',
    due: today,
    dueLabel: 'dnes',
    dueKind: 'today',
    note: p.reason,
    prep: {
      kind: 'zprava',
      title: 'Brain připravil zprávu na WhatsApp',
      body: p.body,
      ref: p.id,
      canSend: wahaConfigured(),
      actions: [
        { label: 'Odeslat', action: 'navrh-odeslat', primary: true },
        { label: 'Upravit', action: 'navrh-upravit' },
        { label: 'Zahodit', action: 'navrh-zahodit' },
      ],
    },
    createdAt: p.createdAt,
    doneAt: null,
    virtual: true,
  }));

  const brain = mozek.listProposals({ status: 'pending' }).map((m) => ({
    id: `mozek:${m.id}`,
    text: `Schválit změnu: ${m.path.replace(/^\.claude\/skills\//, 'skill ').replace(/^system\//, '').replace(/\.md$/, '')}`,
    priority: 3,
    state: ukoly.virtualState(`mozek:${m.id}`),
    client: null,
    owner: DEFAULT_OWNER(),
    createdBy: m.source && m.source !== 'agent' ? m.source : 'agent',
    due: null,
    dueLabel: null,
    dueKind: '',
    note: null,
    prep: {
      kind: 'navrh',
      title: m.kind === 'skill' ? 'Brain navrhuje změnu skillu' : 'Brain navrhuje změnu pravidla',
      body: m.reason || '',
      ref: m.id,
      actions: [
        { label: 'Schválit', action: 'mozek-schvalit', primary: true },
        { label: 'Ukázat změnu', action: 'mozek-diff' },
        { label: 'Zahodit', action: 'mozek-zahodit' },
      ],
    },
    createdAt: m.createdAt,
    doneAt: null,
    virtual: true,
  }));

  return [...stored, ...messages, ...brain];
}

router.get('/ukoly', async (req, res) => {
  try {
    const index = await getBrainIndex();
    const me = personForUser(req.user);
    res.json({
      me: me ? me.key : DEFAULT_OWNER(),
      tz: tz(),
      today: todayIso(),
      people: getPeople().map((p) => ({ key: p.key, displayName: p.displayName, avatar: `/avatars/${p.key}.jpg` })),
      clients: index.clients.filter((c) => c.isActive !== false).map((c) => ({ slug: c.slug, name: c.name })),
      tasks: composeTasks(index),
    });
  } catch (err) {
    console.error('[velin] /ukoly failed', err);
    res.status(500).json({ error: err?.message || 'úkoly selhaly' });
  }
});

/** Create from quick text (`{ quick: "p1 dnes zavolat Pavlovi" }`) or from fields. */
router.post('/ukoly', async (req, res) => {
  try {
    const index = await getBrainIndex();
    const me = personForUser(req.user)?.key || DEFAULT_OWNER();
    const body = req.body || {};
    let fields = body;
    if (typeof body.quick === 'string') {
      // When you are looking at someone else's list, a task you add there is
      // theirs unless the text says otherwise.
      const known = getPeople().some((p) => p.key === body.owner);
      fields = ukoly.parseQuick(body.quick, {
        me: known ? body.owner : me,
        clients: index.clients.filter((c) => c.isActive !== false).map((c) => ({ slug: c.slug, name: c.name, first: c.name.split(' ')[0] })),
      });
    }
    const task = await ukoly.createTask({ ...fields, createdBy: me });
    res.json({ ok: true, task });
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || 'nešlo založit' });
  }
});

/** Just look at what quick add would make of a line. */
router.post('/ukoly/parse', async (req, res) => {
  try {
    const index = await getBrainIndex();
    const me = personForUser(req.user)?.key || DEFAULT_OWNER();
    const known = getPeople().some((p) => p.key === req.body?.owner);
    const parsed = ukoly.parseQuick(String(req.body?.quick || ''), {
      me: known ? req.body.owner : me,
      clients: index.clients.filter((c) => c.isActive !== false).map((c) => ({ slug: c.slug, name: c.name, first: c.name.split(' ')[0] })),
    });
    res.json({ ...parsed, clientName: parsed.client ? index.clients.find((c) => c.slug === parsed.client)?.name || null : null });
  } catch (err) {
    res.status(400).json({ error: err?.message || 'parse selhal' });
  }
});

router.patch('/ukoly/:id', async (req, res) => {
  try {
    const by = req.user?.username || 'velin';
    const id = req.params.id;
    if (id.startsWith('navrh:') || id.startsWith('mozek:')) {
      if (req.body?.state == null) return res.status(400).json({ ok: false, error: 'u připravené věci jde měnit jen stav' });
      await ukoly.setVirtualState(id, req.body.state, { by });
      return res.json({ ok: true, id, state: req.body.state });
    }
    const task = await ukoly.updateTask(id, req.body || {}, { by });
    res.json({ ok: true, task });
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || 'nešlo upravit' });
  }
});

router.delete('/ukoly/:id', async (req, res) => {
  try {
    await ukoly.removeTask(req.params.id, { by: req.user?.username || 'velin' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || 'nešlo smazat' });
  }
});

/** A prepared file (a draft, a brief) the velín wants to show inline. */
router.get('/soubor', (req, res) => {
  const rel = String(req.query.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.includes('..') || !/^workspace\//.test(rel)) return res.status(400).json({ error: 'jen soubory z workspace/' });
  try {
    res.json({ path: rel, text: fs.readFileSync(path.join(resolveBrainPath(), rel), 'utf8') });
  } catch {
    res.status(404).json({ error: 'soubor neexistuje' });
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
      jobs: describeJobs(),
      runs: listRuns({ limit: 30 }),
      events: listEvents({ limit: 20 }),
      routes: listRoutes(),
      mozek: { pending: mozek.countPending() },
      pamet: { agent: memorySnapshot('agent'), tim: memorySnapshot('tim') },
    });
  } catch (err) {
    console.error('[velin] /agent failed', err);
    res.status(500).json({ error: err?.message || 'agent selhal' });
  }
});

/* ---- custom tasks and schedules --------------------------------- */

router.post('/agent/tasks', async (req, res) => {
  try {
    const task = await createTask({ ...req.body, createdBy: req.user?.username || 'velin' });
    res.json({ ok: true, task });
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || 'nešlo založit' });
  }
});

router.patch('/agent/tasks/:name', async (req, res) => {
  try {
    const task = await updateTask(req.params.name, req.body || {}, { by: req.user?.username || 'velin' });
    res.json({ ok: true, task });
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || 'nešlo upravit' });
  }
});

router.delete('/agent/tasks/:name', async (req, res) => {
  try {
    await removeTask(req.params.name, { by: req.user?.username || 'velin' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || 'nešlo zrušit' });
  }
});

/** Override (or reset with null) the schedule of a built-in job. */
router.patch('/agent/schedule/:job', async (req, res) => {
  try {
    const schedule = await setScheduleOverride(req.params.job, req.body?.schedule ?? null, { by: req.user?.username || 'velin' });
    res.json({ ok: true, job: req.params.job, schedule });
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || 'nešlo změnit' });
  }
});

/* ---- proposals to change the brain's rules ----------------------- */

router.get('/agent/mozek', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
  res.json({ items: mozek.listProposals({ status }) });
});

router.post('/agent/mozek/:id/schvalit', async (req, res) => {
  try {
    const r = await mozek.approve(Number(req.params.id), req.user?.username || 'velin');
    console.log(`[velin] ${req.user?.username} schválil návrh do mozku #${req.params.id}`);
    res.json(r);
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || 'nešlo schválit' });
  }
});

router.post('/agent/mozek/:id/zahodit', (req, res) => {
  try {
    res.json(mozek.reject(Number(req.params.id), req.user?.username || 'velin'));
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || 'nešlo zahodit' });
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
