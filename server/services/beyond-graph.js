/**
 * Beyond Brain — the brain as a tree and as a graph.
 *
 * The brain is a folder of markdown that refers to itself: CLAUDE.md names
 * the skills, a client's profile points at its calls, a write-up links the
 * transcript. Obsidian shows that as a graph and it is the fastest way to see
 * what hangs together and what is orphaned. This module walks the repo once,
 * builds the full file tree and, for every markdown file, the links it makes:
 *
 *   [[wikilink]]           by path, or by file name when that is unique
 *   [text](relative.md)    relative to the file, then to the brain root
 *   clients/x/cally.md     a bare path in prose, the way CLAUDE.md writes them
 *
 * Both are cached for a short while; a refresh of the brain invalidates.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveBrainPath } from '../utils/brain-path.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.DS_Store']);
const MAX_MD_BYTES = 512 * 1024;
const TTL_MS = 30_000;

let cache = { at: 0, tree: null, graph: null, files: null };

export function invalidateGraph() {
  cache = { at: 0, tree: null, graph: null, files: null };
}

/** Every file under the brain, flat, as posix paths relative to the root. */
async function walk(root) {
  const files = [];
  async function visit(abs, rel) {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      // Hidden files stay hidden, but `.claude` holds the skills and they are
      // very much part of the brain.
      if (e.name.startsWith('.') && e.name !== '.claude') continue;
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await visit(childAbs, childRel);
      else if (e.isFile()) {
        let size = 0;
        let mtime = null;
        try {
          const st = await fs.stat(childAbs);
          size = st.size;
          mtime = st.mtime.toISOString();
        } catch { /* listed without size */ }
        files.push({ path: childRel, size, mtime });
      }
    }
  }
  await visit(root, '');
  return files;
}

/** Nest the flat list. Folders first, then files, both alphabetically. */
function nest(files) {
  const root = { type: 'dir', name: '', path: '', children: [] };
  const dirs = new Map([['', root]]);
  const dirFor = (dirPath) => {
    if (dirs.has(dirPath)) return dirs.get(dirPath);
    const parent = dirFor(dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : '');
    const node = { type: 'dir', name: dirPath.slice(dirPath.lastIndexOf('/') + 1), path: dirPath, children: [] };
    parent.children.push(node);
    dirs.set(dirPath, node);
    return node;
  };
  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    dirFor(dir).children.push({ type: 'file', name: f.path.slice(f.path.lastIndexOf('/') + 1), path: f.path, size: f.size, mtime: f.mtime });
  }
  const sortRec = (node) => {
    node.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'cs') : a.type === 'dir' ? -1 : 1));
    for (const c of node.children) if (c.type === 'dir') sortRec(c);
  };
  sortRec(root);
  return root.children;
}

/* ------------------------------------------------------------------ */
/* links                                                               */
/* ------------------------------------------------------------------ */

const WIKI_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function normalize(p) {
  const parts = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Turn what a file wrote into a path that exists, or null. `byName` maps a
 * bare file name (with and without .md) to the paths that carry it.
 */
function resolveTarget(raw, fromDir, exists, byName) {
  let t = String(raw || '').trim().replace(/^<|>$/g, '');
  if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('#')) return null;
  t = t.split('#')[0].split('?')[0];
  try { t = decodeURIComponent(t); } catch { /* keep as written */ }
  if (!t) return null;
  const candidates = [];
  if (t.startsWith('/')) candidates.push(t.slice(1));
  else {
    candidates.push(normalize(fromDir ? `${fromDir}/${t}` : t));
    candidates.push(normalize(t));
  }
  for (const c of candidates) {
    if (exists.has(c)) return c;
    if (exists.has(`${c}.md`)) return `${c}.md`;
  }
  const name = t.slice(t.lastIndexOf('/') + 1);
  const hits = byName.get(name) || byName.get(`${name}.md`);
  if (hits && hits.length === 1) return hits[0];
  return null;
}

function linksIn(text, file, exists, byName, topDirs) {
  const fromDir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  const out = new Set();
  let m;
  WIKI_RE.lastIndex = 0;
  while ((m = WIKI_RE.exec(text))) {
    const r = resolveTarget(m[1], fromDir, exists, byName);
    if (r && r !== file) out.add(r);
  }
  MD_LINK_RE.lastIndex = 0;
  while ((m = MD_LINK_RE.exec(text))) {
    const r = resolveTarget(m[1], fromDir, exists, byName);
    if (r && r !== file) out.add(r);
  }
  if (topDirs.length) {
    // A bare path in prose, only when it starts with one of the brain's own
    // top-level folders, so an URL path or a code sample is not mistaken.
    const bare = new RegExp(`(?:^|[\\s(\`"'>])((?:${topDirs.map((d) => d.replace(/[.\\]/g, '\\$&')).join('|')})/[A-Za-z0-9_\\-./]*[A-Za-z0-9_\\-]\\.[a-z0-9]{1,5})`, 'g');
    while ((m = bare.exec(text))) {
      const r = resolveTarget(m[1], '', exists, byName);
      if (r && r !== file) out.add(r);
    }
  }
  return [...out];
}

/* ------------------------------------------------------------------ */
/* public                                                              */
/* ------------------------------------------------------------------ */

async function build() {
  const root = resolveBrainPath();
  const files = await walk(root);
  const exists = new Set(files.map((f) => f.path));
  const byName = new Map();
  for (const f of files) {
    const name = f.path.slice(f.path.lastIndexOf('/') + 1);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(f.path);
  }
  const topDirs = [...new Set(files.filter((f) => f.path.includes('/')).map((f) => f.path.slice(0, f.path.indexOf('/'))))];

  const edges = [];
  const linked = new Set();
  for (const f of files) {
    if (!f.path.endsWith('.md') || f.size > MAX_MD_BYTES) continue;
    let text;
    try {
      text = await fs.readFile(path.join(root, f.path), 'utf8');
    } catch {
      continue;
    }
    for (const to of linksIn(text, f.path, exists, byName, topDirs)) {
      edges.push({ from: f.path, to });
      linked.add(to);
      linked.add(f.path);
    }
  }
  // Notes are nodes; anything else only when something points at it.
  const nodes = files
    .filter((f) => f.path.endsWith('.md') || linked.has(f.path))
    .map((f) => ({ path: f.path, size: f.size, mtime: f.mtime }));

  cache = { at: Date.now(), tree: nest(files), graph: { nodes, edges }, files };
  return cache;
}

async function ensure() {
  if (cache.tree && Date.now() - cache.at < TTL_MS) return cache;
  return build();
}

/** The whole brain, nested. */
export async function brainTree() {
  return (await ensure()).tree;
}

/** Notes and the links between them. */
export async function brainGraph() {
  return (await ensure()).graph;
}
