import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Beyond Brain — cycling "thinking" status line (transitions.dev thinking-states).
 *
 * The line shimmers while a state holds (masked highlight on ::before via
 * `data-text`), then swaps to the next: the old line exits up through a small
 * blur while the new one rises in from below — both at once. A hidden sizer
 * holds the box at the widest state so it never resizes mid-swap. Tokens
 * (`--think-*`) live in beyond-glass.css.
 */

const DEFAULT_STATES = ['Přemýšlím', 'Čtu kontext', 'Hledám souvislosti', 'Skládám odpověď'];

export default function BeyondThinkingStates({
  states = DEFAULT_STATES,
  holdMs = 2000,
}: {
  states?: string[];
  holdMs?: number;
}) {
  const [i, setI] = useState(0);
  const longest = useMemo(
    () => states.reduce((a, b) => (b.length > a.length ? b : a), ''),
    [states],
  );

  useEffect(() => {
    if (states.length <= 1) return;
    const t = setInterval(() => setI((v) => (v + 1) % states.length), holdMs);
    return () => clearInterval(t);
  }, [states.length, holdMs]);

  const label = `${states[i]}…`;

  return (
    <span className="bb-think2" role="status" aria-label={states[i]}>
      <span className="bb-think2-sizer" aria-hidden="true">{`${longest}…`}</span>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={i}
          className="bb-think2-text"
          data-text={label}
          initial={{ y: 8, filter: 'blur(2px)', opacity: 0 }}
          animate={{ y: 0, filter: 'blur(0px)', opacity: 1 }}
          exit={{ y: -8, filter: 'blur(2px)', opacity: 0 }}
          transition={{ duration: 0.15, ease: 'easeInOut' }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
