// Vymyšlená data pro /m?ukazka: kontrola vzhledu bez serveru a přihlášení.

type Options = { method?: string; body?: unknown };

const now = Date.now();
const iso = (minutes: number) => new Date(now + minutes * 60000).toISOString();
const day = (offset: number) => new Date(now + offset * 86400000).toISOString().slice(0, 10);

const call = (id: string, title: string, clientName: string | null, start: number, live = false) => ({
  id,
  uid: id,
  title,
  clientName,
  startIso: iso(start),
  endIso: iso(start + 45),
  durationMin: 45,
  meetingUrl: 'https://example.com',
  live,
  startsInMin: start,
});

const base = {
  client: null,
  owner: 'stepan',
  due: '',
  dueLabel: '',
  dueKind: '',
  note: '',
  prep: null,
  doneAt: null,
  virtual: false,
};

const tasks = [
  {
    ...base,
    id: 'navrh:7',
    text: 'Poslat Pavlovi shrnutí hovoru',
    priority: 1,
    state: 'none',
    client: { slug: 'pavel', name: 'Pavel Sedláček' },
    dueLabel: 'dnes',
    dueKind: 'today',
    virtual: true,
    prep: { kind: 'navrh', title: 'Shrnutí', body: 'Text', ref: '7', actions: [] },
  },
  { ...base, id: 'u-1', text: 'Dopsat scénář na reel o prodejním hovoru', priority: 2, state: 'work', dueLabel: 'dnes', dueKind: 'today' },
  { ...base, id: 'u-2', text: 'Zavolat účetní kvůli fakturám za říjen', priority: 1, state: 'none', dueLabel: 'včera', dueKind: 'over' },
  {
    ...base,
    id: 'u-3',
    text: 'Velmi dlouhý název úkolu, který se na telefon nikdy nemůže vejít na jeden řádek a musí se hezky zalomit nebo oříznout',
    priority: 3,
    state: 'none',
    client: { slug: 'dlouhy', name: 'Klient s opravdu hodně dlouhým jménem a příjmením s.r.o.' },
    dueLabel: 'dnes',
    dueKind: 'today',
  },
  { ...base, id: 'u-4', text: 'Projít nápady z hovorů', priority: 4, state: 'none' },
  { ...base, id: 'u-5', text: 'Objednat mikrofon', priority: 4, state: 'done' },
];

const proposal = {
  id: 7,
  kind: 'shrnuti-callu',
  clientSlug: 'pavel',
  clientName: 'Pavel Sedláček',
  channel: 'whatsapp',
  target: '420000000000',
  title: 'Shrnutí hovoru',
  body: 'Ahoj Pavle, díky za dnešek\n\nDomluvili jsme tři věci: nový hook pro reel, cenu programu a termín dalšího hovoru ve čtvrtek\n\nDej vědět, kdyby něco nesedělo',
  reason: 'Hovor skončil před hodinou a shrnutí ještě neodešlo',
  status: 'pending',
  error: null,
};

const history = [
  { kind: 'text', role: 'user', content: 'Co mám dneška nejdůležitějšího?' },
  { kind: 'tool_use', toolName: 'Read', toolId: 't1', toolResult: { content: 'ok' } },
  { kind: 'tool_use', toolName: 'ukoly', toolId: 't2', toolResult: { content: 'ok' } },
  {
    kind: 'text',
    role: 'assistant',
    content:
      'Dneska tři věci:\n\n1. **Pavel** čeká na shrnutí hovoru, návrh je připravený\n2. Ve 14:00 hovor s **Lucií**\n3. Účetní kvůli fakturám, to je už po termínu\n\nZačal bych Pavlem, zabere to minutu',
  },
];

export function mockApi(path: string, options: Options): unknown {
  if (path.startsWith('/api/beyond/velin/ukoly')) {
    if (options.method && options.method !== 'GET') return { ok: true };
    return {
      me: { key: 'stepan' },
      today: day(0),
      people: [],
      clients: [{ slug: 'pavel', name: 'Pavel Sedláček' }],
      tasks,
    };
  }
  if (path.startsWith('/api/beyond/velin/calls')) {
    return {
      configured: true,
      error: null,
      live: [],
      days: [
        {
          day: day(0),
          calls: [
            call('c1', 'Coaching', 'Lucie Nováková', 40),
            call('c2', 'Prodejní hovor s člověkem s velmi dlouhým jménem a názvem firmy', null, 180),
          ],
        },
        { day: day(1), calls: [call('c3', 'Coaching', 'Pavel Sedláček', 1500)] },
      ],
    };
  }
  if (path.startsWith('/api/beyond/velin/navrhy')) {
    if (options.method === 'POST') return { ok: true, proposal };
    return { canSend: true, pending: [proposal], recent: [] };
  }
  if (path.startsWith('/api/beyond/sessions/')) {
    if (path.includes('__universal__')) {
      return {
        slug: '__universal__',
        activeUuid: null,
        sessions: [
          { uuid: 'ukazka-1', title: 'Co mám dneška nejdůležitějšího', lastUsedAt: now - 300000 },
          { uuid: 'ukazka-2', title: 'Návrh e-mailu k webináři a následná sekvence pro lidi, co nedorazili', lastUsedAt: now - 86400000 },
        ],
      };
    }
    return { slug: 'x', activeUuid: null, sessions: [] };
  }
  if (path.startsWith('/api/providers/sessions/')) return { messages: history, total: history.length };
  return {};
}

const REPLY = 'Jasně, koukám na to. Návrh pro Pavla je připravený, stačí ho otevřít v úkolech a podržet tlačítko';

export function mockSocket(message: Record<string, unknown>, emit: (m: Record<string, unknown>) => void): void {
  if (message.type !== 'claude-command') return;
  const sessionId = (message.options as { sessionId?: string }).sessionId || 'ukazka-nova';
  emit({ kind: 'session_created', newSessionId: sessionId, sessionId });
  const words = REPLY.split(' ');
  words.forEach((word, index) => {
    setTimeout(() => emit({ kind: 'stream_delta', sessionId, content: `${word} ` }), 300 + index * 70);
  });
  setTimeout(() => {
    emit({ kind: 'text', role: 'assistant', sessionId, content: REPLY });
    emit({ kind: 'complete', sessionId });
  }, 400 + words.length * 70);
}
