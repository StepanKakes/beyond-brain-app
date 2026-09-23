import { useState } from 'react';
import { Check, Copy, Download, PanelRight } from './icons';
import { copyTextToClipboard } from '../../utils/clipboard';

/**
 * Beyond Brain — fenced code block with a hover toolbar (copy + download).
 *
 * Used both for ``` code embeds the agent writes in chat answers and for the
 * code blocks rendered inside the file preview sheet, so they share one look
 * and the same copy/download affordances.
 */

/** Map a markdown ```lang fence to a sensible download extension. */
const LANG_EXT: Record<string, string> = {
  js: 'js', javascript: 'js', jsx: 'jsx',
  ts: 'ts', typescript: 'ts', tsx: 'tsx',
  py: 'py', python: 'py',
  json: 'json', md: 'md', markdown: 'md',
  sh: 'sh', bash: 'sh', shell: 'sh',
  html: 'html', css: 'css', sql: 'sql', yaml: 'yml', yml: 'yml',
};

function filenameFor(className?: string): string {
  const lang = /language-(\w+)/.exec(className || '')?.[1]?.toLowerCase();
  const ext = (lang && LANG_EXT[lang]) || 'txt';
  return `snippet.${ext}`;
}

/**
 * Should this block get an "open as a visual page" affordance? True when the
 * fence is explicitly html/svg, or — when the fence carries no (or an ambiguous
 * markup) language — when the content clearly is a full HTML document or a raw
 * SVG. Deliberately conservative so ordinary code (JSX, XML configs, …) never
 * trips it.
 */
function isRenderableMarkup(code: string, className?: string): boolean {
  const lang = /language-([\w-]+)/.exec(className || '')?.[1]?.toLowerCase();
  if (lang === 'html' || lang === 'htm' || lang === 'xhtml' || lang === 'svg') return true;
  if (lang && lang !== 'markup') return false; // an explicit non-html language → never
  const s = code.trimStart();
  return /^<!doctype html/i.test(s) || /<html[\s>]/i.test(s) || /^<svg[\s>]/i.test(s);
}

export default function BeyondCodeBlock({
  code,
  className,
  filename,
  allowOpenAsPage = true,
}: {
  code: string;
  className?: string;
  /** Overrides the auto-derived download filename (e.g. the real file name in a preview). */
  filename?: string;
  /** Suppress the "open as page" pill (e.g. inside the HTML canvas's own code view). */
  allowOpenAsPage?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || filenameFor(className);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const renderable = allowOpenAsPage && isRenderableMarkup(code, className);

  const handleOpenAsPage = () => {
    window.dispatchEvent(
      new CustomEvent('beyond:open-html', { detail: { html: code } }),
    );
  };

  return (
    <div className="group/code relative my-2">
      {renderable && (
        <button
          type="button"
          onClick={handleOpenAsPage}
          title="Zobrazit jako živou stránku v postranním panelu"
          className="bb-code-fab absolute left-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium"
        >
          <PanelRight className="h-[13px] w-[13px]" strokeWidth={1.9} />
          Otevřít jako stránku
        </button>
      )}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover/code:opacity-100">
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? 'Zkopírováno' : 'Kopírovat'}
          className="bb-code-fab flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
        >
          {copied ? (
            <Check className="h-[14px] w-[14px]" strokeWidth={2} style={{ color: 'var(--bb-ink)' }} />
          ) : (
            <Copy className="h-[14px] w-[14px]" strokeWidth={1.8} />
          )}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          title="Stáhnout"
          className="bb-code-fab flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
        >
          <Download className="h-[14px] w-[14px]" strokeWidth={1.8} />
        </button>
      </div>
      <pre
        className={`bb-codeblock overflow-x-auto rounded-[14px] px-4 pb-3 text-[13px] ${
          renderable ? 'pt-11' : 'pt-3'
        }`}
      >
        <code className={className}>{code}</code>
      </pre>
    </div>
  );
}
