import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, ArrowUpRight, FileText, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { authenticatedFetch } from '../../utils/api';

/**
 * Beyond Brain — file preview sheet.
 *
 * Mounted by BeyondApp when a `beyond:open-file` custom event fires (e.g.
 * from the sidebar file tree). Fetches `/api/beyond/file?path=…`, renders
 * markdown for `.md`, code-style monospace for everything else, and offers
 * an "Insert @path into chat" action that re-uses the existing
 * `beyond:insert-text` event so the agent can act on it.
 */

type FilePayload = {
  path: string;
  content: string;
  size: number;
  binary: boolean;
  encoding: string;
  mtime?: string;
};

const MARKDOWN_EXT = /\.(md|mdx|markdown)$/i;

export default function BeyondFilePreview({
  path: filePath,
  onClose,
}: {
  path: string;
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<FilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);

    authenticatedFetch(`/api/beyond/file?path=${encodeURIComponent(filePath)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
        return data as FilePayload;
      })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || 'Načtení selhalo');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleInsert = () => {
    window.dispatchEvent(
      new CustomEvent('beyond:insert-text', { detail: `@${filePath} ` }),
    );
    onClose();
  };

  const isMarkdown = MARKDOWN_EXT.test(filePath);
  const fileName = filePath.split('/').pop() || filePath;
  const folder = filePath.includes('/')
    ? filePath.slice(0, filePath.lastIndexOf('/'))
    : '';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.28, ease: [0.21, 1.02, 0.73, 1] }}
        className="flex h-full w-full max-w-[680px] flex-col bg-white shadow-[-12px_0_48px_-12px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex flex-shrink-0 items-center gap-2.5 border-b border-black/[0.06] px-5 py-3.5">
          <FileText className="h-[16px] w-[16px] flex-shrink-0 text-beyond-faint" strokeWidth={1.8} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-beyond-ink">{fileName}</p>
            {folder && (
              <p className="truncate text-[11px] text-beyond-faint">{folder}/</p>
            )}
          </div>
          <button
            type="button"
            onClick={handleInsert}
            title="Vložit @cestu do chatu"
            className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-3 py-1.5 text-[12px] font-medium text-beyond-ink transition-colors hover:bg-black/[0.08]"
          >
            Vložit do chatu
            <ArrowUpRight className="h-[12px] w-[12px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zavřít"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-black/[0.04] hover:text-beyond-dim"
          >
            <X className="h-[16px] w-[16px]" strokeWidth={1.8} />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {loading && (
            <div className="flex h-full items-center justify-center text-beyond-faint">
              <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.8} />
            </div>
          )}

          {error && !loading && (
            <p className="text-[13px] text-red-600">⚠ {error}</p>
          )}

          {payload?.binary && (
            <p className="text-[13px] text-beyond-faint">
              Binární soubor ({Math.round(payload.size / 1024)} kB) — náhled není k dispozici.
            </p>
          )}

          {payload && !payload.binary && isMarkdown && (
            <div className="beyond-prose text-[14.5px] leading-relaxed text-beyond-ink [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_strong]:font-semibold [&_em]:italic [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-[20px] [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-[15px] [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-black/10 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-black/10 [&_blockquote]:pl-3 [&_blockquote]:text-beyond-dim [&_table]:my-3 [&_table]:w-full [&_th]:border-b [&_th]:border-black/10 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-[12px] [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-beyond-faint [&_td]:border-b [&_td]:border-black/[0.04] [&_td]:px-2 [&_td]:py-1.5">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ ...rest }) => (
                    <a
                      {...rest}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-beyond-ink underline decoration-black/20 underline-offset-2 hover:decoration-black/50"
                    />
                  ),
                  code: ({ className, children, ...rest }) => {
                    const isBlock = /\n/.test(String(children ?? ''));
                    if (isBlock) {
                      return (
                        <pre className="my-2 overflow-x-auto rounded-[12px] bg-black/[0.04] px-4 py-3 text-[12.5px]">
                          <code className={className} {...rest}>{children}</code>
                        </pre>
                      );
                    }
                    return (
                      <code className="rounded-md bg-black/[0.05] px-1.5 py-0.5 font-mono text-[0.9em] text-beyond-ink">
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {payload.content}
              </ReactMarkdown>
            </div>
          )}

          {payload && !payload.binary && !isMarkdown && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-[12px] bg-black/[0.03] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-beyond-dim">
              {payload.content}
            </pre>
          )}
        </div>

        {/* Footer — meta */}
        {payload && (
          <footer className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-black/[0.06] px-5 py-2 text-[11px] text-beyond-faint">
            <span>{Math.round(payload.size / 1024) || 1} kB</span>
            {payload.mtime && (
              <span title={payload.mtime}>
                Upraveno{' '}
                {new Date(payload.mtime).toLocaleString('cs-CZ', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </footer>
        )}
      </motion.div>
    </motion.div>
  );
}
