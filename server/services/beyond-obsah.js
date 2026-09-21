/**
 * Beyond Brain — the content line (osa).
 *
 * What the brain proposes for Instagram and what became of it, in one file
 * in the brain (`workspace/obsah/osa.json`) so the agent reads and writes
 * it like everything else and git keeps the history.
 *
 * Two kinds of pieces:
 *   reel   a moment from a call: the seconds to cut, the words said, a
 *          hook, why it works, what B-roll and caption to give it
 *   story  a sequence of slides, written in Tim's voice and, when Story
 *          Studio is wired, already rendered there
 *
 * One state line for both: navrh → schvaleno → natoceno → zverejneno, with
 * zahozeno as the exit. The velín shows navrh as things prepared by the
 * brain; the Obsah screen shows the whole line.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { resolveBrainPath } from '../utils/brain-path.js';
import { commitBrain } from './beyond-git.js';

const FILE = path.join('workspace', 'obsah', 'osa.json');
export const KINDS = ['reel', 'story'];
export const STATES = ['navrh', 'schvaleno', 'natoceno', 'zverejneno', 'zahozeno'];

let cache = { mtimeMs: -1, data: null };

function filePath() {
  return path.join(resolveBrainPath(), FILE);
}

function emptyFile() {
  return {
    _: 'Osa obsahu: co brain navrhl pro Instagram a co se s tím stalo. kind reel|story, state navrh|schvaleno|natoceno|zverejneno|zahozeno. Reel má zdroj v callu (recordingId, startSec, endSec).',
    polozky: [],
    prosle: [],
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
    cache = { mtimeMs: stat.mtimeMs, data: { ...emptyFile(), ...parsed, polozky: Array.isArray(parsed.polozky) ? parsed.polozky : [], prosle: Array.isArray(parsed.prosle) ? parsed.prosle : [] } };
  } catch (err) {
    console.warn('[obsah] workspace/obsah/osa.json se nedá přečíst:', err?.message || err);
    cache = { mtimeMs: stat.mtimeMs, data: emptyFile() };
  }
  return cache.data;
}

async function write(data, message) {
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  cache = { mtimeMs: -1, data: null };
  const git = await commitBrain(message, { paths: [FILE] });
  if (git.note) console.warn('[obsah]', git.note);
}

export function listItems() {
  return readFile().polozky.map((i) => ({ ...i }));
}

export function getItem(id) {
  return readFile().polozky.find((i) => i.id === id) || null;
}

const str = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** A new piece on the line. Reels need their source call; stories their slides. */
export async function addItem(input, { by = 'agent' } = {}) {
  const kind = KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) throw new Error('kind musí být reel nebo story');
  const item = {
    id: `o-${randomBytes(4).toString('hex')}`,
    kind,
    state: 'navrh',
    title: str(input.title, 120),
    hook: str(input.hook, 300),
    why: str(input.why, 600),
    caption: str(input.caption, 1500),
    client: str(input.client, 80),
    // Where it came from, in words a person reads at a glance: "call
    // tobias-beranek 20.9., část 3" or "hlasovka 19.9." plus the files.
    zdroj: str(input.zdroj, 300),
    zdrojSoubory: Array.isArray(input.zdrojSoubory) ? input.zdrojSoubory.map((f) => String(f).trim()).filter(Boolean).slice(0, 8) : [],
    createdBy: by,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    note: null,
  };
  if (!item.title && !item.hook) throw new Error('title nebo hook chybí');
  if (kind === 'reel') {
    item.source = {
      kind: 'call',
      date: str(input.date, 10),
      recordingId: str(input.recordingId, 40),
      fathom: str(input.fathom, 300),
      transcript: str(input.transcript, 200),
    };
    item.startSec = num(input.startSec);
    item.endSec = num(input.endSec);
    item.quote = str(input.quote, 2000);
    item.speaker = str(input.speaker, 80);
    item.broll = str(input.broll, 800);
    item.format = str(input.format, 40) || 'reel';
    if (item.startSec == null || item.endSec == null || item.endSec <= item.startSec) throw new Error('reel potřebuje startSec a endSec (sekundy od začátku nahrávky)');
  } else {
    item.slides = Array.isArray(input.slides) ? input.slides.map((s) => String(s).slice(0, 1500)).filter(Boolean).slice(0, 12) : [];
    item.text = str(input.text, 6000);
    item.studio = input.studio && typeof input.studio === 'object'
      ? { sequenceId: str(input.studio.sequenceId, 80), url: str(input.studio.url, 300), renders: Array.isArray(input.studio.renders) ? input.studio.renders.map((r) => String(r).slice(0, 300)).slice(0, 12) : [] }
      : null;
    if (!item.slides.length && !item.text) throw new Error('story potřebuje slides nebo text');
  }
  const data = structuredClone(readFile());
  data.polozky.unshift(item);
  await write(data, `Obsah: ${kind} „${(item.title || item.hook).slice(0, 50)}" (${by})`);
  return item;
}

export async function updateItem(id, patch, { by = 'app' } = {}) {
  const data = structuredClone(readFile());
  const it = data.polozky.find((x) => x.id === id);
  if (!it) throw new Error(`položka ${id} neexistuje`);
  if (patch.state != null) {
    if (!STATES.includes(patch.state)) throw new Error(`stav musí být jeden z ${STATES.join(', ')}`);
    it.state = patch.state;
  }
  for (const k of ['title', 'hook', 'why', 'caption', 'note', 'broll', 'quote', 'format', 'text', 'zdroj']) {
    if (patch[k] !== undefined) it[k] = patch[k] == null ? null : String(patch[k]).trim();
  }
  if (patch.startSec !== undefined) it.startSec = num(patch.startSec);
  if (patch.endSec !== undefined) it.endSec = num(patch.endSec);
  if (patch.slides !== undefined && Array.isArray(patch.slides)) it.slides = patch.slides.map((s) => String(s)).filter(Boolean);
  if (patch.studio !== undefined) it.studio = patch.studio || null;
  if (patch.clip !== undefined) it.clip = patch.clip || null;
  if (patch.publishedAt !== undefined) it.publishedAt = patch.publishedAt || null;
  it.updatedAt = new Date().toISOString();
  it.updatedBy = by;
  await write(data, `Obsah: ${it.kind} „${(it.title || it.hook || it.id).slice(0, 50)}" ${patch.state ? `→ ${patch.state}` : 'upraveno'} (${by})`);
  return it;
}

export async function removeItem(id, { by = 'app' } = {}) {
  const data = structuredClone(readFile());
  const i = data.polozky.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`položka ${id} neexistuje`);
  const [it] = data.polozky.splice(i, 1);
  await write(data, `Obsah smazán: ${(it.title || it.hook || it.id).slice(0, 50)} (${by})`);
  return it;
}

/**
 * Has this call already been looked at for moments? Either it produced
 * some, or it was read and found to have none, which is recorded too so the
 * same transcript is not mined every half hour for ever.
 */
export function hasMomentsFor(recordingId) {
  if (!recordingId) return false;
  const data = readFile();
  const rec = String(recordingId);
  if (data.polozky.some((i) => i.kind === 'reel' && i.source?.recordingId === rec)) return true;
  return Array.isArray(data.prosle) && data.prosle.some((p) => p.recordingId === rec);
}

/** Remember that a call was read, with how many moments it gave. */
export async function markChecked({ recordingId, slug, date, count }) {
  const data = structuredClone(readFile());
  if (!Array.isArray(data.prosle)) data.prosle = [];
  if (data.prosle.some((p) => p.recordingId === String(recordingId))) return;
  data.prosle.push({ recordingId: String(recordingId), slug: slug || null, date: date || null, count: Number(count) || 0, at: new Date().toISOString() });
  await write(data, `Obsah: call ${slug || ''} ${date || ''} projitý (${count || 0} momentů)`);
}

/** The pieces waiting for a person, for the velín. */
export function pending() {
  return readFile().polozky.filter((i) => i.state === 'navrh');
}
