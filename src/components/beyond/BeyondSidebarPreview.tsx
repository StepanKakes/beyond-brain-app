import { Calendar, CheckCircle2, ChevronRight, Search, Settings, Sun } from 'lucide-react';
import { motion } from 'framer-motion';

type Client = {
  slug: string;
  initials: string;
  name: string;
  week: string;
  openPromises?: number;
  selected?: boolean;
};

// Mock clients — drawn from ~/Documents/GitHub/beyond-brain/clients/aktivni/
const CLIENTS: Client[] = [
  { slug: 'ivana-jurikova', initials: 'IJ', name: 'Ivana Juříková', week: 'W18', openPromises: 2, selected: true },
  { slug: 'jakub-bolek', initials: 'JB', name: 'Jakub Bolek', week: 'W04', openPromises: 1 },
  { slug: 'jakub-privara', initials: 'JP', name: 'Jakub Přívara', week: 'W12' },
  { slug: 'lukas-rusek', initials: 'LR', name: 'Lukáš Rusek', week: 'W09', openPromises: 3 },
  { slug: 'patrik-kruntorad', initials: 'PK', name: 'Patrik Kruntorad', week: 'W22', openPromises: 1 },
  { slug: 'pavel-sedlacek', initials: 'PS', name: 'Pavel Sedláček', week: 'W07' },
];

const SMART_FOLDERS = [
  { icon: Sun, label: 'Dnes', count: 3 },
  { icon: Calendar, label: 'Tento týden', count: 8 },
  { icon: CheckCircle2, label: 'Otevřené sliby', count: 7 },
];

export default function BeyondSidebarPreview() {
  return (
    <div className="flex h-full flex-col bg-white/55 backdrop-blur-2xl backdrop-saturate-150 dark:bg-beyond-ink/55">
      {/* Header */}
      <div className="flex-shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-beyond-peach via-beyond-coral to-beyond-plum shadow-soft">
            <svg className="h-4 w-4 text-white/95" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
            </svg>
          </div>
          <h1 className="font-serif text-[1.35rem] leading-none text-beyond-primary">Beyond Brain</h1>
        </div>

        {/* Search */}
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-beyond-muted" />
          <input
            type="text"
            placeholder="Hledat (⌘K)"
            className="w-full rounded-xl border border-white/40 bg-white/60 py-2 pl-9 pr-3 text-sm text-beyond-primary placeholder:text-beyond-muted/70 backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-beyond-dusk/30 dark:border-white/10 dark:bg-white/5"
          />
        </div>
      </div>

      {/* Smart folders */}
      <div className="flex-shrink-0 px-2">
        <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-beyond-muted">
          Pohledy
        </p>
        <div className="space-y-0.5">
          {SMART_FOLDERS.map((f) => (
            <button
              key={f.label}
              type="button"
              className="group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-beyond-secondary transition-all hover:-translate-y-px hover:bg-white/55 hover:text-beyond-primary dark:hover:bg-white/10"
            >
              <f.icon className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">{f.label}</span>
              <span className="text-[11px] text-beyond-muted">{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Clients */}
      <div className="mt-1 flex-1 overflow-y-auto px-2">
        <p className="px-3 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-beyond-muted">
          Klienti
        </p>
        <div className="space-y-0.5">
          {CLIENTS.map((c) => (
            <ClientRow key={c.slug} client={c} />
          ))}
        </div>
      </div>

      {/* Bottom: status + settings */}
      <div className="flex-shrink-0 border-t border-white/30 px-3 py-2.5 dark:border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <StatusDot color="bg-green-500" title="n8n: OK" />
            <StatusDot color="bg-green-500" title="git: clean" />
            <StatusDot color="bg-amber-500" title="raw: 14h" />
          </div>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full text-beyond-secondary hover:bg-white/60 hover:text-beyond-primary dark:hover:bg-white/10"
            aria-label="Settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientRow({ client }: { client: Client }) {
  const promisesText = client.openPromises ? ` · ${client.openPromises} otevřených slibů` : '';
  return (
    <motion.button
      type="button"
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2 ${
        client.selected
          ? 'bg-white/80 shadow-glass-sm dark:bg-white/15'
          : 'hover:bg-white/55 dark:hover:bg-white/10'
      }`}
    >
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-beyond-sky to-beyond-plum/70 text-[11px] font-medium text-white shadow-soft">
        {client.initials}
      </div>
      <div className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-sm font-medium text-beyond-primary">{client.name}</span>
        <span className="truncate text-[11px] text-beyond-muted">
          {client.week}{promisesText}
        </span>
      </div>
      {client.openPromises ? (
        <span className="flex h-1.5 w-1.5 flex-shrink-0 rounded-full bg-beyond-coral" aria-hidden="true" />
      ) : null}
      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-beyond-muted opacity-0 transition-opacity group-hover:opacity-100" />
    </motion.button>
  );
}

function StatusDot({ color, title }: { color: string; title: string }) {
  return (
    <span
      title={title}
      className={`inline-block h-2 w-2 rounded-full ${color} ring-1 ring-white/40 dark:ring-white/10`}
    />
  );
}
