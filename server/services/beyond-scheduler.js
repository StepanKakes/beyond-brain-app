/**
 * Beyond Brain — the clock.
 *
 * Until now nothing in this app ran on its own; n8n held every schedule and
 * called in. That was fine for the raw pulls, which are plain HTTP fetches, but
 * the agent's work needs the brain repo and the SDK session, both of which live
 * here. So the jobs that think run here, and n8n keeps the jobs that fetch.
 *
 * The design is deliberately dumb: one timer, one job at a time, every job
 * decides for itself whether it is due. No queue, no concurrency, no
 * distributed anything. There is one box and ten jobs.
 *
 * Safety comes from three places: a job that has nothing to do skips before
 * spending a model call, only one run is ever in flight, and every run is
 * written to the log with a git diff of what it touched.
 */
import { JOBS, isDue, jobByName } from './beyond-jobs.js';
import { isJobEnabled, markJobRan, reapOrphanedRuns, startRun } from './beyond-runs.js';

/** How often to look at the clock. Jobs decide their own cadence. */
const TICK_MS = 60_000;
/** Wait this long after boot so a restart during a deploy settles first. */
const BOOT_DELAY_MS = 90_000;

let timer = null;
let running = null; // name of the job currently in flight, or null
let paused = false;

function log(...args) {
  console.log('[scheduler]', ...args);
}

/**
 * Run one job now, regardless of schedule. Used by the tick and by the manual
 * "spustit teď" button. Returns the run record.
 */
export async function runJob(name, { triggerKind = 'manual', triggerDetail = null } = {}) {
  const job = jobByName(name);
  if (!job) throw new Error(`Neznámá úloha: ${name}`);
  if (running) throw new Error(`Právě běží ${running}, počkej na dokončení`);

  running = name;
  const run = await startRun({ job: name, triggerKind, triggerDetail });
  const lines = [];
  const jobLog = (msg) => {
    lines.push(msg);
    log(`${name}: ${msg}`);
  };

  try {
    const result = await job.run({ log: jobLog });
    markJobRan(name);
    if (result?.skipped) {
      log(`${name} přeskočeno: ${result.skipped}`);
      return await run.skip(result.skipped);
    }
    const summary = [result?.summary, lines.length ? lines.join('\n') : null]
      .filter(Boolean)
      .join('\n\n');
    log(`${name} hotovo`);
    return await run.finish({ summary: summary || null });
  } catch (err) {
    log(`${name} selhalo:`, err?.message || err);
    return await run.fail(err);
  } finally {
    running = null;
  }
}

async function tick() {
  if (paused || running) return;

  for (const job of JOBS) {
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
    return; // one job per tick, keeps the box calm
  }
}

export function startScheduler() {
  if (timer) return;

  // A deploy restarts the service; anything mid-run died with it. This happens
  // before the enabled check on purpose — the Agent screen shows those rows
  // whether the scheduler is running or not, and a phantom "běží" is confusing
  // either way.
  try {
    reapOrphanedRuns();
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
  };
}

export function setPaused(value) {
  paused = Boolean(value);
  log(paused ? 'pozastaveno' : 'spuštěno');
  return paused;
}
