import { useEffect, useState } from 'react';

import { fetchSessionIndex, resolveActiveUuid, type BeyondSession } from './beyondSessionsApi';

/**
 * Beyond Brain — read access to the per-client session index that BeyondChat
 * persists via `/api/beyond/sessions/:slug` on the server. Sidebar and other
 * surfaces consume this hook to render counts / active highlight without
 * lifting state up.
 *
 * Notifies on:
 *  - custom `beyond:sessions-changed` event dispatched by BeyondChat after
 *    every write so the current tab updates immediately.
 *  - other tabs / devices: only after a re-render that triggers the effect
 *    again, since the index lives on the server (no cross-tab events fire
 *    for free anymore).
 */

export type { BeyondSession };

export function useBeyondSessions(slug: string | null): {
  sessions: BeyondSession[];
  activeUuid: string | null;
} {
  const [sessions, setSessions] = useState<BeyondSession[]>([]);
  const [activeUuid, setActiveUuid] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setSessions([]);
      setActiveUuid(null);
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      try {
        const index = await fetchSessionIndex(slug);
        if (cancelled) return;
        setSessions(index.sessions);
        // Highlight this device's open thread, not whatever another person on
        // the shared login last opened.
        setActiveUuid(resolveActiveUuid(index, slug));
      } catch {
        if (cancelled) return;
        setSessions([]);
        setActiveUuid(null);
      }
    };

    void refresh();

    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<{ slug?: string }>).detail;
      if (!detail || detail.slug === slug) void refresh();
    };

    window.addEventListener('beyond:sessions-changed', onCustom);
    return () => {
      cancelled = true;
      window.removeEventListener('beyond:sessions-changed', onCustom);
    };
  }, [slug]);

  return { sessions, activeUuid };
}
