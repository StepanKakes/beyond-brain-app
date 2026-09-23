import { useMemo, useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowUp, Mic } from './icons';
import { useBeyondSpeech } from './useBeyondSpeech';

/**
 * Beyond Brain — v3 Welcome (Liquid Glass empty state).
 *
 * Editorial hero: a centered greeting in Instrument Serif, one line of sub copy,
 * a glass composer as the focal point, and a grid of suggestion cards that
 * submit their exact text. Deliberately bare — no big logo, no avatar.
 * Rendered inside BeyondShell, so the sidebar/chrome come from the shell.
 */

type Props = {
  /** First name in greeting. Defaults to "Štěpáne". */
  name?: string;
  /** Called when user submits a message — parent opens a new chat session. */
  onSubmit?: (message: string) => void;
  /** Kept for API compatibility; the empty state is itself a fresh chat. */
  onNewChat?: () => void;
};

/** Greeting per VISION.md v2:
 *  5-11  Dobré ráno · 11-17 Ahoj · 17-22 Dobrý večer · 22-5 Tady jsem.
 */
function getGreeting(name: string): string {
  let hour = new Date().getHours();
  if (typeof window !== 'undefined') {
    const forced = new URLSearchParams(window.location.search).get('bg');
    if (forced === 'morning') hour = 8;
    else if (forced === 'day') hour = 14;
    else if (forced === 'evening') hour = 19;
    else if (forced === 'night') hour = 23;
  }
  if (hour >= 5 && hour < 11) return `Dobré ráno, ${name}.`;
  if (hour >= 11 && hour < 17) return `Ahoj, ${name}.`;
  if (hour >= 17 && hour < 22) return `Dobrý večer, ${name}.`;
  return 'Tady jsem.';
}

type Suggestion = { tag: string; text: string; prompt: string };

const SUGGESTIONS: Suggestion[] = [
  {
    tag: 'Přehled',
    text: 'Shrň mi tento týden u mých klientů a na co se zaměřit.',
    prompt: 'Shrň mi tento týden u mých klientů — co je nového a na co se mám zaměřit?',
  },
  {
    tag: 'Příprava',
    text: 'Připrav mě na dnešní call — kontext, úkoly, návrhy.',
    prompt: 'Připrav mě na dnešní call: shrň kontext klienta, otevřené úkoly a navrhni, co probrat.',
  },
  {
    tag: 'Obsah',
    text: 'Naplánuj obsah na příští týden pro vybraného klienta.',
    prompt: 'Pojďme naplánovat obsah na příští týden — nejdřív se zeptej, pro kterého klienta.',
  },
  {
    tag: 'Zápis',
    text: 'Zapiš poznámky z posledního callu jako úkol do Notionu.',
    prompt: 'Zapiš poznámky z posledního callu jako úkol do Notionu — nejdřív se zeptej ke komu patří.',
  },
];

export default function BeyondWelcome({ name = 'Štěpáne', onSubmit }: Props) {
  const greeting = useMemo(() => getGreeting(name), [name]);
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const speech = useBeyondSpeech({ lang: 'cs-CZ', onValue: setValue, getBase: () => valueRef.current });

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    speech.stop();
    onSubmit?.(trimmed);
    setValue('');
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    submit(value);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(value);
    }
  }

  const canSubmit = value.trim().length > 0;

  return (
    <div className="bb-scope flex h-full w-full items-center justify-center overflow-y-auto px-5 py-14">
      <div className="bb-empty" style={{ animation: 'none' }}>
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="bb-empty__h1"
          style={{
            margin: 0,
            fontFamily: 'var(--bb-display)',
            fontWeight: 300,
            fontSize: 'clamp(30px, 5vw, 40px)',
            lineHeight: 1.12,
            letterSpacing: '-0.02em',
            color: 'var(--bb-ink)',
          }}
        >
          {greeting}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          style={{ margin: '14px auto 26px', maxWidth: 460, color: 'var(--bb-ink2)', fontSize: 15, textWrap: 'pretty' } as React.CSSProperties}
        >
          Napiš, co dnes řešíme — nebo si vyber jeden ze startů níž.
        </motion.p>

        {/* Composer — the focal point */}
        <motion.form
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
          style={{ maxWidth: 600, margin: '0 auto 26px' }}
        >
          <div className="bb-composer" data-focus={focused || canSubmit ? 'true' : 'false'}>
            {speech.listening && (
              <div className="bb-mic">
                <div className="bb-mic__bars" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
                  ))}
                </div>
                <span style={{ fontSize: 13.5, color: 'var(--bb-ink2)' }}>Poslouchám… (česky)</span>
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              rows={1}
              placeholder="Napiš, co řešíme…"
            />
            <div className="bb-composer__bar">
              {speech.supported && (
                <button
                  type="button"
                  onClick={speech.toggle}
                  aria-pressed={speech.listening}
                  aria-label="Diktovat"
                  title={speech.listening ? 'Zastavit diktování' : 'Diktovat (česky)'}
                  className="bb-ib bb-ib--tool"
                >
                  <Mic className="h-[18px] w-[18px]" strokeWidth={1.8} />
                </button>
              )}
              <span className="bb-composer__hint">Enter odešle · Shift + Enter nový řádek</span>
              <button
                type="submit"
                disabled={!canSubmit}
                aria-label="Odeslat"
                className="bb-send"
                data-active={canSubmit ? 'true' : 'false'}
              >
                <ArrowUp size={19} strokeWidth={2.1} />
              </button>
            </div>
          </div>
        </motion.form>

        {/* Suggestion grid */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="bb-suggests"
          style={{ maxWidth: 600, margin: '0 auto' }}
        >
          {SUGGESTIONS.map((s) => (
            <button
              key={s.tag}
              type="button"
              className="bb-suggest"
              onClick={() => submit(s.prompt)}
            >
              <div className="bb-suggest__tag">{s.tag}</div>
              <div className="bb-suggest__text">{s.text}</div>
            </button>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
