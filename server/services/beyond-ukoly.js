/**
 * Beyond Brain — the task list.
 *
 * What a person has to do today, kept in the brain (`workspace/ukoly.json`)
 * so the agent can read it, add to it and see what got done, the same way it
 * sees everything else. Git is the history.
 *
 * A task has a priority (1 to 4, Todoist style), a state (none, work, done),
 * an owner, who created it (a person or the agent), a client, a due day, and
 * optionally a "prep": something the brain already prepared for it. The
 * prepared messages waiting to be sent and the proposed changes to the brain's
 * rules are not stored here; they are folded in at read time as tasks with a
 * prep, so the morning list is one list. Their state (work) lives in `stavy`.
 *
 * Quick add understands "p1 dnes zavolat Pavlovi": priority, due day, client
 * by first name, `@štěpán` for the owner. The rest is the text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { resolveBrainPath } from '../utils/brain-path.js';
import { commitBrainLater } from './beyond-git.js';
import { getPeople } from './beyond-people.js';
import { toWall } from './beyond-time.js';

const FILE = path.join('workspace', 'ukoly.json');
const STATES = new Set(['none', 'work', 'done']);
const DONE_KEEP_DAYS = 14;

let cache = { mtimeMs: -1, data: null };

function filePath() {
  return path.join(resolveBrainPath(), FILE);
}

function emptyFile() {
  return {
    _: 'Úkoly lidí i agenta. Priorita 1 až 4, stav none/work/done, owner = klíč osoby (tim, stepan), createdBy = osoba nebo agent. Připravené zprávy a návrhy do mozku tady nejsou, skládají se za běhu; jejich stav je ve `stavy`.',
    ukoly: [],
    stavy: {},
  };
}

export function readFile() {
  const p = filePath();
  let stat;
  try {
    stat = fs.statSync(p);
  } catch {
    return emptyFile();
  }
  if (cache.data && cache.mtimeMs === stat.mtimeMs) return cache.data;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    cache = {
      mtimeMs: stat.mtimeMs,
      data: { ...emptyFile(), ...parsed, ukoly: Array.isArray(parsed.ukoly) ? parsed.ukoly : [], stavy: parsed.stavy && typeof parsed.stavy === 'object' ? parsed.stavy : {} },
    };
  } catch (err) {
    console.warn('[ukoly] workspace/ukoly.json se nedá přečíst:', err?.message || err);
    cache = { mtimeMs: stat.mtimeMs, data: emptyFile() };
  }
  return cache.data;
}

async function write(data, message) {
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  cache = { mtimeMs: -1, data: null };
  // The screen gets its answer now; git catches up right behind.
  void commitBrainLater(message, { paths: [FILE] });
}

/* ------------------------------------------------------------------ */
/* quick add                                                           */
/* ------------------------------------------------------------------ */

const DAY_WORDS = {
  dnes: 0, zitra: 1, pozitri: 2,
  pondeli: 'd1', po: 'd1', utery: 'd2', ut: 'd2', streda: 'd3', st: 'd3', ctvrtek: 'd4', ct: 'd4', patek: 'd5', pa: 'd5', sobota: 'd6', so: 'd6', nedele: 'd0', ne: 'd0',
};

function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isoDay(w) {
  return `${w.getUTCFullYear()}-${String(w.getUTCMonth() + 1).padStart(2, '0')}-${String(w.getUTCDate()).padStart(2, '0')}`;
}

/** Day words resolve on the wall clock of the app's zone, not the box's. */
function resolveDay(word, now = new Date()) {
  const v = DAY_WORDS[word];
  if (v === undefined) return null;
  const d = toWall(now);
  d.setUTCHours(12, 0, 0, 0);
  if (typeof v === 'number') {
    d.setUTCDate(d.getUTCDate() + v);
    return isoDay(d);
  }
  const target = Number(v.slice(1));
  let delta = (target - d.getUTCDay() + 7) % 7;
  if (delta === 0) delta = 7; // "pátek" said on a Friday means next Friday
  d.setUTCDate(d.getUTCDate() + delta);
  return isoDay(d);
}

/**
 * Parse "p1 dnes zavolat Pavlovi @štěpán". Returns the fields plus the text
 * with the tokens removed. `clients` is [{slug, name, first}] to match names.
 */
export function parseQuick(text, { me = 'tim', clients = [], now = new Date() } = {}) {
  const people = getPeople();
  // `tokens` says which words were read as what, by their index among the
  // whitespace-separated words, so the input can colour them as they are typed.
  const out = { priority: 4, due: null, client: null, owner: me, words: [], tokens: [] };
  let wi = -1;
  // Czech first names decline: Pavel → Pavlovi, Marek → Markovi, Honza →
  // Honzovi. Match on the name, the name without its last vowel, and the name
  // with the vowel before the last consonant dropped.
  const cl = clients.map((c) => {
    const f = fold(c.first || c.name.split(' ')[0]);
    const stems = [...new Set([f, f.replace(/[aeiouy]+$/, ''), f.replace(/[aeiouy]([^aeiouy])$/, '$1')])].filter((x) => x.length >= 3);
    return { ...c, f, stems };
  });
  for (const w of String(text || '').trim().split(/\s+/)) {
    if (!w) continue;
    wi += 1;
    const f = fold(w).replace(/[.,!?]+$/, '');
    const pm = /^(?:p|!)([1-4])$/.exec(f);
    if (pm) { out.priority = Number(pm[1]); out.tokens.push({ i: wi, word: w, kind: 'priority' }); continue; }
    const day = resolveDay(f, now);
    if (day) { out.due = day; out.tokens.push({ i: wi, word: w, kind: 'due' }); continue; }
    const dm = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(f);
    if (dm) {
      const d = toWall(now);
      d.setUTCHours(12, 0, 0, 0);
      d.setUTCMonth(Number(dm[2]) - 1, Number(dm[1]));
      if (d.getTime() < toWall(now).getTime() - 12 * 3600_000) d.setUTCFullYear(d.getUTCFullYear() + 1);
      out.due = isoDay(d);
      out.tokens.push({ i: wi, word: w, kind: 'due' });
      continue;
    }
    if (f.startsWith('@')) {
      const a = f.slice(1);
      const person = people.find((p) => p.key === a || p.aliases.some((al) => fold(al) === a));
      if (person) { out.owner = person.key; out.tokens.push({ i: wi, word: w, kind: 'owner' }); continue; }
      const c = cl.find((x) => x.f === a || x.slug === a || x.stems.some((st) => a.startsWith(st)));
      if (c) { out.client = c.slug; out.tokens.push({ i: wi, word: w, kind: 'client' }); continue; }
    }
    if (!out.client && f.length >= 3) {
      const hit = cl.find((x) => x.stems.some((st) => f.startsWith(st)));
      if (hit) { out.client = hit.slug; out.tokens.push({ i: wi, word: w, kind: 'client' }); }
    }
    out.words.push(w);
  }
  out.text = out.words.join(' ').trim();
  delete out.words;
  return out;
}

/* ------------------------------------------------------------------ */
/* crud                                                                */
/* ------------------------------------------------------------------ */

export function listTasks() {
  return readFile().ukoly.map((t) => ({ ...t }));
}

export function getTask(id) {
  return readFile().ukoly.find((t) => t.id === id) || null;
}

export async function createTask({ text, priority = 4, client = null, owner, createdBy, due = null, note = null, prep = null, state = 'none' }) {
  if (!text || !String(text).trim()) throw new Error('text chybí');
  const data = structuredClone(readFile());
  const task = {
    id: `u-${randomBytes(4).toString('hex')}`,
    text: String(text).trim().slice(0, 300),
    priority: Math.min(4, Math.max(1, Number(priority) || 4)),
    state: STATES.has(state) ? state : 'none',
    client: client || null,
    owner: owner || getPeople()[0]?.key || 'tim',
    createdBy: String(createdBy || 'app'),
    due: due || null,
    note: note ? String(note).slice(0, 200) : null,
    prep: prep || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    doneAt: null,
  };
  data.ukoly.unshift(task);
  await write(data, `Úkol: ${task.text.slice(0, 60)} (${task.createdBy})`);
  return task;
}

export async function updateTask(id, patch, { by = 'app' } = {}) {
  const data = structuredClone(readFile());
  const t = data.ukoly.find((x) => x.id === id);
  if (!t) throw new Error(`úkol ${id} neexistuje`);
  if (patch.text != null) t.text = String(patch.text).trim().slice(0, 300);
  if (patch.priority != null) t.priority = Math.min(4, Math.max(1, Number(patch.priority) || 4));
  if (patch.state != null) {
    if (!STATES.has(patch.state)) throw new Error('stav musí být none, work nebo done');
    t.state = patch.state;
    t.doneAt = patch.state === 'done' ? new Date().toISOString() : null;
  }
  if (patch.client !== undefined) t.client = patch.client || null;
  if (patch.owner != null) t.owner = String(patch.owner);
  if (patch.due !== undefined) t.due = patch.due || null;
  if (patch.note !== undefined) t.note = patch.note ? String(patch.note).slice(0, 200) : null;
  if (patch.prep !== undefined) t.prep = patch.prep || null;
  t.updatedAt = new Date().toISOString();
  t.updatedBy = by;
  await write(data, `Úkol: ${t.text.slice(0, 60)} ${patch.state ? `→ ${patch.state}` : 'upraven'} (${by})`);
  return t;
}

export async function removeTask(id, { by = 'app' } = {}) {
  const data = structuredClone(readFile());
  const i = data.ukoly.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`úkol ${id} neexistuje`);
  const [t] = data.ukoly.splice(i, 1);
  await write(data, `Úkol smazán: ${t.text.slice(0, 60)} (${by})`);
  return t;
}

/** State of a folded-in item (a proposal, a brain change) that has no row of its own. */
export function virtualState(key) {
  return readFile().stavy?.[key] || 'none';
}

export async function setVirtualState(key, state, { by = 'app' } = {}) {
  if (!STATES.has(state)) throw new Error('stav musí být none, work nebo done');
  const data = structuredClone(readFile());
  if (state === 'none') delete data.stavy[key];
  else data.stavy[key] = state;
  await write(data, `Úkol ${key} → ${state} (${by})`);
  return state;
}

/** Drop done tasks older than two weeks so the file does not grow for ever. */
export async function pruneDone() {
  const data = structuredClone(readFile());
  const cutoff = Date.now() - DONE_KEEP_DAYS * 24 * 60 * 60 * 1000;
  const before = data.ukoly.length;
  data.ukoly = data.ukoly.filter((t) => !(t.state === 'done' && t.doneAt && Date.parse(t.doneAt) < cutoff));
  const stale = Object.keys(data.stavy);
  if (data.ukoly.length !== before) await write(data, `Úkoly: ${before - data.ukoly.length} hotových starších 14 dní smazáno`);
  return { removed: before - data.ukoly.length, virtualKeys: stale.length };
}

/** Does an open task with this prep reference already exist? */
export function findByPrepRef(kind, ref) {
  return readFile().ukoly.find((t) => t.state !== 'done' && t.prep?.kind === kind && t.prep?.ref === ref) || null;
}
