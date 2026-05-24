# Beyond Brain — osobní AI asistent

Apple-sleek mentoringová appka pro Tima Trnku. Postavená na forku
[siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) (AGPL-3.0),
backend wrapuje Claude Code CLI. Frontend kompletně přepsán do
Beyond Brain design jazyka.

> Originální README pro upstream: viz [`README.md`](README.md).

---

## Design vibe

- Soft pastel gradient pozadí (sunrise / day / sunset / night podle hodiny).
- Instrument Serif hero text v češtině ("Dobré ráno, Štěpáne. Co dnes řešíme?").
- Glassmorphism cards (`bg-glass`, `beyond-card`).
- Sidebar zaměřený na **6 aktivních klientů** (Ivana Juříková, Jakub Bolek,
  Jakub Přívara, Lukáš Rusek, Patrik Kruntorad, Pavel Sedláček) s W## a počty
  otevřených slibů.
- Framer Motion stagger / spring na všech klíčových interakcích.
- Default light mode, automaticky přepne na dark mezi 22–05.

Detailní spec: [`design-system/VISION.md`](design-system/VISION.md).
Iterační deník: [`design-system/NOTES.md`](design-system/NOTES.md).
Screenshoty: [`design-system/progress/`](design-system/progress/).

---

## Jak rozjet

```bash
git clone git@github.com:StepanKakes/beyond-brain-app.git
cd beyond-brain-app
git checkout redesign  # dokud nepřejdeme na main

cp .env.example .env
# uprav SERVER_PORT, VITE_PORT, HOST dle potřeby

npm install
npm run dev            # server (3001) + vite client (5173)
```

Otevři `http://localhost:5173`. Při prvním spuštění tě nasměruje na
SetupForm — zaregistruj single-user (např. `tim`).

### Beyond client data

Sidebar čte živá data z `~/Documents/GitHub/beyond-brain/clients/aktivni/*/`.
Pokud beyond-brain repo není na téhle cestě, sidebar zobrazí jen smart-folders
a hlášku „Naklonuj beyond-brain repo".

Override:

```bash
export BEYOND_BRAIN_PATH=/jiná/cesta/beyond-brain
```

Volitelně pro zelenou n8n status tečku:

```bash
export BEYOND_N8N_HEALTH=https://n8n.tvojedoména.cz/healthz
```

---

## Preview / iterace bez backendu

Pro design iterace bez auth / WS:

- `/__preview/welcome` — welcome screen
- `/__preview/chat` — mock chat s 3 messages
- `/__preview/sidebar` — sidebar v izolaci
- `/__preview/all` — sidebar + welcome split

URL parametry:

- `?bg=morning|day|evening|night` — vynutit gradient + greeting
- `?theme=light|dark` — vynutit theme override

Příklad: `http://localhost:5173/__preview/all?bg=evening&theme=light`.

---

## Klíčové soubory

| Soubor | Co to dělá |
|---|---|
| `tailwind.config.js` | Beyond pastel paleta, `font-serif`/`font-sans`, glass shadows |
| `src/index.css` | Beyond Brain Design System utilities (`.beyond-bg-*`, `.beyond-card`, `.bg-glass*`, `.beyond-chip`) |
| `src/App.tsx` | Mount `BeyondBackground` vně `ProtectedRoute` + `/__preview` router |
| `src/components/beyond/BeyondBackground.tsx` | Time-of-day gradient (auto + URL override) |
| `src/components/beyond/BeyondWelcome.tsx` | Hero greeting + suggestion chips |
| `src/components/beyond/BeyondClientsList.tsx` | Živý 6-klient sidebar (hook `useBeyondClients`) |
| `src/components/beyond/BeyondStatusFooter.tsx` | n8n / git / raw stáří dots |
| `src/components/beyond/BeyondChatPreview.tsx` | Mock chat (referenční, pro screenshoty) |
| `src/components/beyond/BeyondAssistantAvatar.tsx` | Sdílený gradient avatar |
| `server/routes/beyond.js` | `/api/beyond/clients` + `/api/beyond/status` |
| `src/contexts/ThemeContext.jsx` | Auto-dark v noci, manual override |

---

## Screenshoty

| Fáze | Snapshot |
|---|---|
| A — Foundation | `design-system/progress/fase-A-{morning,day,evening,night}.png` |
| B — Welcome + Chat | `design-system/progress/fase-B-{welcome,chat,all}.png` |
| C — Sidebar | `design-system/progress/fase-C-sidebar-{morning,day,evening,night}.png` |
| D — Animations | `design-system/progress/fase-D-*.png` + `design-system/demos/welcome-anim-*ms.png` |
| E — Mobile / PWA | `design-system/progress/fase-E-mobile-*.png` + `fase-E-desktop-*.png` |

---

## Deploy (Coolify)

`growbeyond.cz` (a tedy i Beyond Brain produkce) je hostovaná na
[Coolify](https://coolify.io/), ne na Vercelu — vyhni se Vercel-specific
recommendations.

Coolify nastavení:

1. Type: **Nixpacks** (auto-detect Node).
2. Build command: `npm run build`
3. Start command: `npm run server`
4. Port: `3001` (matchuje `SERVER_PORT` z `.env`).
5. Env vars: `SERVER_PORT`, `HOST`, optional `BEYOND_BRAIN_PATH`,
   `BEYOND_N8N_HEALTH`, JWT_SECRET, ENCRYPTION_KEY (viz `.env.example`).
6. Persistent volume: namapuj `~/.cloudcli/` (kde žije auth.db) na host
   storage, ať přežije rebuildy.
7. Optional: mountni si `~/Documents/GitHub/beyond-brain` jako read-only
   volume, ať klienti list funguje on-host.

---

## Licence

AGPL-3.0-or-later, dědí z claudecodeui upstreamu. Beyond Brain doplňky
jsou pod stejnou licencí.
