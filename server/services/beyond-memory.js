/**
 * Beyond Brain — the agent's own notes.
 *
 * The brain holds everything about clients. It held nothing about the agent
 * itself: what Tim corrected last week, which phrasing he keeps rejecting,
 * that Štěpán reads the brief and Tim does not. That vanished with each chat.
 *
 * Two small files fix it, and their smallness is the point:
 *
 *   system/pamet-agenta.md   what the agent learned about the work   (2 200 znaků)
 *   system/tim.md            what it knows about the people           (1 375 znaků)
 *
 * The limit is enforced, not suggested. When a file is full the tool refuses
 * and the agent has to merge or drop something before it can add. That is
 * what keeps this from becoming one more pile nobody reads. Both files go into
 * every prompt, in full, so there is no retrieval to get wrong.
 *
 * Client facts do not belong here; they belong in the client's folder. This is
 * for the things that apply to every session regardless of which client.
 */
import fs from 'node:fs';
import path from 'node:path';

import { resolveBrainPath } from '../utils/brain-path.js';
import { commitBrain } from './beyond-git.js';

export const TARGETS = {
  agent: { file: path.join('system', 'pamet-agenta.md'), limit: 2200, title: 'Paměť agenta' },
  tim: { file: path.join('system', 'tim.md'), limit: 1375, title: 'O lidech' },
};

function fileFor(target) {
  const t = TARGETS[target];
  if (!t) throw new Error(`cíl paměti musí být agent nebo tim, ne „${target}"`);
  return { ...t, abs: path.join(resolveBrainPath(), t.file) };
}

function readTarget(target) {
  const t = fileFor(target);
  try {
    return { ...t, text: fs.readFileSync(t.abs, 'utf8') };
  } catch {
    return { ...t, text: '' };
  }
}

/** Entries are bullet lines. Everything else (a heading) is kept as-is. */
function entriesOf(text) {
  return text
    .split('\n')
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean);
}

function usage(text, limit) {
  const used = entriesOf(text).join('\n').length;
  return { used, limit, pct: Math.round((used / limit) * 100) };
}

function suspicious(text) {
  const t = String(text);
  if (/[\u200b-\u200f\u2028-\u202f\ufeff]/.test(t)) return 'obsahuje neviditelné znaky';
  if (/ignore (all )?(previous|prior) instructions|<script|system prompt/i.test(t)) return 'vypadá jako pokus o injekci instrukcí';
  if (t.length > 400) return 'jedna položka má nejvýš 400 znaků';
  return null;
}

async function writeTarget(target, entries, header, message) {
  const t = fileFor(target);
  const body = `${header.trim()}\n\n${entries.map((e) => `- ${e}`).join('\n')}\n`;
  fs.mkdirSync(path.dirname(t.abs), { recursive: true });
  fs.writeFileSync(t.abs, body, 'utf8');
  const git = await commitBrain(message, { paths: [t.file] });
  if (git.note) console.warn('[pamet]', git.note);
}

function headerOf(text, target) {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => /^\s*[-*]\s+/.test(l));
  const head = (idx < 0 ? lines : lines.slice(0, idx)).join('\n').trim();
  if (head) return head;
  return target === 'agent'
    ? '# Paměť agenta\n\nCo jsem se naučil o práci. Jedna položka = jedno pravidlo nebo fakt. Limit hlídá nástroj `pamet`.'
    : '# O lidech\n\nCo vím o Timovi, Štěpánovi a jak chtějí pracovat. Limit hlídá nástroj `pamet`.';
}

/** Add one entry. Refuses when full, with the current list so the agent can merge. */
export async function add(target, text, { by = 'agent' } = {}) {
  const bad = suspicious(text);
  if (bad) return { ok: false, error: bad };
  const cur = readTarget(target);
  const entries = entriesOf(cur.text);
  const clean = String(text).trim();
  if (entries.some((e) => e.toLowerCase() === clean.toLowerCase())) return { ok: false, error: 'stejná položka už tam je' };
  const next = [...entries, clean];
  const u = usage(next.map((e) => `- ${e}`).join('\n'), cur.limit);
  if (u.used > cur.limit) {
    return {
      ok: false,
      error: `plné: ${u.used}/${cur.limit} znaků. Nejdřív něco sluč (replace) nebo odeber (remove), pak zkus znovu.`,
      entries,
    };
  }
  await writeTarget(target, next, headerOf(cur.text, target), `Agent: paměť (${target}) +1 (${by})`);
  return { ok: true, usage: u, count: next.length };
}

function findOne(entries, needle) {
  const n = String(needle || '').trim().toLowerCase();
  if (!n) return { error: 'old_text chybí' };
  const hits = entries.map((e, i) => (e.toLowerCase().includes(n) ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) return { error: 'nic takového v paměti není' };
  if (hits.length > 1) return { error: `„${needle}" sedí na ${hits.length} položek, upřesni` };
  return { index: hits[0] };
}

export async function replace(target, oldText, newText, { by = 'agent' } = {}) {
  const bad = suspicious(newText);
  if (bad) return { ok: false, error: bad };
  const cur = readTarget(target);
  const entries = entriesOf(cur.text);
  const found = findOne(entries, oldText);
  if (found.error) return { ok: false, error: found.error, entries };
  const next = entries.slice();
  next[found.index] = String(newText).trim();
  const u = usage(next.map((e) => `- ${e}`).join('\n'), cur.limit);
  if (u.used > cur.limit) return { ok: false, error: `plné: ${u.used}/${cur.limit} znaků`, entries };
  await writeTarget(target, next, headerOf(cur.text, target), `Agent: paměť (${target}) upravena (${by})`);
  return { ok: true, usage: u, count: next.length };
}

export async function remove(target, oldText, { by = 'agent' } = {}) {
  const cur = readTarget(target);
  const entries = entriesOf(cur.text);
  const found = findOne(entries, oldText);
  if (found.error) return { ok: false, error: found.error, entries };
  const next = entries.filter((_, i) => i !== found.index);
  await writeTarget(target, next, headerOf(cur.text, target), `Agent: paměť (${target}) -1 (${by})`);
  return { ok: true, usage: usage(next.map((e) => `- ${e}`).join('\n'), cur.limit), count: next.length };
}

export function snapshot(target) {
  const cur = readTarget(target);
  const entries = entriesOf(cur.text);
  return { target, title: cur.title, entries, usage: usage(entries.map((e) => `- ${e}`).join('\n'), cur.limit) };
}

/**
 * The block that goes into every prompt. Frozen at the start of a session on
 * purpose: what the agent writes mid-session shows up next time, which keeps
 * the prompt prefix stable for caching.
 */
export function promptBlock() {
  const parts = [];
  for (const target of Object.keys(TARGETS)) {
    const s = snapshot(target);
    if (!s.entries.length) continue;
    parts.push(
      `## ${s.title} [${s.usage.pct} % · ${s.usage.used}/${s.usage.limit} znaků]\n` +
        s.entries.map((e) => `- ${e}`).join('\n'),
    );
  }
  if (!parts.length) return '';
  return [
    '# Tvoje paměť (nástroj `pamet`)',
    'Tohle sis zapsal v minulých sezeních. Platí to v každé session bez ohledu na klienta.',
    'Když se dozvíš něco trvalého (oprava od Tima, preference, pravidlo práce), zapiš to nástrojem `pamet`;',
    'fakta o klientovi tam nepatří, ta patří do jeho složky. Nezapisuj triviality ani to, co je v souborech.',
    '',
    ...parts,
  ].join('\n');
}
