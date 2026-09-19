import { authenticatedFetch } from '../../../utils/api';

/**
 * Beyond Brain velín — typed reads of `/api/beyond/velin`.
 *
 * Everything here is derived from the brain repo, so a failed fetch means the
 * dashboard cannot say anything true and the callers show that rather than an
 * empty list. An empty list and "we could not look" are different facts.
 */

export type Severity = 'critical' | 'watch';

export type Signal = {
  type: string;
  severity: Severity;
  title: string;
  detail: string;
  meaning: string;
  actor?: 'us' | 'agent';
  person?: string | null;
  days?: number;
  count?: number;
  clientSlug?: string;
  clientName?: string;
};

export type SystemicCondition = {
  type: string;
  title: string;
  meaning: string | null;
  count: number;
  total: number;
  severity: Severity;
  clients: { slug: string; name: string; severity: Severity }[];
};

export type Call = {
  id: number;
  uid: string;
  title: string;
  startIso: string;
  endIso: string;
  durationMin: number | null;
  status: string;
  meetingUrl: string | null;
  eventSlug: string | null;
  host: { key: string | null; name: string } | null;
  attendees: { name: string; email: string }[];
  clientSlug: string | null;
  clientName: string | null;
  live: boolean;
  startsInMin: number | null;
};

export type Person = { key: string; displayName: string };

export type Velin = {
  builtAt: string;
  brainPath: string;
  exists: boolean;
  me: Person | null;
  people: Person[];
  needsUs: Signal[];
  risks: Signal[];
  agent: Signal[];
  systemic: SystemicCondition[];
  calls: {
    configured: boolean;
    error: string | null;
    today: Call[];
    live: Call[];
    next: Call | null;
  };
  totals: { clients: number; finished: number; critical: number; needsUs: number };
};

export type MetricValues = Record<string, number | null>;

export type BoardClient = {
  slug: string;
  name: string;
  initials: string;
  stav: string | null;
  isActive: boolean;
  programWeek: number | null;
  totalWeeks: number | null;
  daysToEnd: number | null;
  endIso: string | null;
  priceCzk: number | null;
  notionUrl: string | null;
  spine: string[];
  latestWeek: { isoWeek: string; range: string | null; values: MetricValues } | null;
  history: { isoWeek: string; values: MetricValues }[];
  openOurs: number;
  openTheirs: number;
  openFlags: number;
  lastInboundIso: string | null;
  waBroken: boolean;
  lastCallIso: string | null;
  nextCall: Call | null;
  score: number;
  worst: Severity | null;
  counts: { critical: number; watch: number };
  /** Severity excluding conditions that hold across the whole roster. */
  ownCounts: { critical: number; watch: number };
  systemicTypes: string[];
  signals: Signal[];
  missing: string[];
};

export type Promise_ = {
  text: string;
  dueIso: string | null;
  originIso: string | null;
  person: string | null;
  section: string;
};

export type Flag = {
  severity: 'critical' | 'watch' | 'ok';
  title: string;
  stav: string | null;
  stavDateIso: string | null;
  open: boolean;
  body: string;
};

export type TimelineItem = {
  kind: 'call' | 'whatsapp' | 'fathom' | 'booked';
  dateIso: string;
  title: string;
  excerpt: string;
  future?: boolean;
};

export type ClientDetail = {
  client: BoardClient & {
    programWeekStated: string | null;
    programWeekStale: boolean;
    hladina: string | null;
    measurements: { isoWeek: string; range: string | null; values: MetricValues }[];
    promises: { ours: Promise_[]; theirs: Promise_[]; signals: string[]; syncedAt: string | null };
    flags: Flag[];
    has: Record<string, boolean>;
    whatsappRaw: { syncedAt: string | null; count: number; syncedButEmpty: boolean; lastInboundIso: string | null } | null;
    notionTasks: { total: number; byStatus: Record<string, number> } | null;
    daysSinceLastCall: number | null;
  };
  signals: Signal[];
  score: number;
  timeline: TimelineItem[];
  calls: Call[];
};

export type CallsPage = {
  configured: boolean;
  error: string | null;
  fetchedAt: string | null;
  live: Call[];
  days: { day: string; calls: Call[] }[];
  people: Person[];
  unmatched: number;
};

async function get<T>(pathname: string): Promise<T> {
  const res = await authenticatedFetch(`/api/beyond/velin${pathname}`);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* keep the status */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const fetchVelin = () => get<Velin>('/');
export const fetchBoard = () => get<{ builtAt: string; clients: BoardClient[] }>('/board');
export const fetchClient = (slug: string) => get<ClientDetail>(`/client/${encodeURIComponent(slug)}`);
export const fetchCalls = (days = 14) => get<CallsPage>(`/calls?days=${days}`);

export async function refreshIndex(): Promise<void> {
  await authenticatedFetch('/api/beyond/velin/refresh', { method: 'POST' });
}
