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
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const router = express.Router();

const BRAIN_PATH = process.env.BEYOND_BRAIN_PATH ||
  path.join(os.homedir(), 'Documents', 'GitHub', 'beyond-brain');
const ACTIVE_CLIENTS = path.join(BRAIN_PATH, 'clients', 'aktivni');

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

    const status = await repoStatus({ fetch: false });

    if (!status.exists) {
      return res.status(400).json({ ok: false, error: 'No git repo at brain path' });
    }

    // Decide what to do based on state.
    if (status.dirty) {
      return res.status(409).json({
        ok: false,
        action: 'blocked',
        reason: 'dirty',
        message: `Lokální změny (${status.dirtyCount}). Commitni je dřív než sync.`,
        status,
      });
    }

    if (status.ahead > 0 && status.behind > 0) {
      return res.status(409).json({
        ok: false,
        action: 'blocked',
        reason: 'diverged',
        message: `Branch se rozešel (${status.ahead}↑ / ${status.behind}↓). Vyřeš ručně.`,
        status,
      });
    }

    if (status.behind > 0) {
      const pull = await git(['pull', '--rebase', '--quiet', 'origin', status.branch]);
      if (!pull.ok) {
        return res.status(502).json({
          ok: false,
          action: 'pull',
          error: pull.stderr || 'git pull failed',
          status,
        });
      }
      const after = await repoStatus({ fetch: false });
      return res.json({ ok: true, action: 'pull', pulled: status.behind, status: after });
    }

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
      const after = await repoStatus({ fetch: false });
      return res.json({ ok: true, action: 'push', pushed: status.ahead, status: after });
    }

    return res.json({ ok: true, action: 'noop', status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'sync failed' });
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
