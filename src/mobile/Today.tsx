import { useMemo, useState } from 'react';
import { Button, Input } from 'glisse';

import { api } from './api';
import { Icon } from './icons';
import { navigate } from './router';
import { mutate, refresh, useResource } from './store';
import type { Call, CallsResponse, Task, TasksResponse } from './types';
import { Empty, Section, Sheet, TabScreen, timeOf, toast } from './ui';

export const TASKS_KEY = 'ukoly';
export const TASKS_PATH = '/api/beyond/velin/ukoly';
export const CALLS_KEY = 'hovory';
export const CALLS_PATH = '/api/beyond/velin/calls?days=14';

export async function setTaskState(id: string, state: Task['state']): Promise<void> {
  // Odškrtnutí se projeví hned a server to potvrdí až potom.
  let before: Task['state'] | undefined;
  mutate<TasksResponse>(TASKS_KEY, (current) =>
    current && {
      ...current,
      tasks: current.tasks.map((task) => {
        if (task.id !== id) return task;
        before = task.state;
        return { ...task, state };
      }),
    },
  );
  try {
    await api(`${TASKS_PATH}/${encodeURIComponent(id)}`, { method: 'PATCH', body: { state } });
  } catch (error) {
    mutate<TasksResponse>(TASKS_KEY, (current) =>
      current && {
        ...current,
        tasks: current.tasks.map((task) => (task.id === id ? { ...task, state: before ?? task.state } : task)),
      },
    );
    toast((error as Error).message || 'Úkol se nepodařilo uložit');
  }
}

function TaskRow({ task }: { task: Task }) {
  const done = task.state === 'done';
  const meta = [task.client?.name, task.dueLabel].filter(Boolean).join(' · ');
  return (
    <div className={`m-row m-task${done ? ' is-done' : ''}`}>
      <button
        type="button"
        className={`m-check p${task.priority}${task.state === 'work' ? ' is-work' : ''}`}
        role="checkbox"
        aria-checked={done}
        aria-label={done ? 'Vrátit mezi nehotové' : 'Označit jako hotové'}
        onClick={() => void setTaskState(task.id, done ? 'none' : 'done')}
      />
      <button
        type="button"
        className="m-row-main"
        onClick={() => navigate(`/m/ukol/${encodeURIComponent(task.id)}`)}
      >
        <span className="m-row-title">{task.text}</span>
        {meta ? (
          <span className={`m-row-sub${task.dueKind === 'over' ? ' is-over' : ''}`}>{meta}</span>
        ) : null}
      </button>
      {task.prep ? <span className="m-dot" title="Připraveno" /> : null}
    </div>
  );
}

function NextCall({ call }: { call: Call }) {
  const when = call.live
    ? 'Právě probíhá'
    : call.startsInMin < 60
      ? `Za ${Math.max(1, call.startsInMin)} min`
      : `V ${timeOf(call.startIso)}`;
  return (
    <button type="button" className="m-next" onClick={() => navigate('/m/hovory')}>
      <span className="m-row-sub">{when}</span>
      <span className="m-row-title">{call.clientName || call.title}</span>
    </button>
  );
}

function AddTask({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const quick = text.trim();
    if (!quick || busy) return;
    setBusy(true);
    try {
      await api(TASKS_PATH, { method: 'POST', body: { quick } });
      await refresh(TASKS_KEY, TASKS_PATH);
      onClose();
    } catch (error) {
      toast((error as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title="Nový úkol" onClose={onClose}>
      <form
        className="m-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          autoFocus
          value={text}
          onValueChange={setText}
          placeholder="p1 dnes zavolat Pavlovi"
          aria-label="Text úkolu"
        />
        <Button type="submit" variant="filled" disabled={!text.trim() || busy}>
          Přidat
        </Button>
      </form>
    </Sheet>
  );
}

export function TodayScreen() {
  const tasks = useResource<TasksResponse>(TASKS_KEY, TASKS_PATH);
  const calls = useResource<CallsResponse>(CALLS_KEY, CALLS_PATH);
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const groups = useMemo(() => {
    const me = tasks.data?.me?.key;
    const mine = (tasks.data?.tasks || []).filter(
      (task) => !me || !task.owner || task.owner === me || task.owner === 'all',
    );
    const sorted = (list: Task[]) => list.slice().sort((a, b) => a.priority - b.priority);
    return {
      work: sorted(mine.filter((t) => t.state === 'work')),
      today: sorted(mine.filter((t) => t.state === 'none' && (t.dueKind === 'today' || t.dueKind === 'over'))),
      later: sorted(mine.filter((t) => t.state === 'none' && t.dueKind === '')),
      done: mine.filter((t) => t.state === 'done'),
    };
  }, [tasks.data]);

  const upcoming = useMemo(() => {
    const all = calls.data?.days.flatMap((d) => d.calls) || [];
    const now = Date.now();
    return all.find((c) => c.live || new Date(c.endIso).getTime() > now) ?? null;
  }, [calls.data]);

  const subtitle = new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
  const nothing = tasks.data && !groups.work.length && !groups.today.length && !groups.later.length;

  return (
    <TabScreen
      title="Dnes"
      subtitle={subtitle}
      action={
        <button type="button" className="m-icon-btn" aria-label="Nový úkol" onClick={() => setAdding(true)}>
          <Icon name="add" />
        </button>
      }
    >
      {upcoming ? <NextCall call={upcoming} /> : null}
      {!tasks.data && tasks.error ? <Empty title="Úkoly se nenačetly">{tasks.error}</Empty> : null}
      {nothing ? <Empty title="Máš hotovo">Nic dalšího teď nečeká</Empty> : null}
      {groups.work.length ? (
        <Section title="Pracuje se">
          {groups.work.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </Section>
      ) : null}
      {groups.today.length ? (
        <Section title="Na dnes">
          {groups.today.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </Section>
      ) : null}
      {groups.later.length ? (
        <Section title="Bez termínu">
          {groups.later.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </Section>
      ) : null}
      {groups.done.length ? (
        <button type="button" className="m-disclosure" onClick={() => setShowDone((v) => !v)}>
          {showDone ? 'Skrýt hotové' : `Hotové (${groups.done.length})`}
        </button>
      ) : null}
      {showDone && groups.done.length ? (
        <Section>
          {groups.done.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </Section>
      ) : null}
      {adding ? <AddTask onClose={() => setAdding(false)} /> : null}
    </TabScreen>
  );
}
