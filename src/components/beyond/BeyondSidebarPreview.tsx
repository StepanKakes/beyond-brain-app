import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useBeyondClients, type BeyondClient } from './useBeyondClients';

/**
 * Beyond Brain — v2 Sidebar (hyperminimal).
 *
 * Hidden by default in the app shell; opened via the toggle button.
 * White surface, single right border, no glass / blur / dots / badges.
 * Just: search → client list → settings cog.
 *
 * Standalone preview: when the /api/beyond/clients call fails (no auth in
 * the preview shell) we fall back to a small static client list so the
 * design remains screenshot-able.
 */

type Client = {
  slug: string;
  name: string;
  week: string;
  selected?: boolean;
};

const FALLBACK_CLIENTS: Client[] = [
  { slug: 'ivana-jurikova',    name: 'Ivana Juříková',    week: 'W18', selected: true },
  { slug: 'jakub-bolek',       name: 'Jakub Bolek',       week: 'W04' },
  { slug: 'jakub-privara',     name: 'Jakub Přívara',     week: 'W12' },
  { slug: 'lukas-rusek',       name: 'Lukáš Rusek',       week: 'W09' },
  { slug: 'patrik-kruntorad',  name: 'Patrik Kruntorad',  week: 'W22' },
  { slug: 'pavel-sedlacek',    name: 'Pavel Sedláček',    week: 'W07' },
];

type Props = {
  /** Currently selected client slug. */
  selectedSlug?: string | null;
  /** Called when user picks a client. Parent typically focuses the chat and collapses sidebar. */
  onSelectClient?: (slug: string) => void;
  /** Called when user clicks the gear icon. */
  onOpenSettings?: () => void;
};

export default function BeyondSidebarPreview({
  selectedSlug,
  onSelectClient,
  onOpenSettings,
}: Props) {
  const { clients: apiClients, loading } = useBeyondClients();
  const [query, setQuery] = useState('');

  // Use API clients when available; fall back to static list in preview / no-auth contexts.
  const clients: Client[] = useMemo(() => {
    const fromApi = (apiClients || []).map((c: BeyondClient) => ({
      slug: c.slug,
      name: c.name,
      week: c.week || '',
      selected: c.slug === selectedSlug,
    }));
    if (fromApi.length > 0) return fromApi;
    return FALLBACK_CLIENTS.map((c) => ({
      ...c,
      selected: selectedSlug ? c.slug === selectedSlug : c.selected,
    }));
  }, [apiClients, selectedSlug]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, query]);

  // Reflect the loading state subtly — never spinner.
  useEffect(() => {
    /* no-op for now; loading is invisible by design (sidebar shows fallback) */
  }, [loading]);

  return (
    <div className="flex h-full w-full flex-col border-r border-beyond-line bg-white">
      {/* Search — underline only, no border box */}
      <div className="flex-shrink-0 px-6 pb-2 pt-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Hledat"
          className="w-full border-0 border-b border-beyond-line bg-transparent py-2 text-[15px] text-beyond-ink placeholder:text-beyond-faint focus:border-beyond-ink focus:outline-none"
        />
      </div>

      {/* Clients — single line per client, name + small W## */}
      <nav className="mt-4 flex-1 overflow-y-auto px-2">
        <ul className="flex flex-col">
          {filtered.map((c) => (
            <li key={c.slug}>
              <ClientRow client={c} onClick={() => onSelectClient?.(c.slug)} />
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-[14px] text-beyond-faint">Nic.</li>
          )}
        </ul>
      </nav>

      {/* Bottom: settings only */}
      <div className="flex-shrink-0 px-4 pb-5 pt-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-full px-3 py-1.5 text-[13px] text-beyond-faint transition-colors hover:text-beyond-ink"
          aria-label="Settings"
        >
          Nastavení
        </button>
      </div>
    </div>
  );
}

function ClientRow({ client, onClick }: { client: Client; onClick?: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      className="flex w-full items-baseline justify-between gap-3 rounded-md px-4 py-2.5 text-left transition-colors"
      whileHover={{}}
    >
      <span
        className={`truncate text-[15px] transition-all ${
          client.selected
            ? 'font-medium text-beyond-ink'
            : 'text-beyond-dim hover:font-medium hover:text-beyond-ink'
        }`}
      >
        {client.name}
      </span>
      {client.week && (
        <span className="flex-shrink-0 text-[12px] text-beyond-faint">{client.week}</span>
      )}
    </motion.button>
  );
}
