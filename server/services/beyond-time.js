/**
 * Beyond Brain — whose clock.
 *
 * The box sits in Prague; the people using it do not always. "Ráno v 06:40"
 * means the morning where Tim is, not where the machine is, and "dnes" on a
 * task means his today. One timezone for the whole app, from `BEYOND_TZ`
 * (default Europe/Prague), changeable without a deploy.
 *
 * The trick used everywhere: a "wall" Date is a Date whose UTC fields carry
 * the wall-clock fields in that zone. Schedule arithmetic then runs on UTC
 * getters and setters, which have no DST surprises, and the result is
 * converted back.
 */

export function tz() {
  const t = process.env.BEYOND_TZ;
  return t && t.trim() ? t.trim() : 'Europe/Prague';
}

const fmtCache = new Map();
function formatter(zone) {
  if (!fmtCache.has(zone)) {
    fmtCache.set(
      zone,
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
      }),
    );
  }
  return fmtCache.get(zone);
}

const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock fields of an instant in the zone. */
export function parts(date = new Date(), zone = tz()) {
  const out = {};
  for (const p of formatter(zone).formatToParts(date)) {
    if (p.type === 'weekday') out.weekday = WD[p.value] ?? 0;
    else if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second, weekday: out.weekday };
}

/** YYYY-MM-DD in the zone. */
export function todayIso(date = new Date(), zone = tz()) {
  const p = parts(date, zone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Minutes the zone is ahead of UTC at that instant. */
export function offsetMinutes(date = new Date(), zone = tz()) {
  const p = parts(date, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** A Date whose UTC fields equal the wall clock in the zone. */
export function toWall(date, zone = tz()) {
  return new Date(date.getTime() + offsetMinutes(date, zone) * 60_000);
}

/** Back from a wall Date to the real instant. Two passes handle DST edges. */
export function fromWall(wall, zone = tz()) {
  let guess = new Date(wall.getTime() - offsetMinutes(wall, zone) * 60_000);
  guess = new Date(wall.getTime() - offsetMinutes(guess, zone) * 60_000);
  return guess;
}

/** Local wall-clock string for logs and prompts, e.g. "21. 9. 2026 06:40". */
export function formatLocal(date = new Date(), zone = tz()) {
  const p = parts(date, zone);
  return `${p.day}. ${p.month}. ${p.year} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** HH:MM in the zone. */
export function timeLocal(date, zone = tz()) {
  const p = parts(date, zone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Same calendar day in the zone? */
export function sameDay(a, b, zone = tz()) {
  return todayIso(a, zone) === todayIso(b, zone);
}
