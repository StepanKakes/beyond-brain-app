export type TaskAction = { label: string; action: string; primary?: boolean; path?: string };

export type Prep = {
  kind: 'zprava' | 'navrh' | 'podklad' | 'obsah';
  title: string;
  body: string;
  ref: string | number;
  canSend?: boolean;
  images?: string[];
  clip?: string | null;
  link?: { label: string; url: string } | null;
  actions: TaskAction[];
};

export type Task = {
  id: string;
  text: string;
  priority: 1 | 2 | 3 | 4;
  state: 'none' | 'work' | 'done';
  client: { slug: string; name: string } | null;
  owner: string;
  due: string | null;
  dueLabel: string | null;
  dueKind: '' | 'today' | 'over';
  note: string | null;
  prep: Prep | null;
  doneAt: string | null;
  virtual: boolean;
};

export type TasksResponse = {
  me: string | { key: string; displayName?: string } | null;
  today: string;
  people: { key: string; displayName: string }[];
  clients: { slug: string; name: string }[];
  tasks: Task[];
};

export type Call = {
  id: string;
  uid: string;
  title: string;
  startIso: string;
  endIso: string;
  durationMin: number;
  meetingUrl: string | null;
  clientName: string | null;
  clientSlug?: string | null;
  host?: { key: string; name: string } | null;
  attendees?: { name: string; email: string }[];
  block?: boolean;
  live: boolean;
  startsInMin: number | null;
};

export type CallsResponse = {
  configured: boolean;
  error: string | null;
  live: Call[];
  days: { day: string; calls: Call[] }[];
  people?: { key: string; displayName: string }[];
  me?: string;
};

export type Proposal = {
  id: number;
  kind: string;
  clientSlug: string | null;
  clientName: string | null;
  channel: string;
  target: string | null;
  title: string;
  body: string;
  reason: string | null;
  status: 'pending' | 'sent' | 'rejected' | 'failed' | 'expired';
  error: string | null;
};

export type ProposalsResponse = {
  canSend: boolean;
  pending: Proposal[];
  recent: Proposal[];
};

export type ChatSession = { uuid: string; title: string; lastUsedAt: number; slug: string; clientName?: string };

export type SessionIndex = {
  slug: string;
  activeUuid: string | null;
  sessions: { uuid: string; title: string; lastUsedAt: number }[];
};

export type Severity = 'critical' | 'watch';

export type Signal = {
  type: string;
  severity: Severity;
  title: string;
  detail: string;
  meaning?: string;
  clientSlug?: string;
  clientName?: string;
};

export type VelinResponse = {
  me: { key: string; displayName: string } | null;
  needsUs: Signal[];
  risks: Signal[];
};

export type Counts = { velin?: number; klienti?: number; obsah?: number; navrhy?: number };

export type BoardClient = {
  slug: string;
  name: string;
  stav: string | null;
  isActive: boolean;
  programWeek: number | null;
  totalWeeks: number | null;
  daysToEnd: number | null;
  notionUrl: string | null;
  openOurs: number;
  openTheirs: number;
  openFlags: number;
  lastCallIso: string | null;
  nextCall: Call | null;
  score: number;
  worst: Severity | null;
  counts: { critical: number; watch: number };
  signals: Signal[];
};

export type ClientPromise = { text: string; dueIso: string | null; person: string | null };
export type ClientFlag = { severity: 'critical' | 'watch' | 'ok'; title: string; stav: string | null; open: boolean; body: string };
export type TimelineItem = {
  kind: 'call' | 'whatsapp' | 'fathom' | 'booked';
  dateIso: string;
  title: string;
  excerpt: string;
  future?: boolean;
};

export type ClientResponse = {
  client: BoardClient & {
    measurements: { isoWeek: string; range: string | null; values: Record<string, number | null> }[];
    promises: { ours: ClientPromise[]; theirs: ClientPromise[] };
    flags: ClientFlag[];
    daysSinceLastCall: number | null;
  };
  signals: Signal[];
  timeline: TimelineItem[];
  calls: Call[];
};

export type ObsahItem = {
  id: string;
  kind: 'reel' | 'story';
  state: 'navrh' | 'schvaleno' | 'natoceno' | 'zverejneno' | 'zahozeno';
  title: string | null;
  hook: string | null;
  why: string | null;
  caption: string | null;
  client: string | null;
  quote?: string | null;
  speaker?: string | null;
  text?: string | null;
  slides?: string[];
  studio?: { url: string | null; renders: string[] } | null;
  clip?: { status: 'cutting' | 'ready' | 'error'; error?: string } | null;
};

export type KpiMetric = { key: string; area: string; label: string; unit: 'count' | 'czk' | 'pct'; dir: 'max' | 'min' };
export type KpiPeriod = { values: Record<string, number | null>; targets: Record<string, number | null> };
export type KpiResponse = {
  configured: boolean;
  currentWeek: string;
  metrics: KpiMetric[];
  weeks: (KpiPeriod & { week: string; from: string; to: string; status: 'past' | 'current' | 'future' })[];
  months: (KpiPeriod & { month: string })[];
  errors: string[];
};

export type MozekItem = { id: number; before: string | null; after: string; title?: string; reason?: string; path?: string };
