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
  patchObsah,
  prepAct,
  type BoardClient,
  type QuickParse,
  type QuickToken,
  saveSettings,
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
  const name = p?.displayName || (person === 'all' ? 'Všichni' : person);
  if (person === 'all') {
    return <span className="bb-uk__av bb-uk__av--all" title="Všichni">∗</span>;
  }
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
      if (action === 'obsah-schvalit') await patchObsah(String(prep.ref), { state: 'schvaleno' });
      else if (action === 'obsah-zahodit') await patchObsah(String(prep.ref), { state: 'zahozeno' });
      else if (action === 'navrh-odeslat') await prepAct(`/navrhy/${id}/odeslat`);
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
      {prep.images && prep.images.length > 0 && (
        <div className="bb-uk__imgs">
          {prep.images.map((src, i) => (
            <a key={src} href={src} target="_blank" rel="noreferrer" className="bb-uk__img" title={`Slide ${i + 1}, otevřít v plné velikosti`}>
              <img src={src} alt={`Slide ${i + 1}`} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {prep.link && (
        <a className="bb-uk__link" href={prep.link.url} target="_blank" rel="noreferrer">{prep.link.label}</a>
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

function TaskRow({ task, people, clients, me, onState, onRemove, onReload, onOpenFile }: {
  task: Task;
  people: Ukoly['people'];
  clients: Ukoly['clients'];
  me: string;
  onState: (task: Task, next: Task['state']) => void;
  onRemove: (task: Task) => void;
  onReload: () => void;
  onOpenFile: (path: string) => void;
}) {
  const [pop, setPop] = useState(false);
  const [editing, setEditing] = useState(false);
  const by = task.createdBy === 'agent' || task.createdBy.includes('-') ? 'od brainu' : task.createdBy !== task.owner ? `zadal ${people.find((p) => p.key === task.createdBy)?.displayName || task.createdBy}` : null;
  const fire = (next: Task['state']) => {
    setPop(true);
    setTimeout(() => setPop(false), 400);
    onState(task, next);
  };
  if (editing && !task.virtual) {
    return (
      <div className="bb-uk__row bb-uk__row--edit">
        <TaskEditor task={task} people={people} clients={clients} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onReload(); }} onRemove={() => onRemove(task)} />
      </div>
    );
  }
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
        {task.virtual ? (
          <div className="bb-uk__t">{task.text}</div>
        ) : (
          <button type="button" className="bb-uk__t bb-uk__t--btn" onClick={() => setEditing(true)} title="Upravit">{task.text}</button>
        )}
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

const DUE_QUICK: { label: string; iso: () => string | null }[] = [
  { label: 'bez termínu', iso: () => null },
  { label: 'dnes', iso: () => isoPlus(0) },
  { label: 'zítra', iso: () => isoPlus(1) },
  { label: 'za týden', iso: () => isoPlus(7) },
];

function isoPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Everything about a task in one place: the words, the priority, the day,
 * whose it is (one of us, or everyone), the client. Enter saves, Escape
 * leaves it as it was.
 */
function TaskEditor({ task, people, clients, onClose, onSaved, onRemove }: {
  task: Task;
  people: Ukoly['people'];
  clients: Ukoly['clients'];
  onClose: () => void;
  onSaved: () => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(task.text);
  const [priority, setPriority] = useState<Task['priority']>(task.priority);
  const [due, setDue] = useState<string | null>(task.due);
  const [owner, setOwner] = useState(task.owner);
  const [client, setClient] = useState<string | null>(task.client?.slug ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const patch: Parameters<typeof patchTask>[1] = {};
    if (text.trim() !== task.text) patch.text = text.trim();
    if (priority !== task.priority) patch.priority = priority;
    if (due !== task.due) patch.due = due;
    if (owner !== task.owner) patch.owner = owner;
    if (client !== (task.client?.slug ?? null)) patch.client = client;
    try {
      if (Object.keys(patch).length) await patchTask(task.id, patch);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Nešlo uložit.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="bb-te"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); void save(); }
      }}
    >
      <input id={`bb-te-text-${task.id}`} className="bb-te__text" type="text" value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="Co je potřeba udělat" />
      <div className="bb-te__row">
        <span className="bb-te__l">Priorita</span>
        <div className="bb-te__opts">
          {([1, 2, 3, 4] as Task['priority'][]).map((p) => (
            <button key={p} type="button" className={`bb-te__p bb-uk__chk--p${p}`} aria-pressed={priority === p} onClick={() => setPriority(p)} title={`P${p}`}>P{p}</button>
          ))}
        </div>
      </div>
      <div className="bb-te__row">
        <span className="bb-te__l">Termín</span>
        <div className="bb-te__opts">
          {DUE_QUICK.map((q) => (
            <button key={q.label} type="button" className="bb-pill bb-pill--sm" aria-pressed={due === q.iso()} onClick={() => setDue(q.iso())}>{q.label}</button>
          ))}
          <input id={`bb-te-due-${task.id}`} className="bb-te__date" type="date" value={due || ''} onChange={(e) => setDue(e.target.value || null)} aria-label="Datum" />
        </div>
      </div>
      <div className="bb-te__row">
        <span className="bb-te__l">Komu</span>
        <div className="bb-te__opts">
          {people.map((p) => (
            <button key={p.key} type="button" className="bb-pill bb-pill--sm bb-pill--person" aria-pressed={owner === p.key} onClick={() => setOwner(p.key)}>
              <Avatar person={p.key} people={people} me="" />{p.displayName}
            </button>
          ))}
          <button type="button" className="bb-pill bb-pill--sm" aria-pressed={owner === 'all'} onClick={() => setOwner('all')}>Všichni</button>
        </div>
      </div>
      <div className="bb-te__row">
        <span className="bb-te__l">Klient</span>
        <div className="bb-te__opts">
          <select id={`bb-te-client-${task.id}`} className="bb-te__sel" value={client || ''} onChange={(e) => setClient(e.target.value || null)}>
            <option value="">bez klienta</option>
            {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
      </div>
      {err && <p className="bb-fx__err">{err}</p>}
      <div className="bb-te__acts">
        <button type="button" className="bb-pill bb-pill--sm bb-pill--primary" disabled={busy || !text.trim()} onClick={() => void save()}>Uložit</button>
        <button type="button" className="bb-pill bb-pill--sm" onClick={onClose}>Zrušit</button>
        <button type="button" className="bb-uk__x" style={{ marginLeft: 'auto' }} onClick={onRemove}>smazat</button>
      </div>
    </div>
  );
}

const DAY_WORDS = new Set(['dnes', 'zitra', 'pozitri', 'pondeli', 'po', 'utery', 'ut', 'streda', 'st', 'ctvrtek', 'ct', 'patek', 'pa', 'sobota', 'so', 'nedele', 'ne']);
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * What the browser can tell on its own, before the server answers: priority,
 * day words, a date, an @person. Clients need the server (Czech declension
 * against the client list), so their colour arrives a beat later.
 */
function localTokens(value: string, people: Ukoly['people']): QuickToken[] {
  const out: QuickToken[] = [];
  let i = -1;
  for (const m of value.matchAll(/\S+/g)) {
    i += 1;
    const w = m[0];
    const f = fold(w).replace(/[.,!?]+$/, '');
    if (/^(?:p|!)[1-4]$/.test(f)) out.push({ i, word: w, kind: 'priority' });
    else if (DAY_WORDS.has(f) || /^\d{1,2}\.\d{1,2}\.?$/.test(f)) out.push({ i, word: w, kind: 'due' });
    else if (f.startsWith('@') && people.some((p) => p.key === f.slice(1) || fold(p.displayName) === f.slice(1))) out.push({ i, word: w, kind: 'owner' });
  }
  return out;
}

const DUE_LABEL: Record<string, string> = { dnes: 'Dnes', zitra: 'Zítra', pozitri: 'Pozítří' };

function dueLabel(iso: string | null, word: string | null): string {
  if (word) {
    const f = fold(word).replace(/[.,!?]+$/, '');
    if (DUE_LABEL[f]) return DUE_LABEL[f];
  }
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

/**
 * The quick add, Todoist style: what the words mean lights up as they are
 * typed, the chips below say the same in plain terms, an × on a chip takes
 * the word out, Enter adds.
 */
function QuickAdd({ me, owner, people, onAdded }: { me: string; owner: string; people: Ukoly['people']; onAdded: () => void }) {
  const [value, setValue] = useState('');
  const [parsed, setParsed] = useState<QuickParse | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setParsed(null);
      return;
    }
    timer.current = setTimeout(() => {
      parseQuick(value, owner).then(setParsed).catch(() => setParsed(null));
    }, 90);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, owner]);

  // Colours: the server's reading when it matches the current text, the
  // browser's own reading meanwhile.
  const tokens = useMemo(() => {
    const local = localTokens(value, people);
    if (!parsed) return local;
    const words = value.match(/\S+/g) || [];
    const serverFits = parsed.tokens.every((t) => words[t.i] === t.word);
    if (!serverFits) return local;
    const byIndex = new Map(parsed.tokens.map((t) => [t.i, t]));
    for (const t of local) if (!byIndex.has(t.i)) byIndex.set(t.i, t);
    return [...byIndex.values()].sort((a, b) => a.i - b.i);
  }, [value, parsed, people]);

  const tokenOf = (kind: QuickToken['kind']) => tokens.find((t) => t.kind === kind) || null;

  /** Take a word out of the text, by its index among the words. */
  const removeWord = (index: number) => {
    let i = -1;
    const next = value.replace(/\S+\s*/g, (m) => { i += 1; return i === index ? '' : m; }).replace(/\s{2,}/g, ' ').trimStart();
    setValue(next);
    inputRef.current?.focus();
  };

  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await createQuick(value, owner);
      setValue('');
      setParsed(null);
      onAdded();
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  // The coloured mirror sits under the input and must scroll with it.
  const syncScroll = () => {
    if (mirrorRef.current && inputRef.current) mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
  };

  const ownerName = (key: string) => people.find((p) => p.key === key)?.displayName || key;
  const priorityTok = tokenOf('priority');
  const dueTok = tokenOf('due');
  const ownerTok = tokenOf('owner');
  const clientTok = tokenOf('client');
  const priority = priorityTok ? Number(priorityTok.word.replace(/\D/g, '')) : parsed?.priority || 4;
  const hasText = value.trim().length > 0;

  // The text with each recognised word wrapped, whitespace kept as typed.
  const pieces: { text: string; kind: QuickToken['kind'] | null }[] = [];
  {
    const byIndex = new Map(tokens.map((t) => [t.i, t.kind]));
    let i = -1;
    let last = 0;
    for (const m of value.matchAll(/\S+/g)) {
      i += 1;
      const at = m.index ?? 0;
      if (at > last) pieces.push({ text: value.slice(last, at), kind: null });
      pieces.push({ text: m[0], kind: byIndex.get(i) ?? null });
      last = at + m[0].length;
    }
    if (last < value.length) pieces.push({ text: value.slice(last), kind: null });
  }

  return (
    <div className="bb-qa" data-active={hasText ? 'true' : undefined}>
      <div className="bb-qa__line">
        <div ref={mirrorRef} className="bb-qa__mirror" aria-hidden="true">
          {pieces.map((pc, idx) => pc.kind ? (
            <mark key={idx} className="bb-qa__tok" data-kind={pc.kind} data-p={pc.kind === 'priority' ? pc.text.replace(/\D/g, '') : undefined}>{pc.text}</mark>
          ) : (
            <span key={idx}>{pc.text}</span>
          ))}
        </div>
        <input
          ref={inputRef}
          id="bb-quick"
          className="bb-qa__input"
          type="text"
          value={value}
          placeholder="Přidej úkol, třeba: dnes vlog p1"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void submit(); }
            if (e.key === 'Escape') setValue('');
          }}
        />
      </div>
      <div className="bb-qa__chips">
        <button type="button" className="bb-qa__go" onClick={() => void submit()} disabled={!hasText || busy} aria-label="Přidat úkol" title="Přidat (Enter)">+</button>
        <span className="bb-qa__chip" data-kind="client" title={parsed?.clientName ? 'Klient' : 'Bez klienta'}>
          <span className="bb-qa__ico" aria-hidden="true">{parsed?.clientName ? '◎' : '▢'}</span>
          {parsed?.clientName || 'Schránka'}
          {clientTok && <button type="button" className="bb-qa__x" onClick={() => removeWord(clientTok.i)} aria-label="Odebrat klienta">×</button>}
        </span>
        {dueTok && (
          <span className="bb-qa__chip" data-kind="due">
            <span className="bb-qa__ico" aria-hidden="true">▣</span>
            {dueLabel(parsed?.due ?? null, dueTok.word)}
            <button type="button" className="bb-qa__x" onClick={() => removeWord(dueTok.i)} aria-label="Odebrat termín">×</button>
          </span>
        )}
        {priorityTok && (
          <span className="bb-qa__chip" data-kind="priority" data-p={priority}>
            <span className="bb-qa__ico" aria-hidden="true">⚑</span>
            P{priority}
            <button type="button" className="bb-qa__x" onClick={() => removeWord(priorityTok.i)} aria-label="Odebrat prioritu">×</button>
          </span>
        )}
        {ownerTok && (
          <span className="bb-qa__chip" data-kind="owner">
            <span className="bb-qa__ico" aria-hidden="true">@</span>
            {ownerName(parsed?.owner || ownerTok.word.slice(1))}
            <button type="button" className="bb-qa__x" onClick={() => removeWord(ownerTok.i)} aria-label="Odebrat osobu">×</button>
          </span>
        )}
        {!hasText && (
          <span className="bb-uk__hint">
            Rozumí <code>p1</code> až <code>p4</code>, <code>dnes</code>, <code>zítra</code>, <code>pátek</code>, <code>24.9.</code>, jménům klientů a <code>@{ownerName(people.find((p) => p.key !== owner)?.key || me).toLowerCase()}</code>
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
  // Whose Google calendar is being wired, when the dialog is open.
  const [calFor, setCalFor] = useState<string | null>(null);
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
      if (viewedPerson) return t.owner === viewedPerson || t.owner === 'all';
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

  const rowProps = { people, clients: ukoly.data?.clients || [], me, onState: setState, onRemove: remove, onReload: () => void ukoly.reload(), onOpenFile: openFile };

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
              {calls && (
                <div className="bb-cal">
                  {people.map((p) => (
                    <div key={p.key} className="bb-cal__row">
                      <span className="bb-cal__who">{p.displayName}</span>
                      {calls.calendars?.[p.key] ? (
                        <>
                          <span className="bb-cal__ok">Google kalendář</span>
                          <button type="button" className="bb-cal__btn" onClick={() => setCalFor(p.key)}>změnit</button>
                        </>
                      ) : (
                        <button type="button" className="bb-pill bb-pill--sm" onClick={() => setCalFor(p.key)}>Napojit kalendář</button>
                      )}
                    </div>
                  ))}
                </div>
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
      {calFor && (
        <CalendarDialog
          person={people.find((p) => p.key === calFor) || { key: calFor, displayName: calFor }}
          onClose={() => setCalFor(null)}
          onSaved={() => { setCalFor(null); void velin.reload(); }}
        />
      )}
    </div>
  );
}

/**
 * Wire a person's Google calendar: one secret iCal address, pasted once.
 * No Google project, no consent screen, nothing that expires.
 */
function CalendarDialog({ person, onClose, onSaved }: { person: { key: string; displayName: string }; onClose: () => void; onSaved: () => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = `BEYOND_ICS_${person.key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const save = async (value: string) => {
    setBusy(true);
    setErr(null);
    try {
      await saveSettings({ [key]: value });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Uložení selhalo.');
    } finally {
      setBusy(false);
    }
  };
  const valid = /^https?:\/\/\S+\.ics(\?\S*)?$/i.test(url.trim()) || /^https:\/\/calendar\.google\.com\/calendar\/ical\//i.test(url.trim());
  return (
    <div className="bb-dialog__scrim" onClick={onClose} role="presentation">
      <div className="bb-dialog" role="dialog" aria-modal="true" aria-labelledby="bb-cal-title" onClick={(e) => e.stopPropagation()}>
        <div className="bb-dialog__head" id="bb-cal-title">Kalendář: {person.displayName}</div>
        <div className="bb-dialog__body">
          <ol className="bb-cal__steps">
            <li>Otevři <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer">nastavení Google Kalendáře</a> a vlevo vyber kalendář, ve kterém máš hovory.</li>
            <li>Sjeď na „Integrace kalendáře" a zkopíruj <strong>Tajná adresa ve formátu iCal</strong>.</li>
            <li>Vlož ji sem. Hovory se ukážou do pár minut vedle těch z Cal.com; jako hovor bereme schůzku s dalším účastníkem nebo s odkazem na meet.</li>
          </ol>
          <input
            id="bb-cal-url"
            className="bb-set__in"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics"
            autoFocus
          />
          {err && <p className="bb-fx__err">{err}</p>}
          <div className="bb-set__acts">
            <button type="button" className="bb-pill bb-pill--primary" disabled={busy || !valid} onClick={() => void save(url.trim())}>Napojit</button>
            <button type="button" className="bb-pill" onClick={onClose}>Zrušit</button>
            <button type="button" className="bb-uk__more" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => void save('')}>odpojit</button>
          </div>
        </div>
      </div>
    </div>
  );
}
