/**
 * Beyond Brain — the boards.
 *
 * Two views over work that already exists elsewhere: who on the team is
 * carrying what, and where each client stands. Both are drag and drop —
 * a task dragged onto a person becomes theirs, a client dragged into a column
 * stays there until someone moves it back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RotateCw } from 'lucide-react';

import { Column, Empty, Tabs, Avatar } from '../ui';
import { TaskCard } from './TaskCard';
import { ClientCard } from './ClientCard';
import { fetchBoard, moveClient, type BoardData } from './api';
import { patchTask } from '../velin/api';
import type { Task } from '../velin/api';

const TAB_KEY = 'beyond:board-tab';
const UNASSIGNED = '__nikdo__';

export default function BoardPage({ onOpenClient, onOpenTask }: { onOpenClient: (slug: string) => void; onOpenTask: () => void }) {
  const [tab, setTab] = useState<string>(() => localStorage.getItem(TAB_KEY) || 'lide');
  const [data, setData] = useState<BoardData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchBoard());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'nenačetlo se');
    }
  }, []);

  useEffect(() => {
    void load();
    timer.current = window.setInterval(() => void load(), 90_000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [load]);

  useEffect(() => { localStorage.setItem(TAB_KEY, tab); }, [tab]);

  if (err && !data) {
    return (
      <div className="bb-scr">
        <header className="bb-scr__h"><h1>Tabule</h1></header>
        <Empty>Nepovedlo se načíst: {err}</Empty>
      </div>
    );
  }

  return (
    <div className="bb-scr">
      <header className="bb-scr__h">
        <h1>Tabule</h1>
        <Tabs items={[{ key: 'lide', label: 'Tým' }, { key: 'klienti', label: 'Klienti' }]} value={tab} onChange={setTab} />
        <button type="button" className="bb-ib" title="Načíst znovu" aria-label="Načíst znovu" disabled={busy} onClick={() => void load()}>
          <RotateCw size={15} strokeWidth={1.9} />
        </button>
      </header>
      {!data ? (
        <Empty>Načítám…</Empty>
      ) : tab === 'lide' ? (
        <TeamBoard data={data} onReload={load} onOpenTask={onOpenTask} setBusy={setBusy} />
      ) : (
        <ClientPipeline data={data} onReload={load} onOpenClient={onOpenClient} setBusy={setBusy} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the team                                                            */
/* ------------------------------------------------------------------ */

const ORDER = (t: Task) => {
  const state = t.state === 'work' ? 0 : t.state === 'none' ? 1 : 2;
  const over = t.dueKind === 'over' ? 0 : t.dueKind === 'today' ? 1 : 2;
  return `${state}${t.priority}${over}${t.due || '9999'}`;
};

function TeamBoard({ data, onReload, onOpenTask, setBusy }: { data: BoardData; onReload: () => Promise<void>; onOpenTask: () => void; setBusy: (b: boolean) => void }) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const columns = useMemo(() => {
    const cols = data.people.map((p) => ({ key: p.key, person: p, tasks: [] as Task[] }));
    const other = { key: UNASSIGNED, person: null, tasks: [] as Task[] };
    const known = new Set(cols.map((c) => c.key));
    for (const t of data.tasks) {
      if (t.state === 'done' && !showDone) continue;
      const col = known.has(t.owner) ? cols.find((c) => c.key === t.owner) : null;
      (col || other).tasks.push(t);
    }
    for (const c of [...cols, other]) c.tasks.sort((a, b) => ORDER(a).localeCompare(ORDER(b)));
    return other.tasks.length ? [...cols, other] : cols;
  }, [data, showDone]);

  const assign = async (taskId: string, owner: string) => {
    setBusy(true);
    try {
      await patchTask(taskId, { owner });
      await onReload();
    } catch {
      /* the next poll shows the truth */
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (task: Task, next: Task['state']) => {
    setBusy(true);
    try {
      await patchTask(task.id, { state: next });
      await onReload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="bb-board">
        {columns.map((col) => (
          <Column
            key={col.key}
            title={col.person ? col.person.displayName : 'Nikoho'}
            count={col.tasks.length}
            accent={col.person ? <Avatar name={col.person.displayName} src={col.person.avatar} size={22} dim={col.person.key !== data.me} /> : undefined}
            dropActive={over === col.key}
            onDragOver={(e) => { e.preventDefault(); setOver(col.key); }}
            onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData('text/beyond-task');
              if (id && col.person) void assign(id, col.person.key);
            }}
          >
            {col.tasks.length === 0 ? (
              <Empty>Nic tu není.</Empty>
            ) : (
              col.tasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  dragging={drag === t.id}
                  onOpen={onOpenTask}
                  onToggle={(next) => void toggle(t, next)}
                  onDragStart={(e) => { e.dataTransfer.setData('text/beyond-task', t.id); e.dataTransfer.effectAllowed = 'move'; setDrag(t.id); }}
                  onDragEnd={() => setDrag(null)}
                />
              ))
            )}
          </Column>
        ))}
      </div>
      <div className="bb-scr__f">
        <button type="button" className="bb-pill bb-pill--sm" onClick={() => setShowDone((v) => !v)}>
          {showDone ? 'Skrýt hotové' : 'Ukázat hotové'}
        </button>
        <button type="button" className="bb-pill bb-pill--sm" onClick={onOpenTask}>
          <Plus size={13} strokeWidth={2} /> Úkol
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the clients                                                         */
/* ------------------------------------------------------------------ */

function ClientPipeline({ data, onReload, onOpenClient, setBusy }: { data: BoardData; onReload: () => Promise<void>; onOpenClient: (slug: string) => void; setBusy: (b: boolean) => void }) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const move = async (slug: string, stage: string) => {
    setBusy(true);
    try {
      const current = data.clients.find((c) => c.slug === slug);
      // Dropping a card back where the signals would have put it is a way of
      // saying "follow them again", not a second hand placement.
      await moveClient(slug, current && current.derived === stage ? null : stage);
      await onReload();
    } catch {
      /* the next poll shows the truth */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bb-board">
      {data.stages.map((stage) => {
        const cards = data.clients.filter((c) => c.stage === stage.key);
        return (
          <Column
            key={stage.key}
            title={stage.label}
            count={cards.length}
            accent={<span className={`bb-dot bb-dot--${stage.key}`} aria-hidden="true" />}
            dropActive={over === stage.key}
            onDragOver={(e) => { e.preventDefault(); setOver(stage.key); }}
            onDragLeave={() => setOver((o) => (o === stage.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const slug = e.dataTransfer.getData('text/beyond-client');
              if (slug) void move(slug, stage.key);
            }}
          >
            {cards.length === 0 ? (
              <Empty>{stage.hint}</Empty>
            ) : (
              cards.map((c) => (
                <ClientCard
                  key={c.slug}
                  client={c}
                  dragging={drag === c.slug}
                  onOpen={() => onOpenClient(c.slug)}
                  onDragStart={(e) => { e.dataTransfer.setData('text/beyond-client', c.slug); e.dataTransfer.effectAllowed = 'move'; setDrag(c.slug); }}
                  onDragEnd={() => setDrag(null)}
                />
              ))
            )}
          </Column>
        );
      })}
    </div>
  );
}
