import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import BeyondShell from './BeyondShell';
import BeyondWelcome from './BeyondWelcome';
import BeyondChat from './BeyondChat';
import BeyondFilePreview from './BeyondFilePreview';
import BeyondHtmlCanvas from './BeyondHtmlCanvas';
import BeyondConnectors from './BeyondConnectors';
import BeyondSettings from './BeyondSettings';
import VelinPage from './velin/VelinPage';
import ClientBoard from './velin/ClientBoard';
import ClientDetail from './velin/ClientDetail';
import CallsPage from './velin/CallsPage';
import AgentPage from './velin/AgentPage';
import FilesPage from './files/FilesPage';
import ScreenBoundary from './ScreenBoundary';
import ObsahPage from './velin/ObsahPage';
import StudioPage from './velin/StudioPage';
import { useBeyondClients, type BeyondClient } from './useBeyondClients';
import { UNIVERSAL_SLUG } from './beyondSessionsApi';

/**
 * Beyond Brain — top-level app surface (v2).
 *
 * The URL is the single source of truth for which chat is open, so every chat
 * has its own shareable / refreshable address:
 *   /                    → Welcome
 *   /c/<client-slug>     → that client's chat (resumes its active session)
 *   /c/new               → a fresh universal ("+ Nový chat") sandbox
 *   /c/new/<uuid>        → a specific universal session
 *
 * BeyondApp is mounted by the catch-all route and never unmounts, so it parses
 * `location.pathname` itself (rather than using nested <Route> elements, which
 * would remount it on every param change and drop in-flight chat state).
 *
 * No tabs (Files / Source Control / Plugins / Settings) — those legacy surfaces
 * are skipped per VISION.md.
 */

// URL segment used for the universal sandbox (prettier than `__universal__`).
const UNIVERSAL_SEG = 'new';

type ParsedRoute = { slug: string | null; uuid: string | null };

/**
 * Which surface the URL points at.
 *
 * `/` is the velín, not the chat: the point of opening this app in the morning
 * is to see what needs attention, and a blank prompt cannot tell you that. The
 * chat keeps its own address and every one of its routes unchanged.
 */
type View =
  | { kind: 'velin' }
  | { kind: 'board' }
  | { kind: 'client'; slug: string }
  | { kind: 'calls' }
  | { kind: 'agent' }
  | { kind: 'files'; path: string | null }
  | { kind: 'obsah' }
  | { kind: 'studio' }
  | { kind: 'chat' };

function parseView(pathname: string): View {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return { kind: 'velin' };
  if (parts[0] === 'klienti') return { kind: 'board' };
  if (parts[0] === 'hovory') return { kind: 'calls' };
  if (parts[0] === 'agent') return { kind: 'agent' };
  if (parts[0] === 'obsah') return { kind: 'obsah' };
  if (parts[0] === 'stories') return { kind: 'studio' };
  if (parts[0] === 'soubory') {
    const rest = parts.slice(1).map((p) => decodeURIComponent(p)).join('/');
    return { kind: 'files', path: rest || null };
  }
  if (parts[0] === 'klient' && parts[1]) return { kind: 'client', slug: decodeURIComponent(parts[1]) };
  return { kind: 'chat' };
}

/** Parse `/c/<slug>[/<uuid>]` out of a pathname (basename already stripped). */
function parseBeyondPath(pathname: string): ParsedRoute {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'c' || parts.length < 2) return { slug: null, uuid: null };
  const rawSlug = decodeURIComponent(parts[1]);
  const slug = rawSlug === UNIVERSAL_SEG ? UNIVERSAL_SLUG : rawSlug;
  const uuid = parts[2] ? decodeURIComponent(parts[2]) : null;
  return { slug, uuid };
}

/** Build the path for a given chat. */
function pathForChat(slug: string, uuid?: string | null): string {
  const seg = slug === UNIVERSAL_SLUG ? UNIVERSAL_SEG : encodeURIComponent(slug);
  return uuid ? `/c/${seg}/${encodeURIComponent(uuid)}` : `/c/${seg}`;
}

export default function BeyondApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const { clients } = useBeyondClients();

  const view = useMemo(() => parseView(location.pathname), [location.pathname]);

  const { slug: activeSlug, uuid: routeUuid } = useMemo(
    () => parseBeyondPath(location.pathname),
    [location.pathname],
  );

  // The prompt typed on the Welcome screen, carried into the chat we route to.
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>(undefined);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [htmlDoc, setHtmlDoc] = useState<{ html: string; title?: string } | null>(null);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Sidebar file tree (and clickable chat paths) dispatch `beyond:open-file`
  // with a repo-relative or absolute path; we surface a slide-in preview sheet.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string }>).detail;
      if (detail && typeof detail.path === 'string') {
        setPreviewPath(detail.path);
      }
    };
    const onClose = () => setPreviewPath(null);
    window.addEventListener('beyond:open-file', onOpen);
    window.addEventListener('beyond:close-file', onClose);
    return () => {
      window.removeEventListener('beyond:open-file', onOpen);
      window.removeEventListener('beyond:close-file', onClose);
    };
  }, []);

  // Broadcast the document panel's open state so the chat header "Canvas" pill
  // can reflect it and remember the last opened artifact.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('beyond:file-preview-state', {
        detail: { open: Boolean(previewPath), path: previewPath },
      }),
    );
  }, [previewPath]);

  // An HTML/SVG code block in a chat answer dispatches `beyond:open-html` with
  // the raw markup; surface it as a live visual page in the canvas panel.
  useEffect(() => {
    const onOpenHtml = (e: Event) => {
      const detail = (e as CustomEvent<{ html?: string; title?: string }>).detail;
      if (detail && typeof detail.html === 'string' && detail.html.trim()) {
        setHtmlDoc({ html: detail.html, title: detail.title });
      }
    };
    window.addEventListener('beyond:open-html', onOpenHtml);
    return () => window.removeEventListener('beyond:open-html', onOpenHtml);
  }, []);

  // Sidebar "Konektory" item dispatches `beyond:open-connectors`; surface the
  // MCP connectors management sheet.
  useEffect(() => {
    const onOpenConnectors = () => setConnectorsOpen(true);
    window.addEventListener('beyond:open-connectors', onOpenConnectors);
    return () => window.removeEventListener('beyond:open-connectors', onOpenConnectors);
  }, []);

  // Sidebar gear dispatches `beyond:open-settings`; surface the Settings dialog.
  useEffect(() => {
    const onOpenSettings = () => setSettingsOpen(true);
    window.addEventListener('beyond:open-settings', onOpenSettings);
    return () => window.removeEventListener('beyond:open-settings', onOpenSettings);
  }, []);

  const handleSelectClient = useCallback(
    (slug: string) => {
      setInitialPrompt(undefined);
      navigate(pathForChat(slug));
    },
    [navigate],
  );

  const handleWelcomePrompt = useCallback(
    (prompt: string) => {
      // Tiny heuristic: if any active client's first name appears in the
      // prompt, focus that client's chat. Otherwise fall through to a fresh
      // universal sandbox chat so the prompt never gets stranded on welcome.
      const lowered = prompt.toLowerCase();
      const match = (clients || []).find((c: BeyondClient) =>
        lowered.includes(c.name.split(' ')[0].toLowerCase()),
      );
      setInitialPrompt(prompt);
      navigate(pathForChat(match ? match.slug : UNIVERSAL_SLUG));
    },
    [clients, navigate],
  );

  const handleOpenUniversalChat = useCallback(() => {
    setInitialPrompt(undefined);
    // Always push a fresh /c/new entry — even if we're already there — so the
    // view key (which includes location.key) changes and BeyondChat remounts
    // into a brand-new session.
    navigate(pathForChat(UNIVERSAL_SLUG));
  }, [navigate]);

  const handleSwitchUniversalSession = useCallback(
    (uuid: string) => {
      setInitialPrompt(undefined);
      navigate(pathForChat(UNIVERSAL_SLUG, uuid));
    },
    [navigate],
  );

  const handleGoHome = useCallback(() => {
    setInitialPrompt(undefined);
    navigate('/');
  }, [navigate]);

  const activeClient = useMemo(() => {
    if (!activeSlug) return null;
    if (activeSlug === UNIVERSAL_SLUG) {
      return { slug: UNIVERSAL_SLUG, name: 'Nový chat', week: null };
    }
    const fromApi = (clients || []).find((c: BeyondClient) => c.slug === activeSlug);
    if (fromApi) {
      return { slug: fromApi.slug, name: fromApi.name, week: fromApi.week };
    }
    // Fallback for when the API hasn't loaded yet but a slug is in the URL.
    return { slug: activeSlug, name: prettifySlug(activeSlug), week: null };
  }, [activeSlug, clients]);

  // Which session this mount should resume:
  //  - universal: pinned to the routed uuid, or { uuid: null } for a fresh start
  //  - client:    undefined → follow the server-side active session
  const sessionOverride = useMemo<{ uuid: string | null } | undefined>(() => {
    if (activeSlug === UNIVERSAL_SLUG) return { uuid: routeUuid };
    return undefined;
  }, [activeSlug, routeUuid]);

  // Page transition key. A client is keyed by slug (one chat per client, resumes
  // its active session). A universal session is keyed by its uuid. A *fresh*
  // universal chat (no uuid) is keyed by the history entry's key, so each
  // "+ Nový chat" — even back-to-back to the same /c/new path — remounts into a
  // clean session, while sending a message mid-chat does not remount it.
  const viewKey =
    view.kind !== 'chat'
      ? view.kind === 'client'
        ? `client:${view.slug}`
        : view.kind
      : !activeClient
        ? 'welcome'
        : activeClient.slug !== UNIVERSAL_SLUG
          ? `chat:${activeClient.slug}`
          : routeUuid
            ? `universal:${routeUuid}`
            : `universal:fresh:${location.key}`;

  // The chat stays mounted while another screen is open, so a reply that
  // is still arriving keeps arriving and the spinner, the streamed words
  // and the composer draft are all there on return. It only remounts when
  // the person opens a different chat.
  const chatKey = view.kind === 'chat' && activeClient ? viewKey : null;
  const [mountedChat, setMountedChat] = useState<{ key: string; client: NonNullable<typeof activeClient>; sessionOverride: typeof sessionOverride; initialPrompt: string | undefined } | null>(null);
  useEffect(() => {
    if (chatKey && activeClient) setMountedChat({ key: chatKey, client: activeClient, sessionOverride, initialPrompt });
  }, [chatKey, activeClient, sessionOverride, initialPrompt]);
  const chatVisible = view.kind === 'chat' && Boolean(activeClient);

  const openClient = useCallback((slug: string) => navigate(`/klient/${encodeURIComponent(slug)}`), [navigate]);
  const openBoard = useCallback(() => navigate('/klienti'), [navigate]);
  const openCalls = useCallback(() => navigate('/hovory'), [navigate]);
  const openAgent = useCallback(() => navigate('/agent'), [navigate]);
  const openObsah = useCallback(() => navigate('/obsah'), [navigate]);
  const openStudio = useCallback(() => navigate('/stories'), [navigate]);
  const openFiles = useCallback(
    (p?: string | null) => navigate(p ? `/soubory/${p.split('/').map(encodeURIComponent).join('/')}` : '/soubory'),
    [navigate],
  );

  return (
    <BeyondShell
      section={view.kind}
      onGoHome={handleGoHome}
      onOpenBoard={openBoard}
      onOpenCalls={openCalls}
      onOpenAgent={openAgent}
      onOpenFiles={() => openFiles(null)}
      onOpenObsah={openObsah}
      onOpenStudio={openStudio}
      onOpenUniversalChat={handleOpenUniversalChat}
      onSwitchUniversalSession={handleSwitchUniversalSession}
    >
      {mountedChat && (
        <div className="h-full w-full" hidden={!chatVisible}>
          <ScreenBoundary name="chat">
          <BeyondChat
            key={mountedChat.key}
            client={mountedChat.client}
            initialPrompt={mountedChat.initialPrompt}
            sessionOverride={mountedChat.sessionOverride}
          />
          </ScreenBoundary>
        </div>
      )}
      <AnimatePresence mode="wait">
        {!chatVisible && (
        <motion.div
          key={viewKey}
          initial={{ opacity: 0, filter: 'blur(6px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, filter: 'blur(6px)' }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="h-full w-full"
        >
          <ScreenBoundary name={view.kind}>
          {view.kind === 'velin' ? (
            <VelinPage onOpenClient={openClient} onOpenCalls={openCalls} onOpenChat={handleOpenUniversalChat} />
          ) : view.kind === 'board' ? (
            <ClientBoard onOpenClient={openClient} />
          ) : view.kind === 'client' ? (
            <ClientDetail slug={view.slug} onBack={openBoard} onOpenChat={handleSelectClient} />
          ) : view.kind === 'calls' ? (
            <CallsPage onOpenClient={openClient} />
          ) : view.kind === 'agent' ? (
            <AgentPage />
          ) : view.kind === 'files' ? (
            <FilesPage path={view.path} onOpen={openFiles} />
          ) : view.kind === 'obsah' ? (
            <ObsahPage onOpenStudio={openStudio} onOpenClient={openClient} />
          ) : view.kind === 'studio' ? (
            <StudioPage />
          ) : (
            <BeyondWelcome
              onSubmit={(message) => handleWelcomePrompt(message)}
              onNewChat={handleOpenUniversalChat}
            />
          )}
          </ScreenBoundary>
        </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {previewPath && (
          <BeyondFilePreview
            path={previewPath}
            onClose={() => setPreviewPath(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {htmlDoc && (
          <BeyondHtmlCanvas
            html={htmlDoc.html}
            title={htmlDoc.title}
            onClose={() => setHtmlDoc(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {connectorsOpen && (
          <BeyondConnectors onClose={() => setConnectorsOpen(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && (
          <BeyondSettings onClose={() => setSettingsOpen(false)} />
        )}
      </AnimatePresence>
    </BeyondShell>
  );
}

function prettifySlug(slug: string): string {
  return slug
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}
