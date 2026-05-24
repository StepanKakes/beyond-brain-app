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

## Fáze B — Welcome + Chat redesign

### Co je hotové
- `BeyondWelcome.tsx`: hero greeting podle denní doby ("Dobré ráno / odpoledne / večer / Ahoj, Štěpáne." + "Co dnes řešíme?" italic), 3 chip suggestions (Co je nového u Ivany / Action items Patrik / Sync all). `?bg=…` override platí i pro greeting.
- `MainContentStateView.tsx` empty state přepsán na `<BeyondWelcome />`. Loading state má Beyond gradient pulse místo spinneru + serif "Načítám".
- `MessageComponent.tsx`:
  - User bubble: `bg-beyond-charcoal/95` (dark→bílá inverze), `rounded-3xl rounded-br-lg`, glass shadow, generous padding.
  - User avatar: gradient `from-beyond-sky to-beyond-dusk/70`.
  - Assistant header: gradient circle (`peach → coral → plum`) jako Beyond avatar, label vždy "Beyond" (ne "Claude/Codex/…").
- `ChatComposer.tsx` placeholder: hardcoded "Jak ti můžu pomoct?" v `ChatInterface.tsx` (přebíjí `t('input.placeholder', …)`).
- `ClaudeStatus.tsx`: glass pill (`bg-white/65 backdrop-blur-xl`), CZ action words ("Přemýšlím", "Zpracovávám", …), Beyond gradient avatar, "Stop" místo "STOP" CAPS.

### Preview infrastructure
- `BeyondPreview.tsx`: standalone routes `/__preview/welcome`, `/__preview/chat`, `/__preview/sidebar`, `/__preview/all`. Bypassují `ProtectedRoute` + nedělají WS/Auth nic. Slouží jen pro screenshoty / iteraci. Neviditelné z reálné navigace.
- `BeyondChatPreview.tsx`: mock chat s 3 seed messages (user → AI s tool callem → user), složená "Přemýšlím…" pill, glass composer s quick chips. Demonstruje finální vizuál.
- `BeyondSidebarPreview.tsx`: ✨ **Phase C preview ready** — Beyond glyph + wordmark, search, smart folders (Dnes / Tento týden / Otevřené sliby), 6 klientů s avatary + W## + počet otevřených slibů + coral promise dot, status bar (n8n / git / raw), settings ikon.
- `BeyondAssistantAvatar.tsx`: sdílená gradient circle pro Beyond identitu v chatu.

### Gotchas
- **Greeting vs. fyzický čas:** v 00:36 (skutečný test) → night → "Ahoj". Aby screenshot ukázal "Dobré ráno", `getEffectiveTimeOfDay()` respektuje `?bg=…`.
- **Preview routy & SPA fallback:** Vite SPA fallback vrací `index.html`, takže `/__preview/...` funguje out-of-the-box v dev i prod (přes `historyApiFallback`).

### TODO Fáze C
- Reálný sidebar: nahradit `SidebarProjectList` (auto-detect GitHub repos) za **6 klientů z `~/Documents/GitHub/beyond-brain/clients/aktivni/`** s real-time daty z `profil.md` (W##), `_action-items.md` (open promises count), `raw/notion/dashboard.json` (cíl).
- Backend endpoint `/api/beyond/clients` který scanne adresář a vrátí JSON.
- Konverzace sekce zmenšit / posunout pod klienty.

### TODO Fáze D
- Framer Motion install + page transitions + bubble fade-in stagger + spring hover.


## Fáze C — Client-focused sidebar

### Co je hotové
- **Backend endpoint `GET /api/beyond/clients`** (`server/routes/beyond.js`):
  - Skenuje `~/Documents/GitHub/beyond-brain/clients/aktivni/` (override `BEYOND_BRAIN_PATH` env).
  - Per klient parsuje `profil.md` (název, Stav, "Aktuální týden W##", Notion link), `_action-items.md` (počet `- [ ]` = open promises), `raw/notion/dashboard.json` (weeklyGoal), a mtime `raw/` (čerstvost).
  - 30s cache. Graceful 404 fallback když adresář není.
- **Backend endpoint `GET /api/beyond/status`**: n8n ping (`BEYOND_N8N_HEALTH` env, optional), git přítomnost beyond-brain repo, "raw stáří" (nejstarší mtime ze všech `raw/` složek). Vrací `{ ok, label, hoursOld }`.
- **Auth:** oba endpointy chráněné `authenticateToken`. Jediný uživatel `tim`.
- **Frontend hook `useBeyondClients`**: fetch + 60s polling, error handling.
- **`BeyondClientsList`**: živá komponenta s avatarem, jménem, "W## · X otevřených slibů", coral promise dot, hover lift. Loading skeleton (3 pulse divs), error/empty state s instrukcí "Naklonuj beyond-brain repo".
- **`BeyondStatusFooter`**: 3 status tečky (n8n / git / raw) + settings ikon. Polling 90s.
- **`SidebarContent`**: nahoře BeyondClientsList (primární), pod tím `<details>` "Projekty & konverzace" obalující původní `SidebarProjectList`. BeyondStatusFooter před SidebarFooter (který je teď jen update banner).
- **Smart folders** (Dnes / Tento týden / Otevřené sliby) — UI placeholder, klik zatím nefiltruje. Phase D / E task: napojit na real filtry.
- **Search ⌘K** je v `SidebarHeader` (existující kbd hint).

### Gotchas / Decisions
- **Nemodifikovat backend** = nepřepisuj existující; nové endpointy pro nové features jsou OK (jinak Phase C nelze udělat smysluplně). Žádný existující endpoint změněn.
- **Hardcoded clients vs. live data:** mock v `BeyondSidebarPreview.tsx` (jen pro screenshoty bez auth) + `BeyondClientsList.tsx` (live data v reálném sidebaru). Mock list zrcadlí spec'd 6 klientů.
- **`details/summary` pro projekty** je nejjednodušší collapsible bez extra state. Tim si může otevřít historii kdykoli, ale defaultně sbalená — sidebar zaměřený na klienty.
- **Real-time refresh:** clients = 60s polling, status = 90s. Stačí pro UX, šetří disk IO. ESC: WebSocket push neuděláno, beyond-brain repo se nemění tak často.
- **Conversation section pod klienty:** záměrně menší, méně visible (uvnitř `<details>`). Migration plán: klikem na klienta v Phase D otevřít konkrétní Beyond session a původní project list smazat.

### TODO (Phase D / nezablokuje commit)
- Klik na klienta → start Beyond chat s preloaded systémovým promptem (Beyond hlas, klient context). Vyžaduje napojit `onClientSelect` na `onNewSession`.
- Smart folders filtrování (Dnes = klienti s callem dnes, Týden = s milníkem tento týden, Otevřené sliby = filtr `openPromises > 0`).
- Status footer tooltipy s detailem (`title` už je, ale ne s vlastní stylovkou).
- Notion dashboard rychlolink v hover stavu (otevřít v novém tabu).

### Doporučení pro deploy
- Beyond-brain repo musí být na ~/Documents/GitHub/beyond-brain (nebo nastav `BEYOND_BRAIN_PATH` env).
- Volitelně `BEYOND_N8N_HEALTH=https://n8n.example.com/healthz` pro zelenou tečku.

