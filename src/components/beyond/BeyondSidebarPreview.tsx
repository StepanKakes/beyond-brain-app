import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search, Plus, Check, MessagesSquare, Trash2, Home, Plug,
  PanelLeftClose, Settings, Sun, Moon,
} from 'lucide-react';
import { initialsFor } from './BeyondGlyph';
import BeyondBrainMark from './BeyondBrainMark';
import { useBeyondClients, type BeyondClient } from './useBeyondClients';
import BeyondRepoStatus from './BeyondRepoStatus';
import BeyondFileTree from './BeyondFileTree';
import { useBeyondSessions, type BeyondSession } from './useBeyondSessions';
import { persistSessionIndex, UNIVERSAL_SLUG } from './beyondSessionsApi';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Beyond Brain — v3 Sidebar (Liquid Glass).
 *
 * Head (brand + collapse) · repo status · new chat · search · scrolling body
 * (Domů, universal history, clients + their sessions, file tree) · pinned foot
 * (Konektory, user, theme, settings). Everything reads the --bb-* glass tokens.
 */

type Client = { slug: string; name: string; week: string; selected?: boolean };

const FALLBACK_CLIENTS: Client[] = [
  { slug: 'ivana-jurikova', name: 'Ivana Juříková', week: 'W18', selected: true },
  { slug: 'jakub-bolek', name: 'Jakub Bolek', week: 'W04' },
  { slug: 'jakub-privara', name: 'Jakub Přívara', week: 'W12' },
  { slug: 'lukas-rusek', name: 'Lukáš Rusek', week: 'W09' },
  { slug: 'patrik-kruntorad', name: 'Patrik Kruntorad', week: 'W22' },
  { slug: 'pavel-sedlacek', name: 'Pavel Sedláček', week: 'W07' },
];

type Props = {
  selectedSlug?: string | null;
  onSelectClient?: (slug: string) => void;
  onOpenSettings?: () => void;
  onGoHome?: () => void;
  onOpenUniversalChat?: () => void;
  onSwitchUniversalSession?: (uuid: string) => void;
  /** Collapse the sidebar (rendered as a button in the head). */
  onCollapse?: () => void;
};

export default function BeyondSidebarPreview({
  selectedSlug,
  onSelectClient,
  onOpenSettings,
  onGoHome,
  onOpenUniversalChat,
  onSwitchUniversalSession,
  onCollapse,
}: Props) {
  const { clients: apiClients, refresh: refreshClients } = useBeyondClients();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const [query, setQuery] = useState('');
  const [treeKey, setTreeKey] = useState(0);

  const handleSynced = () => {
    setTreeKey((k) => k + 1);
    refreshClients?.();
  };

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

  const openSettings = () => {
    onOpenSettings?.();
    window.dispatchEvent(new CustomEvent('beyond:open-settings'));
  };

  return (
    <div className="flex h-full w-full flex-col">
      {/* Head — brand + collapse */}
      <div className="bb-side__head">
        <div className="flex min-w-0 items-center gap-2">
          <BeyondBrainMark size={38} side={0.76} animate="in" title="Beyond Brain" className="shrink-0" />
          <div className="bb-brand">Beyond&nbsp;<em>Brain</em></div>
        </div>
        {onCollapse && (
          <button type="button" className="bb-ib" onClick={onCollapse} aria-label="Skrýt panel">
            <PanelLeftClose size={18} strokeWidth={1.8} />
          </button>
        )}
      </div>

      {/* Repo status card */}
      <div className="px-3">
        <BeyondRepoStatus onSynced={handleSynced} />
      </div>

      {/* New chat + search */}
      <div className="flex flex-col gap-2 px-3 pb-1 pt-2">
        {onOpenUniversalChat && (
          <button type="button" className="bb-newchat" onClick={onOpenUniversalChat}>
            <Plus size={16} strokeWidth={2} />
            <span>Nový chat</span>
          </button>
        )}
        <div className="bb-search">
          <Search size={15} strokeWidth={1.8} className="flex-none" style={{ color: 'var(--bb-ink3)' }} aria-hidden />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat"
          />
        </div>
      </div>

      {/* Body — scrolling */}
      <nav className="bb-side__body">
        {onGoHome && (
          <button
            type="button"
            className="bb-row"
            aria-current={!selectedSlug ? 'true' : undefined}
            onClick={onGoHome}
          >
            <span className="bb-avatar" style={{ background: 'transparent', boxShadow: 'none' }}>
              <Home size={15} strokeWidth={1.8} style={{ color: 'var(--bb-ink2)' }} />
            </span>
            <span className="bb-row__label">Domů</span>
          </button>
        )}

        {onOpenUniversalChat && <UniversalSessions onSwitch={onSwitchUniversalSession} />}

        <div className="bb-group__label">Klienti</div>
        <ul className="flex flex-col gap-0.5">
          {filtered.map((c) => (
            <li key={c.slug}>
              <button
                type="button"
                className="bb-row"
                aria-current={c.selected ? 'true' : undefined}
                onClick={() => onSelectClient?.(c.slug)}
              >
                <span className="bb-avatar">{initialsFor(c.name)}</span>
                <span className="bb-row__label">{c.name}</span>
                {c.week && <span className="bb-row__meta">{c.week}</span>}
              </button>
              {c.selected && <ClientSessions slug={c.slug} />}
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-[13.5px]" style={{ color: 'var(--bb-ink3)' }}>Nic.</li>
          )}
        </ul>

        <BeyondFileTree
          refreshKey={treeKey}
          onFileClick={(filePath) => {
            window.dispatchEvent(new CustomEvent('beyond:open-file', { detail: { path: filePath } }));
          }}
        />
      </nav>

      {/* Foot — pinned */}
      <div className="bb-side__foot">
        <button
          type="button"
          className="bb-row"
          onClick={() => window.dispatchEvent(new CustomEvent('beyond:open-connectors'))}
        >
          <span className="bb-avatar" style={{ background: 'transparent', boxShadow: 'none' }}>
            <Plug size={15} strokeWidth={1.8} style={{ color: 'var(--bb-ink2)' }} />
          </span>
          <span className="bb-row__label">Konektory</span>
        </button>

        <div className="mt-1 flex items-center gap-2 px-1">
          <span className="bb-avatar">Š</span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium" style={{ color: 'var(--bb-ink)' }}>Štěpán</div>
            <div className="truncate text-[11.5px]" style={{ color: 'var(--bb-ink3)' }}>Beyond Brain</div>
          </div>
          <button
            type="button"
            className="bb-ib"
            onClick={toggleDarkMode}
            aria-label={isDarkMode ? 'Světlý režim' : 'Tmavý režim'}
            title={isDarkMode ? 'Světlý režim' : 'Tmavý režim'}
          >
            {isDarkMode ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
          </button>
          <button
            type="button"
            className="bb-ib bb-ib--gear"
            onClick={openSettings}
            aria-label="Nastavení"
            title="Nastavení"
          >
            <Settings size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Inline list of chat sessions for the currently-selected client. */
function ClientSessions({ slug }: { slug: string }) {
  const { sessions, activeUuid } = useBeyondSessions(slug);

  const handleNew = () =>
    window.dispatchEvent(new CustomEvent('beyond:new-session', { detail: { slug } }));
  const handleSwitch = (uuid: string) =>
    window.dispatchEvent(new CustomEvent('beyond:switch-session', { detail: { slug, uuid } }));
  const handleDelete = (s: BeyondSession) => {
    if (!window.confirm(`Smazat chat „${s.title}" z indexu?\n(transkript na disku zůstane.)`)) return;
    window.dispatchEvent(new CustomEvent('beyond:delete-session', { detail: { slug, uuid: s.uuid } }));
  };

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key="sessions"
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden"
      >
        <div className="bb-subrail">
          <button type="button" className="bb-subrow" onClick={handleNew}>
            <Plus size={12} strokeWidth={2} className="flex-none" style={{ color: 'var(--bb-ink3)' }} />
            <span className="bb-subrow__t">Nový chat</span>
          </button>
          {sessions.length === 0 ? (
            <p className="px-2 py-1 text-[11.5px]" style={{ color: 'var(--bb-ink3)' }}>Žádné chaty.</p>
          ) : (
            sessions.map((s) => (
              <SessionRow
                key={s.uuid}
                session={s}
                active={s.uuid === activeUuid}
                onClick={() => handleSwitch(s.uuid)}
                onDelete={() => handleDelete(s)}
              />
            ))
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Inline list of past global ("+ Nový chat") sessions. */
function UniversalSessions({ onSwitch }: { onSwitch?: (uuid: string) => void }) {
  const { sessions, activeUuid } = useBeyondSessions(UNIVERSAL_SLUG);
  if (sessions.length === 0) return null;

  const handleDelete = (s: BeyondSession) => {
    if (!window.confirm(`Smazat chat „${s.title}" z indexu?\n(transkript na disku zůstane.)`)) return;
    const nextSessions = sessions.filter((x) => x.uuid !== s.uuid);
    const nextActive = activeUuid === s.uuid ? null : activeUuid;
    persistSessionIndex(UNIVERSAL_SLUG, { activeUuid: nextActive, sessions: nextSessions }, [s.uuid]);
    window.dispatchEvent(new CustomEvent('beyond:sessions-changed', { detail: { slug: UNIVERSAL_SLUG } }));
  };

  return (
    <div className="bb-subrail">
      {sessions.map((s) => (
        <SessionRow
          key={s.uuid}
          session={s}
          active={s.uuid === activeUuid}
          onClick={() => onSwitch?.(s.uuid)}
          onDelete={() => handleDelete(s)}
        />
      ))}
    </div>
  );
}

function SessionRow({
  session, active, onClick, onDelete,
}: {
  session: BeyondSession;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative flex items-center" aria-current={active ? 'true' : undefined}>
      <button
        type="button"
        className="bb-subrow w-full"
        style={{ paddingRight: 26 }}
        aria-current={active ? 'true' : undefined}
        onClick={onClick}
        title={session.title}
      >
        {active ? (
          <Check size={12} strokeWidth={2.2} className="flex-none" style={{ color: 'var(--bb-ink)' }} />
        ) : (
          <MessagesSquare size={12} strokeWidth={1.8} className="flex-none" style={{ color: 'var(--bb-ink3)' }} />
        )}
        <span className="bb-subrow__t" style={active ? { color: 'var(--bb-ink)', fontWeight: 500 } : undefined}>
          {session.title}
        </span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="Odebrat z indexu"
        className="absolute right-0.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full opacity-0 transition-all group-hover:opacity-100"
        style={{ color: 'var(--bb-ink3)', background: 'var(--bb-panel2)' }}
      >
        <Trash2 size={11} strokeWidth={1.8} />
      </button>
    </div>
  );
}
