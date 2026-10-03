import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, ArrowUpRight, FileText, Download, Copy, Check, PanelRight } from './icons';
import { authenticatedFetch } from '../../utils/api';
import { copyTextToClipboard } from '../../utils/clipboard';
import { classifyFile, fileBasename, fileDirname, type FileKind } from './beyondFilePaths';
import { Spinner, Tip } from './ui';
import FileEditor from './editor/FileEditor';

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
  const [wide, setWide] = useState(false);
  const [savedMtime, setSavedMtime] = useState<string | null>(null);

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
      className="bb-sheetscrim"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.28, ease: [0.21, 1.02, 0.73, 1] }}
        className="bb-scope bb-sheet bb-fsheet"
        data-wide={wide ? 'true' : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="bb-fsheet__head">
          <FileText className="h-[16px] w-[16px] flex-shrink-0 text-beyond-faint" strokeWidth={1.8} />
          <div className="bb-fsheet__title">
            <p className="bb-fsheet__name">{fileName}</p>
            {folder && <p className="bb-fsheet__dir">{folder}</p>}
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
          <Tip label={wide ? 'Zpět na panel' : 'Na celou obrazovku'}>
            <button
              type="button"
              onClick={() => setWide((v) => !v)}
              aria-label={wide ? 'Zpět na panel' : 'Na celou obrazovku'}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-beyond-ink/[0.04] hover:text-beyond-dim"
            >
              <ExpandIcon wide={wide} />
            </button>
          </Tip>
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
        <div className="bb-fsheet__body">
          {loading && (
            <div className="flex h-full items-center justify-center text-beyond-faint">
              <Spinner />
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

          {/* Markdown and plain text: read it, or write in it. */}
          {payload && !payload.binary && (kind === 'markdown' || kind === 'text') && (
            <FileEditor
              key={filePath}
              path={filePath}
              payload={payload}
              kind={kind}
              onOpenPath={(p) => window.dispatchEvent(new CustomEvent('beyond:open-file', { detail: { path: p } }))}
              onSaved={(m) => setSavedMtime(m || null)}
            />
          )}
        </div>

        {/* Footer — meta */}
        {(sizeBytes != null || payload?.mtime) && (
          <footer className="bb-fsheet__foot">
            <span>{sizeBytes != null ? `${Math.round(sizeBytes / 1024) || 1} kB` : ''}</span>
            {(savedMtime || payload?.mtime) && (
              <span title={savedMtime || payload?.mtime}>
                Upraveno{' '}
                {new Date((savedMtime || payload?.mtime) as string).toLocaleString('cs-CZ', {
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

function ExpandIcon({ wide }: { wide: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {wide ? (
        <>
          <path d="M9 4v3a2 2 0 0 1-2 2H4" />
          <path d="M20 9h-3a2 2 0 0 1-2-2V4" />
          <path d="M4 15h3a2 2 0 0 1 2 2v3" />
          <path d="M15 20v-3a2 2 0 0 1 2-2h3" />
        </>
      ) : (
        <>
          <path d="M4 9V6a2 2 0 0 1 2-2h3" />
          <path d="M15 4h3a2 2 0 0 1 2 2v3" />
          <path d="M20 15v3a2 2 0 0 1-2 2h-3" />
          <path d="M9 20H6a2 2 0 0 1-2-2v-3" />
        </>
      )}
    </svg>
  );
}

/** Human-readable byte size (kB / MB). */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024) || 1} kB`;
}
