import { useEffect, useSyncExternalStore } from 'react';

import { api } from './api';

// Data se kreslí hned z telefonu a serverová odpověď je potichu dožene.
// localStorage je synchronní, takže první snímek obrazovky už data má a nic
// neproblikne. Víc obrazovek nad stejným klíčem sdílí jeden záznam.

const PREFIX = 'bm.';

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Plné úložiště: nejdřív obětujeme staré přepisy chatů.
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(`${PREFIX}chat.`))
        .forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* cache je jen zrychlení, bez ní to jde taky */
    }
  }
}

export function clearCache(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* nic */
  }
}

type Entry<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  fetchedAt: number;
  inFlight: Promise<void> | null;
};

const entries = new Map<string, Entry<unknown>>();
const listeners = new Map<string, Set<() => void>>();

function entry<T>(key: string): Entry<T> {
  let found = entries.get(key) as Entry<T> | undefined;
  if (!found) {
    found = { data: readCache<T>(key), error: null, loading: false, fetchedAt: 0, inFlight: null };
    entries.set(key, found as Entry<unknown>);
  }
  return found;
}

function update<T>(key: string, patch: Partial<Entry<T>>): void {
  // Nový objekt, aby useSyncExternalStore poznal změnu.
  entries.set(key, { ...entry<T>(key), ...patch } as Entry<unknown>);
  listeners.get(key)?.forEach((listener) => listener());
}

export function mutate<T>(key: string, change: (current: T | null) => T | null): void {
  const data = change(entry<T>(key).data);
  update<T>(key, { data });
  writeCache(key, data);
}

export function refresh<T>(key: string, path: string): Promise<void> {
  const current = entry<T>(key);
  if (current.inFlight) return current.inFlight;
  const inFlight = api<T>(path)
    .then((data) => {
      update<T>(key, { data, error: null, loading: false, fetchedAt: Date.now(), inFlight: null });
      writeCache(key, data);
    })
    .catch((error: Error) => {
      update<T>(key, { error: error.message, loading: false, inFlight: null });
    });
  update<T>(key, { loading: true, inFlight });
  return inFlight;
}

const STALE_MS = 20_000;

export function useResource<T>(key: string, path: string) {
  const state = useSyncExternalStore(
    (listener) => {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => set?.delete(listener);
    },
    () => entry<T>(key),
  );

  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - entry<T>(key).fetchedAt > STALE_MS) void refresh<T>(key, path);
    };
    revalidate();
    document.addEventListener('visibilitychange', revalidate);
    return () => document.removeEventListener('visibilitychange', revalidate);
  }, [key, path]);

  return state;
}
