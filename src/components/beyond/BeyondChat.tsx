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
  const allowedToolsRef = useRef<string[]>(readAllowedTools());

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
        const next = Array.from(new Set([...allowedToolsRef.current, decision.entry]));
        allowedToolsRef.current = next;
        persistAllowedTools(next);
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
      if (!trimmed || !isConnected) return;
      setMessages((prev) => [...prev, { id: uid(), role: 'user', kind: 'text', text: trimmed }]);
      setValue('');
      setThinking(true);

      // Only resume when we already have a real SDK-issued UUID. On the very
      // first turn we let the SDK assign one and pick it up via session_created.
      const resumeId = sessionIdRef.current;
      sendMessage({
        type: 'claude-command',
        command: trimmed,
        options: {
          projectPath: BRAIN_PROJECT_PATH,
          cwd: BRAIN_PROJECT_PATH,
          ...(resumeId ? { sessionId: resumeId, resume: true } : {}),
          sessionSummary: `Beyond · ${client.name}`,
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
    [client.name, isConnected, sendMessage],
  );

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
    <div className="flex h-full w-full flex-col bg-[#fafafa]">
      {/* Header — floating rounded card with Beyond glyph avatar.
          Left padding leaves room for the shell's hamburger toggle (~52px). */}
      <header className="flex flex-shrink-0 items-center px-4 pb-3 pl-16 pr-4 pt-4 sm:px-6 sm:pl-20 sm:pr-6 sm:pt-5">
        <div className="mx-auto flex w-full max-w-[760px] items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-[0_2px_16px_-8px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04]">
          <BeyondGlyph size={28} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[14px] font-medium leading-tight text-beyond-ink">
              {client.name}
            </h2>
            {client.week && (
              <p className="truncate text-[12px] leading-tight text-beyond-faint">{client.week}</p>
            )}
          </div>
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

          {permRequest && (
            <BeyondPermissionPanel request={permRequest} onDecision={handlePermDecision} />
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
            <div className="flex items-end gap-2">
              <button
                type="button"
                tabIndex={-1}
                aria-label="Příloha"
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-black/[0.04] hover:text-beyond-dim"
              >
                <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
              <textarea
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
              <button
                type="button"
                onClick={() => send(value)}
                disabled={!value.trim() || !isConnected}
                aria-label="Pošli"
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-beyond-ink text-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.25)] transition-all hover:scale-105 disabled:bg-black/[0.08] disabled:text-black/30 disabled:shadow-none disabled:hover:scale-100"
              >
                <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </button>
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
