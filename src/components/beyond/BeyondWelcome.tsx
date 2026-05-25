import { useMemo } from 'react';
import { motion } from 'framer-motion';

/**
 * Beyond Brain — v2 Welcome.
 *
 * Hyperminimal. Powder-blue → cream gradient (welcome-only), generous empty
 * space, content centered horizontally but pushed slightly above center
 * (~40% from top). Hero greeting in Instrument Serif italic, two lines:
 *   "Dobré ráno, Štěpáne."
 *   "Co dnes řešíme?"
 * Underneath: three soft-gray pill buttons, text-only, no icons.
 */

type Suggestion = {
  label: string;
  prompt: string;
};

type Props = {
  /** First name in greeting. Defaults to "Štěpáne" per VISION.md. */
  name?: string;
  /** Three pill suggestions. Defaults match VISION.md. */
  suggestions?: Suggestion[];
  /** Called when a pill is clicked — parent starts a new session. */
  onSuggestionClick?: (suggestion: Suggestion) => void;
};

const DEFAULT_SUGGESTIONS: Suggestion[] = [
  { label: 'Co je u Ivany?', prompt: 'Co je nového u Ivany Juříkové?' },
  { label: 'Sliby Patrika',  prompt: 'Ukaž otevřené sliby u Patrika Kruntorada.' },
  { label: 'Sync all',       prompt: 'Spusť sync všech klientů z Notion.' },
];

/** Greeting per VISION.md v2:
 *  5-11  Dobré ráno
 *  11-17 Ahoj
 *  17-22 Dobrý večer
 *  22-5  Tady jsem.
 *
 *  ?bg=morning|day|evening|night overrides for screenshots.
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

const QUESTION = 'Co dnes řešíme?';

export default function BeyondWelcome({
  name = 'Štěpáne',
  suggestions = DEFAULT_SUGGESTIONS,
  onSuggestionClick,
}: Props) {
  const greeting = useMemo(() => getGreeting(name), [name]);

  return (
    <div className="beyond-hero-gradient relative flex h-full min-h-screen w-full flex-col items-center px-6 pb-16 pt-[28vh] sm:pt-[32vh]">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.2, ease: [0.21, 1.02, 0.73, 1] }}
        className="mx-auto w-full max-w-3xl text-center"
      >
        <h1 className="font-hero italic text-[2.5rem] leading-[1.05] text-beyond-ink sm:text-[3.25rem] md:text-[3.5rem]">
          {greeting}
        </h1>
        <p className="font-hero italic mt-2 text-[1.5rem] leading-snug text-beyond-dim sm:text-[2rem]">
          {QUESTION}
        </p>
      </motion.div>

      {suggestions.length > 0 && (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.08, delayChildren: 0.6 } },
          }}
          className="mt-12 flex w-full max-w-2xl flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-3"
        >
          {suggestions.map((s) => (
            <motion.button
              key={s.label}
              type="button"
              onClick={() => onSuggestionClick?.(s)}
              className="beyond-pill"
              variants={{
                hidden: { opacity: 0, y: 8 },
                show: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
            >
              {s.label}
            </motion.button>
          ))}
        </motion.div>
      )}
    </div>
  );
}
