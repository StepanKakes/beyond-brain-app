/**
 * Beyond Brain — when is a job due.
 *
 * One small vocabulary for every kind of timing the agent needs, so a job
 * written by a person in code, a job the agent created from a sentence and a
 * one-shot "za tři dny" all answer the same question: given when it last ran,
 * is it due now, and when is the next time?
 *
 *   { kind: 'every',  minutes: 10 }
 *   { kind: 'daily',  time: '06:20' }
 *   { kind: 'weekly', weekday: 1, time: '08:00' }      // 0 = neděle
 *   { kind: 'cron',   expr: '0 9 * * 1-5' }             // pět polí, lokální čas
 *   { kind: 'at',     at: '2026-09-23T16:00:00+02:00' } // jednou
 *   { kind: 'manual' }                                   // jen tlačítkem nebo událostí
 *
 * All times are wall-clock time in the app's zone (`BEYOND_TZ`, see
 * beyond-time.js), which is where the people are, not where the box is. The
 * arithmetic runs on "wall" Dates (UTC fields = wall clock) so DST cannot
 * shift a 06:20 job to 05:20.
 */
import { fromWall, toWall } from './beyond-time.js';

const WEEKDAYS = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];

/* ------------------------------------------------------------------ */
/* cron                                                                */
/* ------------------------------------------------------------------ */

/**
 * Parse one cron field into a Set of allowed values.
 * Supports `*`, `a`, `a,b`, `a-b`, `* /n`, `a-b/n`, and names for weekdays.
 */
function parseField(field, min, max, names = null) {
  const out = new Set();
  const raw = String(field).trim().toLowerCase();
  if (!raw) throw new Error('prázdné pole');
  for (const part of raw.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`neplatný krok: ${part}`);
    let lo;
    let hi;
    if (rangePart === '*' || rangePart === '') {
      lo = min;
      hi = max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-').map((v) => named(v, names));
      lo = a;
      hi = b;
    } else {
      lo = named(rangePart, names);
      hi = stepPart ? max : lo;
    }
    if (![lo, hi].every((v) => Number.isInteger(v))) throw new Error(`neplatná hodnota: ${part}`);
    if (lo < min || hi > max || lo > hi) throw new Error(`mimo rozsah ${min}-${max}: ${part}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

function named(value, names) {
  if (names && value in names) return names[value];
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

const DOW_NAMES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, ne: 0, po: 1, ut: 2, st: 3, ct: 4, pa: 5, so: 6 };
const MON_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Parse a five-field cron expression. Throws with a Czech reason when it is not one. */
export function parseCron(expr) {
  const fields = String(expr || '').trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('cron potřebuje pět polí: minuta hodina den měsíc den_v_týdnu');
  const [m, h, dom, mon, dow] = fields;
  const parsed = {
    minute: parseField(m, 0, 59),
    hour: parseField(h, 0, 23),
    dom: parseField(dom, 1, 31),
    month: parseField(mon, 1, 12, MON_NAMES),
    dow: parseField(dow.replace(/7/g, '0'), 0, 6, DOW_NAMES),
    domAny: dom.trim() === '*',
    dowAny: dow.trim() === '*',
  };
  return parsed;
}

/** Next minute strictly after `from` that matches. Bounded to two years. */
function cronNext(parsed, from) {
  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  const limit = from.getTime() + 2 * 366 * 24 * 60 * 60 * 1000;
  while (d.getTime() < limit) {
    if (!parsed.month.has(d.getUTCMonth() + 1)) {
      d.setUTCMonth(d.getUTCMonth() + 1, 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    const domOk = parsed.dom.has(d.getUTCDate());
    const dowOk = parsed.dow.has(d.getUTCDay());
    const dayOk =
      !parsed.domAny && !parsed.dowAny ? domOk || dowOk : !parsed.domAny ? domOk : !parsed.dowAny ? dowOk : true;
    if (!dayOk) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!parsed.hour.has(d.getUTCHours())) {
      d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!parsed.minute.has(d.getUTCMinutes())) {
      d.setUTCMinutes(d.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* the vocabulary                                                      */
/* ------------------------------------------------------------------ */

function parseTime(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (!m) throw new Error(`čas musí být HH:MM, dostal jsem „${time}"`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error(`neplatný čas ${time}`);
  return { hour, minute };
}

/**
 * Validate and normalize a schedule object. Accepts a few loose spellings the
 * agent is likely to produce and returns the canonical shape, or throws.
 */
export function normalizeSchedule(input) {
  if (!input || typeof input !== 'object') throw new Error('rozvrh chybí');
  const kind = String(input.kind || '').toLowerCase();
  switch (kind) {
    case 'every': {
      const minutes = Number(input.minutes ?? (input.hours != null ? Number(input.hours) * 60 : NaN));
      if (!Number.isFinite(minutes) || minutes < 1) throw new Error('every potřebuje minutes >= 1');
      return { kind: 'every', minutes: Math.round(minutes) };
    }
    case 'daily': {
      const { hour, minute } = parseTime(input.time);
      return { kind: 'daily', time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
    }
    case 'weekly': {
      const { hour, minute } = parseTime(input.time);
      let weekday = input.weekday;
      if (typeof weekday === 'string') {
        const key = weekday.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 3);
        weekday = DOW_NAMES[key] ?? DOW_NAMES[key.slice(0, 2)];
      }
      weekday = Number(weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('weekly potřebuje weekday 0 až 6 (0 = neděle)');
      return { kind: 'weekly', weekday, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
    }
    case 'cron': {
      parseCron(input.expr);
      return { kind: 'cron', expr: String(input.expr).trim() };
    }
    case 'at': {
      const t = Date.parse(input.at);
      if (!Number.isFinite(t)) throw new Error('at potřebuje datum a čas v ISO tvaru');
      return { kind: 'at', at: new Date(t).toISOString() };
    }
    case 'manual':
      return { kind: 'manual' };
    default:
      throw new Error(`neznámý druh rozvrhu „${input.kind}", umím every, daily, weekly, cron, at, manual`);
  }
}

/**
 * When should this run next, given when it last ran. `null` means never on
 * its own (manual, or a one-shot that already fired).
 */
export function nextRunAt(schedule, { lastRunAt = null, now = new Date() } = {}) {
  const wall = nextRunWall(schedule, { lastW: lastRunAt ? toWall(new Date(lastRunAt)) : null, nowW: toWall(now) });
  return wall ? fromWall(wall) : null;
}

/** Same, but everything in wall-clock Dates (UTC fields = local wall clock). */
function nextRunWall(schedule, { lastW, nowW }) {
  const last = lastW;
  const now = nowW;
  switch (schedule.kind) {
    case 'every': {
      if (!last) return now;
      return new Date(last.getTime() + schedule.minutes * 60_000);
    }
    case 'daily': {
      const { hour, minute } = parseTime(schedule.time);
      const today = new Date(now);
      today.setUTCHours(hour, minute, 0, 0);
      // Already ran today → tomorrow. Otherwise today's slot, which may
      // already be in the past (= due now, a missed slot fires once).
      if (last && sameWallDay(last, now)) today.setUTCDate(today.getUTCDate() + 1);
      return today;
    }
    case 'weekly': {
      const { hour, minute } = parseTime(schedule.time);
      const d = new Date(now);
      d.setUTCHours(hour, minute, 0, 0);
      const delta = (schedule.weekday - d.getUTCDay() + 7) % 7;
      d.setUTCDate(d.getUTCDate() + delta);
      if (delta === 0 && last && sameWallDay(last, now)) d.setUTCDate(d.getUTCDate() + 7);
      return d;
    }
    case 'cron': {
      // Next matching minute after the last run (or after the previous
      // minute when it never ran). A slot missed while another job held the
      // box fires once, late, rather than never.
      const parsed = parseCron(schedule.expr);
      return cronNext(parsed, last || new Date(now.getTime() - 60_000));
    }
    case 'at': {
      const atW = toWall(new Date(schedule.at));
      if (last && last.getTime() >= atW.getTime()) return null;
      return atW;
    }
    default:
      return null;
  }
}

/** Is the job due at `now`? A schedule with a fixed time fires once per period. */
export function isDueAt(schedule, { lastRunAt = null, now = new Date() } = {}) {
  const nowW = toWall(now);
  const next = nextRunWall(schedule, { lastW: lastRunAt ? toWall(new Date(lastRunAt)) : null, nowW });
  if (!next) return false;
  return next.getTime() <= nowW.getTime();
}

function sameWallDay(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

/** Human wording for the Agent screen. */
export function describeSchedule(schedule) {
  if (!schedule) return 'ručně';
  switch (schedule.kind) {
    case 'every':
      return schedule.minutes % 60 === 0 && schedule.minutes >= 60
        ? `každých ${schedule.minutes / 60} h`
        : `každých ${schedule.minutes} min`;
    case 'daily':
      return `denně ${schedule.time}`;
    case 'weekly':
      return `týdně, ${WEEKDAYS[schedule.weekday]} ${schedule.time}`;
    case 'cron':
      return `cron ${schedule.expr}`;
    case 'at': {
      const w = toWall(new Date(schedule.at));
      return `jednou, ${w.getUTCDate()}. ${w.getUTCMonth() + 1}. ${String(w.getUTCHours()).padStart(2, '0')}:${String(w.getUTCMinutes()).padStart(2, '0')}`;
    }
    default:
      return 'ručně';
  }
}

/** Legacy shapes still used by the built-in jobs, mapped onto the vocabulary. */
export function scheduleFromLegacy(job) {
  if (job.everyMs) return { kind: 'every', minutes: Math.max(1, Math.round(job.everyMs / 60_000)) };
  if (job.dailyAt) return { kind: 'daily', time: `${String(job.dailyAt.hour).padStart(2, '0')}:${String(job.dailyAt.minute).padStart(2, '0')}` };
  if (job.weeklyAt) {
    return {
      kind: 'weekly',
      weekday: job.weeklyAt.weekday,
      time: `${String(job.weeklyAt.hour).padStart(2, '0')}:${String(job.weeklyAt.minute).padStart(2, '0')}`,
    };
  }
  return { kind: 'manual' };
}
