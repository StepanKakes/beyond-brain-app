# Beyond Brain — osobní AI asistent

Mentoringová appka pro Tima Trnku. Fork
[siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) (AGPL-3.0):
z upstreamu zůstal backend, který obaluje Claude Agent SDK, frontend je celý
vlastní. Data čte z repa `beyond-brain` (klienti, cally, sliby).

Běží na Timově Windows stroji jako služba `BeyondBrainApp`, nasazuje se samo
push do `main` (viz [Deploy](#deploy)).

> Upstream README: [`README.md`](README.md).

---

## Design: v3 Liquid Glass

Zdroj pravdy je [`src/styles/beyond-glass.css`](src/styles/beyond-glass.css).
Reprodukuje `tokens.css` + `chat.css` z design handoffu 1:1 (světlé téma) a
přidává dark variantu, můstek na Tailwind a styly pro plochy, které handoff
neobsahoval (permission a ask panely, konektory, náhled souborů, nastavení).

Všechno kreslí `--bb-*` tokeny a `.bb-*` třídy. Načítá se v `main.jsx` až po
`index.css`, takže přebíjí starší vrstvu.

**Historie směru**, ať je jasné, co už neplatí:

| Verze | Směr | Stav |
|---|---|---|
| v1 | Peach glassmorphism, gradient podle denní doby, Instrument Serif hero | zahozeno |
| v2 | Hyperminimalismus, bílá, prázdný prostor, skrytý sidebar | zahozeno |
| v3 | Liquid Glass podle handoffu | **platí** |

[`design-system/VISION.md`](design-system/VISION.md) a
[`design-system/NOTES.md`](design-system/NOTES.md) popisují v1 a v2. Drž je jako
deník rozhodnutí, ne jako zadání — kód se jimi neřídí.

---

## Jak rozjet

```bash
git clone git@github.com:StepanKakes/beyond-brain-app.git
cd beyond-brain-app

cp .env.example .env
npm install
npm run dev            # server (3001) + vite client (5173)
```

Otevři `http://localhost:5173`. Při prvním spuštění tě SetupForm nechá založit
jediného uživatele.

Sidebar čte živá data z `clients/aktivni/*` v beyond-brain repu. Když repo na
očekávané cestě není, zobrazí prázdný seznam.

### Ověření před pushem

```bash
npm run typecheck      # klient i server
npm run lint           # 0 chyb je podmínka, varování projdou
```

Deploy pouští obojí na runneru, takže rozbitý typecheck nenasadí, ale neprojde.

---

## Architektura

### Frontend — `src/components/beyond/`

`BeyondApp` je jediná route a URL nese, co je otevřené:

```
/                    Velín: co dnes hoří
/klienti             mřížka klientů podle naléhavosti
/klient/<slug>       detail: časová osa, sliby, měření, vlajky
/hovory              naplánované hovory z Cal.com
/c/<client-slug>     chat klienta (naváže na jeho aktivní session)
/c/new               čerstvý univerzální chat
/c/new/<uuid>        konkrétní univerzální session
```

Domovská obrazovka je **Velín**, ne chat. Ráno potřebuješ vidět stav, ne prázdný
prompt. Chat zůstal plnohodnotnou položkou v sidebaru a všechny jeho routy jsou
beze změny.

`BeyondApp` se nikdy neodmountuje a parsuje `location.pathname` sám — vnořené
`<Route>` by ho při každé změně parametru remountovaly a shodily rozepsaný chat.

| Soubor | Co dělá |
|---|---|
| `BeyondApp.tsx` | routování, otevírání bočních ploch |
| `BeyondShell.tsx` | sidebar (push na desktopu, overlay pod 900 px) + hlavní sloupec |
| `BeyondChat.tsx` | životní cyklus tahu: socket, session, streaming, schvalování nástrojů, přílohy, composer |
| `chat/` | vše, co chat vykresluje, plus čisté transformace |
| `velin/` | Velín, mřížka klientů, detail klienta, hovory, správa týmu |
| `BeyondFilePreview.tsx` | náhled souboru z brain repa |
| `BeyondHtmlCanvas.tsx` | živé HTML/SVG z odpovědi agenta |
| `BeyondConnectors.tsx` | správa MCP konektorů |
| `BeyondSettings.tsx` | model, animace přemýšlení |

Boční plochy se otevírají window eventy, ne prop drillingem:
`beyond:open-file`, `beyond:open-html`, `beyond:open-connectors`,
`beyond:open-settings`, `beyond:set-model`, `beyond:set-loader`.

#### `chat/`

Rozdělené z `BeyondChat.tsx`, který měl 2 900 řádků.

| Soubor | Co dělá |
|---|---|
| `types.ts` | tvary transkriptu a panelů |
| `transcript.ts` | payload backendu → `ChatMessage[]`, bez Reactu |
| `toolDisplay.ts` | jak se volání nástroje jmenuje, ikona, náhled |
| `prefs.ts` | povolené nástroje, bypass, model (localStorage) |
| `attachments.ts` | co composer bere jako přílohu a limity |
| `format.ts` | drobné formátování, signál o změně sessions |
| `MessageBlock.tsx` | jeden řádek transkriptu včetně kroků nástrojů |
| `AskPanel.tsx` | AskUserQuestion |
| `PermissionPanel.tsx` | Jednou / Vždy / Odmítnout |
| `PermissionsSheet.tsx` | seznam a odebrání uložených povolení |
| `WhatsAppActionCard.tsx` | náhled a úprava odchozí WhatsApp zprávy před odesláním |
| `SessionsMenu.tsx` | historie chatů klienta |
| `ModelPicker.tsx`, `TokenBudgetChip.tsx`, `AttachmentChip.tsx` | prvky composeru |

### Backend — `server/`

| Mount | Auth | K čemu |
|---|---|---|
| `/api/beyond/velin` | JWT | Velín, mřížka, detail klienta, hovory, přestavba indexu |
| `/api/beyond` | JWT | `config`, `clients`, `status`, `repo-status`, `file`, `raw-file`, `tree`, `models`, `sync`, `sessions/*` |
| `/api/beyond/mcp` | JWT | CRUD konektorů, test, start OAuth |
| `/api/beyond-mcp-oauth` | žádná (callback) | návrat z OAuth |
| `/api/beyond-agent` | sdílený secret | jednorázové dotazy pro n8n a Telegram |
| `/health` | žádná | health check pro deploy |

Cesta k brain repu má **jednoho vlastníka**: `server/utils/brain-path.js`.
Prohlížeč si ji nikdy neodvozuje, ptá se na `GET /api/beyond/config`
(hook `useBrainPath()`). Natvrdo zadaná cesta v klientovi kdysi vyrobila
fantomový strom `C:\Users\stepankakes\...` na Windows boxu.

Seznam aktivních klientů je taky jen jeden: adresáře v `clients/aktivni/`,
přes `server/services/beyond-clients.js`.

#### Index a signály

`brain-index.js` čte klientské markdowny do dotazovatelné podoby, `brain-signals.js`
z toho počítá příznaky úpadku. Index je projekce, ne pravda: markdown zůstává
zdrojem a index jde kdykoli zahodit a postavit znovu.

Tři pravidla, která parser drží a bez kterých by dashboard lhal:

- **Prázdno není nula.** V `mereni.md` prázdná buňka znamená „nevíme", nula
  znamená „dělal a nevyšlo". Neznámá hodnota je `null`, nikdy 0, a v grafu
  přerušuje čáru.
- **Páteř metrik má každý klient vlastní.** Kuba měří Lidi v DM a Hovory,
  Fit Na Cestách Leady a Bookingy. Čte se z hlavičky souboru, nepředpokládá se.
- **`W12` znamená dvě různé věci.** V `profil.md` je to programový týden (a bývá
  zastaralý), v `mereni.md` ISO kalendářní týden. V kódu se jmenují jinak,
  `programWeek*` proti `isoWeek`.

Signál, který platí pro většinu portfolia, se zvedne mezi systémové stavy
a uvede jednou. Bez toho by devět stejných řádků pohřbilo dva skutečné.

#### Agentní endpoint

`POST /api/beyond-agent/query` řeší několik věcí, které stojí za zapamatování:

- **Idempotence** podle `(telegramChatId, telegramMessageId)`. Telegram opakuje
  webhook po 60 s; bez toho SDK běželo na stejný vstup dvakrát.
- **Reset po nečinnosti** (výchozí 1 h). Bez něj JSONL jednoho Telegram vlákna
  roste donekonečna a každý tah platí plný `cache_creation`.
- **202 hned**, odpověď doručí sám do Telegramu. Obchází to 100s limit
  Cloudflare, takže žádná 524 a žádný retry.
- **`[TG]` prefix** u všeho, co skončí v Telegramu, aby brain CLAUDE.md
  přepnulo z markdownu na Telegram HTML.

---

## Preview bez backendu

Pro design iterace bez auth a WS: `/__preview/welcome`, `/__preview/chat`,
`/__preview/sidebar`, `/__preview/shell`, `/__preview/all`.

---

## Env

Kompletní seznam je v [`.env.example`](.env.example), tohle jsou ty, na kterých
záleží:

| Proměnná | K čemu |
|---|---|
| `SERVER_PORT`, `VITE_PORT`, `HOST` | porty a bind |
| `BEYOND_BRAIN_PATH` | cesta k brain repu; bez ní `~/Documents/GitHub/beyond-brain` |
| `BEYOND_AGENT_TOKEN` | sdílený secret pro `/api/beyond-agent`, je to credential |
| `BEYOND_AGENT_ALLOWED_TG_USERS` | allow list Telegram ID, prázdné = kdokoli s tokenem |
| `BEYOND_TG_BOT_TOKEN` | doručení odpovědi a průběhu do Telegramu |
| `BEYOND_AGENT_IDLE_RESET_MS` | reset session po nečinnosti, `0` vypne |
| `BEYOND_AGENT_IDEMPOTENCY_MS` | okno pro deduplikaci, `0` vypne |
| `BEYOND_N8N_HEALTH` | zelená tečka stavu n8n |
| `CONTEXT_WINDOW`, `VITE_CONTEXT_WINDOW` | velikost kontextu |

---

## Deploy

`.github/workflows/deploy.yml`, self hosted runner na Windows stroji. Push do
`main` udělá:

1. `git fetch` + `git reset --hard` na pushnutý commit
2. `npm ci` jen když se hnul lockfile
3. `npm run typecheck`
4. `npm run lint`
5. `npm run build:client` + `npm run build:server`
6. `Restart-Service BeyondBrainApp`
7. poll `/health`, dokud neodpoví (max ~60 s)

Cokoli z 3 až 5 spadne, služba se nerestartuje a běží dál stará verze. Když
služba nastartuje, ale `/health` neodpoví, run spadne — crash loop se nedá
přehlédnout.

Přepsatelné strojovými env proměnnými na runneru: `BEYOND_APP_DIR`,
`BEYOND_SERVICE_NAME`, `BEYOND_HEALTH_URL`.

Runner se zakládá jednorázově přes `scripts/setup-actions-runner.ps1`
(spustit jako správce).

---

## Licence

AGPL-3.0-or-later, dědí z claudecodeui upstreamu. Beyond Brain doplňky jsou pod
stejnou licencí.
