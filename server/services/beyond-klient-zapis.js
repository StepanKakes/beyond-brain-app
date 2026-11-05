/**
 * Beyond Brain — small writes into a client's files from the app.
 *
 * Ticks a promise in `_action-items.md` and moves a risk in `flags.md`. The
 * files stay the source of truth, so the parsers and the agents read the same
 * result as the person who tapped.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveBrainPath } from '../utils/brain-path.js';
import { commitBrainLater } from './beyond-git.js';
import { invalidateBrainIndex } from './brain-index.js';

const relFile = (slug, name) => path.join('clients', 'aktivni', slug, name);

async function edit(slug, name, change, message) {
  const rel = relFile(slug, name);
  const abs = path.join(resolveBrainPath(), rel);
  const before = await fs.readFile(abs, 'utf8');
  const after = change(before);
  if (after === before) throw new Error('v souboru se to nenašlo, možná se mezitím změnil');
  await fs.writeFile(abs, after, 'utf8');
  invalidateBrainIndex();
  void commitBrainLater(message, { paths: [rel] });
}

const plain = (text) => String(text).replace(/\*\*/g, '').trim();
const stripNote = (text) => text.replace(/\s*\(brain: [^)]*\)$/, '');

/** Tick one open promise. `note` says what the brain saw, when it was the brain. */
export async function closePromise(slug, text, { note = null, by = 'app' } = {}) {
  const wanted = plain(text);
  await edit(
    slug,
    '_action-items.md',
    (content) => {
      let found = false;
      return content
        .split('\n')
        .map((line) => {
          const m = !found && line.match(/^(\s*[-*]\s*\[) (\]\s*)(.+)$/);
          if (!m || plain(m[3]) !== wanted) return line;
          found = true;
          return `${m[1]}x${m[2]}${m[3].trimEnd()}${note ? ` (brain: ${note.replace(/[()]/g, '')})` : ''}`;
        })
        .join('\n');
    },
    `Slib splněn: ${wanted.slice(0, 60)} (${by})`,
  );
}

/** Take a tick back, the note the brain left goes with it. */
export async function reopenPromise(slug, text, { by = 'app' } = {}) {
  const wanted = plain(text);
  await edit(
    slug,
    '_action-items.md',
    (content) => {
      let found = false;
      return content
        .split('\n')
        .map((line) => {
          const m = !found && line.match(/^(\s*[-*]\s*\[)[xX](\]\s*)(.+)$/);
          if (!m || plain(stripNote(m[3])) !== wanted) return line;
          found = true;
          return `${m[1]} ${m[2]}${stripNote(m[3]).trimEnd()}`;
        })
        .join('\n');
    },
    `Slib znovu otevřen: ${wanted.slice(0, 60)} (${by})`,
  );
}

/**
 * `uzavrit` closes a risk, `trva` says it was looked at and still holds, which
 * restarts the clock of the "no movement" signal.
 */
export async function moveFlag(slug, title, action, { today, by = 'app' }) {
  const stav = action === 'uzavrit' ? `vyřešeno ${today}` : `trvá, potvrzeno ${today}`;
  await edit(
    slug,
    'flags.md',
    (content) => {
      const lines = content.split('\n');
      const start = lines.findIndex((l) => /^##\s/.test(l) && l.replace(/^##\s+/, '').replace(/^[^\p{L}\d]+/u, '').trim() === title);
      if (start < 0) return content;
      let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
      if (end < 0) end = lines.length;
      const at = lines.slice(start, end).findIndex((l) => /^\*\*Stav:\*\*/.test(l));
      if (at >= 0) {
        lines[start + at] = `**Stav:** ${stav}`;
      } else {
        let last = end - 1;
        while (last > start && !lines[last].trim()) last -= 1;
        lines.splice(last + 1, 0, '', `**Stav:** ${stav}`);
      }
      return lines.join('\n');
    },
    `Vlajka ${title.slice(0, 50)}: ${action} (${by})`,
  );
}
