# F0 — M-frontend premium reskin, slice 0: extend-token layer + shared-primitive lift

**Milestone:** M-frontend, slice F0 (the shared spine). **FRONTEND-ONLY. NO migration. The backend contract is the WALL.**

This file is the authoritative brief for the F0 `/goal`. Read it in full, then execute it.

## Outcome
Add the design's premium "extend" token layer as a NEW token file, wire its new surface token(s) into the Tailwind bridge, and lift the shared `.tv-*` UI primitives to the mockups' premium recipes — with every existing screen keeping its exact layout (only the shared building blocks get the premium finish). This is the base coat the canvas reskin (F1) later builds on.

## Reference (read first)
Extract `design/Tvashtr Frontend Overhaul.zip` to a scratch dir OUTSIDE the repo (e.g. `/tmp/tvashtr-design`) and use it as the visual reference. **Do NOT stage or commit anything under `design/`** — it is architect-managed reference material.
- The genuinely-new material is ONE file: `tvashtr-extend.css` (the premium refinement layer).
- The `.dc.html` mockups (Dashboard, AuthWizard, Canvas, Landing) show the target premium recipes for the shared primitives, styled inline with the design tokens.
- **VERIFIED:** the design's `_ds/tokens/*` are byte-identical to the live `frontend/src/design-system/tokens/*` — so DO NOT edit the five base token files; the premium layer is ADDED as a new file.

## Do — two parts

### Part 1 — Token layer
- Create `frontend/src/design-system/tokens/extend.css` porting `tvashtr-extend.css`: the surface ramp (`--surface-board` / `--surface-sunk` / `--surface-overlay`), the soft/glass hairlines (`--hairline-soft` / `--hairline-glass`), the premium shadows (`--shadow-node` / `-hover` / `-raise` / `-drawer` / `-pop`), the coral glows (`--glow-running` / `--glow-soft`), the washes (`--wash-hero` / `--wash-board`), the layout widths (`--rail-w` / `--drawer-w`), the FULL keyframe library (including `tv-modal-in`), the warm scrollbars, and the reduced-motion guard.
- Import it in `frontend/src/index.css` immediately AFTER the `base.css` import and BEFORE `canvas.css`.
- **RECONCILE, don't duplicate:** `base.css` already sets the body background/color/font and `::selection`. `extend.css` adds html/body sizing (`height:100%`, `margin:0`), `box-sizing`, scrollbars, and the reduced-motion guard — it must NOT re-declare what `base.css` already sets.
- Wire the new SURFACE token into the `@theme inline` bridge in `index.css` (at minimum `--color-board: var(--surface-board)`). Leave the shadow/glow/wash/layout tokens as plain CSS variables (they are used in hand-written CSS, not utilities).

### Part 2 — Shared primitives
- Lift the shared `.tv-*` primitives in `index.css` — `.tv-btn` (+ variants), `.tv-card`, `.tv-pill` (+ status variants), `.tv-seg`, and the shared input recipe (`.tv-launch__input` / any `.tv-field`) — to the mockups' premium recipes, consuming the new tokens: soft warm shadows where the design uses them, the frosted-glass bar treatment (via `--surface-overlay` + `backdrop-filter: blur`), the design's larger putty input with a calm coral focus ring.
- This is **CSS + token work ONLY**: do NOT change any component's markup/JSX or any screen's layout — those are later slices. All values resolve to DS/extend tokens; **no ad-hoc hex**.

## Invariants (prove each on disk; quote the proof in the FINAL REPORT)
- `frontend/src/lib/api.ts` byte-untouched: `git diff main -- frontend/src/lib/api.ts` is EMPTY.
- The five base token files byte-untouched: `git diff main -- frontend/src/design-system/tokens/colors.css frontend/src/design-system/tokens/fonts.css frontend/src/design-system/tokens/typography.css frontend/src/design-system/tokens/spacing.css frontend/src/design-system/tokens/base.css` is EMPTY.
- NO backend change, NO new/changed migration: `git diff --name-only main` lists ONLY paths under `frontend/src/` — nothing under `backend/`, no `alembic/versions/*`. Alembic head stays `0018`. (Prove the backend is untouched by this diff rather than re-running the backend suite.)
- Nothing under `design/` is staged or committed.

## Acceptance / evidence (run each yourself, debug to green, echo the decisive line per §4.3a)
- `make test-frontend` — vitest, ≥165 passing (quote the "N passed" line). F0 is CSS/token only and changes no component markup, so vitest should stay green with no re-pointing; if a test trips, RE-POINT it and re-read the body to confirm it still asserts real behaviour — never gut an assertion.
- `make build-frontend` — tsc-strict + vite build clean (quote the final line).
- `make lint` — clean (quote the result line).
- **Playwright self-sign-off** (headless; screenshots vs the extracted `design/` reference; targeted `browser_evaluate` on specific selectors + screenshots, **NEVER a whole-canvas a11y snapshot — it hangs** on the React Flow canvas): bring up the stack (backend + frontend); capture the login screen (pre-auth: card + input + button + focus ring); then log in via the existing e2e/seed login pattern the M-accounts tests use and capture the dashboard (cards, status pills, buttons, lists) and a team canvas toolbar (the "Single run | A/B" segmented toggle + buttons). The bar: primitives render with the premium finish and match the design's look; NO layout shift, NO white/dark flash, nothing broken. Record every screenshot path in `STATE.md` and quote them in the report.
- Write `READY_TO_MERGE: branch=feat/f0-tokens-primitives, sha=<sha>, frontend=<N> passing` to `STATE.md` and echo that line.

## Branch & discipline
Branch `feat/f0-tokens-primitives`. Commit only your own changed paths (the CSS/token files); never push, never merge — the operator fast-forward-merges. Leave `PROJECTPLAN.md`, `HANDOVER.md`, and any `prompts/*.md` untouched.

## Completion & stop
The goal is MET when all four acceptance items are green in the transcript, the four invariant proofs are quoted, and the §4.7 FINAL REPORT is written. A clean SUCCESS is the expected terminal. If you hit a SECOND or unknown problem that would need a broad or unproven change, STOP and write `NEEDS_HUMAN` to `STATE.md` — a recorded `NEEDS_HUMAN` WITH the §4.7 FINAL REPORT is itself a valid, goal-met terminal (do not loop re-arguing it). A code-proven, contained, regression-guarded fix to a single identified cause may proceed. End the run with the §4.7 FINAL REPORT (all 8 sections).
