import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { GitBranch, RefreshCw, ArrowUp, ArrowDown, AlertCircle } from 'lucide-react';
import { authenticatedFetch } from '../../utils/api';

/**
 * Beyond Brain — repo status card.
 *
 * Tiny GitHub-Desktop-like header for the sidebar. Polls
 * `/api/beyond/repo-status` every 60s, colors a dot:
 *  - green: clean + in sync with origin
 *  - amber: ahead/behind (safe to sync)
 *  - red:   dirty local changes or diverged history
 *
 * Click the sync icon → POST `/api/beyond/sync` which fetches first, then
 * pulls/pushes based on the current state. Shows the action outcome inline
 * for a few seconds.
 */

type RepoStatus = {
  exists: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  dirty?: boolean;
  dirtyCount?: number;
  dirtyFiles?: { status: string; path: string }[];
  inSync?: boolean;
  label?: string;
  lastFetchAt?: string | null;
};

type Tone = 'green' | 'amber' | 'red' | 'idle';

function toneFor(status: RepoStatus | null): Tone {
  if (!status || !status.exists) return 'idle';
  if (status.dirty) return 'red';
  if ((status.ahead || 0) > 0 && (status.behind || 0) > 0) return 'red';
  if ((status.ahead || 0) > 0 || (status.behind || 0) > 0) return 'amber';
  if (status.inSync) return 'green';
  return 'idle';
}

const TONE_DOT: Record<Tone, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  idle: 'bg-black/15',
};

export default function BeyondRepoStatus({
  onSynced,
}: {
  /** Called after a successful sync so parents can refresh dependent views (file tree, clients). */
  onSynced?: () => void;
}) {
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchStatus = useCallback(async (withFetch = false) => {
    try {
      const r = await authenticatedFetch(
        `/api/beyond/repo-status${withFetch ? '?fetch=1' : ''}`,
      );
      if (!r.ok) return;
      const data = (await r.json()) as RepoStatus;
      setStatus(data);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchStatus(false);
    const t = setInterval(() => fetchStatus(false), 60_000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setFlash(null);
    try {
      const r = await authenticatedFetch('/api/beyond/sync', { method: 'POST' });
      const data = await r.json();
      if (!r.ok || data.ok === false) {
        setFlash({ kind: 'err', text: data.message || data.error || 'Sync selhal' });
        if (data.status) setStatus(data.status);
      } else {
        const labels: Record<string, string> = {
          pull: `Stáhnuto ${data.pulled || 0} commitů`,
          push: `Posláno ${data.pushed || 0} commitů`,
          noop: 'Aktuální',
        };
        setFlash({ kind: 'ok', text: labels[data.action] || 'Hotovo' });
        if (data.status) setStatus(data.status);
        onSynced?.();
      }
    } catch (e) {
      setFlash({ kind: 'err', text: e instanceof Error ? e.message : 'Sync selhal' });
    } finally {
      setSyncing(false);
      setTimeout(() => setFlash(null), 3500);
    }
  }, [syncing, onSynced]);

  const tone = toneFor(status);
  const showDetail = expanded && status && status.exists;

  return (
    <div className="px-4 pt-5">
      <div className="rounded-2xl border border-black/[0.04] bg-black/[0.015] px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
          <GitBranch
            className="h-[13px] w-[13px] flex-shrink-0 text-beyond-faint"
            strokeWidth={1.8}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-beyond-ink">
            {status?.branch || 'brain'}
            <span className="ml-1.5 font-normal text-beyond-faint">
              · {status?.label || (status === null ? '…' : 'žádné repo')}
            </span>
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              sync();
            }}
            disabled={syncing || !status?.exists}
            title="Sync (fetch → pull / push podle stavu)"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-black/[0.05] hover:text-beyond-ink disabled:opacity-40"
          >
            <RefreshCw
              className={`h-[14px] w-[14px] ${syncing ? 'animate-spin' : ''}`}
              strokeWidth={1.8}
            />
          </button>
        </button>

        {flash && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`mt-1.5 text-[11px] ${flash.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}
          >
            {flash.text}
          </motion.p>
        )}

        {showDetail && (
          <div className="mt-2 space-y-1 border-t border-black/[0.04] pt-2 text-[11px] text-beyond-dim">
            <div className="flex items-center gap-2">
              <ArrowUp className="h-[11px] w-[11px]" strokeWidth={1.8} />
              <span>{status?.ahead || 0} k pushnutí</span>
            </div>
            <div className="flex items-center gap-2">
              <ArrowDown className="h-[11px] w-[11px]" strokeWidth={1.8} />
              <span>{status?.behind || 0} k pullnutí</span>
            </div>
            {status?.dirty && (
              <div className="flex items-start gap-2 text-red-600">
                <AlertCircle className="mt-0.5 h-[11px] w-[11px] flex-shrink-0" strokeWidth={1.8} />
                <span>
                  Lokální změny ({status.dirtyCount}):{' '}
                  <span className="font-mono text-[10px]">
                    {(status.dirtyFiles || [])
                      .slice(0, 3)
                      .map((f) => f.path)
                      .join(', ')}
                    {(status.dirtyCount || 0) > 3 && '…'}
                  </span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
