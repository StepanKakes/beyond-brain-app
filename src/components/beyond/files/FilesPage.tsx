import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Clapperboard, Copy, ExternalLink, FileText, Folder, FolderOpen, Plus, Search } from '../icons';

import { copyTextToClipboard } from '../../../utils/clipboard';
import FileEditor from '../editor/FileEditor';
import { Switch, Tabs } from '../ui';
import { classifyFile } from '../beyondFilePaths';
import { basename, createFile, dirname, fetchFile, fetchGraph, fetchTree, flattenFiles, type FilePayload, type Graph, type TreeNode } from './api';
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

/** Where reels scripts live. Folder is created with the first script. */
const REELS_DIR = 'workspace/reels';

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
  const [reload, setReload] = useState(0);
  const [newReel, setNewReel] = useState(false);
  // A script made a moment ago opens straight in writing mode.
  const [fresh, setFresh] = useState<string | null>(null);

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
  }, [reload]);

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
  const reels = useMemo(() => {
    const dir = findDir(roots, REELS_DIR);
    return dir ? dir.children.filter((c) => c.type === 'file' && /\.md$/i.test(c.name)).map((c) => c.path).sort().reverse() : [];
  }, [roots]);
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
      <div className="bb-fx__tabs">
        <Tabs label="Část" items={[{ key: 'tree', label: 'Strom' }, { key: 'file', label: 'Soubor' }, { key: 'links', label: 'Odkazy' }]} value={pane} onChange={(k) => setPane(k as Pane)} />
      </div>

      <aside className="bb-fx__tree">
        <div className="bb-search bb-fx__search">
          <Search size={14} strokeWidth={1.8} className="flex-none" style={{ color: 'var(--bb-ink3)' }} aria-hidden />
          <input id="bb-fx-search" type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hledat soubor" />
        </div>
        <div className="bb-fx__quick">
          <div className="bb-fx__qh">
            <span className="bb-group__label" style={{ padding: 0 }}>Reels</span>
            <button type="button" className="bb-ib" onClick={() => setNewReel(true)} title="Nový reels script" aria-label="Nový reels script"><Plus size={15} strokeWidth={1.8} /></button>
          </div>
          {reels.length === 0 ? (
            <p className="bb-fx__empty" style={{ padding: '2px 8px 4px' }}>Zatím žádný script.</p>
          ) : (
            <ul className="bb-fx__list">
              {reels.slice(0, 6).map((p) => (
                <li key={p}>
                  <button type="button" className="bb-fx__row" aria-current={p === path ? 'true' : undefined} onClick={() => select(p)} title={p}>
                    <Clapperboard size={14} strokeWidth={1.7} />
                    <span className="bb-fx__name">{basename(p).replace(/\.md$/, '')}</span>
                  </button>
                </li>
              ))}
              {reels.length > 6 && (
                <li>
                  <button type="button" className="bb-fx__row" onClick={() => { setOpen((prev) => new Set(prev).add('workspace').add(REELS_DIR)); }}>
                    <span className="bb-fx__name" style={{ color: 'var(--bb-ink3)' }}>Dalších {reels.length - 6} ve stromu</span>
                  </button>
                </li>
              )}
            </ul>
          )}
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
          <Reader key={path} path={path} onOpen={select} startInEdit={fresh === path} />
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
                <label className="bb-fx__raw" title="Přepisy, hlasovky a stažená data">
                  <Switch on={withRaw} onChange={setWithRaw} label="Suroviny" />
                  Suroviny
                </label>
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
                <Tabs label="Rozsah grafu" items={[{ key: 'local', label: 'Okolí' }, { key: 'all', label: 'Celý mozek' }]} value={mode} onChange={(k) => setMode(k as typeof mode)} />
                {mode === 'local' && (
                  <Tabs label="Kolik kroků od souboru" items={[{ key: '1', label: '1 krok' }, { key: '2', label: '2 kroky' }]} value={String(depth)} onChange={(k) => setDepth(k === '2' ? 2 : 1)} />
                )}
                <label className="bb-fx__raw" title="Přepisy, hlasovky a stažená data">
                  <Switch on={withRaw} onChange={setWithRaw} label="Suroviny" />
                  Suroviny
                </label>
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
      {newReel && (
        <NewReelDialog
          onClose={() => setNewReel(false)}
          onCreated={(p) => { setNewReel(false); setFresh(p); setReload((n) => n + 1); onOpen(p); }}
        />
      )}
    </div>
  );
}

function findDir(nodes: TreeNode[], target: string): Extract<TreeNode, { type: 'dir' }> | null {
  for (const n of nodes) {
    if (n.type !== 'dir') continue;
    if (n.path === target) return n;
    if (target.startsWith(n.path + '/')) {
      const hit = findDir(n.children, target);
      if (hit) return hit;
    }
  }
  return null;
}

const slugify = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function reelTemplate(title: string): string {
  return `# ${title}

_${today()}, talking head, cíl 45 až 60 s_

## Hook

## Tělo

## Závěr a výzva

## Poznámky k natáčení
`;
}

/** The only way a script is born here: a name, then it opens ready to write. */
function NewReelDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (path: string) => void }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const slug = slugify(title);

  const create = async () => {
    if (!slug || busy) return;
    const p = `${REELS_DIR}/${today()}-${slug}.md`;
    setBusy(true);
    setErr(null);
    try {
      await createFile(p, reelTemplate(title.trim()));
      onCreated(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Nepovedlo se založit');
      setBusy(false);
    }
  };

  return (
    <div className="bb-dialog__scrim" onClick={onClose} role="presentation">
      <div className="bb-dialog" role="dialog" aria-modal="true" aria-labelledby="bb-reel-title" onClick={(e) => e.stopPropagation()}>
        <div className="bb-dialog__head" id="bb-reel-title">Nový reels script</div>
        <div className="bb-dialog__body">
          <input
            className="bb-set__in"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') onClose(); }}
            placeholder="O čem je, třeba Proč nikdo neodpovídá"
            aria-label="Název scriptu"
            autoFocus
          />
          {err && <p className="bb-fx__err">{err}</p>}
          <div className="bb-set__acts">
            <button type="button" className="bb-pill bb-pill--primary" disabled={!slug || busy} onClick={() => void create()}>Založit</button>
            <button type="button" className="bb-pill" onClick={onClose}>Zrušit</button>
          </div>
        </div>
      </div>
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

function Reader({ path, onOpen, startInEdit }: { path: string; onOpen: (p: string) => void; startInEdit: boolean }) {
  const kind = classifyFile(path);
  const textual = kind === 'markdown' || kind === 'text';
  const [payload, setPayload] = useState<FilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

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
          {(savedAt || payload?.mtime) && <span className="bb-fx__meta">{new Date((savedAt || payload?.mtime) as string).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
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
        {payload && !payload.binary && (kind === 'markdown' || kind === 'text') && (
          <FileEditor
            key={path}
            path={path}
            payload={payload}
            kind={kind}
            startInEdit={startInEdit}
            onOpenPath={onOpen}
            onSaved={(m) => setSavedAt(m || null)}
          />
        )}
      </div>
    </div>
  );
}
