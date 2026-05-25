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
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import BeyondGlyph from './BeyondGlyph';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { authenticatedFetch } from '../../utils/api';

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

const BRAIN_PROJECT_PATH = '/Users/stepankakes/Documents/GitHub/beyond-brain';

function sessionStorageKey(slug: string): string {
  return `beyond.session.${slug}`;
}

function sessionsStorageKey(slug: string): string {
  return `beyond.sessions.${slug}`;
}

type BeyondSession = {
  uuid: string;
  title: string;
  lastUsedAt: number;
};

function readSessions(slug: string): BeyondSession[] {
  try {
    const raw = localStorage.getItem(sessionsStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s): s is BeyondSession =>
          !!s && typeof s === 'object' &&
          typeof (s as BeyondSession).uuid === 'string' &&
          typeof (s as BeyondSession).title === 'string' &&
          typeof (s as BeyondSession).lastUsedAt === 'number',
      )
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  } catch {
    return [];
  }
}

function writeSessions(slug: string, sessions: BeyondSession[]): void {
  try {
    localStorage.setItem(sessionsStorageKey(slug), JSON.stringify(sessions));
  } catch {
    /* ignore */
  }
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
};

const QUICK_ACTIONS = ['Action items', 'Brief', 'Sync'];

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export default function BeyondChat({ client, initialPrompt }: Props) {
  const { sendMessage, latestMessage, isConnected } = useWebSocket();

  // Claude Agent SDK session UUID for this client. Loaded from localStorage on
  // mount; updated whenever the server emits `session_created`. We only pass
  // `resume: true` once we actually have a UUID — otherwise the SDK tries to
  // resume a non-existent transcript and silently hangs.
  const sessionIdRef = useRef<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
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
  const [permsOpen, setPermsOpen] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Per-client sessions index (localStorage). The transcripts themselves live
  // on disk under ~/.claude/projects/<cwd-hash>/<uuid>.jsonl — we just keep
  // track of which UUIDs belong to this client + a human-readable title.
  const [sessions, setSessions] = useState<BeyondSession[]>(() => readSessions(client.slug));
  const [sessionsOpen, setSessionsOpen] = useState(false);
  // When a fresh chat is started we remember the next user prompt so we can
  // title the new session as soon as the server emits session_created.
  const pendingTitleRef = useRef<string | null>(null);

  const activeSession = sessions.find((s) => s.uuid === sessionIdRef.current);

  const startNewSession = useCallback(() => {
    // Drop the current uuid + transcript; the next send() will spawn a fresh
    // SDK session and capture its new UUID via session_created.
    try {
      localStorage.removeItem(sessionStorageKey(client.slug));
    } catch {
      /* ignore */
    }
    sessionIdRef.current = null;
    setMessages([]);
    setThinking(false);
    setAskRequest(null);
    setPermRequest(null);
    setSessionsOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [client.slug]);

  const switchToSession = useCallback(
    (uuid: string) => {
      if (sessionIdRef.current === uuid) {
        setSessionsOpen(false);
        return;
      }
      sessionIdRef.current = uuid;
      try {
        localStorage.setItem(sessionStorageKey(client.slug), uuid);
      } catch {
        /* ignore */
      }
      setMessages([]);
      setThinking(false);
      setAskRequest(null);
      setPermRequest(null);
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

      // Bump lastUsedAt to top of list.
      setSessions((prev) => {
        const next = prev.map((s) =>
          s.uuid === uuid ? { ...s, lastUsedAt: Date.now() } : s,
        );
        writeSessions(client.slug, next);
        return next;
      });
    },
    [client.slug],
  );

  const deleteSession = useCallback(
    (uuid: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.uuid !== uuid);
        writeSessions(client.slug, next);
        return next;
      });
      if (sessionIdRef.current === uuid) {
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

  // Load persisted session id + history when switching clients. Claude Code
  // stores the transcript as JSONL under ~/.claude/projects; claudecodeui's
  // session watcher indexes it into a sessions DB which the providers route
  // exposes at /api/providers/sessions/<uuid>/messages.
  useEffect(() => {
    let cancelled = false;
    let persisted: string | null = null;
    try {
      persisted = localStorage.getItem(sessionStorageKey(client.slug));
    } catch {
      persisted = null;
    }
    sessionIdRef.current = persisted;
    setMessages([]);
    setThinking(false);

    const existing = readSessions(client.slug);
    // Migration: when the active sessionId predates the per-client index,
    // seed it so it shows up in the dropdown after this upgrade.
    if (persisted && !existing.some((s) => s.uuid === persisted)) {
      const seeded: BeyondSession = {
        uuid: persisted,
        title: `${client.name} · původní chat`,
        lastUsedAt: Date.now(),
      };
      const merged = [seeded, ...existing];
      writeSessions(client.slug, merged);
      setSessions(merged);
    } else {
      setSessions(existing);
    }

    if (!persisted) {
      setLoadingHistory(false);
      return;
    }

    setLoadingHistory(true);
    authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(persisted)}/messages`)
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const rebuilt = rebuildHistory(data.messages || []);
        setMessages(rebuilt);
      })
      .catch(() => {
        /* watcher may not have indexed the session yet — silent */
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client.slug]);

  // Stream handler — server emits NormalizedMessage shapes with `kind`.
  useEffect(() => {
    if (!latestMessage) return;
    const m = latestMessage as Record<string, unknown>;
    const kind = String(m.kind ?? '');
    if (!kind) return;

    if (kind === 'session_created') {
      const newId =
        (m.newSessionId as string | undefined) ||
        (m.sessionId as string | undefined) ||
        null;
      if (newId) {
        sessionIdRef.current = newId;
        try {
          localStorage.setItem(sessionStorageKey(client.slug), newId);
        } catch {
          /* ignore */
        }
        const title = pendingTitleRef.current
          ? shortTitle(pendingTitleRef.current)
          : `Chat ${new Date().toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
        pendingTitleRef.current = null;
        const entry: BeyondSession = { uuid: newId, title, lastUsedAt: Date.now() };
        setSessions((prev) => {
          if (prev.some((s) => s.uuid === newId)) return prev;
          const next = [entry, ...prev];
          writeSessions(client.slug, next);
          return next;
        });
      }
      return;
    }

    if (kind === 'stream_delta') {
      const text = (m.content as string | undefined) || '';
      if (!text) return;
      appendAssistantText(setMessages, text);
      return;
    }

    if (kind === 'text') {
      // The server re-emits both user echoes and assistant text under the same
      // kind. We've already appended the user message locally on send, so only
      // accept assistant-role text here.
      if (m.role && m.role !== 'assistant') return;
      const text = (m.content as string | undefined) || '';
      if (!text) return;
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

    if (kind === 'complete') {
      setThinking(false);
      return;
    }

    if (kind === 'error') {
      setThinking(false);
      const err = (m.content as string | undefined) || 'Hm, něco se rozbilo. Zkusíme znovu?';
      setMessages((prev) => [...prev, { id: uid(), role: 'assistant', kind: 'text', text: err }]);
      return;
    }
  }, [client.slug, latestMessage]);

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

      setValue('');
      setAttachments([]);
      setThinking(true);

      // Only resume when we already have a real SDK-issued UUID. On the very
      // first turn we let the SDK assign one and pick it up via session_created.
      const resumeId = sessionIdRef.current;
      if (!resumeId) {
        // Remember the first user message so session_created can title the
        // newly minted session.
        pendingTitleRef.current = trimmed || (attachments.length > 0 ? `${attachments.length} přílohy` : 'Nový chat');
      } else {
        // Bump lastUsedAt for the active session.
        setSessions((prev) => {
          const next = prev.map((s) =>
            s.uuid === resumeId ? { ...s, lastUsedAt: Date.now() } : s,
          );
          writeSessions(client.slug, next);
          return next;
        });
      }
      sendMessage({
        type: 'claude-command',
        command: composedCommand,
        options: {
          projectPath: BRAIN_PROJECT_PATH,
          cwd: BRAIN_PROJECT_PATH,
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
      className="relative flex h-full w-full flex-col bg-[#fafafa]"
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
            className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-3xl border-2 border-dashed border-beyond-ink/30 bg-white/70 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-2 text-beyond-dim">
              <Upload className="h-6 w-6" strokeWidth={1.8} />
              <p className="text-[14px] font-medium">Pusť soubor sem</p>
              <p className="text-[12px] text-beyond-faint">Obrázky a textové soubory</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Header — floating rounded card with Beyond glyph avatar.
          Left padding leaves room for the shell's hamburger toggle (~52px). */}
      <header className="flex flex-shrink-0 items-center px-4 pb-3 pl-16 pr-4 pt-4 sm:px-6 sm:pl-20 sm:pr-6 sm:pt-5">
        <div className="relative mx-auto flex w-full max-w-[760px] items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-[0_2px_16px_-8px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04]">
          <BeyondGlyph size={28} />
          <button
            type="button"
            onClick={() => setSessionsOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            title="Seznam chatů s tímto klientem"
          >
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[14px] font-medium leading-tight text-beyond-ink">
                {client.name}
              </h2>
              <p className="truncate text-[12px] leading-tight text-beyond-faint">
                {activeSession ? activeSession.title : client.week || 'Nový chat'}
              </p>
            </div>
            <ChevronRight
              className={`h-[14px] w-[14px] flex-shrink-0 text-beyond-faint transition-transform ${sessionsOpen ? 'rotate-90' : ''}`}
              strokeWidth={1.8}
            />
          </button>
          <button
            type="button"
            onClick={startNewSession}
            title="Nový chat"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-black/[0.04] hover:text-beyond-dim"
          >
            <Plus className="h-[16px] w-[16px]" strokeWidth={1.8} />
          </button>
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
          <button
            type="button"
            onClick={() => setPermsOpen(true)}
            title="Nastavení oprávnění"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-black/[0.04] hover:text-beyond-dim"
          >
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
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors ${bypassPermissions
              ? 'bg-amber-50 text-amber-600 hover:bg-amber-100'
              : 'text-beyond-faint hover:bg-black/[0.04] hover:text-beyond-dim'}`}
          >
            {bypassPermissions ? (
              <ShieldOff className="h-[16px] w-[16px]" strokeWidth={1.8} />
            ) : (
              <Shield className="h-[16px] w-[16px]" strokeWidth={1.8} />
            )}
          </button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto flex w-full min-w-0 max-w-[760px] flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
          {messages.length === 0 && !thinking && (
            <p className="text-center text-[15px] text-beyond-faint">
              {loadingHistory ? 'Načítám historii…' : 'Tady jsem.'}
            </p>
          )}

          {messages.map((m) => (
            <MessageBlock key={m.id} message={m} />
          ))}

          <AnimatePresence>
            {thinking && !askRequest && !permRequest && (
              <motion.div
                key="thinking"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="flex items-center gap-2.5 pl-4 text-[14px] text-beyond-dim"
              >
                <span className="beyond-dot" aria-hidden="true" />
                <span>Přemýšlím</span>
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

      {/* Composer — floating rounded card. */}
      <div className="flex-shrink-0 px-4 pb-6 pt-3 sm:px-6 sm:pb-8 sm:pt-4">
        <div className="mx-auto w-full max-w-[760px]">
          <div className="rounded-[24px] bg-white px-4 py-3 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04] focus-within:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.12)] focus-within:ring-black/[0.06]">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5 pb-1">
                {attachments.map((a) => (
                  <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
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
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                tabIndex={-1}
                aria-label="Příloha"
                title="Přidat soubor (obrázek nebo text)"
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-black/[0.04] hover:text-beyond-dim"
              >
                <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(value);
                  }
                }}
                placeholder="Napiš, co řešíme…"
                rows={1}
                className="min-h-[40px] flex-1 resize-none border-0 bg-transparent py-2 text-[16px] leading-snug text-beyond-ink placeholder:text-beyond-faint focus:outline-none focus:ring-0"
              />
              {thinking ? (
                <button
                  type="button"
                  onClick={stop}
                  aria-label="Zastav"
                  title="Zastav agenta"
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-beyond-ink text-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.25)] transition-all hover:scale-105"
                >
                  <Square className="h-[14px] w-[14px] fill-current" strokeWidth={0} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => send(value)}
                  disabled={(!value.trim() && attachments.length === 0) || !isConnected}
                  aria-label="Pošli"
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-beyond-ink text-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.25)] transition-all hover:scale-105 disabled:bg-black/[0.08] disabled:text-black/30 disabled:shadow-none disabled:hover:scale-100"
                >
                  <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.2} />
                </button>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1">
              {QUICK_ACTIONS.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => send(quickPrompt(label, client.name))}
                  className="rounded-full px-3 py-1 text-[12px] text-beyond-faint transition-colors hover:bg-black/[0.04] hover:text-beyond-ink"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
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

function MessageBlock({ message }: { message: ChatMessage }) {
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
        className="flex justify-end"
      >
        <div className="max-w-[85%] min-w-0 rounded-[22px] rounded-br-[6px] bg-white px-4 py-3 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04]">
          <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-beyond-ink">
            {message.text}
          </p>
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
      className="beyond-prose min-w-0 break-words text-[15px] leading-relaxed text-beyond-ink [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_strong]:font-semibold [&_em]:italic [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-[18px] [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-[15px] [&_h3]:font-semibold"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...rest }) => (
            <a
              {...rest}
              target="_blank"
              rel="noopener noreferrer"
              className="text-beyond-ink underline decoration-black/20 underline-offset-2 hover:decoration-black/50"
            />
          ),
          code: ({ className, children, ...rest }) => {
            const isBlock = /\n/.test(String(children ?? ''));
            if (isBlock) {
              return (
                <pre className="my-2 overflow-x-auto rounded-[14px] bg-black/[0.04] px-4 py-3 text-[13px]">
                  <code className={className} {...rest}>{children}</code>
                </pre>
              );
            }
            return (
              <code className="rounded-md bg-black/[0.05] px-1.5 py-0.5 font-mono text-[0.9em] text-beyond-ink">
                {children}
              </code>
            );
          },
        }}
      >
        {message.text}
      </ReactMarkdown>
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
          className="absolute left-[11px] top-7 h-[calc(100%-12px)] w-px bg-black/[0.08]"
        />
      )}

      {/* Icon badge */}
      <div className="relative z-10 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-black/[0.04] text-beyond-dim">
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
        className={`max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] px-3 py-2 font-mono text-[12px] leading-relaxed ${tone === 'error' ? 'bg-red-50 text-red-700' : 'bg-black/[0.04] text-beyond-dim'}`}
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

function appendAssistantText(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  text: string,
): void {
  setMessages((prev) => {
    const last = prev[prev.length - 1];
    // Stream into the previous assistant text bubble; a tool-step block ends
    // the streaming bubble so a fresh text block appears below the steps.
    if (last && last.role === 'assistant' && last.kind === 'text') {
      return [...prev.slice(0, -1), { ...last, text: last.text + text }];
    }
    return [...prev, { id: uid(), role: 'assistant', kind: 'text', text }];
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

  const canSubmit = questions.every((_, idx) => (selections[idx]?.size ?? 0) > 0);

  const submit = () => {
    const answers: Record<string, string> = {};
    questions.forEach((q, idx) => {
      const picks = Array.from(selections[idx] || []);
      if (picks.length > 0) answers[q.question] = picks.join(', ');
    });
    onAnswer(answers);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04]"
    >
      <div className="flex flex-col divide-y divide-black/[0.04]">
        {questions.map((q, qIdx) => {
          const multi = Boolean(q.multiSelect);
          const selected = selections[qIdx] || new Set<string>();
          return (
            <div key={qIdx} className="px-5 py-4">
              <div className="mb-3 flex items-center gap-2">
                {q.header && (
                  <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] uppercase tracking-wide text-beyond-faint">
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
                      className={`group flex w-full items-start gap-3 rounded-[14px] border px-3.5 py-2.5 text-left transition-all ${isOn
                        ? 'border-black/15 bg-black/[0.03]'
                        : 'border-black/[0.06] hover:border-black/[0.12] hover:bg-black/[0.02]'}`}
                    >
                      <span
                        className={`mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border transition-colors ${isOn
                          ? 'border-beyond-ink bg-beyond-ink'
                          : 'border-black/15 bg-white'}`}
                      >
                        {isOn && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
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
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-black/[0.04] bg-black/[0.015] px-5 py-3">
        <button
          type="button"
          onClick={onSkip}
          className="rounded-full px-3 py-1.5 text-[12px] text-beyond-faint transition-colors hover:bg-black/[0.04] hover:text-beyond-dim"
        >
          Přeskočit
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-full bg-beyond-ink px-4 py-1.5 text-[12px] font-medium text-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.2)] transition-all hover:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.25)] disabled:bg-black/[0.08] disabled:text-black/30 disabled:shadow-none"
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
      className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04]"
    >
      <div className="px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] uppercase tracking-wide text-beyond-faint">
            Povolení
          </span>
          <span className="text-[11px] text-beyond-faint">Agent chce použít nástroj</span>
        </div>

        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-beyond-dim">
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
            <pre className="mt-2 max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-black/[0.04] px-3 py-2 font-mono text-[11px] leading-relaxed text-beyond-dim">
              {inputPreview}
            </pre>
          </details>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-black/[0.04] bg-black/[0.015] px-5 py-3">
        <button
          type="button"
          onClick={() => onDecision({ kind: 'deny' })}
          className="rounded-full px-3 py-1.5 text-[12px] text-beyond-faint transition-colors hover:bg-black/[0.04] hover:text-beyond-dim"
        >
          Odmítnout
        </button>
        <button
          type="button"
          onClick={() => onDecision({ kind: 'allow-once' })}
          className="rounded-full bg-black/[0.04] px-3.5 py-1.5 text-[12px] font-medium text-beyond-ink transition-colors hover:bg-black/[0.08]"
        >
          Jednou
        </button>
        <button
          type="button"
          onClick={() => onDecision({ kind: 'always-allow', entry: alwaysScope })}
          className="rounded-full bg-beyond-ink px-3.5 py-1.5 text-[12px] font-medium text-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.2)] transition-all hover:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.25)]"
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
        className="w-full max-w-[480px] overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_-16px_rgba(0,0,0,0.28)] ring-1 ring-black/[0.04]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-black/[0.06] px-5 py-4">
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

        <div className="flex items-center justify-end gap-2 border-t border-black/[0.06] bg-black/[0.015] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-black/[0.04] px-3.5 py-1.5 text-[12px] font-medium text-beyond-ink transition-colors hover:bg-black/[0.08]"
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
      className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] ring-1 ring-emerald-200"
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
            className="w-full resize-none rounded-[14px] border border-black/[0.08] bg-white px-3 py-2 text-[14px] leading-relaxed text-beyond-ink focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-100"
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

      <div className="flex items-center justify-end gap-2 border-t border-black/[0.04] bg-black/[0.015] px-5 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3 py-1.5 text-[12px] text-beyond-faint transition-colors hover:bg-black/[0.04] hover:text-beyond-dim"
        >
          Zrušit
        </button>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="rounded-full bg-black/[0.04] px-3.5 py-1.5 text-[12px] font-medium text-beyond-ink transition-colors hover:bg-black/[0.08]"
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
        className="absolute left-3 right-3 top-full z-40 mt-2 overflow-hidden rounded-2xl bg-white shadow-[0_16px_48px_-12px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.04]"
      >
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-black/[0.03]"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-beyond-ink text-white">
            <Plus className="h-[14px] w-[14px]" strokeWidth={2} />
          </div>
          <span className="text-[13px] font-medium text-beyond-ink">Nový chat</span>
        </button>

        <div className="max-h-[60vh] overflow-y-auto border-t border-black/[0.04]">
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
