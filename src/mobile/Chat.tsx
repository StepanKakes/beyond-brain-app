import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'glisse';

import { rebuildHistory, uid } from '../components/beyond/chat/transcript';
import type { ChatMessage, ToolStep } from '../components/beyond/chat/types';
import { UKAZKA, api } from './api';
import { Icon } from './icons';
import { replaceTop } from './router';
import { onSocket, sendSocket, type SocketMessage } from './socket';
import { mutate, readCache, writeCache } from './store';
import type { ChatSession } from './types';
import { Markdown, PushedBar, Sheet, plural, toast } from './ui';

export const CHATS_KEY = 'chaty';

const ALLOWED_KEY = 'bm.allowed-tools';
const allowedTools = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(ALLOWED_KEY) || '[]') as string[];
  } catch {
    return [];
  }
};

type Question = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string }[];
};
type AskRequest = { requestId: string; input: { questions: Question[] } & Record<string, unknown> };
type PermissionRequest = { requestId: string; toolName: string; input: unknown };

const Row = memo(function Row({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  if (message.kind === 'steps') return <Steps steps={message.steps} />;
  if (message.role === 'user') {
    return <div className="m-msg-user">{message.text}</div>;
  }
  // Rozepsaná zpráva se překresluje s každým kouskem, Markdown až po dopsání.
  return streaming ? (
    <div className="m-md m-md-plain m-msg-ai">{message.text}</div>
  ) : (
    <div className="m-msg-ai">
      <Markdown text={message.text} />
    </div>
  );
});

function Steps({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false);
  const running = steps.some((s) => s.status === 'running');
  const failed = steps.some((s) => s.status === 'error');
  const n = steps.length;
  return (
    <div className="m-steps">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {running ? 'Pracuje' : `${n} ${plural(n, 'krok', 'kroky', 'kroků')}`}
        {failed ? ', něco selhalo' : ''}
      </button>
      {open ? (
        <ul>
          {steps.map((step) => (
            <li key={step.id} className={step.isError ? 'is-error' : undefined} title={step.name}>
              {step.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AskSheet({ request, onAnswer }: { request: AskRequest; onAnswer: (answers: Record<string, string>) => void }) {
  const questions = request.input.questions || [];
  const [picks, setPicks] = useState<Record<number, string[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});

  const toggle = (index: number, label: string, multi?: boolean) =>
    setPicks((current) => {
      const list = current[index] || [];
      if (multi) {
        return { ...current, [index]: list.includes(label) ? list.filter((l) => l !== label) : [...list, label] };
      }
      return { ...current, [index]: list.includes(label) ? [] : [label] };
    });

  const submit = () => {
    const answers: Record<string, string> = {};
    questions.forEach((question, index) => {
      const chosen = (picks[index] || []).join(', ');
      const own = (custom[index] || '').trim();
      const value = chosen && own ? `${chosen}, ${own}` : chosen || own;
      if (value) answers[question.question] = value;
    });
    onAnswer(answers);
  };

  return (
    <Sheet title="Brain se ptá" onClose={() => onAnswer({})} dismissable={false}>
      {questions.map((question, index) => (
        <div className="m-ask" key={question.question}>
          <p className="m-ask-q">{question.question}</p>
          <div className="m-ask-options">
            {(question.options || []).map((option) => (
              <button
                key={option.label}
                type="button"
                className={(picks[index] || []).includes(option.label) ? 'is-on' : undefined}
                aria-pressed={(picks[index] || []).includes(option.label)}
                onClick={() => toggle(index, option.label, question.multiSelect)}
              >
                <span>{option.label}</span>
                {option.description ? <small>{option.description}</small> : null}
              </button>
            ))}
          </div>
          <input
            className="m-input"
            placeholder="Nebo napiš vlastní odpověď"
            aria-label="Vlastní odpověď"
            value={custom[index] || ''}
            onChange={(event) => setCustom((c) => ({ ...c, [index]: event.target.value }))}
          />
        </div>
      ))}
      <div className="m-sheet-actions">
        <Button onClick={() => onAnswer({})}>Přeskočit</Button>
        <Button variant="filled" onClick={submit}>
          Odpovědět
        </Button>
      </div>
    </Sheet>
  );
}

function PermissionSheet({
  request,
  onDecide,
}: {
  request: PermissionRequest;
  onDecide: (decision: 'deny' | 'once' | 'always') => void;
}) {
  const detail = (() => {
    try {
      return JSON.stringify(request.input, null, 2).slice(0, 800);
    } catch {
      return '';
    }
  })();
  return (
    <Sheet title="Povolit nástroj" onClose={() => onDecide('deny')} dismissable={false}>
      <p className="m-ask-q" title={request.toolName}>
        {request.toolName}
      </p>
      {detail ? <pre className="m-pre">{detail}</pre> : null}
      <div className="m-sheet-actions">
        <Button destructive onClick={() => onDecide('deny')}>
          Zamítnout
        </Button>
        <Button onClick={() => onDecide('always')}>Vždy</Button>
        <Button variant="filled" onClick={() => onDecide('once')}>
          Povolit
        </Button>
      </div>
    </Sheet>
  );
}

export function ChatScreen({ uuid: initial, slug, active }: { uuid: string | null; slug: string; active: boolean }) {
  const [uuid, setUuid] = useState(initial);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initial ? readCache<ChatMessage[]>(`chat.${initial}`) || [] : [],
  );
  const [title, setTitle] = useState(() => {
    const known = readCache<ChatSession[]>(CHATS_KEY)?.find((s) => s.uuid === initial);
    return known?.title || 'Nový chat';
  });
  const [running, setRunning] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [ask, setAsk] = useState<AskRequest | null>(null);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [text, setText] = useState('');

  const uuidRef = useRef(initial);
  const adoptNext = useRef(!initial);
  const titleRef = useRef(title);
  const buffer = useRef('');
  const bubble = useRef<string | null>(null);
  const frame = useRef(0);
  const runningRef = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);

  const setBusy = (value: boolean) => {
    runningRef.current = value;
    setRunning(value);
  };

  const flush = useCallback(() => {
    frame.current = 0;
    const chunk = buffer.current;
    if (!chunk) return;
    buffer.current = '';
    const id = bubble.current;
    if (!id) return;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.id === id && last.kind === 'text') {
        return [...prev.slice(0, -1), { ...last, text: last.text + chunk }];
      }
      return [...prev, { id, role: 'assistant', kind: 'text', text: chunk }];
    });
  }, []);

  const reload = useCallback(async (id: string) => {
    if (UKAZKA && !id) return;
    try {
      const data = await api<{ messages: unknown[] }>(
        `/api/providers/sessions/${encodeURIComponent(id)}/messages?limit=120&offset=0`,
      );
      flush();
      bubble.current = null;
      setStreamingId(null);
      setMessages((prev) => {
        const next = rebuildHistory(data.messages || []);
        // Na disku může chybět, co odešlo před chvílí. To nesmí zmizet.
        let lastUser = -1;
        for (let i = prev.length - 1; i >= 0; i -= 1) {
          if (prev[i].role === 'user') {
            lastUser = i;
            break;
          }
        }
        const sent = lastUser >= 0 ? prev[lastUser] : null;
        const onDisk =
          !sent ||
          (sent.kind === 'text' &&
            next.some((m) => m.role === 'user' && m.kind === 'text' && m.text.trim() === sent.text.trim()));
        return onDisk ? next : [...next, ...prev.slice(lastUser)];
      });
    } catch {
      /* zůstane, co je vidět z cache */
    }
  }, [flush]);

  useEffect(() => {
    if (!initial) return;
    void reload(initial);
    sendSocket({ type: 'check-session-status', sessionId: initial, provider: 'claude' });
    // jen při otevření obrazovky
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cache přepisu, ne během streamu, a bez výstupů nástrojů.
  useEffect(() => {
    if (!uuid || streamingId) return;
    const slim = messages.slice(-60).map((m) =>
      m.kind === 'steps' ? { ...m, steps: m.steps.map((s) => ({ ...s, input: undefined, output: undefined })) } : m,
    );
    writeCache(`chat.${uuid}`, slim);
  }, [messages, uuid, streamingId]);

  const remember = useCallback((id: string) => {
    const session = { uuid: id, title: titleRef.current, lastUsedAt: Date.now() };
    mutate<ChatSession[]>(CHATS_KEY, (current) => {
      const rest = (current || []).filter((s) => s.uuid !== id);
      return [{ ...session, slug }, ...rest];
    });
    if (!UKAZKA) {
      void api(`/api/beyond/sessions/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        body: { activeUuid: id, sessions: [session] },
      }).catch(() => undefined);
    }
  }, [slug]);

  const handleKind = useCallback((m: SocketMessage) => {
    const kind = String(m.kind);

    if (kind === 'session_created') {
      const id = String(m.newSessionId || m.sessionId || '');
      if (id && adoptNext.current) {
        adoptNext.current = false;
        uuidRef.current = id;
        setUuid(id);
        if (active) replaceTop(`/m/chat/${id}?k=${encodeURIComponent(slug)}`);
        remember(id);
      }
      return;
    }

    if (kind === 'stream_delta') {
      if (!bubble.current) {
        bubble.current = uid();
        setStreamingId(bubble.current);
      }
      buffer.current += String(m.content || '');
      if (!frame.current) frame.current = requestAnimationFrame(flush);
      return;
    }

    if (kind === 'text') {
      if (m.role && m.role !== 'assistant') return;
      const whole = String(m.content || '');
      if (!whole) return;
      flush();
      const id = bubble.current;
      bubble.current = null;
      setStreamingId(null);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (id && last && last.id === id && last.kind === 'text') {
          return [...prev.slice(0, -1), { ...last, text: whole }];
        }
        return [...prev, { id: uid(), role: 'assistant', kind: 'text', text: whole }];
      });
      return;
    }

    if (kind === 'tool_use') {
      flush();
      bubble.current = null;
      setStreamingId(null);
      const step: ToolStep = {
        id: uid(),
        toolId: String(m.toolId || uid()),
        name: String(m.toolName || 'Nástroj'),
        status: 'running',
      };
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.kind === 'steps') return [...prev.slice(0, -1), { ...last, steps: [...last.steps, step] }];
        return [...prev, { id: uid(), role: 'assistant', kind: 'steps', steps: [step] }];
      });
      return;
    }

    if (kind === 'tool_result') {
      const failed = Boolean(m.isError);
      setMessages((prev) =>
        prev.map((message) =>
          message.kind !== 'steps'
            ? message
            : {
                ...message,
                steps: message.steps.map((s) =>
                  s.toolId === m.toolId ? { ...s, isError: failed, status: failed ? 'error' : 'done' } : s,
                ),
              },
        ),
      );
      return;
    }

    if (kind === 'permission_request') {
      const requestId = String(m.requestId || '');
      const toolName = String(m.toolName || '');
      if (!requestId) return;
      if (toolName === 'AskUserQuestion') {
        setAsk({ requestId, input: m.input as AskRequest['input'] });
        return;
      }
      if (allowedTools().includes(toolName)) {
        sendSocket({ type: 'claude-permission-response', requestId, allow: true, updatedInput: m.input });
        return;
      }
      setPermission({ requestId, toolName, input: m.input });
      return;
    }

    if (kind === 'permission_cancelled') {
      setAsk((current) => (current?.requestId === m.requestId ? null : current));
      setPermission((current) => (current?.requestId === m.requestId ? null : current));
      return;
    }

    if (kind === 'complete') {
      flush();
      bubble.current = null;
      setStreamingId(null);
      setBusy(false);
      if (uuidRef.current && !UKAZKA) void reload(uuidRef.current);
      return;
    }

    if (kind === 'error') {
      flush();
      bubble.current = null;
      setStreamingId(null);
      setBusy(false);
      toast(String(m.content || 'Chat se přerušil'));
    }
  }, [active, flush, reload, remember, slug]);

  useEffect(
    () =>
      onSocket((m) => {
        if (m.type === 'websocket-reconnected') {
          if (uuidRef.current) {
            sendSocket({ type: 'check-session-status', sessionId: uuidRef.current, provider: 'claude' });
          }
          return;
        }
        if (m.type === 'session-status') {
          if (m.sessionId !== uuidRef.current) return;
          setBusy(Boolean(m.turnActive));
          if (uuidRef.current) void reload(uuidRef.current);
          const pending = (m.pendingPermissions || []) as { requestId: string; toolName: string; input: unknown }[];
          pending.forEach((p) => handleKind({ kind: 'permission_request', ...p }));
          return;
        }
        if (m.type === 'error' && adoptNext.current) {
          setBusy(false);
          toast(String(m.error || 'Chat se nepodařilo spustit'));
          return;
        }
        if (typeof m.kind !== 'string') return;
        // Ostatní chaty běží vedle a do tohohle nepatří.
        const owner = uuidRef.current;
        const created = m.kind === 'session_created';
        if (owner && m.sessionId && m.sessionId !== owner && !created) return;
        if (!owner && !adoptNext.current) return;
        if (created && !adoptNext.current) return;
        handleKind(m);
      }),
    [handleKind, reload],
  );

  // Návrat do popředí: stream mohl mezitím skončit, přepis se dotáhne.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && uuidRef.current) {
        sendSocket({ type: 'check-session-status', sessionId: uuidRef.current, provider: 'claude' });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const send = () => {
    const command = text.trim();
    if (!command) return;
    setText('');
    setMessages((prev) => [...prev, { id: uid(), role: 'user', kind: 'text', text: command }]);
    setBusy(true);
    scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });

    if (!uuidRef.current) {
      adoptNext.current = true;
      const short = command.length > 60 ? `${command.slice(0, 57)}...` : command;
      titleRef.current = short;
      setTitle(short);
    } else {
      remember(uuidRef.current);
    }
    sendSocket({
      type: 'claude-command',
      command,
      options: {
        model: 'opus',
        connectors: [],
        ...(uuidRef.current ? { sessionId: uuidRef.current, resume: true } : {}),
        sessionSummary: 'Beyond · mobil',
        toolsSettings: { allowedTools: allowedTools(), disallowedTools: [], skipPermissions: false },
      },
    });
  };

  const stop = () => {
    if (uuidRef.current) {
      sendSocket({ type: 'abort-session', sessionId: uuidRef.current, provider: 'claude' });
    }
  };

  const answer = (answers: Record<string, string>) => {
    if (!ask) return;
    sendSocket({
      type: 'claude-permission-response',
      requestId: ask.requestId,
      allow: true,
      updatedInput: { ...ask.input, answers },
    });
    setAsk(null);
  };

  const decide = (decision: 'deny' | 'once' | 'always') => {
    if (!permission) return;
    if (decision === 'always') {
      try {
        localStorage.setItem(ALLOWED_KEY, JSON.stringify([...new Set([...allowedTools(), permission.toolName])]));
      } catch {
        /* povolení platí aspoň teď */
      }
    }
    sendSocket({
      type: 'claude-permission-response',
      requestId: permission.requestId,
      allow: decision !== 'deny',
      ...(decision !== 'deny' ? { updatedInput: permission.input } : { message: 'Uživatel zamítl' }),
    });
    setPermission(null);
  };

  return (
    <div className="m-chat">
      <PushedBar title={title} />
      {/* column-reverse: scroll drží spodek sám a bez JavaScriptu, i při klávesnici */}
      <div className="m-chat-scroll" ref={scroller}>
        <div className="m-chat-log">
          {messages.map((message) => (
            <div className="m-chat-row" key={message.id}>
              <Row message={message} streaming={message.id === streamingId} />
            </div>
          ))}
          {running && !streamingId ? <div className="m-thinking">Přemýšlí</div> : null}
        </div>
      </div>
      <form
        className="m-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          value={text}
          rows={1}
          placeholder="Napiš brainu"
          aria-label="Zpráva"
          onChange={(event) => setText(event.target.value)}
        />
        {running && !text.trim() ? (
          <button type="button" className="m-send" aria-label="Zastavit" onClick={stop}>
            <Icon name="stop" size={20} />
          </button>
        ) : (
          <button
            type="submit"
            className="m-send"
            aria-label="Odeslat"
            disabled={!text.trim()}
            // Klávesnice se při odeslání nesmí zavřít.
            onPointerDown={(event) => event.preventDefault()}
          >
            <Icon name="up" size={20} />
          </button>
        )}
      </form>
      {ask ? <AskSheet request={ask} onAnswer={answer} /> : null}
      {permission ? <PermissionSheet request={permission} onDecide={decide} /> : null}
    </div>
  );
}
