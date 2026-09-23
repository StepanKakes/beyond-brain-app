import { useMemo, useState } from 'react';
import {
  Search, Plus, Check, MessagesSquare, Trash2, Plug,
  PanelLeftClose, Settings, Sun, Moon,
  Gauge, Users, CalendarDays, MessageSquare, Bot, FolderTree, Clapperboard, Images, ChevronsUpDown,
} from 'lucide-react';
import BeyondBrainMark from './BeyondBrainMark';
import { useBeyondClients } from './useBeyondClients';
import BeyondRepoStatus from './BeyondRepoStatus';
import { useBeyondSessions, type BeyondSession } from './useBeyondSessions';
import { persistSessionIndex, UNIVERSAL_SLUG } from './beyondSessionsApi';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../auth';
import { useBeyondCounts } from './useBeyondCounts';

/**
 * Beyond Brain — v3 Sidebar (Liquid Glass).
 *
 * Head (brand + collapse) · repo status · new chat · search · scrolling body
 * (the surfaces, a short list of recent chats) ·
 * pinned foot (Konektory, user, theme, settings). Everything reads the --bb-*
 * glass tokens. The chat history shows a handful like ChatGPT does and unfolds
 * on request; the file tree has its own screen (Soubory).
 */


type Props = {
  /** Which surface is open: velin | board | client | calls | chat. */
  section?: string;
  onOpenSettings?: () => void;
  onGoHome?: () => void;
  onOpenBoard?: () => void;
  onOpenCalls?: () => void;
  onOpenAgent?: () => void;
  onOpenFiles?: () => void;
  onOpenObsah?: () => void;
  onOpenStudio?: () => void;
  onOpenUniversalChat?: () => void;
  /** Back to the chat that is open; the Chat item does not start a new one. */
  onReturnToChat?: () => void;
  onSwitchUniversalSession?: (uuid: string) => void;
  /** The session open right now, or null when another screen is in front. */
  openSessionUuid?: string | null;
  /** Collapse the sidebar (rendered as a button in the head). */
  onCollapse?: () => void;
};

export default function BeyondSidebarPreview({
  section,
  onOpenSettings,
  onGoHome,
  onOpenBoard,
  onOpenCalls,
  onOpenAgent,
  onOpenFiles,
  onOpenObsah,
  onOpenStudio,
  onOpenUniversalChat,
  onReturnToChat,
  onSwitchUniversalSession,
  openSessionUuid,
  onCollapse,
}: Props) {
  const { refresh: refreshClients } = useBeyondClients();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { user } = useAuth();
  const counts = useBeyondCounts();
  const [query, setQuery] = useState('');
  const displayName = user?.username ? user.username.charAt(0).toUpperCase() + user.username.slice(1) : 'Beyond';
  const initial = displayName.charAt(0).toUpperCase();

  const handleSynced = () => {
    window.dispatchEvent(new CustomEvent('beyond:brain-synced'));
    refreshClients?.();
  };



  const openSettings = () => {
    onOpenSettings?.();
    window.dispatchEvent(new CustomEvent('beyond:open-settings'));
  };

  return (
    <div className="flex h-full w-full flex-col">
      {/* Head — brand + collapse */}
      <div className="bb-side__head">
        <div className="flex min-w-0 items-center gap-2">
          <BeyondBrainMark size={30} side={0.76} animate="in" title="Beyond Brain" className="shrink-0" />
          <div className="bb-brand">Beyond&nbsp;<em>Brain</em></div>
        </div>
        {onCollapse && (
          <button type="button" className="bb-ib" onClick={onCollapse} aria-label="Skrýt panel">
            <PanelLeftClose size={17} strokeWidth={1.8} />
          </button>
        )}
      </div>

      {/* Who is signed in. Opens the settings, which is everything about you. */}
      <button type="button" className="bb-me" onClick={openSettings}>
        <span className="bb-me__av">{initial}</span>
        <span className="bb-me__t">
          <b>{displayName}</b>
          <small>Beyond Brain</small>
        </span>
        <ChevronsUpDown size={14} strokeWidth={1.8} />
      </button>

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
        {onGoHome && <NavRow icon={Gauge} label="Velín" on={section === 'velin'} count={counts?.velin} onClick={onGoHome} />}
        {onOpenBoard && <NavRow icon={Users} label="Klienti" on={section === 'board' || section === 'client'} count={counts?.klienti} onClick={onOpenBoard} />}
        {onOpenCalls && <NavRow icon={CalendarDays} label="Hovory" on={section === 'calls'} onClick={onOpenCalls} />}
        {onOpenObsah && <NavRow icon={Clapperboard} label="Obsah" on={section === 'obsah'} count={counts?.obsah} onClick={onOpenObsah} />}
        {onOpenStudio && <NavRow icon={Images} label="Stories" on={section === 'studio'} onClick={onOpenStudio} />}
        {onOpenAgent && <NavRow icon={Bot} label="Agent" on={section === 'agent'} onClick={onOpenAgent} />}
        {onOpenFiles && <NavRow icon={FolderTree} label="Soubory" on={section === 'files'} onClick={onOpenFiles} />}
        {onOpenUniversalChat && <NavRow icon={MessageSquare} label="Chat" on={section === 'chat'} onClick={onReturnToChat || onOpenUniversalChat} />}

        <p className="bb-side__lbl">Nedávné</p>
        {onOpenUniversalChat && <UniversalSessions onSwitch={onSwitchUniversalSession} query={query} openUuid={openSessionUuid ?? null} />}

      </nav>

      {/* Foot — pinned */}
      <div className="bb-side__foot">
        <BeyondRepoStatus onSynced={handleSynced} />
        <div className="bb-side__tools">
          <button type="button" className="bb-side__tool" onClick={() => window.dispatchEvent(new CustomEvent('beyond:open-connectors'))}>
            <Plug size={15} strokeWidth={1.8} />
            <span>Konektory</span>
          </button>
          <button
            type="button"
            className="bb-ib"
            onClick={toggleDarkMode}
            aria-label={isDarkMode ? 'Světlý režim' : 'Tmavý režim'}
            title={isDarkMode ? 'Světlý režim' : 'Tmavý režim'}
          >
            {isDarkMode ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
          </button>
          <button type="button" className="bb-ib" onClick={openSettings} aria-label="Nastavení" title="Nastavení">
            <Settings size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** One item of the left panel: an icon, a word, and how many wait behind it. */
function NavRow({
  icon: Icon, label, on, count, onClick,
}: {
  icon: typeof Gauge;
  label: string;
  on: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className="bb-row" aria-current={on ? 'true' : undefined} onClick={onClick}>
      <Icon size={16} strokeWidth={1.8} className="bb-row__i" />
      <span className="bb-row__label">{label}</span>
      {count != null && count > 0 && <span className="bb-row__n">{count}</span>}
    </button>
  );
}

const RECENT_COUNT = 6;

/**
 * Past global ("+ Nový chat") sessions. A handful of the most recent ones,
 * the active one always among them; the rest unfold on request. Typing in
 * the search box searches all of them instead.
 */
function UniversalSessions({ onSwitch, query, openUuid }: { onSwitch?: (uuid: string) => void; query: string; openUuid: string | null }) {
  const { sessions, activeUuid } = useBeyondSessions(UNIVERSAL_SLUG);
  const [all, setAll] = useState(false);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (q) return sessions.filter((s) => s.title.toLowerCase().includes(q));
    if (all || sessions.length <= RECENT_COUNT) return sessions;
    const head = sessions.slice(0, RECENT_COUNT);
    const open = sessions.find((s) => s.uuid === openUuid);
    if (open && !head.includes(open)) head.push(open);
    return head;
  }, [sessions, q, all, openUuid]);
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
          active={Boolean(openUuid) && s.uuid === openUuid}
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
