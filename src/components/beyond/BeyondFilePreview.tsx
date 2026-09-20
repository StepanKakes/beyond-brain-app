import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, ArrowUpRight, FileText, Loader2, Download, Copy, Check, PanelRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { authenticatedFetch } from '../../utils/api';
import { copyTextToClipboard } from '../../utils/clipboard';
import { classifyFile, fileBasename, fileDirname, type FileKind } from './beyondFilePaths';
import BeyondCodeBlock from './BeyondCodeBlock';

/**
 * Beyond Brain — file preview sheet.
 *
 * Mounted by BeyondApp when a `beyond:open-file` custom event fires (from the
 * sidebar file tree, or from a file path the agent mentioned in chat). Text and
 * markdown are fetched as JSON from `/api/beyond/file`; images, PDFs, video and
 * audio are streamed from `/api/beyond/raw-file` as a blob (so the request
 * still carries the auth header) and rendered inline. Paths may be relative to
 * the brain repo or absolute — the server vets them against its allowed roots.
 */

type FilePayload = {
  path: string;
  content: string;
  size: number;
  binary: boolean;
  encoding: string;
  mtime?: string;
};

export default function BeyondFilePreview({
  path: filePath,
  onClose,
}: {
  path: string;
  onClose: () => void;
}) {
  const kind: FileKind = classifyFile(filePath);
  const isBlobKind =
    kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio' || kind === 'download';

  const [payload, setPayload] = useState<FilePayload | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobSize, setBlobSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Text / markdown → JSON read.
  useEffect(() => {
    if (isBlobKind) return;
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
  }, [filePath, isBlobKind]);

  // Image / PDF / video / audio → blob stream.
  useEffect(() => {
    if (!isBlobKind) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);
    setBlobUrl(null);
    setBlobSize(null);

    authenticatedFetch(`/api/beyond/raw-file?path=${encodeURIComponent(filePath)}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => null);
          throw new Error(data?.error || `HTTP ${r.status}`);
        }
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
        setBlobSize(blob.size);
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
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [filePath, isBlobKind]);

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

  // Text / markdown is copyable & downloadable straight from the loaded JSON
  // content; blob kinds (image/pdf/…) keep their existing <a download> anchor.
  const hasText = Boolean(payload && !payload.binary && (kind === 'markdown' || kind === 'text'));

  // Text files that are actually HTML/SVG can be opened as a live visual page.
  const isRenderableFile = /\.(html?|xhtml|svg)$/i.test(filePath);
  const canOpenAsPage = Boolean(payload && !payload.binary && isRenderableFile);

  const handleOpenAsPage = () => {
    if (!payload) return;
    window.dispatchEvent(
      new CustomEvent('beyond:open-html', { detail: { html: payload.content, title: fileBasename(filePath) } }),
    );
    onClose();
  };

  const handleCopy = async () => {
    if (!payload) return;
    const ok = await copyTextToClipboard(payload.content);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleDownloadText = () => {
    if (!payload || payload.binary) return;
    const blob = new Blob([payload.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Small binaries that came back base64 through the JSON endpoint — decode and
  // hand the bytes to the browser as a download.
  const handleDownloadBinary = () => {
    if (!payload || !payload.binary) return;
    try {
      const bin = atob(payload.content);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* malformed base64 — nothing we can do client-side */
    }
  };

  const fileName = fileBasename(filePath);
  const folder = fileDirname(filePath);
  const sizeBytes = payload?.size ?? blobSize ?? null;

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
        className="bb-scope bb-sheet flex h-full w-full max-w-[680px] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex flex-shrink-0 items-center gap-2.5 border-b border-beyond-ink/[0.06] px-5 py-3.5">
          <FileText className="h-[16px] w-[16px] flex-shrink-0 text-beyond-faint" strokeWidth={1.8} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-beyond-ink">{fileName}</p>
            {folder && (
              <p className="truncate text-[11px] text-beyond-faint">{folder}</p>
            )}
          </div>
          {hasText && (
            <button
              type="button"
              onClick={handleCopy}
              title={copied ? 'Zkopírováno' : 'Kopírovat obsah'}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-beyond-ink/[0.04] hover:text-beyond-dim"
            >
              {copied ? (
                <Check className="h-[15px] w-[15px] text-emerald-600" strokeWidth={2} />
              ) : (
                <Copy className="h-[15px] w-[15px]" strokeWidth={1.8} />
              )}
            </button>
          )}
          {hasText && (
            <button
              type="button"
              onClick={handleDownloadText}
              title="Stáhnout"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-beyond-ink/[0.04] hover:text-beyond-dim"
            >
              <Download className="h-[15px] w-[15px]" strokeWidth={1.8} />
            </button>
          )}
          {blobUrl && (
            <a
              href={blobUrl}
              download={fileName}
              title="Stáhnout"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-beyond-ink/[0.04] hover:text-beyond-dim"
            >
              <Download className="h-[15px] w-[15px]" strokeWidth={1.8} />
            </a>
          )}
          {canOpenAsPage && (
            <button
              type="button"
              onClick={handleOpenAsPage}
              title="Zobrazit jako živou stránku"
              className="inline-flex items-center gap-1 rounded-full bg-beyond-ink/[0.04] px-3 py-1.5 text-[12px] font-medium text-beyond-ink transition-colors hover:bg-beyond-ink/[0.08]"
            >
              <PanelRight className="h-[13px] w-[13px]" strokeWidth={1.9} />
              Jako stránku
            </button>
          )}
          <button
            type="button"
            onClick={handleInsert}
            title="Vložit @cestu do chatu"
            className="inline-flex items-center gap-1 rounded-full bg-beyond-ink/[0.04] px-3 py-1.5 text-[12px] font-medium text-beyond-ink transition-colors hover:bg-beyond-ink/[0.08]"
          >
            Vložit do chatu
            <ArrowUpRight className="h-[12px] w-[12px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zavřít"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-beyond-ink/[0.04] hover:text-beyond-dim"
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

          {/* Image */}
          {!loading && !error && kind === 'image' && blobUrl && (
            <div className="flex justify-center">
              <img
                src={blobUrl}
                alt={fileName}
                className="max-h-full max-w-full rounded-[12px] object-contain shadow-sm"
              />
            </div>
          )}

          {/* PDF */}
          {!loading && !error && kind === 'pdf' && blobUrl && (
            <iframe
              src={blobUrl}
              title={fileName}
              className="h-[calc(100vh-160px)] w-full rounded-[12px] border border-beyond-ink/[0.06]"
            />
          )}

          {/* Video */}
          {!loading && !error && kind === 'video' && blobUrl && (
            <video src={blobUrl} controls className="w-full rounded-[12px]" />
          )}

          {/* Audio */}
          {!loading && !error && kind === 'audio' && blobUrl && (
            <audio src={blobUrl} controls className="w-full" />
          )}

          {/* Archive / binary (zip, docx, …) — nothing to preview, offer download. */}
          {!loading && !error && kind === 'download' && blobUrl && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-beyond-ink/[0.04]">
                <FileText className="h-7 w-7 text-beyond-faint" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-[15px] font-medium text-beyond-ink">{fileName}</p>
                <p className="mt-1 text-[12.5px] text-beyond-faint">
                  Tento soubor nejde zobrazit v náhledu{sizeBytes != null ? ` · ${formatBytes(sizeBytes)}` : ''}.
                </p>
              </div>
              <a
                href={blobUrl}
                download={fileName}
                className="inline-flex items-center gap-2 rounded-full bg-beyond-ink px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
              >
                <Download className="h-[15px] w-[15px]" strokeWidth={2} />
                Stáhnout soubor
              </a>
            </div>
          )}

          {/* Binary that slipped through the JSON path — still downloadable. */}
          {!loading && !error && payload?.binary && !isBlobKind && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-beyond-ink/[0.04]">
                <FileText className="h-7 w-7 text-beyond-faint" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-[15px] font-medium text-beyond-ink">{fileName}</p>
                <p className="mt-1 text-[12.5px] text-beyond-faint">
                  Binární soubor · {formatBytes(payload.size)} — náhled není k dispozici.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadBinary}
                className="inline-flex items-center gap-2 rounded-full bg-beyond-ink px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
              >
                <Download className="h-[15px] w-[15px]" strokeWidth={2} />
                Stáhnout soubor
              </button>
            </div>
          )}

          {/* Markdown */}
          {payload && !payload.binary && kind === 'markdown' && (
            <div className="beyond-prose text-[14.5px] leading-relaxed text-beyond-ink [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_strong]:font-semibold [&_em]:italic [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-[20px] [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-[15px] [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-beyond-ink/10 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-beyond-ink/10 [&_blockquote]:pl-3 [&_blockquote]:text-beyond-dim [&_table]:my-3 [&_table]:w-full [&_th]:border-b [&_th]:border-beyond-ink/10 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-[12px] [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-beyond-faint [&_td]:border-b [&_td]:border-beyond-ink/[0.04] [&_td]:px-2 [&_td]:py-1.5">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ ...rest }) => (
                    <a
                      {...rest}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-beyond-ink underline decoration-beyond-ink/20 underline-offset-2 hover:decoration-beyond-ink/50"
                    />
                  ),
                  code: ({ className, children }) => {
                    const raw = String(children ?? '');
                    const isBlock = /\n/.test(raw);
                    if (isBlock) {
                      return <BeyondCodeBlock code={raw.replace(/\n$/, '')} className={className} />;
                    }
                    return (
                      <code className="bb-inlinecode rounded-md px-1.5 py-0.5 font-mono text-[0.9em]">
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

          {/* Plain text / code */}
          {payload && !payload.binary && kind === 'text' && (
            <pre className="bb-pre overflow-x-auto whitespace-pre-wrap break-words rounded-[12px] px-4 py-3 font-mono text-[12.5px] leading-relaxed">
              {payload.content}
            </pre>
          )}
        </div>

        {/* Footer — meta */}
        {(sizeBytes != null || payload?.mtime) && (
          <footer className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-beyond-ink/[0.06] px-5 py-2 text-[11px] text-beyond-faint">
            <span>{sizeBytes != null ? `${Math.round(sizeBytes / 1024) || 1} kB` : ''}</span>
            {payload?.mtime && (
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

/** Human-readable byte size (kB / MB). */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024) || 1} kB`;
}
