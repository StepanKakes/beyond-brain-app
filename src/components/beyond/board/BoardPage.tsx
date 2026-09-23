/**
 * Beyond Brain — the boards.
 *
 * Two views over work that already exists elsewhere: who on the team is
 * carrying what, and where each client stands. Both are drag and drop —
 * a task dragged onto a person becomes theirs, a client dragged into a column
 * stays there until someone moves it back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Column, Empty, Avatar } from '../ui';
import { TaskCard } from './TaskCard';
import { ClientCard } from './ClientCard';
import { fetchBoard, moveClient, type BoardData } from './api';
import { patchTask, createQuick } from '../velin/api';
import type { Task } from '../velin/api';

const UNASSIGNED = '__nikdo__';

/** The board itself; the velín owns the switch between its faces. */
export default function BoardPage({ mode, onOpenClient }: { mode: 'lide' | 'stav' | 'klienti'; onOpenClient: (slug: string) => void }) {
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

  if (err && !data) return <Empty>Nepovedlo se načíst: {err}</Empty>;
  if (!data) return <Empty>Načítám…</Empty>;

  if (mode === 'lide') return <TeamBoard data={data} onReload={load} setBusy={setBusy} />;
  if (mode === 'stav') return <StateBoard data={data} onReload={load} setBusy={setBusy} />;
  return <ClientPipeline data={data} onReload={load} onOpenClient={onOpenClient} setBusy={setBusy} />;
}

/* ------------------------------------------------------------------ */
/* the team                                                            */
/* ------------------------------------------------------------------ */

const ORDER = (t: Task) => {
  const state = t.state === 'work' ? 0 : t.state === 'none' ? 1 : 2;
  const over = t.dueKind === 'over' ? 0 : t.dueKind === 'today' ? 1 : 2;
  return `${state}${t.priority}${over}${t.due || '9999'}`;
};

function TeamBoard({ data, onReload, setBusy }: { data: BoardData; onReload: () => Promise<void>; setBusy: (b: boolean) => void }) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

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
            onAdd={col.person ? () => setAdding(col.key) : undefined}
            addLabel="Úkol"
            onDragOver={(e) => { e.preventDefault(); setOver(col.key); }}
            onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData('text/beyond-task');
              if (id && col.person) void assign(id, col.person.key);
            }}
          >
            {adding === col.key && col.person && (
              <AddCard owner={col.person.key} onDone={async () => { setAdding(null); await onReload(); }} onCancel={() => setAdding(null)} />
            )}
            {col.tasks.length === 0 ? (
              <Empty>Nic tu není.</Empty>
            ) : (
              col.tasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  dragging={drag === t.id}
                  onOpen={() => { /* the card opens where it lives, in the list */ }}
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
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* by state                                                            */
/* ------------------------------------------------------------------ */

const STATES: { key: Task['state']; label: string; hint: string }[] = [
  { key: 'none', label: 'Čeká', hint: 'Co se ještě nezačalo' },
  { key: 'work', label: 'Dělá se', hint: 'Co je rozdělané' },
  { key: 'done', label: 'Hotovo', hint: 'Co je za námi' },
];

/** The same tasks read the other way: what waits, what runs, what is done. */
function StateBoard({ data, onReload, setBusy }: { data: BoardData; onReload: () => Promise<void>; setBusy: (b: boolean) => void }) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const byPerson = useMemo(() => new Map(data.people.map((p) => [p.key, p])), [data.people]);

  const move = async (id: string, state: Task['state']) => {
    setBusy(true);
    try {
      await patchTask(id, { state });
      await onReload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bb-board">
      {STATES.map((st) => {
        const cards = data.tasks.filter((t) => t.state === st.key).sort((a, b) => ORDER(a).localeCompare(ORDER(b)));
        return (
          <Column
            key={st.key}
            title={st.label}
            count={cards.length}
            accent={<span className={`bb-dot bb-dot--${st.key}`} aria-hidden="true" />}
            dropActive={over === st.key}
            onAdd={st.key === 'none' ? () => setAdding(st.key) : undefined}
            addLabel="Úkol"
            onDragOver={(e) => { e.preventDefault(); setOver(st.key); }}
            onDragLeave={() => setOver((o) => (o === st.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData('text/beyond-task');
              if (id) void move(id, st.key);
            }}
          >
            {adding === st.key && (
              <AddCard owner={data.me} onDone={async () => { setAdding(null); await onReload(); }} onCancel={() => setAdding(null)} />
            )}
            {cards.length === 0 ? (
              <Empty>{st.hint}</Empty>
            ) : (
              cards.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  person={byPerson.get(t.owner)}
                  dragging={drag === t.id}
                  onOpen={() => { /* the card opens where it lives, in the list */ }}
                  onToggle={(next) => void move(t.id, next)}
                  onDragStart={(e) => { e.dataTransfer.setData('text/beyond-task', t.id); e.dataTransfer.effectAllowed = 'move'; setDrag(t.id); }}
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

/** One line, Enter adds it. The same words the velín's quick add understands. */
function AddCard({ owner, onDone, onCancel }: { owner: string; onDone: () => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      await createQuick(q, owner);
      await onDone();
    } catch {
      setBusy(false);
    }
  };
  return (
    <div className="bb-c bb-addc">
      <input
        autoFocus
        value={text}
        disabled={busy}
        placeholder="Co je potřeba, třeba: zítra zavolat Kubovi p1"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void submit(); }
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={() => { if (!text.trim()) onCancel(); }}
      />
    </div>
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
