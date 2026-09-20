import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createQuick,
  deleteTask,
  editProposal,
  fetchBoard,
  fetchMozekItem,
  fetchUkoly,
  fetchVelin,
  parseQuick,
  patchTask,
  prepAct,
  type BoardClient,
  type QuickParse,
  type Task,
  type Ukoly,
  type Velin,
} from './api';
import { Empty, LiveCall, ago, formatTime, usePolled } from './bits';

/**
 * Beyond Brain — the morning screen.
 *
 * One list of what has to happen today, the calls and the warnings beside
 * it, the clients underneath. A task carries a priority (the colour of its
 * circle), a state (left click: done, right click: in progress), who owns it
 * and who put it there. When the brain has already prepared something for a
 * task (a message, a draft, a rule change) it sits under the task and goes
 * out with one click.
 */

type Props = {
  onOpenClient: (slug: string) => void;
  onOpenCalls: () => void;
  onOpenChat: () => void;
};

const DATE_FMT: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
const ORDER: Record<Task['state'], number> = { work: 0, none: 1, done: 2 };
const DUE: Record<Task['dueKind'], number> = { over: 0, today: 1, '': 2 };

function sortTasks(list: Task[]): Task[] {
  return list.slice().sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.priority - b.priority || DUE[a.dueKind] - DUE[b.dueKind]);
}

function Avatar({ person, people, me }: { person: string; people: Ukoly['people']; me: string }) {
  const p = people.find((x) => x.key === person);
  const [broken, setBroken] = useState(false);
  const name = p?.displayName || person;
  if (p?.avatar && !broken) {
    return <img className={`bb-uk__av${person === me ? ' bb-uk__av--me' : ''}`} src={p.avatar} alt={name} title={name} onError={() => setBroken(true)} />;
  }
  return (
    <span className={`bb-uk__av bb-uk__av--txt${person === me ? ' bb-uk__av--me' : ''}`} title={name}>
      {name[0]}
    </span>
  );
}

const CHECK = (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2.6 6.4 L5.1 8.9 L9.6 3.6" />
  </svg>
);

/**
 * WhatsApp's own markup: *bold*, _italic_, ~strike~, ```mono```, lines that
 * start with "- " or "• " as bullets. Rendered the way the client will see it,
 * because that is what the click approves.
 */
function waHtml(text: string): string {
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  const inline = (t: string) =>
    esc(t)
      .replace(/```([^`]+)```/g, '<code>$1</code>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,!?:;)]|$)/g, '$1<b>$2</b>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,!?:;)]|$)/g, '$1<i>$2</i>')
      .replace(/(^|[\s(])~([^~\n]+)~(?=[\s.,!?:;)]|$)/g, '$1<s>$2</s>');
  const lines = text.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${l}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const raw of lines) {
    const m = /^\s*(?:[-•*]\s+)(.*)$/.exec(raw);
    if (m) {
      list.push(inline(m[1]));
      continue;
    }
    flush();
    out.push(raw.trim() === '' ? '<br>' : `<p>${inline(raw)}</p>`);
  }
  flush();
  return out.join('');
}

function Prep({ task, onDone, onOpenFile }: { task: Task; onDone: () => void; onOpenFile: (path: string) => void }) {
  const prep = task.prep;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(prep?.body || '');
  const [diff, setDiff] = useState<{ removed: string[]; added: string[] } | null>(null);
  const [expanded, setExpanded] = useState(false);
  if (!prep) return null;
  const isMessage = prep.kind === 'zprava';
  const long = (prep.body || '').length > 160 || (prep.body || '').includes('\n');

  const run = async (action: string, path?: string) => {
    setErr(null);
    setBusy(action);
    try {
      const id = Number(prep.ref);
      if (action === 'navrh-odeslat') await prepAct(`/navrhy/${id}/odeslat`);
      else if (action === 'navrh-zahodit') await prepAct(`/navrhy/${id}/zahodit`);
      else if (action === 'navrh-upravit') {
        if (editing) {
          await editProposal(id, draft);
          setEditing(false);
        } else setEditing(true);
        setBusy(null);
        return;
      } else if (action === 'mozek-schvalit') await prepAct(`/agent/mozek/${id}/schvalit`);
      else if (action === 'mozek-zahodit') await prepAct(`/agent/mozek/${id}/zahodit`);
      else if (action === 'mozek-diff') {
        if (diff) setDiff(null);
        else {
          const m = await fetchMozekItem(id);
          if (m) {
            const a = new Set((m.before || '').split('\n'));
            const b = new Set(m.after.split('\n'));
            setDiff({ removed: [...a].filter((l) => l.trim() && !b.has(l)), added: [...b].filter((l) => l.trim() && !a.has(l)) });
          }
        }
        setBusy(null);
        return;
      } else if (action === 'open-file' && path) {
        onOpenFile(path);
        setBusy(null);
        return;
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'nešlo');
    } finally {
      setBusy(null);
    }
  };

  const rows = Math.min(24, Math.max(8, draft.split('\n').length + 2));
  return (
    <div className={`bb-uk__prep${editing || expanded ? ' bb-uk__prep--open' : ''}`}>
      <div className="bb-uk__ph">
        <span className="bb-uk__dot" />
        {prep.title}
        {isMessage && prep.canSend === false && <small>WhatsApp není napojený, odeslat nepůjde</small>}
        {!editing && long && (
          <button type="button" className="bb-uk__expand" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'sbalit' : isMessage ? 'celá zpráva' : 'celý text'}
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea className="bb-uk__edit" value={draft} onChange={(e) => setDraft(e.target.value)} rows={rows} spellCheck />
          <div className="bb-uk__wa bb-uk__wa--preview" aria-label="Náhled jako na WhatsAppu" dangerouslySetInnerHTML={{ __html: waHtml(draft) }} />
        </>
      ) : expanded && isMessage ? (
        <div className="bb-uk__wa" dangerouslySetInnerHTML={{ __html: waHtml(draft) }} />
      ) : expanded ? (
        <div className="bb-uk__pb bb-uk__pb--full">{draft}</div>
      ) : (
        <button type="button" className={`bb-uk__pb${prep.kind === 'navrh' ? ' bb-uk__pb--navrh' : ''}`} onClick={() => long && setExpanded(true)}>{draft}</button>
      )}
      {diff && (
        <pre className="bb-uk__diff">
          {diff.removed.map((l) => `− ${l}`).concat(diff.added.map((l) => `+ ${l}`)).join('\n') || '(jen přesuny řádků)'}
        </pre>
      )}
      <div className="bb-uk__pa">
        {prep.actions.map((a) => (
          <button
            key={a.action}
            type="button"
            className={`bb-pill bb-pill--sm${a.primary ? ' bb-pill--primary' : ''}`}
            disabled={busy != null || (a.action === 'navrh-odeslat' && prep.canSend === false)}
            onClick={() => void run(a.action, a.path)}
          >
            {a.action === 'navrh-upravit' && editing ? 'Uložit text' : a.action === 'mozek-diff' && diff ? 'Skrýt změnu' : a.label}
          </button>
        ))}
        {err && <span className="bb-uk__err">{err}</span>}
      </div>
    </div>
  );
}

function TaskRow({ task, people, me, onState, onRemove, onReload, onOpenFile }: {
  task: Task;
  people: Ukoly['people'];
  me: string;
  onState: (task: Task, next: Task['state']) => void;
  onRemove: (task: Task) => void;
  onReload: () => void;
  onOpenFile: (path: string) => void;
}) {
  const [pop, setPop] = useState(false);
  const by = task.createdBy === 'agent' || task.createdBy.includes('-') ? 'od brainu' : task.createdBy !== task.owner ? `zadal ${people.find((p) => p.key === task.createdBy)?.displayName || task.createdBy}` : null;
  const fire = (next: Task['state']) => {
    setPop(true);
    setTimeout(() => setPop(false), 400);
    onState(task, next);
  };
  return (
    <div className={`bb-uk__row${task.state === 'work' ? ' bb-uk__row--work' : task.state === 'done' ? ' bb-uk__row--done' : ''}`}>
      <button
        type="button"
        className={`bb-uk__chk bb-uk__chk--p${task.priority}${task.state !== 'none' ? ` bb-uk__chk--${task.state}` : ''}${pop ? ' bb-uk__chk--pop' : ''}`}
        aria-label={task.state === 'done' ? 'Vrátit' : 'Hotovo (pravé tlačítko: pracuje se)'}
        title={task.state === 'done' ? 'Vrátit' : 'Levým hotovo, pravým pracuje se'}
        onClick={() => fire(task.state === 'done' ? 'none' : 'done')}
        onContextMenu={(e) => {
          e.preventDefault();
          fire(task.state === 'work' ? 'none' : 'work');
        }}
      >
        {CHECK}
      </button>
      <div className="bb-uk__body">
        <div className="bb-uk__t">{task.text}</div>
        <div className="bb-uk__meta">
          {task.client && <span className="bb-uk__cl">{task.client.name}</span>}
          {task.note && <span>{task.note}</span>}
          {by && <span className={by === 'od brainu' ? 'bb-uk__brain' : ''}>{by}</span>}
          {!task.virtual && (
            <button type="button" className="bb-uk__x" onClick={() => onRemove(task)} aria-label="Smazat úkol">
              smazat
            </button>
          )}
        </div>
      </div>
      <span className="bb-uk__end">
        {task.dueLabel && <span className={`bb-uk__due${task.dueKind ? ` bb-uk__due--${task.dueKind}` : ''}`}>{task.dueLabel}</span>}
        <Avatar person={task.owner} people={people} me={me} />
      </span>
      {task.state !== 'done' && task.prep && <Prep task={task} onDone={onReload} onOpenFile={onOpenFile} />}
    </div>
  );
}

function QuickAdd({ me, owner, people, onAdded }: { me: string; owner: string; people: Ukoly['people']; onAdded: () => void }) {
  const [value, setValue] = useState('');
  const [parsed, setParsed] = useState<QuickParse | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setParsed(null);
      return;
    }
    timer.current = setTimeout(() => {
      parseQuick(value, owner).then(setParsed).catch(() => setParsed(null));
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, owner]);

  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await createQuick(value, owner);
      setValue('');
      setParsed(null);
      onAdded();
    } finally {
      setBusy(false);
    }
  };

  const ownerName = (key: string) => people.find((p) => p.key === key)?.displayName || key;
  return (
    <div className="bb-uk__add">
      <label className="bb-uk__field" htmlFor="bb-quick">
        <span className="bb-uk__plus" aria-hidden="true">+</span>
        <input
          id="bb-quick"
          type="text"
          value={value}
          placeholder="Přidej úkol, třeba: p1 dnes zavolat Pavlovi"
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
      </label>
      <div className="bb-uk__parsed">
        {parsed ? (
          <>
            <span className={`bb-uk__tag bb-uk__tag--p${parsed.priority}`}>P{parsed.priority}</span>
            {parsed.due && <span className="bb-uk__tag">{parsed.due}</span>}
            {parsed.clientName && <span className="bb-uk__tag">{parsed.clientName}</span>}
            <span className="bb-uk__tag">{ownerName(parsed.owner)}</span>
            <span>{parsed.text || '…'}</span>
          </>
        ) : (
          <span className="bb-uk__hint">
            Levým hotovo, pravým pracuje se. Rozumí <code>p1</code> až <code>p4</code>, <code>dnes</code>, <code>zítra</code>, <code>pátek</code>, jménům klientů a <code>@{ownerName(people.find((p) => p.key !== owner)?.key || me).toLowerCase()}</code>
          </span>
        )}
      </div>
    </div>
  );
}

export default function VelinPage({ onOpenClient, onOpenCalls, onOpenChat }: Props) {
  const loadVelin = useCallback(() => fetchVelin(), []);
  const loadUkoly = useCallback(() => fetchUkoly(), []);
  const loadBoard = useCallback(() => fetchBoard(), []);
  const velin = usePolled<Velin>(loadVelin, 120_000);
  const ukoly = usePolled<Ukoly>(loadUkoly, 60_000);
  const board = usePolled<{ builtAt: string; clients: BoardClient[] }>(loadBoard, 180_000);
  // Whose list: a person's key, everyone, or only what the brain prepared.
  const [view, setView] = useState<string>('me');
  const [showDone, setShowDone] = useState(false);
  const [local, setLocal] = useState<Task[] | null>(null);

  const today = useMemo(() => new Date().toLocaleDateString('cs-CZ', DATE_FMT), []);
  const tasks = local || ukoly.data?.tasks || [];
  useEffect(() => {
    setLocal(null);
  }, [ukoly.data]);

  const me = ukoly.data?.me || 'tim';
  const people = ukoly.data?.people || [];
  const viewedPerson = view === 'me' ? me : view === 'all' || view === 'ready' ? null : view;

  const setState = async (task: Task, next: Task['state']) => {
    setLocal((cur) => (cur || tasks).map((t) => (t.id === task.id ? { ...t, state: next } : t)));
    try {
      await patchTask(task.id, { state: next });
    } finally {
      setTimeout(() => void ukoly.reload(), next === 'done' ? 450 : 250);
    }
  };
  const remove = async (task: Task) => {
    setLocal((cur) => (cur || tasks).filter((t) => t.id !== task.id));
    await deleteTask(task.id).catch(() => {});
    void ukoly.reload();
  };
  const openFile = (path: string) => window.dispatchEvent(new CustomEvent('beyond:open-file', { detail: { path } }));

  const visible = sortTasks(
    tasks.filter((t) => {
      if (viewedPerson) return t.owner === viewedPerson;
      if (view === 'ready') return Boolean(t.prep) && t.state !== 'done';
      return true;
    }),
  );
  const work = visible.filter((t) => t.state === 'work');
  const open = visible.filter((t) => t.state === 'none');
  const done = visible.filter((t) => t.state === 'done');

  const calls = velin.data?.calls;
  const risks = (velin.data?.risks || []).slice(0, 4);
  const clients = (board.data?.clients || []).filter((c) => c.isActive !== false);

  const rowProps = { people, me, onState: setState, onRemove: remove, onReload: () => void ukoly.reload(), onOpenFile: openFile };

  return (
    <div className="bb-vel">
      <div className="bb-vel__in bb-uk">
        <header className="bb-vel__head">
          <h1 className="bb-vel__title">{today[0].toUpperCase() + today.slice(1)}</h1>
          <button type="button" className="bb-pill" onClick={onOpenChat}>
            Řekni agentovi
          </button>
        </header>

        {calls?.live.map((c) => <LiveCall key={c.uid} call={c} />)}

        <div className="bb-uk__grid">
          <div>
            <QuickAdd me={me} owner={viewedPerson || me} people={people} onAdded={() => void ukoly.reload()} />
            <div className="bb-uk__filters">
              {people.map((p) => {
                const key = p.key === me ? 'me' : p.key;
                return (
                  <button key={p.key} type="button" className="bb-pill bb-pill--sm bb-pill--person" aria-pressed={view === key} onClick={() => setView(key)}>
                    <Avatar person={p.key} people={people} me="" />
                    {p.key === me ? 'Já' : p.displayName}
                  </button>
                );
              })}
              <button type="button" className="bb-pill bb-pill--sm" aria-pressed={view === 'all'} onClick={() => setView('all')}>Všichni</button>
              <button type="button" className="bb-pill bb-pill--sm" aria-pressed={view === 'ready'} onClick={() => setView('ready')}>Připravené brainem</button>
            </div>

            {ukoly.error && !ukoly.data && <Empty>Úkoly se nenačetly: {ukoly.error}</Empty>}
            {ukoly.loading && !ukoly.data && <p className="bb-vel__sub">Čtu úkoly…</p>}

            {work.length > 0 && (
              <div className="bb-uk__group">
                <p className="bb-uk__gh"><b className="bb-uk__gh--work">Pracuje se</b><span>{work.length}</span></p>
                <div className="bb-uk__box">
                  {work.map((t) => <TaskRow key={t.id} task={t} {...rowProps} />)}
                </div>
              </div>
            )}
            {open.length > 0 && (
              <div className="bb-uk__group">
                <p className="bb-uk__gh"><b>{view === 'all' ? 'Na řadě, všichni' : viewedPerson && viewedPerson !== me ? `Na řadě u ${people.find((p) => p.key === viewedPerson)?.displayName || viewedPerson}` : 'Na řadě'}</b><span>{open.length}</span></p>
                {open.map((t) => <TaskRow key={t.id} task={t} {...rowProps} />)}
              </div>
            )}
            {ukoly.data && work.length === 0 && open.length === 0 && (
              <Empty>{view === 'ready' ? 'Brain teď nic připraveného nemá.' : 'Nic na řadě. Napiš úkol nahoře, nebo počkej, co ráno přinese brain.'}</Empty>
            )}
            {done.length > 0 && (
              <div className="bb-uk__group">
                <p className="bb-uk__gh">
                  <b>Hotovo</b><span>{done.length}</span>
                  <button type="button" onClick={() => setShowDone((v) => !v)}>{showDone ? 'skrýt' : 'ukázat'}</button>
                </p>
                {showDone && done.map((t) => <TaskRow key={t.id} task={t} {...rowProps} />)}
              </div>
            )}
          </div>

          <aside className="bb-uk__rail">
            <div>
              <p className="bb-uk__h">Hovory dnes {calls?.today.length ? <span>{calls.today.length}</span> : null}</p>
              {!calls ? null : !calls.configured ? (
                <Empty>Kalendář není napojený.</Empty>
              ) : calls.error ? (
                <Empty>Cal.com neodpovídá: {calls.error}</Empty>
              ) : calls.today.length === 0 ? (
                <Empty>
                  Dnes žádný hovor.
                  {calls.next && <> Nejbližší {new Date(calls.next.startIso).toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' })} v {formatTime(calls.next.startIso)}.</>}
                </Empty>
              ) : (
                calls.today.map((c) => (
                  <div key={c.uid} className="bb-uk__call">
                    <span className="bb-uk__tm">{formatTime(c.startIso)}</span>
                    <div>
                      <button type="button" className="bb-uk__nm" onClick={() => c.clientSlug && onOpenClient(c.clientSlug)}>
                        {c.clientName || c.title}
                      </button>
                      <div className="bb-uk__w">
                        {c.host?.name || 'neznámý host'}
                        {c.durationMin ? ` · ${c.durationMin} min` : ''}
                        {c.meetingUrl && <> · <a href={c.meetingUrl} target="_blank" rel="noreferrer">připojit</a></>}
                      </div>
                    </div>
                  </div>
                ))
              )}
              {calls?.configured && !calls.error && (
                <button type="button" className="bb-uk__more" onClick={onOpenCalls}>všechny hovory</button>
              )}
            </div>
            <div>
              <p className="bb-uk__h">Pozor</p>
              {risks.length === 0 ? (
                <Empty>Nic nehoří.</Empty>
              ) : (
                <div className="bb-uk__watch">
                  {risks.map((s) => (
                    <button key={`${s.clientSlug}-${s.type}`} type="button" className={`bb-uk__wi${s.severity === 'critical' ? ' bb-uk__wi--crit' : ''}`} onClick={() => s.clientSlug && onOpenClient(s.clientSlug)}>
                      <i />
                      <div>
                        {s.clientName ? `${s.clientName}: ` : ''}{s.title}
                        <small>{s.detail}</small>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>

        <section className="bb-uk__clients">
          <p className="bb-uk__h">Klienti <span>{clients.length}</span><em>týden · tento týden · další hovor</em></p>
          {clients.map((c) => {
            const pct = c.programWeek && c.totalWeeks ? Math.min(100, Math.round((c.programWeek / c.totalWeeks) * 100)) : 0;
            const bar = c.worst === 'critical' ? 'crit' : c.worst === 'watch' ? 'warn' : c.programWeek && c.totalWeeks && c.programWeek >= c.totalWeeks ? 'warn' : '';
            const top = c.signals[0];
            return (
              <button key={c.slug} type="button" className="bb-uk__cl" onClick={() => onOpenClient(c.slug)}>
                <div className="bb-uk__cn">{c.name}<small>{c.lastInboundIso ? `psal ${ago(c.lastInboundIso)}` : c.waBroken ? 'WhatsApp bez zpráv' : 'bez kontaktu'}</small></div>
                <div>
                  <div className="bb-uk__wk"><span>{c.programWeek ? `W${c.programWeek}` : '—'}</span><span>{c.totalWeeks ? `z ${c.totalWeeks}` : ''}</span></div>
                  <div className="bb-uk__bar"><i className={bar} style={{ width: `${pct}%` }} /></div>
                </div>
                <div className="bb-uk__focus">
                  {top ? top.title : 'Bez signálu'}
                  <small>{top ? top.detail : `dlužíme ${c.openOurs}, dluží ${c.openTheirs}`}</small>
                </div>
                <div className="bb-uk__nx">{c.nextCall ? `${new Date(c.nextCall.startIso).toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' })} ${formatTime(c.nextCall.startIso)}` : 'hovor nedomluven'}</div>
              </button>
            );
          })}
        </section>
      </div>
    </div>
  );
}
