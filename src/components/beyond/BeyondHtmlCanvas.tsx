import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Download, Copy, Check, Code2, Eye, ExternalLink, RotateCw } from './icons';
import { copyTextToClipboard } from '../../utils/clipboard';
import BeyondCodeBlock from './BeyondCodeBlock';

/**
 * Beyond Brain — HTML canvas.
 *
 * A right-hand slide-in panel that renders HTML the agent produced as a live,
 * visual page inside a sandboxed <iframe> (srcDoc, isolated opaque origin — it
 * can style/script itself but cannot touch the host app). Mounted by BeyondApp
 * when a `beyond:open-html` event fires (dispatched from an HTML/SVG code block
 * in a chat answer). Toggles between the rendered page and its source, and can
 * copy, download, or pop the page out into a new browser tab.
 */

/** A full document already? (has a doctype or an <html> root, or is a raw SVG). */
function isFullDocument(src: string): boolean {
  const s = src.trimStart();
  return /^<!doctype html/i.test(s) || /<html[\s>]/i.test(s);
}

function isSvg(src: string): boolean {
  return /^\s*<svg[\s>]/i.test(src);
}

/** Wrap a bare HTML fragment in a minimal, nicely-typeset document. */
function toDocument(src: string): string {
  if (isFullDocument(src)) return src;
  const body = isSvg(src)
    ? `<div style="min-height:100vh;display:grid;place-items:center;padding:24px">${src}</div>`
    : src;
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; }
  body {
    padding: 24px;
    font-family: "Figtree", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #14161a; background: #ffffff; line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  img, svg, video { max-width: 100%; height: auto; }
</style></head><body>${body}</body></html>`;
}

/** Pull a display title out of the document's <title>, else a sensible default. */
function deriveTitle(src: string, fallback?: string): string {
  const m = /<title[^>]*>([^<]+)<\/title>/i.exec(src);
  if (m && m[1].trim()) return m[1].trim();
  if (fallback && fallback.trim()) return fallback.trim();
  return isSvg(src) ? 'Grafika' : 'Náhled stránky';
}

export default function BeyondHtmlCanvas({
  html,
  title,
  onClose,
}: {
  html: string;
  title?: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const doc = useMemo(() => toDocument(html), [html]);
  const heading = useMemo(() => deriveTitle(html, title), [html, title]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(html);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const downloadName = `${(heading || 'stranka').replace(/[^\w.-]+/g, '-').toLowerCase()}.html`;

  const handleDownload = () => {
    const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleOpenTab = () => {
    const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    // Give the new tab a moment to load before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const iconBtn =
    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-beyond-ink/[0.04] hover:text-beyond-dim';

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
        className="bb-scope bb-sheet flex h-full w-full max-w-[900px] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex flex-shrink-0 items-center gap-2.5 border-b border-beyond-ink/[0.06] px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-beyond-ink">{heading}</p>
            <p className="truncate text-[11px] text-beyond-faint">HTML stránka · živý náhled</p>
          </div>

          {/* Preview / Code segmented control */}
          <div className="flex flex-shrink-0 items-center gap-0.5 rounded-full bg-beyond-ink/[0.04] p-0.5">
            <button
              type="button"
              onClick={() => setTab('preview')}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                tab === 'preview'
                  ? 'bg-white text-beyond-ink shadow-sm'
                  : 'text-beyond-faint hover:text-beyond-dim'
              }`}
            >
              <Eye className="h-[13px] w-[13px]" strokeWidth={1.9} />
              Náhled
            </button>
            <button
              type="button"
              onClick={() => setTab('code')}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                tab === 'code'
                  ? 'bg-white text-beyond-ink shadow-sm'
                  : 'text-beyond-faint hover:text-beyond-dim'
              }`}
            >
              <Code2 className="h-[13px] w-[13px]" strokeWidth={1.9} />
              Kód
            </button>
          </div>

          {tab === 'preview' && (
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              title="Znovu načíst náhled"
              className={iconBtn}
            >
              <RotateCw className="h-[15px] w-[15px]" strokeWidth={1.8} />
            </button>
          )}
          <button type="button" onClick={handleCopy} title={copied ? 'Zkopírováno' : 'Kopírovat HTML'} className={iconBtn}>
            {copied ? (
              <Check className="h-[15px] w-[15px] text-emerald-600" strokeWidth={2} />
            ) : (
              <Copy className="h-[15px] w-[15px]" strokeWidth={1.8} />
            )}
          </button>
          <button type="button" onClick={handleDownload} title="Stáhnout .html" className={iconBtn}>
            <Download className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </button>
          <button type="button" onClick={handleOpenTab} title="Otevřít na nové kartě" className={iconBtn}>
            <ExternalLink className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </button>
          <button type="button" onClick={onClose} aria-label="Zavřít" className={iconBtn}>
            <X className="h-[16px] w-[16px]" strokeWidth={1.8} />
          </button>
        </header>

        {/* Body */}
        <div className="min-h-0 flex-1">
          {tab === 'preview' ? (
            <iframe
              key={reloadKey}
              srcDoc={doc}
              title={heading}
              className="h-full w-full border-0 bg-white"
              // Isolated opaque origin: the page can run its own scripts and open
              // links, but cannot reach the host app's DOM, cookies or storage.
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-pointer-lock"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="h-full overflow-y-auto px-5 py-5">
              <BeyondCodeBlock code={html} className="language-html" filename={downloadName} allowOpenAsPage={false} />
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
