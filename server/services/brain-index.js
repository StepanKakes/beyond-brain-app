/**
 * Beyond Brain — read the brain repo into a queryable index.
 *
 * The markdown files stay the source of truth. This module is a projection of
 * them: it parses every active client into structured fields the dashboards can
 * sort, count and chart, and it is always safe to throw away and rebuild.
 *
 * Two things the parsers must respect, because the brain says so explicitly and
 * getting them wrong silently corrupts the reader's judgement:
 *
 *   1. Empty is not zero. In `mereni.md` a blank cell means "we don't know" and
 *      a 0 means "tried and it didn't work". A missing week must never render
 *      as a zero on a chart, so unknown values are `null` here, never 0.
 *
 *   2. Every client has their own metric spine. Jakub tracks
 *      "Lidi v DM / Hovory / Zaplatilo / Tržby", Fit Na Cestách tracks
 *      "Leady / Bookingy / Přišli na hovor / Zaplatilo / Tržby". The spine is
 *      declared in the file header; we read it rather than assuming one.
 *
 *   3. `W12` means two different things in two different files. In `profil.md`
 *      it is the program week (how far into their program the client is) and it
 *      is often stale, because it is only refreshed when someone syncs. In
 *      `mereni.md` it is the ISO calendar week. Conflating them would put a
 *      client in week 37 of a 16-week program, so the two never share a name
 *      here: `programWeek*` versus `isoWeek`.
 *
 * The files themselves are inconsistent by nature (they are written by hand and
 * by an agent over months), so every parser degrades to null instead of
 * throwing. A client missing `mereni.md` is a fact worth showing, not an error.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveBrainPath } from '../utils/brain-path.js';

const ACTIVE_DIR = ['clients', 'aktivni'];

/** Rebuild at most this often unless a file actually changed or force is set. */
const MIN_REBUILD_MS = 15_000;

let cache = { builtAt: 0, fingerprint: '', data: null };

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/;
const CZ_DATE = /(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/;

/** Pull the first date out of a string, ISO or Czech `D.M.YYYY`. Returns
 *  `YYYY-MM-DD` or null. */
function findDate(text) {
  if (typeof text !== 'string') return null;
  const iso = text.match(ISO_DATE);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const cz = text.match(CZ_DATE);
  if (cz) {
    const d = cz[1].padStart(2, '0');
    const m = cz[2].padStart(2, '0');
    return `${cz[3]}-${m}-${d}`;
  }
  return null;
}

/** Whole days between an ISO date and now. Positive = in the past. */
export function daysSince(iso, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}

/** Read a file, returning null when it is absent. Anything else rethrows. */
async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Value of a `**Label:** value` line. */
function field(text, label) {
  if (!text) return null;
  const re = new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+)$`, 'm');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/** Split a markdown body into `## heading` sections. */
function sections(text) {
  if (!text) return [];
  const out = [];
  const lines = text.split('\n');
  let current = null;
  for (const line of lines) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      if (current) out.push(current);
      current = { heading: h[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) out.push(current);
  return out.map((s) => ({ heading: s.heading, body: s.lines.join('\n').trim() }));
}

function humanize(slug) {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function initialsFromName(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .toUpperCase();
}

/* ------------------------------------------------------------------ */
/* profil.md                                                           */
/* ------------------------------------------------------------------ */

/**
 * Eight fields appear in all ten profiles, so those are what we rely on.
 * Everything else is treated as optional decoration.
 */
function parseProfile(text, slug) {
  const out = {
    name: humanize(slug),
    stav: null,
    stavNote: null,
    startIso: null,
    months: null,
    endIso: null,
    endApprox: false,
    programWeekStated: null,
    programWeekStatedNum: null,
    programWeekNote: null,
    priceCzk: null,
    priceNote: null,
    hladina: null,
    notionUrl: null,
    waGroupId: null,
    email: null,
  };
  if (!text) return out;

  const heading = text.match(/^#\s+(.+?)\s*$/m);
  if (heading) out.name = heading[1].trim();

  // "Aktivní" / "Aktivní (předpoklad — v Notionu pole „Stav" prázdné)"
  const stav = field(text, 'Stav');
  if (stav) {
    const m = stav.match(/^(\S+)\s*(.*)$/);
    out.stav = m ? m[1] : stav;
    out.stavNote = m && m[2] ? m[2].replace(/^\((.*)\)$/, '$1').trim() || null : null;
  }

  out.startIso = findDate(field(text, 'Zahájení programu') || '');

  // "4 měsíce (plánovaný konec 2026-09-20)"
  // "3 měsíce (plánovaný konec ~2026-07-14, už po termínu — viz flags)"
  // "3 měsíce (dle Roadmapy 01.05.2026 — 31.07.2026)"
  const delka = field(text, 'Délka programu');
  if (delka) {
    const months = delka.match(/^(\d+)\s*měs/i);
    if (months) out.months = Number(months[1]);
    out.endApprox = delka.includes('~');
    // Take the LAST date in the line: the roadmap form lists start then end.
    const all = [...delka.matchAll(new RegExp(`${ISO_DATE.source}|${CZ_DATE.source}`, 'g'))];
    if (all.length) out.endIso = findDate(all[all.length - 1][0]);
  }

  // "W09 (62 dní od startu, 2026-07-21)" — the program week AS WRITTEN, which
  // is only as fresh as the last sync. The computed value is added later.
  const tyden = field(text, 'Aktuální týden');
  if (tyden) {
    const m = tyden.match(/^(W\d+)\s*(.*)$/i);
    if (m) {
      out.programWeekStated = m[1].toUpperCase();
      out.programWeekStatedNum = Number(m[1].slice(1));
      out.programWeekNote = m[2] ? m[2].replace(/^\((.*)\)$/, '$1').trim() || null : null;
    } else {
      out.programWeekNote = tyden;
    }
  }

  // "50 000 Kč" | "25000.0 Kč" | "k doplnění (v Notionu nevyplněno)"
  const cena = field(text, 'Cena');
  if (cena) {
    const num = cena.replace(/\s| /g, '').match(/^([\d.]+)Kč/i);
    if (num) {
      const parsed = Number(num[1]);
      if (Number.isFinite(parsed)) out.priceCzk = Math.round(parsed);
    } else {
      out.priceNote = cena;
    }
  }

  out.hladina = field(text, 'Hladina');
  const notion = field(text, 'Notion dashboard');
  if (notion) {
    const url = notion.match(/https?:\/\/\S+/);
    out.notionUrl = url ? url[0] : null;
  }
  const wa = field(text, 'WhatsApp group ID');
  if (wa) {
    const id = wa.match(/[\w-]+@[cg]\.us/);
    out.waGroupId = id ? id[0] : null;
  }
  const email = text.match(/^-\s*E-?mail:\s*(\S+@\S+)/mi);
  if (email) out.email = email[1].trim();

  return out;
}

/* ------------------------------------------------------------------ */
/* mereni.md                                                           */
/* ------------------------------------------------------------------ */

/**
 * Weekly numbers. The spine comes from the "Metriky (páteř): a, b, c" header
 * line; the value column is the one headed "Hodnota" (tables sometimes carry an
 * extra column with the previous week for reference, which is NOT this week's
 * value). A blank cell stays null, which is the whole point.
 */
function parseMereni(text) {
  const out = { spine: [], weeks: [] };
  if (!text) return out;

  const spine = text.match(/^Metriky\s*\(páteř\):\s*(.+?)\.?\s*$/mi);
  if (spine) {
    out.spine = spine[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  for (const sec of sections(text)) {
    const wm = sec.heading.match(/^(W\d+)/i);
    if (!wm) continue;
    const week = wm[1].toUpperCase();
    const range = sec.heading.match(/\(([^)]+)\)/);

    const rows = sec.body.split('\n').filter((l) => l.trim().startsWith('|'));
    if (!rows.length) continue;

    const cells = (line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());

    // Find the value column by header name, defaulting to the third cell.
    let valueIdx = 2;
    const header = rows.find((l) => /Metrika/i.test(l));
    if (header) {
      const idx = cells(header).findIndex((c) => /Hodnota/i.test(c));
      if (idx >= 0) valueIdx = idx;
    }

    const values = {};
    for (const row of rows) {
      if (/^\|\s*-+/.test(row) || /Metrika/i.test(row)) continue;
      const c = cells(row);
      const metric = c[0];
      if (!metric) continue;
      const raw = (c[valueIdx] ?? '').replace(/\s| /g, '');
      if (raw === '' || raw === '—' || raw === '-') {
        values[metric] = null; // "nevíme", deliberately not 0
      } else {
        const n = Number(raw.replace(/Kč/i, '').replace(',', '.'));
        values[metric] = Number.isFinite(n) ? n : null;
      }
    }
    if (Object.keys(values).length) {
      // ISO calendar week, not the program week — see the note at the top.
      out.weeks.push({
        isoWeek: week,
        isoWeekNum: Number(week.slice(1)),
        range: range ? range[1] : null,
        values,
      });
    }
  }

  // Newest first in the file; keep it that way.
  return out;
}

/* ------------------------------------------------------------------ */
/* _action-items.md                                                    */
/* ------------------------------------------------------------------ */

const US_WORDS = /\btim\b|\bštěpán\b|\bstepan\b|\bkakeš\b/i;
const THEM_WORDS = /\bklient\b|\boni\b/i;

/**
 * Who owes the items under this heading. The headings are written freely
 * ("Otevřené (Tim → Kuba)", "Tim dluží", "Oni dluží", "Otevřené (Štěpán)"), so
 * this reads the direction rather than matching fixed strings.
 *
 * Returns 'us' | 'them' | null (null = not an open-promise section).
 */
function debtorOf(heading) {
  const h = heading.toLowerCase();
  if (/splněn|hotov/.test(h)) return null;       // done, not owed
  if (/signál/.test(h)) return null;             // notes, not promises

  const arrow = heading.match(/\(([^)]*?)(?:→|->)([^)]*)\)/);
  if (arrow) {
    const from = arrow[1];
    if (US_WORDS.test(from)) return 'us';
    if (THEM_WORDS.test(from)) return 'them';
    return 'them'; // "(Kuba → Tim)" — a first name on the left is the client
  }
  if (/dluží/.test(h)) {
    if (US_WORDS.test(heading)) return 'us';
    if (THEM_WORDS.test(heading)) return 'them';
  }
  // "Otevřené (Štěpán)" — a bare name means that person owes it.
  if (US_WORDS.test(heading)) return 'us';
  if (/otevřen|check-in/.test(h)) return 'them';
  return null;
}

/** Which of our people owns it, when the heading names one. */
function personOf(heading) {
  if (/štěpán|stepan|kakeš/i.test(heading)) return 'stepan';
  if (/tim/i.test(heading)) return 'tim';
  return null;
}

function parseActionItems(text) {
  const out = { ours: [], theirs: [], signals: [], syncedAt: null };
  if (!text) return out;

  const synced = text.match(/Last synced:\s*(\S+)/i);
  if (synced) out.syncedAt = synced[1];

  for (const sec of sections(text)) {
    const items = sec.body
      .split('\n')
      .map((l) => l.match(/^\s*[-*]\s*\[( |x|X)\]\s*(.+)$/))
      .filter(Boolean)
      .map((m) => ({ done: m[1].toLowerCase() === 'x', text: m[2].trim() }));

    if (/signál/i.test(sec.heading)) {
      out.signals.push(
        ...sec.body
          .split('\n')
          .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
          .filter(Boolean),
      );
      continue;
    }

    const debtor = debtorOf(sec.heading);
    if (!debtor) continue;

    for (const item of items) {
      if (item.done) continue;
      const plain = item.text.replace(/\*\*/g, '');
      // A due date is whatever date the line states; "z callu <date>" is the
      // origin, not a deadline, so it only counts when nothing else is there.
      const origin = plain.match(/z\s+callu\s+(\S+)/i);
      const originIso = origin ? findDate(origin[1]) : null;
      const withoutOrigin = origin ? plain.replace(origin[0], '') : plain;
      const dueIso = findDate(withoutOrigin);
      out[debtor === 'us' ? 'ours' : 'theirs'].push({
        text: plain,
        dueIso,
        originIso,
        person: debtor === 'us' ? personOf(sec.heading) : null,
        section: sec.heading,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* flags.md                                                            */
/* ------------------------------------------------------------------ */

const SEVERITY_BY_MARK = { '🔴': 'critical', '🟡': 'watch', '🟢': 'ok' };

function parseFlags(text) {
  if (!text) return [];
  return sections(text)
    .map((sec) => {
      const mark = sec.heading.trim().slice(0, 2);
      const severity = SEVERITY_BY_MARK[mark] || 'watch';
      const title = sec.heading.replace(/^[^\p{L}\d]+/u, '').trim();
      const stav = (sec.body.match(/^\*\*Stav:\*\*\s*(.+)$/m) || [])[1] || null;
      const resolved = /vyřešen|uzavřen/i.test(stav || '');
      return {
        severity,
        title,
        stav: stav ? stav.trim() : null,
        stavDateIso: findDate(stav || ''),
        open: !resolved,
        body: sec.body,
      };
    })
    .filter((f) => f.title);
}

/* ------------------------------------------------------------------ */
/* cally.md / whatsapp.md — dated blocks                               */
/* ------------------------------------------------------------------ */

/**
 * Flatten a markdown block into a one-line excerpt.
 *
 * The brain is written in markdown, so a raw slice leaks `**bold**`, list
 * bullets and link syntax into the UI. Cutting on a word boundary matters too:
 * a hard slice lands mid-date ("z 2026-05-") and reads like corrupted data.
 */
export function excerptOf(markdown, max = 240) {
  if (!markdown) return '';
  const flat = markdown
    .replace(/```[\s\S]*?```/g, ' ')          // fenced code
    .replace(/<!--[\s\S]*?-->/g, ' ')         // html comments (fathom markers)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')    // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // links → their text
    .replace(/^\s*[-*+]\s+/gm, ' ')           // bullets
    .replace(/^\s*>\s?/gm, ' ')               // quotes
    .replace(/^#{1,6}\s+/gm, ' ')             // headings
    .replace(/\*\*|__|`/g, '')                // emphasis marks
    .replace(/\s+/g, ' ')
    .trim();
  return truncateWords(flat, max);
}

/** Cut to `max` characters without splitting a word. */
export function truncateWords(text, max) {
  if (!text || text.length <= max) return text || '';
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function parseDatedBlocks(text, kind) {
  if (!text) return [];
  return sections(text)
    .map((sec) => {
      const dateIso = findDate(sec.heading);
      if (!dateIso) return null;
      const title = sec.heading.replace(ISO_DATE, '').replace(/^[\s—–-]+/, '').trim();
      return {
        kind,
        dateIso,
        title: title || null,
        excerpt: excerptOf(sec.body),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.dateIso.localeCompare(a.dateIso));
}

/* ------------------------------------------------------------------ */
/* raw/                                                                */
/* ------------------------------------------------------------------ */

async function parseRawWhatsapp(dir) {
  const raw = await readIfExists(path.join(dir, 'raw', 'whatsapp.json'));
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  let lastInboundMs = 0;
  let lastAnyMs = 0;
  for (const m of messages) {
    const ts = Number(m?.timestamp) * 1000;
    if (!Number.isFinite(ts) || ts <= 0) continue;
    if (ts > lastAnyMs) lastAnyMs = ts;
    // WAHA serialises booleans as the strings "True"/"False".
    const fromMe = String(m?.fromMe).toLowerCase() === 'true';
    if (!fromMe && ts > lastInboundMs) lastInboundMs = ts;
  }
  return {
    syncedAt: data?.syncedAt || null,
    count: messages.length,
    // A fresh sync that returned nothing is not silence, it is a broken pull.
    // Three clients are in exactly this state right now (a stale group id or a
    // dropped WAHA session), and reading it as "quiet for four months" would be
    // worse than saying nothing at all.
    syncedButEmpty: Boolean(data?.syncedAt) && messages.length === 0,
    lastInboundIso: lastInboundMs ? new Date(lastInboundMs).toISOString() : null,
    lastMessageIso: lastAnyMs ? new Date(lastAnyMs).toISOString() : null,
  };
}

async function parseRawNotionTasks(dir) {
  const raw = await readIfExists(path.join(dir, 'raw', 'notion', 'tasks.json'));
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const pages = Array.isArray(data?.pages) ? data.pages : [];
  const byStatus = {};
  const byWeek = {};
  for (const p of pages) {
    const props = p?.properties || {};
    const status = props['Project Status']?.select?.name || 'Bez stavu';
    byStatus[status] = (byStatus[status] || 0) + 1;
    const week = props['Týden']?.select?.name || null;
    if (week) {
      byWeek[week] = byWeek[week] || { total: 0, done: 0 };
      byWeek[week].total += 1;
      if (/hotov|dokon|splněn/i.test(status)) byWeek[week].done += 1;
    }
  }
  return { syncedAt: data?.syncedAt || null, total: pages.length, byStatus, byWeek };
}

async function listFathom(dir) {
  try {
    const files = await fs.readdir(path.join(dir, 'raw', 'fathom'));
    return files
      .filter((f) => !f.startsWith('.'))
      .map((f) => ({ file: f, dateIso: findDate(f) }))
      .filter((f) => f.dateIso)
      .sort((a, b) => b.dateIso.localeCompare(a.dateIso));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* assembly                                                            */
/* ------------------------------------------------------------------ */

async function readClient(activeDir, slug) {
  const dir = path.join(activeDir, slug);
  const [profilText, mereniText, actionText, flagsText, callyText, waText, roadmapText] =
    await Promise.all([
      readIfExists(path.join(dir, 'profil.md')),
      readIfExists(path.join(dir, 'mereni.md')),
      readIfExists(path.join(dir, '_action-items.md')),
      readIfExists(path.join(dir, 'flags.md')),
      readIfExists(path.join(dir, 'cally.md')),
      readIfExists(path.join(dir, 'whatsapp.md')),
      readIfExists(path.join(dir, 'roadmap.md')),
    ]);

  const [whatsappRaw, notionTasks, fathom] = await Promise.all([
    parseRawWhatsapp(dir),
    parseRawNotionTasks(dir),
    listFathom(dir),
  ]);

  const profile = parseProfile(profilText, slug);

  // The stated program week goes stale between syncs (one profile still says
  // W09 while the client is in week 17), so derive it from the start date and
  // keep the written one alongside for comparison.
  const elapsed = daysSince(profile.startIso);
  const programWeek = elapsed == null ? null : Math.floor(elapsed / 7) + 1;
  const daysToEnd = profile.endIso ? -daysSince(profile.endIso) : null;
  // Prefer the real span between the two dates; "3 měsíce" is a label, and
  // rounding it to 12 weeks quietly shortens every program by a few days.
  const spanDays =
    profile.startIso && profile.endIso
      ? daysSince(profile.startIso, Date.parse(`${profile.endIso}T00:00:00Z`))
      : null;
  const totalWeeks =
    spanDays != null ? Math.round(spanDays / 7) : profile.months ? Math.round(profile.months * 4.345) : null;

  const mereni = parseMereni(mereniText);
  const promises = parseActionItems(actionText);
  const flags = parseFlags(flagsText);
  const calls = parseDatedBlocks(callyText, 'call');
  const whatsapp = parseDatedBlocks(waText, 'whatsapp');

  return {
    slug,
    ...profile,
    initials: initialsFromName(profile.name),
    programWeek,
    totalWeeks,
    daysElapsed: elapsed,
    daysToEnd,
    /** The written week disagrees with the calendar by more than a week. */
    programWeekStale:
      profile.programWeekStatedNum != null &&
      programWeek != null &&
      Math.abs(programWeek - profile.programWeekStatedNum) > 1,
    has: {
      profil: Boolean(profilText),
      mereni: Boolean(mereniText),
      actionItems: Boolean(actionText),
      flags: Boolean(flagsText),
      cally: Boolean(callyText),
      whatsapp: Boolean(waText),
      roadmap: Boolean(roadmapText),
    },
    spine: mereni.spine,
    measurements: mereni.weeks,
    promises,
    flags,
    calls,
    whatsappSummaries: whatsapp,
    whatsappRaw,
    notionTasks,
    fathom,
  };
}

/** Cheap change detector: names plus mtimes of every file under the roster. */
async function fingerprint(activeDir) {
  const parts = [];
  let slugs;
  try {
    slugs = (await fs.readdir(activeDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    return '';
  }
  for (const slug of slugs) {
    const dir = path.join(activeDir, slug);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      try {
        const st = await fs.stat(path.join(dir, e.name));
        parts.push(`${slug}/${e.name}:${st.mtimeMs}`);
      } catch {
        /* raced with a sync, skip */
      }
    }
    // raw/ changes every morning; one stat on the directory is enough signal.
    for (const sub of ['raw', path.join('raw', 'notion'), path.join('raw', 'fathom')]) {
      try {
        const st = await fs.stat(path.join(dir, sub));
        parts.push(`${slug}/${sub}:${st.mtimeMs}`);
      } catch {
        /* optional */
      }
    }
  }
  return parts.join('|');
}

/**
 * The index. Cached in memory and rebuilt when any file under the roster
 * changes; there are ten clients and roughly eighty small files, so a full
 * parse is milliseconds and a persistent store would buy nothing but a cache
 * that can disagree with the repo.
 */
export async function getBrainIndex({ force = false } = {}) {
  const brainPath = resolveBrainPath();
  const activeDir = path.join(brainPath, ...ACTIVE_DIR);

  if (!force && cache.data && Date.now() - cache.builtAt < MIN_REBUILD_MS) {
    return cache.data;
  }

  const fp = await fingerprint(activeDir);
  if (!force && cache.data && fp && fp === cache.fingerprint) {
    cache.builtAt = Date.now();
    return cache.data;
  }

  let slugs = [];
  let exists = true;
  try {
    slugs = (await fs.readdir(activeDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    if (err && err.code === 'ENOENT') exists = false;
    else throw err;
  }

  const clients = await Promise.all(slugs.map((slug) => readClient(activeDir, slug)));
  clients.sort((a, b) => a.name.localeCompare(b.name, 'cs'));

  const data = {
    builtAt: new Date().toISOString(),
    brainPath,
    exists,
    clients,
  };
  cache = { builtAt: Date.now(), fingerprint: fp, data };
  return data;
}

export function invalidateBrainIndex() {
  cache = { builtAt: 0, fingerprint: '', data: null };
}
