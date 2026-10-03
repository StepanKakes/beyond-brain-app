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

export const CommentMarks = Extension.create<{ getComments: () => NoteComment[] }>({
  name: 'commentMarks',
  addOptions() {
    return { getComments: () => [] };
  },
  addProseMirrorPlugins() {
    const get = this.options.getComments;
    return [
      new Plugin({
        key: new PluginKey('bbComments'),
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            for (const c of get()) {
              const r = findQuote(state.doc, c.quote);
              if (r) decos.push(Decoration.inline(r.from, r.to, { class: 'bb-cm', 'data-cid': c.id }));
            }
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

const clip = (q: string) => (q.length > 200 ? `${q.slice(0, 120)} … ${q.slice(-60)}` : q);

/** The prompt for the chat: only the commented places, never the whole note. */
export function commentsPrompt(path: string, comments: NoteComment[]): string {
  const items = comments
    .map((c, i) => `${i + 1}. Místo: „${clip(c.quote.replace(/\s*\n\s*/g, ' '))}"\n   Komentář: ${c.text.trim()}`)
    .join('\n');
  return [
    `Uprav soubor ${path} podle mých komentářů.`,
    'Postup: pro každý komentář najdi citované místo (citace je z vykresleného textu a může se lišit o znaky markdownu, hledej Grepem krátký úsek) a změň ho nástrojem Edit.',
    'Soubor nečti celý, nepřepisuj ho a jinde nic neměň. Když je komentář otázka, odpověz na ni a soubor neměň.',
    'Na konci napiš jednu větu, co jsi změnil, a cestu k souboru.',
    '',
    items,
  ].join('\n');
}
