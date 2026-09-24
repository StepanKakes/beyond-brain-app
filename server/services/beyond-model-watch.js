/**
 * Beyond Brain — noticing when a new model ships.
 *
 * The brain never names a model by its full id: jobs and chat ask for `opus`,
 * `sonnet` or `haiku`, and Claude Code points each alias at the newest model
 * of that tier. So once the nightly update brings a Claude Code that knows a
 * new model, every run of that tier is on it the same morning, with no change
 * here. What this adds is the telling: what changed, what it costs against
 * what it replaced, and when a new model is cheaper in a tier the brain does
 * not use yet, a nudge for a person to decide. Moving work between tiers is a
 * quality decision; it stays with a person.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Anthropic list prices per million tokens (input / output), from the
 * published model table. A model missing here is reported as "cena neznámá"
 * rather than guessed.
 */
export const PRICES = {
  'claude-fable-5-1': { tier: 'fable', input: 10, output: 50 },
  'claude-fable-5': { tier: 'fable', input: 10, output: 50 },
  'claude-opus-5-5': { tier: 'opus', input: 4, output: 20 },
  'claude-opus-5': { tier: 'opus', input: 5, output: 25 },
  'claude-opus-4-8': { tier: 'opus', input: 5, output: 25 },
  'claude-opus-4-7': { tier: 'opus', input: 5, output: 25 },
  'claude-sonnet-5': { tier: 'sonnet', input: 2, output: 10 },
  'claude-sonnet-4-6': { tier: 'sonnet', input: 3, output: 15 },
  'claude-haiku-4-5': { tier: 'haiku', input: 1, output: 5 },
};

const FILE = path.join(os.homedir(), '.cloudcli', 'beyond-models-seen.json');

/** "Opus 5.5 with 1M context · …" → "claude-opus-5-5". */
export function idFromDescription(desc) {
  const m = /^(Fable|Opus|Sonnet|Haiku|Mythos)\s+(\d+(?:\.\d+)?)/i.exec(String(desc || '').trim());
  if (!m) return null;
  return `claude-${m[1].toLowerCase()}-${m[2].replace('.', '-')}`;
}

function readSeen() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeSeen(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function price(id) {
  const p = PRICES[id];
  return p ? `$${p.input} / $${p.output}` : 'cena neznámá';
}

/**
 * Compare what Claude Code offers now with what it offered last time.
 * Returns the lines worth telling a person, or [] when nothing changed.
 * The first run only records the baseline.
 */
export function diffModels(models) {
  const now = {};
  for (const m of models || []) {
    const id = idFromDescription(m.description) || m.value;
    now[m.value] = { id, label: m.displayName || m.value, description: m.description || '' };
  }
  const before = readSeen();
  writeSeen({ at: new Date().toISOString(), models: now });
  if (!before?.models) return [];

  const lines = [];
  for (const [alias, cur] of Object.entries(now)) {
    const old = before.models[alias];
    if (!old) {
      lines.push(`Nový model v nabídce: ${cur.label} (${cur.id}), ${price(cur.id)} za milion tokenů.`);
      continue;
    }
    if (old.id !== cur.id) {
      const a = PRICES[old.id];
      const b = PRICES[cur.id];
      let delta = '';
      if (a && b) {
        const pct = Math.round((1 - b.input / a.input) * 100);
        delta = pct > 0 ? `, o ${pct} % levnější` : pct < 0 ? `, o ${-pct} % dražší` : ', stejná cena';
      }
      lines.push(`${alias} teď jede na ${cur.id} místo ${old.id} (${price(cur.id)}${delta}). Úlohy s tímhle aliasem jsou na něm od dnešního rána.`);
    }
  }

  // A tier the brain does not use can still have become the better deal.
  const used = new Set(['opus', 'sonnet', 'haiku']);
  for (const cur of Object.values(now)) {
    const p = PRICES[cur.id];
    if (!p || used.has(p.tier)) continue;
    const cheaperThanOpus = p.input < PRICES['claude-opus-5-5'].input;
    if (cheaperThanOpus) lines.push(`${cur.id} je levnější než Opus (${price(cur.id)}). Stojí za zvážení pro úlohy, které dnes jedou na Opusu.`);
  }
  return lines;
}
