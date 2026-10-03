import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';

import { dirname, fetchFile, saveFile, SaveConflict, type FilePayload } from '../files/api';
import { CommentMarks, commentsPrompt, type NoteComment } from './comments';
import { PROSE } from './MarkdownDoc';

/**
 * One editor for every text file the brain shows: the side sheet, its full
 * screen form and the Soubory reader. A note is the finished page and is also
 * the thing you type in: click anywhere and write, select text and a small bar
 * offers bold, italic, heading, list and link. Markdown typed the usual way
 * (`## `, `- `, `[ ] `, `**x**`) turns into formatting as you go.
 *
 * Saving is automatic, a second after the last keystroke, and Cmd/Ctrl+S saves
 * now. Each save carries the mtime it is based on, so when the agent rewrote
 * the file in the meantime the editor says so instead of overwriting it. The
 * file is only rewritten when you changed something, so a note you merely read
 * is never reformatted behind your back.
 */

type Status = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

const AUTOSAVE_MS = 1000;
/** Words a minute of speech for a reel, a touch faster than a lecture. */
const WORDS_PER_SECOND = 2.5;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

function resolveRelative(fromDir: string, target: string): string {
  const parts: string[] = [];
  const base = target.startsWith('/') ? [] : fromDir ? fromDir.split('/') : [];
  for (const seg of [...base, ...target.replace(/^\//, '').split('/')]) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}

export default function FileEditor({
  path,
  payload,
  kind,
  startInEdit = false,
  onOpenPath,
  onSaved,
  onStatus,
}: {
  path: string;
  payload: FilePayload;
  kind: 'markdown' | 'text';
  startInEdit?: boolean;
  onOpenPath?: (path: string) => void;
  onSaved?: (mtime: string) => void;
  /** So the owner can hold back closing the sheet while a save is running. */
  onStatus?: (status: Status) => void;
}) {
  const editable = payload.writable !== false;
  const isMd = kind === 'markdown';
  // A block of `---` metadata at the top is kept out of the page and put back on save.
  const front = useRef(isMd ? (FRONTMATTER.exec(payload.content)?.[0] ?? '') : '');
  const body = isMd ? payload.content.slice(front.current.length) : payload.content;

  const [draft, setDraft] = useState(payload.content);
  const [status, setStatus] = useState<Status>('saved');
  const [message, setMessage] = useState<string | null>(null);
  const [serverMtime, setServerMtime] = useState<string | null>(null);

  // Comments made on this note, kept between visits until they are sent.
  const storeKey = `beyond:comments:${path}`;
  const [comments, setComments] = useState<NoteComment[]>(() => {
    try { return JSON.parse(localStorage.getItem(storeKey) || '[]') as NoteComment[]; } catch { return []; }
  });
  const commentsRef = useRef<NoteComment[]>(comments);
  const [pop, setPop] = useState<null | { id?: string; quote: string; text: string; x: number; y: number }>(null);

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

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true } }),
      Markdown,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
      CommentMarks.configure({ getComments: () => commentsRef.current }),
      Placeholder.configure({ placeholder: 'Piš…' }),
    ],
    content: isMd ? body : '',
    contentType: 'markdown',
    editable: editable && isMd,
    autofocus: startInEdit && isMd ? 'end' : false,
    editorProps: {
      attributes: { class: 'bb-ed__pm', 'aria-label': 'Obsah souboru', spellcheck: 'true', lang: 'cs' },
    },
    onUpdate: ({ editor: ed }) => {
      change(front.current + ed.getMarkdown());
    },
  }, [path]);

  // Keep the comments, and redraw their highlights when they change.
  useEffect(() => {
    commentsRef.current = comments;
    try {
      if (comments.length) localStorage.setItem(storeKey, JSON.stringify(comments));
      else localStorage.removeItem(storeKey);
    } catch { /* storage full or blocked: comments live for this visit */ }
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('bbComments', true));
  }, [comments, editor, storeKey]);

  const openNewComment = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const quote = editor.state.doc.textBetween(from, to, '\n').trim();
    if (!quote) return;
    const at = editor.view.coordsAtPos(to);
    setPop({ quote, text: '', x: at.left, y: at.bottom });
  };

  const savePop = () => {
    if (!pop || !pop.text.trim()) return;
    setComments((prev) => (pop.id
      ? prev.map((c) => (c.id === pop.id ? { ...c, text: pop.text.trim() } : c))
      : [...prev, { id: Math.random().toString(36).slice(2, 9), quote: pop.quote, text: pop.text.trim() }]));
    setPop(null);
    if (editor) editor.commands.setTextSelection(editor.state.selection.to);
  };

  const sendComments = async () => {
    if (!comments.length) return;
    await flush();
    window.dispatchEvent(new CustomEvent('beyond:send-to-chat', { detail: { text: commentsPrompt(path, comments) } }));
    setComments([]);
  };

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

  // Cmd/Ctrl+S saves now, wherever the focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void flush(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flush]);

  // The text file's box grows with its text.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [draft]);

  const take = (mine: boolean) => {
    if (mine) { void flush(serverMtime ?? undefined); return; }
    // Take the version on disk and drop the draft.
    fetchFile(path).then((fresh) => {
      savedRef.current = fresh.content;
      draftRef.current = fresh.content;
      mtimeRef.current = fresh.mtime;
      front.current = isMd ? (FRONTMATTER.exec(fresh.content)?.[0] ?? '') : '';
      setDraft(fresh.content);
      if (isMd) editor?.commands.setContent(fresh.content.slice(front.current.length), { contentType: 'markdown', emitUpdate: false });
      setServerMtime(null);
      setSt('saved');
      onSaved?.(fresh.mtime || '');
    }).catch((e: Error) => {
      setMessage(e.message || 'Nejde načíst');
      setSt('error');
    });
  };

  // Cmd/Ctrl click follows a link; a plain click just puts the cursor in it.
  const onClickCapture = (e: React.MouseEvent) => {
    const mark = (e.target as HTMLElement).closest('.bb-cm');
    if (mark && !(e.target as HTMLElement).closest('a')) {
      const c = commentsRef.current.find((x) => x.id === mark.getAttribute('data-cid'));
      if (c) { const r = (mark as HTMLElement).getBoundingClientRect(); setPop({ id: c.id, quote: c.quote, text: c.text, x: r.left, y: r.bottom }); }
    }
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (editable && !(e.metaKey || e.ctrlKey)) { e.preventDefault(); return; }
    e.preventDefault();
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { window.open(href, '_blank', 'noopener,noreferrer'); return; }
    if (href && !href.startsWith('#') && onOpenPath) onOpenPath(resolveRelative(dirname(path), href.split('#')[0]));
  };

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Adresa odkazu', prev || 'https://');
    if (url === null) return;
    if (url.trim() === '') { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  const stats = useMemo(() => (isMd ? speakStats(draft) : null), [draft, isMd]);

  return (
    <div className="bb-ed">
      <div className="bb-ed__bar">
        {comments.length > 0 && (
          <div className="bb-ed__cmbar">
            <span>{comments.length} {comments.length === 1 ? 'komentář' : comments.length < 5 ? 'komentáře' : 'komentářů'}</span>
            <button type="button" className="bb-pill bb-pill--sm bb-pill--primary" onClick={() => void sendComments()}>Poslat do chatu</button>
            <button type="button" className="bb-ed__link" onClick={() => setComments([])}>zahodit</button>
          </div>
        )}
        <div className="bb-ed__state" data-status={status} aria-live="polite">
          {stats && <span className="bb-ed__count" title="Odhad mluvení podle počtu slov">{stats}</span>}
          <span className="bb-ed__st">{editable ? STATUS_LABEL[status] : 'Jen ke čtení'}</span>
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

      <div className="bb-ed__body" onClickCapture={onClickCapture}>
        {isMd ? (
          <>
            {editor && editable && (
              <BubbleMenu editor={editor} options={{ placement: 'top' }} className="bb-ed__bubble">
                <BubbleBtn label="Tučně (Cmd B)" on={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></BubbleBtn>
                <BubbleBtn label="Kurzíva (Cmd I)" on={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></BubbleBtn>
                <BubbleBtn label="Nadpis" on={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H</BubbleBtn>
                <span className="bb-ed__sep" />
                <BubbleBtn label="Odrážky" on={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>Odrážky</BubbleBtn>
                <BubbleBtn label="Úkoly" on={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>Úkoly</BubbleBtn>
                <BubbleBtn label="Citace" on={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>Citace</BubbleBtn>
                <BubbleBtn label="Odkaz" on={editor.isActive('link')} onClick={setLink}>Odkaz</BubbleBtn>
                <span className="bb-ed__sep" />
                <BubbleBtn label="Komentář k označenému" on={false} onClick={openNewComment}>Komentář</BubbleBtn>
              </BubbleMenu>
            )}
            <EditorContent editor={editor} className={`${PROSE} bb-ed__doc`} />
          </>
        ) : (
          <textarea
            ref={taRef}
            className="bb-ed__ta"
            data-kind="text"
            value={draft}
            readOnly={!editable}
            onChange={(e) => change(e.target.value)}
            spellCheck={false}
            aria-label="Obsah souboru"
          />
        )}
      </div>

      {pop && (
        <div
          className="bb-cmpop"
          style={{ left: Math.max(12, Math.min(pop.x, window.innerWidth - 340)), top: Math.min(pop.y + 8, window.innerHeight - 190) }}
          role="dialog"
          aria-label="Komentář"
        >
          <p className="bb-cmpop__q">„{pop.quote.length > 90 ? `${pop.quote.slice(0, 90)}…` : pop.quote}"</p>
          <textarea
            className="bb-cmpop__ta"
            value={pop.text}
            onChange={(e) => setPop({ ...pop, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPop(null);
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); savePop(); }
            }}
            placeholder="Co tu změnit"
            rows={3}
            autoFocus
          />
          <div className="bb-cmpop__acts">
            <button type="button" className="bb-pill bb-pill--sm bb-pill--primary" disabled={!pop.text.trim()} onClick={savePop}>{pop.id ? 'Uložit' : 'Přidat'}</button>
            <button type="button" className="bb-pill bb-pill--sm" onClick={() => setPop(null)}>Zrušit</button>
            {pop.id && (
              <button type="button" className="bb-ed__link" style={{ marginLeft: 'auto' }} onClick={() => { setComments((prev) => prev.filter((c) => c.id !== pop.id)); setPop(null); }}>smazat</button>
            )}
          </div>
        </div>
      )}
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

function BubbleBtn({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="bb-ed__tool" data-on={on ? 'true' : undefined} title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

/** Words and the speaking time they come to, without the markdown furniture. */
function speakStats(md: string): string {
  const text = md
    .replace(FRONTMATTER, '')
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
