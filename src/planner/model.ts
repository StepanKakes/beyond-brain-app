// Content planner: tvar dat a čisté výpočty, společné pro web i mobil.

export type PlannerCard = {
  id: string;
  nazev: string;
  stav: string;
  platforma: string | null;
  format: string | null;
  cil: string | null;
  cta: string | null;
  styl: string | null;
  kdo: string[];
  datum: string | null;
  misto: string | null;
  reviewLink: string | null;
  soubor: string | null;
  text: string;
  notionUrl?: string | null;
  createdAt?: string;
};

export type PlannerOptions = {
  stav: string[];
  platforma: string[];
  format: string[];
  cil: string[];
  cta: string[];
  styl: string[];
  kdo: string[];
};

export type NotionImport = { at: string; added: number; skipped: number; total: number; error: string | null } | null;

export type PlannerResponse = {
  karty: PlannerCard[];
  options: PlannerOptions;
  notionImport: NotionImport;
};

export type Request = <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;

export const PLANNER_PATH = '/api/beyond/velin/planner';

/** Barvy stavů drží to, na co je tým zvyklý z Notionu. */
export const STAV_TONE: Record<string, string> = {
  'Reels nápad': 'purple',
  'YouTube nápad': 'gray',
  Natočeno: 'blue',
  Střih: 'yellow',
  Review: 'pink',
  Opravit: 'red',
  Vydáno: 'green',
};

/** Co už se točí nebo stříhá a ještě nemá den, to patří vedle kalendáře. */
export const NEEDS_DATE = ['Natočeno', 'Střih', 'Review', 'Opravit'];

export const platformLabel = (value: string | null): string => (value === 'Youtube' ? 'YouTube' : value || '');

export function nextStav(stav: string, order: string[]): string | null {
  if (stav === 'Reels nápad' || stav === 'YouTube nápad') return 'Natočeno';
  if (stav === 'Opravit') return 'Review';
  const at = order.indexOf(stav);
  if (at < 0) return null;
  const next = order[at + 1];
  // Opravit je návrat zpět, ne další krok.
  return next === 'Opravit' ? 'Vydáno' : next || null;
}

/** Karty ve sloupci: nejbližší datum nahoře, vydané od nejnovějšího. */
export function sortCards(cards: PlannerCard[], stav: string): PlannerCard[] {
  const stamp = (card: PlannerCard) => card.datum || card.createdAt?.slice(0, 10) || '';
  const sorted = [...cards];
  if (stav === 'Vydáno') return sorted.sort((a, b) => stamp(b).localeCompare(stamp(a)));
  return sorted.sort((a, b) => {
    if (a.datum && b.datum) return a.datum.localeCompare(b.datum);
    if (a.datum) return -1;
    if (b.datum) return 1;
    return stamp(b).localeCompare(stamp(a));
  });
}

export function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function todayIso(): string {
  return isoDay(new Date());
}

/** Celé týdny měsíce od pondělí, i se dny ze sousedních měsíců. */
export function monthGrid(year: number, month: number): { iso: string; day: number; inMonth: boolean }[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  return Array.from({ length: total }, (_, index) => {
    const date = new Date(year, month, index - lead + 1);
    return { iso: isoDay(date), day: date.getDate(), inMonth: date.getMonth() === month };
  });
}

export function shortDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const label = `${day}. ${month}.`;
  return year === new Date().getFullYear() ? label : `${label} ${year}`;
}

export function monthLabel(year: number, month: number): string {
  const text = new Date(year, month, 1).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' });
  return text.charAt(0).toLocaleUpperCase('cs') + text.slice(1);
}

export function isUrl(value: string | null): boolean {
  return Boolean(value && /^https?:\/\//i.test(value));
}
