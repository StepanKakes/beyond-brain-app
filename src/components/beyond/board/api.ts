import { authenticatedFetch } from '../../../utils/api';
import type { Task } from '../velin/api';

export type BoardPerson = { key: string; displayName: string; avatar: string };

export type Stage = { key: string; label: string; hint: string };

export type BoardClient = {
  slug: string;
  name: string;
  initials: string;
  stav: string | null;
  isActive: boolean;
  programWeek: number | null;
  totalWeeks: number | null;
  daysToEnd: number | null;
  openOurs: number;
  openTheirs: number;
  lastCallIso: string | null;
  nextCall: { startIso: string } | null;
  worst: string | null;
  ownCounts: { critical: number; watch: number };
  signals: { title: string; detail?: string; severity?: string }[];
  /** Where the card sits, and whether a person put it there. */
  stage: string;
  derived: string;
  manual: boolean;
  by: string | null;
};

export type BoardData = {
  me: string;
  today: string;
  people: BoardPerson[];
  tasks: Task[];
  stages: Stage[];
  clients: BoardClient[];
};

export async function fetchBoard(): Promise<BoardData> {
  const res = await authenticatedFetch('/api/beyond/velin/tabule');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

export async function moveClient(slug: string, stage: string | null): Promise<void> {
  const res = await authenticatedFetch(`/api/beyond/velin/tabule/klient/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
}
