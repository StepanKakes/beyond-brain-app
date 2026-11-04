// Mobilní appka (/m) a desktop mají oddělené balíky. Tady se rozhoduje, který se
// načte, aby telefon netahal editor, terminál ani desktopové styly.

// Register service worker for PWA + Web Push support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => {
    console.warn('Service worker registration failed:', err);
  });
}

const { pathname, search } = window.location;
const isMobilePath = pathname === '/m' || pathname.startsWith('/m/');

// Appka na ploše telefonu míří na /, tam ji přesměrujeme na mobilní verzi.
// Odkaz „Otevřít plnou verzi" to pro dané spuštění vypne.
let wantsDesktop = new URLSearchParams(search).has('desktop');
try {
  if (wantsDesktop) sessionStorage.setItem('m-desktop', '1');
  wantsDesktop = wantsDesktop || sessionStorage.getItem('m-desktop') === '1';
} catch {
  /* bez úložiště platí jen tenhle odkaz */
}
const isInstalled =
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isPhone = Math.min(window.screen.width, window.screen.height) < 600;

// Dvě samostatné funkce: spojené do jednoho ifu je minifikátor sloučí a Vite pak
// k mobilu přednačte i desktopový balík.
const loadMobile = () => import('./mobile/entry.tsx');
const loadDesktop = () => import('./desktop-entry.jsx');
const loadInstall = () => import('./install/entry.tsx');

if (pathname === '/instalace' || pathname === '/instalace/') {
  loadInstall();
} else if (!isMobilePath && pathname === '/' && isInstalled && isPhone && !wantsDesktop) {
  window.location.replace('/m');
} else {
  (isMobilePath ? loadMobile : loadDesktop)();
}
