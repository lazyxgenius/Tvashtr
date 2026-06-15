# Tvashtr Labs — Design System

A warm, editorial, calm design language for an AI product suite. Cream "paper" backgrounds, a single coral accent, a transitional serif for display paired with a clean neutral sans for everything functional. Generous whitespace, soft corners, hairline borders. Minimal and trustworthy — never flashy.

> **Tvashtr** (after the celestial artisan) makes thinking tools that feel hand-made and unhurried. The suite spans a **desktop chat app**, a **terminal / CLI developer tool**, a **knowledge-work desktop agent**, a **design canvas**, and a **web app**. One token set dresses every surface.

---

## Sources & provenance

This system was built from a brand brief plus a single uploaded asset:

- `assets/logo/mark-original-teal.png` — the original brand mark (a teal rosette on cream), provided as `Screenshot 2026-06-09 at 10.05.41 AM.png`. The geometry is used **exactly as drawn**; only its color was changed to fit the palette (see `assets/logo/`).

No codebase, Figma file, or live product was provided. Where real product source would normally anchor the UI kits, these kits are **faithful interpretations of the written brief**, not recreations of shipping screens. Swap in real source when it exists.

---

## Fonts — substitution notice ⚠️

The brand's true typefaces are proprietary (a custom serif, *Copernicus*, and the *Styrene* sans). This system substitutes the closest open faces, loaded from **Google Fonts** (not self-hosted binaries):

| Role | Brand face | Substitute (used here) |
|------|-----------|------------------------|
| Display / headings | Copernicus | **Newsreader** |
| UI / body | Styrene | **Inter** |
| Terminal / code | — | **IBM Plex Mono** |

**Action for you:** if you have licensed Copernicus / Styrene (or prefer different substitutes), drop the font files into `assets/fonts/`, add `@font-face` rules, and update `tokens/typography.css`. See "Caveats" at the bottom.

---

## CONTENT FUNDAMENTALS — how Tvashtr writes

The voice is **warm, clear, human, lightly literary** — a thoughtful colleague, not a hype machine.

- **Person & address.** Speak to the user as **"you."** The product refers to itself plainly ("Tvashtr," "the loom") and rarely says "I." Avoid corporate "we" except in genuinely shared moments.
- **Tone.** Calm, plain, quietly confident. A faint literary warmth is welcome ("The loom remembers," "threads you can pick back up"). Never breathless, never salesy. No exclamation marks in product UI.
- **Casing.** **Sentence case everywhere** — buttons, menus, titles, headings. No Title Case, no ALL-CAPS except tiny eyebrow labels (12px, letter-spaced).
- **Length.** Short. One idea per line. Helper text is a single calm sentence. Empty states are a gentle nudge, not a tutorial.
- **Words we like:** thread, loom, weave, draft, note, quiet, unhurried, pick back up, set the scene.
- **Words we avoid:** unleash, supercharge, revolutionary, blazing-fast, 10x, magic, AI-powered (as a slogan), 🚀.
- **Buttons** name the action in the user's terms: "Start a thread," "Save changes," "Pick this up later" — not "Submit," "OK."
- **Errors** are kind and specific: "That address doesn't look right." — never "Invalid input."
- **Emoji:** not used in product UI. (Geometric primitives and the mark carry any "icon" warmth.)

**Microcopy examples**
- Empty thread list → *"Nothing here yet. Start a thread and it'll appear on the loom."*
- Sending state → *"Weaving…"* / *"Working…"*
- Optional field → a plain *"Optional"* marker, never "(not required)".
- Destructive confirm → *"Delete this thread? You can't undo that."*

---

## VISUAL FOUNDATIONS

### Color
- **Paper, not white.** Backgrounds are warm cream (`#FAF9F5`); panels, cards and input fills are a light putty (`#E8E6DC`). **Never** pure `#FFFFFF`.
- **Ink, not black.** Text is a warm near-black (`#141413`); secondary text and placeholders are warm stone grays (`#6E6B61`, `#B0AEA5`). **No cool/blue grays.**
- **One accent.** Terracotta coral (`#D97757`) for the mark, primary buttons, links, focus rings, and selection. Hover → `#C8623F`, press → `#B0512F`. It is an accent, not a theme — most of any screen is paper and ink.
- **Rare secondaries.** Muted blue (`#6A9BCC`) and sage (`#788C5D`) appear only in tags and illustration. Status colors stay muted and warm (amber, brick) — no alarm-red or neon.
- See `tokens/colors.css` for the full scale + semantic aliases (`--surface-card`, `--text-secondary`, `--accent`, …). Reach for aliases in components.

### Type
- **Serif for headlines and big moments; sans for everything functional.** Display is Newsreader at **regular weight (400)** with **tight tracking (-0.02em)** and snug line-height — editorial, never bold or loud. Body/UI is Inter at 16/1.6. Mono is IBM Plex Mono.
- Display can go italic for a quiet literary turn. Headings stay serif all the way down to H4.
- Scale and roles live in `tokens/typography.css`.

### Backgrounds & texture
- Flat cream fields. **No gradients**, no photographic hero washes, no heavy textures. The only recurring decorative element is the **rosette mark**, used *sparsely* and *large* in loading and empty states. Imagery, when present, is warm-toned and calm — never cool or high-contrast.

### Shape, borders, elevation
- **Soft corners:** 6px buttons, 8px inputs, 12px cards/panels, 16px large surfaces, pill for badges.
- **Hairline borders first** (`1px` in light putty `#E0DDD0`). Prefer a border over a shadow.
- **Shadows are a last resort** and very soft + warm-tinted (`rgba(20,20,19,0.04–0.10)`). Used for popovers and dialogs, not for ordinary cards.
- Cards = cream/putty fill + hairline border + large radius + ample padding (24px default). No glossy effects, no inner glows.

### Layout
- **Single column, centered, comfortable measure.** Forms ~640px, reading ~720px, app content ~1080px, page max ~1280px.
- Generous whitespace on a 4px grid (`tokens/spacing.css`). Let things breathe; density is achieved with type scale, not cramming.
- Inputs are large (44px) and low-contrast — putty fill, subtle border, stone placeholder.

### Motion
- **Calm, no bounce.** Short fades and slides (120–320ms) on a gentle ease (`cubic-bezier(0.32,0.08,0.24,1)`). Toggles/checks ease in softly. Nothing springs or overshoots; no infinite decorative loops.

### Interaction states
- **Hover:** subtle fill (putty) on ghost/secondary; one step darker coral on primary. No big shadows on hover.
- **Press:** one step darker again + a 0.5px nudge down. No shrink/scale.
- **Focus:** a soft 3px coral ring (`--shadow-focus`), never a hard outline.
- **Disabled:** ~45% opacity, no pointer.
- **Selected/active toggles:** soft coral tint background (`--coral-100`) with coral text.

### Transparency & blur
- Used sparingly. Overlays/scrims behind dialogs are a low-opacity warm ink wash; optional light backdrop-blur on floating bars. Not a primary motif.

---

## ICONOGRAPHY

- **System:** [**Lucide**](https://lucide.dev) — minimal, friendly line icons at **1.6px stroke**, which match the brief's "slightly hand-drawn friendly line icon" intent. Loaded from CDN (`unpkg.com/lucide`); see `guidelines/iconography.card.html`. *(Substitution flag: no brand icon font was provided — Lucide is the chosen stand-in. Swap if you have a house set.)*
- **Geometric primitives** — circle, triangle, square — are part of the visual language and echo the mark; they're drawn in coral when used as motifs.
- **Color:** icons are ink (`--ink-700`) by default; **coral is reserved for the brand mark**, not for general icons.
- **No emoji** in product UI. No multicolor or filled icon styles.
- **The mark** (`assets/logo/`) is the one bespoke piece of "iconography": app icon, header/nav mark, and a sparse motif for loading/empty states. Color is the only thing that may change about it.

---

## INDEX — what's in this folder

**Foundations**
- `styles.css` — global entry point (consumers link this). Import list only.
- `tokens/fonts.css` · `colors.css` · `typography.css` · `spacing.css` · `base.css` — the token layer.
- `guidelines/*.card.html` — foundation specimen cards (Colors, Type, Spacing, Brand) shown in the Design System tab.

**Assets**
- `assets/logo/` — `mark-coral.png`, `mark-charcoal.png`, `mark-cream.png` (recolored variants) + `mark-original-teal.png` (untouched original).

**Components** (`window.DesignSystem_dbaa69.*`)
- `components/core/` — **Button**, **IconButton**, **Logo**
- `components/forms/` — **Input** (+ **Field**), **Select**, **Checkbox**, **Switch**
- `components/display/` — **Card**, **Badge**, **Avatar**
- `components/navigation/` — **Tabs**

**UI kits** (full-screen recreations)
- `ui_kits/chat/` — desktop chat app
- `ui_kits/terminal/` — CLI / terminal developer tool
- `ui_kits/web/` — marketing web app

**Other**
- `SKILL.md` — Agent-Skills manifest for downloading into Claude Code.

---

## Caveats

- **Fonts are Google-Fonts substitutes**, not the licensed Copernicus/Styrene, and load from CDN rather than self-hosted files. Provide real files to finalize.
- **Icons are Lucide (CDN)** — a stand-in for any house icon set.
- **No product source** (code/Figma) was provided, so UI kits interpret the brief rather than recreate shipping screens.
