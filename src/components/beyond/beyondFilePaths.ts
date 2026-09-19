/**
 * Beyond Brain — turn file paths in chat prose into openable links.
 *
 * The agent frequently writes a file and then names it ("hotovo, draft je v
 * workspace/drafty/foo.md" or "tady je obrázek: /tmp/graf.png"). This module
 * lets those paths become clickable: a remark plugin rewrites bare paths inside
 * assistant markdown into links with a `beyondfile:` scheme, and BeyondChat's
 * `a` renderer intercepts that scheme to pop the existing file-preview sheet
 * (via the `beyond:open-file` event) instead of navigating.
 *
 * Only `text` nodes are rewritten, so paths already inside code spans, code
 * fences, or explicit markdown links are left untouched.
 */

import { visit, SKIP } from 'unist-util-visit';

export const BEYOND_FILE_SCHEME = 'beyondfile:';

// A Windows path (`C:\…\name.ext` or `C:/…/name.ext`) or a POSIX-ish absolute
// path (`/…/name.ext`), always ending in a short file extension to keep the
// false-positive rate down. The negative lookbehind stops us biting into URLs
// (`http://…`), emails, or the tail of a longer token.
const SEG = String.raw`[^\s<>"'\`()\[\]]`;
const WIN = String.raw`[A-Za-z]:[\\/](?:${SEG}+[\\/])*${SEG}+\.[A-Za-z0-9]{1,8}`;
const POSIX = String.raw`/(?:${SEG}+/)*${SEG}+\.[A-Za-z0-9]{1,8}`;
// Brain-relative paths (agent cwd = brain repo) — only when they start at a
// known top-level brain dir, so we don't linkify arbitrary `a/b.c` fragments.
const BRAIN_ROOTS = 'clients|knowledge|workspace|moduly|raw|briefy|drafty|reporty|notion';
const BRAIN_REL = String.raw`(?:${BRAIN_ROOTS})[\\/](?:${SEG}+[\\/])*${SEG}+\.[A-Za-z0-9]{1,8}`;
const PATH_RE = new RegExp(String.raw`(?<![\w:./@\\-])(${WIN}|${POSIX}|${BRAIN_REL})`, 'g');
// Same alternatives but anchored — used to test whether an entire inline-code
// span (`…`) is exactly one path, so backtick-wrapped paths become clickable too.
const FULL_PATH_RE = new RegExp(String.raw`^(${WIN}|${POSIX}|${BRAIN_REL})$`);

/** Build the href BeyondChat's `a` renderer recognises. */
export function beyondFileHref(path: string): string {
  return BEYOND_FILE_SCHEME + encodeURIComponent(path);
}

/** Pull the original path back out of a `beyondfile:` href, or null. */
export function parseBeyondFileHref(href: string | undefined): string | null {
  if (!href || !href.startsWith(BEYOND_FILE_SCHEME)) return null;
  try {
    return decodeURIComponent(href.slice(BEYOND_FILE_SCHEME.length));
  } catch {
    return href.slice(BEYOND_FILE_SCHEME.length);
  }
}

/** remark plugin: rewrite bare file paths in text nodes into `beyondfile:` links. */
export function remarkBeyondFilePaths() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree, 'text', (node: any, index: number | undefined, parent: any) => {
      if (!parent || index == null) return;
      // Leave paths that are already a link's text alone.
      if (parent.type === 'link') return;
      const value: string = node.value ?? '';
      PATH_RE.lastIndex = 0;
      if (!PATH_RE.test(value)) return;

      PATH_RE.lastIndex = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const children: any[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = PATH_RE.exec(value)) !== null) {
        const raw = m[1];
        const start = m.index + m[0].indexOf(raw);
        if (start > last) children.push({ type: 'text', value: value.slice(last, start) });
        children.push({
          type: 'link',
          url: beyondFileHref(raw),
          children: [{ type: 'text', value: raw }],
        });
        last = start + raw.length;
      }
      if (last < value.length) children.push({ type: 'text', value: value.slice(last) });
      if (children.length === 0) return;
      parent.children.splice(index, 1, ...children);
      return [SKIP, index + children.length];
    });

    // The agent almost always wraps a path in backticks ("vytvořil jsem
    // `clients/.../cally.md`"). Those become `inlineCode` nodes, which the text
    // pass above skips — so handle them here: if the whole span is one path,
    // swap it for a clickable link (the `a` renderer already styles it mono).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree, 'inlineCode', (node: any, index: number | undefined, parent: any) => {
      if (!parent || index == null) return;
      if (parent.type === 'link') return; // already linked
      const value: string = (node.value ?? '').trim();
      const m = FULL_PATH_RE.exec(value);
      if (!m) return;
      const raw = m[1];
      parent.children.splice(index, 1, {
        type: 'link',
        url: beyondFileHref(raw),
        children: [{ type: 'text', value: raw }],
      });
      return [SKIP, index + 1];
    });
  };
}

export type FileKind = 'image' | 'pdf' | 'video' | 'audio' | 'markdown' | 'text' | 'download';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg)$/i;
const MARKDOWN_EXT = /\.(md|mdx|markdown)$/i;
// Archives, office docs, fonts and other clearly-binary payloads that can't be
// previewed as text — the viewer streams them as a blob and offers a download.
// (Unknown extensions still fall through to 'text' so code files keep rendering.)
const DOWNLOAD_EXT =
  /\.(zip|rar|7z|gz|bz2|xz|tar|tgz|tbz|dmg|iso|exe|msi|apk|deb|rpm|bin|jar|xlsx?|docx?|pptx?|odt|ods|odp|rtf|epub|mobi|ttf|otf|woff2?|eot|psd|ai|sketch|fig|db|sqlite|parquet|wasm)$/i;

/** Classify a path by extension so the viewer can pick how to render it. */
export function classifyFile(path: string): FileKind {
  if (IMAGE_EXT.test(path)) return 'image';
  if (/\.pdf$/i.test(path)) return 'pdf';
  if (VIDEO_EXT.test(path)) return 'video';
  if (AUDIO_EXT.test(path)) return 'audio';
  if (MARKDOWN_EXT.test(path)) return 'markdown';
  if (DOWNLOAD_EXT.test(path)) return 'download';
  return 'text';
}

/** Basename that understands both `/` and `\` separators. */
export function fileBasename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Directory portion (everything before the last separator), or ''. */
export function fileDirname(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx > 0 ? path.slice(0, idx) : '';
}
