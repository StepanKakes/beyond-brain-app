import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import BeyondCodeBlock from '../BeyondCodeBlock';
import { dirname } from '../files/api';

/**
 * One rendering of a markdown note, used by the file sheet, the Soubory reader
 * and the editor's live preview, so a note looks the same everywhere. Ticking a
 * checkbox calls `onToggleTask` with the 0-based source line of that item; the
 * owner flips `[ ]` / `[x]` in its text and saves.
 */

const PROSE =
  'beyond-prose bb-doc text-[15px] leading-relaxed text-beyond-ink [&_p]:my-2 [&_p:first-child]:mt-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_strong]:font-semibold [&_em]:italic [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-[22px] [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-4 [&_h3]:text-[15px] [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-beyond-ink/10 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-beyond-ink/10 [&_blockquote]:pl-3 [&_blockquote]:text-beyond-dim [&_table]:my-3 [&_table]:w-full [&_th]:border-b [&_th]:border-beyond-ink/10 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-[12px] [&_th]:text-beyond-faint [&_td]:border-b [&_td]:border-beyond-ink/[0.04] [&_td]:px-2 [&_td]:py-1.5';

function resolveRelative(fromDir: string, target: string): string {
  const parts: string[] = [];
  const base = target.startsWith('/') ? [] : fromDir ? fromDir.split('/') : [];
  for (const seg of [...base, ...target.replace(/^\//, '').split('/')]) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}

export default function MarkdownDoc({
  content,
  path,
  onOpenPath,
  onToggleTask,
}: {
  content: string;
  /** Brain-relative path of the note, to resolve its relative links. */
  path?: string;
  onOpenPath?: (path: string) => void;
  onToggleTask?: (line: number) => void;
}) {
  return (
    <div className={PROSE}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...rest }) => {
            const h = String(href || '');
            const local = h && !/^[a-z][a-z0-9+.-]*:/i.test(h) && !h.startsWith('#');
            if (local && path && onOpenPath) {
              const target = resolveRelative(dirname(path), h.split('#')[0]);
              return (
                <button type="button" className="bb-fx__a" onClick={() => onOpenPath(target)} title={target}>
                  {children}
                </button>
              );
            }
            return (
              <a
                {...rest}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-beyond-ink underline decoration-beyond-ink/20 underline-offset-2 hover:decoration-beyond-ink/50"
              >
                {children}
              </a>
            );
          },
          li: ({ node, className, children, ...rest }) => {
            const isTask = typeof className === 'string' && className.includes('task-list-item');
            const line = node?.position?.start?.line;
            return (
              <li
                {...rest}
                className={className}
                data-task={isTask && onToggleTask ? 'true' : undefined}
                style={isTask ? { listStyle: 'none', marginLeft: -20 } : undefined}
                onClick={
                  isTask && onToggleTask && line
                    ? (e) => {
                        const t = e.target as HTMLElement;
                        if (t.closest('a, button, code')) return;
                        onToggleTask(line - 1);
                      }
                    : undefined
                }
              >
                {children}
              </li>
            );
          },
          input: ({ node: _node, ...rest }) => (
            <input {...rest} disabled={false} readOnly className="bb-doc__check" tabIndex={-1} />
          ),
          code: ({ className, children }) => {
            const raw = String(children ?? '');
            if (/\n/.test(raw)) return <BeyondCodeBlock code={raw.replace(/\n$/, '')} className={className} />;
            return <code className="bb-inlinecode rounded px-1 py-0.5 font-mono text-[0.88em]">{children}</code>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
