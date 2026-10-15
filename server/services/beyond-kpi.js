/**
 * Beyond Brain — KPI for the Q4 brute force quarter.
 *
 * Three sources, one shape:
 *
 *   - `workspace/kpi/cile.json` in the brain: the targets, hand edited.
 *   - `workspace/kpi/tydny/<YYYY-Www>.json`: one file per ISO week, written
 *     each morning by the agent job `kpi-raw` from Beo (leads, pipeline,
 *     payments) and Meta Ads. Schema below and in workspace/kpi/README.md.
 *   - Cal.com live: sales calls booked, happened and no-show per week.
 *
 * Same rule as the rest of the velín: unknown is `null`, never 0. A block the
 * job could not fetch stays null and the screen says "chybí data".
 *
 * Week file schema (every number may be null when unknown):
 *
 *   {
 *     "week": "2026-W42",            // ISO week, Monday start
 *     "from": "2026-10-12",          // Monday
 *     "to": "2026-10-18",            // Sunday
 *     "updatedAt": "2026-10-15T04:30:00Z",
 *     "final": false,                // true once the week is closed (Monday run)
 *     "beo": {
 *       "newLeads": 14,              // leads created within the week
 *       "leadsBySource": [           // by keyword workflow that started the conversation
 *         { "source": "Heaton", "count": 6 },
 *         { "source": "bez workflow", "count": 3 }
 *       ],
 *       "unread": 2,                 // conversations with unread, snapshot at updatedAt
 *       "pipeline": { "callOffered": 3, "callBooked": 1, "clients": 0 },
 *       "outreachSent": null,
 *       "replies": null
 *     },
 *     "revenue": { "paidCZK": 80000, "payments": 1, "byDay": { "2026-10-14": 80000 } },
 *     "ads": { "spendCZK": 4800, "conversations": 21, "costPerConversation": 229 },
 *     "content": { "reels": 6, "youtube": 1, "source": "beo" },
 *     "errors": ["ads: konektor Meta Ads nedostupný"]
 *   }
 */
import fs from 'node:fs';
import path from 'node:path';

import { resolveBrainPath } from '../utils/brain-path.js';

import { todayIso, tz } from './beyond-time.js';

const CACHE_TTL_MS = 60_000;
let cache = { at: 0, data: null };

const CAL_API = 'https://api.cal.com/v2';
const CAL_VERSION = '2024-08-13';
const DEFAULT_EVENTS = ['strategicky-hovor', 'webinar-2030-hovor'];
const DEFAULT_PERIOD = { od: '2026-10-12', tydnu: 12 };
const WEEKS_PER_MONTH = 4.3;

/* ------------------------------------------------------------------ */
/* dates: plain YYYY-MM-DD strings, arithmetic in UTC                  */
/* ------------------------------------------------------------------ */

function d2ms(day) {
  return Date.parse(`${day}T00:00:00Z`);
}
function ms2d(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDays(day, n) {
  return ms2d(d2ms(day) + n * 86_400_000);
}
/** Monday of the week the day falls in. */
export function mondayOf(day) {
  const wd = new Date(d2ms(day)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((wd + 6) % 7));
}
/** ISO week id ("2026-W42") of a day. The week belongs to its Thursday's year. */
export function isoWeekId(day) {
  const thu = addDays(mondayOf(day), 3);
  const year = Number(thu.slice(0, 4));
  const jan4 = `${year}-01-04`;
  const week = Math.round((d2ms(mondayOf(thu)) - d2ms(mondayOf(jan4))) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}
/** The week that contains `day`, with its bounds. */
export function weekOf(day) {
  const from = mondayOf(day);
  return { week: isoWeekId(from), from, to: addDays(from, 6), month: addDays(from, 3).slice(0, 7) };
}
/** Local calendar day of an instant in the app timezone. */
function localDay(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? todayIso(new Date(t), tz()) : null;
}

/* ------------------------------------------------------------------ */
/* brain files                                                         */
/* ------------------------------------------------------------------ */

function kpiDir() {
  return path.join(resolveBrainPath(), 'workspace', 'kpi');
}

function readJson(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function readTargets() {
  const raw = readJson(path.join(kpiDir(), 'cile.json'));
  if (!raw || typeof raw !== 'object') return null;
  return raw;
}

function readWeekFile(week) {
  const raw = readJson(path.join(kpiDir(), 'tydny', `${week}.json`));
  return raw && typeof raw === 'object' ? raw : null;
}

/* ------------------------------------------------------------------ */
/* metrics                                                             */
/* ------------------------------------------------------------------ */

/**
 * What the screen shows. `dir`: max = more is better, min = less is better.
 * `agg`: how weeks fold into a month (sum, ratio of sums, or not at all).
 */
export const METRICS = [
  { key: 'newLeads', area: 'akvizice', label: 'Nové leady', unit: 'count', dir: 'max', agg: 'sum' },
  { key: 'unread', area: 'akvizice', label: 'Nepřečtené konverzace', unit: 'count', dir: 'min', agg: null },
  { key: 'outreachSent', area: 'akvizice', label: 'Oslovení', unit: 'count', dir: 'max', agg: 'sum' },
  { key: 'replies', area: 'akvizice', label: 'Odpovědi', unit: 'count', dir: 'max', agg: 'sum' },
  { key: 'callOffered', area: 'akvizice', label: 'Hovor nabídnutý (Beo)', unit: 'count', dir: 'max', agg: null },
  { key: 'callBooked', area: 'akvizice', label: 'Hovor domluvený (Beo)', unit: 'count', dir: 'max', agg: null },
  { key: 'pipelineClients', area: 'akvizice', label: 'Klient (Beo)', unit: 'count', dir: 'max', agg: null },
  { key: 'icpBooked', area: 'cally', label: 'ICP cally domluvené', unit: 'count', dir: 'max', agg: 'sum' },
  { key: 'icpHappened', area: 'cally', label: 'ICP cally proběhlé', unit: 'count', dir: 'max', agg: 'sum' },
  { key: 'noShow', area: 'cally', label: 'No show', unit: 'count', dir: 'min', agg: 'sum' },
  { key: 'showUp', area: 'cally', label: 'Show up rate', unit: 'pct', dir: 'max', agg: 'ratio' },
  { key: 'revenue', area: 'trzby', label: 'Tržby', unit: 'czk', dir: 'max', agg: 'sum' },
  { key: 'payments', area: 'trzby', label: 'Platby', unit: 'count', dir: 'max', agg: 'sum' },
  { key: 'adSpend', area: 'reklama', label: 'Spend', unit: 'czk', dir: 'max', agg: 'sum' },
  { key: 'adConversations', area: 'reklama', label: 'Konverzace z reklamy', unit: 'count', dir: 'max', agg: 'sum' },
  { key: 'costPerConversation', area: 'reklama', label: 'Cena za konverzaci', unit: 'czk', dir: 'min', agg: null },
  { key: 'costPerIcpCall', area: 'reklama', label: 'Spend na proběhlý ICP call', unit: 'czk', dir: 'min', agg: null },
  { key: 'reels', area: 'obsah', label: 'Reels', unit: 'count', dir: 'max', agg: 'sum' },
  { key: 'youtube', area: 'obsah', label: 'YouTube videa', unit: 'count', dir: 'max', agg: 'sum' },
];
const BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m]));

/** Weekly target: per-week override, then per-month weekly, then flat weekly, then month / 4.3. */
function weekTarget(cile, key, week, month) {
  const perWeek = cile?.tydny?.[week]?.[key];
  if (perWeek !== undefined) return num(perWeek);
  const perMonthWeekly = cile?.tydneVMesici?.[month]?.[key];
  if (perMonthWeekly !== undefined) return num(perMonthWeekly);
  const flat = cile?.tydne?.[key];
  if (flat !== undefined) return num(flat);
  const monthly = num(cile?.mesicne?.[month]?.[key]);
  if (monthly != null && BY_KEY[key]?.agg === 'sum') {
    const per = num(cile?.tydnuVMesici) || WEEKS_PER_MONTH;
    const weekly = monthly / per;
    return weekly >= 100 ? Math.round(weekly) : Math.round(weekly * 10) / 10;
  }
  return null;
}

function monthTarget(cile, key, month) {
  const monthly = cile?.mesicne?.[month]?.[key];
  if (monthly !== undefined) return num(monthly);
  const m = BY_KEY[key];
  if (m?.agg === 'ratio') return num(cile?.tydneVMesici?.[month]?.[key] ?? cile?.tydne?.[key]);
  const weekly = num(cile?.tydneVMesici?.[month]?.[key] ?? cile?.tydne?.[key]);
  if (weekly != null && m?.agg === 'sum') return Math.round(weekly * (num(cile?.tydnuVMesici) || WEEKS_PER_MONTH));
  return null;
}

/* ------------------------------------------------------------------ */
/* Cal.com: sales calls in the period                                  */
/* ------------------------------------------------------------------ */

function calKey() {
  const k = process.env.BEYOND_CALCOM_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

async function calPage(status, afterStart, skip) {
  const url = new URL(`${CAL_API}/bookings`);
  url.searchParams.set('status', status);
  url.searchParams.set('afterStart', afterStart);
  url.searchParams.set('take', '100');
  url.searchParams.set('skip', String(skip));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${calKey()}`, 'cal-api-version': CAL_VERSION },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Cal.com ${res.status} ${res.statusText}`);
    const body = await res.json();
    return { items: Array.isArray(body?.data) ? body.data : [], more: Boolean(body?.pagination?.hasNextPage) };
  } finally {
    clearTimeout(timer);
  }
}

/** Every booking (past, upcoming, cancelled) starting from a week before the period. */
async function fetchBookings(fromDay) {
  const afterStart = `${addDays(fromDay, -7)}T00:00:00Z`;
  const out = [];
  for (const status of ['past', 'upcoming', 'cancelled']) {
    for (let skip = 0, guard = 0; guard < 10; guard += 1) {
      const page = await calPage(status, afterStart, skip);
      out.push(...page.items);
      if (!page.more || !page.items.length) break;
      skip += page.items.length;
    }
  }
  const seen = new Set();
  return out.filter((b) => (seen.has(b.uid) ? false : seen.add(b.uid)));
}

/**
 * Per week: booked = created that week (not cancelled, a reschedule leaves a
 * cancelled original behind), happened = started that week, already over and
 * the attendee not marked absent, noShow = attendee marked absent. Month
 * sums start at the period start (October is only its Q4 part).
 * No-show only counts if someone marks it in Cal.com.
 */
function callsByWeek(bookings, events, nowMs, fromDay) {
  const wanted = new Set(events.map((e) => String(e).toLowerCase()));
  const weeks = new Map();
  const months = new Map();
  const bump = (map, key, field) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, { icpBooked: 0, icpHappened: 0, noShow: 0 });
    map.get(key)[field] += 1;
  };
  for (const b of bookings) {
    const slug = String(b.eventType?.slug || '').toLowerCase();
    if (!wanted.has(slug)) continue;
    const cancelled = b.status === 'cancelled' || b.status === 'rejected';
    if (!cancelled && b.createdAt) {
      const day = localDay(b.createdAt);
      if (day) {
        bump(weeks, weekOf(day).week, 'icpBooked');
        if (day >= fromDay) bump(months, day.slice(0, 7), 'icpBooked');
      }
    }
    if (cancelled) continue;
    const end = Date.parse(b.end || b.start);
    if (!Number.isFinite(end) || end > nowMs) continue;
    const day = localDay(b.start);
    if (!day) continue;
    const attendees = Array.isArray(b.attendees) ? b.attendees : [];
    const absent = attendees.length > 0 && attendees.every((a) => a.absent === true);
    const field = absent ? 'noShow' : 'icpHappened';
    bump(weeks, weekOf(day).week, field);
    if (day >= fromDay) bump(months, day.slice(0, 7), field);
  }
  return { weeks, months };
}

/* ------------------------------------------------------------------ */
/* assembly                                                            */
/* ------------------------------------------------------------------ */

function showUp(happened, noShow) {
  if (happened == null || noShow == null) return null;
  const all = happened + noShow;
  return all > 0 ? Math.round((happened / all) * 100) : null;
}

function valuesFromFile(file) {
  const beo = file?.beo && typeof file.beo === 'object' ? file.beo : null;
  const rev = file?.revenue && typeof file.revenue === 'object' ? file.revenue : null;
  const ads = file?.ads && typeof file.ads === 'object' ? file.ads : null;
  const content = file?.content && typeof file.content === 'object' ? file.content : null;
  return {
    newLeads: num(beo?.newLeads),
    unread: num(beo?.unread),
    outreachSent: num(beo?.outreachSent),
    replies: num(beo?.replies),
    callOffered: num(beo?.pipeline?.callOffered),
    callBooked: num(beo?.pipeline?.callBooked),
    pipelineClients: num(beo?.pipeline?.clients),
    revenue: num(rev?.paidCZK),
    payments: num(rev?.payments),
    adSpend: num(ads?.spendCZK),
    adConversations: num(ads?.conversations),
    costPerConversation: num(ads?.costPerConversation),
    reels: num(content?.reels),
    youtube: num(content?.youtube),
  };
}

function leadsBySource(file) {
  const list = file?.beo?.leadsBySource;
  if (!Array.isArray(list)) return null;
  return list
    .map((r) => ({ source: String(r?.source || 'bez workflow'), count: num(r?.count) }))
    .filter((r) => r.count != null)
    .sort((a, b) => b.count - a.count);
}

export async function getKpi({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const errors = [];
  const cile = readTargets();
  const period = { ...DEFAULT_PERIOD, ...(cile?.obdobi || {}) };
  const start = mondayOf(String(period.od));
  const count = Math.max(1, Math.min(26, Number(period.tydnu) || 12));
  const today = todayIso();
  const current = weekOf(today).week;
  const nowMs = Date.now();

  // Cal.com
  const events = Array.isArray(cile?.cally?.udalosti) && cile.cally.udalosti.length ? cile.cally.udalosti : DEFAULT_EVENTS;
  let cal = null;
  let calError = null;
  if (calKey()) {
    try {
      cal = callsByWeek(await fetchBookings(start), events, nowMs, start);
    } catch (err) {
      calError = err?.message || 'Cal.com nedostupný';
      errors.push(`Cal.com: ${calError}`);
    }
  }

  const weeks = [];
  let filesFound = 0;
  for (let i = 0; i < count; i += 1) {
    const w = weekOf(addDays(start, i * 7));
    const status = w.week === current ? 'current' : w.from > today ? 'future' : 'past';
    const file = status === 'future' ? null : readWeekFile(w.week);
    if (file) filesFound += 1;
    const values = file ? valuesFromFile(file) : valuesFromFile(null);
    if (cal && status !== 'future') {
      const c = cal.weeks.get(w.week) || { icpBooked: 0, icpHappened: 0, noShow: 0 };
      values.icpBooked = c.icpBooked;
      values.icpHappened = c.icpHappened;
      values.noShow = c.noShow;
      values.showUp = showUp(c.icpHappened, c.noShow);
    } else {
      values.icpBooked = null;
      values.icpHappened = null;
      values.noShow = null;
      values.showUp = null;
    }
    values.costPerIcpCall =
      values.adSpend != null && values.icpHappened ? Math.round(values.adSpend / values.icpHappened) : null;

    const targets = {};
    for (const m of METRICS) targets[m.key] = weekTarget(cile, m.key, w.week, w.month);

    weeks.push({
      ...w,
      status,
      hasFile: Boolean(file),
      final: Boolean(file?.final),
      updatedAt: typeof file?.updatedAt === 'string' ? file.updatedAt : null,
      errors: Array.isArray(file?.errors) ? file.errors.map(String).slice(0, 10) : [],
      values,
      targets,
      leadsBySource: file ? leadsBySource(file) : null,
      revenueByDay: file?.revenue?.byDay && typeof file.revenue.byDay === 'object' ? file.revenue.byDay : null,
    });
  }

  // Months: revenue by paid day when the file has it, else by the week's
  // Thursday; calls by their own dates from Cal.com.
  const monthKeys = [...new Set(weeks.map((w) => w.month))];
  const months = monthKeys.map((month) => {
    const inMonth = weeks.filter((w) => w.month === month && w.status !== 'future');
    let revenue = null;
    let payments = null;
    for (const w of weeks) {
      if (w.status === 'future') continue;
      if (w.revenueByDay) {
        for (const [day, amount] of Object.entries(w.revenueByDay)) {
          if (day >= start && day.slice(0, 7) === month && num(amount) != null) revenue = (revenue || 0) + amount;
        }
      } else if (w.month === month && w.values.revenue != null) {
        revenue = (revenue || 0) + w.values.revenue;
      }
      if (w.month === month && w.values.payments != null) payments = (payments || 0) + w.values.payments;
    }
    const c = cal ? cal.months.get(month) || { icpBooked: 0, icpHappened: 0, noShow: 0 } : null;
    const values = {
      revenue,
      payments,
      icpBooked: c ? c.icpBooked : null,
      icpHappened: c ? c.icpHappened : null,
      noShow: c ? c.noShow : null,
      showUp: c ? showUp(c.icpHappened, c.noShow) : null,
    };
    const targets = {};
    for (const key of Object.keys(values)) targets[key] = monthTarget(cile, key, month);
    return { month, weeksIn: inMonth.length, values, targets };
  });

  const data = {
    configured: Boolean(cile),
    fetchedAt: new Date().toISOString(),
    period: { from: start, to: addDays(start, count * 7 - 1), weeks: count },
    currentWeek: current,
    hasWeekFiles: filesFound > 0,
    calcom: { configured: Boolean(calKey()), error: calError, events },
    metrics: METRICS,
    /** cile.json as written, for anyone who wants the raw targets. */
    targets: cile,
    weeks,
    months,
    errors,
  };
  cache = { at: Date.now(), data };
  return data;
}

export function invalidateKpiCache() {
  cache = { at: 0, data: null };
}
