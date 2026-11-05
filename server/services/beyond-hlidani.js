/**
 * Beyond Brain — what people decided about the "co hlídat" list.
 *
 * Signals are computed from the brain, so there is nothing to tick off in them.
 * What can be kept is the decision: this one is handled, or show it again in a
 * week. Kept in the brain (`workspace/hlidani.json`), so Tim and Štěpán see the
 * same list and the jobs that read signals respect it.
 *
 * A handled signal stays hidden while its evidence is the same and comes back
 * when something new appears. Every signal carries that evidence as `stopa`, a
 * list of strings: the promises behind it, the day of the client's last message.
 *
 * This file also keeps what the brain ticked off by itself, with the evidence,
 * so a person can read why and take it back.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { resolveBrainPath } from '../utils/brain-path.js';
import { commitBrainLater } from './beyond-git.js';

const FILE = path.join('workspace', 'hlidani.json');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_TICKED_MS = 30 * 24 * 60 * 60 * 1000;

let cache = { mtimeMs: -1, data: null };

function emptyFile() {
  return {
    _: 'Rozhodnutí lidí o položkách Co hlídat a co brain odškrtl sám. Klíč je klient:typ.',
    polozky: {},
    odskrtnuto: [],
    kontrola: {},
  };
}

function read() {
  const p = path.join(resolveBrainPath(), FILE);
  let stat;
  try {
    stat = fs.statSync(p);
  } catch {
    return emptyFile();
  }
  if (cache.data && cache.mtimeMs === stat.mtimeMs) return cache.data;
  try {
    cache = { mtimeMs: stat.mtimeMs, data: { ...emptyFile(), ...JSON.parse(fs.readFileSync(p, 'utf8')) } };
  } catch (err) {
    console.warn('[hlidani] workspace/hlidani.json se nedá přečíst:', err?.message || err);
    cache = { mtimeMs: stat.mtimeMs, data: emptyFile() };
  }
  return cache.data;
}

function write(data, message) {
  const p = path.join(resolveBrainPath(), FILE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  cache = { mtimeMs: -1, data: null };
  void commitBrainLater(message, { paths: [FILE] });
}

const key = (slug, type) => `${slug}:${type}`;

/** Why a signal is hidden right now, or null when it should be shown. */
export function hiddenBecause(slug, signal, now = Date.now()) {
  const entry = read().polozky[key(slug, signal.type)];
  if (!entry) return null;
  if (entry.stav === 'odlozeno') {
    return Date.parse(entry.until) > now ? { stav: 'odlozeno', until: entry.until, by: entry.by } : null;
  }
  const known = new Set(entry.stopa || []);
  const same = (signal.stopa || []).every((s) => known.has(s));
  return same ? { stav: 'vyreseno', at: entry.at, by: entry.by } : null;
}

/** `vyreseno`, `odlozit` or `vratit` for one signal of one client. */
export function decideSignal(slug, type, { action, stopa = [], by = 'app' }) {
  const data = structuredClone(read());
  const k = key(slug, type);
  const at = new Date().toISOString();
  if (action === 'vratit') delete data.polozky[k];
  else if (action === 'vyreseno') data.polozky[k] = { stav: 'vyreseno', stopa, at, by };
  else if (action === 'odlozit') data.polozky[k] = { stav: 'odlozeno', until: new Date(Date.now() + WEEK_MS).toISOString(), at, by };
  else throw new Error('neznámá akce');
  write(data, `Co hlídat: ${k} → ${action} (${by})`);
}

/* ---- what the brain ticked off by itself ---------------------------- */

export function listTicked(slug) {
  const cutoff = Date.now() - KEEP_TICKED_MS;
  return read().odskrtnuto.filter((t) => t.slug === slug && !t.vraceno && Date.parse(t.at) > cutoff);
}

export function getTicked(id) {
  return read().odskrtnuto.find((t) => t.id === id) || null;
}

/** Taken back by a person: the check must not close the same thing again. */
export function wasTakenBack(slug, ref) {
  return read().odskrtnuto.some((t) => t.slug === slug && t.ref === ref && t.vraceno);
}

export function recordTicked(items) {
  if (!items.length) return;
  const data = structuredClone(read());
  const cutoff = Date.now() - KEEP_TICKED_MS;
  data.odskrtnuto = data.odskrtnuto.filter((t) => t.vraceno || Date.parse(t.at) > cutoff);
  const at = new Date().toISOString();
  data.odskrtnuto.unshift(...items.map((t) => ({ id: `o-${randomBytes(4).toString('hex')}`, at, ...t })));
  write(data, `Brain odškrtl: ${items.length}×`);
}

export function markTakenBack(id, by = 'app') {
  const data = structuredClone(read());
  const entry = data.odskrtnuto.find((t) => t.id === id);
  if (!entry) throw new Error('položka neexistuje');
  entry.vraceno = true;
  entry.vratil = by;
  write(data, `Vráceno, co brain odškrtl: ${entry.text.slice(0, 60)} (${by})`);
  return entry;
}

/* ---- what the check last looked at, so nothing new means no agent run ---- */

export function lastChecked(slug) {
  return read().kontrola[slug] || null;
}

export function rememberChecked(stamps) {
  const data = structuredClone(read());
  Object.assign(data.kontrola, stamps);
  write(data, 'Kontrola splněného: razítka');
}
