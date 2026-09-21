/**
 * Beyond Brain — each person's Google calendar, read through its secret
 * iCal address.
 *
 * Not every call is booked through Cal.com; Tim's often sit straight in his
 * Google calendar. Google gives every calendar a private iCal address
 * (Settings → the calendar → "Secret address in iCal format"), and reading
 * that needs no Google Cloud project, no OAuth consent screen, no token that
 * expires: the person pastes one link once. The address is stored per
 * person as `BEYOND_ICS_<KEY>` in the app settings.
 *
 * The feed is fetched every few minutes and cut down to what looks like a
 * call: a timed event in the window with at least one other attendee, a
 * meeting link, or a client's name in the title. Simple recurrences are
 * expanded (daily, weekly with days, an interval, until or count, EXDATE);
 * anything fancier shows only its first occurrence.
 */
import { getPeople } from './beyond-people.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const cache = new Map(); // personKey → { at, url, events }

export function icsKeyFor(personKey) {
  return `BEYOND_ICS_${String(personKey).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export function icsUrlFor(personKey) {
  const v = process.env[icsKeyFor(personKey)];
  return v && v.trim() ? v.trim() : null;
}

/** Which people have a calendar wired, for the UI. */
export function calendarStatus() {
  const out = {};
  for (const p of getPeople()) out[p.key] = Boolean(icsUrlFor(p.key));
  return out;
}

export function anyCalendar() {
  return getPeople().some((p) => icsUrlFor(p.key));
}

export function invalidateCalendars() {
  cache.clear();
}

/* ------------------------------------------------------------------ */
/* ical parsing                                                        */
/* ------------------------------------------------------------------ */

/** Lines, with RFC 5545 folding undone. */
function unfold(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(s) {
  return String(s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/** Split "NAME;PARAM=V;PARAM2=V:value" into its parts. */
function parseLine(line) {
  const idx = line.indexOf(':');
  if (idx < 0) return null;
  const head = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const [name, ...params] = head.split(';');
  const p = {};
  for (const par of params) {
    const eq = par.indexOf('=');
    if (eq > 0) p[par.slice(0, eq).toUpperCase()] = par.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params: p, value };
}

/** Minutes east of UTC for a zone at an instant, via Intl. */
function zoneOffsetMinutes(zone, date) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const parts = {};
    for (const part of f.formatToParts(date)) if (part.type !== 'literal') parts[part.type] = Number(part.value);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return Math.round((asUtc - date.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/** An ical date or date-time to epoch ms; `null` for all-day (DATE) values. */
function parseDate(value, params = {}) {
  const v = String(value || '').trim();
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) return { allDay: true, ms: Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)) };
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const local = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7] === 'Z') return { allDay: false, ms: local };
  const zone = params.TZID;
  if (!zone) return { allDay: false, ms: local }; // floating: take as UTC, rare in Google feeds
  // Two passes so a DST edge resolves to the right offset.
  let guess = local - zoneOffsetMinutes(zone, new Date(local)) * 60_000;
  guess = local - zoneOffsetMinutes(zone, new Date(guess)) * 60_000;
  return { allDay: false, ms: guess };
}

function parseRrule(value) {
  const out = {};
  for (const part of String(value || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return out;
}

const DAY_CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * Occurrences of a recurring event inside [from, to]. Daily and weekly rules
 * with INTERVAL, BYDAY, UNTIL and COUNT; other frequencies give the master
 * occurrence only. Google exports every changed instance as its own VEVENT
 * with RECURRENCE-ID, and those are dropped from the expansion via EXDATE-
 * like handling by the caller.
 */
function expand(ev, from, to) {
  if (!ev.rrule) return [ev.start];
  const r = parseRrule(ev.rrule);
  const freq = r.FREQ;
  const interval = Math.max(1, parseInt(r.INTERVAL || '1', 10));
  const until = r.UNTIL ? parseDate(r.UNTIL)?.ms ?? Infinity : Infinity;
  const count = r.COUNT ? parseInt(r.COUNT, 10) : Infinity;
  const out = [];
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return [ev.start];
  const stepMs = (freq === 'DAILY' ? 1 : 7) * interval * 24 * 60 * 60 * 1000;
  const byDay = freq === 'WEEKLY' && r.BYDAY ? r.BYDAY.split(',').map((d) => DAY_CODES[d.slice(-2)]).filter((d) => d != null) : null;
  let produced = 0;
  // Walk period by period from the master start; inside a weekly period
  // place the BYDAY days relative to that week.
  for (let base = ev.start, guard = 0; base <= to && base <= until && produced < count && guard < 2000; base += stepMs, guard += 1) {
    const candidates = [];
    if (byDay) {
      const baseDay = new Date(base).getUTCDay();
      for (const d of byDay) candidates.push(base + ((d - baseDay + 7) % 7) * 24 * 60 * 60 * 1000);
    } else candidates.push(base);
    for (const c of candidates.sort((a, b) => a - b)) {
      if (c > until || produced >= count) break;
      if (c < ev.start) continue;
      produced += 1;
      if (c >= from && c <= to) out.push(c);
    }
  }
  return out;
}

/** VEVENTs of a feed, raw. */
export function parseIcs(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = { attendees: [], exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case 'UID': cur.uid = p.value; break;
      case 'SUMMARY': cur.title = unescapeText(p.value); break;
      case 'DESCRIPTION': cur.description = unescapeText(p.value); break;
      case 'LOCATION': cur.location = unescapeText(p.value); break;
      case 'STATUS': cur.status = p.value; break;
      case 'RRULE': cur.rrule = p.value; break;
      case 'RECURRENCE-ID': cur.recurrenceId = parseDate(p.value, p.params)?.ms ?? null; break;
      case 'EXDATE':
        for (const v of p.value.split(',')) { const d = parseDate(v, p.params); if (d) cur.exdates.push(d.ms); }
        break;
      case 'DTSTART': { const d = parseDate(p.value, p.params); if (d) { cur.start = d.ms; cur.allDay = d.allDay; } break; }
      case 'DTEND': { const d = parseDate(p.value, p.params); if (d) cur.end = d.ms; break; }
      case 'ORGANIZER': cur.organizer = { email: p.value.replace(/^mailto:/i, ''), name: p.params.CN || null }; break;
      case 'ATTENDEE': cur.attendees.push({ email: p.value.replace(/^mailto:/i, ''), name: p.params.CN || null, status: p.params.PARTSTAT || null }); break;
      case 'X-GOOGLE-CONFERENCE': cur.conference = p.value; break;
      default: break;
    }
  }
  return events;
}

const LINK_RE = /https?:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|cal\.com\/video|whereby\.com)[^\s"'<>)]*/i;

function meetingLink(ev) {
  if (ev.conference) return ev.conference;
  for (const field of [ev.location, ev.description]) {
    const m = LINK_RE.exec(field || '');
    if (m) return m[0];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* public                                                              */
/* ------------------------------------------------------------------ */

async function fetchFeed(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'BeyondBrain/1.0' } });
    if (!res.ok) throw new Error(`kalendář ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The events that look like calls for one person, in the window, as
 * bookings in the same shape Cal.com gives (start, end, title, attendees,
 * hosts, meetingUrl), so the calls module can treat both the same way.
 */
export async function calendarBookings(person, { from, to, force = false, ownEmails = [] } = {}) {
  const url = icsUrlFor(person.key);
  if (!url) return { events: [], error: null };
  const c = cache.get(person.key);
  let raw;
  if (!force && c && c.url === url && Date.now() - c.at < CACHE_TTL_MS) raw = c.events;
  else {
    try {
      raw = parseIcs(await fetchFeed(url));
      cache.set(person.key, { at: Date.now(), url, events: raw });
    } catch (err) {
      if (c?.events) raw = c.events;
      else return { events: [], error: err?.message || 'kalendář nedostupný' };
    }
  }

  // Changed instances of a recurring event carry RECURRENCE-ID; their master
  // must not also produce that occurrence.
  const moved = new Map();
  for (const ev of raw) if (ev.recurrenceId != null && ev.uid) {
    if (!moved.has(ev.uid)) moved.set(ev.uid, new Set());
    moved.get(ev.uid).add(ev.recurrenceId);
  }
  const mine = new Set([person.calcomEmail, ...ownEmails].filter(Boolean).map((e) => e.toLowerCase()));
  const out = [];
  for (const ev of raw) {
    if (!ev.start || ev.allDay || ev.status === 'CANCELLED') continue;
    const durationMs = ev.end && ev.end > ev.start ? ev.end - ev.start : 60 * 60 * 1000;
    const others = ev.attendees.filter((a) => a.email && !mine.has(a.email.toLowerCase()) && a.status !== 'DECLINED');
    const link = meetingLink(ev);
    // A call has someone else in it or a room to meet in; a reminder to
    // buy milk has neither.
    if (!others.length && !link) continue;
    const starts = ev.recurrenceId != null ? [ev.start] : expand(ev, from, to).filter((s) => !ev.exdates.includes(s) && !(moved.get(ev.uid)?.has(s)));
    for (const s of starts) {
      if (s + durationMs < from || s > to) continue;
      out.push({
        id: `ics:${person.key}:${ev.uid}:${s}`,
        uid: `ics:${person.key}:${ev.uid}:${s}`,
        title: ev.title || 'Hovor',
        start: new Date(s).toISOString(),
        end: new Date(s + durationMs).toISOString(),
        duration: Math.round(durationMs / 60_000),
        status: 'accepted',
        meetingUrl: link,
        location: ev.location || null,
        eventType: null,
        hosts: [{ email: person.calcomEmail || null, name: person.displayName, username: null }],
        attendees: others.map((a) => ({ name: a.name, email: a.email })),
        source: 'google',
      });
    }
  }
  return { events: out, error: null };
}
