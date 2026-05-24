# Beyond Brain Redesign — Notes

Pracovní deník redesignu. Decisions, gotchas, follow-ups.

## Fáze A — Foundation

### Co je hotové
- `tailwind.config.js`: přidána `font-serif` (Instrument Serif), `font-sans` (Inter), `font-mono` (JetBrains Mono); pastel paleta `beyond.*`; backdrop-blur extras; box-shadow `glass*`/`soft`; nové keyframes (`fade-in-up`, `gradient-pulse`, `gradient-drift`).
- `index.html`: lang `cs`, title "Beyond Brain", PWA name "Beyond Brain", theme color `#FAF6F1` (light) / `#0F1626` (dark), Google Fonts preconnect + Instrument Serif + Inter + JetBrains Mono.
- `src/index.css`: nový blok **Beyond Brain Design System** s utilitami `beyond-bg-{morning,day,evening,night}`, `beyond-bg-layer`, `bg-glass{,-strong,-subtle}`, `beyond-card`, `text-hero`, `text-beyond-{primary,secondary,muted}`, `beyond-chip`, `beyond-loading-pulse`. Body je transparentní; `html` má fallback solid color pro FOUC. `#root` transparent.
- `src/components/beyond/BeyondBackground.tsx`: rotace pozadí podle hodiny (5–11 morning, 11–17 day, 17–22 evening, 22–5 night), tick každých 5 minut. `?bg=…` URL override pro screenshoty.
- `src/components/beyond/BeyondButton.tsx`: referenční komponent (primary/secondary/ghost/chip + sm/md/lg + leading/trailing icon).
- `src/contexts/ThemeContext.jsx`: default theme se počítá podle hodiny (night → dark). User toggle persistuje override. `?theme=light|dark` URL override.
- `src/App.tsx`: `<BeyondBackground />` zavěšen **mimo `ProtectedRoute`**, ať se gradient zobrazí i na loginu / onboardingu.
- `src/components/auth/view/AuthScreenLayout.tsx`: kompletně přestylované — `beyond-card`, Instrument Serif title, Beyond glyph (gradient circle, ne MessageSquare), českým copy "Postaveno na claudecodeui".
- `src/components/auth/view/AuthInputField.tsx`: glass input (bg `white/70`, blur-md, focus ring `beyond-dusk/30`).
- `src/components/auth/view/LoginForm.tsx`: hardcoded CZ texty ("Vítej zpátky", "Beyond Brain — tvůj druhý mozek", "Přihlásit se"). Tlačítko `bg-beyond-charcoal` (dark→white inverze).
- `src/components/sidebar/view/subcomponents/SidebarHeader.tsx`: Beyond glyph + "Beyond Brain" wordmark v Instrument Serif.
- `src/components/sidebar/view/subcomponents/SidebarContent.tsx`: vnější bg `white/55 backdrop-blur-2xl backdrop-saturate-150` (resp. `beyond-ink/55` v dark mode).
- `src/components/main-content/view/subcomponents/MainContentHeader.tsx`: hlavní header glass `bg-white/45 backdrop-blur-xl`.
- `src/components/app/AppContent.tsx`: root vnitřní container má `z-10` aby seděl nad gradient layerem; border sidebaru ztlumený na `white/30`.

### Gotchas / Decisions
- **`z-index` problém:** `position: fixed; z-index: -1` šel za html background → gradient se neukazoval. Fix: `z-index: 0` + nastavit `z-10` na obsah (AppContent, AuthScreenLayout). HTML drží jen solid fallback proti FOUC.
- **Auth screen nedědil gradient:** `ProtectedRoute` rendrovala `<LoginForm />` místo `children`, takže `BeyondBackground` (původně uvnitř ProtectedRoute) se vůbec nemountnul. Přesunuto výš v `App.tsx`.
- **i18n CZ chybí:** v `src/i18n/locales` není `cs/` namespace. Login zatím hardcoded CZ; do budoucna doplnit překlady (`cs/auth.json`, `cs/sidebar.json`, …) a jazyk detekovat z prohlížeče.
- **Tailwind nemá `@tailwindcss/forms`** — input styly jsem psal ručně. Mohlo by se hodit pro budoucí formuláře.
- **Dark mode vs night gradient:** v 00:30 (test session) se default theme nastaví na dark, gradient `night` je tmavě indigo/plum. Pro screenshoty pohodlí přidán `?theme=…` URL override.
- **Glass na chrome headless:** `backdrop-filter` v `--headless=new` funguje, ale občas chybí GPU akcelerace. Obrázky vypadají správně.

### TODO před Fází B
- Welcome screen (žádný klient/chat) — nahradit `MainContentStateView` s Czech personal assistant copy.
- Chat bubble redesign (`AI message left`, `User message right`, glassmorphism).
- Input area "Jak ti můžu pomoct?" + quick action chips.
- Loading text "Přemýšlím…" místo spinneru.

### Brand / TBD
- Tim ještě nedodal brand colors / logo. Zatím vlastní pastel paleta a glyph (gradient circle se sun-rays). Až přijde brand, swap v `tailwind.config.js` → `colors.beyond.*`.

### Doporučení pro deploy
- Coolify build: `npm run build` (client + server). Spustit `npm run server` na produkci.
- ENV: `SERVER_PORT`, `VITE_PORT`, `HOST` (viz `.env.example`). Auth (single-user) skrz setup screen při prvním spuštění.
- Google Fonts: `https://fonts.googleapis.com` musí být dostupný; alternativně lze stáhnout fonty lokálně do `public/fonts/`.
