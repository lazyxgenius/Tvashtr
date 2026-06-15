---
name: tvashtr-design
description: Use this skill to generate well-branded interfaces and assets for Tvashtr Labs, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

# Tvashtr Labs — design skill

Warm, editorial, calm design language for an AI product suite. Cream "paper" backgrounds, one coral accent (`#D97757`), a transitional serif (Newsreader) for display and a clean sans (Inter) for everything functional. Generous whitespace, soft corners, hairline borders. Minimal and trustworthy — never flashy.

## Start here
1. Read `readme.md` — it has the full brand guide: **content fundamentals** (voice/tone), **visual foundations** (color, type, spacing, motion, states), and **iconography**.
2. Skim the token files: `tokens/colors.css`, `tokens/typography.css`, `tokens/spacing.css`. Use the semantic aliases (`--surface-card`, `--text-secondary`, `--accent`, …).
3. Browse the components in `components/**` and the full-screen examples in `ui_kits/**`.

## How to build
- **Visual artifacts** (slides, mocks, throwaway prototypes): copy the assets you need out of `assets/`, link `styles.css`, and write static HTML. For React mocks, mirror the patterns in `ui_kits/` (load `_ds_bundle.js`, read components from `window.DesignSystem_dbaa69`).
- **Production code**: copy assets and read the rules here to become an expert in the brand; reuse the token names and component APIs.

## Non-negotiables
- Paper, not white (`#FAF9F5`); ink, not black (`#141413`); warm stone grays, never cool gray.
- **One** coral accent — mark, primary buttons, links, focus. Not a rainbow.
- Serif for headlines (regular weight, tight tracking); sans for all functional text.
- Sentence case everywhere. Calm, plain, lightly literary copy. No emoji, no hype.
- Hairline borders before shadows; soft corners (6/8/12px); calm motion, no bounce.
- The **rosette mark** (`assets/logo/`) is used exactly as drawn — only its color may change (coral / charcoal / cream).

If invoked with no other guidance, ask what the user wants to build, ask a few focused questions, then act as an expert designer who outputs HTML artifacts **or** production code as needed.
