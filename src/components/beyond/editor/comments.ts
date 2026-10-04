import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Comments on a note. A comment is only the text it was made on and what was
 * said about it; where it sits is found again by searching the page for that
 * text, so comments survive reloads and edits elsewhere in the note, and the
 * file itself never carries them. Sent to the chat, they are the whole prompt.
 */

export type NoteComment = { id: string; quote: string; text: string };

/** The page as one string, with the document position of every character. */
function linearize(doc: PMNode): { chars: string; pos: number[] } {
  let chars = '';
  const pos: number[] = [];
  doc.descendants((node, at) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i += 1) { chars += node.text[i]; pos.push(at + i); }
    } else if (node.isBlock && chars && !chars.endsWith('\n')) {
      chars += '\n';
      pos.push(-1);
    }
    return true;
  });
  return { chars, pos };
}

export function findQuote(doc: PMNode, quote: string): { from: number; to: number } | null {
  if (!quote) return null;
  const { chars, pos } = linearize(doc);
  const i = chars.indexOf(quote);
  if (i < 0) return null;
  const a = pos[i];
  const b = pos[i + quote.length - 1];
  if (a < 0 || b < 0) return null;
  return { from: a, to: b + 1 };
}

/** What the agent proposed for one comment: the new text for the commented place. */
export type Revision = { id: string; quote: string; text: string };

type MarkOptions = {
  getComments: () => NoteComment[];
  /** Ids of the comments being worked on right now (the sweep animation). */
  getWorking: () => string[];
  /** Proposed changes waiting for a yes or no. */
  getRevisions: () => Revision[];
};

function revisionWidget(r: Revision): HTMLElement {
  const el = document.createElement('span');
  el.className = 'bb-rev';
  el.contentEditable = 'false';
  const txt = document.createElement('span');
  txt.className = 'bb-rev__new';
  txt.textContent = r.text;
  const acts = document.createElement('span');
  acts.className = 'bb-rev__acts';
  for (const [act, label] of [['ok', 'Přijmout'], ['no', 'Zamítnout']] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.rev = r.id;
    b.dataset.act = act;
    b.className = act === 'ok' ? 'bb-rev__b bb-rev__b--ok' : 'bb-rev__b';
    b.textContent = label;
    b.onmousedown = (e) => e.preventDefault();
    acts.appendChild(b);
  }
  el.append(txt, acts);
  return el;
}

export const CommentMarks = Extension.create<MarkOptions>({
  name: 'commentMarks',
  addOptions() {
    return { getComments: () => [], getWorking: () => [], getRevisions: () => [] };
  },
  addProseMirrorPlugins() {
    const { getComments, getWorking, getRevisions } = this.options;
    return [
      new Plugin({
        key: new PluginKey('bbComments'),
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            const working = getWorking();
            const revs = getRevisions();
            for (const c of getComments()) {
              const r = findQuote(state.doc, c.quote);
              if (!r) continue;
              const rev = revs.find((x) => x.id === c.id);
              const cls = working.includes(c.id) ? 'bb-cm bb-cm--work' : rev ? 'bb-cm bb-cm--old' : 'bb-cm';
              decos.push(Decoration.inline(r.from, r.to, { class: cls, 'data-cid': c.id }));
              if (rev) decos.push(Decoration.widget(r.to, () => revisionWidget(rev), { key: `rev-${rev.id}-${rev.text.length}`, side: 1 }));
            }
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

const clip = (q: string) => (q.length > 200 ? `${q.slice(0, 120)} … ${q.slice(-60)}` : q);

/** The message for the chat: only the commented places. How to act on it is in the brain's CLAUDE.md, not repeated here. */
export function commentsPrompt(path: string, comments: NoteComment[]): string {
  const items = comments
    .map((c, i) => `${i + 1}. Místo: „${clip(c.quote.replace(/\s*\n\s*/g, ' '))}"\n   Komentář: ${c.text.trim()}`)
    .join('\n');
  return `Komentáře k ${path}\n${items}`;
}
