import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { getTimeOfDay, type TimeOfDay } from './BeyondBackground';

/** Allow ?bg=morning|day|evening|night to drive both bg and greeting (preview only). */
function getEffectiveTimeOfDay(): TimeOfDay {
  if (typeof window !== 'undefined') {
    const forced = new URLSearchParams(window.location.search).get('bg');
    if (forced === 'morning' || forced === 'day' || forced === 'evening' || forced === 'night') {
      return forced;
    }
  }
  return getTimeOfDay();
}

type SuggestionChip = {
  icon: string;
  label: string;
  prompt: string;
};

type Props = {
  /** First name used in the greeting. Defaults to "Štěpáne" per VISION.md. */
  name?: string;
  /** Optional list of one-click suggestion chips. */
  suggestions?: SuggestionChip[];
  /** Called when a chip is clicked — parent decides how to start a new session. */
  onSuggestionClick?: (suggestion: SuggestionChip) => void;
};

const DEFAULT_SUGGESTIONS: SuggestionChip[] = [
  { icon: '💬', label: 'Co je nového u Ivany?', prompt: 'Co je nového u Ivany Juříkové?' },
  { icon: '📋', label: 'Action items Patrik', prompt: 'Ukaž mi otevřené sliby u Patrika Kruntorada.' },
  { icon: '🌅', label: 'Sync all', prompt: 'Spusť sync všech klientů z Notion.' },
];

function getGreeting(name: string): string {
  const tod = getEffectiveTimeOfDay();
  switch (tod) {
    case 'morning':
      return `Dobré ráno, ${name}.`;
    case 'day':
      return `Dobré odpoledne, ${name}.`;
    case 'evening':
      return `Dobrý večer, ${name}.`;
    case 'night':
      return `Ahoj, ${name}.`;
  }
}

const QUESTION = 'Co dnes řešíme?';

/**
 * Beyond Brain welcome screen.
 * Shown when no client / session is active.
 * Apple-sleek personal assistant feel — Instrument Serif greeting,
 * soft glass chip suggestions, generous whitespace.
 */
export default function BeyondWelcome({
  name = 'Štěpáne',
  suggestions = DEFAULT_SUGGESTIONS,
  onSuggestionClick,
}: Props) {
  const greeting = useMemo(() => getGreeting(name), [name]);

  return (
    <div className="flex h-full w-full items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.21, 1.02, 0.73, 1] }}
        className="mx-auto w-full max-w-2xl text-center"
      >
        <h1 className="text-hero text-[2.5rem] leading-tight text-beyond-primary sm:text-[3rem] md:text-[3.25rem]">
          {greeting}
          <br />
          <span className="italic text-beyond-secondary">{QUESTION}</span>
        </h1>

        {suggestions.length > 0 && (
          <motion.div
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.08, delayChildren: 0.25 } },
            }}
            className="mt-10 flex flex-wrap items-center justify-center gap-2.5"
          >
            {suggestions.map((s) => (
              <motion.button
                key={s.label}
                type="button"
                onClick={() => onSuggestionClick?.(s)}
                className="beyond-chip"
                variants={{
                  hidden: { opacity: 0, y: 8 },
                  show: { opacity: 1, y: 0 },
                }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                whileHover={{ y: -2, scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <span aria-hidden="true">{s.icon}</span>
                <span>{s.label}</span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
