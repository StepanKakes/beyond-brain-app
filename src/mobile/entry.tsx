import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import MobileApp from './MobileApp';
import '../styles/tokens.css';
import './mobile.css';

// Motiv stejně jako na desktopu: uložená volba, jinak podle systému.
const root = document.documentElement;
const media = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('theme');
  } catch {
    /* bez úložiště podle systému */
  }
  const dark = saved === 'dark' || (saved !== 'light' && media.matches);
  root.classList.toggle('dark', dark);
  // Glisse má vlastní tmavé tokeny a bez tohohle by se řídil jen systémem, ne volbou v appce.
  root.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#F6F6F4');
};
applyTheme();
media.addEventListener('change', applyTheme);
window.addEventListener('m-theme', applyTheme);

root.classList.add('m-html');

// iOS obarví stavový řádek podle skutečného fixed prvku úplně nahoře, pseudoprvky
// nevidí. Musí být přímo v body, v pohyblivých obrazovkách by přestal být fixed.
const statusCover = document.createElement('div');
statusCover.className = 'm-status-cover';
document.body.append(statusCover);

// iOS jinak nespouští :active na dotyk.
document.addEventListener('touchstart', () => undefined, { passive: true });

// Po nasazení může uložená kostra chtít kousek, který už na serveru není.
window.addEventListener('vite:preloadError', () => {
  const clear = 'caches' in window ? caches.delete('beyond-m-shell') : Promise.resolve(true);
  void clear.finally(() => window.location.reload());
});

// Pád vykreslení nesmí skončit tichou bílou stránkou.
class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-crash">
        <h1>Něco se rozbilo</h1>
        <pre>{String(this.state.error.message || this.state.error)}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          Načíst znovu
        </button>
      </div>
    );
  }
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <CrashScreen>
    <MobileApp />
  </CrashScreen>,
);

// Markdown donačteme dopředu, ať je chat hned hotový i bez signálu.
const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1200));
idle(() => {
  void import('./Markdown');
});
