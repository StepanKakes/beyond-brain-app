import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, Glass } from 'glisse';

import { mergeHistory, rebuildHistory, statusLabel, uid } from '../components/beyond/chat/transcript';
import type { ChatMessage, ToolStep } from '../components/beyond/chat/types';
import { UKAZKA, api } from './api';
import { Icon } from './icons';
import { UNIVERSAL, replaceTop } from './router';
import { onSocket, sendSocket, type SocketMessage } from './socket';
import { mutate, readCache, useResource, writeCache } from './store';
import { TASKS_KEY, TASKS_PATH } from './Today';
import type { ChatSession, TasksResponse } from './types';
import { HoldButton, Markdown, Picker, PushedBar, Sheet, plural, toast } from './ui';

export const CHATS_KEY = 'chaty';

const ALLOWED_KEY = 'bm.allowed-tools';
const allowedTools = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(ALLOWED_KEY) || '[]') as string[];
  } catch {
    return [];
  }
};

const MODEL_KEY = 'bm.model';
const savedModel = (): string => {
  try {
    return localStorage.getItem(MODEL_KEY) || 'opus';
  } catch {
    return 'opus';
  }
};

type ModelOption = { value: string; displayName?: string; description?: string };

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_TEXT_BYTES = 256 * 1024;
const TEXT_FILE = /\.(md|txt|json|ya?ml|csv|tsv|log|html?|css|js|ts|tsx|jsx|py|sh|toml|ini|env|jsonl)$/i;

type Attachment = { id: string; kind: 'image' | 'text'; name: string; mimeType: string; data: string };

function readAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const image = file.type.startsWith('image/');
    if (!image && !file.type.startsWith('text/') && !TEXT_FILE.test(file.name)) {
      reject(new Error(`${file.name}: tenhle typ souboru chat neumí`));
      return;
    }
    if (file.size > (image ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES)) {
      reject(new Error(`${file.name}: soubor je moc velký`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name}: nejde přečíst`));
    reader.onload = () =>
      resolve({
        id: uid(),
        kind: image ? 'image' : 'text',
        name: file.name || 'Fotka',
        mimeType: file.type,
        data: String(reader.result),
      });
    if (image) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

/** Název nástroje bez technické předpony. */
const toolLabel = (name: string): string => name.replace(/^mcp__.+?__/, '').replace(/[-_]/g, ' ');

const PROMPTS = [
  'Co mám dnes nejdůležitějšího?',
  'Kdo z klientů potřebuje pozornost?',
  'Připrav mě na další hovor',
];

type Question = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string }[];
};
type AskRequest = { requestId: string; input: { questions: Question[] } & Record<string, unknown> };
type PermissionRequest = { requestId: string; toolName: string; input: unknown };

// Markdown se chce mít hned, jinak první věty blikají jako prostý text.
void import('./Markdown');

/**
 * Odpověď se během práce neukazuje, přijde najednou jako u Siri: stav zmizí za
 * 0,25 s, 0,3 s je klid a pak po blocích naběhne text (časy změřené z videa).
 */
type RevealPhase = 'idle' | 'leaving' | 'gap' | 'reveal';
const STATUS_OUT_MS = 250;
const REVEAL_GAP_MS = 300;
const REVEAL_MS = 1500;

function Answer({ text }: { text: string }) {
  return (
    <div className="m-answer">
      <Markdown text={text} />
    </div>
  );
}

// Osm kuliček od hlavy po ocas, sousední se slévají jako u Siri.
const LOADER_DOTS = [3.6, 3.2, 2.8, 2.4, 2, 1.7, 1.4, 1.1];

/** Rychlé nástroje by popisek jen rozblikaly, každý proto chvíli vydrží. */
const LABEL_HOLD_MS = 1200;

/** Stav běhu podle Siri: prstenec, který se točí, a popisek, který dýchá. */
function Status({ label, leaving }: { label: string; leaving: boolean }) {
  const [shown, setShown] = useState(label);
  const [old, setOld] = useState<string | null>(null);
  const shownAt = useRef(Date.now());

  useEffect(() => {
    if (label === shown) return undefined;
    const swap = setTimeout(
      () => {
        shownAt.current = Date.now();
        setOld(shown);
        setShown(label);
      },
      Math.max(0, LABEL_HOLD_MS - (Date.now() - shownAt.current)),
    );
    return () => clearTimeout(swap);
  }, [label, shown]);

  useEffect(() => {
    if (!old) return undefined;
    const clear = setTimeout(() => setOld(null), 200);
    return () => clearTimeout(clear);
  }, [old]);

  return (
    <div className={`m-status${leaving ? ' is-leaving' : ''}`} role="status">
      <svg className="m-loader" viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <filter id="m-loader-goo">
            <feGaussianBlur stdDeviation="0.9" />
            <feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 14 -6" />
          </filter>
        </defs>
        <g filter="url(#m-loader-goo)">
          <g className="m-loader-breath">
            <g className="m-loader-spin">
              {LOADER_DOTS.map((radius, index) => {
                const angle = (-index * Math.PI * 2) / LOADER_DOTS.length;
                return (
                  <circle
                    key={radius}
                    cx={16 + Math.sin(angle) * 10}
                    cy={16 - Math.cos(angle) * 10}
                    r={radius}
                    fill="currentColor"
                  />
                );
              })}
            </g>
          </g>
        </g>
      </svg>
      <span className="m-status-text">
        {old ? (
          <span key={old} className="m-status-old">
            {old}
          </span>
        ) : null}
        <span key={shown} className="m-status-label">
          {shown}
        </span>
      </span>
    </div>
  );
}

const Row = memo(function Row({ message }: { message: ChatMessage }) {
  if (message.kind === 'steps') return <Steps steps={message.steps} />;
  if (message.role === 'user') {
    return <div className="m-msg-user">{message.text}</div>;
  }
  return (
    <div className="m-msg-ai">
      <Answer text={message.text} />
      <button
        type="button"
        className="m-msg-copy"
        aria-label="Kopírovat odpověď"
        onClick={() =>
          void navigator.clipboard
            .writeText(message.text)
            .then(() => toast('Zkopírováno'))
            .catch(() => toast('Kopírování se nepovedlo'))
        }
      >
        <Icon name="copy" size={17} />
      </button>
    </div>
  );
});

function Steps({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false);
  const failed = steps.some((s) => s.status === 'error');
  const n = steps.length;
  return (
    <div className="m-steps">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>
          {`${n} ${plural(n, 'krok', 'kroky', 'kroků')}`}
          {failed ? ', něco selhalo' : ''}
        </span>
        <Icon name={open ? 'down' : 'right'} size={14} />
      </button>
      {open ? (
        <ul>
          {steps.map((step) => (
            <li key={step.id} className={step.isError ? 'is-error' : undefined} title={step.name}>
              {toolLabel(step.name)}
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
  onDecide: (decision: 'deny' | 'once' | 'always', input?: unknown) => void;
}) {
  const original = (request.input || {}) as Record<string, unknown>;
  const whatsapp = request.toolName.startsWith('mcp__waha__send-');
  const hasText = request.toolName === 'mcp__waha__send-text';
  const [body, setBody] = useState(typeof original.text === 'string' ? original.text : '');

  // Zpráva skutečnému člověku: vidět komu a co, odeslání podržením a nikdy "vždy".
  if (whatsapp) {
    const chat = typeof original.chatId === 'string' ? original.chatId : '';
    const who = chat.replace(/@c\.us$/, '').replace(/@g\.us$/, ' (skupina)') || 'Příjemce neznámý';
    return (
      <Sheet title="Poslat přes WhatsApp" onClose={() => onDecide('deny')} dismissable={false}>
        <p className="m-detail-label">Pro</p>
        <p className="m-detail-who" title={who}>
          {who}
        </p>
        {hasText ? (
          <textarea
            className="m-textarea"
            value={body}
            aria-label="Text zprávy"
            onChange={(event) => setBody(event.target.value)}
          />
        ) : (
          <pre className="m-pre">{JSON.stringify(original, null, 2).slice(0, 800)}</pre>
        )}
        <div className="m-sheet-actions">
          <Button destructive onClick={() => onDecide('deny')}>
            Neposílat
          </Button>
          <HoldButton
            label="Podrž a odešli"
            disabled={hasText && !body.trim()}
            onConfirm={() => onDecide('once', hasText ? { ...original, text: body } : original)}
          />
        </div>
      </Sheet>
    );
  }

  const detail = (() => {
    try {
      return JSON.stringify(request.input, null, 2).slice(0, 800);
    } catch {
      return '';
    }
  })();
  return (
    <Sheet title="Brain chce použít nástroj" onClose={() => onDecide('deny')} dismissable={false}>
      <p className="m-ask-q" title={request.toolName}>
        {toolLabel(request.toolName)}
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

export function ChatScreen({
  uuid: initial,
  slug: initialSlug,
  draft = '',
  active,
}: {
  uuid: string | null;
  slug: string;
  draft?: string;
  active: boolean;
}) {
  const [slug, setSlug] = useState(initialSlug);
  const tasks = useResource<TasksResponse>(TASKS_KEY, TASKS_PATH);
  const clients = tasks.data?.clients || [];
  const clientName = clients.find((c) => c.slug === slug)?.name;
  const [model, setModel] = useState(savedModel);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [picking, setPicking] = useState<'model' | 'client' | 'attach' | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
  const [text, setText] = useState(draft);

  const uuidRef = useRef(initial);
  const adoptNext = useRef(!initial);
  const runId = useRef<string | null>(null);
  const adopting = useRef(false);
  const loadedAt = useRef(0);
  const [activity, setActivity] = useState<string | null>(null);
  const titleRef = useRef(title);
  const buffer = useRef('');
  const bubble = useRef<string | null>(null);
  const frame = useRef(0);
  const runningRef = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  // Kolo začalo tady na obrazovce: dotaz pak drží nahoře a odpověď roste pod ním.
  const pinned = useRef(false);
  const seenUsers = useRef<number | null>(null);
  const wasRunning = useRef(false);
  const [phase, setPhase] = useState<RevealPhase>('idle');

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
      loadedAt.current = Date.now();
      const live = runningRef.current ? bubble.current : null;
      setMessages((prev) => mergeHistory(prev, rebuildHistory(data.messages || []), live));
      if (!runningRef.current) {
        bubble.current = null;
        setStreamingId(null);
      }
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

  const lastUser = messages.reduce((found, message, index) => (message.role === 'user' ? index : found), -1);
  const usersCount = messages.reduce((count, message) => (message.role === 'user' ? count + 1 : count), 0);
  const holding = running || phase === 'leaving' || phase === 'gap';

  useLayoutEffect(() => {
    const was = wasRunning.current;
    wasRunning.current = running;
    if (running) {
      pinned.current = true;
      setPhase('idle');
      return undefined;
    }
    if (!was) return undefined;
    setPhase('leaving');
    const gap = setTimeout(() => setPhase('gap'), STATUS_OUT_MS);
    const reveal = setTimeout(() => setPhase('reveal'), STATUS_OUT_MS + REVEAL_GAP_MS);
    const done = setTimeout(() => setPhase('idle'), STATUS_OUT_MS + REVEAL_GAP_MS + REVEAL_MS);
    return () => {
      clearTimeout(gap);
      clearTimeout(reveal);
      clearTimeout(done);
    };
  }, [running]);

  /** Místo pod dotazem, aby dotaz stál nahoře a při příchodu odpovědi se nehnul. */
  const fitTurn = useCallback(() => {
    const scroll = scroller.current;
    const space = spacer.current;
    const form = composer.current;
    const user = log.current?.querySelector('[data-last-user]');
    if (!scroll || !space || !form || !user || !pinned.current) {
      if (space) space.style.height = '0px';
      return;
    }
    const bar = scroll.parentElement?.querySelector('.m-bar')?.getBoundingClientRect().height ?? 0;
    const room = scroll.clientHeight - bar - form.offsetHeight - 22;
    const below = space.getBoundingClientRect().top - user.getBoundingClientRect().top;
    space.style.height = `${Math.max(0, room - below)}px`;
  }, []);

  useLayoutEffect(fitTurn, [fitTurn, messages, running, phase, lastUser]);

  // Nový dotaz vyjede od pole nahoru. Delší odpověď se otevře od začátku, ne od konce.
  useLayoutEffect(() => {
    const seen = seenUsers.current;
    seenUsers.current = usersCount;
    if (seen === null || usersCount <= seen || !pinned.current) return;
    const user = log.current?.querySelector('[data-last-user]');
    const form = composer.current;
    if (!user || !form || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = user.getBoundingClientRect();
    const distance = form.getBoundingClientRect().top - box.bottom;
    if (distance <= 0) return;
    log.current?.animate(
      [
        { transform: `translateY(${distance}px)` },
        { transform: 'translateY(-3px)', offset: 0.7 },
        { transform: 'none' },
      ],
      { duration: 450, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }, [usersCount]);

  useLayoutEffect(() => {
    if (phase !== 'reveal') return;
    const scroll = scroller.current;
    const user = log.current?.querySelector('[data-last-user]');
    if (!scroll || !user) return;
    const bar = scroll.parentElement?.querySelector('.m-bar')?.getBoundingClientRect().height ?? 0;
    const above = user.getBoundingClientRect().top - scroll.getBoundingClientRect().top - bar - 8;
    if (above < 0) scroll.scrollTop += above;
  }, [phase]);

  // Pole plave nad přepisem, poslední zpráva pod ním nesmí zůstat schovaná.
  useEffect(() => {
    const form = composer.current;
    const scroll = scroller.current;
    if (!form || !scroll) return undefined;
    const observer = new ResizeObserver(() => {
      scroll.style.setProperty('--m-composer-h', `${form.offsetHeight}px`);
      fitTurn();
    });
    observer.observe(form);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [fitTurn]);

  // Uspané spojení může události ztratit a nic o tom neví. Dokud kolo běží,
  // appka se sama ptá na stav, takže se nikdy nezasekne na staré obrazovce.
  useEffect(() => {
    if (!running || !uuid || UKAZKA) return undefined;
    const timer = setInterval(() => {
      sendSocket({ type: 'check-session-status', sessionId: uuid, provider: 'claude' });
    }, 15000);
    return () => clearInterval(timer);
  }, [running, uuid]);

  useEffect(() => {
    api<{ models?: ModelOption[] }>('/api/beyond/models')
      .then((data) => setModels((data.models || []).filter((m) => typeof m.value === 'string')))
      .catch(() => undefined);
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
        if (adopting.current) {
          adopting.current = false;
          sendSocket({ type: 'check-session-status', sessionId: id, provider: 'claude' });
        }
        if (active) replaceTop(`/m/chat/${id}?k=${encodeURIComponent(slug)}`);
        remember(id);
      }
      return;
    }

    // Cokoli živého znamená, že se pracuje: i po hlášeném konci kola, když agenti
    // na pozadí model znovu probudí.
    if (kind === 'stream_delta' || kind === 'tool_use' || kind === 'tool_result' || kind === 'thinking') {
      setBusy(true);
    }

    if (kind === 'stream_delta') {
      setActivity(null);
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
      setActivity(String(m.toolName || 'Nástroj'));
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
      setActivity(null);
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
      const background = Number(m.backgroundTasks || 0) > 0;
      setActivity(background ? 'background' : null);
      flush();
      bubble.current = null;
      setStreamingId(null);
      setBusy(background);
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
          } else if (adoptNext.current && runId.current) {
            // Spojení spadlo dřív, než appka dostala id chatu.
            adopting.current = true;
            sendSocket({ type: 'adopt-run', clientRunId: runId.current });
          }
          return;
        }
        if (m.type === 'session-status') {
          if (m.sessionId !== uuidRef.current) return;
          setBusy(Boolean(m.turnActive));
          const tool = m.activity as { name?: string } | null | undefined;
          setActivity(m.turnActive && tool?.name ? tool.name : null);
          if (m.turnActive) {
            // Co se mezitím napsalo: tahle zpráva je přesný stav k tomuhle okamžiku.
            flush();
            const partial = String(m.partial || '');
            if (!partial && bubble.current) {
              // Zpráva se mezitím dopsala a její konec se k nám nedostal.
              bubble.current = null;
              setStreamingId(null);
            }
            if (partial) {
              const id = bubble.current || uid();
              bubble.current = id;
              setStreamingId(id);
              setMessages((prev) => {
                const at = prev.findIndex((x) => x.id === id);
                const row: ChatMessage = { id, role: 'assistant', kind: 'text', text: partial };
                return at >= 0 ? prev.map((x) => (x.id === id ? row : x)) : [...prev, row];
              });
            }
          }
          // Při otevření se přepis načetl před chvílí, podruhé nemá smysl.
          if (uuidRef.current && Date.now() - loadedAt.current > 2000) void reload(uuidRef.current);
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

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      try {
        const attachment = await readAttachment(file);
        setAttachments((current) => [...current, attachment]);
      } catch (error) {
        toast((error as Error).message);
      }
    }
  };

  const nameChat = (command: string) => {
    if (UKAZKA) return;
    void api<{ title?: string } | string>('/api/beyond/sessions/suggest-title', {
      method: 'POST',
      body: { text: command },
    })
      .then((result) => {
        const suggested = typeof result === 'string' ? result : result?.title;
        if (!suggested) return;
        titleRef.current = suggested;
        setTitle(suggested);
        if (uuidRef.current) remember(uuidRef.current);
      })
      .catch(() => undefined);
  };

  const send = (preset?: string) => {
    const typed = (preset ?? text).trim();
    if (!typed && !attachments.length) return;
    const textFiles = attachments.filter((a) => a.kind === 'text');
    const images = attachments
      .filter((a) => a.kind === 'image')
      .map((a) => ({ data: a.data, mimeType: a.mimeType, name: a.name }));
    const block = textFiles.map((f) => `\n\n=== Přiložený soubor: ${f.name} ===\n${f.data}\n=== /soubor ===`).join('');
    const command = (typed + block).trim() || 'Podívej se na přiložený obrázek';
    const shown = [typed, ...attachments.map((a) => `Příloha: ${a.name}`)].filter(Boolean).join('\n');

    setText('');
    setAttachments([]);
    setMessages((prev) => [...prev, { id: uid(), role: 'user', kind: 'text', text: shown }]);
    setBusy(true);
    scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });

    if (!uuidRef.current) {
      adoptNext.current = true;
      const seed = typed || 'Chat s přílohou';
      const short = seed.length > 60 ? `${seed.slice(0, 57)}...` : seed;
      titleRef.current = short;
      setTitle(short);
      if (typed) nameChat(typed);
    } else {
      remember(uuidRef.current);
    }
    sendSocket({
      type: 'claude-command',
      command,
      options: {
        model,
        connectors: [],
        ...(images.length ? { images } : {}),
        ...(uuidRef.current
          ? { sessionId: uuidRef.current, resume: true }
          : { clientRunId: (runId.current = uid()), chatSlug: slug, chatTitle: titleRef.current }),
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

  const decide = (decision: 'deny' | 'once' | 'always', edited?: unknown) => {
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
      ...(decision !== 'deny' ? { updatedInput: edited ?? permission.input } : { message: 'Uživatel zamítl' }),
    });
    setPermission(null);
  };

  const modelLabel = models.find((m) => m.value === model)?.displayName || model.replace(/^./, (c) => c.toUpperCase());
  const canSend = Boolean(text.trim() || attachments.length);
  const fresh = !messages.length && !uuid;

  return (
    <div className="m-chat">
      <PushedBar title={title} />
      {/* column-reverse: scroll drží spodek sám a bez JavaScriptu, i při klávesnici */}
      <div className="m-chat-scroll" ref={scroller}>
        <div className="m-chat-log" ref={log}>
          {fresh ? (
            <div className="m-chat-empty">
              <h2>Co pro tebe můžu udělat</h2>
              <button type="button" className="m-pill" onClick={() => setPicking('client')}>
                <Icon name="person" size={15} />
                <span className="m-truncate">{clientName || 'Bez klienta'}</span>
                <Icon name="down" size={12} />
              </button>
              <div className="m-prompts">
                {PROMPTS.map((prompt) => (
                  <button key={prompt} type="button" onClick={() => send(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((message, index) => {
            // Co model během práce píše, přijde až celé.
            if (holding && index > lastUser) return null;
            const arriving = phase === 'reveal' && index > lastUser;
            return (
              <div
                className={`m-chat-row${arriving ? ' is-reveal' : ''}`}
                key={message.id}
                data-last-user={index === lastUser ? '' : undefined}
                style={arriving ? ({ '--m-row': index - lastUser - 1 } as CSSProperties) : undefined}
              >
                <Row message={message} />
              </div>
            );
          })}
          {running || phase === 'leaving' ? (
            <Status label={activity ? statusLabel(activity) : 'Přemýšlím'} leaving={!running} />
          ) : null}
          <div ref={spacer} aria-hidden="true" />
        </div>
      </div>
      <form
        className="m-composer"
        ref={composer}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Glass className="m-composer-card">
        {attachments.length ? (
          <div className="m-attachments">
            {attachments.map((attachment) => (
              <span key={attachment.id} className="m-attachment" title={attachment.name}>
                {attachment.kind === 'image' ? <img src={attachment.data} alt="" /> : <Icon name="doc" size={18} />}
                <span className="m-truncate">{attachment.name}</span>
                <button
                  type="button"
                  aria-label={`Odebrat ${attachment.name}`}
                  onClick={() => setAttachments((list) => list.filter((a) => a.id !== attachment.id))}
                >
                  <Icon name="close" size={14} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
          <textarea
            value={text}
            rows={1}
            placeholder="Napiš brainu"
            aria-label="Zpráva"
            onChange={(event) => setText(event.target.value)}
          />
          <div className="m-composer-tools">
            <button
              type="button"
              className="m-composer-tool"
              aria-label="Přidat přílohu"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => setPicking('attach')}
            >
              <Icon name="plus" size={21} />
            </button>
            <button
              type="button"
              className="m-composer-model"
              title={modelLabel}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => setPicking('model')}
            >
              <span className="m-truncate">{modelLabel}</span>
              <Icon name="down" size={12} />
            </button>
            {running && !canSend ? (
              <button type="button" className="m-send" aria-label="Zastavit" onClick={stop}>
                <Icon name="stop" size={18} />
              </button>
            ) : (
              <button
                type="submit"
                className="m-send"
                aria-label="Odeslat"
                disabled={!canSend}
                // Klávesnice se při odeslání nesmí zavřít.
                onPointerDown={(event) => event.preventDefault()}
              >
                <Icon name="up" size={19} />
              </button>
            )}
          </div>
        </Glass>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            void addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </form>
      {picking === 'attach' ? (
        <Picker
          title="Přidat přílohu"
          options={[
            { value: 'photo', label: 'Fotka' },
            { value: 'file', label: 'Soubor', sub: 'Text, tabulka nebo kód' },
          ]}
          onPick={(value) => (value === 'photo' ? photoInput : fileInput).current?.click()}
          onClose={() => setPicking(null)}
        />
      ) : null}
      {picking === 'model' ? (
        <Picker
          title="Model"
          value={model}
          options={(models.length ? models : [{ value: 'opus', displayName: 'Opus' }, { value: 'sonnet', displayName: 'Sonnet' }]).map((m: ModelOption) => ({
            value: m.value,
            label: m.displayName || m.value,
            sub: m.description,
          }))}
          onPick={(value) => {
            setModel(value);
            try {
              localStorage.setItem(MODEL_KEY, value);
            } catch {
              /* volba platí aspoň v tomhle chatu */
            }
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
      {picking === 'client' ? (
        <Picker
          title="Ke kterému klientovi"
          value={slug}
          options={[{ value: UNIVERSAL, label: 'Bez klienta' }, ...clients.map((c) => ({ value: c.slug, label: c.name }))]}
          onPick={setSlug}
          onClose={() => setPicking(null)}
        />
      ) : null}
      {ask ? <AskSheet request={ask} onAnswer={answer} /> : null}
      {permission ? <PermissionSheet request={permission} onDecide={decide} /> : null}
    </div>
  );
}
