import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  Paperclip,
  ChevronRight,
  ShieldOff,
  Shield,
  Square,
  Settings as SettingsIcon,
  Upload,
  Plus,
  Sparkles,
  PanelRight,
  Mic,
} from 'lucide-react';

import { CLAUDE_MODELS } from '../../../shared/modelConstants';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { authenticatedFetch } from '../../utils/api';
import {
  fetchBeyondModels,
  fallbackModelOptions,
  type BeyondModelOption,
} from './beyondModels';
import BeyondLoader, { readLoaderKind, type LoaderKind } from './BeyondLoader';
import BeyondBrainMark from './BeyondBrainMark';
import BeyondThinkingStates from './BeyondThinkingStates';
import BeyondSlashMenu from './BeyondSlashMenu';
import { useBeyondSpeech } from './useBeyondSpeech';
import { useBeyondSlashCommands } from './useBeyondSlashCommands';
import {
  BEYOND_APP_COMMANDS,
  findAppCommand,
  parseSlash,
  type BeyondAppAction,
  type BeyondSlashCommand,
} from './beyondCommands';
import {
  fetchSessionIndex,
  persistSessionIndex,
  resolveActiveUuid,
  suggestSessionTitle,
  writeLocalActive,
  type BeyondSession,
} from './beyondSessionsApi';
import { useBrainPath } from './useBrainPath';

import MessageBlock from './chat/MessageBlock';
import ModelPicker from './chat/ModelPicker';
import TokenBudgetChip from './chat/TokenBudgetChip';
import AskPanel from './chat/AskPanel';
import PermissionPanel from './chat/PermissionPanel';
import PermissionsSheet from './chat/PermissionsSheet';
import AttachmentChip from './chat/AttachmentChip';
import WhatsAppActionCard from './chat/WhatsAppActionCard';
import SessionsMenu from './chat/SessionsMenu';
import {
  MAX_IMAGE_BYTES,
  MAX_TEXT_BYTES,
  TEXT_LIKE_EXT,
  TEXT_LIKE_MIME,
} from './chat/attachments';
import { notifySessionsChanged, shortTitle } from './chat/format';
import {
  BYPASS_PERMISSIONS_STORAGE_KEY,
  MODEL_STORAGE_KEY,
  matchAllowEntry,
  persistAllowedTools,
  readAllowedTools,
} from './chat/prefs';
import { isWhatsAppSendTool } from './chat/toolDisplay';
import {
  appendAssistantTextById,
  appendStep,
  rebuildHistory,
  uid,
  updateStep,
} from './chat/transcript';
import type {
  AskRequest,
  ChatMessage,
  PendingAttachment,
  PermRequest,
  TokenBudget,
  ToolStep,
} from './chat/types';

/**
 * Beyond Brain — the chat surface.
 *
 * This file owns the turn lifecycle only: WebSocket wiring, which session is
 * live, streaming state, tool approvals, attachments and the composer. Every
 * piece of the transcript and every panel it can raise lives under `chat/`, and
 * the pure transforms behind them are in `chat/transcript.ts`.
 *
 * Talks to claudecodeui's existing WebSocket using `claude-command` messages.
 * cwd for the Claude SDK is the brain repo, whose real location comes from the
 * server via `useBrainPath()` — never hardcoded, because the dev machine is a
 * Mac and the host that actually runs this is a Windows box.
 *
 * Session continuity per client: the Claude Agent SDK assigns a real UUID on
 * the first turn (arrives as `kind: 'session_created'`). We persist that UUID
 * in localStorage keyed by client slug, then pass it as `sessionId` + `resume:
 * true` on subsequent turns so the same conversation survives reloads.
 */

type Props = {
  /** Selected client. Used for the header label and as a stable session key. */
  client: { slug: string; name: string; week?: string | null };
  /** Optional initial prompt to auto-send (e.g. coming from a welcome chip). */
  initialPrompt?: string;
  /** Override which session this mount loads:
   *  - undefined (default) → resume the server's activeUuid
   *  - `{ uuid: null }`    → start fresh, ignore server activeUuid (e.g. "+ Nový chat")
   *  - `{ uuid: 'xxx' }`   → resume this specific session, override server activeUuid
   *  Only consulted on mount; bump the parent's epoch key to apply a new value. */
  sessionOverride?: { uuid: string | null };
};

export default function BeyondChat({ client, initialPrompt, sessionOverride }: Props) {
  const { sendMessage, latestMessage, isConnected, subscribeMessages } = useWebSocket();

  // Host-resolved brain repo path. `null` until it loads; every send site omits
  // the path in that window rather than guessing, and the server resolves it.
  const { brainPath } = useBrainPath();
  const brainPathRef = useRef<string | null>(brainPath);
  brainPathRef.current = brainPath;

  // Claude Agent SDK session UUID for this client. Loaded from localStorage on
  // mount; updated whenever the server emits `session_created`. We only pass
  // `resume: true` once we actually have a UUID — otherwise the SDK tries to
  // resume a non-existent transcript and silently hangs.
  const sessionIdRef = useRef<string | null>(null);
  // True between "user sent the first turn of a brand-new chat" and "server
  // told us the freshly-minted session id". Only the mount that started that
  // turn may claim the incoming `session_created` — and only such a mount
  // accepts stream events that don't yet carry a matching session id. This is
  // what keeps one chat's stream from bleeding into another on the single,
  // shared WebSocket connection (also across a shared login / multiple tabs).
  const expectingNewSessionRef = useRef<boolean>(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  // What the CLI is doing while the spinner runs (a retry after a 429 and
  // such), so a long wait has a reason on the screen.
  const [thinkingNote, setThinkingNote] = useState<string | null>(null);
  const thinkingRef = useRef(thinking);
  thinkingRef.current = thinking;
  const isConnectedRef = useRef(isConnected);
  isConnectedRef.current = isConnected;
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [value, setValue] = useState('');
  const [askRequest, setAskRequest] = useState<AskRequest | null>(null);
  const [permRequest, setPermRequest] = useState<PermRequest | null>(null);
  const [bypassPermissions, setBypassPermissions] = useState<boolean>(() => {
    try {
      return localStorage.getItem(BYPASS_PERMISSIONS_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [allowedTools, setAllowedTools] = useState<string[]>(() => readAllowedTools());
  const allowedToolsRef = useRef<string[]>(allowedTools);
  allowedToolsRef.current = allowedTools;
  // Selected Claude model. Persisted globally (one shared login). Read via ref
  // in send() so the value rides each turn without re-creating the callback.
  const [model, setModel] = useState<string>(() => {
    try {
      return localStorage.getItem(MODEL_STORAGE_KEY) || CLAUDE_MODELS.DEFAULT;
    } catch {
      return CLAUDE_MODELS.DEFAULT;
    }
  });
  const modelRef = useRef<string>(model);
  modelRef.current = model;
  // Model options shown in the picker. Start from the static fallback, then
  // replace with the live list (real version names) once it loads.
  const [modelOptions, setModelOptions] = useState<BeyondModelOption[]>(() => fallbackModelOptions());
  const [permsOpen, setPermsOpen] = useState(false);
  // Thinking-loader animation (Settings → Animace přemýšlení), shared via events.
  const [loader, setLoader] = useState<LoaderKind>(() => readLoaderKind());
  // Id of the assistant message currently streaming in (word-by-word cross-blur).
  // Set on each stream_delta, cleared on complete/error so the bubble swaps to
  // the fully-formatted Markdown render.
  const [streamingId, setStreamingId] = useState<string | null>(null);
  // Stable id for the in-flight streaming bubble — a tool step or turn end
  // resets it so the next deltas start a fresh bubble.
  const streamBubbleIdRef = useRef<string | null>(null);
  // Recovery: true while we're re-syncing after a socket drop / tab refocus, so
  // the next `complete` reloads the authoritative transcript.
  const recoveredRef = useRef(false);
  // Canvas / document panel state, mirrored from the app-level file preview.
  const [canvasPath, setCanvasPath] = useState<string | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Dictation (speech-to-text, Czech). Streams into the composer value.
  const valueRef = useRef(value);
  valueRef.current = value;
  const speech = useBeyondSpeech({
    lang: 'cs-CZ',
    onValue: setValue,
    getBase: () => valueRef.current,
  });

  // Auto-grow the composer textarea as the user types a longer prompt; cap at
  // ~10 lines and let it scroll inside above that.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  // Live context usage for the current SDK session, fed by the server's
  // `token_budget` status events (from queryInstance.getContextUsage) after
  // each turn. `used` is what's in Claude's context window right now —
  // re-sent every turn — not cumulative spend. `autoCompactThreshold` (if
  // provided) is where the SDK will auto-compact. Reset on session switch.
  const [tokenBudget, setTokenBudget] = useState<TokenBudget | null>(null);

  // Per-client sessions index — now server-backed (`/api/beyond/sessions/:slug`)
  // so PC1/PC2 share the same thread list with each client. Transcripts still
  // live on disk under ~/.claude/projects/<cwd-hash>/<uuid>.jsonl on the
  // server box, exposed via `/api/providers/sessions/:uuid/messages`.
  // First mount hydrates from server; mutations PUT it back.
  const [sessions, setSessions] = useState<BeyondSession[]>([]);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  // When a fresh chat is started we remember the next user prompt so we can
  // title the new session as soon as the server emits session_created.
  const pendingTitleRef = useRef<string | null>(null);

  const activeSession = sessions.find((s) => s.uuid === sessionIdRef.current);

  const startNewSession = useCallback(() => {
    // Drop the current uuid + transcript; the next send() will spawn a fresh
    // SDK session and capture its new UUID via session_created. Server still
    // keeps the old session in the list so it can be switched back to.
    sessionIdRef.current = null;
    writeLocalActive(client.slug, null);
    streamBubbleIdRef.current = null;
    setStreamingId(null);
    setMessages([]);
    setThinking(false);
    setAskRequest(null);
    setPermRequest(null);
    setTokenBudget(null);
    setSessionsOpen(false);
    setSessions((prev) => {
      persistSessionIndex(client.slug, { activeUuid: null, sessions: prev });
      notifySessionsChanged(client.slug);
      return prev;
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [client.slug]);

  const switchToSession = useCallback(
    (uuid: string) => {
      if (sessionIdRef.current === uuid) {
        setSessionsOpen(false);
        return;
      }
      sessionIdRef.current = uuid;
      writeLocalActive(client.slug, uuid);
      streamBubbleIdRef.current = null;
      setStreamingId(null);
      setMessages([]);
      setThinking(false);
      setAskRequest(null);
      setPermRequest(null);
      setTokenBudget(null);
      setSessionsOpen(false);
      setLoadingHistory(true);

      authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(uuid)}/messages`)
        .then(async (r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          setMessages(rebuildHistory(data.messages || []));
        })
        .catch(() => {
          /* silent */
        })
        .finally(() => setLoadingHistory(false));

      // Backfill context budget from JSONL so the chip shows the resumed size
      // immediately, before the next turn's token_budget WS event arrives. Use
      // a functional setter so a racing WS event (newer data) always wins.
      authenticatedFetch(`/api/beyond/sessions/${encodeURIComponent(uuid)}/budget`)
        .then(async (r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data || typeof data.used !== 'number' || typeof data.total !== 'number' || data.total <= 0) return;
          setTokenBudget((prev) => prev || {
            used: data.used,
            total: data.total,
            autoCompactThreshold: null,
            isAutoCompactEnabled: true,
          });
        })
        .catch(() => { /* silent */ });

      // Bump lastUsedAt + activate this uuid on the server-side index.
      setSessions((prev) => {
        const next = prev.map((s) =>
          s.uuid === uuid ? { ...s, lastUsedAt: Date.now() } : s,
        );
        persistSessionIndex(client.slug, { activeUuid: uuid, sessions: next });
        notifySessionsChanged(client.slug);
        return next;
      });
    },
    [client.slug],
  );

  // Re-pull the persisted transcript for the current session. Used by the
  // reconnect / refocus recovery so an answer produced while the socket was
  // down (or the tab was backgrounded) shows up, and any broken live stream is
  // replaced by the authoritative on-disk history.
  const reloadHistory = useCallback((uuid: string) => {
    if (!uuid) return;
    authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(uuid)}/messages`)
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        streamBubbleIdRef.current = null;
        setStreamingId(null);
        setMessages((prev) => {
          const next = rebuildHistory(data.messages || []);
          // The transcript on disk can lag behind the screen: a prompt sent a
          // moment ago, and whatever streamed after it, may not be written
          // yet. Never let a reload erase them; keep them after the transcript.
          let lastUser = -1;
          for (let i = prev.length - 1; i >= 0; i -= 1) if (prev[i].role === 'user') { lastUser = i; break; }
          if (lastUser >= 0) {
            const sent = (prev[lastUser] as { text: string }).text.trim();
            const onDisk = next.some((m) => m.role === 'user' && m.kind === 'text' && m.text.trim() === sent);
            if (!onDisk) return [...next, ...prev.slice(lastUser)];
          }
          return next;
        });
      })
      .catch(() => { /* silent — a later turn or manual refresh recovers */ });
  }, []);

  const deleteSession = useCallback(
    (uuid: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.uuid !== uuid);
        const stillActive =
          sessionIdRef.current && sessionIdRef.current !== uuid
            ? sessionIdRef.current
            : null;
        // Explicit removal — the server merges sessions and only drops uuids
        // listed in deletedUuids, so a shorter `next` array alone wouldn't
        // delete anything.
        persistSessionIndex(client.slug, { activeUuid: stillActive, sessions: next }, [uuid]);
        notifySessionsChanged(client.slug);
        return next;
      });
      if (sessionIdRef.current === uuid) {
        // startNewSession() clears this device's local active pointer too.
        startNewSession();
      }
    },
    [client.slug, startNewSession],
  );

  // Sidebar file tree clicks dispatch `beyond:insert-text` so the chat can
  // splice `@<path>` (or any future quick-text) into the composer without
  // lifting composer state up the tree.
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text !== 'string') return;
      setValue((prev) => (prev.endsWith(' ') || !prev ? prev + text : `${prev} ${text}`));
      // Focus textarea so the user can keep typing.
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener('beyond:insert-text', handler);
    return () => window.removeEventListener('beyond:insert-text', handler);
  }, []);

  // Sidebar can drive session actions remotely via custom events; the chat
  // owns the actual switch/new/delete logic so all clients stay consistent.
  useEffect(() => {
    const matchClient = (detail: unknown) =>
      detail && typeof detail === 'object' &&
      (detail as { slug?: string }).slug === client.slug;

    const onSwitch = (e: Event) => {
      const detail = (e as CustomEvent<{ slug: string; uuid: string }>).detail;
      if (!matchClient(detail) || !detail.uuid) return;
      switchToSession(detail.uuid);
    };
    const onNew = (e: Event) => {
      const detail = (e as CustomEvent<{ slug: string }>).detail;
      if (!matchClient(detail)) return;
      startNewSession();
    };
    const onDelete = (e: Event) => {
      const detail = (e as CustomEvent<{ slug: string; uuid: string }>).detail;
      if (!matchClient(detail) || !detail.uuid) return;
      deleteSession(detail.uuid);
    };
    window.addEventListener('beyond:switch-session', onSwitch);
    window.addEventListener('beyond:new-session', onNew);
    window.addEventListener('beyond:delete-session', onDelete);
    return () => {
      window.removeEventListener('beyond:switch-session', onSwitch);
      window.removeEventListener('beyond:new-session', onNew);
      window.removeEventListener('beyond:delete-session', onDelete);
    };
  }, [client.slug, switchToSession, startNewSession, deleteSession]);

  const ingestFile = useCallback(async (file: File) => {
    const isImage = file.type.startsWith('image/');
    const isText = !isImage && (TEXT_LIKE_MIME.test(file.type) || TEXT_LIKE_EXT.test(file.name));
    if (!isImage && !isText) {
      console.warn(`[Beyond] Unsupported attachment type: ${file.name} (${file.type})`);
      return;
    }
    if (isImage && file.size > MAX_IMAGE_BYTES) {
      console.warn(`[Beyond] Image too large: ${file.name}`);
      return;
    }
    if (isText && file.size > MAX_TEXT_BYTES) {
      console.warn(`[Beyond] Text file too large: ${file.name}`);
      return;
    }
    const id = uid();
    if (isImage) {
      const reader = new FileReader();
      reader.onload = () => {
        const data = String(reader.result || '');
        if (!data.startsWith('data:')) return;
        setAttachments((prev) => [
          ...prev,
          { id, name: file.name, mimeType: file.type, size: file.size, kind: 'image', data },
        ]);
      };
      reader.readAsDataURL(file);
    } else {
      const text = await file.text();
      setAttachments((prev) => [
        ...prev,
        {
          id,
          name: file.name,
          mimeType: file.type || 'text/plain',
          size: file.size,
          kind: 'text',
          data: text,
        },
      ]);
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Drag & drop, plus clipboard-paste of images, anywhere inside the chat.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) ingestFile(file);
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [ingestFile]);

  const removeAllow = useCallback((entry: string) => {
    setAllowedTools((prev) => {
      const next = prev.filter((e) => e !== entry);
      persistAllowedTools(next);
      return next;
    });
  }, []);

  const toggleBypass = useCallback(() => {
    setBypassPermissions((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(BYPASS_PERMISSIONS_STORAGE_KEY, '1');
        else localStorage.removeItem(BYPASS_PERMISSIONS_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const respondPermission = useCallback(
    (
      requestId: string,
      decision: { allow: boolean; updatedInput?: unknown; message?: string; rememberEntry?: string },
    ) => {
      sendMessage({
        type: 'claude-permission-response',
        requestId,
        ...decision,
      });
    },
    [sendMessage],
  );

  const handlePermDecision = useCallback(
    (
      decision:
        | { kind: 'allow-once' }
        | { kind: 'always-allow'; entry: string }
        | { kind: 'deny' },
    ) => {
      if (!permRequest) return;
      const { requestId, input } = permRequest;
      if (decision.kind === 'deny') {
        respondPermission(requestId, { allow: false, message: 'Uživatel odmítl.' });
      } else if (decision.kind === 'allow-once') {
        respondPermission(requestId, { allow: true, updatedInput: input });
      } else {
        setAllowedTools((prev) => {
          const next = Array.from(new Set([...prev, decision.entry]));
          persistAllowedTools(next);
          return next;
        });
        respondPermission(requestId, { allow: true, updatedInput: input, rememberEntry: decision.entry });
      }
      setPermRequest(null);
      setThinking(true);
    },
    [permRequest, respondPermission],
  );

  // Load session index + history when switching clients. Reads from server
  // (`/api/beyond/sessions/:slug`) so threads are shared across devices.
  // `sessionOverride` lets the parent pin which session to resume on this
  // mount — used by global ("+ Nový chat") and session-switch flows.
  useEffect(() => {
    let cancelled = false;
    sessionIdRef.current = null;
    expectingNewSessionRef.current = false;
    streamBubbleIdRef.current = null;
    setStreamingId(null);
    setSessions([]);
    setMessages([]);
    setThinking(false);
    setLoadingHistory(false);
    setTokenBudget(null);

    void (async () => {
      try {
        const index = await fetchSessionIndex(client.slug);
        if (cancelled) return;
        setSessions(index.sessions);

        // If an auto-sent initial prompt already started a fresh turn on this
        // mount (welcome → chat), don't resume/overwrite the session under it —
        // that would strand the freshly-minted session id and drop its stream.
        if (expectingNewSessionRef.current || sessionIdRef.current) return;

        // Client chats resume THIS device's open thread (per-device active,
        // shared list); universal chats are pinned by the URL via override.
        const resumeUuid: string | null =
          sessionOverride !== undefined ? sessionOverride.uuid : resolveActiveUuid(index, client.slug);

        if (!resumeUuid) {
          sessionIdRef.current = null;
          if (sessionOverride === undefined) writeLocalActive(client.slug, null);
          return;
        }
        sessionIdRef.current = resumeUuid;
        if (sessionOverride === undefined) writeLocalActive(client.slug, resumeUuid);

        // If override picks a different session than the server's active one,
        // persist that choice so other surfaces (other tabs / sidebar count)
        // line up with what's actually open here.
        if (sessionOverride?.uuid && sessionOverride.uuid !== index.activeUuid) {
          persistSessionIndex(client.slug, {
            activeUuid: sessionOverride.uuid,
            sessions: index.sessions,
          });
          notifySessionsChanged(client.slug);
        }

        setLoadingHistory(true);
        const res = await authenticatedFetch(
          `/api/providers/sessions/${encodeURIComponent(resumeUuid)}/messages`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setMessages(rebuildHistory(data.messages || []));

        // Same backfill as in loadSession: fetch the last JSONL usage so the
        // chip shows real numbers immediately on resume.
        authenticatedFetch(`/api/beyond/sessions/${encodeURIComponent(resumeUuid)}/budget`)
          .then(async (r) => (r.ok ? r.json() : null))
          .then((budget) => {
            if (cancelled) return;
            if (!budget || typeof budget.used !== 'number' || typeof budget.total !== 'number' || budget.total <= 0) return;
            setTokenBudget((prev) => prev || {
              used: budget.used,
              total: budget.total,
              autoCompactThreshold: null,
              isAutoCompactEnabled: true,
            });
          })
          .catch(() => { /* silent */ });
      } catch (err) {
        // watcher may not have indexed the session yet, or server is briefly
        // unreachable — silent so the chat stays usable.
        console.warn('[beyond] failed to load session index', err);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // sessionOverride is read once on mount; the parent bumps the BeyondChat
    // key when it changes, so we deliberately only depend on slug here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.slug]);

  // Route guard for the SINGLE, shared WebSocket connection. Every server event
  // carries the `sessionId` it belongs to; a message is for THIS chat only when
  // its id matches ours. The one exception: right after sending the first turn
  // of a brand-new chat we don't know the id yet, so we accept the unmatched
  // stream (there can only be one such in-flight fresh turn per mounted chat)
  // until `session_created` pins the id. Without this, a late event from a
  // previous chat — or another person on the same login — lands in whatever
  // chat happens to be open.
  const belongsToThisChat = useCallback((m: Record<string, unknown>): boolean => {
    const sid =
      (m.sessionId as string | undefined) ||
      (m.newSessionId as string | undefined) ||
      null;
    if (sid && sid === sessionIdRef.current) return true;
    if (sessionIdRef.current == null && expectingNewSessionRef.current) return true;
    return false;
  }, []);

  // Claim a freshly-minted session id SYNCHRONOUSLY (via the raw subscription,
  // not the batched latestMessage effect) so subsequent stream events route to
  // this chat even when React coalesces the `session_created` render away. Only
  // the mount that started the fresh turn claims it; any other `session_created`
  // on the shared socket belongs to a different chat and is ignored here.
  useEffect(() => {
    return subscribeMessages((m) => {
      if (!m || m.kind !== 'session_created') return;
      if (!expectingNewSessionRef.current || sessionIdRef.current) return;
      const newId =
        (m.newSessionId as string | undefined) ||
        (m.sessionId as string | undefined) ||
        null;
      if (!newId) return;
      expectingNewSessionRef.current = false;
      sessionIdRef.current = newId;
      writeLocalActive(client.slug, newId);
      // The raw first message — used both for the instant snippet title and to
      // ask the server for a nicer AI-generated label right after.
      const firstMessage = pendingTitleRef.current;
      const title = firstMessage
        ? shortTitle(firstMessage)
        : `Chat ${new Date().toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
      pendingTitleRef.current = null;
      setSessions((prev) => {
        if (prev.some((s) => s.uuid === newId)) {
          persistSessionIndex(client.slug, { activeUuid: newId, sessions: prev });
          return prev;
        }
        const entry: BeyondSession = { uuid: newId, title, lastUsedAt: Date.now() };
        const next = [entry, ...prev];
        persistSessionIndex(client.slug, { activeUuid: newId, sessions: next });
        notifySessionsChanged(client.slug);
        return next;
      });

      // Upgrade the snippet to an AI label in the background; drop it in when
      // (and only if) this session still carries the auto-generated title, so a
      // manual rename or a switch away is never clobbered.
      if (firstMessage) {
        void suggestSessionTitle(firstMessage).then((aiTitle) => {
          if (!aiTitle || aiTitle === title) return;
          setSessions((prev) => {
            let changed = false;
            const next = prev.map((s) => {
              if (s.uuid !== newId || s.title !== title) return s;
              changed = true;
              return { ...s, title: aiTitle };
            });
            if (!changed) return prev;
            persistSessionIndex(client.slug, { activeUuid: sessionIdRef.current, sessions: next });
            notifySessionsChanged(client.slug);
            return next;
          });
        });
      }
    });
  }, [subscribeMessages, client.slug]);

  // Direct subscription for token_budget — bypasses React state batching.
  // The latestMessage effect below would otherwise miss this event whenever
  // it arrives microseconds before a `complete` event (server emits them
  // back-to-back at turn end), because React 18 coalesces those setStates
  // into one render where only the last value survives.
  useEffect(() => {
    return subscribeMessages((m) => {
      if (!m || m.kind !== 'status' || m.text !== 'token_budget') return;
      if (!belongsToThisChat(m)) return;
      const tb = m.tokenBudget as
        | {
            used?: number;
            total?: number;
            autoCompactThreshold?: number | null;
            isAutoCompactEnabled?: boolean;
          }
        | undefined;
      if (!tb || typeof tb.used !== 'number' || typeof tb.total !== 'number' || tb.total <= 0) return;
      setTokenBudget({
        used: tb.used,
        total: tb.total,
        autoCompactThreshold: tb.autoCompactThreshold ?? null,
        isAutoCompactEnabled: Boolean(tb.isAutoCompactEnabled),
      });
    });
  }, [subscribeMessages]);

  // Stream handler — server emits NormalizedMessage shapes with `kind`.
  //
  // Fed straight from the socket (see the subscription below), never from the
  // batched `latestMessage` state: when the final `text` and `complete` of a
  // turn arrive in the same tick, React keeps only the last state value and
  // the reply would never show until a reload. Every setState here is a
  // functional update, so order and completeness survive batching.
  const handleStreamMessage = (m: Record<string, unknown>) => {
    const kind = String(m.kind ?? '');
    if (!kind) return;

    // Handled synchronously in the subscription above (immune to batching).
    if (kind === 'session_created') return;

    // Drop anything that isn't for the session this chat is showing.
    if (!belongsToThisChat(m)) return;

    if (kind === 'stream_delta') {
      const text = (m.content as string | undefined) || '';
      if (!text) return;
      setThinkingNote(null);
      if (!streamBubbleIdRef.current) streamBubbleIdRef.current = uid();
      const id = streamBubbleIdRef.current;
      appendAssistantTextById(setMessages, id, text);
      setStreamingId(id);
      return;
    }

    if (kind === 'text') {
      // The server re-emits both user echoes and assistant text under the same
      // kind. We've already appended the user message locally on send, so only
      // accept assistant-role text here.
      if (m.role && m.role !== 'assistant') return;
      const text = (m.content as string | undefined) || '';
      if (!text) return;
      // A whole-message text block ends any streaming bubble. It is the
      // authoritative copy of what the deltas spelled out, so it takes the
      // bubble's place rather than appearing twice under it.
      const bubbleId = streamBubbleIdRef.current;
      streamBubbleIdRef.current = null;
      setStreamingId(null);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (bubbleId && last && last.id === bubbleId && last.role === 'assistant' && last.kind === 'text' && text.startsWith(last.text.trimEnd().slice(0, 200))) {
          return [...prev.slice(0, -1), { ...last, text }];
        }
        return [...prev, { id: uid(), role: 'assistant', kind: 'text', text }];
      });
      return;
    }

    if (kind === 'thinking') {
      // Show the thinking dot — actual content is not surfaced in v2 UI.
      setThinking(true);
      return;
    }

    if (kind === 'tool_use') {
      const name = String(m.toolName ?? '');
      const toolId = String(m.toolId ?? uid());
      if (!name) return;
      // A tool step breaks the streaming text bubble; finalize it to Markdown
      // and let post-tool deltas open a fresh bubble.
      streamBubbleIdRef.current = null;
      setStreamingId(null);
      const step: ToolStep = {
        id: uid(),
        toolId,
        name,
        input: m.toolInput,
        status: 'running',
      };
      setMessages((prev) => appendStep(prev, step));
      return;
    }

    if (kind === 'tool_result') {
      const toolId = String(m.toolId ?? '');
      if (!toolId) return;
      const output = typeof m.content === 'string' ? m.content : '';
      const isError = Boolean(m.isError);
      setMessages((prev) => updateStep(prev, toolId, output, isError));
      return;
    }

    if (kind === 'permission_request') {
      const toolName = String(m.toolName ?? '');
      const requestId = String(m.requestId ?? '');
      if (!requestId) return;

      if (toolName === 'AskUserQuestion') {
        const input = (m.input as AskRequest['input']) || { questions: [] };
        setAskRequest({ requestId, input });
        setThinking(false);
        return;
      }

      // Auto-allow tools the user has previously approved with "Always allow".
      const allowed = allowedToolsRef.current.some((entry) =>
        matchAllowEntry(entry, toolName),
      );
      if (allowed) {
        sendMessage({
          type: 'claude-permission-response',
          requestId,
          allow: true,
          updatedInput: m.input,
        });
        return;
      }

      // Otherwise surface a Beyond-styled permission prompt.
      setPermRequest({ requestId, toolName, input: m.input });
      setThinking(false);
      return;
    }

    if (kind === 'permission_cancelled') {
      const requestId = String(m.requestId ?? '');
      setAskRequest((prev) => (prev && prev.requestId === requestId ? null : prev));
      setPermRequest((prev) => (prev && prev.requestId === requestId ? null : prev));
      return;
    }

    if (kind === 'status' && m.text === 'api_retry') {
      setThinkingNote(typeof m.content === 'string' ? m.content : null);
      return;
    }

    if (kind === 'status' && m.text === 'token_budget') {
      const tb = m.tokenBudget as {
        used?: number;
        total?: number;
        autoCompactThreshold?: number | null;
        isAutoCompactEnabled?: boolean;
      } | undefined;
      if (tb && typeof tb.used === 'number' && typeof tb.total === 'number' && tb.total > 0) {
        setTokenBudget({
          used: tb.used,
          total: tb.total,
          autoCompactThreshold: tb.autoCompactThreshold ?? null,
          isAutoCompactEnabled: Boolean(tb.isAutoCompactEnabled),
        });
      }
      return;
    }

    if (kind === 'status' && m.text === 'session_lookup_failed_fallback') {
      // Server couldn't resume the original SDK session for this transcript
      // (rare format issue) and is auto-retrying as a fresh session. Clear our
      // resume ref and re-arm "expecting" so the fallback's `session_created`
      // is adopted as this client's new active uuid.
      sessionIdRef.current = null;
      expectingNewSessionRef.current = true;
      streamBubbleIdRef.current = null;
      setStreamingId(null);
      setTokenBudget(null);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'assistant',
          kind: 'text',
          text: '_Předchozí session se nepodařilo obnovit, pokračuji v novém vlákně. Claude o předchozí konverzaci neví, ale historii vidíš výše._',
        },
      ]);
      return;
    }

    if (kind === 'complete') {
      setThinking(false);
      setThinkingNote(null);
      // Turn done — finalize the streaming bubble to formatted Markdown.
      streamBubbleIdRef.current = null;
      setStreamingId(null);
      // If this turn finished after a reconnect, the live stream may have missed
      // deltas while we were detached — pull the authoritative transcript.
      if (recoveredRef.current) {
        recoveredRef.current = false;
        if (sessionIdRef.current) reloadHistory(sessionIdRef.current);
      }
      return;
    }

    if (kind === 'error') {
      setThinking(false);
      setThinkingNote(null);
      streamBubbleIdRef.current = null;
      setStreamingId(null);
      const err = (m.content as string | undefined) || 'Hm, něco se rozbilo. Zkusíme znovu?';
      setMessages((prev) => [...prev, { id: uid(), role: 'assistant', kind: 'text', text: err }]);
      return;
    }
  };

  // ── Recovery after a dropped socket / backgrounded tab ────────────────────
  // The server keeps a streaming turn alive across WS drops (grace window)
  // and re-attaches on reconnect. These control messages carry a `type` (no
  // `kind`), so the stream handler above ignores them.
  const handleControlMessage = (m: Record<string, unknown>) => {
    // The server failed before a turn even started (a thrown handler, a bad
    // option). It arrives with `type`, not `kind`; without this the spinner
    // would run for ever over nothing.
    if (m.type === 'error' && thinkingRef.current) {
      const err = typeof m.error === 'string' && m.error ? m.error : 'Server odmítl zprávu, zkus to znovu.';
      setThinking(false);
      setThinkingNote(null);
      streamBubbleIdRef.current = null;
      setStreamingId(null);
      setMessages((prev) => [...prev, { id: uid(), role: 'assistant', kind: 'text', text: `Chyba serveru: ${err}` }]);
      return;
    }
    if (m.type === 'websocket-reconnected') {
      // Ask the server to re-attach us to any live turn and tell us its state.
      if (sessionIdRef.current) {
        recoveredRef.current = true;
        sendMessage({ type: 'check-session-status', sessionId: sessionIdRef.current, provider: 'claude' });
      }
      return;
    }

    if (m.type === 'session-status' && m.sessionId && m.sessionId === sessionIdRef.current) {
      if (m.turnActive) {
        // Still generating server-side — we've been re-attached. Show the
        // transcript up to now; the reattached stream delivers the rest and the
        // final `complete` triggers an authoritative reload.
        recoveredRef.current = true;
        setThinking(true);
        reloadHistory(sessionIdRef.current);
      } else {
        // Finished (or session gone) while we were away — pull the answer and
        // stop the spinner.
        recoveredRef.current = false;
        reloadHistory(sessionIdRef.current);
        setThinking(false);
      }
      return;
    }
  };

  // The handlers close over this render's props and callbacks; the socket
  // subscription lives once and always calls the newest pair.
  const socketHandlerRef = useRef<(m: Record<string, unknown>) => void>(() => {});
  socketHandlerRef.current = (m) => {
    if (typeof m.kind === 'string' && m.kind) handleStreamMessage(m);
    else if (typeof m.type === 'string') handleControlMessage(m);
  };
  useEffect(() => {
    return subscribeMessages((m) => {
      if (!m || typeof m !== 'object') return;
      socketHandlerRef.current(m as Record<string, unknown>);
    });
  }, [subscribeMessages]);

  // Re-check on tab refocus / becoming visible (covers a silently-dead socket
  // that never fired an explicit reconnect, the classic "left the window and it
  // froze"). Only acts when a turn is in-flight for this chat.
  useEffect(() => {
    const recover = () => {
      if (!sessionIdRef.current || !isConnectedRef.current || !thinkingRef.current) return;
      recoveredRef.current = true;
      sendMessage({ type: 'check-session-status', sessionId: sessionIdRef.current, provider: 'claude' });
    };
    const onVis = () => { if (document.visibilityState === 'visible') recover(); };
    window.addEventListener('focus', recover);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', recover);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [sendMessage]);

  // Autoscroll to bottom on new messages.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed && attachments.length === 0) return;
      if (!isConnected) return;

      // Build the user-visible bubble. We render attachment chips below it so
      // the prompt stays readable even after we inline text-file contents.
      const userPreview = trimmed || (attachments.length > 0 ? '📎' : '');
      const attachmentNote = attachments
        .map((a) => `  · ${a.name} (${a.kind === 'image' ? 'obrázek' : 'text'})`)
        .join('\n');
      const userBubble = attachments.length > 0
        ? `${userPreview}\n${attachmentNote}`
        : userPreview;
      setMessages((prev) => [...prev, { id: uid(), role: 'user', kind: 'text', text: userBubble }]);

      // Compose the full prompt: text + inlined text-file contents. Images
      // are sent separately as data URLs so the server can save them and
      // hand the file paths to Claude.
      const textFiles = attachments.filter((a) => a.kind === 'text');
      const images = attachments
        .filter((a) => a.kind === 'image')
        .map((a) => ({ data: a.data, mimeType: a.mimeType, name: a.name }));

      let composedCommand = trimmed;
      if (textFiles.length > 0) {
        const block = textFiles
          .map((f) => `\n\n=== Přiložený soubor: ${f.name} ===\n${f.data}\n=== /soubor ===`)
          .join('');
        composedCommand = composedCommand ? composedCommand + block : block.trim();
      }
      if (!composedCommand) composedCommand = '(uživatel poslal přílohy bez textu)';

      // Guard: if the socket is down (server restart, or an expired login the
      // self-heal is about to reload on), don't clear the input and spin on
      // "thinking" forever — sendMessage would silently drop the message. Keep
      // the text and tell the user.
      if (!isConnected) {
        window.alert(
          'Není spojení se serverem — nejspíš vypršelo přihlášení nebo se server restartuje. ' +
          'Obnov stránku (Cmd/Ctrl+R); tvůj text tu zůstal.',
        );
        return;
      }

      setValue('');
      setAttachments([]);
      setThinking(true);

      // Only resume when we already have a real SDK-issued UUID. On the very
      // first turn we let the SDK assign one and pick it up via session_created.
      const resumeId = sessionIdRef.current;
      if (!resumeId) {
        // Fresh chat: no id yet. Arm the guard so this mount claims the
        // upcoming `session_created` and accepts the stream it belongs to.
        expectingNewSessionRef.current = true;
        // Remember the first user message so session_created can title the
        // newly minted session.
        pendingTitleRef.current = trimmed || (attachments.length > 0 ? `${attachments.length} přílohy` : 'Nový chat');
      } else {
        expectingNewSessionRef.current = false;
        writeLocalActive(client.slug, resumeId);
        // Bump lastUsedAt for the active session so it stays at the top of
        // the dropdown.
        setSessions((prev) => {
          const next = prev.map((s) =>
            s.uuid === resumeId ? { ...s, lastUsedAt: Date.now() } : s,
          );
          persistSessionIndex(client.slug, { activeUuid: resumeId, sessions: next });
          return next;
        });
      }
      sendMessage({
        type: 'claude-command',
        command: composedCommand,
        options: {
          // Omitted while the config request is still in flight — the server
          // falls back to its own resolved brain path, which is the same value.
          ...(brainPathRef.current
            ? { projectPath: brainPathRef.current, cwd: brainPathRef.current }
            : {}),
          model: modelRef.current,
          ...(resumeId ? { sessionId: resumeId, resume: true } : {}),
          sessionSummary: `Beyond · ${client.name}`,
          ...(images.length > 0 ? { images } : {}),
          toolsSettings: {
            // Exact tool names match server-side `matchesToolPermission`.
            // Wildcard entries (e.g. `mcp__waha__*`) are still pre-handled by
            // the frontend allow logic before the server prompt fires.
            allowedTools: allowedToolsRef.current.filter((e) => !e.endsWith('*')),
            disallowedTools: [],
            skipPermissions: bypassPermissions,
          },
        },
      });
    },
    [attachments, bypassPermissions, client.name, client.slug, isConnected, sendMessage],
  );

  const stop = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    sendMessage({ type: 'abort-session', sessionId: sid, provider: 'claude' });
    setThinking(false);
  }, [sendMessage]);

  const changeModel = useCallback(
    (next: string) => {
      setModel(next);
      try {
        localStorage.setItem(MODEL_STORAGE_KEY, next);
      } catch {
        /* storage unavailable — model still applies for this tab */
      }
      // If a session is already running, switch its model in place so the
      // change takes effect on the next turn without losing context. Fresh
      // chats pick it up via the `model` option on the first turn.
      if (sessionIdRef.current && isConnected) {
        sendMessage({
          type: 'set-model',
          sessionId: sessionIdRef.current,
          model: next,
          provider: 'claude',
        });
      }
    },
    [isConnected, sendMessage],
  );

  // Settings dialog (Model / Animace přemýšlení) talks to the chat via events so
  // the composer picker and thinking indicator stay in sync with the dialog.
  useEffect(() => {
    const onSetModel = (e: Event) => {
      const v = (e as CustomEvent<{ value?: string }>).detail?.value;
      if (v) changeModel(v);
    };
    const onSetLoader = (e: Event) => {
      const k = (e as CustomEvent<{ kind?: LoaderKind }>).detail?.kind;
      if (k) setLoader(k);
    };
    window.addEventListener('beyond:set-model', onSetModel);
    window.addEventListener('beyond:set-loader', onSetLoader);
    return () => {
      window.removeEventListener('beyond:set-model', onSetModel);
      window.removeEventListener('beyond:set-loader', onSetLoader);
    };
  }, [changeModel]);

  // Mirror the app-level file preview so the header "Canvas" pill can toggle the
  // document panel and remember the last opened artifact.
  useEffect(() => {
    const onState = (e: Event) => {
      const detail = (e as CustomEvent<{ open?: boolean; path?: string | null }>).detail || {};
      setCanvasOpen(Boolean(detail.open));
      if (detail.open && typeof detail.path === 'string') setCanvasPath(detail.path);
    };
    window.addEventListener('beyond:file-preview-state', onState);
    return () => window.removeEventListener('beyond:file-preview-state', onState);
  }, []);

  // The Konektory panel asks the *running* chat to attach newly-connected MCP
  // servers in place (`beyond:apply-mcp`). Beyond keeps one claude.exe alive per
  // session, so without this a connector added mid-thread would only load in a
  // brand-new chat — costing the user their accumulated context.
  useEffect(() => {
    const onApplyMcp = () => {
      if (!sessionIdRef.current || !isConnected) {
        // No live process for this chat — nothing to hot-attach; the connector
        // will load on the next turn anyway.
        window.dispatchEvent(
          new CustomEvent('beyond:mcp-applied', { detail: { ok: true, live: false } }),
        );
        return;
      }
      sendMessage({
        type: 'apply-mcp',
        sessionId: sessionIdRef.current,
        ...(brainPathRef.current ? { cwd: brainPathRef.current } : {}),
        provider: 'claude',
      });
    };
    window.addEventListener('beyond:apply-mcp', onApplyMcp);
    return () => window.removeEventListener('beyond:apply-mcp', onApplyMcp);
  }, [isConnected, sendMessage]);

  // Server's reply to `apply-mcp` (carries `type`, not `kind`, so the stream
  // handler below skips it) — relay it to the Konektory panel.
  useEffect(() => {
    if (!latestMessage) return;
    const m = latestMessage as Record<string, unknown>;
    if (m.type !== 'mcp-applied') return;
    window.dispatchEvent(
      new CustomEvent('beyond:mcp-applied', {
        detail: {
          ok: Boolean(m.ok),
          live: Boolean(m.live),
          added: Array.isArray(m.added) ? (m.added as string[]) : [],
          error: typeof m.error === 'string' ? m.error : null,
        },
      }),
    );
  }, [latestMessage]);

  // Manual context compaction. Sends `/compact` as a turn — Claude SDK
  // summarizes the conversation so far and continues with a shrunken context.
  // Only meaningful when a session is already running (needs an active uuid
  // to resume against; on a fresh chat there's nothing to compact).
  const compactContext = useCallback(() => {
    if (thinking) return;
    if (!sessionIdRef.current) return;
    if (!isConnected) return;
    if (!window.confirm('Komprimovat kontext této session?\nClaude shrne dosavadní konverzaci a uvolní tokeny pro pokračování.')) {
      return;
    }
    send('/compact');
  }, [thinking, isConnected, send]);

  // ── Slash commands ────────────────────────────────────────────────────────
  // App-mapped commands (/mcp, /model, /settings, …) are CLI-only in Claude
  // Code and have no Agent-SDK equivalent, so we run them against Beyond's own
  // UI. Everything else — custom `.claude/commands`, plugin skills, and the
  // SDK-honoured `/compact` & `/clear` — is passed straight through by `send`.
  const runAppCommand = useCallback(
    (action: BeyondAppAction, args: string) => {
      switch (action) {
        case 'mcp':
          window.dispatchEvent(new CustomEvent('beyond:open-connectors'));
          break;
        case 'settings':
          window.dispatchEvent(new CustomEvent('beyond:open-settings'));
          break;
        case 'model': {
          const wanted = args.trim().toLowerCase();
          const match = wanted
            ? modelOptions.find(
                (o) =>
                  o.value.toLowerCase() === wanted ||
                  o.displayName.toLowerCase() === wanted ||
                  o.short.toLowerCase() === wanted,
              )
            : null;
          if (match) changeModel(match.value);
          else window.dispatchEvent(new CustomEvent('beyond:open-settings'));
          break;
        }
        case 'new':
          startNewSession();
          break;
        case 'sessions':
          setSessionsOpen(true);
          break;
        case 'compact':
          compactContext();
          break;
        case 'cost': {
          const b = tokenBudget;
          const text =
            b && b.total > 0
              ? `**Využití kontextu**\n\n- Použito: ${b.used.toLocaleString('cs-CZ')} / ${b.total.toLocaleString('cs-CZ')} tokenů (${Math.round((b.used / b.total) * 100)} %)${b.autoCompactThreshold ? `\n- Auto-compact při ${b.autoCompactThreshold.toLocaleString('cs-CZ')} tokenech` : ''}`
              : 'Zatím nemám data o využití tokenů — pošli první zprávu a ukazatel v liště se naplní.';
          setMessages((prev) => [...prev, { id: uid(), role: 'assistant', kind: 'text', text }]);
          break;
        }
        case 'help': {
          const rows = BEYOND_APP_COMMANDS.filter((c, i, arr) => arr.findIndex((x) => x.action === c.action) === i)
            .map((c) => `- \`${c.name}\` — ${c.description}`)
            .join('\n');
          const text =
            `**Příkazy v Beyond Brain**\n\nNapiš \`/\` a vyber z nabídky. Aplikační příkazy:\n\n${rows}\n\n` +
            'Kromě toho fungují i vlastní příkazy z `.claude/commands`, skilly a `/compact` — ty se pošlou přímo Claudovi.';
          setMessages((prev) => [...prev, { id: uid(), role: 'assistant', kind: 'text', text }]);
          break;
        }
      }
    },
    [modelOptions, changeModel, startNewSession, compactContext, tokenBudget],
  );

  // Selecting from the autocomplete: app commands run now; passthrough commands
  // are dropped into the composer (with a trailing space) so the user can add
  // args before Enter. Setting the value clears the lone-slash query, which
  // closes the menu on its own.
  const onChooseCommand = useCallback(
    (cmd: BeyondSlashCommand) => {
      if (cmd.kind === 'app' && cmd.action) {
        runAppCommand(cmd.action, '');
        setValue('');
        return;
      }
      setValue(`${cmd.name} `);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [runAppCommand],
  );

  const slash = useBeyondSlashCommands({
    value,
    projectPath: brainPath,
    onChoose: onChooseCommand,
  });

  // Submit from the composer: intercept app commands, else send to the SDK.
  const submit = useCallback(
    (text: string) => {
      const parsed = parseSlash(text);
      const app = parsed ? findAppCommand(parsed.name) : null;
      speech.stop();
      if (app && app.action) {
        runAppCommand(app.action, parsed?.args ?? '');
        setValue('');
        return;
      }
      send(text);
    },
    [runAppCommand, send, speech],
  );

  // Load the live model list (real version names) once on mount; keep the
  // static fallback if the fetch yields nothing.
  useEffect(() => {
    let cancelled = false;
    fetchBeyondModels().then((opts) => {
      if (!cancelled && opts.length) setModelOptions(opts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-send any initial prompt once when the client mounts.
  const sentInitialRef = useRef(false);
  useEffect(() => {
    if (sentInitialRef.current) return;
    if (!initialPrompt) return;
    if (!isConnected) return;
    sentInitialRef.current = true;
    send(initialPrompt);
  }, [initialPrompt, isConnected, send]);

  const header = useMemo(() => {
    const week = client.week ? ` · ${client.week}` : '';
    return `${client.name}${week}`;
  }, [client.name, client.week]);

  return (
    <div
      className="bb-scope relative flex h-full w-full flex-col"
      onDragEnter={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
        }
      }}
      onDragLeave={(e) => {
        // Only collapse when leaving the entire chat container.
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        setDragOver(false);
        for (const f of Array.from(e.dataTransfer.files)) {
          void ingestFile(f);
        }
      }}
    >
      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="bb-glass pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-3xl border-2 border-dashed"
            style={{ borderColor: 'color-mix(in srgb, var(--bb-ink) 28%, transparent)' }}
          >
            <div className="flex flex-col items-center gap-2 text-beyond-dim">
              <Upload className="h-6 w-6" strokeWidth={1.8} />
              <p className="text-[14px] font-medium">Pusť soubor sem</p>
              <p className="text-[12px] text-beyond-faint">Obrázky a textové soubory</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Header — thin glass bar. Title opens the sessions menu; left padding
          leaves room for the shell's hamburger toggle when the sidebar is hidden. */}
      <header className="bb-header" style={{ position: 'relative', paddingLeft: 56 }}>
        <button
          type="button"
          onClick={() => setSessionsOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          title="Seznam chatů s tímto klientem"
        >
          <span className="flex-shrink-0 text-[13.5px] font-medium text-beyond-ink">{client.name}</span>
          <span className="truncate text-[13px] text-beyond-faint">
            {activeSession ? `· ${activeSession.title}` : client.week ? `· ${client.week}` : '· Nový chat'}
          </span>
          <ChevronRight
            className={`h-[14px] w-[14px] flex-shrink-0 text-beyond-faint transition-transform ${sessionsOpen ? 'rotate-90' : ''}`}
            strokeWidth={1.8}
          />
        </button>

        {canvasPath && (
          <button
            type="button"
            className="bb-pill"
            aria-pressed={canvasOpen}
            title={canvasOpen ? 'Zavřít dokument' : 'Otevřít poslední dokument'}
            onClick={() => {
              if (canvasOpen) {
                window.dispatchEvent(new CustomEvent('beyond:close-file'));
              } else {
                window.dispatchEvent(new CustomEvent('beyond:open-file', { detail: { path: canvasPath } }));
              }
            }}
          >
            <PanelRight size={16} strokeWidth={1.8} />
            Canvas
          </button>
        )}

        <div className="flex flex-shrink-0 items-center gap-0.5">
          <button type="button" onClick={startNewSession} title="Nový chat" className="bb-ib">
            <Plus className="h-[16px] w-[16px]" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={compactContext}
            disabled={!sessionIdRef.current || thinking || !isConnected}
            title="Komprimovat kontext (/compact) — Claude shrne konverzaci a uvolní tokeny"
            className="bb-ib disabled:opacity-30"
          >
            <Sparkles className="h-[16px] w-[16px]" strokeWidth={1.8} />
          </button>
          <button type="button" onClick={() => setPermsOpen(true)} title="Nastavení oprávnění" className="bb-ib">
            <SettingsIcon className="h-[16px] w-[16px]" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={toggleBypass}
            title={
              bypassPermissions
                ? 'Bypass režim aktivní — agent neprosí o povolení. Klik vypne.'
                : 'Zapnout bypass režim (dangerously skip permissions)'
            }
            aria-pressed={bypassPermissions}
            className="bb-ib"
            style={bypassPermissions ? { background: 'rgba(217,119,6,.15)', color: '#B45309' } : undefined}
          >
            {bypassPermissions ? (
              <ShieldOff className="h-[16px] w-[16px]" strokeWidth={1.8} />
            ) : (
              <Shield className="h-[16px] w-[16px]" strokeWidth={1.8} />
            )}
          </button>
        </div>

        <AnimatePresence>
          {sessionsOpen && (
            <SessionsMenu
              sessions={sessions}
              activeUuid={sessionIdRef.current}
              onPick={switchToSession}
              onDelete={deleteSession}
              onNew={startNewSession}
              onClose={() => setSessionsOpen(false)}
            />
          )}
        </AnimatePresence>
      </header>

      {/* Messages */}
      <div ref={scrollerRef} className="bb-scroll">
        <div className="bb-thread">
          {messages.length === 0 && !thinking && (
            <div className="flex min-h-[58vh] flex-col items-center justify-center gap-5 text-center">
              <BeyondBrainMark size={88} side={0.76} animate="pulse" />
              <p className="text-[14px] text-beyond-faint">
                {loadingHistory ? 'Načítám…' : 'Tady jsem.'}
              </p>
            </div>
          )}

          {messages.map((m) => (
            <MessageBlock key={m.id} message={m} streaming={m.id === streamingId} />
          ))}

          <AnimatePresence>
            {thinking && !streamingId && !askRequest && !permRequest && (
              <motion.div
                key="thinking"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="bb-think"
                data-active="true"
                style={{ cursor: 'default' }}
              >
                <BeyondBrainMark size={34} side={0.76} animate="pulse" />
                {thinkingNote ? <span className="bb-think__note">{thinkingNote}</span> : <BeyondThinkingStates />}
                <BeyondLoader kind={loader} />
              </motion.div>
            )}
          </AnimatePresence>

          {askRequest && (
            <AskPanel
              request={askRequest}
              onAnswer={(answers) => {
                sendMessage({
                  type: 'claude-permission-response',
                  requestId: askRequest.requestId,
                  allow: true,
                  updatedInput: { ...askRequest.input, answers },
                });
                setAskRequest(null);
                setThinking(true);
              }}
              onSkip={() => {
                sendMessage({
                  type: 'claude-permission-response',
                  requestId: askRequest.requestId,
                  allow: true,
                  updatedInput: { ...askRequest.input, answers: {} },
                });
                setAskRequest(null);
                setThinking(true);
              }}
            />
          )}

          {permRequest && isWhatsAppSendTool(permRequest.toolName) ? (
            <WhatsAppActionCard
              request={permRequest}
              onSend={(updatedInput) => {
                respondPermission(permRequest.requestId, { allow: true, updatedInput });
                setPermRequest(null);
                setThinking(true);
              }}
              onCancel={() => {
                respondPermission(permRequest.requestId, {
                  allow: false,
                  message: 'Uživatel zrušil odeslání.',
                });
                setPermRequest(null);
              }}
            />
          ) : (
            permRequest && (
              <PermissionPanel request={permRequest} onDecision={handlePermDecision} />
            )
          )}

          {!isConnected && (
            <p className="text-center text-[13px] text-beyond-faint">
              Spojuju se…
            </p>
          )}
        </div>

        {/* invisible context for screen readers */}
        <span className="sr-only">{header}</span>
      </div>

      {/* Composer — glass, handoff layout (textarea + bottom bar). */}
      <div
        className="bb-composer__wrap"
        style={{ position: 'relative', paddingBottom: 'max(22px, calc(env(safe-area-inset-bottom) + 8px))' }}
      >
        {slash.open && (
          <BeyondSlashMenu
            items={slash.items}
            activeIndex={slash.activeIndex}
            onHover={slash.setActiveIndex}
            onSelect={onChooseCommand}
          />
        )}
        <div className="bb-composer">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.md,.txt,.json,.csv,.yaml,.yml,.log,.html,.css,.js,.ts,.tsx,.jsx,.py,.sh,.toml,.ini,.env,.jsonl"
            className="hidden"
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              for (const f of files) await ingestFile(f);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {attachments.map((a) => (
                <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
              ))}
            </div>
          )}

          {speech.listening && (
            <div className="bb-mic">
              <div className="bb-mic__bars" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
                ))}
              </div>
              <span style={{ fontSize: 13.5, color: 'var(--bb-ink2)' }}>Poslouchám… (česky)</span>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (slash.onKeyDown(e)) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(value);
              }
            }}
            placeholder="Napiš, co řešíme… (/ pro příkazy)"
            rows={1}
          />

          <div className="bb-composer__bar">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              tabIndex={-1}
              aria-label="Příloha"
              title="Přidat soubor (obrázek nebo text)"
              className="bb-ib bb-ib--tool"
            >
              <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
            {speech.supported && (
              <button
                type="button"
                onClick={speech.toggle}
                aria-pressed={speech.listening}
                aria-label="Diktovat"
                title={speech.listening ? 'Zastavit diktování' : 'Diktovat (česky)'}
                className="bb-ib bb-ib--tool"
              >
                <Mic className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            )}
            <ModelPicker value={model} options={modelOptions} onChange={changeModel} />
            <TokenBudgetChip budget={tokenBudget} />
            <span className="bb-composer__hint">Enter odešle · Shift + Enter nový řádek</span>
            {thinking ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Zastav"
                title="Zastav agenta"
                className="bb-send"
                data-active="true"
              >
                <Square className="h-[13px] w-[13px] fill-current" strokeWidth={0} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => submit(value)}
                disabled={(!value.trim() && attachments.length === 0) || !isConnected}
                aria-label="Pošli"
                className="bb-send"
                data-active={(value.trim() || attachments.length > 0) && isConnected ? 'true' : 'false'}
              >
                <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
        <div className="bb-disclaimer">Beyond Brain může chybovat. U důležitých věcí prověř zdroje.</div>
      </div>

      <AnimatePresence>
        {permsOpen && (
          <PermissionsSheet
            entries={allowedTools}
            onRemove={removeAllow}
            onClose={() => setPermsOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
