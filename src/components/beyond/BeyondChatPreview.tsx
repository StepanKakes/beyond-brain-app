import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Beyond Brain — v2 Chat surface (hyperminimal).
 *
 * No bubbles, no avatars, no glass. Messages are text blocks on white.
 * AI is dark text, user is muted/lighter and right-indented.
 * Tool calls are extra-subtle italic gray lines inline.
 * Loading = pulsing dot + "Přemýšlím".
 * Composer = bare textarea + a single pill send button.
 */

type SeedMessage = {
  role: 'user' | 'assistant';
  text: string;
  /** Optional tool-call breadcrumb, shown above the assistant text in italic gray. */
  tool?: string;
};

const SEED: SeedMessage[] = [
  {
    role: 'user',
    text: 'Co je dnes nového u Ivany? Sumarizuj poslední call a otevřené sliby.',
  },
  {
    role: 'assistant',
    tool: 'Čtu profil.md a _action-items.md…',
    text:
      'Rychlý přehled za poslední 2 dny:\n\n— Call (úterý): Probrali jste cenotvorbu pro premium klienty.\n— Otevřené sliby: 2 — (1) Připravit ceník verze v3, (2) Naplánovat onboarding na 6/3.\n— Stav: W18, posun stabilní.\n\nChceš, abych připravil draft ceníku?',
  },
  {
    role: 'user',
    text: 'Jo, draft ceníku. A pak commitni do brainu.',
  },
];

const QUICK_ACTIONS = ['Action items', 'Brief', 'Sync'];

export default function BeyondChatPreview() {
  const [thinking] = useState(true);
  const [value, setValue] = useState('');

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {/* Minimal top bar — just context label. No avatar circle, no badges. */}
      <header className="flex flex-shrink-0 items-center px-6 pb-4 pt-5 sm:px-8">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-medium text-beyond-ink">
            Ivana Juříková
          </h2>
          <p className="truncate text-[13px] text-beyond-faint">W18</p>
        </div>
      </header>

      {/* Messages — text-only, generous spacing, optional faint dividers. */}
      <div className="flex-1 overflow-y-auto">
        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
          }}
          className="mx-auto flex w-full max-w-[720px] flex-col px-6 py-10 sm:px-8 sm:py-14"
        >
          {SEED.map((m, i) => (
            <Message key={i} message={m} isFirst={i === 0} />
          ))}

          <AnimatePresence>
            {thinking && (
              <motion.div
                key="thinking"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="mt-6 flex items-center gap-2.5 text-[14px] text-beyond-dim"
              >
                <span className="beyond-dot" aria-hidden="true" />
                <span>Přemýšlím</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Composer — bare textarea, pill send button, optional quick chips. */}
      <div className="flex-shrink-0 border-t border-beyond-line/60 bg-white px-6 pb-8 pt-5 sm:px-8">
        <div className="mx-auto w-full max-w-[720px]">
          <div className="flex items-end gap-3">
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Napiš, co řešíme…"
              rows={1}
              className="min-h-[44px] flex-1 resize-none bg-transparent py-3 text-[16px] leading-snug text-beyond-ink placeholder:text-beyond-faint focus:outline-none"
            />
            <button
              type="button"
              className="beyond-pill flex-shrink-0"
              aria-label="Send"
            >
              Pošli
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {QUICK_ACTIONS.map((label) => (
              <button
                key={label}
                type="button"
                className="rounded-full px-3 py-1.5 text-[13px] text-beyond-dim transition-colors hover:text-beyond-ink"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Message({ message, isFirst }: { message: SeedMessage; isFirst: boolean }) {
  const variants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0 },
  };
  const transition = { duration: 0.45, ease: [0.21, 1.02, 0.73, 1] as const };

  // Subtle horizontal rule above every message except the first.
  const divider = isFirst ? null : (
    <div className="my-8 h-px w-full border-t border-beyond-line" aria-hidden="true" />
  );

  if (message.role === 'user') {
    return (
      <>
        {divider}
        <motion.div
          variants={variants}
          transition={transition}
          className="flex justify-end"
        >
          <p className="max-w-[85%] whitespace-pre-line text-right text-[16px] leading-relaxed text-beyond-dim">
            {message.text}
          </p>
        </motion.div>
      </>
    );
  }

  return (
    <>
      {divider}
      <motion.div variants={variants} transition={transition} className="flex flex-col gap-3">
        {message.tool && (
          <p className="text-[13px] italic text-beyond-faint">{message.tool}</p>
        )}
        <p className="whitespace-pre-line text-[16px] leading-relaxed text-beyond-ink">
          {message.text}
        </p>
      </motion.div>
    </>
  );
}
