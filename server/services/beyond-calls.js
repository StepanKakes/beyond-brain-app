/**
 * Beyond Brain — scheduled calls, from Cal.com.
 *
 * Answers three questions the velín asks: what is booked, who of ours is
 * running it, and is one happening right now. A booking is matched to a brain
 * client by the attendee's e-mail (which `profil.md` records) and falls back to
 * matching on the attendee's name, because not every profile has the address.
 *
 * Cal.com is optional. Without `BEYOND_CALCOM_API_KEY` every endpoint answers
 * `{ configured: false }` and the UI says so, rather than pretending nobody has
 * any calls booked, which is a far more dangerous kind of empty.
 */

import { anyCalendar, calendarBookings } from './beyond-kalendar.js';

const API_BASE = 'https://api.cal.com/v2';
/** Cal.com dates the API surface; this is the version these shapes come from. */
const API_VERSION = '2024-08-13';

const CACHE_TTL_MS = 60_000;
let cache = { at: 0, data: null };

function apiKey() {
  const k = process.env.BEYOND_CALCOM_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

/** Something to read calls from: Cal.com, a person's Google calendar, or both. */
export function isConfigured() {
  return Boolean(apiKey()) || anyCalendar();
}

async function callApi(pathname, params = {}) {
  const key = apiKey();
  if (!key) return null;
  const url = new URL(API_BASE + pathname);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        'cal-api-version': API_VERSION,
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Cal.com ${res.status} ${res.statusText}`);
    }
    const body = await res.json();
    return body?.data ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* matching                                                            */
/* ------------------------------------------------------------------ */

function normalise(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Which brain client this booking is with. E-mail is authoritative; the name
 * fallback needs both parts of the name to match so that "Jakub" alone never
 * picks one of the two Jakubs at random.
 */
function matchClient(booking, clients) {
  const attendees = Array.isArray(booking.attendees) ? booking.attendees : [];
  const emails = attendees.map((a) => normalise(a.email)).filter(Boolean);

  for (const c of clients) {
    if (c.email && emails.includes(normalise(c.email))) return c;
  }

  const names = attendees.map((a) => normalise(a.name)).filter(Boolean);
  const haystack = [...names, normalise(booking.title)].join(' | ');
  for (const c of clients) {
    const parts = normalise(c.name).split(/\s+/).filter((p) => p.length > 2);
    if (parts.length >= 2 && parts.slice(0, 2).every((p) => haystack.includes(p))) return c;
  }
  return null;
}

/** Which of our people is hosting, matched against the configured roster. */
function matchHost(booking, people) {
  const hosts = Array.isArray(booking.hosts) ? booking.hosts : [];
  for (const h of hosts) {
    const email = normalise(h.email);
    const name = normalise(h.name);
    const person = people.find(
      (p) =>
        (p.calcomEmail && normalise(p.calcomEmail) === email) ||
        (p.calcomUsername && normalise(p.calcomUsername) === normalise(h.username)) ||
        (p.displayName && normalise(p.displayName) === name),
    );
    if (person) return { key: person.key, name: person.displayName };
  }
  const first = hosts[0];
  return first ? { key: null, name: first.name } : null;
}

function shape(booking, clients, people, now) {
  const start = Date.parse(booking.start);
  const end = Date.parse(booking.end);
  const client = matchClient(booking, clients);
  const host = matchHost(booking, people);
  return {
    id: booking.id,
    uid: booking.uid,
    title: booking.title,
    startIso: booking.start,
    endIso: booking.end,
    durationMin: booking.duration ?? null,
    status: booking.status,
    meetingUrl: booking.meetingUrl || booking.location || null,
    eventSlug: booking.eventType?.slug || null,
    host,
    attendees: (booking.attendees || []).map((a) => ({ name: a.name, email: a.email })),
    clientSlug: client?.slug ?? null,
    clientName: client?.name ?? null,
    source: booking.source || 'calcom',
    /** Running right now, which is what makes the velín light up. */
    live: Number.isFinite(start) && Number.isFinite(end) && now >= start && now < end,
    startsInMin: Number.isFinite(start) ? Math.round((start - now) / 60_000) : null,
  };
}

/* ------------------------------------------------------------------ */
/* public                                                              */
/* ------------------------------------------------------------------ */

/**
 * Upcoming calls plus anything running right now. Cached for a minute: the
 * velín polls this and Cal.com rate-limits.
 */
export async function getCalls({ clients = [], people = [], days = 14, force = false } = {}) {
  if (!isConfigured()) {
    return { configured: false, error: null, calls: [], live: [], fetchedAt: null };
  }
  const now = Date.now();
  // Reach slightly into the past so a call that started 20 minutes ago still
  // counts as live rather than disappearing from the window.
  const from = now - 4 * 60 * 60 * 1000;
  const to = now + days * 24 * 60 * 60 * 1000;
  const errors = [];

  let calcom = [];
  if (apiKey()) {
    if (!force && cache.data && Date.now() - cache.at < CACHE_TTL_MS) calcom = cache.data;
    else {
      try {
        const raw = await callApi('/bookings', {
          status: 'upcoming',
          afterStart: new Date(from).toISOString(),
          beforeEnd: new Date(to).toISOString(),
          sortStart: 'asc',
          take: 100,
        });
        calcom = Array.isArray(raw) ? raw : [];
        cache = { at: Date.now(), data: calcom };
      } catch (err) {
        errors.push(err?.message || 'Cal.com nedostupný');
        calcom = cache.data || [];
      }
    }
  }

  // Each person's own calendar; the module caches the feed itself.
  const google = [];
  const ownEmails = people.map((p) => p.calcomEmail).filter(Boolean);
  for (const person of people) {
    const r = await calendarBookings(person, { from, to, force, ownEmails });
    if (r.error) errors.push(`${person.displayName}: ${r.error}`);
    google.push(...r.events);
  }

  // The same call booked through Cal.com and sitting in the calendar shows
  // once: Cal.com wins, a calendar event within ten minutes of it is dropped.
  const bookings = [...calcom];
  for (const g of google) {
    const gs = Date.parse(g.start);
    const twin = calcom.some((b) => Math.abs(Date.parse(b.start) - gs) < 10 * 60 * 1000 && sameParty(b, g));
    if (!twin) bookings.push(g);
  }
  return rehydrate(bookings, clients, people, errors.length ? errors.join('; ') : null);
}

/** Do two bookings involve the same other person, by e-mail or by name? */
function sameParty(a, b) {
  const ea = new Set((a.attendees || []).map((x) => normalise(x.email)).filter(Boolean));
  const eb = (b.attendees || []).map((x) => normalise(x.email)).filter(Boolean);
  if (eb.some((e) => ea.has(e))) return true;
  const na = (a.attendees || []).map((x) => normalise(x.name)).filter(Boolean).join(' ');
  return (b.attendees || []).some((x) => x.name && na.includes(normalise(x.name)));
}

/** Re-derive the live flag and matches without refetching. */
function rehydrate(bookings, clients, people, error = null) {
  const now = Date.now();
  const calls = bookings
    .map((b) => shape(b, clients, people, now))
    .filter((c) => c.status !== 'cancelled')
    .sort((a, b) => a.startIso.localeCompare(b.startIso));
  return {
    configured: true,
    error,
    calls,
    live: calls.filter((c) => c.live),
    fetchedAt: new Date().toISOString(),
  };
}

export function invalidateCallsCache() {
  cache = { at: 0, data: null };
}
