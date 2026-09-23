/**
 * Beyond Brain — which stage of the relationship each client is in.
 *
 * The stage is derived from how the work is actually going (the signals the
 * velín already computes), because a stage nobody maintains is a stage that
 * lies. When a person disagrees with the derivation they drag the card, and
 * that choice is remembered here and wins until they move it again.
 *
 * It lives in the brain (`workspace/pipeline.json`) rather than the app
 * database so the agent reads the same truth and git keeps the history of who
 * moved whom and when.
 */
import fs from 'node:fs';
import path from 'node:path';

import { resolveBrainPath } from '../utils/brain-path.js';
import { commitBrainLater } from './beyond-git.js';

const FILE = path.join('workspace', 'pipeline.json');

/** The columns, in the order they are read. */
export const STAGES = [
  { key: 'v-pohode', label: 'V pohodě', hint: 'Jede podle plánu' },
  { key: 'drhne', label: 'Drhne', hint: 'Něco vázne, ještě to není průšvih' },
  { key: 'riziko', label: 'Riziko', hint: 'Potřebuje nás teď' },
  { key: 'dobehl', label: 'Doběhl', hint: 'Program skončil' },
];

const KEYS = new Set(STAGES.map((s) => s.key));

let cache = { mtimeMs: -1, data: null };

function filePath() {
  return path.join(resolveBrainPath(), FILE);
}

function empty() {
  return {
    _: 'Fáze klientů na tabuli. Bez záznamu se fáze odvodí ze signálů; záznam vznikne, až někdo kartu přetáhne, a pak platí on.',
    klienti: {},
  };
}

function read() {
  const p = filePath();
  let stat;
  try {
    stat = fs.statSync(p);
  } catch {
    return empty();
  }
  if (cache.data && cache.mtimeMs === stat.mtimeMs) return cache.data;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    cache = { mtimeMs: stat.mtimeMs, data: { ...empty(), ...parsed, klienti: parsed.klienti && typeof parsed.klienti === 'object' ? parsed.klienti : {} } };
  } catch (err) {
    console.warn('[pipeline] workspace/pipeline.json se nedá přečíst:', err?.message || err);
    cache = { mtimeMs: stat.mtimeMs, data: empty() };
  }
  return cache.data;
}

/** The stage the signals say a client is in. */
export function derivedStage(client) {
  if (client.isActive === false) return 'dobehl';
  const counts = client.ownCounts || client.counts || {};
  if (counts.critical > 0) return 'riziko';
  if (counts.watch > 0) return 'drhne';
  return 'v-pohode';
}

/**
 * Where a client's card belongs, and whether that is a person's choice.
 * A hand-placed card whose derivation has since moved on still sits where it
 * was put; the screen marks it so the disagreement is visible, not silent.
 */
export function stageFor(client) {
  const derived = derivedStage(client);
  const set = read().klienti[client.slug];
  if (set && KEYS.has(set.stage)) {
    return { stage: set.stage, derived, manual: true, by: set.by || null, at: set.at || null };
  }
  return { stage: derived, derived, manual: false, by: null, at: null };
}

/** Put a client in a column by hand, or drop the choice and follow the signals again. */
export async function setStage(slug, stage, { by = 'app' } = {}) {
  if (stage != null && !KEYS.has(stage)) throw new Error(`fáze musí být jedna z ${[...KEYS].join(', ')}`);
  const data = structuredClone(read());
  if (stage == null) delete data.klienti[slug];
  else data.klienti[slug] = { stage, by, at: new Date().toISOString() };
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  cache = { mtimeMs: -1, data: null };
  void commitBrainLater(stage == null ? `Tabule: ${slug} zpět na automatickou fázi (${by})` : `Tabule: ${slug} → ${stage} (${by})`, { paths: [FILE] });
  return { slug, stage };
}
