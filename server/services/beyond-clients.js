/**
 * Beyond Brain — the active client roster, read from disk.
 *
 * `clients/aktivni/<slug>/` in the brain repo IS the roster. Keeping a second,
 * hardcoded copy in the agent route meant a client added to the repo stayed
 * invisible to the Telegram bot until someone remembered to edit the array, and
 * a client who churned kept matching forever.
 *
 * Cached briefly because the Telegram path calls this on every inbound message
 * and the directory changes a few times a month at most.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveBrainPath } from '../utils/brain-path.js';

const CACHE_TTL_MS = 60_000;

let cache = { at: 0, slugs: null };

/** Absolute path of the active-clients directory inside the brain repo. */
export function activeClientsDir() {
  return path.join(resolveBrainPath(), 'clients', 'aktivni');
}

/**
 * Slugs of the currently active clients, e.g. `['ivana-jurikova', ...]`.
 * Returns `[]` when the brain repo (or the directory) is missing — callers
 * treat an empty roster as "cannot infer a client", never as an error.
 */
export async function listClientSlugs() {
  if (cache.slugs && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.slugs;
  }
  let slugs = [];
  try {
    const entries = await fs.readdir(activeClientsDir(), { withFileTypes: true });
    slugs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    if (!err || err.code !== 'ENOENT') {
      console.warn('[beyond-clients] failed to read roster', err?.message || err);
    }
  }
  cache = { at: Date.now(), slugs };
  return slugs;
}

/** Drop the cached roster. Used after a brain-repo sync pulls new clients. */
export function invalidateClientCache() {
  cache = { at: 0, slugs: null };
}
