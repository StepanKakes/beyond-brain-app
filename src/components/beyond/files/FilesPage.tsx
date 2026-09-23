import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Copy, Check, ExternalLink, FileText, Folder, FolderOpen, Search } from '../icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { copyTextToClipboard } from '../../../utils/clipboard';
import BeyondCodeBlock from '../BeyondCodeBlock';
import { classifyFile } from '../beyondFilePaths';
import { basename, dirname, fetchFile, fetchGraph, fetchTree, flattenFiles, type FilePayload, type Graph, type TreeNode } from './api';
import FileGraph, { GROUP_LABEL, groupOf } from './FileGraph';

/**
 * Beyond Brain — Soubory.
 *
 * The brain, the way Obsidian shows a vault: the folder tree on the left, the
 * note in the middle, and on the right what it links to, what links to it,
 * and a graph of that neighbourhood. With nothing selected the middle shows
 * the whole graph, so the shape of the brain is one glance: what is central,
 * what hangs loose.
 */

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

type Pane = 'tree' | 'file' | 'links';

export default function FilesPage({ path, onOpen }: { path: string | null; onOpen: (path: string | null) => void }) {
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [pane, setPane] = useState<Pane>(path ? 'file' : 'tree');
  const [mode, setMode] = useState<'local' | 'all'>('local');
  const [depth, setDepth] = useState(1);
  // Raw material (transcripts, voice notes, pulled dumps) is half the files
  // and every distilled note cites dozens of them, so with it the graph is a
  // fan of citations and the notes themselves are invisible. Off by default,
  // the way one filters a vault's attachments folder in Obsidian.
  const [withRaw, setWithRaw] = useState(false);

  // Load once, and again when the sidebar pulled a fresh brain.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchTree().then((t) => { if (!cancelled) setRoots(t.roots || []); }).catch(() => { if (!cancelled) setRoots([]); });
      fetchGraph().then((g) => { if (!cancelled) setGraph(g); }).catch(() => { if (!cancelled) setGraph({ nodes: [], edges: [] }); });
    };
    load();
    window.addEventListener('beyond:brain-synced', load);
    return () => { cancelled = true; window.removeEventListener('beyond:brain-synced', load); };
  }, []);

  // The folders above the selected file open on their own.
  useEffect(() => {
    if (!path) return;
    setOpen((prev) => {
      const next = new Set(prev);
      let dir = dirname(path);
      while (dir) {
        next.add(dir);
        dir = dirname(dir);
      }
      return next;
    });
    setPane('file');
  }, [path]);

  const allFiles = useMemo(() => flattenFiles(roots), [roots]);
  const hits = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return null;
    const words = q.split(/\s+/);
    return allFiles.filter((p) => { const f = fold(p); return words.every((w) => f.includes(w)); }).slice(0, 80);
  }, [allFiles, query]);

  const shownGraph = useMemo(() => {
    if (!graph) return null;
    if (withRaw || (path && isRaw(path))) return graph;
    const keep = new Set(graph.nodes.filter((n) => !isRaw(n.path)).map((n) => n.path));
    return { nodes: graph.nodes.filter((n) => keep.has(n.path)), edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
  }, [graph, withRaw, path]);

  const links = useMemo(() => {
    if (!graph || !path) return { out: [] as string[], in: [] as string[] };
    const out = graph.edges.filter((e) => e.from === path).map((e) => e.to);
    const inn = graph.edges.filter((e) => e.to === path).map((e) => e.from);
    return { out: [...new Set(out)].sort(), in: [...new Set(inn)].sort() };
  }, [graph, path]);

  const stats = useMemo(() => {
    if (!shownGraph) return null;
    const linked = new Set<string>();
    for (const e of shownGraph.edges) { linked.add(e.from); linked.add(e.to); }
    const notes = shownGraph.nodes.filter((n) => n.path.endsWith('.md'));
    return { notes: notes.length, links: shownGraph.edges.length, orphans: notes.filter((n) => !linked.has(n.path)).length };
  }, [shownGraph]);

  const toggle = useCallback((dir: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir); else next.add(dir);
      return next;
    });
  }, []);

  const select = useCallback((p: string) => { onOpen(p); }, [onOpen]);

  return (
    <div className="bb-fx" data-pane={pane}>
      <div className="bb-fx__tabs" role="tablist">
        {(['tree', 'file', 'links'] as Pane[]).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={pane === p} className="bb-pill bb-pill--sm" onClick={() => setPane(p)}>
            {p === 'tree' ? 'Strom' : p === 'file' ? 'Soubor' : 'Odkazy'}
          </button>
        ))}
      </div>

      <aside className="bb-fx__tree">
        <div className="bb-search bb-fx__search">
          <Search size={14} strokeWidth={1.8} className="flex-none" style={{ color: 'var(--bb-ink3)' }} aria-hidden />
          <input id="bb-fx-search" type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hledat soubor" />
        </div>
        <div className="bb-fx__scroll">
          {hits ? (
            <ul className="bb-fx__hits">
              {hits.length === 0 && <li className="bb-fx__empty">Nic.</li>}
              {hits.map((p) => (
                <li key={p}>
                  <button type="button" className="bb-fx__hit" aria-current={p === path ? 'true' : undefined} onClick={() => select(p)}>
                    <span className="bb-fx__hit-n">{basename(p)}</span>
                    <span className="bb-fx__hit-d">{dirname(p)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="bb-fx__list">
              {roots.map((n) => <Row key={n.path} node={n} depth={0} open={open} selected={path} onToggle={toggle} onSelect={select} />)}
              {roots.length === 0 && <li className="bb-fx__empty">Načítám strom…</li>}
            </ul>
          )}
        </div>
      </aside>

      <main className="bb-fx__main">
        {path ? (
          <Reader path={path} onOpen={select} />
        ) : (
          <div className="bb-fx__overview">
            <div className="bb-fx__ovhead">
              <div>
                <h1 className="bb-vel__title">Soubory</h1>
                {stats && (
                  <p className="bb-vel__sub">{stats.notes} poznámek, {stats.links} odkazů, {stats.orphans} bez jediného odkazu</p>
                )}
              </div>
              <div className="bb-fx__ovtools">
                <Legend />
                <button type="button" className="bb-pill bb-pill--sm" aria-pressed={withRaw} onClick={() => setWithRaw((v) => !v)} title="Přepisy, hlasovky a stažená data">
                  {withRaw ? 'Se surovinami' : 'Bez surovin'}
                </button>
              </div>
            </div>
            {shownGraph && shownGraph.nodes.length > 0 ? (
              <div className="bb-fx__big">
                <FileGraph graph={shownGraph} focus={null} mode="all" onSelect={select} />
              </div>
            ) : (
              <p className="bb-fx__empty">{graph ? 'Žádné poznámky.' : 'Kreslím graf…'}</p>
            )}
          </div>
        )}
      </main>

      <aside className="bb-fx__links">
        {path && graph ? (
          <>
            <div className="bb-fx__lh">
              <span className="bb-group__label" style={{ padding: 0 }}>Graf</span>
              <div className="bb-fx__seg">
                <button type="button" className="bb-pill bb-pill--sm" aria-pressed={mode === 'local'} onClick={() => setMode('local')}>Okolí</button>
                <button type="button" className="bb-pill bb-pill--sm" aria-pressed={mode === 'all'} onClick={() => setMode('all')}>Celý mozek</button>
                {mode === 'local' && (
                  <button type="button" className="bb-pill bb-pill--sm" onClick={() => setDepth((d) => (d === 1 ? 2 : 1))} title="Kolik kroků od souboru">
                    {depth === 1 ? '1 krok' : '2 kroky'}
                  </button>
                )}
                <button type="button" className="bb-pill bb-pill--sm" aria-pressed={withRaw} onClick={() => setWithRaw((v) => !v)} title="Přepisy, hlasovky a stažená data">
                  Suroviny
                </button>
              </div>
            </div>
            <div className="bb-fx__small">
              <FileGraph graph={shownGraph || graph} focus={path} mode={mode} depth={depth} onSelect={select} />
            </div>
            <LinkList title="Odkazuje na" items={links.out} onOpen={select} />
            <LinkList title="Odkazují sem" items={links.in} onOpen={select} />
          </>
        ) : (
          <p className="bb-fx__empty">Vyber soubor, tady uvidíš, s čím je propojený.</p>
        )}
      </aside>
    </div>
  );
}

/** Transcripts, voice notes and pulled dumps: sources, not notes. */
function isRaw(p: string): boolean {
  return /(^|\/)(_raw|raw)\//.test(p);
}

function Legend() {
  return (
    <ul className="bb-fx__legend">
      {Object.entries(GROUP_LABEL).filter(([k]) => k).map(([k, label]) => (
        <li key={k}><span className="bb-fx__dot" data-group={k} />{label}</li>
      ))}
    </ul>
  );
}

function LinkList({ title, items, onOpen }: { title: string; items: string[]; onOpen: (p: string) => void }) {
  return (
    <div className="bb-fx__ll">
      <p className="bb-group__label" style={{ padding: '0 0 4px' }}>{title} <span className="bb-fx__n">{items.length}</span></p>
      {items.length === 0 ? (
        <p className="bb-fx__empty" style={{ padding: '2px 0 6px' }}>Nic.</p>
      ) : (
        <ul>
          {items.map((p) => (
            <li key={p}>
              <button type="button" className="bb-fx__link" onClick={() => onOpen(p)} title={p}>
                <span className="bb-fx__dot" data-group={groupOf(p)} />
                <span className="bb-fx__link-n">{basename(p).replace(/\.md$/, '')}</span>
                <span className="bb-fx__link-d">{dirname(p)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ node, depth, open, selected, onToggle, onSelect }: {
  node: TreeNode; depth: number; open: Set<string>; selected: string | null;
  onToggle: (dir: string) => void; onSelect: (p: string) => void;
}) {
  const pad = 8 + depth * 14;
  if (node.type === 'dir') {
    const isOpen = open.has(node.path);
    return (
      <li>
        <button type="button" className="bb-fx__row" style={{ paddingLeft: pad }} onClick={() => onToggle(node.path)} aria-expanded={isOpen}>
          <ChevronRight size={12} strokeWidth={2} className="bb-fx__chev" data-open={isOpen} />
          {isOpen ? <FolderOpen size={14} strokeWidth={1.7} /> : <Folder size={14} strokeWidth={1.7} />}
          <span className="bb-fx__name">{node.name}</span>
          <span className="bb-fx__count">{node.children.length}</span>
        </button>
        {isOpen && (
          <ul>
            {node.children.map((c) => <Row key={c.path} node={c} depth={depth + 1} open={open} selected={selected} onToggle={onToggle} onSelect={onSelect} />)}
          </ul>
        )}
      </li>
    );
  }
  return (
    <li>
      <button type="button" className="bb-fx__row" style={{ paddingLeft: pad + 16 }} aria-current={selected === node.path ? 'true' : undefined} onClick={() => onSelect(node.path)}>
        <FileText size={14} strokeWidth={1.7} />
        <span className="bb-fx__name">{node.name}</span>
      </button>
    </li>
  );
}

function Reader({ path, onOpen }: { path: string; onOpen: (p: string) => void }) {
  const kind = classifyFile(path);
  const textual = kind === 'markdown' || kind === 'text';
  const [payload, setPayload] = useState<FilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setError(null);
    if (!textual) return;
    fetchFile(path).then((p) => { if (!cancelled) setPayload(p); }).catch((e) => { if (!cancelled) setError(e?.message || 'Nejde načíst'); });
    return () => { cancelled = true; };
  }, [path, textual]);

  const crumbs = path.split('/');
  const openSheet = () => window.dispatchEvent(new CustomEvent('beyond:open-file', { detail: { path } }));
  const copyPath = async () => {
    const ok = await copyTextToClipboard(path);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1400); }
  };

  return (
    <div className="bb-fx__reader">
      <header className="bb-fx__rh">
        <p className="bb-fx__crumbs">
          {crumbs.map((c, i) => (
            <span key={i}>{i > 0 && <span className="bb-fx__sep">/</span>}{i === crumbs.length - 1 ? <strong>{c}</strong> : c}</span>
          ))}
        </p>
        <div className="bb-fx__acts">
          {payload?.mtime && <span className="bb-fx__meta">{new Date(payload.mtime).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
          <button type="button" className="bb-ib" onClick={copyPath} title="Kopírovat cestu">{copied ? <Check size={15} strokeWidth={2} /> : <Copy size={15} strokeWidth={1.8} />}</button>
          <button type="button" className="bb-ib" onClick={openSheet} title="Otevřít v náhledu"><ExternalLink size={15} strokeWidth={1.8} /></button>
        </div>
      </header>
      <div className="bb-fx__body">
        {!textual && (
          <div className="bb-fx__other">
            <p>Tohle není textový soubor.</p>
            <button type="button" className="bb-pill bb-pill--sm" onClick={openSheet}>Otevřít v náhledu</button>
          </div>
        )}
        {error && <p className="bb-fx__err">{error}</p>}
        {textual && !payload && !error && <p className="bb-fx__empty">Načítám…</p>}
        {payload && kind === 'markdown' && (
          <div className="beyond-prose bb-fx__prose text-[15px] leading-relaxed text-beyond-ink [&_p]:my-2 [&_p:first-child]:mt-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_strong]:font-semibold [&_em]:italic [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-[22px] [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-4 [&_h3]:text-[15px] [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-beyond-ink/10 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-beyond-ink/10 [&_blockquote]:pl-3 [&_blockquote]:text-beyond-dim [&_table]:my-3 [&_table]:w-full [&_th]:border-b [&_th]:border-beyond-ink/10 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-[12px] [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-beyond-faint [&_td]:border-b [&_td]:border-beyond-ink/[0.04] [&_td]:px-2 [&_td]:py-1.5">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children, ...rest }) => {
                  const h = String(href || '');
                  const local = h && !/^[a-z][a-z0-9+.-]*:/i.test(h) && !h.startsWith('#');
                  if (local) {
                    const target = resolveRelative(dirname(path), h.split('#')[0]);
                    return (
                      <button type="button" className="bb-fx__a" onClick={() => onOpen(target)} title={target}>{children}</button>
                    );
                  }
                  return <a {...rest} href={href} target="_blank" rel="noopener noreferrer" className="text-beyond-ink underline decoration-beyond-ink/20 underline-offset-2 hover:decoration-beyond-ink/50">{children}</a>;
                },
                code: ({ className, children }) => {
                  const raw = String(children ?? '');
                  if (/\n/.test(raw)) return <BeyondCodeBlock code={raw.replace(/\n$/, '')} className={className} />;
                  return <code className="bb-inlinecode rounded px-1 py-0.5 font-mono text-[0.88em]">{children}</code>;
                },
              }}
            >
              {payload.content}
            </ReactMarkdown>
          </div>
        )}
        {payload && kind === 'text' && (
          <pre className="bb-fx__pre">{payload.content}</pre>
        )}
      </div>
    </div>
  );
}

function resolveRelative(fromDir: string, target: string): string {
  const parts: string[] = [];
  const base = target.startsWith('/') ? [] : fromDir ? fromDir.split('/') : [];
  for (const seg of [...base, ...target.replace(/^\//, '').split('/')]) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}
