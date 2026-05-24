import { ArrowUp, Paperclip, Sparkles } from 'lucide-react';
import BeyondAssistantAvatar from './BeyondAssistantAvatar';

type SeedMessage = {
  role: 'user' | 'assistant';
  text: string;
  tool?: string;
};

const SEED: SeedMessage[] = [
  {
    role: 'user',
    text: 'Co je dnes nového u Ivany? Sumarizuj poslední call a otevřené sliby.',
  },
  {
    role: 'assistant',
    text:
      'Tady je rychlý přehled za poslední 2 dny:\n\n— **Call (úterý):** Probrali jste cenotvorbu pro premium klienty.\n— **Otevřené sliby:** 2 — *(1) Připravit ceník verze v3*, *(2) Naplánovat onboarding na 6/3*.\n— **Stav:** W18, posun stabilní.\n\nChceš, abych připravil draft ceníku?',
    tool: 'Čtu profil.md a _action-items.md...',
  },
  {
    role: 'user',
    text: 'Jo, draft ceníku. A pak commitni do brainu.',
  },
];

export default function BeyondChatPreview() {
  return (
    <div className="flex h-full w-full flex-col">
      {/* Top header (glass) */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-white/30 bg-white/45 px-4 py-3 backdrop-blur-xl backdrop-saturate-150 dark:border-white/5 dark:bg-beyond-ink/45">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-beyond-peach via-beyond-coral to-beyond-plum font-medium text-white shadow-soft">
          IJ
        </div>
        <div className="min-w-0">
          <h2 className="truncate font-serif text-lg leading-tight text-beyond-primary">
            Ivana Juříková
          </h2>
          <p className="truncate text-xs text-beyond-secondary">W18 · 2 otevřené sliby</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="beyond-chip" type="button">
            <Sparkles className="h-3.5 w-3.5" />
            Sync
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          {SEED.map((m, i) => (
            <Message key={i} message={m} />
          ))}

          {/* "Přemýšlím..." status pill */}
          <div className="flex items-center justify-center pt-2">
            <div className="flex items-center gap-2 rounded-full border border-white/40 bg-white/65 px-3.5 py-1.5 shadow-soft backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-beyond-ink/55">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-beyond-coral" />
              <span className="text-xs font-medium text-beyond-primary">Přemýšlím</span>
              <span className="text-xs text-beyond-secondary">…</span>
            </div>
          </div>
        </div>
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 p-4 pb-6">
        <div className="mx-auto w-full max-w-2xl">
          <div className="beyond-card flex items-end gap-2 p-3">
            <button
              type="button"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-beyond-secondary transition hover:bg-white/60 hover:text-beyond-primary dark:hover:bg-white/10"
              aria-label="Attach"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              defaultValue=""
              placeholder="Jak ti můžu pomoct?"
              rows={1}
              className="flex-1 resize-none bg-transparent px-1.5 py-2 text-sm text-beyond-primary placeholder:text-beyond-muted/70 focus:outline-none"
            />
            <button
              type="button"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-beyond-charcoal text-white shadow-soft transition hover:-translate-y-px hover:shadow-glass-sm dark:bg-white dark:text-beyond-charcoal"
              aria-label="Send"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
          {/* Quick action chips below */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button type="button" className="beyond-chip">📋 Action items</button>
            <button type="button" className="beyond-chip">📝 Brief na příští call</button>
            <button type="button" className="beyond-chip">🌅 Sync z Notion</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Message({ message }: { message: SeedMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-3xl rounded-br-lg bg-beyond-charcoal/95 px-4 py-2.5 text-sm leading-relaxed text-white shadow-glass-sm backdrop-blur-md dark:bg-white/95 dark:text-beyond-charcoal">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <BeyondAssistantAvatar />
      <div className="flex max-w-[85%] flex-col gap-2">
        {message.tool && (
          <p className="text-xs italic text-beyond-secondary">
            <span aria-hidden="true">📄</span> {message.tool}
          </p>
        )}
        <div className="beyond-card whitespace-pre-line p-4 text-sm leading-relaxed text-beyond-primary">
          {renderMd(message.text)}
        </div>
      </div>
    </div>
  );
}

/** Tiny markdown subset for the preview only. */
function renderMd(text: string) {
  return text.split('\n').map((line, i) => (
    <span key={i}>
      {line.split(/\*\*([^*]+)\*\*/g).map((part, j) =>
        j % 2 === 1 ? <strong key={j} className="font-semibold">{part}</strong> :
        part.split(/\*([^*]+)\*/g).map((sub, k) =>
          k % 2 === 1 ? <em key={k} className="italic text-beyond-secondary">{sub}</em> : sub,
        ),
      )}
      {'\n'}
    </span>
  ));
}
