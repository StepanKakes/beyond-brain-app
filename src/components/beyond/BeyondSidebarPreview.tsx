import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, Settings, Plus, Check, MessagesSquare, Trash2 } from 'lucide-react';
import BeyondGlyph, { initialsFor } from './BeyondGlyph';
import { useBeyondClients, type BeyondClient } from './useBeyondClients';
import BeyondRepoStatus from './BeyondRepoStatus';
import BeyondFileTree from './BeyondFileTree';
import { useBeyondSessions, type BeyondSession } from './useBeyondSessions';

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
  const { clients: apiClients, loading, refresh: refreshClients } = useBeyondClients();
  const [query, setQuery] = useState('');
  const [treeKey, setTreeKey] = useState(0);

  const handleSynced = () => {
    setTreeKey((k) => k + 1);
    refreshClients?.();
  };

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
      {/* Repo status card — green/amber/red dot, sync button, expandable detail */}
      <BeyondRepoStatus onSynced={handleSynced} />

      {/* Search — underline only, leading lucide icon */}
      <div className="flex-shrink-0 px-5 pb-2 pt-4">
        <div className="flex items-center gap-2 border-b border-beyond-line transition-colors focus-within:border-beyond-ink">
          <Search
            className="h-[15px] w-[15px] flex-shrink-0 text-beyond-faint"
            strokeWidth={1.8}
            aria-hidden
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat"
            className="w-full border-0 bg-transparent py-2 text-[15px] text-beyond-ink placeholder:text-beyond-faint focus:outline-none focus:ring-0"
          />
        </div>
      </div>

      {/* Clients + file tree share the scroll area */}
      <nav className="mt-3 flex-1 overflow-y-auto">
        <p className="mb-1 px-5 text-[10px] uppercase tracking-wider text-beyond-faint">
          Klienti
        </p>
        <ul className="flex flex-col gap-0.5 px-3">
          {filtered.map((c) => (
            <li key={c.slug}>
              <ClientRow client={c} onClick={() => onSelectClient?.(c.slug)} />
              {c.selected && (
                <ClientSessions slug={c.slug} />
              )}
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-[14px] text-beyond-faint">Nic.</li>
          )}
        </ul>

        <BeyondFileTree
          refreshKey={treeKey}
          onFileClick={(filePath) => {
            window.dispatchEvent(
              new CustomEvent('beyond:open-file', { detail: { path: filePath } }),
            );
          }}
        />
      </nav>

      {/* Bottom: settings pill with cog icon */}
      <div className="flex-shrink-0 px-4 pb-5 pt-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] text-beyond-faint transition-colors hover:bg-black/[0.04] hover:text-beyond-ink"
          aria-label="Nastavení"
        >
          <Settings className="h-[14px] w-[14px]" strokeWidth={1.8} aria-hidden />
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
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors ${
        client.selected ? 'bg-black/[0.04]' : 'hover:bg-black/[0.025]'
      }`}
      whileHover={{}}
    >
      <BeyondGlyph size={28} initials={initialsFor(client.name)} />
      <span
        className={`min-w-0 flex-1 truncate text-[14px] transition-all ${
          client.selected
            ? 'font-medium text-beyond-ink'
            : 'text-beyond-dim'
        }`}
      >
        {client.name}
      </span>
      {client.week && (
        <span className="flex-shrink-0 text-[11px] text-beyond-faint">{client.week}</span>
      )}
    </motion.button>
  );
}

/** Inline list of chat sessions for the currently-selected client. */
function ClientSessions({ slug }: { slug: string }) {
  const { sessions, activeUuid } = useBeyondSessions(slug);

  const handleNew = () => {
    window.dispatchEvent(new CustomEvent('beyond:new-session', { detail: { slug } }));
  };
  const handleSwitch = (uuid: string) => {
    window.dispatchEvent(new CustomEvent('beyond:switch-session', { detail: { slug, uuid } }));
  };
  const handleDelete = (s: BeyondSession) => {
    if (!window.confirm(`Smazat chat „${s.title}" z indexu?\n(transkript na disku zůstane.)`)) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent('beyond:delete-session', { detail: { slug, uuid: s.uuid } }),
    );
  };

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key="sessions"
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="overflow-hidden"
      >
        <div className="ml-9 mt-1 flex flex-col gap-0.5 border-l border-black/[0.06] pl-2">
          <button
            type="button"
            onClick={handleNew}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-black/[0.04]"
          >
            <Plus className="h-[11px] w-[11px] flex-shrink-0 text-beyond-faint" strokeWidth={2} />
            <span className="text-[12px] text-beyond-dim">Nový chat</span>
          </button>

          {sessions.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-beyond-faint">Žádné chaty.</p>
          ) : (
            sessions.map((s) => {
              const active = s.uuid === activeUuid;
              return (
                <div
                  key={s.uuid}
                  className={`group flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors ${active ? 'bg-black/[0.04]' : 'hover:bg-black/[0.025]'}`}
                >
                  <button
                    type="button"
                    onClick={() => handleSwitch(s.uuid)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    {active ? (
                      <Check className="h-[11px] w-[11px] flex-shrink-0 text-beyond-ink" strokeWidth={2.2} />
                    ) : (
                      <MessagesSquare className="h-[11px] w-[11px] flex-shrink-0 text-beyond-faint" strokeWidth={1.8} />
                    )}
                    <span
                      className={`truncate text-[12px] leading-tight ${active ? 'font-medium text-beyond-ink' : 'text-beyond-dim'}`}
                    >
                      {s.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(s)}
                    title="Odebrat z indexu"
                    className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                  >
                    <Trash2 className="h-[10px] w-[10px]" strokeWidth={1.8} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
