/**
 * Beyond Brain — planning meetings in Google, under Tim's Workspace account.
 *
 * Reading calendars goes through iCal addresses (beyond-kalendar.js). Writing
 * cannot: creating an event with a paid Meet, or asking who is free, needs an
 * authorised account. There is exactly one, Tim's, because the one Workspace
 * licence is his and a Meet is paid for by whoever creates it. So the whole app
 * holds one refresh token, and connecting any other account is refused.
 *
 * Every meeting goes to the shared calendar "Beyond kalendář", found by name
 * each time rather than stored, because its id changes if it is ever recreated.
 *
 * What the calendar event's organizer is, who created the Meet and who runs the
 * call are different things. This module reports each of them separately and
 * never claims a step it could not do: a co-host that could not be set comes
 * back as a manual step, and an availability it cannot see comes back as
 * unknown, never as free.
 */
import crypto from 'node:crypto';

import { getPeople } from './beyond-people.js';
import { save as saveSettings } from './beyond-settings.js';
import { invalidateCalendars } from './beyond-kalendar.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const MEET_API = 'https://meet.googleapis.com/v2';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/meetings.space.created',
];
const SHARED_NAME = 'Beyond kalendář';
const STATE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

const pending = new Map(); // state → expiry
let token = { value: null, until: 0 };
let sharedId = null;

const clientId = () => (process.env.BEYOND_GOOGLE_CLIENT_ID || '').trim();
const clientSecret = () => (process.env.BEYOND_GOOGLE_CLIENT_SECRET || '').trim();
const refreshToken = () => (process.env.BEYOND_GOOGLE_REFRESH_TOKEN || '').trim();
const zone = () => process.env.BEYOND_TZ || 'Europe/Prague';

/** The address registered in Google Cloud; it must match to the character. */
export function redirectUri() {
  const base = (process.env.BEYOND_PUBLIC_URL || 'https://brain.growbeyond.cz').replace(/\/+$/, '');
  return `${base}/api/beyond-google/callback`;
}

function person(key) {
  const p = getPeople().find((x) => x.key === key);
  if (!p?.calcomEmail) throw new Error(`neznám e-mail osoby ${key}`);
  return p;
}

export function invalidateGoogle() {
  token = { value: null, until: 0 };
  sharedId = null;
}

export function googleStatus() {
  return {
    configured: Boolean(clientId() && clientSecret()),
    connected: Boolean(refreshToken()),
    account: refreshToken() ? process.env.BEYOND_GOOGLE_ACCOUNT || null : null,
    redirectUri: redirectUri(),
  };
}

/* ------------------------------------------------------------------ */
/* connecting the account                                              */
/* ------------------------------------------------------------------ */

export function beginAuthorization() {
  if (!clientId() || !clientSecret()) throw new Error('V Nastavení chybí Google Client ID nebo Client Secret');
  const now = Date.now();
  for (const [s, until] of pending) if (until < now) pending.delete(s);
  const state = crypto.randomBytes(24).toString('hex');
  pending.set(state, now + STATE_TTL_MS);
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    login_hint: person('tim').calcomEmail,
    state,
  }).toString();
  return url.toString();
}

async function postToken(params) {
  const res = await timedFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...params }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error_description || body.error || `Google vrátil ${res.status}`);
    err.code = body.error;
    throw err;
  }
  return body;
}

/** The redirect back from Google: swap the code, check the account, keep the token. */
export async function finishAuthorization(code, state) {
  const until = pending.get(state);
  pending.delete(state);
  if (!until || until < Date.now()) throw new Error('Požadavek vypršel, klikni na Povolit znovu');
  const tokens = await postToken({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });
  if (!tokens.refresh_token) throw new Error('Google nevrátil trvalý přístup, klikni na Povolit znovu');

  // Meets are paid for by this account, so only the licensed one will do.
  const res = await timedFetch(`${CALENDAR_API}/calendars/primary`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const primary = await res.json().catch(() => ({}));
  const expected = person('tim').calcomEmail.toLowerCase();
  if (String(primary.id || '').toLowerCase() !== expected) {
    throw new Error(`Přihlas se účtem ${expected}, Meet musí vznikat pod placenou licencí (přišel ${primary.id || 'neznámý účet'})`);
  }
  saveSettings({ BEYOND_GOOGLE_REFRESH_TOKEN: tokens.refresh_token, BEYOND_GOOGLE_ACCOUNT: primary.id }, { by: 'google-oauth' });
  invalidateGoogle();
  return primary.id;
}

export function disconnectGoogle() {
  saveSettings({ BEYOND_GOOGLE_REFRESH_TOKEN: '', BEYOND_GOOGLE_ACCOUNT: '' }, { by: 'velin' });
  invalidateGoogle();
}

/* ------------------------------------------------------------------ */
/* calling Google                                                      */
/* ------------------------------------------------------------------ */

async function timedFetch(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Google neodpověděl do 15 s');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function accessToken() {
  if (token.value && Date.now() < token.until) return token.value;
  if (!refreshToken()) throw new Error('Google účet není připojený: na Velíně klikni na Povolit');
  let body;
  try {
    body = await postToken({ refresh_token: refreshToken(), grant_type: 'refresh_token' });
  } catch (err) {
    if (err.code === 'invalid_grant') throw new Error('Přístup ke Googlu vypršel nebo byl odvolán: na Velíně klikni na Povolit');
    throw err;
  }
  token = { value: body.access_token, until: Date.now() + (Number(body.expires_in) || 3000) * 1000 - 60_000 };
  return token.value;
}

async function api(url, { method = 'GET', query, body } = {}) {
  const target = new URL(url);
  for (const [k, v] of Object.entries(query || {})) if (v != null) target.searchParams.set(k, String(v));
  const res = await timedFetch(target, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Google vrátil ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function sharedCalendarId() {
  if (sharedId) return sharedId;
  const list = await api(`${CALENDAR_API}/users/me/calendarList`, { query: { maxResults: 250 } });
  const found = (list.items || []).filter((c) => c.summary === SHARED_NAME || c.summaryOverride === SHARED_NAME);
  if (!found.length) throw new Error(`Kalendář „${SHARED_NAME}" na Timově účtu není`);
  if (found.length > 1) throw new Error(`Kalendářů „${SHARED_NAME}" je ${found.length}, nech jen jeden`);
  if (!['owner', 'writer'].includes(found[0].accessRole)) throw new Error(`Do kalendáře „${SHARED_NAME}" nejde zapisovat`);
  sharedId = found[0].id;
  return sharedId;
}

/* ------------------------------------------------------------------ */
/* availability                                                        */
/* ------------------------------------------------------------------ */

function instant(value, label) {
  const v = String(value || '');
  if (!/T\d{2}:\d{2}.*(Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) {
    throw new Error(`${label} musí být čas s pásmem, např. 2026-11-10T09:00:00+01:00`);
  }
  return v;
}

const MENTORS = { tim: ['tim'], stepan: ['stepan'], oba: ['tim', 'stepan'] };

function mentorsOf(key) {
  const keys = MENTORS[key];
  if (!keys) throw new Error('mentor musí být tim, stepan nebo oba');
  return keys.map(person);
}

/** Those of us an event on the shared calendar is assigned to: whoever it invites. */
function assignedTo(ev) {
  const invited = (ev.attendees || []).map((a) => a.email?.toLowerCase()).filter(Boolean);
  return getPeople().filter((p) => p.calcomEmail && invited.includes(p.calcomEmail.toLowerCase()));
}

/**
 * What each mentor has on the shared calendar, the only one we plan by. An
 * event blocks the people assigned to it, so Tim and Štěpán can run calls at
 * the same time; one assigned to nobody blocks both until someone takes it.
 * A window too long to read whole comes back with `neznamo`: unknown is never free.
 */
export async function availability({ kdo = 'oba', od, do: until }) {
  const timeMin = instant(od, 'od');
  const timeMax = instant(until, 'do');
  const people = mentorsOf(kdo);
  const calendarId = await sharedCalendarId();
  const res = await api(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    query: { timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 250 },
  });
  const events = (res.items || [])
    .filter((ev) => ev.status !== 'cancelled' && ev.transparency !== 'transparent')
    .map((ev) => ({ ev, assigned: assignedTo(ev) }));
  return people.map((p) => ({
    kalendar: SHARED_NAME,
    mentor: p.displayName,
    email: p.calcomEmail,
    obsazeno: events
      .filter(({ assigned }) => !assigned.length || assigned.some((a) => a.key === p.key))
      .map(({ ev, assigned }) => ({
        id: ev.id,
        serie: ev.recurringEventId || null,
        nazev: ev.summary || null,
        start: ev.start?.dateTime || ev.start?.date,
        end: ev.end?.dateTime || ev.end?.date,
        prirazeno: assigned.length ? assigned.map((a) => a.displayName).join(' a ') : null,
      })),
    neznamo: res.nextPageToken ? 'rozsah je moc dlouhý na přečtení celý, zkrať ho' : null,
  }));
}

const overlaps = (a, b) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);

/** What stands in the way of this slot; `ignoreId` is the event being moved. */
async function obstacles(mentor, start, end, ignoreId = null) {
  const calendars = await availability({ kdo: mentor, od: start, do: end });
  const slot = { start, end };
  const out = [];
  for (const c of calendars) {
    if (c.neznamo) out.push(`${c.mentor}: ${c.neznamo}`);
    for (const b of c.obsazeno) {
      const own = ignoreId && (b.id === ignoreId || b.serie === ignoreId);
      if (!own && overlaps(b, slot)) {
        out.push(`${c.mentor}: ${b.nazev || 'schůzka'} ${b.start} až ${b.end}${b.prirazeno ? '' : ' (nepřiřazená, blokuje oba)'}`);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* meetings                                                            */
/* ------------------------------------------------------------------ */

function shapeEvent(ev) {
  return {
    id: ev.id,
    nazev: ev.summary || null,
    zacatek: ev.start?.dateTime || ev.start?.date || null,
    konec: ev.end?.dateTime || ev.end?.date || null,
    meet: ev.hangoutLink || ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || null,
    ucastnici: (ev.attendees || []).filter((a) => !a.resource).map((a) => ({ email: a.email, odpoved: a.responseStatus })),
    vytvoril: ev.creator?.email || null,
    organizator: ev.organizer?.displayName || ev.organizer?.email || null,
    odkaz: ev.htmlLink || null,
  };
}

function emails(list) {
  const out = [];
  for (const raw of list || []) {
    const e = String(raw).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error(`Neplatný e-mail: ${raw}`);
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

const sendUpdates = (send) => (send ? 'all' : 'none');

/**
 * A room for a call Štěpán runs without Tim: created under Tim's licence, open
 * so clients are not left knocking at a door nobody can answer, Štěpán co-host.
 * Only spaces this app created can take members, so it cannot be done to a Meet
 * the calendar generates.
 */
async function roomForStepan() {
  const space = await api(`${MEET_API}/spaces`, { method: 'POST', body: { config: { accessType: 'OPEN' } } });
  let coHost;
  try {
    const member = await api(`${MEET_API}/${space.name}/members`, {
      method: 'POST',
      body: { email: person('stepan').calcomEmail, role: 'COHOST' },
    });
    coHost = member?.role === 'COHOST' ? 'nastaven' : `ruční krok: Google nepotvrdil roli (${member?.role || 'bez role'})`;
  } catch (err) {
    coHost = `ruční krok: ${err.message}`;
  }
  return {
    coHost,
    conferenceData: {
      conferenceId: space.meetingCode,
      conferenceSolution: { key: { type: 'hangoutsMeet' } },
      entryPoints: [{ entryPointType: 'video', uri: space.meetingUri }],
    },
  };
}

const generatedMeet = () => ({
  createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
});

/** Google fills the Meet in asynchronously; wait a moment for the real link. */
async function settled(calendarId, ev) {
  let current = ev;
  for (let i = 0; i < 4 && current.conferenceData?.createRequest?.status?.statusCode === 'pending'; i += 1) {
    await new Promise((r) => { setTimeout(r, 1500); });
    current = await api(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ev.id)}`);
  }
  return current;
}

export async function listMeetings({ od, do: until }) {
  const calendarId = await sharedCalendarId();
  const res = await api(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    query: { timeMin: instant(od, 'od'), timeMax: instant(until, 'do'), singleEvents: true, orderBy: 'startTime', maxResults: 100 },
  });
  return (res.items || []).map(shapeEvent);
}

export async function createMeeting({ nazev, zacatek, konec, mentor, ucastnici = [], popis, poslatPozvanky = false, presKolizi = false }) {
  if (!String(nazev || '').trim()) throw new Error('Chybí název schůzky');
  const start = instant(zacatek, 'zacatek');
  const end = instant(konec, 'konec');
  if (Date.parse(end) <= Date.parse(start)) throw new Error('Konec musí být po začátku');
  const mentors = mentorsOf(mentor);

  if (!presKolizi) {
    const blocked = await obstacles(mentor, start, end);
    if (blocked.length) return { pripraveno: false, vytvoreno: false, kolize: blocked };
  }

  const calendarId = await sharedCalendarId();
  const attendees = emails([...mentors.map((m) => m.calcomEmail), ...ucastnici]).map((email) => ({ email }));
  const body = {
    summary: nazev.trim(),
    description: popis || undefined,
    start: { dateTime: start, timeZone: zone() },
    end: { dateTime: end, timeZone: zone() },
    attendees,
  };
  const insert = (conferenceData) => api(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    query: { conferenceDataVersion: 1, sendUpdates: sendUpdates(poslatPozvanky) },
    body: { ...body, conferenceData },
  });

  let coHost = mentor === 'stepan' ? null : 'netýká se';
  let created;
  if (mentor === 'stepan') {
    try {
      const room = await roomForStepan();
      coHost = room.coHost;
      created = await insert(room.conferenceData);
    } catch (err) {
      // No room, or Google would not take it onto the event. The calendar can
      // still make a Meet under Tim's account; only the co-host is lost.
      coHost = `ruční krok: Štěpán není co-host a klienty musí pustit dovnitř Tim (${err.message})`;
    }
  }
  if (!created) created = await insert(generatedMeet());

  const ev = await settled(calendarId, created);
  invalidateCalendars();
  const shaped = shapeEvent(ev);
  return {
    pripraveno: Boolean(shaped.meet),
    vytvoreno: true,
    ...shaped,
    kalendar: SHARED_NAME,
    mentor: mentors.map((m) => m.displayName).join(' a '),
    meet_pod_uctem: process.env.BEYOND_GOOGLE_ACCOUNT || person('tim').calcomEmail,
    co_host: coHost,
    pozvanky: poslatPozvanky ? 'odeslané' : 'neodeslané, účastníci o schůzce nevědí',
    ...(shaped.meet ? {} : { problem: 'Událost vznikla, ale Meet ne, schůzka není připravená' }),
  };
}

export async function updateMeeting({ id, nazev, zacatek, konec, mentor, ucastnici, popis, poslatPozvanky = false, presKolizi = false }) {
  if (!id) throw new Error('Chybí id události');
  const calendarId = await sharedCalendarId();
  const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`;
  const current = await api(url);
  const before = { start: current.start?.dateTime, end: current.end?.dateTime };
  const start = zacatek ? instant(zacatek, 'zacatek') : before.start;
  const end = konec ? instant(konec, 'konec') : before.end;
  if (!start || !end) throw new Error('Celodenní událost tenhle nástroj nepřesouvá');
  if (Date.parse(end) <= Date.parse(start)) throw new Error('Konec musí být po začátku');

  const ours = getPeople().map((p) => p.calcomEmail?.toLowerCase()).filter(Boolean);
  const existing = current.attendees || [];
  const ourOwn = existing.filter((a) => ours.includes(a.email?.toLowerCase())).map((a) => a.email.toLowerCase());
  const leaders = mentor ? mentorsOf(mentor).map((m) => m.calcomEmail) : ourOwn;
  const checkFor = mentor || (ourOwn.length === 1 ? getPeople().find((p) => p.calcomEmail?.toLowerCase() === ourOwn[0])?.key : 'oba');

  const timeChanged = Date.parse(start) !== Date.parse(before.start) || Date.parse(end) !== Date.parse(before.end);
  if ((timeChanged || mentor) && !presKolizi) {
    const blocked = await obstacles(checkFor, start, end, id);
    if (blocked.length) return { pripraveno: false, zmeneno: false, kolize: blocked };
  }

  const patch = {};
  if (nazev) patch.summary = nazev;
  if (popis !== undefined) patch.description = popis;
  if (timeChanged) {
    patch.start = { dateTime: start, timeZone: zone() };
    patch.end = { dateTime: end, timeZone: zone() };
  }
  if (mentor || ucastnici) {
    const clients = ucastnici || existing.map((a) => a.email).filter((e) => e && !ours.includes(e.toLowerCase()));
    patch.attendees = emails([...leaders, ...clients]).map((email) => existing.find((a) => a.email?.toLowerCase() === email) || { email });
  }
  // Conference data stays out of the patch, so the Meet link survives the move.
  const ev = await api(url, { method: 'PATCH', query: { sendUpdates: sendUpdates(poslatPozvanky) }, body: patch });
  invalidateCalendars();
  const shaped = shapeEvent(ev);
  return {
    pripraveno: Boolean(shaped.meet),
    zmeneno: true,
    ...shaped,
    pozvanky: poslatPozvanky ? 'oznámení odeslané' : 'oznámení neodeslané, účastníci o změně nevědí',
    ...(mentor ? { co_host: 'ruční krok: při změně mentora se co-host nemění' } : {}),
  };
}

export async function cancelMeeting({ id, poslatPozvanky = false }) {
  if (!id) throw new Error('Chybí id události');
  const calendarId = await sharedCalendarId();
  await api(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    query: { sendUpdates: sendUpdates(poslatPozvanky) },
  });
  invalidateCalendars();
  return { zruseno: true, pozvanky: poslatPozvanky ? 'oznámení odeslané' : 'oznámení neodeslané, účastníci o zrušení nevědí' };
}
