import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tabs } from '../ui';
import { fetchFile, saveFile, SaveConflict, type FilePayload } from '../files/api';
import MarkdownDoc from './MarkdownDoc';

/**
 * One editor for every text file the brain shows: the side sheet, its full
 * screen form and the Soubory reader. Three modes: Číst (the rendered note,
 * checkboxes tick), Psát (the source, with a small toolbar) and Půl na půl
 * (source and rendering side by side, only where there is room).
 *
 * Saving is automatic, a second after the last keystroke, and Cmd/Ctrl+S saves
 * now. Each save carries the mtime it is based on, so when the agent rewrote
 * the file in the meantime the editor says so instead of overwriting it.
 */

type Mode = 'read' | 'edit' | 'split';
type Status = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

const AUTOSAVE_MS = 1000;
/** Words a minute of speech for a reel, a touch faster than a lecture. */
const WORDS_PER_SECOND = 2.5;

export default function FileEditor({
  path,
  payload,
  kind,
  allowSplit = false,
  startInEdit = false,
  onOpenPath,
  onSaved,
  onStatus,
}: {
  path: string;
  payload: FilePayload;
  kind: 'markdown' | 'text';
  allowSplit?: boolean;
  startInEdit?: boolean;
  onOpenPath?: (path: string) => void;
  onSaved?: (mtime: string) => void;
  /** So the owner can hold back closing the sheet while a save is running. */
  onStatus?: (status: Status) => void;
}) {
  const editable = payload.writable !== false;
  const [mode, setMode] = useState<Mode>(editable && startInEdit ? 'edit' : 'read');
  const [draft, setDraft] = useState(payload.content);
  const [status, setStatus] = useState<Status>('saved');
  const [message, setMessage] = useState<string | null>(null);
  const [serverMtime, setServerMtime] = useState<string | null>(null);

  const savedRef = useRef(payload.content);
  const mtimeRef = useRef<string | undefined>(payload.mtime);
  const draftRef = useRef(payload.content);
  const statusRef = useRef<Status>('saved');
  const busyRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const setSt = useCallback((s: Status) => {
    statusRef.current = s;
    setStatus(s);
    onStatus?.(s);
  }, [onStatus]);

  const flush = useCallback(async (force?: string) => {
    if (busyRef.current) return;
    const text = draftRef.current;
    if (text === savedRef.current) {
      if (statusRef.current !== 'conflict') setSt('saved');
      return;
    }
    if (statusRef.current === 'conflict' && !force) return;
    busyRef.current = true;
    setSt('saving');
    setMessage(null);
    try {
      const r = await saveFile(path, text, force ?? mtimeRef.current);
      savedRef.current = text;
      mtimeRef.current = r.mtime;
      onSaved?.(r.mtime);
      busyRef.current = false;
      // Typed on while the request ran: go again.
      if (draftRef.current !== text) { setSt('dirty'); void flush(); } else setSt('saved');
    } catch (e) {
      busyRef.current = false;
      if (e instanceof SaveConflict) {
        setServerMtime(e.mtime);
        setSt('conflict');
      } else {
        setMessage((e as Error).message || 'Uložení selhalo');
        setSt('error');
      }
    }
  }, [path, onSaved, setSt]);

  const change = useCallback((next: string) => {
    draftRef.current = next;
    setDraft(next);
    if (statusRef.current !== 'conflict') setSt('dirty');
  }, [setSt]);

  // Autosave after a pause in typing.
  useEffect(() => {
    if (status !== 'dirty' && status !== 'error') return;
    const t = window.setTimeout(() => { void flush(); }, status === 'error' ? 4000 : AUTOSAVE_MS);
    return () => window.clearTimeout(t);
  }, [draft, status, flush]);

  // Closing the sheet or switching files with unsaved text: write it first.
  useEffect(() => () => {
    if (draftRef.current !== savedRef.current && statusRef.current !== 'conflict' && !busyRef.current) {
      void saveFile(path, draftRef.current, mtimeRef.current).catch(() => {});
    }
  }, [path]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (draftRef.current !== savedRef.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // The textarea grows with its text when it is the only column; in split it
  // scrolls on its own. Either way it never shows its own scrollbar twice.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (mode !== 'edit') { ta.style.height = ''; return; }
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(ta.scrollHeight, 0)}px`;
  }, [draft, mode]);

  const take = (mine: boolean) => {
    if (mine) { void flush(serverMtime ?? undefined); return; }
    // Take the version on disk and drop the draft.
    fetchFile(path).then((fresh) => {
      savedRef.current = fresh.content;
      draftRef.current = fresh.content;
      mtimeRef.current = fresh.mtime;
      setDraft(fresh.content);
      setServerMtime(null);
      setSt('saved');
      onSaved?.(fresh.mtime || '');
    }).catch((e: Error) => {
      setMessage(e.message || 'Nejde načíst');
      setSt('error');
    });
  };

  // --- source helpers -------------------------------------------------------
  const apply = (from: number, to: number, text: string, selFrom: number, selTo: number) => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(from, to);
    // execCommand keeps the browser's undo stack; the plain assignment is the fallback.
    const ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
    if (!ok) {
      const v = ta.value;
      change(v.slice(0, from) + text + v.slice(to));
    }
    requestAnimationFrame(() => { ta.setSelectionRange(selFrom, selTo); });
  };

  const wrap = (mark: string, placeholder: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: a, selectionEnd: b, value } = ta;
    const sel = value.slice(a, b) || placeholder;
    const already = value.slice(a - mark.length, a) === mark && value.slice(b, b + mark.length) === mark;
    if (already && a !== b) {
      apply(a - mark.length, b + mark.length, sel, a - mark.length, a - mark.length + sel.length);
      return;
    }
    apply(a, b, mark + sel + mark, a + mark.length, a + mark.length + sel.length);
  };

  /** Put `prefix` at the start of every selected line; take it off when all have it. */
  const linePrefix = (prefix: string, strip?: RegExp) => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: a, selectionEnd: b, value } = ta;
    const start = value.lastIndexOf('\n', a - 1) + 1;
    let end = value.indexOf('\n', b);
    if (end === -1) end = value.length;
    const lines = value.slice(start, end).split('\n');
    const allHave = lines.every((l) => l.startsWith(prefix));
    const next = lines.map((l) => {
      if (allHave) return l.slice(prefix.length);
      return prefix + (strip ? l.replace(strip, '') : l);
    }).join('\n');
    apply(start, end, next, start, start + next.length);
  };

  const link = () => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: a, selectionEnd: b, value } = ta;
    const sel = value.slice(a, b) || 'text';
    const text = `[${sel}](adresa)`;
    apply(a, b, text, a + sel.length + 3, a + sel.length + 9);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void flush(); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**', 'tučně'); return; }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*', 'kurzívou'); return; }
    if (e.key === 'Enter' && !e.shiftKey && !mod && kind === 'markdown') {
      const ta = e.currentTarget;
      if (ta.selectionStart !== ta.selectionEnd) return;
      const pos = ta.selectionStart;
      const value = ta.value;
      const ls = value.lastIndexOf('\n', pos - 1) + 1;
      const line = value.slice(ls, pos);
      const m = /^(\s*)((?:[-*+] \[[ xX]\] )|(?:[-*+] )|(?:(\d+)\. ))/.exec(line);
      if (!m) return;
      e.preventDefault();
      // An empty item ends the list.
      if (line.length === m[0].length) { apply(ls, pos, '', ls, ls); return; }
      const marker = m[3] ? `${Number(m[3]) + 1}. ` : m[2].replace(/\[[xX]\]/, '[ ]');
      const ins = `\n${m[1]}${marker}`;
      apply(pos, pos, ins, pos + ins.length, pos + ins.length);
    }
  };

  const toggleTask = (line: number) => {
    const lines = draftRef.current.split('\n');
    const l = lines[line];
    if (l == null) return;
    const next = /\[ \]/.test(l) ? l.replace('[ ]', '[x]') : l.replace(/\[[xX]\]/, '[ ]');
    if (next === l) return;
    lines[line] = next;
    change(lines.join('\n'));
  };

  // Keep Cmd+S working when the focus is on the buttons or the preview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void flush(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flush]);

  const stats = useMemo(() => (kind === 'markdown' ? speakStats(draft) : null), [draft, kind]);
  const tabs = [
    { key: 'read', label: 'Číst' },
    ...(editable ? [{ key: 'edit', label: 'Psát' }] : []),
    ...(editable && allowSplit && kind === 'markdown' ? [{ key: 'split', label: 'Půl na půl' }] : []),
  ];
  const showTools = mode !== 'read' && kind === 'markdown';

  const source = (
    <textarea
      ref={taRef}
      className="bb-ed__ta"
      data-kind={kind}
      value={draft}
      onChange={(e) => change(e.target.value)}
      onKeyDown={onKeyDown}
      spellCheck={false}
      aria-label="Obsah souboru"
      autoFocus={startInEdit}
    />
  );

  return (
    <div className="bb-ed" data-mode={mode}>
      <div className="bb-ed__bar">
        {tabs.length > 1 && <Tabs label="Režim" items={tabs} value={mode} onChange={(k) => setMode(k as Mode)} />}
        {showTools && (
          <div className="bb-ed__tools" role="toolbar" aria-label="Formátování">
            <Tool label="Nadpis" onClick={() => linePrefix('## ', /^#{1,6} /)}>H</Tool>
            <Tool label="Tučně (Cmd B)" onClick={() => wrap('**', 'tučně')}><b>B</b></Tool>
            <Tool label="Kurzíva (Cmd I)" onClick={() => wrap('*', 'kurzívou')}><i>I</i></Tool>
            <span className="bb-ed__sep" />
            <Tool label="Odrážky" onClick={() => linePrefix('- ', /^(\d+\. |- \[[ xX]\] |[-*+] )/)}>Odrážky</Tool>
            <Tool label="Úkoly s checkboxem" onClick={() => linePrefix('- [ ] ', /^(\d+\. |- \[[ xX]\] |[-*+] )/)}>Úkoly</Tool>
            <Tool label="Citace" onClick={() => linePrefix('> ')}>Citace</Tool>
            <Tool label="Odkaz" onClick={link}>Odkaz</Tool>
          </div>
        )}
        <div className="bb-ed__state" data-status={status} aria-live="polite">
          {stats && <span className="bb-ed__count" title="Odhad mluvení podle počtu slov">{stats}</span>}
          {editable ? <span className="bb-ed__st">{STATUS_LABEL[status]}</span> : <span className="bb-ed__st">Jen ke čtení</span>}
        </div>
      </div>

      {status === 'conflict' && (
        <div className="bb-ed__note" role="alert">
          <span>Soubor se mezitím změnil jinde, nejspíš ho přepsal agent. Tvoje úpravy zatím nejsou uložené.</span>
          <span className="bb-ed__acts">
            <button type="button" className="bb-pill bb-pill--sm" onClick={() => take(false)}>Načíst novou verzi</button>
            <button type="button" className="bb-pill bb-pill--sm" onClick={() => take(true)}>Přepsat mojí</button>
          </span>
        </div>
      )}
      {status === 'error' && message && <div className="bb-ed__note bb-ed__note--err" role="alert"><span>{message}</span></div>}

      <div className="bb-ed__body">
        {mode === 'read' && (
          kind === 'markdown'
            ? <MarkdownDoc content={draft} path={path} onOpenPath={onOpenPath} onToggleTask={editable ? toggleTask : undefined} />
            : <pre className="bb-ed__pre">{draft}</pre>
        )}
        {mode === 'edit' && source}
        {mode === 'split' && (
          <div className="bb-ed__split">
            <div className="bb-ed__pane bb-ed__pane--src">{source}</div>
            <div className="bb-ed__pane bb-ed__pane--view">
              <MarkdownDoc content={draft} path={path} onOpenPath={onOpenPath} onToggleTask={toggleTask} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<Status, string> = {
  saved: 'Uloženo',
  dirty: 'Neuloženo',
  saving: 'Ukládám',
  error: 'Neuloženo, zkusím znovu',
  conflict: 'Konflikt verzí',
};

function Tool({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="bb-ed__tool" title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

/** Words and the speaking time they come to, without the markdown furniture. */
function speakStats(md: string): string {
  const text = md
    .replace(/^---[\s\S]*?\n---\n/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s.*$/gm, ' ')
    .replace(/[*_>#|~-]/g, ' ');
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu)?.length ?? 0;
  const sec = Math.round(words / WORDS_PER_SECOND);
  const time = sec >= 60 ? `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s` : `${sec} s`;
  return `${words} slov, asi ${time}`;
}
