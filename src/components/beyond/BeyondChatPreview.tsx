import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, Paperclip } from 'lucide-react';
import BeyondGlyph from './BeyondGlyph';

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
    <div className="flex h-full w-full flex-col bg-[#fafafa]">
      {/* Floating rounded header card with Beyond glyph avatar */}
      <header className="flex flex-shrink-0 items-center px-4 pb-3 pl-16 pr-4 pt-4 sm:px-6 sm:pl-20 sm:pr-6 sm:pt-5">
        <div className="mx-auto flex w-full max-w-[760px] items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-[0_2px_16px_-8px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04]">
          <BeyondGlyph size={28} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[14px] font-medium leading-tight text-beyond-ink">
              Ivana Juříková
            </h2>
            <p className="truncate text-[12px] leading-tight text-beyond-faint">W18</p>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
          }}
          className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10"
        >
          {SEED.map((m, i) => (
            <Message key={i} message={m} />
          ))}

          <AnimatePresence>
            {thinking && (
              <motion.div
                key="thinking"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="flex items-center gap-2.5 pl-4 text-[14px] text-beyond-dim"
              >
                <span className="beyond-dot" aria-hidden="true" />
                <span>Přemýšlím</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Composer — floating rounded card */}
      <div className="flex-shrink-0 px-4 pb-6 pt-3 sm:px-6 sm:pb-8 sm:pt-4">
        <div className="mx-auto w-full max-w-[760px]">
          <div className="rounded-[24px] bg-white px-4 py-3 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04] focus-within:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.12)] focus-within:ring-black/[0.06]">
            <div className="flex items-end gap-2">
              <button
                type="button"
                tabIndex={-1}
                aria-label="Příloha"
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-black/[0.04] hover:text-beyond-dim"
              >
                <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Napiš, co řešíme…"
                rows={1}
                className="min-h-[40px] flex-1 resize-none border-0 bg-transparent py-2 text-[16px] leading-snug text-beyond-ink placeholder:text-beyond-faint focus:outline-none focus:ring-0"
              />
              <button
                type="button"
                aria-label="Pošli"
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-beyond-ink text-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.25)] transition-all hover:scale-105"
              >
                <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1">
              {QUICK_ACTIONS.map((label) => (
                <button
                  key={label}
                  type="button"
                  className="rounded-full px-3 py-1 text-[12px] text-beyond-faint transition-colors hover:bg-black/[0.04] hover:text-beyond-ink"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Message({ message }: { message: SeedMessage }) {
  const variants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0 },
  };
  const transition = { duration: 0.45, ease: [0.21, 1.02, 0.73, 1] as const };

  if (message.role === 'user') {
    return (
      <motion.div
        variants={variants}
        transition={transition}
        className="flex justify-end"
      >
        <div className="max-w-[85%] rounded-[22px] rounded-br-[6px] bg-white px-4 py-3 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04]">
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-beyond-ink">
            {message.text}
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div variants={variants} transition={transition} className="flex flex-col gap-2 border-l border-black/[0.06] pl-4">
      {message.tool && (
        <p className="text-[13px] italic text-beyond-faint">{message.tool}</p>
      )}
      <p className="whitespace-pre-line text-[15px] leading-relaxed text-beyond-ink">
        {message.text}
      </p>
    </motion.div>
  );
}
