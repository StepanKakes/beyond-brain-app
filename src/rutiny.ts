// Rutiny, společné pro mobil a počítač: tvary z API a převod rozvrhu na volby
// ve formuláři. Vzhled si drží každý klient sám.

export type RutinaSchedule =
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; weekday: number; time: string }
  | { kind: 'cron'; expr: string }
  | { kind: 'po_hovoru' }
  | { kind: string; [key: string]: unknown };

export type RutinaBeh = {
  id: number;
  status: string;
  at: string;
  vystup: string | null;
  chyba: string | null;
};

export type Rutina = {
  name: string;
  title: string;
  prompt: string;
  schedule: RutinaSchedule;
  kdy: string;
  enabled: boolean;
  notion: boolean;
  /** Společná pro tým: dá se jen číst, ne upravit. */
  system?: boolean;
  posledni: RutinaBeh | null;
};

export type RutinaSablona = {
  id: string;
  title: string;
  sub: string;
  prompt: string;
  schedule: RutinaSchedule;
};

export type RutinyList = { rutiny: Rutina[]; sablony: RutinaSablona[]; notifikace: boolean; pasmo: string | null };
export type RutinaDetail = { rutina: Rutina; behy: RutinaBeh[] };
export type RutinaDraft = { title: string; prompt: string; schedule: RutinaSchedule; notion: boolean };

export type Kdy = 'denne' | 'pracovni' | 'tyden' | 'hovor' | 'jine';
export type KdyVolba = { kdy: Kdy; time: string; weekday: number };

export const KDY_MOZNOSTI: { value: Kdy; label: string }[] = [
  { value: 'pracovni', label: 'V pracovní dny' },
  { value: 'denne', label: 'Každý den' },
  { value: 'tyden', label: 'Jednou týdně' },
  { value: 'hovor', label: 'Po každém hovoru' },
];

export const DNY: { value: string; label: string }[] = [
  { value: '1', label: 'Pondělí' },
  { value: '2', label: 'Úterý' },
  { value: '3', label: 'Středa' },
  { value: '4', label: 'Čtvrtek' },
  { value: '5', label: 'Pátek' },
  { value: '6', label: 'Sobota' },
  { value: '0', label: 'Neděle' },
];

const WORKDAYS = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/;
const pad = (value: string | number) => String(value).padStart(2, '0');

/** Rozvrh na volby ve formuláři. Co formulář neumí (založené z chatu), zůstane `jine`. */
export function kdyZRozvrhu(schedule: RutinaSchedule): KdyVolba {
  const base = { time: '08:00', weekday: 1 };
  if (schedule.kind === 'po_hovoru') return { ...base, kdy: 'hovor' };
  if (schedule.kind === 'daily') return { ...base, kdy: 'denne', time: String(schedule.time) };
  if (schedule.kind === 'weekly') {
    return { kdy: 'tyden', time: String(schedule.time), weekday: Number(schedule.weekday) };
  }
  const workdays = schedule.kind === 'cron' ? WORKDAYS.exec(String(schedule.expr)) : null;
  if (workdays) return { ...base, kdy: 'pracovni', time: `${pad(workdays[2])}:${pad(workdays[1])}` };
  return { ...base, kdy: 'jine' };
}

/** Volby zpět na rozvrh. `null` u `jine` znamená rozvrh neměnit. */
export function rozvrhZKdy({ kdy, time, weekday }: KdyVolba): RutinaSchedule | null {
  if (kdy === 'hovor') return { kind: 'po_hovoru' };
  if (kdy === 'denne') return { kind: 'daily', time };
  if (kdy === 'tyden') return { kind: 'weekly', weekday, time };
  if (kdy === 'pracovni') {
    const [hour, minute] = time.split(':').map(Number);
    return { kind: 'cron', expr: `${minute} ${hour} * * 1-5` };
  }
  return null;
}

export function kdyPopis(volba: KdyVolba): string {
  return KDY_MOZNOSTI.find((option) => option.value === volba.kdy)?.label || 'Vlastní rozvrh';
}

export function behDatum(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Starší výstupy jsou prostý text po řádcích a markdown by je slil do jednoho. */
export function behMarkdown(vystup: string): string {
  return vystup.replace(/\n(?!\n)/g, '  \n');
}

export function behPopis(beh: RutinaBeh): string {
  if (beh.status === 'running') return 'Právě běží';
  if (beh.status === 'skipped') return 'Nebylo co hlásit';
  return beh.chyba || beh.vystup || '';
}
