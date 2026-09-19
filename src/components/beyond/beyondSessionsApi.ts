/**
 * Beyond chat sessions — client-side bridge to `/api/beyond/sessions/:slug`.
 *
 * Why a server-backed store: BeyondChat used to keep the per-client session
 * UUID list in localStorage, so PC1 and PC2 couldn't see each other's threads
 * with the same client. The Node server now owns the index (single JSON file
 * alongside auth.db). This module wraps that API + handles the one-shot
 * migration from localStorage so existing chats don't get orphaned on upgrade.
 *
 * `__universal__` is the slug for global (non-client) chats. It used to be a
 * non-persisted sandbox, but is now indexed like any client so the sidebar can
 * surface a history of past global chats. Each "+ Nový chat" still starts a
 * fresh thread — multiple separate threads = bounded per-thread context.
 */

import { authenticatedFetch } from '../../utils/api';

export type BeyondSession = {
  uuid: string;
  title: string;
  lastUsedAt: number;
};

export type SessionIndex = {
  activeUuid: string | null;
  sessions: BeyondSession[];
};

export const UNIVERSAL_SLUG = '__universal__';

const LEGACY_ACTIVE_KEY = (slug: string) => `beyond.session.${slug}`;
const LEGACY_LIST_KEY = (slug: string) => `beyond.sessions.${slug}`;
const MIGRATED_MARKER_KEY = (slug: string) => `beyond.sessions-migrated.${slug}`;
const LOCAL_ACTIVE_KEY = (slug: string) => `beyond.active.${slug}`;

/**
 * Per-device active/open session for a slug (localStorage).
 *
 * Under the shared login the session *list* is server-shared (everyone sees the
 * same threads across devices), but WHICH thread is open is deliberately
 * device-local: otherwise one person opening a chat would yank another person's
 * view to the same thread. `readLocalActive` returns this device's choice;
 * `resolveActiveUuid` falls back to the server's activeUuid on a device's first
 * visit (or if the local choice was since deleted from the shared list).
 */
export function readLocalActive(slug: string): string | null {
  try {
    return localStorage.getItem(LOCAL_ACTIVE_KEY(slug));
  } catch {
    return null;
  }
}

export function writeLocalActive(slug: string, uuid: string | null): void {
  try {
    if (uuid) localStorage.setItem(LOCAL_ACTIVE_KEY(slug), uuid);
    else localStorage.removeItem(LOCAL_ACTIVE_KEY(slug));
  } catch {
    /* storage unavailable — active choice just won't persist on this device */
  }
}

export function resolveActiveUuid(index: SessionIndex, slug: string): string | null {
  const local = readLocalActive(slug);
  if (local && index.sessions.some((s) => s.uuid === local)) return local;
  return index.activeUuid;
}

function readLegacyLocalStorage(slug: string): SessionIndex | null {
  let activeUuid: string | null = null;
  let sessions: BeyondSession[] = [];
  try {
    activeUuid = localStorage.getItem(LEGACY_ACTIVE_KEY(slug));
  } catch {
    /* ignore */
  }
  try {
    const raw = localStorage.getItem(LEGACY_LIST_KEY(slug));
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        sessions = parsed.filter(
          (s): s is BeyondSession =>
            !!s && typeof s === 'object' &&
            typeof (s as BeyondSession).uuid === 'string' &&
            typeof (s as BeyondSession).title === 'string' &&
            typeof (s as BeyondSession).lastUsedAt === 'number',
        );
      }
    }
  } catch {
    /* ignore */
  }
  if (!activeUuid && sessions.length === 0) return null;
  // Make sure the orphaned active uuid is at least present in the list.
  if (activeUuid && !sessions.some((s) => s.uuid === activeUuid)) {
    sessions = [{ uuid: activeUuid, title: 'původní chat', lastUsedAt: Date.now() }, ...sessions];
  }
  return { activeUuid, sessions };
}

function markMigrated(slug: string): void {
  try {
    localStorage.setItem(MIGRATED_MARKER_KEY(slug), '1');
    localStorage.removeItem(LEGACY_ACTIVE_KEY(slug));
    localStorage.removeItem(LEGACY_LIST_KEY(slug));
  } catch {
    /* ignore */
  }
}

function isMigrated(slug: string): boolean {
  try {
    return localStorage.getItem(MIGRATED_MARKER_KEY(slug)) === '1';
  } catch {
    return false;
  }
}

async function putIndex(
  slug: string,
  index: SessionIndex,
  deletedUuids?: string[],
): Promise<SessionIndex> {
  // The server merges `sessions` into the shared on-disk index rather than
  // replacing it, so a stale snapshot here can't drop another browser's
  // threads. Removals must be explicit — pass the uuid(s) in `deletedUuids`.
  const body = deletedUuids && deletedUuids.length ? { ...index, deletedUuids } : index;
  const res = await authenticatedFetch(`/api/beyond/sessions/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT /api/beyond/sessions/${slug} -> ${res.status}`);
  const data = (await res.json()) as Partial<SessionIndex>;
  return {
    activeUuid: typeof data.activeUuid === 'string' ? data.activeUuid : null,
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
  };
}

/**
 * Load session index for `slug` from the server. Handles the one-shot
 * localStorage → server migration transparently: if the server is empty for
 * this slug but localStorage still has data, we push it up and clear local.
 */
export async function fetchSessionIndex(slug: string): Promise<SessionIndex> {
  const res = await authenticatedFetch(`/api/beyond/sessions/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    // Server unreachable → fall back to localStorage so the UI still works
    // offline. Persisting will fail until the server comes back, but reads
    // shouldn't crash the chat.
    const legacy = readLegacyLocalStorage(slug);
    return legacy ?? { activeUuid: null, sessions: [] };
  }
  const data = (await res.json()) as Partial<SessionIndex>;
  const fromServer: SessionIndex = {
    activeUuid: typeof data.activeUuid === 'string' ? data.activeUuid : null,
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
  };

  // One-shot migration: server is fresh but we have legacy state on this device.
  if (
    !isMigrated(slug) &&
    fromServer.sessions.length === 0 &&
    !fromServer.activeUuid
  ) {
    const legacy = readLegacyLocalStorage(slug);
    if (legacy) {
      try {
        const persisted = await putIndex(slug, legacy);
        markMigrated(slug);
        return persisted;
      } catch (err) {
        console.warn('[beyond] sessions migration failed, will retry next mount', err);
        return legacy;
      }
    }
  }

  // Mark migration done even if there was nothing to migrate, so we don't
  // re-check legacy keys on every chat open.
  if (!isMigrated(slug)) markMigrated(slug);

  return fromServer;
}

/**
 * Ask the server for an AI-generated title (2–5 Czech words) for a chat, from
 * its first user message. Best-effort: returns null on any failure so callers
 * keep their snippet fallback. The server runs a cheap, MCP-free Haiku call.
 */
export async function suggestSessionTitle(text: string): Promise<string | null> {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  try {
    const res = await authenticatedFetch('/api/beyond/sessions/suggest-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: unknown };
    return typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Persist the index to the server. Fire-and-forget for callers — errors are
 * logged but never thrown back into render.
 */
export function persistSessionIndex(
  slug: string,
  index: SessionIndex,
  deletedUuids?: string[],
): void {
  void putIndex(slug, index, deletedUuids).catch((err) => {
    console.warn(`[beyond] failed to persist sessions for ${slug}`, err);
  });
}
