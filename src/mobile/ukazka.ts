// Vymyšlená data pro /m?ukazka: kontrola vzhledu bez serveru a přihlášení.

type Options = { method?: string; body?: unknown };

const now = Date.now();
const iso = (minutes: number) => new Date(now + minutes * 60000).toISOString();
const day = (offset: number) => new Date(now + offset * 86400000).toISOString().slice(0, 10);

const call = (id: string, title: string, clientName: string | null, start: number, live = false) => ({
  id,
  uid: id,
  clientSlug: clientName ? 'pavel' : null,
  host: { key: 'stepan', name: 'Štěpán' },
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
  { ...base, id: 'u-z', text: 'Připravit prezentaci na workshop', priority: 3, state: 'none', due: day(1), dueLabel: 'zítra' },
  { ...base, id: 'u-5', text: 'Objednat mikrofon', priority: 4, state: 'done' },
  // Dost řádků, aby se dal zkoušet scroll pod horní lištu a tab bar.
  ...Array.from({ length: 4 }, (_, index) => ({
    ...base,
    id: `u-d${index}`,
    text: `Úkol do zásoby číslo ${index + 1}`,
    priority: 4,
    state: 'none',
  })),
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

const signal = (title: string, detail: string, severity: string, slug: string, name: string) => ({
  type: title,
  severity,
  title,
  detail,
  clientSlug: slug,
  clientName: name,
});

const client = (slug: string, name: string, week: number, worst: string | null, score: number, signals: unknown[] = []) => ({
  slug,
  name,
  stav: 'Aktivní',
  isActive: true,
  programWeek: week,
  totalWeeks: 12,
  daysToEnd: (12 - week) * 7,
  notionUrl: 'https://example.com',
  openOurs: 1,
  openTheirs: 2,
  openFlags: worst ? 1 : 0,
  lastCallIso: iso(-4 * 1440),
  nextCall: null,
  score,
  worst,
  counts: { critical: worst === 'critical' ? 1 : 0, watch: worst === 'watch' ? 1 : 0 },
  signals,
});

const pavelSignals = [signal('Neodpovídá 9 dní', 'Poslední zpráva od něj byla minulý týden', 'critical', 'pavel', 'Pavel Sedláček')];
const board = [
  client('pavel', 'Pavel Sedláček', 5, 'critical', 90, pavelSignals),
  client('lucie', 'Lucie Nováková', 8, 'watch', 40, [signal('Chybí měření', 'Tento týden neposlala čísla', 'watch', 'lucie', 'Lucie Nováková')]),
  client('dlouhy', 'Klient s opravdu hodně dlouhým jménem a příjmením s.r.o.', 2, null, 0),
  client('jana', 'Jana Horáková', 11, null, 0),
];

export function mockApi(path: string, options: Options): unknown {
  if (path.startsWith('/api/beyond/velin/ukoly/parse')) {
    const quick = String((options.body as { quick?: string })?.quick || '');
    return {
      priority: /\bp1\b/.test(quick) ? 1 : 4,
      due: /zítra/.test(quick) ? 'zítra' : /dnes/.test(quick) ? 'dnes' : null,
      clientName: /Pavl/.test(quick) ? 'Pavel Sedláček' : null,
      owner: 'stepan',
      text: quick,
      tokens: quick.split(/\s+/).flatMap((word, i) => {
        if (/^p[1-4]$/.test(word)) return [{ i, word, kind: 'priority' }];
        if (/^(dnes|zítra)$/.test(word)) return [{ i, word, kind: 'due' }];
        if (/^Pavl/.test(word)) return [{ i, word, kind: 'client' }];
        return [];
      }),
    };
  }
  if (path === '/api/beyond/velin/') {
    return { me: { key: 'stepan', displayName: 'Štěpán' }, needsUs: pavelSignals, risks: board[1].signals };
  }
  if (path.startsWith('/api/beyond/velin/widget/klic')) return { ok: true, klic: 'ukazka-klic-neni-skutecny' };
  if (path.startsWith('/api/beyond/velin/widget')) return { klic: false, vytvoren: null, pouzit: null };
  if (path.startsWith('/api/beyond/velin/rutiny')) return mockRoutines(path, options);
  if (path.startsWith('/api/beyond/velin/pocty')) return { navrhy: 1, obsah: 2, klienti: 2, velin: 3 };
  if (path.startsWith('/api/beyond/velin/board')) return { clients: board };
  if (path.startsWith('/api/beyond/velin/client/')) {
    const slug = decodeURIComponent(path.split('/').pop() || '');
    const found = board.find((c) => c.slug === slug) || board[0];
    return {
      client: {
        ...found,
        measurements: [{ isoWeek: '2026-W44', range: '26. 10. až 1. 11.', values: { sledujici: 1240, leady: 18, cally: 6 } }],
        promises: {
          ours: [{ text: 'Poslat šablonu nabídky', dueIso: iso(1440), person: 'Štěpán' }],
          theirs: [{ text: 'Natočit tři reely', dueIso: iso(4320), person: found.name }],
        },
        flags: [{ severity: 'watch', title: 'Váhá nad cenou', stav: null, open: true, body: 'Zmínil to na posledním hovoru' }],
        daysSinceLastCall: 4,
      },
      signals: [
        {
          type: 'our-debt',
          severity: 'critical',
          title: 'Dlužíme my',
          detail: '2× otevřené, nejstarší 9 dní: Poslat šablonu nabídky a projít ceník před dalším hovorem, ať má z čeho vycházet',
          meaning: 'Brzdíme klienta my. Tohle se řeší dřív než cokoli, co dluží on',
          actor: 'us',
          items: [{ text: 'Poslat šablonu nabídky' }, { text: 'Projít ceník před dalším hovorem' }],
          akce: { label: 'Připravit s brainem', prompt: 'Dlužíme klientovi: šablona nabídky a ceník. Připrav mi to, nic neposílej.' },
        },
        {
          type: 'quiet',
          severity: 'watch',
          title: 'Ticho',
          detail: 'Poslední zpráva od klienta před 7 dny',
          meaning: 'Začíná se vzdalovat, ozvat se dřív, než z toho bude zvyk',
          akce: { label: 'Navrhnout zprávu', prompt: 'Navrhni krátkou zprávu, kterou pošlu. Zatím nic neposílej.' },
        },
        {
          type: 'stale-flag',
          severity: 'watch',
          title: 'Vlajka bez pohybu',
          detail: '1× beze změny, nejdéle 24 dní: Váhá nad cenou',
          meaning: 'Riziko, které jsme pojmenovali a pak na něj zapomněli',
          vlajky: ['Váhá nad cenou'],
        },
        {
          type: 'call-unwritten',
          severity: 'watch',
          title: 'Call bez zápisu',
          detail: 'Fathom má 2026-11-03, cally.md končí 2026-10-27',
          meaning: 'Hovor proběhl a nepromítl se do brainu. Práce pro agenta, ne pro člověka',
          actor: 'agent',
        },
      ],
      hidden: [
        {
          type: 'program-ending',
          severity: 'watch',
          title: 'Konec programu se blíží',
          detail: 'Zbývá 20 dní',
          meaning: 'Poslední okno na výsledek a zároveň rozhodnutí o pokračování',
          schovano: { stav: 'odlozeno', until: iso(5 * 1440) },
        },
      ],
      ticked: [
        { id: 'o-1', at: iso(-1440), kind: 'slib', text: 'Napsat feedback k prvním reelům', zdroj: 'WhatsApp 3.11.', dukaz: 'Tim poslal feedback k reelům do skupiny' },
      ],
      timeline: [
        { kind: 'call', dateIso: iso(-4 * 1440), title: 'Coaching', excerpt: 'Probrali jsme nový hook a cenu programu', body: '## Co se řešilo\n\n- Nový hook do reelů\n- Cena programu a **jak ji říct**\n\n## Další krok\n\nPoslat tři verze háku do pátku' },
        { kind: 'whatsapp', dateIso: iso(-9 * 1440), title: 'Zpráva', excerpt: 'Díky, koukám na to a ozvu se' },
      ],
      calls: [],
    };
  }
  if (path.startsWith('/api/beyond/velin/agent/mozek')) {
    return { items: [{ id: 3, title: 'Tón zpráv Pavlovi', reason: 'Odpovídá lépe na kratší zprávy', before: 'Delší zprávy', after: 'Krátké zprávy, jedna otázka' }] };
  }
  if (path.startsWith('/api/beyond/velin/planner') && path.includes('/instagram')) {
    if (path.includes('/nahrani')) return { ok: true, soubory: [] };
    if (options.method === 'DELETE') return { ok: true };
    if (options.method === 'POST') {
      return { ok: true, post: { id: `ig${now}`, typ: 'reel', stav: 'ceka', naplanovano_na: iso(60 * 24), publikovano_at: null, permalink: null, chyba: null, popisek: '', ...(options.body as object) } };
    }
    return {
      ok: true,
      muze_publikovat: true,
      posty: {
        p4: { id: 'ig1', typ: 'reel', stav: 'ceka', naplanovano_na: `${day(2)}T18:00:00`, publikovano_at: null, permalink: null, chyba: null, popisek: 'Tvůj profil musí vyprávět příběh' },
        p6: { id: 'ig2', typ: 'reel', stav: 'publikovano', naplanovano_na: `${day(-3)}T18:00:00`, publikovano_at: `${day(-3)}T18:01:00`, permalink: 'https://www.instagram.com/', chyba: null, popisek: '' },
      },
    };
  }
  if (path.startsWith('/api/beyond/velin/planner')) {
    if (options.method === 'POST') {
      return { ok: true, card: { id: `u${now}`, stav: 'Reels nápad', platforma: null, format: null, cil: null, cta: null, styl: null, kdo: [], datum: null, misto: null, reviewLink: null, soubor: null, text: '', ...(options.body as object) } };
    }
    if (options.method) return { ok: true };
    const card = (id: string, nazev: string, stav: string, extra: object = {}) => ({ id, nazev, stav, platforma: 'Reels', format: null, cil: null, cta: null, styl: null, kdo: [], datum: null, misto: null, reviewLink: null, soubor: null, text: '', ...extra });
    return {
      options: {
        stav: ['Reels nápad', 'YouTube nápad', 'Natočeno', 'Střih', 'Review', 'Opravit', 'Naplánováno', 'Vydáno'],
        platforma: ['Reels', 'Youtube'],
        format: ['Studio talking head', 'Undocumented', 'Real life - raw', 'Vlog', 'Splitscreen', 'Miroboard'],
        cil: ['Viral potenciál (dosah)', 'Inspirovat (tenhle týpek je cool)', 'Budovat autoritu (prodat)'],
        cta: ['REKLAMA – FREE PROGRAM (chci)', 'Free materiály', 'Bez CTA'],
        styl: ['L1 - low effort', 'L2 - broll', 'L3 - high effort'],
        kdo: ['Tim', 'Jirka', 'Štěpán'],
      },
      notionImport: { at: iso(-600), added: 6, skipped: 0, total: 6, error: null },
      karty: [
        card('p1', 'Zase se to děje: osobní značka je nový 2018', 'Reels nápad', { format: 'Studio talking head', cil: 'Budovat autoritu (prodat)', cta: 'REKLAMA – FREE PROGRAM (chci)', kdo: ['Tim'], text: '## Stavba\n\n1. Hook\n2. Minulost\n3. Nová příležitost\n\n## Skript\n\nZase se to děje. Jedna z největších příležitostí na internetu v dnešní době' }),
        card('p2', 'Founders, velmi dlouhý název karty, který se nesmí rozbít ani na úzkém displeji telefonu', 'YouTube nápad', { platforma: 'Youtube', format: 'Vlog' }),
        card('p3', 'AI návod, undocumented studio', 'Natočeno', { format: 'Undocumented', styl: 'L1 - low effort', soubor: 'C1577.MP4' }),
        card('p4', 'Tvůj profil musí vyprávět příběh', 'Střih', { kdo: ['Jirka'], datum: day(2) }),
        card('p5', 'Osobní profily největších podnikatelů', 'Review', { platforma: 'Youtube', reviewLink: 'https://example.com/review', datum: day(0) }),
        card('p6', 'Stavím firmu 200 kč', 'Vydáno', { datum: day(-3), kdo: ['Tim', 'Jirka'] }),
      ],
    };
  }
  if (path.startsWith('/api/beyond/velin/obsah')) {
    if (options.method && options.method !== 'GET') return { ok: true };
    return {
      items: [
        { id: 'o1', kind: 'reel', state: 'navrh', title: 'Proč prodejní hovor nekončí cenou', hook: 'Cena není konec hovoru', why: 'Zaznělo na třech hovorech tento týden', caption: 'Popisek reelu', client: 'Pavel Sedláček', quote: 'Tohle mi změnilo prodej', speaker: 'Pavel', clip: null },
        { id: 'o2', kind: 'story', state: 'schvaleno', title: 'Tři chyby v nabídce', hook: null, why: null, caption: null, client: null, clip: null },
      ],
    };
  }
  if (path.startsWith('/api/beyond/velin/kpi')) {
    const metric = (key: string, area: string, label: string, unit: string, dir = 'max') => ({ key, area, label, unit, dir });
    const period = {
      values: { leady: 42, cally: 11, trzby: 184000, cpl: 95 },
      targets: { leady: 50, cally: 10, trzby: 150000, cpl: 120 },
    };
    return {
      configured: true,
      currentWeek: '2026-W45',
      metrics: [
        metric('leady', 'akvizice', 'Nové leady', 'count'),
        metric('cally', 'cally', 'Prodejní hovory', 'count'),
        metric('trzby', 'trzby', 'Tržby', 'czk'),
        metric('cpl', 'reklama', 'Cena za lead', 'czk', 'min'),
      ],
      weeks: [
        { ...period, week: '2026-W44', from: day(-9), to: day(-3), status: 'past' },
        { ...period, week: '2026-W45', from: day(-2), to: day(4), status: 'current' },
      ],
      months: [{ ...period, month: day(0).slice(0, 7) }],
      errors: [],
    };
  }
  if (path.startsWith('/api/beyond/files/tree')) {
    return {
      roots: [
        { type: 'dir', name: 'clients', path: 'clients', children: [{ type: 'file', name: 'pavel.md', path: 'clients/pavel.md' }] },
        { type: 'file', name: 'README.md', path: 'README.md' },
      ],
    };
  }
  if (path.startsWith('/api/beyond/file')) return { content: '# Pavel\n\nDvanáctitýdenní program, pátý týden' };
  if (path.startsWith('/api/beyond/models')) {
    return { models: [{ value: 'opus', displayName: 'Opus', description: 'Nejschopnější' }, { value: 'sonnet', displayName: 'Sonnet', description: 'Rychlejší' }] };
  }
  if (path.startsWith('/api/beyond/velin/ukoly')) {
    if (options.method && options.method !== 'GET') return { ok: true };
    return {
      me: { key: 'stepan' },
      today: day(0),
      people: [
        { key: 'stepan', displayName: 'Štěpán' },
        { key: 'tim', displayName: 'Tim' },
      ],
      clients: board.map((c) => ({ slug: c.slug, name: c.name })),
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

const REPLY = 'Jasně, koukám na to. Návrh pro Pavla je připravený, stačí ho otevřít v úkolech a podržet tlačítko\n\n## Přehled klientů\n\n| Klient | Týden | Stav | Další hovor |\n|---|---|---|---|\n| Pavel Sedláček | 5 z 12 | Neodpovídá 9 dní | sobota 14:00 |\n| Lucie Nováková | 8 z 12 | Chybí měření | dnes 19:36 |\n| Jana Horáková | 11 z 12 | V pořádku | úterý 10:00 |\n\nZačal bych **Pavlem**, zabere to minutu';

export function mockSocket(message: Record<string, unknown>, emit: (m: Record<string, unknown>) => void): void {
  if (message.type !== 'claude-command') return;
  const sessionId = (message.options as { sessionId?: string }).sessionId || 'ukazka-nova';
  emit({ kind: 'session_created', newSessionId: sessionId, sessionId });
  if (String(message.command || '').includes('analýz')) {
    // Kolo se ohlásí jako hotové, agent běží dál a model pak dopíše odpověď.
    emit({ kind: 'text', role: 'assistant', sessionId, content: 'Spouštím analýzu na pozadí' });
    emit({ kind: 'complete', sessionId, backgroundTasks: 1 });
    setTimeout(() => {
      emit({ kind: 'stream_delta', sessionId, content: 'Analýza je hotová' });
      emit({ kind: 'text', role: 'assistant', sessionId, content: 'Analýza je hotová' });
      emit({ kind: 'complete', sessionId });
    }, 2500);
    return;
  }
  const words = REPLY.split(' ');
  const pause = 1800;
  emit({ kind: 'tool_use', sessionId, toolId: 'u1', toolName: 'Grep' });
  setTimeout(() => emit({ kind: 'tool_result', sessionId, toolId: 'u1' }), 900);
  words.forEach((word, index) => {
    setTimeout(() => emit({ kind: 'stream_delta', sessionId, content: `${word} ` }), pause + index * 45);
  });
  setTimeout(() => {
    emit({ kind: 'text', role: 'assistant', sessionId, content: REPLY });
    emit({ kind: 'complete', sessionId });
  }, pause + 300 + words.length * 45);
}

const UKAZKA_VYSTUP = [
  '## Včera na callech',
  '',
  '- **Honza Novák:** domluvili nový ceník, nabídku pošle do **pátku**',
  '- **Petra Malá:** drhne natáčení, potřebuje scénáře',
  '',
  '## Na nás',
  '',
  '1. Poslat Honzovi šablonu nabídky',
  '2. Petře **tři scénáře** do středy',
].join('\n');
const UKAZKA_RUTINA = {
  name: 'ranni-souhrn-hovoru',
  title: 'Ranní souhrn hovorů',
  prompt: 'Projdi hovory od minulého pracovního dne a napiš, kdo s kým co řešil.',
  schedule: { kind: 'cron', expr: '0 8 * * 1-5' },
  kdy: 'v pracovní dny 08:00',
  enabled: true,
  notion: false,
  posledni: { id: 2, status: 'ok', at: new Date(Date.now() - 3 * 3600e3).toISOString(), vystup: UKAZKA_VYSTUP, chyba: null },
};
const UKAZKA_SABLONY = [
  { id: 'rano', title: 'Ranní souhrn hovorů', sub: 'V pracovní dny v 8:00 přehled, co se včera na callech řešilo', schedule: { kind: 'cron', expr: '0 8 * * 1-5' }, prompt: 'Projdi hovory od minulého pracovního dne a napiš, kdo s kým co řešil.' },
  { id: 'hovor', title: 'Souhrn po hovoru', sub: 'Hned jak je hovor zapsaný, co se na něm řešilo', schedule: { kind: 'po_hovoru' }, prompt: 'Napiš do šesti řádků, co se na hovoru řešilo.' },
];

function mockRoutines(path: string, options: { method?: string }): unknown {
  if (options.method && options.method !== 'GET') return { ok: true, rutina: UKAZKA_RUTINA };
  if (path.endsWith('/rutiny')) return { rutiny: [UKAZKA_RUTINA], sablony: UKAZKA_SABLONY, notifikace: true, pasmo: 'Europe/Prague' };
  return {
    rutina: UKAZKA_RUTINA,
    behy: [
      UKAZKA_RUTINA.posledni,
      { id: 1, status: 'skipped', at: new Date(Date.now() - 27 * 3600e3).toISOString(), vystup: null, chyba: null },
    ],
  };
}
