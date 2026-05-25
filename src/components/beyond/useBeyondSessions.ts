import { useEffect, useState } from 'react';

/**
 * Beyond Brain — read access to the per-client session index that BeyondChat
 * maintains in localStorage under `beyond.sessions.<slug>`. The chat is the
 * source of truth (writes + active uuid); this hook lets other surfaces
 * (sidebar, status footer, etc.) observe the same data without lifting
 * state into a shared store.
 *
 * Notifies on:
 *  - native `storage` event (other tabs)
 *  - custom `beyond:sessions-changed` event dispatched by BeyondChat after
 *    every write so the current tab updates immediately.
 */

export type BeyondSession = {
  uuid: string;
  title: string;
  lastUsedAt: number;
};

const SESSIONS_KEY = (slug: string) => `beyond.sessions.${slug}`;
const ACTIVE_KEY = (slug: string) => `beyond.session.${slug}`;

function read(slug: string): BeyondSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s): s is BeyondSession =>
          !!s && typeof s === 'object' &&
          typeof (s as BeyondSession).uuid === 'string' &&
          typeof (s as BeyondSession).title === 'string' &&
          typeof (s as BeyondSession).lastUsedAt === 'number',
      )
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  } catch {
    return [];
  }
}

function readActive(slug: string): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY(slug));
  } catch {
    return null;
  }
}

export function useBeyondSessions(slug: string | null): {
  sessions: BeyondSession[];
  activeUuid: string | null;
} {
  const [sessions, setSessions] = useState<BeyondSession[]>(() =>
    slug ? read(slug) : [],
  );
  const [activeUuid, setActiveUuid] = useState<string | null>(() =>
    slug ? readActive(slug) : null,
  );

  useEffect(() => {
    if (!slug) {
      setSessions([]);
      setActiveUuid(null);
      return;
    }
    setSessions(read(slug));
    setActiveUuid(readActive(slug));

    const refresh = () => {
      setSessions(read(slug));
      setActiveUuid(readActive(slug));
    };

    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === SESSIONS_KEY(slug) || e.key === ACTIVE_KEY(slug)) {
        refresh();
      }
    };

    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<{ slug?: string }>).detail;
      if (!detail || detail.slug === slug) refresh();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('beyond:sessions-changed', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('beyond:sessions-changed', onCustom);
    };
  }, [slug]);

  return { sessions, activeUuid };
}
