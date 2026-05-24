# Beyond Brain App — Design Vision (v2 — REWRITE)

**⚠️ Tato verze je kompletní redesign směru.** První pokus (v1) byl peach/sunrise glassmorphism, Tim řekl „strašný". Pivot na **hyperminimalismus**.

## Cíl
Apple-like sleek personal assistant, **embrace empty space**, hyperminimalismus. Pod kapotou claudecodeui, frontend kompletně přepsán.

## Vibe (v2)
**Hyperminimal artistic**. Reference:
- `inspiration/04-emmanuelhong-minimal.png` — Emmanuel Hong personal site: pure white, tiny logo (emoji tree), small clean text bloc, GIANT empty space, browser-like minimal chrome
- `inspiration/05-powder-blue-gradient.png` — Mobile app: powder blue → cream subtle gradient, white sans hero "Shaping what we create with the power of air.", pill button "Learn more"

**OUT:**
- ❌ Glassmorphism cards (žádné sklo, žádný backdrop-blur)
- ❌ Peach / orange / sunrise gradients
- ❌ Time-of-day gradient rotation
- ❌ Decorative chrome (avatars on every message, status dots all over)
- ❌ Busy chip suggestions
- ❌ Instrument Serif jako primary font

**IN:**
- ✅ White / off-white background většiny appu
- ✅ Subtle powder-blue → cream gradient JEN na welcome/hero screen
- ✅ Helvetica Neue primary sans
- ✅ Instrument Serif jen pro special moments (welcome greeting „Dobré ráno, Štěpáne")
- ✅ Generous empty space — embrace prázdno
- ✅ Soft gray pill buttons (transparent, subtle)
- ✅ Cool artistic micro-animations (Framer Motion, subtle parallax, fade-in)
- ✅ Hidden-by-default sidebar (toggle button)

## Design jazyk (v2)

### Background
- Default: `#ffffff` (pure white) nebo `#fafafa` (off-white)
- Welcome / hero: **soft powder blue → cream gradient** (`from-[#cdd9e8] via-[#e4dfd6] to-[#f0e6dc]` approx — match screenshot 05)
- Single static gradient. **Žádná rotace podle denní doby.**

### Typography
- **Primary**: Helvetica Neue (system fallback: `-apple-system, "Helvetica Neue", Helvetica, sans`)
- **Special moments** (welcome greeting, "Vítej zpátky"): **Instrument Serif** (Google Fonts), italic
- **Weights**:
  - Hero: 700 (bold) — clean, ne stylized
  - Headings: 600 (semibold)
  - Body: 400 (regular)
  - UI labels: 500 (medium)
- **Sizes**: generous — hero 48-64px, body 16-17px (ne 14)
- **Line height**: airy — 1.5 body, 1.2 hero

### Colors
- **Text primary**: `#0a0a0a` (near black, ne pure black)
- **Text secondary**: `#737373`
- **Text tertiary**: `#a3a3a3`
- **Borders / dividers**: `#f0f0f0` (very subtle)
- **Pill button background**: `rgba(0,0,0,0.05)` (transparent gray)
- **Pill button hover**: `rgba(0,0,0,0.08)`
- **Accent**: minimal — possibly small color glyphs nebo žádný accent (text-only is fine)

### Spacing
- **Generous everywhere**. Padding 24-48px standardně, ne 12-16.
- Empty space je content. Nebát se prázdné půlky obrazovky.

### Layout

**Welcome screen** (žádný klient, žádný chat):
```
[powder blue → cream gradient full screen]

                                            ← lot of empty space


        Dobré ráno, Štěpáne.                ← Instrument Serif italic 56px, center
        Co dnes řešíme?                     ← Instrument Serif italic 32px

        [   Co je u Ivany?   ]              ← soft gray pills, ne přemíra
        [   Action items Patrik   ]
        [   Sync all   ]


                                            ← lot of empty space
```

**Chat view**:
- **White bg** (žádný gradient)
- Messages: simple text blocks, NO bubbles, NO avatars. Jen subtle indent + text color difference (AI dark, user lighter / lighter background).
- Můžeš mít subtle horizontal rule mezi messages.
- Input bottom: simple text input, minimal chrome, pill send button.

**Sidebar** (hidden by default):
- Tiny toggle button (≡ icon) top left
- Klik → sidebar slide in from left (~280px wide)
- Content: search at top, 6 klientů (just names + W## small text), settings at bottom
- Žádné status dots, žádné decorative elements
- Klik na klienta → main view fokus na něj, sidebar auto-collapse

**Top chrome** (when sidebar collapsed):
- Tiny browser-like bar: sidebar toggle (≡) | breadcrumb / context | chat button right
- Příklad jako emmanuelhong screenshot — minimal, jen to nutné

### Animace (Cool artistic)
- **Welcome hero text**: subtle typewriter or fade-in slow (1.2s ease)
- **Sidebar slide**: spring physics, ne linear
- **Page transitions**: subtle blur-fade (200ms)
- **Chat message append**: fade up 100ms
- **Hover states**: minimal — text color shift, pill bg shift, ne ruined transforms
- **Loading**: tiny pulsing dot ne spinner
- **Idle decorative**: maybe subtle parallax on welcome gradient — gradient pomalu morfuje (10-30s loop)

### Tone (Český, personal)
- Welcome: **Dobré ráno / odpoledne / večer, Štěpáne. Co dnes řešíme?** (variable greeting podle hodiny)
- Empty chat: **Tady jsem.**
- Loading: **Přemýšlím...**
- Errors: **Hm, něco se rozbilo. Zkusíme znovu?**
- Success: **Hotovo.** (krátké, suché, ne enthusiastic)

## Pravidla (v2)

1. **Méně > Více.** Pokud má váhat, nepřidávej.
2. **Empty space je feature, ne chyba.** 70% obrazovky může být prázdné. Je to OK.
3. **Animace subtle, ne flashy.** Tasteful, ne TikTok.
4. **Žádný designový shortcut.** Když máš pocit „přidám tady malou ikonku", nedělej to.
5. **Default state = nejprázdnější.** Sidebar collapsed, žádná badge, žádná notif. Až user akce → reveal.
6. **Typografie nese vibe.** Helvetica clean + Instrument Serif jako akcent. Žádné serif fonts in chat.
7. **Bez claudecodeui chromu.** Žádné „CloudCLI v1.32 — Open Source" footer, žádné Discord links, žádné GitHub stars. Pure Beyond.

## Co Tim ještě dodá
- Brand glyph (asi 1 emoji nebo tiny SVG — viz emmanuelhong tree)
- Případně exact color hex pro accent (zatím text-only)
- PWA ikona — minimalistic glyph

## Reference (vše v `inspiration/`)
- `04-emmanuelhong-minimal.png` — golden standard pro empty-space minimalism
- `05-powder-blue-gradient.png` — jediný akceptovaný gradient styl
- ~~`01-mail-app-ai-chat.png`~~ — DEPRECATED (glassmorphism out)
- ~~`02-anastasia-cabinet.png`~~ — DEPRECATED (warm sunset out)
- ~~`03-search-sessions.png`~~ — keep for search UI inspiration only
