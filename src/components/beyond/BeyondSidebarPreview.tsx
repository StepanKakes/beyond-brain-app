import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search, Plus, Check, MessagesSquare, Trash2, Plug,
  PanelLeftClose, Settings, Sun, Moon,
  Gauge, Users, CalendarDays, MessageSquare, Bot, FolderTree,
} from 'lucide-react';
import { initialsFor } from './BeyondGlyph';
import BeyondBrainMark from './BeyondBrainMark';
import { useBeyondClients, type BeyondClient } from './useBeyondClients';
import BeyondRepoStatus from './BeyondRepoStatus';
import { useBeyondSessions, type BeyondSession } from './useBeyondSessions';
import { persistSessionIndex, UNIVERSAL_SLUG } from './beyondSessionsApi';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Beyond Brain — v3 Sidebar (Liquid Glass).
 *
 * Head (brand + collapse) · repo status · new chat · search · scrolling body
 * (the surfaces, a short list of recent chats, clients + their sessions) ·
 * pinned foot (Konektory, user, theme, settings). Everything reads the --bb-*
 * glass tokens. The chat history shows a handful like ChatGPT does and unfolds
 * on request; the file tree has its own screen (Soubory).
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
  /** Which surface is open: velin | board | client | calls | chat. */
  section?: string;
  onSelectClient?: (slug: string) => void;
  onOpenSettings?: () => void;
  onGoHome?: () => void;
  onOpenBoard?: () => void;
  onOpenCalls?: () => void;
  onOpenAgent?: () => void;
  onOpenFiles?: () => void;
  onOpenUniversalChat?: () => void;
  onSwitchUniversalSession?: (uuid: string) => void;
  /** Collapse the sidebar (rendered as a button in the head). */
  onCollapse?: () => void;
};

export default function BeyondSidebarPreview({
  selectedSlug,
  section,
  onSelectClient,
  onOpenSettings,
  onGoHome,
  onOpenBoard,
  onOpenCalls,
  onOpenAgent,
  onOpenFiles,
  onOpenUniversalChat,
  onSwitchUniversalSession,
  onCollapse,
}: Props) {
  const { clients: apiClients, refresh: refreshClients } = useBeyondClients();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const [query, setQuery] = useState('');

  const handleSynced = () => {
    window.dispatchEvent(new CustomEvent('beyond:brain-synced'));
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
        {/* Primary surfaces. The velín is home; the chat is one item among
            them rather than the whole app. */}
        {onGoHome && (
          <button
            type="button"
            className="bb-row"
            aria-current={section === 'velin' ? 'true' : undefined}
            onClick={onGoHome}
          >
            <span className="bb-avatar" style={{ background: 'transparent', boxShadow: 'none' }}>
              <Gauge size={15} strokeWidth={1.8} style={{ color: 'var(--bb-ink2)' }} />
            </span>
            <span className="bb-row__label">Velín</span>
          </button>
        )}
        {onOpenBoard && (
          <button
            type="button"
            className="bb-row"
            aria-current={section === 'board' || section === 'client' ? 'true' : undefined}
            onClick={onOpenBoard}
          >
            <span className="bb-avatar" style={{ background: 'transparent', boxShadow: 'none' }}>
              <Users size={15} strokeWidth={1.8} style={{ color: 'var(--bb-ink2)' }} />
            </span>
            <span className="bb-row__label">Klienti</span>
          </button>
        )}
        {onOpenCalls && (
          <button
            type="button"
            className="bb-row"
            aria-current={section === 'calls' ? 'true' : undefined}
            onClick={onOpenCalls}
          >
            <span className="bb-avatar" style={{ background: 'transparent', boxShadow: 'none' }}>
              <CalendarDays size={15} strokeWidth={1.8} style={{ color: 'var(--bb-ink2)' }} />
            </span>
            <span className="bb-row__label">Hovory</span>
          </button>
        )}
        {onOpenAgent && (
          <button
            type="button"
            className="bb-row"
            aria-current={section === 'agent' ? 'true' : undefined}
            onClick={onOpenAgent}
          >
            <span className="bb-avatar" style={{ background: 'transparent', boxShadow: 'none' }}>
              <Bot size={15} strokeWidth={1.8} style={{ color: 'var(--bb-ink2)' }} />
            </span>
            <span className="bb-row__label">Agent</span>
          </button>
        )}
        {onOpenFiles && (
          <button
            type="button"
            className="bb-row"
            aria-current={section === 'files' ? 'true' : undefined}
            onClick={onOpenFiles}
          >
            <span className="bb-avatar" style={{ background: 'transparent', boxShadow: 'none' }}>
              <FolderTree size={15} strokeWidth={1.8} style={{ color: 'var(--bb-ink2)' }} />
            </span>
            <span className="bb-row__label">Soubory</span>
          </button>
        )}
        {onOpenUniversalChat && (
          <button
            type="button"
            className="bb-row"
            aria-current={section === 'chat' ? 'true' : undefined}
            onClick={onOpenUniversalChat}
          >
            <span className="bb-avatar" style={{ background: 'transparent', boxShadow: 'none' }}>
              <MessageSquare size={15} strokeWidth={1.8} style={{ color: 'var(--bb-ink2)' }} />
            </span>
            <span className="bb-row__label">Chat</span>
          </button>
        )}

        {onOpenUniversalChat && <UniversalSessions onSwitch={onSwitchUniversalSession} query={query} />}

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

const RECENT_COUNT = 6;

/**
 * Past global ("+ Nový chat") sessions. A handful of the most recent ones,
 * the active one always among them; the rest unfold on request. Typing in
 * the search box searches all of them instead.
 */
function UniversalSessions({ onSwitch, query }: { onSwitch?: (uuid: string) => void; query: string }) {
  const { sessions, activeUuid } = useBeyondSessions(UNIVERSAL_SLUG);
  const [all, setAll] = useState(false);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (q) return sessions.filter((s) => s.title.toLowerCase().includes(q));
    if (all || sessions.length <= RECENT_COUNT) return sessions;
    const head = sessions.slice(0, RECENT_COUNT);
    const active = sessions.find((s) => s.uuid === activeUuid);
    if (active && !head.includes(active)) head.push(active);
    return head;
  }, [sessions, q, all, activeUuid]);
  if (sessions.length === 0) return null;

  const handleDelete = (s: BeyondSession) => {
    if (!window.confirm(`Smazat chat „${s.title}" z indexu?\n(transkript na disku zůstane.)`)) return;
    const nextSessions = sessions.filter((x) => x.uuid !== s.uuid);
    const nextActive = activeUuid === s.uuid ? null : activeUuid;
    persistSessionIndex(UNIVERSAL_SLUG, { activeUuid: nextActive, sessions: nextSessions }, [s.uuid]);
    window.dispatchEvent(new CustomEvent('beyond:sessions-changed', { detail: { slug: UNIVERSAL_SLUG } }));
  };

  const hidden = sessions.length - shown.length;
  return (
    <div className="bb-subrail">
      {shown.map((s) => (
        <SessionRow
          key={s.uuid}
          session={s}
          active={s.uuid === activeUuid}
          onClick={() => onSwitch?.(s.uuid)}
          onDelete={() => handleDelete(s)}
        />
      ))}
      {q && shown.length === 0 && (
        <p className="px-2 py-1 text-[11.5px]" style={{ color: 'var(--bb-ink3)' }}>Žádný chat.</p>
      )}
      {!q && sessions.length > RECENT_COUNT && (
        <button type="button" className="bb-subrow" onClick={() => setAll((v) => !v)}>
          <span className="bb-subrow__t" style={{ color: 'var(--bb-ink3)' }}>
            {all ? 'Jen nedávné' : `Dalších ${hidden}`}
          </span>
        </button>
      )}
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
