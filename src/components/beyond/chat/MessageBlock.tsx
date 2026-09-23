import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from '../icons';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { remarkBeyondFilePaths, parseBeyondFileHref, BEYOND_FILE_SCHEME } from '../beyondFilePaths';
import BeyondCodeBlock from '../BeyondCodeBlock';
import BeyondBrainMark from '../BeyondBrainMark';
import StreamingText from '../StreamingText';
import { describeTool, formatInput, iconForTool } from './toolDisplay';
import type { ChatMessage, ToolStep } from './types';

/**
 * Beyond Brain chat — one row of the transcript.
 *
 * Three shapes: a user bubble, a collapsed list of tool steps, or assistant
 * prose rendered as markdown. The prose branch swaps to `StreamingText` while
 * the turn is still arriving so words cross-blur in instead of popping.
 */

const VARIANTS = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
};

// 100ms fade-up per VISION.md — subtle, not flashy.
const TRANSITION = { duration: 0.18, ease: 'easeOut' as const };

export default function MessageBlock({
  message,
  streaming = false,
}: {
  message: ChatMessage;
  streaming?: boolean;
}) {
  if (message.role === 'user') {
    return (
      <motion.div
        initial="hidden"
        animate="show"
        variants={VARIANTS}
        transition={TRANSITION}
        className="bb-user"
      >
        <div className="bb-user__col">
          <div className="bb-bubble min-w-0">
            <p className="whitespace-pre-line break-words">{message.text}</p>
          </div>
        </div>
      </motion.div>
    );
  }

  if (message.kind === 'steps') {
    return (
      <motion.div initial="hidden" animate="show" variants={VARIANTS} transition={TRANSITION}>
        <StepList steps={message.steps} />
      </motion.div>
    );
  }

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={VARIANTS}
      transition={TRANSITION}
      className="beyond-prose flex gap-2.5 min-w-0 break-words text-[15px] leading-relaxed text-beyond-ink [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li]:pl-1 [&_li>ul]:my-1 [&_li>ol]:my-1 [&_strong]:font-semibold [&_em]:italic [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-[18px] [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h4]:mb-1 [&_h4]:mt-3 [&_h4]:text-[14px] [&_h4]:font-semibold [&_hr]:my-4 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-beyond-ink/10 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-beyond-ink/15 [&_blockquote]:pl-3 [&_blockquote]:text-beyond-dim [&_thead]:bg-beyond-ink/[0.025] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[12.5px] [&_th]:font-semibold [&_th]:text-beyond-dim [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:border-t [&_td]:border-beyond-ink/[0.06] [&_td]:text-[14px]"
    >
      <BeyondBrainMark size={42} animate="in" className="mt-[2px] shrink-0 text-beyond-dim" title="Beyond" />
      <div className="min-w-0 flex-1">
        {streaming ? (
          <StreamingText text={message.text} />
        ) : (
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
              // Pictures the agent made (rendered stories) open full size in a
              // new tab; the chat shows them at a story's proportions.
              img: ({ src, alt }) => (
                <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noopener noreferrer" className="bb-md__img">
                  <img src={typeof src === 'string' ? src : undefined} alt={alt || ''} loading="lazy" />
                </a>
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
              // GFM tables — wrap in a rounded, horizontally-scrollable card so wide
              // tables never blow out the chat column.
              table: ({ children }) => (
                <div className="my-3 overflow-x-auto rounded-[12px] border border-beyond-ink/[0.07]">
                  <table className="w-full border-collapse text-left">{children}</table>
                </div>
              ),
            }}
          >
            {message.text}
          </ReactMarkdown>
        )}
      </div>
    </motion.div>
  );
}

function StepList({ steps }: { steps: ToolStep[] }) {
  return (
    <div className="relative flex flex-col gap-2">
      {steps.map((step, idx) => (
        <StepRow key={step.id} step={step} isLast={idx === steps.length - 1} />
      ))}
    </div>
  );
}

function StepRow({ step, isLast }: { step: ToolStep; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { label, detail } = describeTool(step.name, step.input);
  const Icon = iconForTool(step.name);
  const expandable = Boolean(step.output) || Boolean(step.input);

  return (
    <div className="relative flex gap-3">
      {/* Vertical connector — drawn through the icon column. */}
      {!isLast && (
        <span
          aria-hidden
          className="bb-step-line absolute left-[11px] top-7 h-[calc(100%-12px)] w-px"
        />
      )}

      {/* Icon badge */}
      <div className="bb-step-badge relative z-10 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-beyond-dim">
        <Icon className="h-[14px] w-[14px]" strokeWidth={1.8} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <button
          type="button"
          onClick={() => expandable && setExpanded((v) => !v)}
          className={`group flex w-full items-center gap-1.5 text-left text-[14px] ${expandable ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <span className="font-medium text-beyond-ink">{label}</span>
          {detail && <span className="truncate text-beyond-faint">{detail}</span>}
          {step.status === 'running' && <span className="beyond-dot ml-1" aria-hidden />}
          {expandable && (
            <ChevronRight
              className={`ml-auto h-[14px] w-[14px] flex-shrink-0 text-beyond-faint transition-transform ${expanded ? 'rotate-90' : ''}`}
              strokeWidth={1.8}
            />
          )}
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
      <p className="mb-1 text-[11px] uppercase tracking-wide text-beyond-faint">{label}</p>
      <pre
        className={`max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] px-3 py-2 font-mono text-[12px] leading-relaxed ${tone === 'error' ? 'bb-pre--error' : 'bb-pre'}`}
      >
        {content}
      </pre>
    </div>
  );
}
