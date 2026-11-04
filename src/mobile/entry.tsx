import { createRoot } from 'react-dom/client';

import MobileApp from './MobileApp';
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101216' : '#F6F6F4');
};
applyTheme();
media.addEventListener('change', applyTheme);

root.classList.add('m-html');

// iOS jinak nespouští :active na dotyk.
document.addEventListener('touchstart', () => undefined, { passive: true });

// Po nasazení může uložená kostra chtít kousek, který už na serveru není.
window.addEventListener('vite:preloadError', () => {
  void caches?.delete('beyond-m-shell').finally(() => window.location.reload());
});

createRoot(document.getElementById('root') as HTMLElement).render(<MobileApp />);

// Markdown donačteme dopředu, ať je chat hned hotový i bez signálu.
const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1200));
idle(() => {
  void import('./Markdown');
});
