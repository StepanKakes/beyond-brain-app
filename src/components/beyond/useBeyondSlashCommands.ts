import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { authenticatedFetch } from '../../utils/api';
import { BEYOND_APP_COMMANDS, type BeyondSlashCommand } from './beyondCommands';

/**
 * Beyond Brain — composer slash-command autocomplete.
 *
 * Merges the curated APP commands with the project's real custom commands
 * (`/api/commands/list`) and plugin skills (`/api/providers/claude/skills`).
 * The menu opens while the input is a lone slash token (`^/\S*$`); once a space
 * is typed the user is entering args, so it closes. `onKeyDown` returns true
 * when it consumed the key so the composer's Enter-to-send doesn't also fire.
 */

type RemoteCommandListResponse = { custom?: Array<{ name?: string; description?: string }> };
type SkillsResponse = { data?: { skills?: Array<{ command?: string; description?: string }> } };

export function useBeyondSlashCommands({
  value,
  projectPath,
  onChoose,
}: {
  value: string;
  /** Host-resolved brain repo path, or `null` while it is still loading. */
  projectPath: string | null;
  onChoose: (cmd: BeyondSlashCommand) => void;
}) {
  const [remote, setRemote] = useState<BeyondSlashCommand[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  // Load custom commands + skills once per project. Best-effort: either source
  // failing just means fewer entries in the menu. Skipped until the path is
  // known — querying with a wrong path is what used to return an empty menu.
  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    void (async () => {
      const out: BeyondSlashCommand[] = [];
      try {
        const r = await authenticatedFetch('/api/commands/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath }),
        });
        if (r.ok) {
          const d = (await r.json()) as RemoteCommandListResponse;
          for (const c of d.custom || []) {
            if (typeof c?.name === 'string' && c.name.startsWith('/')) {
              out.push({ name: c.name.toLowerCase(), description: c.description || 'Vlastní příkaz', kind: 'custom' });
            }
          }
        }
      } catch { /* ignore */ }
      try {
        const r = await authenticatedFetch(
          `/api/providers/claude/skills?workspacePath=${encodeURIComponent(projectPath)}`,
        );
        if (r.ok) {
          const d = (await r.json()) as SkillsResponse;
          const seen = new Set<string>();
          for (const s of d?.data?.skills || []) {
            const cmd = typeof s?.command === 'string' ? s.command : '';
            if (!cmd || seen.has(cmd)) continue;
            seen.add(cmd);
            out.push({ name: cmd.toLowerCase(), description: s.description || 'Skill', kind: 'skill' });
          }
        }
      } catch { /* ignore */ }
      if (!cancelled) setRemote(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const all = useMemo(() => {
    const map = new Map<string, BeyondSlashCommand>();
    for (const c of BEYOND_APP_COMMANDS) map.set(c.name, c);
    for (const c of remote) if (!map.has(c.name)) map.set(c.name, c);
    return Array.from(map.values());
  }, [remote]);

  // The active query is the slash token being typed, or null when the input
  // isn't a lone slash token (empty, has a space, or doesn't start with /).
  const query = useMemo(() => {
    const t = value.trimStart();
    const m = t.match(/^\/(\S*)$/);
    return m ? m[1].toLowerCase() : null;
  }, [value]);

  const items = useMemo(() => {
    if (query == null) return [];
    if (!query) return all;
    const starts = (s: string) => s.slice(1).toLowerCase().startsWith(query);
    const prefix = all.filter((c) => starts(c.name) || c.aliases?.some(starts));
    if (prefix.length) return prefix;
    return all.filter(
      (c) => c.name.toLowerCase().includes(query) || c.description.toLowerCase().includes(query),
    );
  }, [all, query]);

  useEffect(() => {
    if (query != null && items.length > 0) {
      setOpen(true);
      setActiveIndex(0);
    } else {
      setOpen(false);
    }
  }, [query, items.length]);

  const close = useCallback(() => setOpen(false), []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open || items.length === 0) return false;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const idx = Math.min(Math.max(activeIndex, 0), items.length - 1);
        onChoose(items[idx]);
        setOpen(false);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return true;
      }
      return false;
    },
    [open, items, activeIndex, onChoose],
  );

  return { open, items, activeIndex, setActiveIndex, onKeyDown, close };
}
