import { useState } from 'react';
import { motion } from 'framer-motion';

import type { AskRequest } from './types';

/**
 * AskUserQuestion — the agent's interactive question panel, in Beyond style.
 *
 * Each question takes preset options and a free-text box; picks and custom text
 * are merged into one answer string, mirroring how Claude Code's CLI surfaces
 * an "Other" answer.
 */
export default function AskPanel({
  request,
  onAnswer,
  onSkip,
}: {
  request: AskRequest;
  onAnswer: (answers: Record<string, string>) => void;
  onSkip: () => void;
}) {
  const questions = request.input.questions || [];
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});

  if (questions.length === 0) return null;

  const toggle = (qIdx: number, label: string, multi: boolean) => {
    setSelections((prev) => {
      const current = new Set(prev[qIdx] || []);
      if (multi) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
      }
      return { ...prev, [qIdx]: current };
    });
  };

  const setCustom = (qIdx: number, value: string) => {
    setCustomAnswers((prev) => ({ ...prev, [qIdx]: value }));
  };

  // Submittable when, for every question, the user has either picked an
  // option or typed a custom answer (or both — they're combined on submit).
  const canSubmit = questions.every((_, idx) => {
    const hasPick = (selections[idx]?.size ?? 0) > 0;
    const hasCustom = (customAnswers[idx] || '').trim().length > 0;
    return hasPick || hasCustom;
  });

  const submit = () => {
    const answers: Record<string, string> = {};
    questions.forEach((q, idx) => {
      const picks = Array.from(selections[idx] || []);
      const custom = (customAnswers[idx] || '').trim();
      // Merge picks + custom into a single answer string the agent can read.
      // The custom free-text is the source of truth when present, optionally
      // annotated with which preset options the user also flagged.
      let value = '';
      if (picks.length > 0 && custom) {
        value = `${picks.join(', ')} — ${custom}`;
      } else if (picks.length > 0) {
        value = picks.join(', ');
      } else if (custom) {
        value = custom;
      }
      if (value) answers[q.question] = value;
    });
    onAnswer(answers);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="bb-card overflow-hidden rounded-2xl"
    >
      <div className="bb-vdivide flex flex-col">
        {questions.map((q, qIdx) => {
          const multi = Boolean(q.multiSelect);
          const selected = selections[qIdx] || new Set<string>();
          return (
            <div key={qIdx} className="px-5 py-4">
              <div className="mb-3 flex items-center gap-2">
                {q.header && (
                  <span className="bb-chip rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide">
                    {q.header}
                  </span>
                )}
                {multi && <span className="text-[11px] text-beyond-faint">Více možností</span>}
              </div>
              <p className="mb-3 text-[15px] font-medium leading-snug text-beyond-ink">
                {q.question}
              </p>
              <div className="flex flex-col gap-1.5">
                {q.options.map((opt) => {
                  const isOn = selected.has(opt.label);
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => toggle(qIdx, opt.label, multi)}
                      data-on={isOn ? 'true' : 'false'}
                      className="bb-optcard group flex w-full items-start gap-3 rounded-[14px] px-3.5 py-2.5 text-left"
                    >
                      <span
                        data-on={isOn ? 'true' : 'false'}
                        className="bb-radio mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full transition-colors"
                      >
                        {isOn && <span className="bb-radio__dot h-1.5 w-1.5 rounded-full" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium leading-tight text-beyond-ink">
                          {opt.label}
                        </span>
                        {opt.description && (
                          <span className="mt-0.5 block text-[12px] leading-snug text-beyond-faint">
                            {opt.description}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2.5">
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-beyond-faint">
                  {selected.size > 0 ? 'Doplnit vlastními slovy' : 'Nebo napsat vlastní odpověď'}
                </label>
                <textarea
                  value={customAnswers[qIdx] || ''}
                  onChange={(e) => setCustom(qIdx, e.target.value)}
                  onKeyDown={(e) => {
                    // Cmd/Ctrl+Enter from inside the textarea submits the whole
                    // panel — same shortcut as the main chat composer.
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="Napiš odpověď přesně tak, jak ji chceš…"
                  rows={2}
                  className="bb-field w-full resize-y rounded-[14px] px-3.5 py-2.5 text-[14px] leading-snug"
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2 bb-card__foot px-5 py-3">
        <button
          type="button"
          onClick={onSkip}
          className="rounded-full px-3 py-1.5 text-[12px] bb-btn-ghost transition-colors"
        >
          Přeskočit
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="bb-btn-primary rounded-full px-4 py-1.5 text-[12px] font-medium"
        >
          Odeslat
        </button>
      </div>
    </motion.div>
  );
}
