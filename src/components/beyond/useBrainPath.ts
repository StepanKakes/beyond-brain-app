import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../../utils/api';

/**
 * Beyond Brain — the host's brain-repo path, straight from the server.
 *
 * The chat used to hardcode `/Users/stepankakes/Documents/GitHub/beyond-brain`,
 * which is wrong on the Windows box the app actually runs on: uploads landed in
 * a phantom `C:\Users\stepankakes\...` tree and the slash menu never found the
 * repo's custom commands or skills. `GET /api/beyond/config` answers with the
 * real path for whichever host is serving us.
 *
 * The value cannot change while the page is open, so one in-flight promise is
 * shared by every caller and the result is memoised for the page's lifetime.
 */

export type BrainConfig = { brainPath: string; exists: boolean };

let cached: BrainConfig | null = null;
let inflight: Promise<BrainConfig | null> | null = null;

async function fetchBrainConfig(): Promise<BrainConfig | null> {
  if (cached) return cached;
  if (!inflight) {
    inflight = (async () => {
      try {
        const r = await authenticatedFetch('/api/beyond/config');
        if (!r.ok) return null;
        const d = (await r.json()) as Partial<BrainConfig>;
        if (typeof d?.brainPath !== 'string' || !d.brainPath) return null;
        cached = { brainPath: d.brainPath, exists: Boolean(d.exists) };
        return cached;
      } catch {
        return null;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

/**
 * Returns the brain repo path, or `null` until it has loaded (and if the
 * request fails). Callers must treat `null` as "let the server decide" and omit
 * the path rather than substituting a guess — the server resolves it anyway.
 */
export function useBrainPath(): { brainPath: string | null; exists: boolean } {
  const [config, setConfig] = useState<BrainConfig | null>(cached);

  useEffect(() => {
    if (config) return;
    let cancelled = false;
    void fetchBrainConfig().then((c) => {
      if (!cancelled && c) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, [config]);

  return { brainPath: config?.brainPath ?? null, exists: config?.exists ?? false };
}
