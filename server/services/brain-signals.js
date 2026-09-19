/**
 * Beyond Brain — the drift detector.
 *
 * A dashboard that only displays data does not help. What helps is a named list
 * of decay symptoms, each computed from what is already in the brain, because
 * a 1:1 program almost never fails at once: it fades, and nobody notices until
 * the last week.
 *
 * Every signal answers three questions in the UI, so every signal carries them:
 * what is wrong (`title`), what the evidence is (`detail`), and what it means
 * (`meaning`). A signal nobody can act on is noise and does not belong here.
 *
 * Severity is deliberately coarse. `critical` means the program is at risk of
 * ending without a result; `watch` means it will be if nothing changes. There
 * is no "info" tier on purpose: if it does not change what someone does today,
 * it is not a signal.
 */

import { daysSince, truncateWords } from './brain-index.js';

/** Client has said nothing for this long (and no call is booked). */
const QUIET_WATCH_DAYS = 5;
const QUIET_CRITICAL_DAYS = 10;
/** A promise we owe, unanswered for this long, is us blocking the client. */
const OUR_DEBT_WATCH_DAYS = 4;
const OUR_DEBT_CRITICAL_DAYS = 7;
/** A named risk that has not moved in this long has been forgotten. */
const STALE_FLAG_DAYS = 21;
/** Program end inside this window is the last window for a result. */
const ENDING_SOON_DAYS = 30;

function signal(type, severity, title, detail, meaning, extra = {}) {
  return { type, severity, title, detail, meaning, ...extra };
}

/**
 * Czech day counts. "Zbývá 1 dní" is the kind of thing a reader trips over on
 * every glance, and these strings are read dozens of times a day.
 * Nominative: 1 den · 2–4 dny · 5+ dní.
 */
export function days(n) {
  const a = Math.abs(n);
  if (a === 1) return `${n} den`;
  if (a >= 2 && a <= 4) return `${n} dny`;
  return `${n} dní`;
}

/** Instrumental, for "před …": 1 dnem · 2+ dny. */
function daysAgo(n) {
  return Math.abs(n) === 1 ? `${n} dnem` : `${n} dny`;
}

/** Whole days between now and an ISO timestamp (date or datetime). */
function ageInDays(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}

/* ------------------------------------------------------------------ */
/* individual detectors                                                */
/* ------------------------------------------------------------------ */

/**
 * Silence, but only when we can tell the difference between a quiet client and
 * a broken pull. Three clients currently have a WhatsApp file that synced this
 * morning and contains zero messages; reporting that as "quiet for months"
 * would be worse than saying nothing, so it gets its own signal aimed at us.
 */
function quiet(client, now, hasUpcomingCall) {
  const raw = client.whatsappRaw;
  if (!raw) return null;

  if (raw.syncedButEmpty) {
    return signal(
      'wa-pipeline',
      'watch',
      'WhatsApp pull nevrací nic',
      `Synchronizace proběhla ${raw.syncedAt ? raw.syncedAt.slice(0, 10) : 'dnes'}, ale stáhla nula zpráv`,
      'Nevíme, jestli je ticho, nebo je rozbité napojení. Zkontrolovat ID skupiny a session ve WAHA',
      { actor: 'us' },
    );
  }

  const d = ageInDays(raw.lastInboundIso, now);
  if (d == null) return null;
  if (hasUpcomingCall || d < QUIET_WATCH_DAYS) return null;
  return signal(
    'quiet',
    d >= QUIET_CRITICAL_DAYS ? 'critical' : 'watch',
    'Ticho',
    `Poslední zpráva od klienta před ${daysAgo(d)}`,
    d >= QUIET_CRITICAL_DAYS
      ? 'Odpojuje se. Po deseti dnech se většinou sám nevrátí'
      : 'Začíná se vzdalovat, ozvat se dřív, než z toho bude zvyk',
    { days: d },
  );
}

/**
 * The funnel jam: the top of the funnel moves and the next step does not.
 * Reads the client's own spine, so it works whether they count "Lidi v DM" or
 * "Leady". Needs two comparable weeks, and a null (unknown) week is skipped
 * rather than treated as a zero.
 */
function funnelJam(client) {
  const weeks = client.measurements;
  const spine = client.spine;
  if (!weeks || weeks.length < 2 || spine.length < 2) return null;

  const [latest, previous] = weeks;
  const top = spine[0];
  const next = spine[1];

  const topNow = latest.values[top];
  const topPrev = previous.values[top];
  const nextNow = latest.values[next];
  const nextPrev = previous.values[next];

  if ([topNow, topPrev, nextNow, nextPrev].some((v) => v == null)) return null;
  if (!(topNow > 0 && topPrev > 0)) return null;
  if (nextNow > 0 || nextPrev > 0) return null;

  return signal(
    'funnel-jam',
    'critical',
    'Zácpa ve funnelu',
    `${top}: ${topPrev} → ${topNow}, ale ${next}: 0 dva týdny po sobě`,
    'Dělá vršek a nedělá spodek. Nejčastější důvod, proč program skončí bez výsledku',
  );
}

/** What we owe the client, and for how long. This is the "co chybí nám" list. */
function ourDebt(client, now) {
  const open = (client.promises?.ours || []).map((p) => ({
    ...p,
    age: ageInDays(p.dueIso || p.originIso, now),
  }));
  const overdue = open.filter((p) => p.age != null && p.age >= OUR_DEBT_WATCH_DAYS);
  if (!overdue.length) return null;

  const worst = overdue.reduce((a, b) => (b.age > a.age ? b : a));
  return signal(
    'our-debt',
    worst.age >= OUR_DEBT_CRITICAL_DAYS ? 'critical' : 'watch',
    'Dlužíme my',
    `${overdue.length}× otevřené, nejstarší ${days(worst.age)}: ${truncateWords(worst.text, 90)}`,
    'Brzdíme klienta my. Tohle se řeší dřív než cokoli, co dluží on',
    { actor: 'us', person: worst.person, count: overdue.length, items: overdue },
  );
}

/** Their promises that have a stated deadline which has passed. */
function theirOverdue(client, now) {
  const overdue = (client.promises?.theirs || [])
    .map((p) => ({ ...p, age: p.dueIso ? ageInDays(p.dueIso, now) : null }))
    .filter((p) => p.age != null && p.age > 0);
  if (!overdue.length) return null;

  const worst = overdue.reduce((a, b) => (b.age > a.age ? b : a));
  return signal(
    'their-overdue',
    overdue.length >= 3 ? 'critical' : 'watch',
    'Sliby po termínu',
    `${overdue.length}× po termínu, nejstarší ${days(worst.age)}`,
    overdue.length >= 3
      ? 'Tři a víc zmeškaných slibů není náhoda, ale vzorec. Řešit tempo, ne jednotlivý úkol'
      : 'Klouže. Připomenout dřív, než se z toho stane norma',
    { count: overdue.length, items: overdue },
  );
}

/**
 * No numbers at all, or none for the last two weeks. Eight of ten clients have
 * no `mereni.md` whatsoever right now, which is the single biggest blind spot
 * in the system: without numbers there is no way to see a jam forming.
 */
function missingMeasurement(client) {
  if (!client.has.mereni) {
    return signal(
      'no-measurement',
      'watch',
      'Žádné měření',
      'Klient nemá mereni.md',
      'Bez čísel neuvidíme zácpu, dokud nebude pozdě. Založit páteř a ptát se na ni na check-inu',
      { actor: 'us' },
    );
  }
  if (!client.measurements.length) return null;
  const latest = client.measurements[0];
  const unknown = Object.values(latest.values).every((v) => v == null);
  if (!unknown) return null;
  return signal(
    'no-measurement',
    'watch',
    'Měření bez čísel',
    `Poslední blok ${latest.isoWeek} je prázdný`,
    'Prázdno znamená nevíme, ne nulu. Doptat se na check-inu',
    { actor: 'us' },
  );
}

/** Named risks that stopped moving. */
function staleFlags(client, now) {
  const stale = (client.flags || []).filter((f) => {
    if (!f.open || f.severity === 'ok') return false;
    const age = ageInDays(f.stavDateIso, now);
    return age != null && age >= STALE_FLAG_DAYS;
  });
  if (!stale.length) return null;
  const worst = stale.reduce((a, b) =>
    (ageInDays(b.stavDateIso, now) > ageInDays(a.stavDateIso, now) ? b : a),
  );
  return signal(
    'stale-flag',
    'watch',
    'Vlajka bez pohybu',
    `${stale.length}× beze změny, nejdéle ${days(ageInDays(worst.stavDateIso, now))}: ${worst.title}`,
    'Riziko, které jsme pojmenovali a pak na něj zapomněli',
    { count: stale.length },
  );
}

/**
 * The end of the program, in both directions. Being past the planned end while
 * still marked active is its own problem: six clients are in that state today,
 * which means nobody has decided whether those programs continue or closed.
 */
function programEnd(client) {
  const d = client.daysToEnd;
  if (d == null) return null;

  if (d < 0) {
    return signal(
      'program-overdue',
      'critical',
      'Program po termínu',
      `Plánovaný konec ${client.endIso}, tedy před ${daysAgo(-d)}, stav je pořád Aktivní`,
      'Buď pokračuje a má se prodloužit, nebo skončil a má se uzavřít. Nerozhodnuto je nejhorší varianta',
      { actor: 'us', days: -d },
    );
  }
  if (d <= ENDING_SOON_DAYS) {
    return signal(
      'program-ending',
      d <= 7 ? 'critical' : 'watch',
      'Konec programu se blíží',
      `Zbývá ${days(d)} (konec ${client.endIso})`,
      'Poslední okno na výsledek a zároveň rozhodnutí o pokračování',
      { days: d },
    );
  }
  return null;
}

/** A call happened and never made it into the written record. */
function callWithoutNote(client) {
  const newest = client.fathom?.[0];
  if (!newest) return null;
  const lastWritten = client.calls?.[0]?.dateIso || null;
  if (lastWritten && lastWritten >= newest.dateIso) return null;
  return signal(
    'call-unwritten',
    'watch',
    'Call bez zápisu',
    `Fathom má ${newest.dateIso}, cally.md končí ${lastWritten || 'prázdno'}`,
    'Hovor proběhl a nepromítl se do brainu. Práce pro agenta, ne pro člověka',
    { actor: 'agent' },
  );
}

/** The written program week drifted away from the calendar. */
function staleWeek(client) {
  if (!client.programWeekStale) return null;
  return signal(
    'stale-week',
    'watch',
    'Zastaralý týden v profilu',
    `Profil říká ${client.programWeekStated}, podle data startu je to W${String(client.programWeek).padStart(2, '0')}`,
    'Profil se nesynchronizoval. Dokud se liší, nedá se podle něj řídit roadmapa',
    { actor: 'agent' },
  );
}

/* ------------------------------------------------------------------ */
/* composition                                                         */
/* ------------------------------------------------------------------ */

const WEIGHT = { critical: 10, watch: 3 };

/**
 * All signals for one client, worst first. Severity is summed rather than
 * maxed, so a client who is quiet AND jammed AND ending next week outranks a
 * client with one missed promise, which is the whole point of triage.
 */
export function signalsForClient(client, { now = Date.now(), upcomingCalls = [] } = {}) {
  // A closed program produces nothing. Everything here measures whether a live
  // engagement is drifting, and a finished one cannot drift. Reopening is a
  // one-word edit to `Stav` in profil.md.
  if (client.isActive === false) {
    return { signals: [], score: 0, worst: null, counts: { critical: 0, watch: 0 } };
  }

  const hasUpcomingCall = upcomingCalls.some((c) => c.clientSlug === client.slug);

  const found = [
    programEnd(client),
    funnelJam(client),
    ourDebt(client, now),
    quiet(client, now, hasUpcomingCall),
    theirOverdue(client, now),
    missingMeasurement(client),
    staleFlags(client, now),
    callWithoutNote(client),
    staleWeek(client),
  ].filter(Boolean);

  found.sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity]);
  const score = found.reduce((sum, s) => sum + WEIGHT[s.severity], 0);

  return {
    signals: found,
    score,
    worst: found[0]?.severity || null,
    counts: {
      critical: found.filter((s) => s.severity === 'critical').length,
      watch: found.filter((s) => s.severity === 'watch').length,
    },
  };
}

/** Signals across the roster, clients ordered by how much they need attention. */
export function signalsForRoster(clients, opts = {}) {
  const rows = clients.map((client) => ({ client, ...signalsForClient(client, opts) }));
  rows.sort((a, b) => b.score - a.score || a.client.name.localeCompare(b.client.name, 'cs'));
  return rows;
}

/**
 * A signal firing for most of the roster is not a client problem, it is a
 * system problem, and repeating it on ten cards buries the three things that
 * actually differ. Above this share it is lifted out and stated once.
 */
const SYSTEMIC_SHARE = 0.5;
const SYSTEMIC_MIN_CLIENTS = 4;

const SYSTEMIC_COPY = {
  'stale-week': {
    title: 'Profily se nesynchronizovaly',
    meaning: 'Zapsaný týden se rozešel s kalendářem. Dokud sedět nebude, nedá se podle profilu řídit roadmapa',
  },
  'no-measurement': {
    title: 'Chybí měření',
    meaning: 'Bez čísel neuvidíme zácpu ve funnelu u nikoho z nich. Největší slepé místo v systému',
  },
  'wa-pipeline': {
    title: 'WhatsApp pull nevrací nic',
    meaning: 'Synchronizace běží, ale stahuje nula zpráv. Vypadá to jako ticho klientů, přitom je to rozbité napojení',
  },
  'program-overdue': {
    title: 'Programy po termínu',
    meaning: 'Doběhly, ale pořád jsou vedené jako aktivní. U každého rozhodnout, jestli pokračuje, nebo se uzavírá',
  },
  'call-unwritten': {
    title: 'Cally bez zápisu',
    meaning: 'Fathom má novější hovor než brain. Práce pro agenta',
  },
  'stale-flag': {
    title: 'Vlajky bez pohybu',
    meaning: 'Rizika, která jsme pojmenovali a pak na ně zapomněli. Projít a buď uzavřít, nebo posunout',
  },
  quiet: {
    title: 'Ticho',
    meaning: 'Klienti se neozvali. Ozvat se dřív, než se z toho stane zvyk',
  },
  'their-overdue': {
    title: 'Sliby po termínu',
    meaning: 'Klouže jim to napříč. Řešit tempo, ne jednotlivé úkoly',
  },
};

/**
 * Everything that needs a person today, flattened across clients.
 *
 *  - `needsUs` a human has to move
 *  - `risks`   the client is drifting
 *  - `agent`   the agent's own backlog
 *  - `systemic` conditions affecting most of the roster, stated once
 */
export function inbox(clients, opts = {}) {
  const rows = signalsForRoster(clients, opts);
  // "Most of the roster" means most of the LIVE roster. Counting finished
  // programs in the denominator would stop a real roster-wide problem from
  // ever crossing the threshold.
  const active = clients.filter((c) => c.isActive !== false);

  const byType = new Map();
  for (const row of rows) {
    for (const s of row.signals) {
      if (!byType.has(s.type)) byType.set(s.type, []);
      byType.get(s.type).push({ slug: row.client.slug, name: row.client.name, severity: s.severity });
    }
  }

  const systemicTypes = new Set();
  const systemic = [];
  for (const [type, hits] of byType) {
    if (hits.length < SYSTEMIC_MIN_CLIENTS) continue;
    if (hits.length / Math.max(1, active.length) < SYSTEMIC_SHARE) continue;
    systemicTypes.add(type);
    const copy = SYSTEMIC_COPY[type] || {};
    systemic.push({
      type,
      title: copy.title || type,
      meaning: copy.meaning || null,
      count: hits.length,
      total: active.length,
      severity: hits.some((h) => h.severity === 'critical') ? 'critical' : 'watch',
      clients: hits,
    });
  }
  systemic.sort((a, b) => b.count - a.count);

  const needsUs = [];
  const risks = [];
  const agent = [];

  for (const row of rows) {
    // What is specific to THIS client, once the roster-wide conditions are set
    // aside. The board's severity keys off this: marking seven rows critical
    // for a reason already stated once at the top makes the column stop
    // discriminating, which is the opposite of what a status column is for.
    const own = row.signals.filter((s) => !systemicTypes.has(s.type));
    row.ownCounts = {
      critical: own.filter((s) => s.severity === 'critical').length,
      watch: own.filter((s) => s.severity === 'watch').length,
    };
    row.systemicTypes = row.signals.filter((s) => systemicTypes.has(s.type)).map((s) => s.type);

    for (const s of own) {
      const entry = { ...s, clientSlug: row.client.slug, clientName: row.client.name };
      if (s.actor === 'agent') agent.push(entry);
      else if (s.actor === 'us') needsUs.push(entry);
      else risks.push(entry);
    }
  }
  return { needsUs, risks, agent, systemic, systemicTypes: [...systemicTypes], rows };
}
