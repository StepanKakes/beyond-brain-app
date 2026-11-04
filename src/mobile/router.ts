import { useSyncExternalStore } from 'react';

// Malý router postavený na historii prohlížeče. Taby historii nepřidávají
// (jako v iOS), vnořené obrazovky ano, takže jde používat zpět i swipe.

export type Tab = 'dnes' | 'chaty' | 'klienti' | 'hovory' | 'vice';

export type Route =
  | { name: 'tab'; tab: Tab }
  | { name: 'chat'; uuid: string | null; slug: string; draft: string }
  | { name: 'ukol'; id: string }
  | { name: 'klient'; slug: string }
  | { name: 'navrhy' }
  | { name: 'obsah' }
  | { name: 'obsah-detail'; id: string }
  | { name: 'kpi' }
  | { name: 'rutiny' }
  | { name: 'rutina'; id: string }
  | { name: 'rutina-form'; id: string | null; sablona: string | null }
  | { name: 'soubory'; path: string };

export type Entry = { key: string; url: string; route: Route };

export const UNIVERSAL = '__universal__';

export function parseRoute(url: string): Route {
  const { pathname, searchParams } = new URL(url, window.location.origin);
  const parts = pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
  if (parts[0] === 'chat') {
    return {
      name: 'chat',
      uuid: parts[1] && parts[1] !== 'new' ? parts[1] : null,
      slug: searchParams.get('k') || UNIVERSAL,
      draft: searchParams.get('t') || '',
    };
  }
  if (parts[0] === 'ukol' && parts[1]) return { name: 'ukol', id: parts[1] };
  if (parts[0] === 'klient' && parts[1]) return { name: 'klient', slug: parts[1] };
  if (parts[0] === 'navrhy') return { name: 'navrhy' };
  if (parts[0] === 'obsah') return parts[1] ? { name: 'obsah-detail', id: parts[1] } : { name: 'obsah' };
  if (parts[0] === 'kpi') return { name: 'kpi' };
  if (parts[0] === 'rutiny') return { name: 'rutiny' };
  if (parts[0] === 'rutina' && parts[1] === 'nova') {
    return { name: 'rutina-form', id: null, sablona: searchParams.get('s') };
  }
  if (parts[0] === 'rutina' && parts[1] && parts[2] === 'upravit') return { name: 'rutina-form', id: parts[1], sablona: null };
  if (parts[0] === 'rutina' && parts[1]) return { name: 'rutina', id: parts[1] };
  if (parts[0] === 'soubory') return { name: 'soubory', path: searchParams.get('p') || '' };
  if (parts[0] === 'chaty' || parts[0] === 'klienti' || parts[0] === 'hovory' || parts[0] === 'vice') {
    return { name: 'tab', tab: parts[0] };
  }
  return { name: 'tab', tab: 'dnes' };
}

let counter = 0;
const make = (url: string): Entry => ({ key: `e${(counter += 1)}`, url, route: parseRoute(url) });
const here = () => window.location.pathname + window.location.search;

// entries[0] je vždy tab, nad ním leží vnořené obrazovky.
type State = { tab: Tab; stack: Entry[] };

function initial(): State {
  const entry = make(here());
  if (entry.route.name === 'tab') return { tab: entry.route.tab, stack: [] };
  return { tab: 'dnes', stack: [entry] };
}

let state: State = initial();
const listeners = new Set<() => void>();
let silentPop = false;

history.replaceState({ depth: state.stack.length }, '');

// Kolik obrazovek leží pod tím, co vzniklo přes pushState v tomhle spuštění.
let baseDepth = state.stack.length;

function set(next: State): void {
  state = next;
  listeners.forEach((listener) => listener());
}

window.addEventListener('popstate', (event) => {
  const depth = Number((event.state as { depth?: number } | null)?.depth ?? 0);
  if (depth <= state.stack.length) {
    set({ ...state, stack: state.stack.slice(0, depth) });
  } else {
    // Dopředu v historii nebo adresa po znovunačtení: vezmeme, co je v URL.
    const entry = make(here());
    if (entry.route.name === 'tab') set({ tab: entry.route.tab, stack: [] });
    else set({ ...state, stack: [...state.stack, entry] });
  }
});

export function selectTab(tab: Tab): void {
  const url = tab === 'dnes' ? '/m' : `/m/${tab}`;
  history.replaceState({ depth: 0 }, '', url);
  baseDepth = 0;
  set({ tab, stack: [] });
}

export function navigate(url: string): void {
  if (url === here()) return;
  const entry = make(url);
  if (entry.route.name === 'tab') {
    // Notifikace vedoucí na tab zavře, co je otevřené nad ním.
    selectTab(entry.route.tab);
    return;
  }
  const stack = [...state.stack, entry];
  history.pushState({ depth: stack.length }, '', url);
  set({ ...state, stack });
}

/** Chat dostal id až od serveru: změní adresu bez nové obrazovky. */
export function replaceTop(url: string): void {
  history.replaceState(history.state, '', url);
  const stack = state.stack.slice();
  const top = stack[stack.length - 1];
  if (top) stack[stack.length - 1] = { ...top, url, route: parseRoute(url) };
  state = { ...state, stack };
}

export function back(options: { silent?: boolean } = {}): void {
  silentPop = Boolean(options.silent);
  if (state.stack.length > baseDepth) {
    history.back();
    return;
  }
  // Otevřeno rovnou z notifikace: pod obrazovkou žádná historie není.
  const stack = state.stack.slice(0, -1);
  const url = stack.length ? stack[stack.length - 1].url : state.tab === 'dnes' ? '/m' : `/m/${state.tab}`;
  history.replaceState({ depth: stack.length }, '', url);
  baseDepth = stack.length;
  set({ ...state, stack });
}

export function takeSilentPop(): boolean {
  const value = silentPop;
  silentPop = false;
  return value;
}

export function useRouter(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
