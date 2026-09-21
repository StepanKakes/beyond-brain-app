/**
 * Beyond Brain — the clock, and the doorbell.
 *
 * Until now nothing in this app ran on its own; n8n held every schedule and
 * called in. That was fine for the raw pulls, which are plain HTTP fetches, but
 * the agent's work needs the brain repo and the SDK session, both of which live
 * here. So the jobs that think run here.
 *
 * The design is deliberately dumb: one timer, one job at a time, every job
 * decides for itself whether it is due. No queue of workers, no concurrency,
 * no distributed anything. One box.
 *
 * Two things can start a run. The clock (every job has a schedule, from code
 * or from `system/ulohy.json` in the brain) and an event (a WhatsApp message,
 * a finished recording, a new booking, delivered to `/api/beyond-events`).
 * Events go first: a tick drains anything waiting before it looks at the
 * calendar, so a client's message is answered in seconds, not at 06:20.
 *
 * Safety comes from four places: a job that has nothing to do skips before
 * spending a model call, only one run is ever in flight, every run is written
 * to the log with a git diff of what it touched, and what it touched is
 * committed under the job's name so the history is complete.
 */
import { allJobs, JOBS, effectiveSchedule, isDue, jobByName, setCurrentJob, modelForJob } from './beyond-jobs.js';
import {
  getJobState,
  isJobEnabled,
  markIncident,
  markJobRan,
  reapOrphanedRuns,
  recordOutcome,
  setJobEnabled,
  startRun,
} from './beyond-runs.js';
import { finishEvent, pendingEventCount, reapOrphanedEvents, takeDueEvent } from './beyond-events.js';
import { noteTaskRan } from './beyond-tasks.js';
import { brainIsDirty, commitBrain, pullBrain } from './beyond-git.js';
import { describeSchedule } from './beyond-schedule.js';
import { broadcast as tgBroadcast, sendTo as tgSendTo } from './beyond-telegram.js';
import { pruneHistory } from './beyond-history.js';
import { invalidateBrainIndex } from './brain-index.js';

/** How often to look at the clock. Jobs decide their own cadence. */
const TICK_MS = 60_000;
/** Wait this long after boot so a restart during a deploy settles first. */
const BOOT_DELAY_MS = 90_000;
/** After this many failures in a row, say so once. */
const INCIDENT_AFTER = 3;
/** Remind about an unresolved incident this often. */
const INCIDENT_REPEAT_MS = 6 * 60 * 60 * 1000;

let timer = null;
let running = null; // name of the job currently in flight, or null
let paused = false;
let lastPrune = 0;
let lastPull = 0;
/** n8n and other machines commit to origin; without this the box only saw them before a run. */
const PULL_EVERY_MS = 5 * 60 * 1000;

function log(...args) {
  console.log('[scheduler]', ...args);
}

/* ------------------------------------------------------------------ */
/* running one job                                                     */
/* ------------------------------------------------------------------ */

/**
 * Run one job now, regardless of schedule. Used by the tick, by an event and
 * by the manual "spustit teď" button. Returns the run record.
 */
export async function runJob(name, { triggerKind = 'manual', triggerDetail = null, context = null } = {}) {
  const job = jobByName(name);
  if (!job) throw new Error(`Neznámá úloha: ${name}`);
  if (running) throw new Error(`Právě běží ${running}, počkej na dokončení`);

  running = name;
  setCurrentJob(name);
  const lines = [];
  const jobLog = (msg) => {
    lines.push(msg);
    log(`${name}: ${msg}`);
  };
  // What n8n pulled overnight is on origin, not here, until we pull it.
  const pulled = await pullBrain();
  if (pulled.note) jobLog(pulled.note);
  const run = await startRun({ job: name, triggerKind, triggerDetail, context });

  let outcome;
  try {
    const result = await job.run({ log: jobLog, context: context || {} });
    markJobRan(name);
    if (job.custom) await noteTaskRan(name).catch((err) => jobLog(`stav úlohy se neuložil: ${err?.message || err}`));

    const gitNote = await commitAfterRun(job);
    if (gitNote) jobLog(gitNote);

    if (result?.skipped) {
      log(`${name} přeskočeno: ${result.skipped}`);
      recordOutcome(name, { status: 'skipped' });
      outcome = await run.skip(result.skipped);
    } else {
      const summary = [result?.summary, lines.length ? lines.join('\n') : null].filter(Boolean).join('\n\n');
      log(`${name} hotovo`);
      recordOutcome(name, { status: 'ok' });
      outcome = await run.finish({ summary: summary || null });
    }
  } catch (err) {
    const status = err?.deliveryFailed ? 'delivery_failed' : err?.blockedConfig ? 'blocked_config' : 'error';
    log(`${name} selhalo (${status}):`, err?.message || err);
    const gitNote = await commitAfterRun(job).catch(() => null);
    if (gitNote) lines.push(gitNote);
    const state = recordOutcome(name, { status, error: err?.message || String(err) });
    await reportIncident(job, state).catch((e) => log('hlášení incidentu selhalo', e?.message || e));
    outcome = await run.fail(err);
  } finally {
    running = null;
    setCurrentJob(null);
  }
  return outcome;
}

/** Whatever the run left in the working tree goes in under the job's name. */
async function commitAfterRun(job) {
  try {
    if (!(await brainIsDirty())) return null;
    const r = await commitBrain(`Agent: ${job.title || job.name}`);
    if (r.note) return r.note;
    return r.committed ? (r.pushed ? 'commit + push' : 'commit (push později)') : null;
  } catch (err) {
    return `commit selhal: ${err?.message || err}`;
  }
}

/**
 * Three failures in a row is a pattern, not bad luck. Say it once, to the
 * channel for errors if there is one, and again after six hours if it is
 * still broken. A success clears it.
 */
async function reportIncident(job, state) {
  if (state.failureStreak < INCIDENT_AFTER) return;
  const key = `${job.name}:${String(state.lastError || '').slice(0, 80)}`;
  const repeatDue = !state.incidentAt || Date.now() - Date.parse(state.incidentAt) > INCIDENT_REPEAT_MS;
  if (state.incidentKey === key && !repeatDue) return;

  const text = [
    `Agent: úloha ${job.title || job.name} selhala ${state.failureStreak}× po sobě.`,
    `Poslední chyba: ${String(state.lastError || '').slice(0, 300)}`,
    'Běží dál, ale někdo by se měl podívat. Pozastavit jde ve Velíně na obrazovce Agent.',
  ].join('\n');
  const errorChat = process.env.BEYOND_TG_ERROR_CHAT_ID;
  const delivery = errorChat ? await tgSendTo(errorChat, text) : await tgBroadcast(text);
  if (!delivery.skipped) markIncident(job.name, key);
}

/* ------------------------------------------------------------------ */
/* the tick                                                            */
/* ------------------------------------------------------------------ */

async function runEvent(ev) {
  const job = jobByName(ev.job);
  if (!job) {
    finishEvent(ev.id, { error: `neznámá úloha ${ev.job}` });
    log(`událost #${ev.id} (${ev.route}): neznámá úloha ${ev.job}`);
    return;
  }
  if (!isJobEnabled(job.name)) {
    finishEvent(ev.id, { error: 'úloha je vypnutá' });
    return;
  }
  const detail = `${ev.route}${ev.event ? ` ${ev.event}` : ''}${ev.count > 1 ? ` ×${ev.count}` : ''}`;
  try {
    const result = await runJob(job.name, {
      triggerKind: 'event',
      triggerDetail: detail,
      context: { ...ev.context, count: ev.count, route: ev.route, event: ev.event },
    });
    finishEvent(ev.id, { runId: result?.id ?? null, error: result?.error || null });
  } catch (err) {
    finishEvent(ev.id, { error: err?.message || String(err) });
  }
}

async function tick() {
  if (paused || running) return;

  // Keep the working copy current even when no job has work, so the velín
  // and the timeline show what n8n or a colleague committed minutes ago.
  if (Date.now() - lastPull > PULL_EVERY_MS) {
    lastPull = Date.now();
    const pulled = await pullBrain();
    if (pulled.note) log(pulled.note);
    if (pulled.changed) {
      invalidateBrainIndex();
      log('brain se posunul na originu, index přestavěn');
    }
  }

  // The doorbell first.
  const ev = takeDueEvent();
  if (ev) {
    await runEvent(ev);
    return;
  }

  // Then the clock. One job per tick keeps the box calm.
  for (const job of allJobs()) {
    if (!isJobEnabled(job.name)) continue;
    if (!isDue(job)) continue;

    // A job that knows it has nothing to do says so before we spend anything.
    if (typeof job.hasWork === 'function') {
      let work;
      try {
        work = await job.hasWork();
      } catch (err) {
        log(`${job.name}: hasWork selhalo`, err?.message || err);
        continue;
      }
      if (!work) {
        markJobRan(job.name);
        continue;
      }
      await runJob(job.name, { triggerKind: 'schedule', triggerDetail: work });
    } else {
      await runJob(job.name, { triggerKind: 'schedule' });
    }
    return;
  }

  // Housekeeping, once a day, when nothing else wanted the tick.
  if (Date.now() - lastPrune > 24 * 60 * 60 * 1000) {
    lastPrune = Date.now();
    try {
      const n = pruneHistory();
      if (n) log(`historie: ${n} starých sessions smazáno`);
    } catch (err) {
      log('úklid historie selhal', err?.message || err);
    }
  }
}

/* ------------------------------------------------------------------ */
/* lifecycle                                                           */
/* ------------------------------------------------------------------ */

export function startScheduler() {
  if (timer) return;

  // A deploy restarts the service; anything mid-run died with it. This happens
  // before the enabled check on purpose — the Agent screen shows those rows
  // whether the scheduler is running or not, and a phantom "běží" is confusing
  // either way.
  try {
    reapOrphanedRuns();
    const n = reapOrphanedEvents();
    if (n) log(`${n} událostí přerušených restartem uzavřeno`);
  } catch (err) {
    log('úklid nedokončených běhů selhal', err?.message || err);
  }

  if (process.env.BEYOND_SCHEDULER === '0') {
    log('vypnutý přes BEYOND_SCHEDULER=0');
    return;
  }
  log(`startuje, první tik za ${Math.round(BOOT_DELAY_MS / 1000)} s, pak každých ${TICK_MS / 1000} s`);
  setTimeout(() => {
    void tick();
    timer = setInterval(() => {
      void tick().catch((err) => log('tik selhal', err?.message || err));
    }, TICK_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }, BOOT_DELAY_MS).unref?.();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function schedulerStatus() {
  return {
    enabled: process.env.BEYOND_SCHEDULER !== '0',
    paused,
    running,
    tickMs: TICK_MS,
    pendingEvents: pendingEventCount(),
  };
}

export function setPaused(value) {
  paused = Boolean(value);
  log(paused ? 'pozastaveno' : 'spuštěno');
  return paused;
}

/** Every job with its live state, for the Agent screen and the agent's tool. */
export function describeJobs() {
  return allJobs().map((j) => {
    const state = getJobState(j.name);
    const schedule = effectiveSchedule(j);
    return {
      name: j.name,
      title: j.title,
      description: j.description,
      custom: Boolean(j.custom),
      schedule,
      cadence: describeSchedule(schedule),
      enabled: j.custom ? state.enabled && j.task?.enabled !== false : state.enabled,
      lastRunAt: state.lastRunAt,
      lastStatus: state.lastStatus,
      lastError: state.lastError,
      failureStreak: state.failureStreak,
      deliver: j.task?.deliver || null,
      createdBy: j.task?.createdBy || null,
      model: j.name === 'registr-klientu' || j.name === 'notion-raw' || j.name === 'wa-raw' || j.task?.noAgent ? null : modelForJob(j.name),
    };
  });
}

/**
 * What the agent's `beyond_schedule` tool needs from here. Handed over as an
 * object so the tools module does not import the scheduler (it is imported
 * by the SDK layer, which the jobs import — a cycle otherwise).
 */
export function jobsApi() {
  return {
    listBuiltin: () =>
      JOBS.map((j) => {
        const state = getJobState(j.name);
        return { name: j.name, title: j.title, schedule: effectiveSchedule(j), enabled: state.enabled, lastRunAt: state.lastRunAt };
      }),
    runNow: async (name, actor) => {
      const job = jobByName(name);
      if (!job) throw new Error(`Neznámá úloha: ${name}`);
      if (running) throw new Error(`Právě běží ${running}, zkus to za chvíli`);
      // Not awaited: the tool answers now, the run shows up in the log.
      runJob(name, { triggerKind: 'manual', triggerDetail: actor || 'agent' }).catch((err) =>
        log('ruční běh selhal', err?.message || err),
      );
      return name;
    },
    setEnabled: (name, enabled) => setJobEnabled(name, enabled),
  };
}
