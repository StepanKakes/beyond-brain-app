import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button, Glass, SegmentedControl } from 'glisse';

import { api } from './api';
import { Icon } from './icons';
import { enablePush, pushStatus, type PushStatus } from './push';
import { navigate } from './router';
import { mutate, readCache, refresh, useResource, writeCache } from './store';
import type { Call, CallsResponse, Task, TasksResponse, VelinResponse } from './types';
import {
  BarButton,
  Empty,
  Picker,
  Section,
  Sheet,
  Skeleton,
  SwipeRow,
  TabScreen,
  deleteWithUndo,
  timeOf,
  toast,
} from './ui';

export const TASKS_KEY = 'ukoly';
export const TASKS_PATH = '/api/beyond/velin/ukoly';
export const CALLS_KEY = 'hovory';
export const CALLS_PATH = '/api/beyond/velin/calls?days=21';
const VELIN_KEY = 'velin';
const VELIN_PATH = '/api/beyond/velin/';
const WHO_KEY = 'dnes.who';

/** Server posílá přihlášeného někdy jako klíč, jindy jako celou osobu. */
export function meKey(data: TasksResponse | null | undefined): string | null {
  const me = data?.me;
  if (!me) return null;
  return typeof me === 'string' ? me : me.key;
}

export function patchLocal(id: string, patch: Partial<Task>): void {
  mutate<TasksResponse>(TASKS_KEY, (current) =>
    current && { ...current, tasks: current.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)) },
  );
}

export async function setTaskState(id: string, state: Task['state']): Promise<void> {
  // Odškrtnutí se projeví hned a server to potvrdí až potom.
  const before = readCache<TasksResponse>(TASKS_KEY)?.tasks.find((task) => task.id === id)?.state;
  patchLocal(id, { state });
  try {
    await api(`${TASKS_PATH}/${encodeURIComponent(id)}`, { method: 'PATCH', body: { state } });
    if (state === 'done') {
      toast('Hotovo', {
        label: 'Vrátit',
        run: () => void setTaskState(id, before && before !== 'done' ? before : 'none'),
      });
    }
  } catch (error) {
    patchLocal(id, { state: before ?? 'none' });
    toast((error as Error).message || 'Úkol se nepodařilo uložit');
  }
}

export function removeTask(task: Task, afterHide?: () => void): void {
  let snapshot: Task[] | null = null;
  deleteWithUndo({
    text: 'Úkol smazán',
    hide: () => {
      mutate<TasksResponse>(TASKS_KEY, (current) => {
        if (!current) return current;
        snapshot = current.tasks;
        return { ...current, tasks: current.tasks.filter((t) => t.id !== task.id) };
      });
      afterHide?.();
    },
    restore: () => {
      mutate<TasksResponse>(TASKS_KEY, (current) => current && { ...current, tasks: snapshot ?? current.tasks });
    },
    commit: () => api(`${TASKS_PATH}/${encodeURIComponent(task.id)}`, { method: 'DELETE' }),
  });
}

const PREP_LABEL: Record<string, string> = {
  zprava: 'Zpráva',
  navrh: 'Návrh zprávy',
  podklad: 'Podklad',
  obsah: 'Obsah',
};

export function TaskRow({ task, showOwner }: { task: Task; showOwner?: string | null }) {
  const done = task.state === 'done';
  const meta = [showOwner, task.client?.name].filter(Boolean).join(' · ');
  return (
    <SwipeRow label="Smazat" disabled={task.virtual} onAction={() => removeTask(task)}>
      <div className={`m-row m-task${done ? ' is-done' : ''}`}>
        <button
          type="button"
          className={`m-check p${task.priority}${task.state === 'work' ? ' is-work' : ''}`}
          role="checkbox"
          aria-checked={done}
          aria-label={done ? 'Vrátit mezi nehotové' : 'Označit jako hotové'}
          onClick={() => void setTaskState(task.id, done ? 'none' : 'done')}
        />
        <button type="button" className="m-row-main" onClick={() => navigate(`/m/ukol/${encodeURIComponent(task.id)}`)}>
          <span className="m-row-title">{task.text}</span>
          {task.dueLabel || meta || task.prep ? (
            <span className="m-task-meta">
              {task.dueLabel ? <span className={task.dueKind === 'over' ? 'is-over' : undefined}>{task.dueLabel}</span> : null}
              {meta ? <span className="m-task-who">{meta}</span> : null}
              {task.prep ? <span className="m-task-prep">{PREP_LABEL[task.prep.kind] || 'Připraveno'}</span> : null}
            </span>
          ) : null}
        </button>
      </div>
    </SwipeRow>
  );
}

function NextCall({ call }: { call: Call }) {
  const soon = call.live || (call.startsInMin !== null && call.startsInMin <= 15);
  const when = call.live
    ? 'Právě probíhá'
    : call.startsInMin !== null && call.startsInMin < 60
      ? `Za ${Math.max(1, call.startsInMin)} min`
      : `Dnes v ${timeOf(call.startIso)}`;
  const name = call.clientName || call.title;
  return (
    <div className="m-next">
      <button
        type="button"
        className="m-next-main"
        onClick={() => navigate(call.clientSlug ? `/m/klient/${encodeURIComponent(call.clientSlug)}` : '/m/hovory')}
      >
        <span className={`m-row-sub${call.live ? ' is-live' : ''}`}>{when}</span>
        <span className="m-next-title" title={name}>
          {name}
        </span>
      </button>
      {soon && call.meetingUrl ? (
        <a className="m-pill is-solid" href={call.meetingUrl} target="_blank" rel="noreferrer">
          Připojit
        </a>
      ) : null}
    </div>
  );
}

type Parsed = {
  priority: number;
  due: string | null;
  clientName: string | null;
  owner: string;
  text: string;
  tokens?: ParsedToken[];
};

type ParsedToken = { i: number; word: string; kind: 'priority' | 'due' | 'owner' | 'client' };

/** Text úkolu s rozpoznanými slovy zvýrazněnými přímo v řádku, leží pod průhledným polem. */
function Highlighted({ text, tokens }: { text: string; tokens: ParsedToken[] }) {
  let index = -1;
  return (
    <>
      {text.split(/(\s+)/).map((part, at) => {
        if (!part.trim()) return part;
        index += 1;
        const token = tokens.find((t) => t.i === index && t.word === part);
        if (!token) return part;
        const hot = token.kind === 'priority' && /[12]$/.test(part);
        return (
          <mark key={at} className={`m-token${hot ? ' is-hot' : ''}`}>
            {part}
          </mark>
        );
      })}
      {'\u200b'}
    </>
  );
}

/** Den podle telefonu, stejně jako to, co appka ukazuje jako dnešek. */
function localDay(offset: number): string {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

function dueLabel(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const days = Math.round((date.getTime() - new Date().setHours(12, 0, 0, 0)) / 86400000);
  if (days === 0) return 'Dnes';
  if (days === 1) return 'Zítra';
  return date.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

function AddTask({
  owner,
  people,
  defaultDue,
  onClose,
}: {
  owner: string | null;
  people: TasksResponse['people'];
  /** Den, který úkol dostane, když v textu žádný není. Jde jedním klepnutím zrušit. */
  defaultDue: string | null;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [fallbackDue, setFallbackDue] = useState(defaultDue);
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [who, setWho] = useState(owner);
  const [picking, setPicking] = useState(false);
  const seq = useRef(0);

  // Co appka v textu rozpoznala, ukazuje průběžně přímo v poli.
  useEffect(() => {
    const quick = text.trim();
    if (!quick) {
      setParsed(null);
      return undefined;
    }
    const mine = (seq.current += 1);
    const timer = setTimeout(() => {
      api<Parsed>(`${TASKS_PATH}/parse`, { method: 'POST', body: { quick, owner: who || undefined } })
        .then((result) => {
          if (mine === seq.current) setParsed(result);
        })
        .catch(() => undefined);
    }, 90);
    return () => clearTimeout(timer);
  }, [text, who]);

  const submit = async () => {
    const quick = text.trim();
    if (!quick || busy) return;
    setBusy(true);
    try {
      await api(TASKS_PATH, { method: 'POST', body: { quick, owner: who || undefined, defaultDue: fallbackDue || undefined } });
      await refresh(TASKS_KEY, TASKS_PATH);
      onClose();
    } catch (error) {
      toast((error as Error).message);
      setBusy(false);
    }
  };

  const whoName = people.find((p) => p.key === who)?.displayName;
  const chips = [
    parsed?.due ? dueLabel(parsed.due) : null,
    parsed && parsed.priority < 4 ? `Priorita ${parsed.priority}` : null,
    parsed?.clientName || null,
  ].filter((chip): chip is string => Boolean(chip));
  // Klepnutí v listu nesmí sebrat fokus, klávesnice by sjela a list s ní.
  const keepFocus = (event: ReactPointerEvent) => event.preventDefault();

  return (
    <Sheet title="Nový úkol" onClose={onClose}>
      <form
        className="m-add"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Glass className="m-add-field">
          <div className="m-add-input">
            <div className="m-add-mirror" aria-hidden="true">
              <Highlighted text={text} tokens={parsed?.tokens || []} />
            </div>
            <textarea
              autoFocus
              rows={1}
              value={text}
              onChange={(event) => setText(event.target.value.replace(/\n/g, ' '))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder="p1 zítra zavolat Pavlovi"
              aria-label="Text úkolu"
              enterKeyHint="done"
            />
          </div>
          <button
            type="submit"
            className="m-send"
            aria-label="Přidat"
            disabled={!text.trim() || busy}
            onPointerDown={keepFocus}
          >
            <Icon name="up" size={20} />
          </button>
        </Glass>
        {picking ? (
          <div className="m-add-people" role="listbox" aria-label="Komu">
            {people.map((person) => (
              <button
                key={person.key}
                type="button"
                role="option"
                aria-selected={person.key === who}
                className={`m-pill${person.key === who ? ' is-solid' : ''}`}
                onPointerDown={keepFocus}
                onClick={() => {
                  setWho(person.key);
                  setPicking(false);
                }}
              >
                {person.displayName}
              </button>
            ))}
          </div>
        ) : (
          <div className="m-add-chips">
            {people.length > 1 ? (
              <button type="button" className="m-pill" onPointerDown={keepFocus} onClick={() => setPicking(true)}>
                <Icon name="person" size={15} />
                <span>{whoName || 'Přiřadit'}</span>
              </button>
            ) : null}
            {!parsed?.due && fallbackDue ? (
              <button
                type="button"
                className="m-pill"
                aria-label={`${dueLabel(fallbackDue)}, klepnutím zrušíš termín`}
                onPointerDown={keepFocus}
                onClick={() => setFallbackDue(null)}
              >
                <span>{dueLabel(fallbackDue)}</span>
                <Icon name="close" size={13} />
              </button>
            ) : null}
            {chips.map((chip) => (
              <span key={chip} className="m-pill is-passive" title={chip}>
                {chip}
              </span>
            ))}
          </div>
        )}
      </form>
    </Sheet>
  );
}

type Scope = 'dnes' | 'brzy' | 'vse';

function savedWho(): string | null {
  return readCache<string>(WHO_KEY);
}

function dayLabel(iso: string, today: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const start = new Date(`${today}T12:00:00`);
  const days = Math.round((date.getTime() - start.getTime()) / 86400000);
  if (days === 1) return 'Zítra';
  return date.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
}

const byPriority = (list: Task[]) => list.slice().sort((a, b) => a.priority - b.priority);

const PUSH_CARD_KEY = 'm-karta-push';

/** Nainstalovat, nebo zapnout notifikace. Jde zavřít natrvalo. */
function PushCard() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(PUSH_CARD_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    void pushStatus().then(setStatus).catch(() => setStatus('unsupported'));
  }, []);
  if (hidden || (status !== 'needs-install' && status !== 'off')) return null;

  const install = status === 'needs-install';
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(PUSH_CARD_KEY, '1');
    } catch {
      /* ukáže se příště znovu */
    }
  };
  const act = () => {
    if (install) {
      window.location.assign('/instalace');
      return;
    }
    enablePush()
      .catch((error: Error) => toast(error.message))
      .finally(() => void pushStatus().then(setStatus));
  };

  return (
    <Section>
      <div className="m-karta">
        <strong>{install ? 'Přidej si Brain na plochu' : 'Zapni si notifikace'}</strong>
        <p>
          {install
            ? 'Poběží přes celou obrazovku a bude ti posílat notifikace'
            : 'Dám ti vědět, až doběhne rutina nebo na tebe něco čeká'}
        </p>
        <div className="m-karta-akce">
          <Button variant="glass" onClick={close}>
            Teď ne
          </Button>
          <Button variant="filled" onClick={act}>{install ? 'Jak na to' : 'Zapnout'}</Button>
        </div>
      </div>
    </Section>
  );
}

export function TodayScreen() {
  const tasks = useResource<TasksResponse>(TASKS_KEY, TASKS_PATH);
  const calls = useResource<CallsResponse>(CALLS_KEY, CALLS_PATH);
  const velin = useResource<VelinResponse>(VELIN_KEY, VELIN_PATH);
  const [adding, setAdding] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showAllSignals, setShowAllSignals] = useState(false);
  const [scope, setScope] = useState<Scope>('dnes');
  const [who, setWhoState] = useState<string | null>(savedWho);

  const me = meKey(tasks.data);
  const person = who || me;
  const people = tasks.data?.people || [];
  const setWho = (value: string) => {
    setWhoState(value);
    writeCache(WHO_KEY, value);
  };

  const mine = useMemo(() => {
    const all = tasks.data?.tasks || [];
    if (person === 'tym') return all;
    return all.filter((task) => !person || !task.owner || task.owner === person || task.owner === 'all');
  }, [tasks.data, person]);

  const today = tasks.data?.today || new Date().toISOString().slice(0, 10);

  const groups = useMemo(() => {
    const open = mine.filter((t) => t.state !== 'done');
    const dated = open.filter((t) => t.due && t.dueKind === '').sort((a, b) => String(a.due).localeCompare(String(b.due)));
    return {
      ready: byPriority(open.filter((t) => t.virtual && t.prep)),
      over: byPriority(open.filter((t) => !(t.virtual && t.prep) && t.dueKind === 'over')),
      work: byPriority(open.filter((t) => !(t.virtual && t.prep) && t.state === 'work' && t.dueKind !== 'over')),
      today: byPriority(open.filter((t) => !(t.virtual && t.prep) && t.state === 'none' && t.dueKind === 'today')),
      dated,
      none: byPriority(open.filter((t) => !(t.virtual && t.prep) && t.state === 'none' && !t.due)),
      done: mine.filter((t) => t.state === 'done'),
    };
  }, [mine]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    const list = (calls.data?.days || []).flatMap((d) => d.calls).filter((c) => !c.block);
    const next = list.find((c) => c.live || new Date(c.endIso).getTime() > now);
    if (!next) return null;
    return next.startIso.slice(0, 10) === today || next.live ? next : null;
  }, [calls.data, today]);

  const signals = useMemo(() => [...(velin.data?.needsUs || []), ...(velin.data?.risks || [])], [velin.data]);

  const subtitle = new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
  const ownerName = (key: string) => people.find((p) => p.key === key)?.displayName || null;
  const owner = (task: Task) => (person === 'tym' ? ownerName(task.owner) : null);
  const row = (task: Task) => <TaskRow key={task.id} task={task} showOwner={owner(task)} />;
  const dueByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    groups.dated.forEach((task) => {
      const key = String(task.due).slice(0, 10);
      map.set(key, [...(map.get(key) || []), task]);
    });
    return [...map.entries()];
  }, [groups.dated]);

  const whoLabel =
    person === 'tym' ? 'Celý tým' : person && person !== me ? ownerName(person) || 'Někdo jiný' : null;
  const emptyToday =
    tasks.data && !groups.ready.length && !groups.over.length && !groups.work.length && !groups.today.length;

  return (
    <TabScreen
      title="Dnes"
      subtitle={whoLabel ? `${subtitle} · ${whoLabel}` : subtitle}
      action={
        people.length > 1 ? (
          <BarButton icon={person === 'tym' ? 'team' : 'person'} label="Čí úkoly" onClick={() => setChoosing(true)} />
        ) : undefined
      }
    >
      <PushCard />
      <div className="m-scope">
        <SegmentedControl
          aria-label="Které úkoly"
          value={scope}
          onValueChange={(value) => setScope(value as Scope)}
          items={[
            { value: 'dnes', label: 'Dnes' },
            { value: 'brzy', label: 'Nadcházející' },
            { value: 'vse', label: 'Vše' },
          ]}
        />
      </div>

      {!tasks.data && !tasks.error ? <Skeleton /> : null}
      {!tasks.data && tasks.error ? <Empty title="Úkoly se nenačetly">{tasks.error}</Empty> : null}

      {scope === 'dnes' ? (
        <>
          {upcoming ? <NextCall call={upcoming} /> : null}
          {groups.ready.length ? <Section title="Ke schválení">{groups.ready.map(row)}</Section> : null}
          {groups.over.length ? (
            <Section title="Po termínu" tone="danger">
              {groups.over.map(row)}
            </Section>
          ) : null}
          {groups.work.length ? <Section title="Rozpracované">{groups.work.map(row)}</Section> : null}
          {groups.today.length ? <Section title="Na dnes">{groups.today.map(row)}</Section> : null}
          {emptyToday ? <Empty title="Na dnes máš hotovo">Nic dalšího teď nečeká</Empty> : null}
          {signals.length ? (
            <Section title="Klienti, kteří potřebují pozornost">
              {(showAllSignals ? signals : signals.slice(0, 3)).map((signal) => (
                <button
                  key={`${signal.type}-${signal.clientSlug}-${signal.title}`}
                  type="button"
                  className="m-row m-signal"
                  onClick={() => {
                    if (signal.clientSlug) navigate(`/m/klient/${encodeURIComponent(signal.clientSlug)}`);
                  }}
                >
                  <span className={`m-severity ${signal.severity}`} aria-hidden="true" />
                  <span className="m-link-text">
                    <span className="m-row-title">{signal.clientName ? `${signal.clientName}: ${signal.title}` : signal.title}</span>
                    {signal.detail ? <span className="m-row-sub">{signal.detail}</span> : null}
                  </span>
                </button>
              ))}
              {signals.length > 3 && !showAllSignals ? (
                <button type="button" className="m-row m-row-more" onClick={() => setShowAllSignals(true)}>
                  Zobrazit všech {signals.length}
                </button>
              ) : null}
            </Section>
          ) : null}
        </>
      ) : null}

      {scope === 'brzy' ? (
        <>
          {tasks.data && !dueByDay.length ? <Empty title="Nic naplánovaného">Úkoly s termínem se objeví tady</Empty> : null}
          {dueByDay.map(([day, list]) => (
            <Section key={day} title={dayLabel(day, today)}>
              {list.map(row)}
            </Section>
          ))}
        </>
      ) : null}

      {scope === 'vse' ? (
        <>
          {groups.ready.length ? <Section title="Ke schválení">{groups.ready.map(row)}</Section> : null}
          {groups.over.length ? (
            <Section title="Po termínu" tone="danger">
              {groups.over.map(row)}
            </Section>
          ) : null}
          {groups.work.length ? <Section title="Rozpracované">{groups.work.map(row)}</Section> : null}
          {groups.today.length ? <Section title="Na dnes">{groups.today.map(row)}</Section> : null}
          {dueByDay.map(([day, list]) => (
            <Section key={day} title={dayLabel(day, today)}>
              {list.map(row)}
            </Section>
          ))}
          {groups.none.length ? <Section title="Bez termínu">{groups.none.map(row)}</Section> : null}
          {groups.done.length ? (
            <button type="button" className="m-disclosure" onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Skrýt hotové' : `Hotové (${groups.done.length})`}
            </button>
          ) : null}
          {showDone && groups.done.length ? <Section>{groups.done.map(row)}</Section> : null}
        </>
      ) : null}

      <button type="button" className="m-fab" aria-label="Nový úkol" onClick={() => setAdding(true)}>
        <Icon name="plus" size={26} />
      </button>
      {adding ? (
        <AddTask
          owner={person === 'tym' ? me : person}
          people={people}
          defaultDue={scope === 'brzy' ? localDay(1) : localDay(0)}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {choosing ? (
        <Picker
          title="Čí úkoly"
          value={person}
          options={[
            ...people.map((p) => ({ value: p.key, label: p.key === me ? `${p.displayName} (já)` : p.displayName })),
            { value: 'tym', label: 'Celý tým' },
          ]}
          onPick={setWho}
          onClose={() => setChoosing(false)}
        />
      ) : null}
    </TabScreen>
  );
}
