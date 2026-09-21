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
| `/health` | žádná | health check pro deploy, v `busy` co právě běží (chaty, úloha) |

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

Klient s `Stav: Doběhl` negeneruje žádné signály a v mřížce sedí zvlášť. Zůstává
v `clients/aktivni/` (denní pully tam zapisují a historie se hodí), jen vypadne
z triáže. Znovuotevření je jedno slovo v `profil.md`.

---

## Agent: co dělá sám

Do tohohle commitu appka neplánovala nic, veškeré hodiny držel n8n a volal
dovnitř. To sedí na raw pully, které jen stahují, ale ne na práci, která
potřebuje brain repo a SDK session. Ty žijí tady, takže tu teď běží i hodiny.

`server/services/beyond-scheduler.js` je záměrně hloupý: jeden časovač, jedna
úloha v jednu chvíli, každá si sama řekne, jestli je na řadě. Žádná
souběžnost. Je to jeden stroj.

Běh spouští dvě věci: **hodiny** (každá úloha má rozvrh, z kódu nebo
z `system/ulohy.json` v brainu) a **událost** (zpráva na WhatsAppu, hotový
přepis, nový booking, doručené na `/api/beyond-events`). Události mají
přednost: tik nejdřív vyřídí, co čeká ve frontě, a teprve pak se dívá na
kalendář. Před každým během se brain pullne, aby viděl, co mezitím commitl
n8n, a po běhu se commitne a pushne, co běh změnil, pod jménem úlohy.

Deploy před restartem služby čeká, až nic neběží (viz [Deploy](#deploy)).
Kdyby se služba přesto restartovala uprostřed běhu, záznam by zůstal navždy
ve stavu „běží". Při startu se takové běhy uzavřou jako chyba s důvodem, ať
obrazovka Agent neukazuje fantoma.

| Úloha | Kdy | Co dělá |
|---|---|---|
| `registr-klientu` | denně 05:50 | Notion Clients 1:1 do `clients/_registr.json` (bez modelu) |
| `notion-raw` | denně 06:00 | Dashboard, cally a úkoly každého aktivního klienta do `raw/notion/*.json` (bez modelu) |
| `wa-raw` | denně 06:07 | Zprávy klientských skupin přes WAHA do `raw/whatsapp.json`, hlasovky jednou přepsané whisperem a přenášené dál (bez modelu) |
| `zpracuj-call` | každých 10 min, nebo událost `fathom` | Když v `raw/fathom/` přibude přepis novější než poslední zápis v `cally.md`, přepíše ho do zápisu, vytáhne sliby na obě strany a čísla z check-inu, a připraví klientovi shrnutí do fronty |
| `wa-check` | jen událost `waha` | Po dávce zpráv od klienta načte živé vlákno přes WAHA, doplní `whatsapp.md`, případně připraví návrh odpovědi |
| `sync-klientu` | denně 06:20 | Skill `sync-client all`, promítne noční raw vrstvu do kurátorských souborů |
| `napsat-navrhy` | denně 06:35 | Kde klient klouže nebo se dlouho neozval, napíše návrh zprávy a nechá ho čekat na kliknutí |
| `pripomenout-hovor` | každých 10 min | Hodinu před hovorem pošle na Telegram, s kým je, co je otevřené a na co si dát pozor |
| `napsat-co-dluzime` | denně 07:10 | U slibů na naší straně zkusí rovnou napsat ten výstup do `workspace/drafty/`. Když nemá podklad, řekne, co chybí |
| `zalozit-soubory` | denně 07:30 | Aktivnímu klientovi bez `mereni.md` nebo `_action-items.md` je založí podle vzoru |
| `ranni-brief` | denně 06:40 | Spočítá signály, napíše krátký brief, uloží do `workspace/reporty/` a pošle na Telegram |
| `pripravit-hovory` | denně 18:30 | Pro každý hovor do 36 hodin vygeneruje brief skillem `pre-call` do `workspace/briefy/` |
| `roadmap-check` | pondělí 08:00 | Plán proti realitě u všech aktivních klientů |
| `srovnat-profily` | pondělí 08:30 | Opraví „Aktuální týden" tam, kde se rozešel s datem startu |
| `uceni-review` | denně 21:00 | Projde zprávy, které Tim před odesláním přepsal, a dnešní běhy; z toho, co se opakuje, navrhne patch skillu nebo zápis do paměti. Levnější model (`BEYOND_REVIEW_MODEL`, výchozí sonnet) |

Časy jsou v pásmu `BEYOND_TZ` (výchozí Europe/Prague), ne v pásmu stroje:
Tim v Thajsku dostane brief ve svých 06:40. Totéž pásmo řídí „dnes" u úkolů
a slova jako `zítra` v rychlém zadání (`server/services/beyond-time.js`).
Změna pásma je změna `.env` a restart, bez deploye.

Rozvrh každé vestavěné úlohy jde přepsat v `system/ulohy.json` (`rozvrh`),
bez deploye. Rozvrhy: `every`, `daily`, `weekly`, `cron` (pět polí), `at`
(jednou), `manual`. Parser je `server/services/beyond-schedule.js`.

Práce samotná není v kódu, je v brainu. Každá úloha je jen trigger plus prompt,
který předá práci některému z jedenácti skillů v `.claude/skills/`. Znamená to,
že se chování agenta mění editací markdownu, ne deployem.

**Tři pojistky:**

- **Nic neopouští brain.** Úlohy čtou repo a zapisují zpátky do něj. Git je
  auditní stopa i vrácení zpět. Cokoli, co by šlo ke klientovi, končí jako
  draft v `workspace/drafty/`, nikdy jako odeslaná zpráva.
- **Úloha bez práce nespotřebuje nic.** Než se sáhne na model, každá se zeptá
  sama sebe, jestli je co dělat, a hlasitě přeskočí.
- **Každý běh je vidět.** Obrazovka Agent ukazuje, co běh tvrdí, že udělal,
  a vedle toho git diff toho, co se skutečně změnilo. To jsou dvě různá
  tvrzení a záměrně se zobrazují zvlášť.

Vypnout jde jednotlivá úloha, všechno naráz (tlačítko Pozastavit) nebo celý
plánovač přes `BEYOND_SCHEDULER=0`.

### Vlastní úlohy: úloha je data, ne kód

`system/ulohy.json` v brainu drží vedle přepsaných rozvrhů i **vlastní
úlohy**: prompt, rozvrh, volitelně skill, kam doručit (`telegram`, `soubor`
do `workspace/reporty/`, `nic`), kolikrát (`repeat`), `continuity` (úloha
dostane svůj minulý výstup, aby nehlásila totéž) a `noAgent` (text se
doručí doslova, bez modelu, na připomínky). Jednorázová úloha se po běhu
sama vypne. Odpověď `[TICHO]` znamená nic nedoručovat.

Zakládá je nástroj `beyond_schedule` z chatu nebo Telegramu („za tři dny mi
připomeň, jestli Honza poslal metriky"), nebo `POST /api/beyond/velin/agent/tasks`.
**Uvnitř naplánovaného běhu je plánování vypnuté** (ochrana proti rekurzi).
Každá změna souboru je commit v brainu, takže historie úloh je v gitu.
Kód: `server/services/beyond-tasks.js`.

### Události: reagovat, ne pollovat

`POST /api/beyond-events/<cesta>` je dveře pro cizí systémy. Cesty jsou
v brainu v `system/udalosti.json`; každá říká:

- **auth**: `secret` (hlavička, výchozí `X-Beyond-Secret`), `hmac` (podpis
  těla, `sha256`/`sha512`, hex i base64), `standard-webhooks`. Secret se
  bere z env proměnné pojmenované v `secretEnv`, nebo z `BEYOND_EVENT_SECRET`.
  Ověřuje se na syrových bajtech, proto je router namountovaný před JSON
  parserem.
- **events** + `eventField`/`eventHeader`: které události bere.
- **filters**: deklarativní (`equals`, `notEquals`, `in`, `contains`,
  `exists`, `regex`) nad tělem.
- **coalesce**: `key` (šablona), `windowSeconds`, `maxWaitSeconds`. Klient,
  který pošle šest zpráv za minutu, vyrobí jeden běh, až se dávka usadí.
- **job** a **context**: kterou úlohu spustit a co jí předat. Šablony
  `{a.b.c}` berou hodnoty z těla; kontext je pro model data, ne instrukce.

Duplicitní doručení (id z hlavičky, jinak hash těla) se hodinu ignoruje.
Fronta je v SQLite (`beyond_events`), restart nic neztratí. Odpověď je hned:
202 zařazeno nebo slito, 200 ignorováno, 401/404/429 když se volat nemělo.

Zapojení zdrojů:

| Zdroj | Jak | Poznámka |
|---|---|---|
| WAHA | webhook `message` na `/api/beyond-events/waha`, HMAC sha512 v `X-Webhook-Hmac` | klíč = `WHATSAPP_HOOK_HMAC_KEY` ve WAHA i `BEYOND_EVENT_SECRET_WAHA` tady; filtr jen skupiny, jen cizí zprávy |
| Fathom | n8n workflow Fathom Calls po commitu přepisu zavolá `/api/beyond-events/fathom` s `X-Beyond-Secret` | přepis musí být v repu dřív, než agent běží; proto přes n8n, ne přímo z Fathomu |
| Cal.com | webhook `BOOKING_CREATED`, `BOOKING_RESCHEDULED` na `/api/beyond-events/calcom`, podpis `X-Cal-Signature-256` | secret = `BEYOND_EVENT_SECRET_CALCOM` |
| cokoliv | `/api/beyond-events/n8n` s tělem `{"job": "...", "context": {...}}` | obecné přeposlání |

Aby sem webhooky došly, musí mít stroj veřejnou adresu:
`scripts/setup-cloudflared.ps1` postaví Cloudflare Tunnel jako Windows
službu. Bez tunelu jde všechno dál po starém (polling), jen pomaleji.
Kód: `server/services/beyond-events.js`, `server/routes/beyond-events.js`.

### Nástroje agenta nad appkou

Každý běh (chat, Telegram, úloha) dostane in-process MCP server `beyond`
(`server/services/beyond-agent-tools.js`), připojený v `attachBeyondLayer`
v `claude-sdk.js`:

| Nástroj | Co |
|---|---|
| `beyond_schedule` | list, create, update, pause, resume, remove, run úloh |
| `hledej_historii` | fulltext nad historií všech konverzací (SQLite FTS5, bez modelu) |
| `pamet` | add, replace, remove v paměti agenta; tvrdý limit znaků |
| `skill_manage` | list, view, patch, create: návrh změny skillu nebo pravidla, čeká na schválení |

### Paměť agenta

`system/pamet-agenta.md` (2 200 znaků, o práci) a `system/tim.md` (1 375
znaků, o lidech). Obojí jde celé do system promptu každého běhu, zmražené
na začátku session (kvůli prompt cache). Limit hlídá nástroj: když je plno,
odmítne a vrátí seznam, agent musí sloučit nebo odebrat. Zápis = commit.
Fakta o klientech sem nepatří. Kód: `server/services/beyond-memory.js`.

### Historie konverzací

Každá zpráva, která projde SDK (chat, Telegram, úlohy), jde do SQLite
`beyond_messages` s FTS5 indexem (`server/services/beyond-history.js`).
Hledání je lexikální s hrubým odseknutím českých koncovek („miniatura"
najde „miniaturu"). Odvozená data, mimo git, po 180 dnech se mažou.

### Návrhy do mozku

Agent smí navrhnout změnu `.claude/skills/*.md` a `system/*.md` (ne paměti
a ne úloh, ty mají vlastní nástroje). Návrh je celý nový obsah souboru plus
věta proč; čeká v `beyond_mozek`, Velín ukáže rozdíl, schválení zapíše
a commitne, zahození smaže. Když se soubor mezitím změnil, schválení odmítne
místo přepsání. Kód: `server/services/beyond-mozek.js`.

### Stav běhu a incidenty

Každá úloha má `last_status` (`ok`, `skipped`, `error`, `delivery_failed`,
`blocked_config`) a sérii selhání. Po třech selháních po sobě odejde jedno
hlášení na Telegram (`BEYOND_TG_ERROR_CHAT_ID`, jinak všem), připomínka po
šesti hodinách, úspěch sérii vynuluje. Chyba doručení a chyba běhu jsou
dvě různé věci a v logu se liší.

### Velín ráno: úkoly

Domovská obrazovka je od 21. 9. 2026 jeden seznam úkolů, hovory a „pozor"
vpravo, klienti pod tím (`velin/VelinPage.tsx`, styly `.bb-uk*`). Úkol má
prioritu 1 až 4 (barva kroužku, Todoist), stav (nic, pracuje se, hotovo:
levé kliknutí hotovo, pravé pracuje se), vlastníka (profilovka z Mission
trackeru v `public/avatars/<key>.jpg`), kdo ho zadal (člověk nebo agent),
klienta, termín a případně **přípravu**: co k němu brain nachystal.

Úkoly žijí v brainu v `workspace/ukoly.json` (`server/services/beyond-ukoly.js`),
takže je agent čte i zakládá stejně jako všechno ostatní (nástroj `ukoly`).
Připravené zprávy (`beyond_proposals`) a návrhy do mozku (`beyond_mozek`) se
do souboru nekopírují: `GET /api/beyond/velin/ukoly` je skládá za běhu jako
úkoly s přípravou (`navrh:<id>`, `mozek:<id>`), jejich stav „pracuje se" je
ve `stavy`. Odeslaná zpráva ze seznamu prostě zmizí. Úloha
`napsat-co-dluzime` zakládá úkol s přípravou `podklad` (odkaz na draft).

Rychlé zadání (`POST /ukoly` s `quick`) rozumí `p1` až `p4`, `dnes`,
`zítra`, dnům v týdnu, datu `25.9.`, jménům klientů i ve skloněném tvaru
(Pavlovi, Markovi) a `@štěpán`. Výchozí vlastník je `BEYOND_DEFAULT_OWNER`
(jinak první v rosteru).

### Po callu: zápis pro klienta a Notion

`zpracuj-call` má od 21. 9. 2026 tři kroky. Kurátorský zápis do `cally.md`
(sliby, čísla, vlajky). Pak skill `coaching-call-notes` napíše klientský
zápis do `workspace/zapisy/<datum>-<slug>.md` (úkoly klienta jako checkboxy
nahoře, cíl, závěry, co dostane od nás) a `beyond-notion.js` ho pošle do
Notionu: doplní řádek v klientově Coaching Calls (ten, co n8n založil jako
„Z Fathomu", jinak nový) s obsahem stránky a odkazem na Fathom, a z checkboxů
založí řádky v klientově databázi Úkoly (stav Nezahájeno, typ Úkol, týden
programu). Duplicity hlídá název. Sliby z „Co dostaneš ode mě" jsou úkoly
na Velíně. Bez `BEYOND_NOTION_TOKEN` se Notion přeskočí, zápis v brainu
zůstane a marker `<!-- notion:<id> -->` na konci souboru říká, že už tam je.

### Návrhy zpráv: jedno kliknutí, ale tvoje

Tohle je jediná cesta, kterou něco opouští brain. Agent napíše zprávu, řekne
komu a proč, a čeká. Odeslat může jen člověk.

**Pravidlo, ze kterého plyne všechno ostatní: odsouhlasený text odejde doslova.**
Mezi kliknutím a drátem ho nevidí žádný model. Kdyby se text mohl po přečtení
změnit, nemělo by čtení smysl. Proto odesílá server přímo přes WAHA REST
(`server/services/beyond-waha.js`), ne agent přes MCP.

Zábrany proti otravování:

- **Jeden čekající návrh na klienta.** Dvě nevyřízené zprávy jednomu člověku je
  přesně způsob, jak se z asistenta stane otrava.
- **Nic tomu, komu jsme psali v posledních 72 hodinách.**
- **Návrh starší než 48 hodin propadne.** Popíchnutí napsané předevčírem je
  o situaci, která se mezitím pohnula.
- **Vysoká laťka na to, aby vůbec vznikl.** Zamítnutý návrh stojí víc
  pozornosti, než kolik ušetří.

Klíč k WhatsAppu se bere z `BEYOND_WAHA_URL` a `BEYOND_WAHA_API_KEY`, a když
nejsou, přečte se z WAHA MCP záznamu v `~/.claude.json`, který na stroji stejně
už je. Bez klíče se návrhy pořád píšou a dají přečíst, jen nejdou odeslat.

### Doručování na Telegram

Brief a připomínka hovoru chodí přes `beyond-telegram.js` stejným způsobem jako
WhatsApp: server pošle text, který vznikl, beze změny. Potřebuje
`BEYOND_TG_BOT_TOKEN` a `BEYOND_TG_CHAT_ID`. Bez nich se brief pořád napíše do
`workspace/reporty/`, jen nedorazí na telefon, a v logu běhu je napsané proč.

---

## Obsah z přepisů: co se smí brát

Přepisy v `raw/fathom/` mají označené mluvčí (`[00:15] TIM:` proti
`[00:18] Jakub Bolek:`) a v hlavičce seznam účastníků. Díky tomu je pravidlo
vynutitelné v kódu, ne jen slibem.

**Bere se jen naše řeč.** Hlasy klientů, jejich názory a otázky se do obsahové
knihovny nedostanou vůbec. Není to opatrnost navíc: hodnota je v tom, co Tim
na callech opakovaně vysvětluje, ne v tom, co se ptá klient.

Prakticky to znamená, že těžba momentů filtruje repliky podle mluvčího a
klientskou stranu zahodí ještě před tím, než se text dostane k modelu.
Souhrny z Fathomu (sekce „Key Takeaways") jsou psané o hovoru jako celku,
takže do obsahu nejdou, jen do klientského zápisu.

#### Telegram bot v appce

`server/services/beyond-telegram-bot.js` dělá long polling (`getUpdates`)
a každou zprávu předá `askAgent` ve `services/beyond-agent-query.js`, což je
totéž jádro, které obsluhuje `/api/beyond-agent/query`. Zapíná se
`BEYOND_TG_POLLING=1` a je to výhybka: Telegram dovolí botovi buď webhook,
nebo polling, takže start smaže webhook a n8n Telegram Inbound přestane
dostávat zprávy. Offset je v SQLite (`beyond_kv`), restart nic neztratí.
Hlasovky přepisuje `system/scripts/transcribe-voice.*` z brainu, náhradně
OpenAI Whisper. Allow list `BEYOND_AGENT_ALLOWED_TG_USERS` platí i tady.

#### Sync po klientech

`sync-klientu` a `roadmap-check` běží jako jeden tah agenta na klienta,
`BEYOND_SYNC_PARALLEL` (výchozí 2) najednou. Každý tah končí řádkem JSON
(`zmena`, `shrnuti`, `navrh`), který se parsuje; kdo ho nedodá, počítá se
jeho text. Jeden zmatený klient tak neshodí ostatní a návrhy vlajek pro
Tima se sbírají na konec souhrnu. Helper `forEachClient` v `beyond-jobs.js`.

#### Raw vrstva v appce

`server/services/beyond-raw.js` nahrazuje n8n workflow Registr klientů,
Notion Raw Puller a WhatsApp Raw Puller. Soubory i tvary jsou stejné, skill
`sync-client` nepozná rozdíl. Potřebuje `BEYOND_NOTION_TOKEN` (integrace
s přístupem k Clients 1:1 a dashboardům) a WAHA klíč. Bez tokenu úlohy
přeskočí a n8n může běžet dál; jakmile token je, n8n pully vypnout, jinak
se oba commitují střídavě.

Co v n8n zůstává i potom: Fathom Calls (přepis do `second-brain/_raw` a do
`cally.md`, plus přeposlání události `/fathom`), IG stories, týdenní
check-in. Ty se přesunou, až bude důvod.

WhatsApp a nula zpráv: WAHA na engine NOWEB zná jen zprávy, které přišly od
spárování. Skupina, ve které od té doby nikdo nepsal, vrátí nula, a to není
chyba pullu. Plná historie jde stáhnout jen s `WHATSAPP_NOWEB_STORE_FULLSYNC=True`
na straně WAHA a novým spárováním.

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

## Nastavení z appky

Obrazovka Agent má sekci „Napojení a klíče": každý klíč z tabulky níže jde
zadat tam a hodnota uložená v appce (`beyond_settings` v SQLite,
`server/services/beyond-settings.js`) přebíjí `.env`. Při startu i po uložení
se kopíruje do `process.env`, takže zbytek kódu čte pořád jen env. Tajné
hodnoty se do prohlížeče vrací zkrácené. Dvě věci chtějí restart služby:
`BEYOND_TG_POLLING` (bot se sice po uložení spustí, ale vypnutí platí až po
restartu) a `BEYOND_SCHEDULER`.

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
| `BEYOND_TG_CHAT_ID`, `BEYOND_TG_ERROR_CHAT_ID` | kam chodí briefy a připomínky, kam chyby |
| `BEYOND_EVENT_SECRET_*`, `BEYOND_EVENT_SECRET` | secrety cest v `system/udalosti.json` |
| `BEYOND_REVIEW_MODEL` | model pro večerní `uceni-review`, výchozí sonnet |
| `BEYOND_NOTION_TOKEN` | raw pully z Notionu (registr, dashboardy, cally, úkoly) |
| `BEYOND_TG_POLLING` | `1` = Telegram bot v appce místo n8n |
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
6. čeká, až `/health` hlásí `busy: { chats: 0, job: null }`, tedy žádná
   rozepsaná odpověď v chatu ani běžící úloha (max 10 minut, pak restart
   i tak)
7. `Restart-Service BeyondBrainApp`
8. poll `/health`, dokud neodpoví (max ~60 s)

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


## Google kalendář lidí

Hovory nejsou jen z Cal.com; Tim je má často rovnou v Google Kalendáři. Každý
z nás si na Velíně (Hovory dnes → Napojit kalendář) vloží tajnou adresu
svého kalendáře ve formátu iCal; uloží se jako `BEYOND_ICS_<KEY>` v nastavení
appky. `server/services/beyond-kalendar.js` feed každých pět minut stáhne,
rozbalí jednoduchá opakování (denně, týdně s dny, interval, until, count,
EXDATE) a jako hovor bere schůzku s dalším účastníkem nebo s odkazem na
meet, zoom a podobně. `beyond-calls.js` je sloučí s Cal.com; stejný hovor
z obou zdrojů se ukáže jednou, Cal.com má přednost. Žádný Google projekt ani
OAuth, adresa nevyprší; když ji člověk v Googlu resetuje, vloží novou.
