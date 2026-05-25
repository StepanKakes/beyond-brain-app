import { useMemo, useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';

/**
 * Beyond Brain — v2 Welcome (Copilot-style).
 *
 * Hyperminimal. Soft powder-blue → cream gradient (welcome-only).
 * Layout:
 *   - small avatar/glyph at top
 *   - greeting "Dobré ráno, Štěpáne." centered
 *   - chat input centered below greeting — THE focal point
 *   - NO predefined pill suggestions (user types freely)
 */

type Props = {
  /** First name in greeting. Defaults to "Štěpáne". */
  name?: string;
  /** Called when user submits a message — parent opens a new chat session. */
  onSubmit?: (message: string) => void;
};

/** Greeting per VISION.md v2:
 *  5-11  Dobré ráno
 *  11-17 Ahoj
 *  17-22 Dobrý večer
 *  22-5  Tady jsem.
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
  if (hour >= 5 && hour < 11)  return `Dobré ráno, ${name}.`;
  if (hour >= 11 && hour < 17) return `Ahoj, ${name}.`;
  if (hour >= 17 && hour < 22) return `Dobrý večer, ${name}.`;
  return 'Tady jsem.';
}

export default function BeyondWelcome({
  name = 'Štěpáne',
  onSubmit,
}: Props) {
  const greeting = useMemo(() => getGreeting(name), [name]);
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit?.(trimmed);
    setValue('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const canSubmit = value.trim().length > 0;

  return (
    <div className="beyond-hero-gradient relative flex h-full min-h-screen w-full flex-col items-center justify-center px-6 py-16">
      {/* Avatar — placeholder Beyond glyph (soft gradient circle, animated subtle pulse) */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.0, ease: [0.21, 1.02, 0.73, 1] }}
        className="mb-10"
      >
        <motion.div
          className="h-14 w-14 rounded-full"
          style={{
            background: 'radial-gradient(circle at 35% 30%, #d4e3f5 0%, #c1d4e8 45%, #a8bdd4 100%)',
            boxShadow: '0 8px 24px -8px rgba(168, 189, 212, 0.45)',
          }}
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden
        />
      </motion.div>

      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.0, delay: 0.15, ease: [0.21, 1.02, 0.73, 1] }}
        className="mx-auto w-full max-w-3xl text-center"
      >
        <h1 className="font-hero italic text-[2rem] leading-[1.1] text-beyond-ink sm:text-[2.5rem] md:text-[3rem]">
          {greeting}
        </h1>
      </motion.div>

      {/* Chat input — THE focal point */}
      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.0, delay: 0.35, ease: [0.21, 1.02, 0.73, 1] }}
        className="mt-10 w-full max-w-2xl"
      >
        <div className="relative rounded-3xl bg-white/85 shadow-[0_2px_24px_-8px_rgba(0,0,0,0.08)] backdrop-blur-sm ring-1 ring-black/5 transition-shadow focus-within:shadow-[0_4px_32px_-8px_rgba(0,0,0,0.12)] focus-within:ring-black/10">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Napiš, co řešíme…"
            className="block w-full resize-none border-none bg-transparent px-6 py-5 pr-16 text-[16px] leading-relaxed text-beyond-ink placeholder:text-beyond-faint focus:outline-none focus:ring-0"
            style={{ minHeight: '60px', maxHeight: '200px' }}
          />
          <button
            type="submit"
            disabled={!canSubmit}
            aria-label="Pošli"
            className="absolute right-3 bottom-3 flex h-10 w-10 items-center justify-center rounded-full bg-beyond-ink text-white transition-all hover:scale-105 disabled:bg-black/10 disabled:text-black/30 disabled:hover:scale-100"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M8 13V3M8 3L3.5 7.5M8 3L12.5 7.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </motion.form>
    </div>
  );
}
