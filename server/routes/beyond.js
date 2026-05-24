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
