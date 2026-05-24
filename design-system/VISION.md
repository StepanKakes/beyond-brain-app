# Beyond Brain App — Design Vision

## Cíl
Personal assistant UI pro Tima (Beyond mentoring), který se cítí jako **vlastní Apple-like sleek app**, ne dev tool. Pod kapotou claudecodeui (wraps Claude Code CLI), ale frontend kompletně redesigned.

## Vibe
**Apple sleek + soft + osobní.** Reference: macOS Sequoia liquid glass, ChatGPT, Linear (přesnost), Notion (typografie), Stripe (gradient backgrounds).

## Design jazyk

### Backgrounds
- **Soft pastel gradients** jako macOS Sequoia wallpapery
- Rotace podle denní doby:
  - **Ráno** (5-11): warm peach → soft yellow (jako screenshot 2 — sunrise nad pouští)
  - **Poledne** (11-17): soft blue → cool white (jako screenshot 3 — clear sky)
  - **Večer** (17-22): purple → orange sunset (jako screenshot 1 — Apple Sequoia)
  - **Noc** (22-5): deep blue → soft black (dark mode auto)
- **Glassmorphism overlays**: bílé/translucent cards `backdrop-blur-xl` `bg-white/60`

### Typografie
- **Hero / Welcome**: **Instrument Serif** (Google Fonts) — warm, personal, ne corporate
- **Body / UI**: Inter nebo systému sans-serif
- **Mono / code**: JetBrains Mono pro kód bloky

### Personal assistant tón (Český)
Ne enterprise „Choose Your AI Assistant". Místo toho:
- Welcome: *„Dobré ráno, Štěpáne. Co dnes řešíme?"* (mění se podle denní doby)
- Empty chat: *„Tady jsem. Co potřebuješ?"*
- Loading: *„Přemýšlím..."* místo spinner
- Errors: *„Hmm, něco se rozbilo. Zkusíme znovu?"*
- Success: *„Hotovo. Pushnul jsem 3 commity."*

### Layout
- **Sidebar (250px)** vlevo:
  - Search nahoře (⌘K)
  - Smart folders: „Dnes", „Tento týden", „Otevřené sliby"
  - **Klienti (6)** s avatars + status dot (open promises count)
  - Conversations historie
  - Bottom: settings + system status (n8n, git, raw stáří)
- **Main panel** vpravo:
  - Welcome state (žádný klient vybrán)
  - Chat view (klient vybrán)
  - Optional secondary panel (jako screenshot 2 levá strana „Current Understanding")

### Komponenty

**Welcome screen** (žádný klient vybrán):
```
[soft gradient background]

           Dobré ráno, Štěpáne.        ← Instrument Serif 42px
           Co dnes řešíme?

  [💬 Co je nového u Ivany?]           ← chip suggestions
  [📋 Action items Patrik]
  [🌅 Sync all]
```

**Chat view** (klient vybrán):
- AI message: bílá glassmorphism card vlevo s avatarem
- User message: šedá glassmorphism card vpravo
- Generous spacing (24-32px mezi messages)
- Tool calls: subtle inline indicator („📄 Čtu profil.md...", „💾 Commitnul jsem")
- Step indicator pod (jako screenshot 2 „Step 1 of 4")

**Input area** (bottom):
- Light card s blur, soft shadow
- Placeholder: „Jak ti můžu pomoct?"
- Quick action chips pod inputem (Brief, Sync, Action items, atd.)
- Subtle send button (arrow up)

**Sidebar client item**:
- Avatar (initials nebo Notion icon)
- Jméno
- Status: „W04 · 2 sliby otevřené" v menším šedém textu
- Hover: jemný gradient highlight
- Selected: glassmorphism active state

**Status bar** (bottom of sidebar):
- 3 tečky: n8n (zelená OK / žlutá pomalá / červená error), git (clean / dirty / ahead), raw (čerstvá < 12h / stará > 36h)
- Hover na tečku → tooltip detail

### Animace (Framer Motion)
- **Page transitions**: cross-fade 200ms
- **Sidebar items**: spring on hover (subtle Y translate)
- **Chat bubbles**: fade-in + slight Y on enter (50ms stagger)
- **Loading**: subtle gradient pulse, ne spinner
- **Command palette**: spring open from center, blur backdrop

### Pravidla
1. **Méně je víc.** Whitespace > content density. Sequoia, ne dashboard.
2. **Tone over feature.** Personal AI assistant feel > „premium SaaS".
3. **Skip dev tool patterns.** Žádné monospace tabs, žádné `>` cursor indikátory, žádné generic „workspace".
4. **Glassmorphism > flat.** Soft blur backgrounds, ne hard color blocks.
5. **Smooth > snappy.** 200-300ms ease-out, ne 100ms snap.

## Reference
- `inspiration/01-mail-app-ai-chat.png` — pastel sunset bg, soft sidebar, AI chat overlay, model picker
- `inspiration/02-anastasia-cabinet.png` — warm sand bg, two-panel layout, chat + structured notes, „Hi, how can I help you today?", step indicator
- `inspiration/03-search-sessions.png` — soft blue bg, search-first session list, document panel

## Brand (TBD)
Tim pošle ukázky později. Zatím:
- Color palette: TBD (asi navázat na growbeyond.cz)
- Logo / wordmark: TBD
- Font fallbacks: Instrument Serif → ui-serif → serif
