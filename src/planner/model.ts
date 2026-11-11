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
  Naplánováno: 'teal',
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
  return next === 'Opravit' ? order[at + 2] || null : next || null;
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

/* Obsah vychází pro české publikum, proto planner počítá všechny dny a časy
   v Praze, i když je člověk zrovna jinde ve světě. */
export const PRAHA = 'Europe/Prague';

/** Den v Praze jako YYYY-MM-DD. */
export function prahaDen(when: Date | string = new Date()): string {
  return new Date(when).toLocaleDateString('sv-SE', { timeZone: PRAHA });
}

/** Den v Praze posunutý o počet dní. */
export function prahaDenZa(dni: number): string {
  return prahaDen(new Date(Date.now() + dni * 86400000));
}

/** Čas zadaný v Praze (YYYY-MM-DDTHH:mm) jako okamžik ISO. */
export function zPrahy(local: string): string {
  const odhad = new Date(`${local}:00Z`);
  const praha = new Date(odhad.toLocaleString('en-US', { timeZone: PRAHA }));
  const utc = new Date(odhad.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(odhad.getTime() - (praha.getTime() - utc.getTime())).toISOString();
}

/** Je člověk v jiném pásmu než Praha, třeba na cestách? */
export function jinePasmo(iso: string): boolean {
  const d = new Date(iso);
  return d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: PRAHA }) !==
    d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

/** Místní čas u člověka, když není v Česku. */
export function mistniCas(iso: string): string {
  const d = new Date(iso);
  const den = d.toLocaleDateString('sv-SE') !== prahaDen(d) ? `${denLabel(d.toLocaleDateString('sv-SE'))} ` : '';
  return `${den}${d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`;
}

/** „zítra v 18:00 českého času“, na cestách i s místním časem. */
export function kdyPopis(iso: string): string {
  const zaklad = `${kdyLabel(iso)} v ${casLabel(iso)} českého času`;
  return jinePasmo(iso) ? `${zaklad}, u tebe ${mistniCas(iso)}` : zaklad;
}

export function todayIso(): string {
  return prahaDen();
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

/* Fáze pro oko. Data drží stavy z Notionu (dva druhy nápadu, Opravit), ale
   člověk vidí jednu cestu: nápad, natočeno, střih, review, vydáno. Opravit je
   review, které se vrátilo, ne další krok. */
export type Faze = 'napad' | 'natoceno' | 'strih' | 'review' | 'naplanovano' | 'vydano';

export const FAZE: { key: Faze; label: string; tone: string }[] = [
  { key: 'napad', label: 'Nápady', tone: 'purple' },
  { key: 'natoceno', label: 'Natočeno', tone: 'blue' },
  { key: 'strih', label: 'Střih', tone: 'yellow' },
  { key: 'review', label: 'Review', tone: 'pink' },
  { key: 'naplanovano', label: 'Naplánováno', tone: 'teal' },
  { key: 'vydano', label: 'Vydáno', tone: 'green' },
];

export function fazeKarty(stav: string): Faze {
  if (stav === 'Natočeno') return 'natoceno';
  if (stav === 'Střih') return 'strih';
  if (stav === 'Review' || stav === 'Opravit') return 'review';
  if (stav === 'Naplánováno') return 'naplanovano';
  if (stav === 'Vydáno') return 'vydano';
  return 'napad';
}

/** Stav, který se uloží, když kartu někdo pošle do fáze. */
export function stavProFazi(faze: Faze, card: Pick<PlannerCard, 'platforma'>): string {
  switch (faze) {
    case 'napad':
      return card.platforma === 'Youtube' ? 'YouTube nápad' : 'Reels nápad';
    case 'natoceno':
      return 'Natočeno';
    case 'strih':
      return 'Střih';
    case 'review':
      return 'Review';
    case 'naplanovano':
      return 'Naplánováno';
    default:
      return 'Vydáno';
  }
}

export function dalsiFaze(faze: Faze): Faze | null {
  const at = FAZE.findIndex((f) => f.key === faze);
  return at >= 0 && at < FAZE.length - 1 ? FAZE[at + 1].key : null;
}

const DNY = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];

/** „út 11. 11.“, u jiného roku i s rokem. */
export function denLabel(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const base = `${DNY[date.getDay()]} ${day}. ${month}.`;
  return year === new Date().getFullYear() ? base : `${base} ${year}`;
}

/** Relativně, kde to jde: dnes, zítra, včera, jinak den. */
export function kdyLabel(iso: string): string {
  // Okamžik (s časem) se počítá podle dne v Praze, samotné datum se bere, jak je.
  const day = iso.length > 10 ? prahaDen(iso) : iso.slice(0, 10);
  const today = todayIso();
  const shift = (by: number) => prahaDenZa(by);
  if (day === today) return 'dnes';
  if (day === shift(1)) return 'zítra';
  if (day === shift(-1)) return 'včera';
  return denLabel(day);
}

export function casLabel(isoDateTime: string): string {
  return new Date(isoDateTime).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: PRAHA });
}

/** Příspěvek na Instagram, jak ho vrací Beo přes server brainu. */
export type IgPost = {
  id: string;
  typ: 'foto' | 'reel' | 'carousel';
  stav: 'ceka' | 'zpracovava' | 'publikovano' | 'chyba' | 'zruseno';
  naplanovano_na: string;
  publikovano_at: string | null;
  permalink: string | null;
  chyba: string | null;
  popisek: string;
  /** Trial reel: nejdřív jen lidem, kteří účet nesledují. */
  trial?: 'manual' | 'auto' | null;
  /** Krátce platná adresa média, dokud leží v Beovi. */
  nahled_url?: string | null;
};

export const IG_PATH = `${PLANNER_PATH}/instagram`;
