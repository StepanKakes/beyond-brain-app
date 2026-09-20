/**
 * Beyond Brain — client-focused endpoints.
 * Reads ~/Documents/GitHub/beyond-brain/clients/aktivni/* on the fly so
 * the sidebar can show Tim's 6 active clients with live W## / promise data.
 *
 * Read-only. Never writes to disk. Falls back gracefully if the brain
 * directory is absent (returns an empty list).
 */
import express from 'express';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  BROWSER_SLUG_RE,
  UNIVERSAL_SLUG,
  getSessionIndex,
  mergeSessionIndex,
} from '../services/beyond-sessions-store.js';
import { getSupportedModels, runSdkOneShot } from '../claude-sdk.js';
import { invalidateClientCache } from '../services/beyond-clients.js';
import { brainPathExists, resolveBrainPath } from '../utils/brain-path.js';
import { brainTree, brainGraph } from '../services/beyond-graph.js';

const execFileAsync = promisify(execFile);

const router = express.Router();

const BRAIN_PATH = resolveBrainPath();
const ACTIVE_CLIENTS = path.join(BRAIN_PATH, 'clients', 'aktivni');

// The browser needs the real, host-resolved brain path so it can scope
// `/api/commands/list` and the skills lookup to the right checkout. It used to
// hardcode a macOS path, which meant the slash menu silently found nothing on
// the Windows box. Cheap and cacheable — the value cannot change at runtime.
router.get('/config', (_req, res) => {
  res.json({ brainPath: BRAIN_PATH, exists: brainPathExists() });
});

/** Cache responses for 30s to avoid hammering disk on every keystroke. */
let cache = { at: 0, data: null };
const CACHE_TTL_MS = 30_000;

router.get('/clients', async (_req, res) => {
  try {
    if (cache.data && Date.now() - cache.at < CACHE_TTL_MS) {
      return res.json(cache.data);
    }

    let entries;
    try {
      entries = await fs.readdir(ACTIVE_CLIENTS, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        const empty = { clients: [], brainPath: BRAIN_PATH, exists: false };
        cache = { at: Date.now(), data: empty };
        return res.json(empty);
      }
      throw err;
    }

    const slugs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);

    const clients = await Promise.all(slugs.map((slug) => readClient(slug)));
    const sorted = clients.sort((a, b) => a.name.localeCompare(b.name, 'cs'));

    const payload = { clients: sorted, brainPath: BRAIN_PATH, exists: true };
    cache = { at: Date.now(), data: payload };
    res.json(payload);
  } catch (err) {
    console.error('[beyond] /clients error', err);
    res.status(500).json({ error: 'Failed to read clients', message: err.message });
  }
});

async function readClient(slug) {
  const dir = path.join(ACTIVE_CLIENTS, slug);
  const out = {
    slug,
    name: humanize(slug),
    initials: initialsFromSlug(slug),
    week: null,
    status: null,
    openPromises: 0,
    weeklyGoal: null,
    notion: null,
    paths: { dir },
  };

  // profil.md → name, week, status, Notion link
  try {
    const profil = await fs.readFile(path.join(dir, 'profil.md'), 'utf8');
    const firstHeading = profil.match(/^#\s+(.+?)\s*$/m);
    if (firstHeading) out.name = firstHeading[1].trim();
    out.initials = initialsFromName(out.name);

    const week = profil.match(/Aktuální\s+týden:\*\*\s*([A-Z]?\d+)/i);
    if (week) out.week = week[1].trim();

    const stav = profil.match(/Stav:\*\*\s*(\w+)/i);
    if (stav) out.status = stav[1].trim();

    const notion = profil.match(/Notion\s+dashboard:\*\*\s*(https?:\/\/\S+)/i);
    if (notion) out.notion = notion[1].trim();
  } catch {
    /* missing / unreadable profil.md is fine — keep defaults */
  }

  // _action-items.md → count open promises (lines like "- [ ] …")
  try {
    const ai = await fs.readFile(path.join(dir, '_action-items.md'), 'utf8');
    const unchecked = ai.match(/^\s*[-*]\s*\[\s\]\s+/gm);
    out.openPromises = unchecked ? unchecked.length : 0;
  } catch {
    /* file optional */
  }

  // raw/notion/dashboard.json → optional weekly goal
  try {
    const raw = await fs.readFile(path.join(dir, 'raw', 'notion', 'dashboard.json'), 'utf8');
    const parsed = JSON.parse(raw);
    out.weeklyGoal = parsed.weeklyGoal || parsed.goal || null;
  } catch {
    /* file optional */
  }

  // raw freshness — newest mtime in raw/ (for "raw stáří" status dot)
  try {
    const rawDir = path.join(dir, 'raw');
    const rawStat = await fs.stat(rawDir);
    out.rawUpdatedAt = rawStat.mtimeMs;
  } catch {
    /* ignore */
  }

  return out;
}

function humanize(slug) {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function initialsFromSlug(slug) {
  const parts = slug.split('-');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return slug.slice(0, 2).toUpperCase();
}

function initialsFromName(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .toUpperCase();
}

/** Lightweight system status — n8n / git / raw stáří. */
router.get('/status', async (_req, res) => {
  const [n8n, git, raw] = await Promise.all([
    pingN8n(),
    checkGit(),
    checkRawAge(),
  ]);
  res.json({ n8n, git, raw });
});

async function pingN8n() {
  // best-effort — n8n is optional, we report unknown if env not set
  const url = process.env.BEYOND_N8N_HEALTH;
  if (!url) return { ok: null, label: 'n8n: nepřipojeno' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok
      ? { ok: true, label: 'n8n: OK' }
      : { ok: false, label: `n8n: HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, label: `n8n: ${e.message}` };
  }
}

async function checkGit() {
  try {
    const headPath = path.join(BRAIN_PATH, '.git', 'HEAD');
    await fs.stat(headPath);
    // we don't shell out — just confirm a git repo exists
    return { ok: true, label: 'git: connected' };
  } catch {
    return { ok: null, label: 'git: žádné repo' };
  }
}

/** Run `git ...` inside BRAIN_PATH. Returns stdout, throws on non-zero exit
 *  unless `okExitCodes` includes the code. */
async function git(args, { okExitCodes = [] } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: BRAIN_PATH,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout: stdout.trim(), code: 0 };
  } catch (err) {
    const code = typeof err.code === 'number' ? err.code : 1;
    if (okExitCodes.includes(code)) {
      return { ok: true, stdout: (err.stdout || '').trim(), code };
    }
    return {
      ok: false,
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || err.message || '').trim(),
      code,
    };
  }
}

/** Detailed repo state — branch, ahead/behind, dirty files, last fetch. */
async function repoStatus({ fetch = false } = {}) {
  try {
    await fs.stat(path.join(BRAIN_PATH, '.git'));
  } catch {
    return { exists: false };
  }

  if (fetch) {
    await git(['fetch', '--quiet', 'origin']);
  }

  const branchRes = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchRes.ok ? branchRes.stdout : 'main';

  // Find upstream remote ref, fallback to origin/<branch>.
  const upstreamRes = await git([
    'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}',
  ]);
  const upstream = upstreamRes.ok && upstreamRes.stdout
    ? upstreamRes.stdout
    : `origin/${branch}`;

  const aheadBehind = await git([
    'rev-list', '--left-right', '--count', `${upstream}...HEAD`,
  ]);
  let behind = 0;
  let ahead = 0;
  if (aheadBehind.ok && aheadBehind.stdout) {
    const [b, a] = aheadBehind.stdout.split(/\s+/);
    behind = Number.parseInt(b, 10) || 0;
    ahead = Number.parseInt(a, 10) || 0;
  }

  const statusRes = await git(['status', '--porcelain']);
  const dirtyLines = statusRes.ok && statusRes.stdout
    ? statusRes.stdout.split('\n').filter(Boolean)
    : [];
  const dirty = dirtyLines.length > 0;

  let lastFetchAt = null;
  try {
    const head = path.join(BRAIN_PATH, '.git', 'FETCH_HEAD');
    const stat = await fs.stat(head);
    lastFetchAt = stat.mtime.toISOString();
  } catch {
    /* ignore — repo never fetched */
  }

  const inSync = !dirty && ahead === 0 && behind === 0;
  let label;
  if (!inSync && dirty && ahead === 0 && behind === 0) label = 'lokální změny';
  else if (dirty && (ahead || behind)) label = `lokální + ${ahead}↑/${behind}↓`;
  else if (ahead && behind) label = `${ahead}↑ / ${behind}↓ (diverged)`;
  else if (ahead) label = `${ahead} k pushnutí`;
  else if (behind) label = `${behind} k pullnutí`;
  else label = 'aktuální';

  return {
    exists: true,
    branch,
    upstream,
    ahead,
    behind,
    dirty,
    dirtyCount: dirtyLines.length,
    dirtyFiles: dirtyLines.slice(0, 20).map((line) => ({
      status: line.slice(0, 2).trim(),
      path: line.slice(3),
    })),
    inSync,
    label,
    lastFetchAt,
  };
}

router.get('/repo-status', async (req, res) => {
  const doFetch = req.query.fetch === '1';
  try {
    const status = await repoStatus({ fetch: doFetch });
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message || 'repo-status failed' });
  }
});

/** Filtered file tree of the brain — `clients/aktivni/*` and select workspace
 *  subfolders. Recursive but depth-capped so the payload stays small. */
async function buildTree(absPath, relPath, depth = 0, maxDepth = 4) {
  let entries;
  try {
    entries = await fs.readdir(absPath, { withFileTypes: true });
  } catch {
    return null;
  }

  const children = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.name === 'node_modules' || e.name === 'raw') continue; // raw = bulky JSON
    const child = path.join(absPath, e.name);
    const rel = path.posix.join(relPath, e.name);
    if (e.isDirectory()) {
      const sub = depth + 1 < maxDepth
        ? await buildTree(child, rel, depth + 1, maxDepth)
        : { type: 'dir', name: e.name, path: rel, children: [] };
      if (sub) children.push(sub);
    } else if (e.isFile()) {
      let size = 0;
      try {
        const st = await fs.stat(child);
        size = st.size;
      } catch {
        /* ignore */
      }
      children.push({ type: 'file', name: e.name, path: rel, size });
    }
  }

  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'cs');
  });

  return { type: 'dir', name: path.basename(absPath), path: relPath, children };
}

/** Read a file from the brain repo. Only paths under BRAIN_PATH are allowed —
 *  no traversal, no symlinks out, max 1 MB returned. */
// ---------------------------------------------------------------------------
// File viewing — let the chat surface any file the agent created or mentioned.
//
// The agent runs with cwd = brain repo, so most files it writes land under
// BRAIN_PATH, but it also references absolute paths ("tady je file:
// /path/x.png"). `resolveOpenablePath` accepts either an absolute path or one
// relative to the brain repo and proves it sits under an allowed root, so a
// stray `../` or a path pointing at secrets can't be served.
//
// Allowed roots: the brain repo + the OS temp dir (agent scratch/images) +
// anything in `BEYOND_OPEN_FILE_ROOTS` (comma/semicolon-separated). Even inside
// a root, obviously-sensitive paths (.env, .ssh, auth.db, keys, …) are refused.
// ---------------------------------------------------------------------------
const OPEN_FILE_ROOTS = (() => {
  const roots = [path.resolve(BRAIN_PATH), path.resolve(os.tmpdir())];
  for (const r of (process.env.BEYOND_OPEN_FILE_ROOTS || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    roots.push(path.resolve(r));
  }
  return [...new Set(roots)];
})();

const SENSITIVE_PATH_RE =
  /(^|[\\/])(\.env(\.|$)|\.ssh|\.cloudcli|\.claude|\.git|\.aws|\.gnupg|\.docker|\.kube|\.npmrc|node_modules|auth\.db|beyond-sessions\.json|beyond-mcp-connectors\.json|\.credentials\.json|id_rsa|id_ed25519)([\\/]|$)/i;
const SENSITIVE_EXT_RE = /\.(pem|key|p12|pfx|crt|keystore)$/i;

const EXT_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};
function mimeFor(abs) {
  return EXT_MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
}

/** Resolve an absolute-or-brain-relative path to a vetted absolute path.
 *  Returns `{ abs }` on success or `{ error, status }` on rejection. */
function resolveOpenablePath(input) {
  if (!input || typeof input !== 'string') return { error: 'Missing path', status: 400 };
  // Tolerate the chat conventions: a leading `@` and wrapping quotes/backticks.
  let p = input.trim().replace(/^@/, '').replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!p) return { error: 'Missing path', status: 400 };
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(BRAIN_PATH, p);
  const underRoot = OPEN_FILE_ROOTS.some(
    (root) => abs === root || abs.startsWith(root + path.sep),
  );
  if (!underRoot) return { error: 'Path outside allowed roots', status: 403 };
  if (SENSITIVE_PATH_RE.test(abs) || SENSITIVE_EXT_RE.test(abs)) {
    return { error: 'Refused (sensitive path)', status: 403 };
  }
  return { abs };
}

// JSON read for the text/markdown preview sheet. Capped at 1 MB — big/binary
// files go through `/raw-file` instead.
router.get('/file', async (req, res) => {
  try {
    const resolved = resolveOpenablePath(req.query.path);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    const abs = resolved.abs;
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!stat.isFile()) {
      return res.status(400).json({ error: 'Not a file' });
    }
    const MAX_BYTES = 1024 * 1024;
    if (stat.size > MAX_BYTES) {
      return res.status(413).json({
        error: `Soubor je velký (${Math.round(stat.size / 1024)} kB > 1024 kB)`,
        size: stat.size,
      });
    }
    const buf = await fs.readFile(abs);
    // Best-effort utf-8 check — return base64 only for clearly binary content.
    const content = buf.toString('utf8');
    const looksBinary = content.includes('\0');
    if (looksBinary) {
      return res.json({
        path: req.query.path,
        size: stat.size,
        binary: true,
        content: buf.toString('base64'),
        encoding: 'base64',
      });
    }
    res.json({
      path: req.query.path,
      size: stat.size,
      binary: false,
      content,
      encoding: 'utf8',
      mtime: stat.mtime.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'file read failed' });
  }
});

// Raw byte stream with a guessed Content-Type — lets the viewer render images,
// PDFs, video, etc. inline. The client fetches this as a blob (so it rides the
// auth header) and renders an object URL.
router.get('/raw-file', async (req, res) => {
  const resolved = resolveOpenablePath(req.query.path);
  if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
  const abs = resolved.abs;
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
  if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });
  const MAX_BYTES = 50 * 1024 * 1024;
  if (stat.size > MAX_BYTES) {
    return res.status(413).json({
      error: `Soubor je velký (${Math.round(stat.size / 1024 / 1024)} MB > 50 MB)`,
      size: stat.size,
    });
  }
  res.setHeader('Content-Type', mimeFor(abs));
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(path.basename(abs))}"`);
  res.setHeader('Cache-Control', 'private, max-age=30');
  const stream = createReadStream(abs);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).json({ error: 'read failed' });
    else res.destroy();
  });
  stream.pipe(res);
});

// Models the installed Claude Code offers, with version-bearing names — feeds
// the chat's model picker so it shows "Opus 4.7" etc. instead of bare aliases.
router.get('/models', async (_req, res) => {
  try {
    const models = await getSupportedModels();
    res.json({ models });
  } catch (err) {
    res.status(500).json({ error: err.message || 'models failed', models: [] });
  }
});

// The whole brain as a tree and as a graph of links, for the Soubory screen.
router.get('/files/tree', async (_req, res) => {
  try {
    res.json({ roots: await brainTree() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'tree failed' });
  }
});

router.get('/files/graph', async (_req, res) => {
  try {
    res.json(await brainGraph());
  } catch (err) {
    res.status(500).json({ error: err.message || 'graph failed' });
  }
});

router.get('/tree', async (_req, res) => {
  try {
    const roots = [
      { rel: 'clients/aktivni', max: 3 },
      { rel: 'workspace/drafty', max: 3 },
      { rel: 'workspace/briefy', max: 3 },
      { rel: 'workspace/reporty', max: 3 },
    ];
    const out = [];
    for (const { rel, max } of roots) {
      const abs = path.join(BRAIN_PATH, rel);
      const tree = await buildTree(abs, rel, 0, max);
      if (tree) out.push({ ...tree, name: rel });
    }
    res.json({ roots: out });
  } catch (err) {
    res.status(500).json({ error: err.message || 'tree failed' });
  }
});

router.post('/sync', async (_req, res) => {
  try {
    // Always fetch first so we have an accurate ahead/behind view.
    const fetchRes = await git(['fetch', '--quiet', 'origin']);
    if (!fetchRes.ok) {
      return res.status(502).json({
        action: 'fetch',
        ok: false,
        error: fetchRes.stderr || 'git fetch failed',
      });
    }

    let status = await repoStatus({ fetch: false });

    if (!status.exists) {
      return res.status(400).json({ ok: false, error: 'No git repo at brain path' });
    }

    let committed = 0;
    let pulled = 0;
    let pushed = 0;

    // Local changes? Don't make the user drop to a shell — just commit them.
    // Stage everything and commit with an auto-generated message, then let the
    // pull/push steps below carry it to origin.
    if (status.dirty) {
      const add = await git(['add', '-A']);
      if (!add.ok) {
        return res.status(502).json({
          ok: false,
          action: 'commit',
          error: add.stderr || 'git add failed',
          status,
        });
      }
      const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
      const commit = await git(['commit', '-m', `Sync z Beyond Brain — ${stamp}`]);
      if (!commit.ok) {
        return res.status(502).json({
          ok: false,
          action: 'commit',
          error: commit.stderr || 'git commit failed',
          status,
        });
      }
      committed = status.dirtyCount;
      status = await repoStatus({ fetch: false });
    }

    // Behind (or diverged after our commit) → rebase local commits on top of origin.
    if (status.behind > 0) {
      const pull = await git(['pull', '--rebase', '--quiet', 'origin', status.branch]);
      if (!pull.ok) {
        return res.status(502).json({
          ok: false,
          action: 'pull',
          error: pull.stderr || 'git pull --rebase failed',
          status,
        });
      }
      pulled = status.behind;
      status = await repoStatus({ fetch: false });
    }

    // Ahead → push.
    if (status.ahead > 0) {
      const push = await git(['push', '--quiet', 'origin', status.branch]);
      if (!push.ok) {
        return res.status(502).json({
          ok: false,
          action: 'push',
          error: push.stderr || 'git push failed',
          status,
        });
      }
      pushed = status.ahead;
      status = await repoStatus({ fetch: false });
    }

    let action = 'noop';
    if (pushed) action = 'push';
    else if (pulled) action = 'pull';
    else if (committed) action = 'commit';

    // A pull can add or remove client directories, so both the rich /clients
    // payload and the slug roster the agent route matches against are stale now.
    if (pulled) {
      cache = { at: 0, data: null };
      invalidateClientCache();
    }

    return res.json({ ok: true, action, committed, pulled, pushed, status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'sync failed' });
  }
});

// ---------------------------------------------------------------------------
// Beyond chat sessions — cross-device session index per client slug.
// ---------------------------------------------------------------------------
//
// Storage lives in `services/beyond-sessions-store.js` so the Telegram agent
// route can share the same file + helpers. Browser slugs are restricted to
// the conservative regex; the agent route accepts a wider AGENT_SLUG_RE for
// its `__telegram__:<chatId>` style synthetic slugs.

router.get('/sessions/:slug', async (req, res) => {
  const { slug } = req.params;
  if (slug !== UNIVERSAL_SLUG && !BROWSER_SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Invalid slug' });
  }
  try {
    const index = await getSessionIndex(slug);
    res.json({ slug, ...index });
  } catch (err) {
    console.error('[beyond] /sessions GET failed', err);
    res.status(500).json({ error: 'Failed to read sessions' });
  }
});

router.put('/sessions/:slug', async (req, res) => {
  const { slug } = req.params;
  if (slug !== UNIVERSAL_SLUG && !BROWSER_SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Invalid slug' });
  }
  try {
    const body = req.body || {};
    // Non-destructive merge: the index is shared across every browser on the
    // single Beyond login, so a PUT must never drop sessions it didn't send
    // (it may be working from a stale snapshot). Removals are explicit via
    // `deletedUuids`. See beyond-sessions-store.js for the full rationale.
    const persisted = await mergeSessionIndex(slug, {
      activeUuid: body.activeUuid,
      sessions: body.sessions,
      deletedUuids: body.deletedUuids,
    });
    res.json({ slug, ...persisted });
  } catch (err) {
    console.error('[beyond] /sessions PUT failed', err);
    res.status(500).json({ error: 'Failed to write sessions' });
  }
});

/**
 * Generate a short, human-readable chat title from the first user message.
 * Runs a cheap, MCP-free Haiku one-shot so the sidebar shows "Plán obsahu pro
 * Ivanu" instead of a raw snippet of the message. Best-effort: the client keeps
 * its snippet fallback if this fails or times out.
 */
router.post('/sessions/suggest-title', async (req, res) => {
  const raw = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!raw) return res.status(400).json({ error: 'Missing text' });

  const source = raw.slice(0, 2000);
  const prompt =
    'Pojmenuj chat podle první zprávy uživatele. Vytvoř výstižný název v češtině: ' +
    '2–5 slov, bez uvozovek, bez koncové interpunkce, bez emoji, začni velkým písmenem. ' +
    'Popiš téma, ne formu (ne "Dotaz", ale konkrétní téma). Vrať POUZE ten název, nic jiného.\n\n' +
    `Zpráva uživatele:\n"""\n${source}\n"""`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const result = await runSdkOneShot({
      command: prompt,
      cwd: BRAIN_PATH,
      model: 'haiku',
      loadMcp: false,
      allowedTools: [],
      skipPermissions: true,
      signal: controller.signal,
    });
    const title = sanitizeTitle(result?.text || '');
    if (!title) return res.status(502).json({ error: 'No title produced' });
    res.json({ title });
  } catch (err) {
    console.warn('[beyond] suggest-title failed', err?.message || err);
    res.status(500).json({ error: 'Title generation failed' });
  } finally {
    clearTimeout(timer);
  }
});

/** Trim a model reply down to a clean one-line title. */
function sanitizeTitle(text) {
  let t = String(text || '').trim();
  // Model sometimes wraps the answer or adds a lead-in — take the last
  // non-empty line, which is almost always the title itself.
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length) t = lines[lines.length - 1];
  t = t.replace(/^["'`«»„“”\s]+|["'`«»„“”\s]+$/g, ''); // strip surrounding quotes
  t = t.replace(/[.。!?]+$/g, '').trim();               // strip trailing punctuation
  t = t.replace(/\s+/g, ' ');
  if (t.length > 60) t = t.slice(0, 60).trim();
  return t;
}

const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUDGET_DEFAULT_TOTAL = 200_000;

/** Backfill the context-window budget for a resumed session before the next turn
 *  emits a fresh `token_budget` WS event. Scans every ~/.claude/projects/<cwd-hash>
 *  dir because the project hash changes whenever cwd resolution changes (e.g. the
 *  mac-path bug previously stored sessions under a phantom hash). Reads the JSONL
 *  from end to start, returns the first `message.usage` it finds. */
router.get('/sessions/:uuid/budget', async (req, res) => {
  const { uuid } = req.params;
  if (!SESSION_UUID_RE.test(uuid)) {
    return res.status(400).json({ error: 'Invalid uuid' });
  }
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    const dirs = await fs.readdir(projectsDir).catch(() => []);
    for (const dir of dirs) {
      const jsonlPath = path.join(projectsDir, dir, `${uuid}.jsonl`);
      let content;
      try {
        content = await fs.readFile(jsonlPath, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line || line.indexOf('"usage"') === -1) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        const usage = obj && obj.message && obj.message.usage;
        if (!usage) continue;
        const used = (usage.input_tokens || 0)
          + (usage.output_tokens || 0)
          + (usage.cache_read_input_tokens || 0)
          + (usage.cache_creation_input_tokens || 0);
        if (used > 0) {
          return res.json({ used, total: BUDGET_DEFAULT_TOTAL });
        }
      }
    }
    res.json({ used: 0, total: BUDGET_DEFAULT_TOTAL });
  } catch (err) {
    console.error('[beyond] /sessions/:uuid/budget failed', err);
    res.status(500).json({ error: 'Failed to read session budget' });
  }
});

async function checkRawAge() {
  try {
    let oldest = Date.now();
    const slugs = await fs.readdir(ACTIVE_CLIENTS);
    for (const slug of slugs) {
      try {
        const s = await fs.stat(path.join(ACTIVE_CLIENTS, slug, 'raw'));
        if (s.mtimeMs < oldest) oldest = s.mtimeMs;
      } catch {
        /* ignore */
      }
    }
    const ageH = (Date.now() - oldest) / 3_600_000;
    return {
      ok: ageH < 36,
      hoursOld: Math.round(ageH),
      label: `raw: ${Math.round(ageH)}h`,
    };
  } catch {
    return { ok: null, label: 'raw: ?' };
  }
}

export default router;
