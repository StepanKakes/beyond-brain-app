export type TaskAction = { label: string; action: string; primary?: boolean; path?: string };

export type Prep = {
  kind: 'zprava' | 'navrh' | 'podklad' | 'obsah';
  title: string;
  body: string;
  ref: string;
  canSend?: boolean;
  actions: TaskAction[];
};

export type Task = {
  id: string;
  text: string;
  priority: 1 | 2 | 3 | 4;
  state: 'none' | 'work' | 'done';
  client: { slug: string; name: string } | null;
  owner: string;
  due: string;
  dueLabel: string;
  dueKind: '' | 'today' | 'over';
  note: string;
  prep: Prep | null;
  doneAt: string | null;
  virtual: boolean;
};

export type TasksResponse = {
  me: { key: string; displayName?: string } | null;
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
  live: boolean;
  startsInMin: number;
};

export type CallsResponse = {
  configured: boolean;
  error: string | null;
  live: Call[];
  days: { day: string; calls: Call[] }[];
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
