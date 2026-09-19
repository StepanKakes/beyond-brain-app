import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  Paperclip,
  ChevronRight,
  FileText,
  FilePen,
  Terminal,
  Search,
  Globe,
  Wrench,
  MessageCircle,
  ShieldOff,
  Shield,
  Square,
  Trash2,
  Settings as SettingsIcon,
  X,
  File as FileIcon,
  Upload,
  Plus,
  MessagesSquare,
  Check,
  Sparkles,
  ChevronDown,
  PanelRight,
  Mic,
} from 'lucide-react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkBeyondFilePaths, parseBeyondFileHref, BEYOND_FILE_SCHEME } from './beyondFilePaths';
import { CLAUDE_MODELS } from '../../../shared/modelConstants';
import {
  fetchBeyondModels,
  fallbackModelOptions,
  type BeyondModelOption,
} from './beyondModels';
import BeyondCodeBlock from './BeyondCodeBlock';
import BeyondLoader, { readLoaderKind, type LoaderKind } from './BeyondLoader';
import BeyondBrainMark from './BeyondBrainMark';
import BeyondThinkingStates from './BeyondThinkingStates';
import StreamingText from './StreamingText';
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
import { useWebSocket } from '../../contexts/WebSocketContext';
import { authenticatedFetch } from '../../utils/api';
import {
  fetchSessionIndex,
  persistSessionIndex,
  resolveActiveUuid,
  suggestSessionTitle,
  writeLocalActive,
  type BeyondSession,
} from './beyondSessionsApi';

/**
 * Beyond Brain — real chat (v2, hyperminimal).
 *
 * Talks to claudecodeui's existing WebSocket using `claude-command` messages.
 * cwd for the Claude SDK is the brain repo (~/Documents/GitHub/beyond-brain).
 *
 * Session continuity per client: the Claude Agent SDK assigns a real UUID on
 * the first turn (arrives as `kind: 'session_created'`). We persist that UUID
 * in localStorage keyed by client slug, then pass it as `sessionId` + `resume:
 * true` on subsequent turns so the same conversation survives reloads.
 */

// cwd for the Claude SDK; the server overrides this with BEYOND_BRAIN_PATH
// when it doesn't exist on disk (this hardcoded macOS value is the upstream
// author's path — kept here for upstream-merge compatibility).
const BRAIN_PROJECT_PATH = '/Users/stepankakes/Documents/GitHub/beyond-brain';

/** Notify same-tab observers (sidebar dropdown etc.) that the per-client
 *  session index changed. Cross-PC continuity is handled by the server side. */
function notifySessionsChanged(slug: string): void {
  window.dispatchEvent(new CustomEvent('beyond:sessions-changed', { detail: { slug } }));
}

function shortTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? oneLine.slice(0, 60) + '…' : oneLine;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60 * 1000;
  const h = 60 * min;
  const d = 24 * h;
  if (diff < min) return 'teď';
  if (diff < h) return `${Math.round(diff / min)} min`;
  if (diff < d) return `${Math.round(diff / h)} h`;
  return `${Math.round(diff / d)} d`;
}

type Role = 'user' | 'assistant';

type ToolStep = {
  id: string;
  /** Server-issued tool call id, used to match the eventual tool_result. */
  toolId: string;
  name: string;
  input?: unknown;
  output?: string;
  isError?: boolean;
  status: 'running' | 'done' | 'error';
};

/** One row in the transcript. Tool calls coalesce into a `steps` block, plain
 *  assistant prose lives in `text`, and the user side is just a bubble. */
type ChatMessage =
  | { id: string; role: 'user'; kind: 'text'; text: string }
  | { id: string; role: 'assistant'; kind: 'text'; text: string }
  | { id: string; role: 'assistant'; kind: 'steps'; steps: ToolStep[] };

type AskOption = { label: string; description?: string };
type AskQuestion = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: AskOption[];
};
type AskRequest = {
  requestId: string;
  input: { questions: AskQuestion[] } & Record<string, unknown>;
};

type PermRequest = {
  requestId: string;
  toolName: string;
  input: unknown;
};

type PendingAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'text';
  /** Images: data:image/...;base64,... — text: raw UTF-8 content. */
  data: string;
};

const TEXT_LIKE_MIME = /^(text\/|application\/(json|xml|javascript|typescript|x-yaml|yaml))/;
const TEXT_LIKE_EXT = /\.(md|txt|json|ya?ml|csv|tsv|log|html?|css|js|ts|tsx|jsx|py|sh|toml|ini|env|jsonl)$/i;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const ALLOWED_TOOLS_STORAGE_KEY = 'beyond.allowed-tools';
const BYPASS_PERMISSIONS_STORAGE_KEY = 'beyond.bypass-permissions';
const MODEL_STORAGE_KEY = 'beyond.model';

/** Reads persisted allow rules: exact tool names + `mcp__server__*` prefixes. */
function readAllowedTools(): string[] {
  try {
    const raw = localStorage.getItem(ALLOWED_TOOLS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function persistAllowedTools(entries: string[]): void {
  try {
    localStorage.setItem(ALLOWED_TOOLS_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
}

/** Match an allow entry against an actual tool name. Supports exact match
 *  and trailing-`*` wildcards (e.g. `mcp__waha__*`). */
function matchAllowEntry(entry: string, toolName: string): boolean {
  if (entry === toolName) return true;
  if (entry.endsWith('*')) return toolName.startsWith(entry.slice(0, -1));
  return false;
}

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

const QUICK_ACTIONS = ['Action items', 'Brief', 'Sync'];

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export default function BeyondChat({ client, initialPrompt, sessionOverride }: Props) {
  const { sendMessage, latestMessage, isConnected, subscribeMessages } = useWebSocket();

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
  const [tokenBudget, setTokenBudget] = useState<{
    used: number;
    total: number;
    autoCompactThreshold?: number | null;
    isAutoCompactEnabled?: boolean;
  } | null>(null);

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
        setMessages(rebuildHistory(data.messages || []));
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
  useEffect(() => {
    if (!latestMessage) return;
    const m = latestMessage as Record<string, unknown>;
    const kind = String(m.kind ?? '');
    if (!kind) return;

    // Handled synchronously in the subscription above (immune to batching).
    if (kind === 'session_created') return;

    // Drop anything that isn't for the session this chat is showing.
    if (!belongsToThisChat(m)) return;

    if (kind === 'stream_delta') {
      const text = (m.content as string | undefined) || '';
      if (!text) return;
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
      // A whole-message text block ends any streaming bubble.
      streamBubbleIdRef.current = null;
      setStreamingId(null);
      setMessages((prev) => [...prev, { id: uid(), role: 'assistant', kind: 'text', text }]);
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
      streamBubbleIdRef.current = null;
      setStreamingId(null);
      const err = (m.content as string | undefined) || 'Hm, něco se rozbilo. Zkusíme znovu?';
      setMessages((prev) => [...prev, { id: uid(), role: 'assistant', kind: 'text', text: err }]);
      return;
    }
  }, [client.slug, latestMessage, belongsToThisChat, reloadHistory]);

  // ── Recovery after a dropped socket / backgrounded tab ────────────────────
  // The server now keeps a streaming turn alive across WS drops (grace window)
  // and re-attaches on reconnect. These control messages ride `latestMessage`
  // with a `type` (no `kind`), so the main stream effect ignores them.
  useEffect(() => {
    const m = latestMessage as Record<string, unknown> | null;
    if (!m) return;

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
  }, [latestMessage, sendMessage, reloadHistory]);

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
          projectPath: BRAIN_PROJECT_PATH,
          cwd: BRAIN_PROJECT_PATH,
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
        cwd: BRAIN_PROJECT_PATH,
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
    projectPath: BRAIN_PROJECT_PATH,
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
            <BeyondSessionsMenu
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
            {thinking && !askRequest && !permRequest && (
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
                <BeyondThinkingStates />
              </motion.div>
            )}
          </AnimatePresence>

          {askRequest && (
            <BeyondAskPanel
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
            <BeyondWhatsAppActionCard
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
              <BeyondPermissionPanel request={permRequest} onDecision={handlePermDecision} />
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
          <BeyondPermissionsSheet
            entries={allowedTools}
            onRemove={removeAllow}
            onClose={() => setPermsOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function MessageBlock({ message, streaming = false }: { message: ChatMessage; streaming?: boolean }) {
  const variants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0 },
  };
  // 100ms fade-up per VISION.md — subtle, not flashy.
  const transition = { duration: 0.18, ease: 'easeOut' as const };

  if (message.role === 'user') {
    return (
      <motion.div
        initial="hidden"
        animate="show"
        variants={variants}
        transition={transition}
        className="bb-user"
      >
        <div className="bb-user__col">
          <div className="bb-bubble min-w-0">
            <p className="whitespace-pre-line break-words">{message.text}</p>
          </div>
        </div>
      </motion.div>
    );
  }

  if (message.kind === 'steps') {
    return (
      <motion.div
        initial="hidden"
        animate="show"
        variants={variants}
        transition={transition}
      >
        <StepList steps={message.steps} />
      </motion.div>
    );
  }

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={variants}
      transition={transition}
      className="beyond-prose flex gap-2.5 min-w-0 break-words text-[15px] leading-relaxed text-beyond-ink [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li]:pl-1 [&_li>ul]:my-1 [&_li>ol]:my-1 [&_strong]:font-semibold [&_em]:italic [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-[18px] [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h4]:mb-1 [&_h4]:mt-3 [&_h4]:text-[14px] [&_h4]:font-semibold [&_hr]:my-4 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-black/10 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-black/15 [&_blockquote]:pl-3 [&_blockquote]:text-beyond-dim [&_thead]:bg-black/[0.025] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[12.5px] [&_th]:font-semibold [&_th]:text-beyond-dim [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:border-t [&_td]:border-black/[0.06] [&_td]:text-[14px]"
    >
      <BeyondBrainMark size={42} animate="in" className="mt-[2px] shrink-0 text-beyond-dim" title="Beyond" />
      <div className="min-w-0 flex-1">
      {streaming ? (
        <StreamingText text={message.text} />
      ) : (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBeyondFilePaths]}
        // react-markdown sanitises hrefs to a safe-protocol allowlist, which
        // strips our custom `beyondfile:` scheme (→ empty href → navigates to
        // the app root). Preserve our scheme; delegate everything else to the
        // default sanitiser.
        urlTransform={(url) =>
          url.startsWith(BEYOND_FILE_SCHEME) ? url : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, children, ...rest }) => {
            const filePath = parseBeyondFileHref(href);
            if (filePath) {
              // A bare file path the agent mentioned — open the preview sheet
              // instead of navigating away.
              return (
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent('beyond:open-file', { detail: { path: filePath } }),
                    )
                  }
                  title={`Otevřít ${filePath}`}
                  className="bb-fileref inline rounded px-1 py-0.5 font-mono text-[0.85em] underline underline-offset-2 transition-colors"
                >
                  {children}
                </button>
              );
            }
            return (
              <a
                {...rest}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-beyond-ink underline decoration-black/20 underline-offset-2 hover:decoration-black/50"
              >
                {children}
              </a>
            );
          },
          code: ({ className, children }) => {
            const raw = String(children ?? '');
            const isBlock = /\n/.test(raw);
            if (isBlock) {
              return <BeyondCodeBlock code={raw.replace(/\n$/, '')} className={className} />;
            }
            return (
              <code className="bb-inlinecode rounded-md px-1.5 py-0.5 font-mono text-[0.9em]">
                {children}
              </code>
            );
          },
          // GFM tables — wrap in a rounded, horizontally-scrollable card so wide
          // tables never blow out the chat column.
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-[12px] border border-black/[0.07]">
              <table className="w-full border-collapse text-left">{children}</table>
            </div>
          ),
        }}
      >
        {message.text}
      </ReactMarkdown>
      )}
      </div>
    </motion.div>
  );
}

function StepList({ steps }: { steps: ToolStep[] }) {
  return (
    <div className="relative flex flex-col gap-2">
      {steps.map((step, idx) => (
        <StepRow key={step.id} step={step} isLast={idx === steps.length - 1} />
      ))}
    </div>
  );
}

function StepRow({ step, isLast }: { step: ToolStep; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { label, detail } = describeTool(step.name, step.input);
  const Icon = iconForTool(step.name);
  const expandable = Boolean(step.output) || Boolean(step.input);

  return (
    <div className="relative flex gap-3">
      {/* Vertical connector — drawn through the icon column. */}
      {!isLast && (
        <span
          aria-hidden
          className="bb-step-line absolute left-[11px] top-7 h-[calc(100%-12px)] w-px"
        />
      )}

      {/* Icon badge */}
      <div className="bb-step-badge relative z-10 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-beyond-dim">
        <Icon className="h-[14px] w-[14px]" strokeWidth={1.8} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <button
          type="button"
          onClick={() => expandable && setExpanded((v) => !v)}
          className={`group flex w-full items-center gap-1.5 text-left text-[14px] ${expandable ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <span className="font-medium text-beyond-ink">{label}</span>
          {detail && (
            <span className="truncate text-beyond-faint">{detail}</span>
          )}
          {step.status === 'running' && (
            <span className="beyond-dot ml-1" aria-hidden />
          )}
          {expandable && (
            <ChevronRight
              className={`ml-auto h-[14px] w-[14px] flex-shrink-0 text-beyond-faint transition-transform ${expanded ? 'rotate-90' : ''}`}
              strokeWidth={1.8}
            />
          )}
        </button>

        <AnimatePresence initial={false}>
          {expanded && expandable && (
            <motion.div
              key="expand"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="mt-2 space-y-2">
                {step.input != null && (
                  <PreBlock label="Vstup" content={formatInput(step.input)} />
                )}
                {step.output && (
                  <PreBlock
                    label={step.isError ? 'Chyba' : 'Výstup'}
                    content={step.output}
                    tone={step.isError ? 'error' : 'default'}
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function PreBlock({
  label,
  content,
  tone = 'default',
}: {
  label: string;
  content: string;
  tone?: 'default' | 'error';
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-beyond-faint">{label}</p>
      <pre
        className={`max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] px-3 py-2 font-mono text-[12px] leading-relaxed ${tone === 'error' ? 'bb-pre--error' : 'bb-pre'}`}
      >
        {content}
      </pre>
    </div>
  );
}

function describeTool(name: string, input: unknown): { label: string; detail: string } {
  const inp = (input && typeof input === 'object' ? (input as Record<string, unknown>) : {}) || {};
  const path = typeof inp.file_path === 'string' ? inp.file_path : typeof inp.path === 'string' ? inp.path : '';
  const command = typeof inp.command === 'string' ? inp.command : '';
  const pattern = typeof inp.pattern === 'string' ? inp.pattern : '';
  const url = typeof inp.url === 'string' ? inp.url : '';
  const query = typeof inp.query === 'string' ? inp.query : '';

  switch (name) {
    case 'Read':
      return { label: 'Read', detail: shortenPath(path) };
    case 'Write':
      return { label: 'Write', detail: shortenPath(path) };
    case 'Edit':
    case 'MultiEdit':
      return { label: 'Edit', detail: shortenPath(path) };
    case 'Bash':
      return { label: 'Bash', detail: command.split('\n')[0].slice(0, 80) };
    case 'Grep':
      return { label: 'Grep', detail: pattern };
    case 'Glob':
      return { label: 'Glob', detail: pattern };
    case 'WebFetch':
      return { label: 'WebFetch', detail: url };
    case 'WebSearch':
      return { label: 'WebSearch', detail: query };
    default:
      return { label: name, detail: '' };
  }
}

function iconForTool(name: string) {
  if (name === 'Read') return FileText;
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') return FilePen;
  if (name === 'Bash') return Terminal;
  if (name === 'Grep' || name === 'Glob') return Search;
  if (name === 'WebFetch' || name === 'WebSearch') return Globe;
  if (name === 'AskUserQuestion') return MessageCircle;
  return Wrench;
}

function formatInput(input: unknown): string {
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function quickPrompt(label: string, clientName: string): string {
  switch (label) {
    case 'Action items':
      return `Ukaž otevřené action items u ${clientName}.`;
    case 'Brief':
      return `Připrav krátký brief na další call s ${clientName}.`;
    case 'Sync':
      return `Spusť sync ${clientName} z Notion do brainu.`;
    default:
      return label;
  }
}

/* ------------------------------------------------------------------ */
/* defensive helpers for variable-shape backend payloads               */
/* ------------------------------------------------------------------ */

function appendAssistantTextById(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  id: string,
  text: string,
): void {
  setMessages((prev) => {
    const last = prev[prev.length - 1];
    // Append into the streaming bubble (matched by its stable id) so the caller
    // can key the word-by-word cross-blur render off that same id. A tool-step
    // block resets the id upstream, so a fresh bubble appears below the steps.
    if (last && last.id === id && last.role === 'assistant' && last.kind === 'text') {
      return [...prev.slice(0, -1), { ...last, text: last.text + text }];
    }
    return [...prev, { id, role: 'assistant', kind: 'text', text }];
  });
}

/** Turn a sequence of stored NormalizedMessages into our local ChatMessage[]. */
function rebuildHistory(raw: unknown[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const m = entry as Record<string, unknown>;
    const kind = String(m.kind ?? '');
    const role = (m.role as string | undefined) || undefined;
    const content = (m.content as string | undefined) || '';

    if (kind === 'text' && role === 'user' && content) {
      out.push({ id: uid(), role: 'user', kind: 'text', text: content });
    } else if (kind === 'text' && role === 'assistant' && content) {
      out.push({ id: uid(), role: 'assistant', kind: 'text', text: content });
    } else if (kind === 'tool_use' && m.toolName) {
      const toolResult = m.toolResult as
        | { content?: string; isError?: boolean }
        | undefined;
      const step: ToolStep = {
        id: uid(),
        toolId: String(m.toolId ?? uid()),
        name: String(m.toolName),
        input: m.toolInput,
        output: toolResult?.content,
        isError: toolResult?.isError,
        status: toolResult ? (toolResult.isError ? 'error' : 'done') : 'done',
      };
      const last = out[out.length - 1];
      if (last && last.role === 'assistant' && last.kind === 'steps') {
        out[out.length - 1] = { ...last, steps: [...last.steps, step] };
      } else {
        out.push({ id: uid(), role: 'assistant', kind: 'steps', steps: [step] });
      }
    }
  }
  return out;
}

function appendStep(prev: ChatMessage[], step: ToolStep): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last && last.role === 'assistant' && last.kind === 'steps') {
    return [...prev.slice(0, -1), { ...last, steps: [...last.steps, step] }];
  }
  return [...prev, { id: uid(), role: 'assistant', kind: 'steps', steps: [step] }];
}

function updateStep(
  prev: ChatMessage[],
  toolId: string,
  output: string,
  isError: boolean,
): ChatMessage[] {
  return prev.map((msg) => {
    if (msg.role !== 'assistant' || msg.kind !== 'steps') return msg;
    let touched = false;
    const nextSteps = msg.steps.map((s) => {
      if (s.toolId !== toolId) return s;
      touched = true;
      return { ...s, output, isError, status: isError ? ('error' as const) : ('done' as const) };
    });
    return touched ? { ...msg, steps: nextSteps } : msg;
  });
}

function shortenPath(p?: string): string {
  if (!p) return '';
  const parts = p.split('/');
  return parts.slice(-2).join('/');
}

/** Compact context-usage chip in the composer footer. Shows the live size of
 *  Claude's current context window (re-sent every turn), not cumulative spend.
 *  Color thresholds key off the SDK's `autoCompactThreshold` when available so
 *  the user sees red exactly when auto-compact is about to fire. */
/** Compact dropdown to pick the Anthropic model used for this chat. Options
 *  carry version-bearing names pulled from the installed Claude Code. */
function ModelPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: BeyondModelOption[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open]);

  const current = options.find((o) => o.value === value);
  const chipLabel = current?.short || value;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Vybrat Claude model"
        aria-expanded={open}
        className="bb-modelbtn"
      >
        <Sparkles className="h-[13px] w-[13px]" strokeWidth={1.8} style={{ color: 'var(--bb-ink2)' }} />
        {chipLabel}
        <ChevronDown
          className={`h-[13px] w-[13px] transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={1.8}
          style={{ color: 'var(--bb-ink2)' }}
        />
      </button>
      {open && (
        <div
          className="bb-glass absolute bottom-full right-0 z-20 mb-2 max-h-[280px] min-w-[240px] overflow-y-auto rounded-[14px] p-1.5"
          style={{ boxShadow: 'var(--bb-shadow-pop), inset 0 1px 0 0 var(--bb-rim)' }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className="flex w-full items-start justify-between gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--bb-panel2)]"
              style={o.value === value ? { background: 'var(--bb-accent-soft)' } : undefined}
            >
              <span className="min-w-0">
                <span
                  className={`block text-[12.5px] ${
                    o.value === value ? 'font-medium text-beyond-ink' : 'text-beyond-ink'
                  }`}
                >
                  {o.short}
                </span>
                {o.description && (
                  <span className="block truncate text-[11px] text-beyond-faint">
                    {o.description}
                  </span>
                )}
              </span>
              {o.value === value && (
                <Check className="mt-0.5 h-[13px] w-[13px] flex-shrink-0 text-beyond-ink" strokeWidth={2} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TokenBudgetChip({
  budget,
}: {
  budget: {
    used: number;
    total: number;
    autoCompactThreshold?: number | null;
    isAutoCompactEnabled?: boolean;
  } | null;
}) {
  // Always render — user wants the chip visible from the moment the chat opens,
  // even before the first turn (or before a resumed session's backfill arrives).
  if (!budget || budget.total <= 0) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] text-beyond-faint"
        title="Kontext zatím prázdný — počká na první odpověď"
      >
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-neutral-300" aria-hidden />
        <span>—</span>
      </div>
    );
  }
  const pct = Math.min(100, (budget.used / budget.total) * 100);
  // If the SDK gave us a real auto-compact threshold use it; otherwise pick
  // sensible defaults (50 % blue, 75 % amber, beyond red).
  const compactPct = budget.autoCompactThreshold
    ? (budget.autoCompactThreshold / budget.total) * 100
    : null;
  const color = compactPct
    ? pct < compactPct * 0.7
      ? 'bg-blue-500'
      : pct < compactPct
        ? 'bg-amber-500'
        : 'bg-red-500'
    : pct < 50
      ? 'bg-blue-500'
      : pct < 75
        ? 'bg-amber-500'
        : 'bg-red-500';
  const usedK = budget.used >= 1000 ? `${(budget.used / 1000).toFixed(1)}k` : `${budget.used}`;
  // Render very large totals (Opus 4.7's 1M window) as "1M" instead of "1000k".
  const totalK = budget.total >= 1_000_000
    ? `${(budget.total / 1_000_000).toFixed(budget.total % 1_000_000 === 0 ? 0 : 1)}M`
    : `${Math.round(budget.total / 1000)}k`;
  const tooltipLines = [
    `${budget.used.toLocaleString()} / ${budget.total.toLocaleString()} tokenů v kontextu`,
  ];
  if (budget.autoCompactThreshold) {
    tooltipLines.push(`Auto-compact při ${budget.autoCompactThreshold.toLocaleString()} tokenech`);
  }
  if (budget.isAutoCompactEnabled === false) {
    tooltipLines.push('Auto-compact je vypnutý');
  }
  return (
    <div
      className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] text-beyond-faint"
      title={tooltipLines.join('\n')}
    >
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${color}`} aria-hidden />
      <span>{pct.toFixed(0)} % · {usedK} / {totalK}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AskUserQuestion — interactive panel in Beyond style                 */
/* ------------------------------------------------------------------ */

function BeyondAskPanel({
  request,
  onAnswer,
  onSkip,
}: {
  request: AskRequest;
  onAnswer: (answers: Record<string, string>) => void;
  onSkip: () => void;
}) {
  const questions = request.input.questions || [];
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});

  if (questions.length === 0) return null;

  const toggle = (qIdx: number, label: string, multi: boolean) => {
    setSelections((prev) => {
      const current = new Set(prev[qIdx] || []);
      if (multi) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
      }
      return { ...prev, [qIdx]: current };
    });
  };

  const setCustom = (qIdx: number, value: string) => {
    setCustomAnswers((prev) => ({ ...prev, [qIdx]: value }));
  };

  // Submittable when, for every question, the user has either picked an
  // option or typed a custom answer (or both — they're combined on submit).
  const canSubmit = questions.every((_, idx) => {
    const hasPick = (selections[idx]?.size ?? 0) > 0;
    const hasCustom = (customAnswers[idx] || '').trim().length > 0;
    return hasPick || hasCustom;
  });

  const submit = () => {
    const answers: Record<string, string> = {};
    questions.forEach((q, idx) => {
      const picks = Array.from(selections[idx] || []);
      const custom = (customAnswers[idx] || '').trim();
      // Merge picks + custom into a single answer string the agent can read.
      // Mirrors how Claude Code's CLI surfaces the "Other" answer: the custom
      // free-text is the source of truth when present, optionally annotated
      // with which preset options the user also flagged.
      let value = '';
      if (picks.length > 0 && custom) {
        value = `${picks.join(', ')} — ${custom}`;
      } else if (picks.length > 0) {
        value = picks.join(', ');
      } else if (custom) {
        value = custom;
      }
      if (value) answers[q.question] = value;
    });
    onAnswer(answers);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="bb-card overflow-hidden rounded-2xl"
    >
      <div className="bb-vdivide flex flex-col">
        {questions.map((q, qIdx) => {
          const multi = Boolean(q.multiSelect);
          const selected = selections[qIdx] || new Set<string>();
          return (
            <div key={qIdx} className="px-5 py-4">
              <div className="mb-3 flex items-center gap-2">
                {q.header && (
                  <span className="bb-chip rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide">
                    {q.header}
                  </span>
                )}
                {multi && (
                  <span className="text-[11px] text-beyond-faint">Více možností</span>
                )}
              </div>
              <p className="mb-3 text-[15px] font-medium leading-snug text-beyond-ink">
                {q.question}
              </p>
              <div className="flex flex-col gap-1.5">
                {q.options.map((opt) => {
                  const isOn = selected.has(opt.label);
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => toggle(qIdx, opt.label, multi)}
                      data-on={isOn ? 'true' : 'false'}
                      className="bb-optcard group flex w-full items-start gap-3 rounded-[14px] px-3.5 py-2.5 text-left"
                    >
                      <span
                        data-on={isOn ? 'true' : 'false'}
                        className="bb-radio mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full transition-colors"
                      >
                        {isOn && <span className="bb-radio__dot h-1.5 w-1.5 rounded-full" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium leading-tight text-beyond-ink">
                          {opt.label}
                        </span>
                        {opt.description && (
                          <span className="mt-0.5 block text-[12px] leading-snug text-beyond-faint">
                            {opt.description}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2.5">
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-beyond-faint">
                  {selected.size > 0 ? 'Doplnit vlastními slovy' : 'Nebo napsat vlastní odpověď'}
                </label>
                <textarea
                  value={customAnswers[qIdx] || ''}
                  onChange={(e) => setCustom(qIdx, e.target.value)}
                  onKeyDown={(e) => {
                    // Cmd/Ctrl+Enter from inside the textarea submits the whole
                    // panel — same shortcut as the main chat composer.
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="Napiš odpověď přesně tak, jak ji chceš…"
                  rows={2}
                  className="bb-field w-full resize-y rounded-[14px] px-3.5 py-2.5 text-[14px] leading-snug"
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2 bb-card__foot px-5 py-3">
        <button
          type="button"
          onClick={onSkip}
          className="rounded-full px-3 py-1.5 text-[12px] bb-btn-ghost transition-colors"
        >
          Přeskočit
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="bb-btn-primary rounded-full px-4 py-1.5 text-[12px] font-medium"
        >
          Odeslat
        </button>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Generic permission request — Allow / Always / Deny                 */
/* ------------------------------------------------------------------ */

function BeyondPermissionPanel({
  request,
  onDecision,
}: {
  request: PermRequest;
  onDecision: (
    decision:
      | { kind: 'allow-once' }
      | { kind: 'always-allow'; entry: string }
      | { kind: 'deny' },
  ) => void;
}) {
  const { toolName, input } = request;
  const { label, detail } = describeTool(toolName, input);
  const Icon = iconForTool(toolName);

  // Suggest a sensible "always allow" scope. For MCP tools we offer the whole
  // server (`mcp__server__*`), otherwise just the exact tool name.
  const mcpMatch = toolName.match(/^mcp__([^_]+)__/);
  const alwaysScope = mcpMatch ? `mcp__${mcpMatch[1]}__*` : toolName;
  const alwaysScopeLabel = mcpMatch ? `všechny ${mcpMatch[1]} tooly` : toolName;

  const inputPreview = (() => {
    if (input == null) return '';
    if (typeof input === 'string') return input;
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="bb-card overflow-hidden rounded-2xl"
    >
      <div className="px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="bb-chip rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide">
            Povolení
          </span>
          <span className="text-[11px] text-beyond-faint">Agent chce použít nástroj</span>
        </div>

        <div className="mb-3 flex items-center gap-2.5">
          <div className="bb-step-badge flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-beyond-dim">
            <Icon className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-beyond-ink">{label}</p>
            {detail && (
              <p className="truncate text-[12px] text-beyond-faint">{detail}</p>
            )}
          </div>
        </div>

        {inputPreview && (
          <details className="mb-1 text-[12px] text-beyond-faint">
            <summary className="cursor-pointer select-none text-beyond-dim hover:text-beyond-ink">
              Detaily volání
            </summary>
            <pre className="bb-pre mt-2 max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] px-3 py-2 font-mono text-[11px] leading-relaxed">
              {inputPreview}
            </pre>
          </details>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 bb-card__foot px-5 py-3">
        <button
          type="button"
          onClick={() => onDecision({ kind: 'deny' })}
          className="rounded-full px-3 py-1.5 text-[12px] bb-btn-ghost transition-colors"
        >
          Odmítnout
        </button>
        <button
          type="button"
          onClick={() => onDecision({ kind: 'allow-once' })}
          className="bb-btn-soft rounded-full px-3.5 py-1.5 text-[12px] font-medium"
        >
          Jednou
        </button>
        <button
          type="button"
          onClick={() => onDecision({ kind: 'always-allow', entry: alwaysScope })}
          className="bb-btn-primary rounded-full px-3.5 py-1.5 text-[12px] font-medium"
          title={`Při dalším volání automaticky povolit ${alwaysScopeLabel}`}
        >
          Vždy povolit {mcpMatch ? `(${alwaysScopeLabel})` : ''}
        </button>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Permissions sheet — list + revoke saved allowlist entries          */
/* ------------------------------------------------------------------ */

function BeyondPermissionsSheet({
  entries,
  onRemove,
  onClose,
}: {
  entries: string[];
  onRemove: (entry: string) => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className="bb-card w-full max-w-[480px] overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--bb-line2)' }}>
          <h3 className="text-[15px] font-medium text-beyond-ink">Povolené nástroje</h3>
          <p className="mt-0.5 text-[12px] text-beyond-faint">
            Agent může používat tyto nástroje bez ptaní. Hvězdička (`*`) značí celý MCP server.
          </p>
        </div>

        <div className="max-h-[360px] overflow-y-auto px-3 py-2">
          {entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-beyond-faint">
              Žádné uložené povolení. Když agent zažádá o nástroj, vyber „Vždy povolit".
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {entries.map((entry) => (
                <li
                  key={entry}
                  className="group flex items-center gap-2 rounded-[12px] px-3 py-2 hover:bg-black/[0.03]"
                >
                  <code className="flex-1 truncate font-mono text-[12.5px] text-beyond-ink">
                    {entry}
                  </code>
                  <button
                    type="button"
                    onClick={() => onRemove(entry)}
                    title="Odebrat"
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                  >
                    <Trash2 className="h-[14px] w-[14px]" strokeWidth={1.8} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bb-card__foot flex items-center justify-end gap-2 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="bb-btn-soft rounded-full px-3.5 py-1.5 text-[12px] font-medium"
          >
            Hotovo
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Composer attachment chip                                            */
/* ------------------------------------------------------------------ */

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  const kb = Math.max(1, Math.round(attachment.size / 1024));
  if (attachment.kind === 'image') {
    return (
      <div className="group relative flex items-center gap-2 rounded-xl bg-black/[0.04] py-1 pl-1 pr-2">
        <img
          src={attachment.data}
          alt={attachment.name}
          className="h-9 w-9 flex-shrink-0 rounded-lg object-cover"
        />
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-beyond-ink">{attachment.name}</p>
          <p className="text-[10px] text-beyond-faint">{kb} kB</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-black/[0.08] hover:text-beyond-ink"
          aria-label="Odebrat"
        >
          <X className="h-[12px] w-[12px]" strokeWidth={2} />
        </button>
      </div>
    );
  }
  return (
    <div className="group relative flex items-center gap-2 rounded-xl bg-black/[0.04] px-2 py-1.5">
      <FileIcon
        className="h-[14px] w-[14px] flex-shrink-0 text-beyond-faint"
        strokeWidth={1.8}
      />
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-beyond-ink">{attachment.name}</p>
        <p className="text-[10px] text-beyond-faint">{kb} kB · text</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-black/[0.08] hover:text-beyond-ink"
        aria-label="Odebrat"
      >
        <X className="h-[12px] w-[12px]" strokeWidth={2} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* WhatsApp send action card — preview + edit + send                  */
/* ------------------------------------------------------------------ */

function isWhatsAppSendTool(name: string): boolean {
  return (
    name === 'mcp__waha__send-text' ||
    name === 'mcp__waha__send-image' ||
    name === 'mcp__waha__send-file'
  );
}

function BeyondWhatsAppActionCard({
  request,
  onSend,
  onCancel,
}: {
  request: PermRequest;
  onSend: (updatedInput: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const original = (request.input || {}) as Record<string, unknown>;
  const chatId = typeof original.chatId === 'string' ? original.chatId : '';
  const isText = request.toolName === 'mcp__waha__send-text';
  const initialText = typeof original.text === 'string'
    ? original.text
    : typeof original.caption === 'string'
      ? original.caption
      : '';

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initialText);

  const chatLabel = chatId
    ? chatId.replace(/@c\.us$/, '').replace(/@g\.us$/, ' (skupina)')
    : 'WhatsApp';

  const handleSend = () => {
    const updated: Record<string, unknown> = { ...original };
    if (isText) updated.text = text;
    else if ('caption' in original) updated.caption = text;
    onSend(updated);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="bb-card overflow-hidden rounded-2xl"
    >
      <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50/60 px-5 py-3">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700">
          <MessageCircle className="h-[15px] w-[15px]" strokeWidth={1.9} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium uppercase tracking-wide text-emerald-700">
            WhatsApp · {isText ? 'zpráva' : request.toolName.replace('mcp__waha__send-', '')}
          </p>
          <p className="truncate text-[12px] text-beyond-faint">
            Pro: <span className="text-beyond-dim">{chatLabel}</span>
          </p>
        </div>
      </div>

      <div className="px-5 py-4">
        {editing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.max(3, text.split('\n').length)}
            className="bb-field w-full resize-none rounded-[14px] px-3 py-2 text-[14px] leading-relaxed"
            autoFocus
          />
        ) : (
          <div className="rounded-[18px] rounded-bl-[6px] bg-emerald-50 px-4 py-3">
            <p className="whitespace-pre-line text-[14px] leading-relaxed text-beyond-ink">
              {text || <span className="italic text-beyond-faint">(prázdné)</span>}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 bb-card__foot px-5 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3 py-1.5 text-[12px] bb-btn-ghost transition-colors"
        >
          Zrušit
        </button>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="bb-btn-soft rounded-full px-3.5 py-1.5 text-[12px] font-medium"
        >
          {editing ? 'Hotovo' : 'Upravit'}
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={!text.trim()}
          className="rounded-full bg-emerald-500 px-4 py-1.5 text-[12px] font-medium text-white shadow-[0_2px_8px_-2px_rgba(16,185,129,0.4)] transition-all hover:bg-emerald-600 hover:shadow-[0_4px_12px_-2px_rgba(16,185,129,0.5)] disabled:bg-black/[0.08] disabled:text-black/30 disabled:shadow-none"
        >
          Odeslat
        </button>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-client sessions dropdown                                        */
/* ------------------------------------------------------------------ */

function BeyondSessionsMenu({
  sessions,
  activeUuid,
  onPick,
  onDelete,
  onNew,
  onClose,
}: {
  sessions: BeyondSession[];
  activeUuid: string | null;
  onPick: (uuid: string) => void;
  onDelete: (uuid: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-30"
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.98 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className="bb-glass absolute left-3 right-3 top-full z-40 mt-2 overflow-hidden rounded-2xl"
        style={{ boxShadow: 'var(--bb-shadow-pop), inset 0 1px 0 0 var(--bb-rim)' }}
      >
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-[var(--bb-panel2)]"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: 'var(--bb-accent)', color: 'var(--bb-on-accent)' }}>
            <Plus className="h-[14px] w-[14px]" strokeWidth={2} />
          </div>
          <span className="text-[13px] font-medium text-beyond-ink">Nový chat</span>
        </button>

        <div className="max-h-[60vh] overflow-y-auto" style={{ borderTop: '1px solid var(--bb-line2)' }}>
          {sessions.length === 0 ? (
            <p className="px-4 py-4 text-[12px] text-beyond-faint">
              Žádné dřívější chaty.
            </p>
          ) : (
            <div className="flex flex-col py-1">
              <p className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-beyond-faint">
                Historie ({sessions.length})
              </p>
              {sessions.map((s) => {
                const active = s.uuid === activeUuid;
                return (
                  <div
                    key={s.uuid}
                    className={`group flex items-start gap-2 px-3 py-2 transition-colors ${active ? 'bg-black/[0.03]' : 'hover:bg-black/[0.025]'}`}
                  >
                    <button
                      type="button"
                      onClick={() => onPick(s.uuid)}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    >
                      <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center text-beyond-faint">
                        {active ? (
                          <Check className="h-[12px] w-[12px] text-beyond-ink" strokeWidth={2.2} />
                        ) : (
                          <MessagesSquare className="h-[12px] w-[12px]" strokeWidth={1.8} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`truncate text-[13px] leading-tight ${active ? 'font-medium text-beyond-ink' : 'text-beyond-dim'}`}
                        >
                          {s.title}
                        </p>
                        <p className="mt-0.5 text-[10px] text-beyond-faint">
                          {relativeTime(s.lastUsedAt)}
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Smazat chat „${s.title}" z indexu?\n(transkript na disku zůstane.)`)) {
                          onDelete(s.uuid);
                        }
                      }}
                      title="Odebrat z indexu"
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                    >
                      <Trash2 className="h-[12px] w-[12px]" strokeWidth={1.8} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
