import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from '../icons';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { remarkBeyondFilePaths, parseBeyondFileHref, BEYOND_FILE_SCHEME } from '../beyondFilePaths';
import BeyondCodeBlock from '../BeyondCodeBlock';
import StoryViewer from '../velin/StoryViewer';
import { describeTool, formatInput } from './toolDisplay';
import { useSmoothText } from './useSmoothText';
import type { ChatMessage, ToolStep } from './types';

/**
 * Beyond Brain chat — one row of the transcript.
 *
 * Three shapes: a user bubble, a collapsed list of tool steps, or assistant
 * prose rendered as markdown. Prose that is still arriving is revealed at a
 * steady pace and fades out at its newest lines. Rows do not animate on mount:
 * a chat coming back must look like it never left.
 */

export default function MessageBlock({
  message,
  streaming = false,
}: {
  message: ChatMessage;
  streaming?: boolean;
}) {
  if (message.role === 'user') {
    return (
      <div className="bb-user">
        <div className="bb-user__col">
          <div className="bb-bubble min-w-0">
            <p className="whitespace-pre-line break-words">{message.text}</p>
          </div>
        </div>
      </div>
    );
  }

  if (message.kind === 'steps') {
    return <StepList steps={message.steps} />;
  }

  return <AssistantText message={message} streaming={streaming} />;
}

const IMAGE_RE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** Every picture in a message, in order: the slides the viewer steps through. */
function imagesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(IMAGE_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

function AssistantText({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  const full = 'text' in message ? message.text : '';
  const smooth = useSmoothText(full, streaming);
  const text = smooth.text;
  const [viewAt, setViewAt] = useState<number | null>(null);
  const images = imagesIn(text);

  return (
    <div
      className="beyond-prose flex gap-2.5 min-w-0 break-words text-[15px] leading-relaxed text-beyond-ink [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li]:pl-1 [&_li>ul]:my-1 [&_li>ol]:my-1 [&_strong]:font-semibold [&_em]:italic [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-[18px] [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h4]:mb-1 [&_h4]:mt-3 [&_h4]:text-[14px] [&_h4]:font-semibold [&_hr]:my-4 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-beyond-ink/10 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-beyond-ink/15 [&_blockquote]:pl-3 [&_blockquote]:text-beyond-dim [&_thead]:bg-beyond-ink/[0.025] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[12.5px] [&_th]:font-semibold [&_th]:text-beyond-dim [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:border-t [&_td]:border-beyond-ink/[0.06] [&_td]:text-[14px]"
    >
      <div className={`bb-answer min-w-0 flex-1${smooth.revealing ? ' is-live' : ''}`}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBeyondFilePaths]}
            // react-markdown sanitises hrefs to a safe-protocol allowlist, which
            // strips our custom `beyondfile:` scheme (→ empty href → navigates to
            // the app root). Preserve our scheme; delegate everything else to the
            // default sanitiser.
            urlTransform={(url) =>
              url.startsWith(BEYOND_FILE_SCHEME) ? url : defaultUrlTransform(url)
            }
            components={{
              a: ({ href, children, ...rest }) => {
                const filePath = parseBeyondFileHref(href);
                if (filePath) {
                  // A bare file path the agent mentioned — open the preview sheet
                  // instead of navigating away.
                  return (
                    <button
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent('beyond:open-file', { detail: { path: filePath } }),
                        )
                      }
                      title={`Otevřít ${filePath}`}
                      className="bb-fileref inline rounded px-1 py-0.5 font-mono text-[0.85em] underline underline-offset-2 transition-colors"
                    >
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
              // Pictures the agent made (rendered stories) sit in the chat at a
              // story's proportions and open in the story viewer, all slides of
              // the message in a row, instead of a bare image in a new tab.
              img: ({ src, alt }) => {
                const url = typeof src === 'string' ? src : '';
                return (
                  <button
                    type="button"
                    className="bb-md__img"
                    onClick={() => setViewAt(Math.max(0, images.indexOf(url)))}
                    aria-label={alt ? `Otevřít ${alt}` : 'Otevřít náhled'}
                  >
                    <img src={url || undefined} alt={alt || ''} loading="lazy" />
                  </button>
                );
              },
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
              // GFM tables — wrap in a rounded, horizontally-scrollable card so wide
              // tables never blow out the chat column.
              table: ({ children }) => (
                <div className="my-3 overflow-x-auto rounded-[12px] border border-beyond-ink/[0.07]">
                  <table className="w-full border-collapse text-left">{children}</table>
                </div>
              ),
            }}
          >
            {text}
          </ReactMarkdown>
      </div>
      {viewAt !== null && images.length > 0 && (
        // The answer carries a mask, which would clip a fixed overlay inside it.
        createPortal(<StoryViewer images={images} startAt={viewAt} onClose={() => setViewAt(null)} />, document.body)
      )}
    </div>
  );
}

/** What the agent did, folded into one quiet line. It opens on demand. */
function StepList({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false);
  const failed = steps.some((s) => s.status === 'error');
  const n = steps.length;
  const noun = n === 1 ? 'krok' : n < 5 ? 'kroky' : 'kroků';
  return (
    <div className="bb-steps">
      <button type="button" className="bb-steps__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>
          {n} {noun}
          {failed ? ', něco selhalo' : ''}
        </span>
        <ChevronRight size={14} className="bb-call__chev" data-open={open ? '' : undefined} />
      </button>
      {open && (
        <div className="bb-calls">
          {steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: ToolStep }) {
  const [expanded, setExpanded] = useState(false);
  const { label, detail } = describeTool(step.name, step.input);
  const expandable = Boolean(step.output) || Boolean(step.input);

  return (
    <div className="bb-call">
      <button
        type="button"
        onClick={() => expandable && setExpanded((v) => !v)}
        aria-expanded={expandable ? expanded : undefined}
        className="bb-call__head"
        data-expandable={expandable ? '' : undefined}
        title={detail || label}
      >
        <span className="bb-step" data-error={step.isError ? '' : undefined}>
          <span className="bb-step__name">{label}</span>
          {detail ? <span className="bb-step__detail">{detail}</span> : null}
        </span>
        {expandable && <ChevronRight size={14} className="bb-call__chev" data-open={expanded ? '' : undefined} />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && expandable && (
          <motion.div
            key="expand"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2">
              {step.input != null && <PreBlock label="Vstup" content={formatInput(step.input)} />}
              {step.output && (
                <PreBlock
                  label={step.isError ? 'Chyba' : 'Výstup'}
                  content={step.output}
                  tone={step.isError ? 'error' : 'default'}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PreBlock({
  label,
  content,
  tone = 'default',
}: {
  label: string;
  content: string;
  tone?: 'default' | 'error';
}) {
  return (
    <div>
      <p className="mb-1 text-[12px] text-beyond-faint">{label}</p>
      <pre
        className={`max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] px-3 py-2 font-mono text-[12px] leading-relaxed ${tone === 'error' ? 'bb-pre--error' : 'bb-pre'}`}
      >
        {content}
      </pre>
    </div>
  );
}
