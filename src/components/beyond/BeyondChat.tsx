import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useWebSocket } from '../../contexts/WebSocketContext';

/**
 * Beyond Brain — real chat (v2, hyperminimal).
 *
 * Talks to claudecodeui's existing WebSocket using `claude-command` messages.
 * The working directory for the spawned `claude` CLI is the brain repo for
 * the selected client (~/Documents/GitHub/beyond-brain). Session continuity
 * per client is handled by the server: we pass a stable `sessionId` (the
 * client slug) so the same conversation can be resumed across reloads.
 */

const BRAIN_PROJECT_PATH = '/Users/stepankakes/Documents/GitHub/beyond-brain';

type Role = 'user' | 'assistant';
type ChatMessage = {
  id: string;
  role: Role;
  text: string;
  tool?: string;
};

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

  // Stable session id per client — server will resume if it exists.
  const sessionIdRef = useRef<string>(`beyond-${client.slug}`);
  useEffect(() => {
    sessionIdRef.current = `beyond-${client.slug}`;
    setMessages([]);
    setThinking(false);
  }, [client.slug]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [value, setValue] = useState('');
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Stream handler.
  useEffect(() => {
    if (!latestMessage) return;
    // claudecodeui WS protocol — incremental assistant tokens arrive as
    // `claude-response` with `data.message` or similar shapes. Be defensive.
    const m = latestMessage as Record<string, unknown>;
    const type = String(m.type ?? '');

    if (!type) return;

    // Heuristics — handle the common types only. Unknown shapes are ignored
    // gracefully so the chat surface stays functional even if the backend
    // sends extra event kinds.
    if (type === 'claude-output' || type === 'claude-response') {
      const text = extractText(m);
      if (!text) return;
      // Streaming append to the latest assistant message, or create one.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant') {
          return [...prev.slice(0, -1), { ...last, text: last.text + text }];
        }
        return [...prev, { id: uid(), role: 'assistant', text }];
      });
    } else if (type === 'claude-tool-use' || type === 'tool-use') {
      const tool = extractToolLabel(m);
      if (!tool) return;
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', text: '', tool },
      ]);
    } else if (type === 'claude-complete' || type === 'session-complete') {
      setThinking(false);
    } else if (type === 'claude-error' || type === 'session-error') {
      setThinking(false);
      const err = extractText(m) || 'Hm, něco se rozbilo. Zkusíme znovu?';
      setMessages((prev) => [...prev, { id: uid(), role: 'assistant', text: err }]);
    }
  }, [latestMessage]);

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
      setMessages((prev) => [...prev, { id: uid(), role: 'user', text: trimmed }]);
      setValue('');
      setThinking(true);

      sendMessage({
        type: 'claude-command',
        command: trimmed,
        options: {
          projectPath: BRAIN_PROJECT_PATH,
          cwd: BRAIN_PROJECT_PATH,
          sessionId: sessionIdRef.current,
          resume: true,
          sessionSummary: `Beyond · ${client.name}`,
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
    <div className="flex h-full w-full flex-col bg-white">
      {/* Header — minimal context label. Left padding leaves room for the
          shell's hamburger toggle (~52px). */}
      <header className="flex flex-shrink-0 items-center pb-4 pl-16 pr-6 pt-5 sm:pl-20 sm:pr-8">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-medium text-beyond-ink">
            {client.name}
          </h2>
          {client.week && (
            <p className="truncate text-[13px] text-beyond-faint">{client.week}</p>
          )}
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col px-6 py-10 sm:px-8 sm:py-14">
          {messages.length === 0 && !thinking && (
            <p className="text-center text-[15px] text-beyond-faint">Tady jsem.</p>
          )}

          {messages.map((m, i) => (
            <MessageBlock key={m.id} message={m} isFirst={i === 0} />
          ))}

          <AnimatePresence>
            {thinking && (
              <motion.div
                key="thinking"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="mt-8 flex items-center gap-2.5 text-[14px] text-beyond-dim"
              >
                <span className="beyond-dot" aria-hidden="true" />
                <span>Přemýšlím</span>
              </motion.div>
            )}
          </AnimatePresence>

          {!isConnected && (
            <p className="mt-6 text-center text-[13px] text-beyond-faint">
              Spojuju se…
            </p>
          )}
        </div>

        {/* invisible context for screen readers */}
        <span className="sr-only">{header}</span>
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 border-t border-beyond-line/60 bg-white px-6 pb-8 pt-5 sm:px-8">
        <div className="mx-auto w-full max-w-[720px]">
          <div className="flex items-end gap-3">
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
              className="min-h-[44px] flex-1 resize-none bg-transparent py-3 text-[16px] leading-snug text-beyond-ink placeholder:text-beyond-faint focus:outline-none"
            />
            <button
              type="button"
              onClick={() => send(value)}
              disabled={!value.trim() || !isConnected}
              className="beyond-pill flex-shrink-0 disabled:opacity-40"
              aria-label="Send"
            >
              Pošli
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {QUICK_ACTIONS.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => send(quickPrompt(label, client.name))}
                className="rounded-full px-3 py-1.5 text-[13px] text-beyond-dim transition-colors hover:text-beyond-ink"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBlock({ message, isFirst }: { message: ChatMessage; isFirst: boolean }) {
  const variants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0 },
  };
  // 100ms fade-up per VISION.md — subtle, not flashy.
  const transition = { duration: 0.1, ease: 'easeOut' as const };

  const divider = isFirst ? null : (
    <div className="my-8 h-px w-full border-t border-beyond-line" aria-hidden="true" />
  );

  if (message.role === 'user') {
    return (
      <>
        {divider}
        <motion.div initial="hidden" animate="show" variants={variants} transition={transition} className="flex justify-end">
          <p className="max-w-[85%] whitespace-pre-line text-right text-[16px] leading-relaxed text-beyond-dim">
            {message.text}
          </p>
        </motion.div>
      </>
    );
  }

  return (
    <>
      {divider}
      <motion.div initial="hidden" animate="show" variants={variants} transition={transition} className="flex flex-col gap-3">
        {message.tool && (
          <p className="text-[13px] italic text-beyond-faint">{message.tool}</p>
        )}
        {message.text && (
          <p className="whitespace-pre-line text-[16px] leading-relaxed text-beyond-ink">
            {message.text}
          </p>
        )}
      </motion.div>
    </>
  );
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

function extractText(m: Record<string, unknown>): string {
  // try a few common locations
  const candidates: unknown[] = [
    m.text,
    m.data,
    m.content,
    m.message,
    (m.message as Record<string, unknown> | undefined)?.text,
    (m.message as Record<string, unknown> | undefined)?.content,
    (m.payload as Record<string, unknown> | undefined)?.text,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
    if (Array.isArray(c)) {
      const joined = c
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
            return (part as Record<string, unknown>).text as string;
          }
          return '';
        })
        .join('');
      if (joined) return joined;
    }
  }
  return '';
}

function extractToolLabel(m: Record<string, unknown>): string {
  const name =
    (m.tool as string | undefined) ||
    (m.name as string | undefined) ||
    ((m.data as Record<string, unknown> | undefined)?.tool as string | undefined) ||
    ((m.data as Record<string, unknown> | undefined)?.name as string | undefined);
  if (!name) return '';
  // Friendlier wording per VISION.md
  if (/read|file/i.test(name)) return `Čtu ${shortenPath((m.data as Record<string, unknown> | undefined)?.path as string | undefined) || 'soubor'}…`;
  if (/write/i.test(name)) return `Píšu ${shortenPath((m.data as Record<string, unknown> | undefined)?.path as string | undefined) || 'soubor'}…`;
  if (/bash|shell/i.test(name)) return `Spouštím příkaz…`;
  if (/grep|search/i.test(name)) return `Hledám…`;
  return `${name}…`;
}

function shortenPath(p?: string): string {
  if (!p) return '';
  const parts = p.split('/');
  return parts.slice(-2).join('/');
}
