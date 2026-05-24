import { Calendar, CheckCircle2, ChevronRight, Sun } from 'lucide-react';
import { useBeyondClients, type BeyondClient } from './useBeyondClients';

type Props = {
  selectedSlug?: string | null;
  onClientSelect?: (client: BeyondClient) => void;
  onNewChat?: (client: BeyondClient) => void;
};

const SMART_FOLDERS = [
  { icon: Sun, label: 'Dnes', count: null as number | null },
  { icon: Calendar, label: 'Tento týden', count: null as number | null },
  { icon: CheckCircle2, label: 'Otevřené sliby', count: null as number | null },
];

/**
 * Live client list — replaces the auto-detected GitHub repo list as the
 * primary navigation. Pulls from /api/beyond/clients which scans
 * ~/Documents/GitHub/beyond-brain/clients/aktivni/.
 */
export default function BeyondClientsList({ selectedSlug, onClientSelect }: Props) {
  const { clients, exists, loading, brainPath } = useBeyondClients();

  const totalOpenPromises = clients.reduce((acc, c) => acc + (c.openPromises || 0), 0);

  const folders = SMART_FOLDERS.map((f) =>
    f.label === 'Otevřené sliby' ? { ...f, count: totalOpenPromises || null } : f,
  );

  return (
    <div className="flex flex-col">
      {/* Smart folders */}
      <div className="px-2">
        <p className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-beyond-muted">
          Pohledy
        </p>
        <div className="space-y-0.5">
          {folders.map((f) => (
            <button
              key={f.label}
              type="button"
              className="group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-beyond-secondary transition-all hover:-translate-y-px hover:bg-white/55 hover:text-beyond-primary dark:hover:bg-white/10"
            >
              <f.icon className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">{f.label}</span>
              {f.count != null && (
                <span className="text-[11px] text-beyond-muted">{f.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Clients */}
      <div className="mt-1 px-2">
        <p className="px-3 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-beyond-muted">
          Klienti{clients.length ? ` · ${clients.length}` : ''}
        </p>

        {loading && clients.length === 0 ? (
          <div className="space-y-1.5 px-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-11 animate-pulse rounded-xl bg-white/35 dark:bg-white/5"
              />
            ))}
          </div>
        ) : !exists ? (
          <div className="rounded-xl border border-amber-300/50 bg-amber-50/60 p-3 text-xs text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/15 dark:text-amber-200">
            Adresář <code className="font-mono">{brainPath ?? '~/Documents/GitHub/beyond-brain'}</code>{' '}
            nenalezen. Naklonuj beyond-brain repo a refreshni stránku.
          </div>
        ) : clients.length === 0 ? (
          <p className="px-3 py-2 text-xs text-beyond-muted">Žádní aktivní klienti.</p>
        ) : (
          <div className="space-y-0.5">
            {clients.map((c) => (
              <ClientRow
                key={c.slug}
                client={c}
                selected={selectedSlug === c.slug}
                onClick={() => onClientSelect?.(c)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ClientRow({
  client,
  selected,
  onClick,
}: {
  client: BeyondClient;
  selected: boolean;
  onClick: () => void;
}) {
  const subParts: string[] = [];
  if (client.week) subParts.push(client.week);
  if (client.openPromises) subParts.push(`${client.openPromises} ${promiseWord(client.openPromises)}`);
  const sub = subParts.join(' · ') || '—';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all hover:-translate-y-px ${
        selected
          ? 'bg-white/80 shadow-glass-sm dark:bg-white/15'
          : 'hover:bg-white/55 dark:hover:bg-white/10'
      }`}
    >
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-beyond-sky to-beyond-plum/70 text-[11px] font-medium text-white shadow-soft">
        {client.initials}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-beyond-primary">{client.name}</span>
        <span className="truncate text-[11px] text-beyond-muted">{sub}</span>
      </div>
      {client.openPromises ? (
        <span
          title={`${client.openPromises} otevřených slibů`}
          className="flex h-1.5 w-1.5 flex-shrink-0 rounded-full bg-beyond-coral"
        />
      ) : null}
      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-beyond-muted opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function promiseWord(n: number) {
  if (n === 1) return 'otevřený slib';
  if (n >= 2 && n <= 4) return 'otevřené sliby';
  return 'otevřených slibů';
}
