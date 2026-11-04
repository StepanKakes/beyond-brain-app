import { createRoot } from 'react-dom/client';

import { Navod } from './Navod';
import '../styles/tokens.css';
import './instalace.css';

// Veřejná stránka, kam vede QR kód: kdo ji otevře, ještě nemusí být přihlášený
// a appka na ploše má stejně přihlášení oddělené od Safari. Proto vlastní balík
// bez zbytku appky. Motiv podle uložené volby, jinak podle systému, jako mobil.
const root = document.documentElement;
let saved: string | null = null;
try {
  saved = localStorage.getItem('theme');
} catch {
  /* bez úložiště podle systému */
}
const dark = saved === 'dark' || (saved !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
root.classList.add('m-html');
root.classList.toggle('dark', dark);
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#F6F6F4');
document.title = 'Brain do telefonu';

createRoot(document.getElementById('root') as HTMLElement).render(<Navod />);
