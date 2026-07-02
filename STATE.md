# Tvashtr — Autonomous Execution State

## Current Milestone
M-frontend (Tvashtr-41) — the premium reskin of the warm cream-paper FE, decomposed F0→F4.
This slice: **F0 — the extend-token layer + the shared `.tv-*` primitive lift.**

## OUTCOME — F0 SHIPPED (READY_TO_MERGE; clean SUCCESS)
The design export's premium refinement layer is ported as a NEW token file
(`frontend/src/design-system/tokens/extend.css`) and the shared primitives in `index.css` are
lifted to the mockups' premium recipes — CSS/token-only, zero markup/layout/endpoint/migration
change. All four acceptance gates green; all four invariant proofs empty/clean; Playwright
self-sign-off captured against the `design/` reference.

## Last Completed Step
F0 extend-tokens + primitive lift — 2026-07-02 — branch: feat/f0-tokens-primitives — commit: b43a0d0

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/f0-tokens-primitives, sha=b43a0d0, frontend=165 passing

## The change (2 files, FE-only)
- **NEW `frontend/src/design-system/tokens/extend.css`** — ports the design's `tvashtr-extend.css`:
  the surface ramp (`--surface-board/-sunk/-overlay`), soft/glass hairlines, premium shadows
  (`--shadow-node/-hover/-raise/-drawer/-pop`), coral glows (`--glow-running/-soft`), warm washes
  (`--wash-hero/-board`), layout widths (`--rail-w`/`--drawer-w`), the FULL keyframe library
  (tv-breathe/flow/draw/fade-up/fade-in/pop-in/**modal-in**/scale-in/node-in/spin/drift/stamp/
  shimmer/blink/wave/parallax), warm scrollbars, and the global reduced-motion guard.
  RECONCILED vs base.css: the body background/color/font baseline + `::selection` are NOT
  re-declared (base.css owns them); extend adds html/body sizing, overscroll, box-sizing only.
- **`frontend/src/index.css`** — import wired immediately AFTER base.css and BEFORE canvas.css;
  `@theme inline` bridge gains `--color-board/-sunk/-overlay`; primitives lifted: `.tv-btn`
  radius-md + shadow-xs→sm hover ramp + the design's putty disabled state (ghost/danger/link
  variants shadowless, ghost on surface-card); `.tv-card` radius-xl; `.tv-pill` saturated
  per-status dots (+nowrap); `.tv-launch__input` = the larger putty input (surface-page,
  radius-lg, space-3 padding, placeholder tone; coral-200 + 3px focus ring kept); `.tv-launch`
  popover on shadow-pop + tv-pop-in; `.tv-auth__card`/`.tv-landing__hero` on shadow-raise;
  `.tv-dash__bar` frosted (surface-overlay + backdrop-blur 10px). `.tv-seg` verified already
  byte-matching the design recipe — untouched.

## Acceptance evidence (all run to green this session)
- `make test-frontend` → **Tests  165 passed (165)** (floor 165 — zero re-pointing needed).
- `make build-frontend` → **✓ built in 1.18s** (tsc-strict + vite clean).
- `make lint` → **All matched files use Prettier code style!** (ruff + eslint + prettier, exit 0).
- alembic head (live, from `uv run alembic heads` during stack-up) → **0018_run_subpath (head)**.
- Playwright self-sign-off (headless chromium 1280×800; targeted `browser_evaluate` + screenshots,
  NO whole-canvas a11y snapshot): login card+input+button+**live coral focus ring** verified
  (border coral-200, ring `0 0 0 3px` coral-500@45%); dashboard glass bar (`cream-50@86%` +
  `blur(10px)`), 16px cards, putty inputs; canvas toolbar seg ("Single run" thumb =
  surface-card + coral-200 ring + coral-700) + coral primary + card-bg ghosts + a real
  `tv-pill--idle` (stone-400 dot); all six pill variants exercised against the live stylesheet.
  Console: only the 2 expected logged-out 401s on `/api/auth/me`; zero errors after login.
- Screenshots (outside the repo): `/tmp/tvashtr_f0_shots/f0-01-landing.png`,
  `f0-02-login-focus.png`, `f0-03-dashboard.png`, `f0-04-canvas-toolbar.png`,
  `f0-05-pill-variants.png` (the last = a transient DOM-only variant strip exercising the real
  compiled CSS; removed after capture).

## Invariants held (proofs run on disk this session)
- `git diff main -- frontend/src/lib/api.ts` → EMPTY.
- `git diff main -- frontend/src/design-system/tokens/{colors,fonts,typography,spacing,base}.css` → EMPTY.
- `git diff --name-only main` → `frontend/src/index.css` only (+ new `frontend/src/design-system/
  tokens/extend.css`); NOTHING under backend/, no alembic/versions/* — alembic head stays 0018.
- Nothing under `design/` staged or committed (untracked before and after; commit b43a0d0 touches
  exactly the 2 FE files). `prompts/*.md`, `PROJECTPLAN.md`, `HANDOVER.md` untouched.

## Deviations from the brief
- Branched from main tip `4b987ed` (the Tvashtr-40 docs-closeout commit), not `29f8f03` as the
  ground-truth line said — `4b987ed` was already on main and an FF-merge requires the tip.
- Radius mapping to DS tokens (the design uses 8–16px raw): buttons → `--radius-md` 8px (the
  design's own toolbar-button radius), inputs → `--radius-lg` 12px (design 9–11px at height),
  cards → `--radius-xl` 16px (design 14–16px). No ad-hoc values; radius scales with control size
  exactly as in the mockups.
- `--color-board/-sunk/-overlay` bridge vars don't emit to :root yet — Tailwind v4 tree-shakes
  unused `@theme inline` vars (verified: pre-existing `--color-card`/`--color-accent` behave
  identically); they materialize the moment F1+ uses them.
- Dashboard "Previous runs" statuses are plain text meta in the current markup (not `.tv-pill`),
  so dashboard pill evidence rides on the canvas pill + the variant strip; F2 owns that markup.

## Test Count
**165 vitest** (floor held; backend untouched this slice — proven by the empty diff, per the brief) — 2026-07-02.

## Blocked
None — clean SUCCESS. Next: architect confirms canvas-first vs shell-first, then scopes F1
(the canvas cluster) per PROJECTPLAN §17 Tvashtr-40; the extend tokens (`--shadow-node`,
`--glow-running`, `tv-breathe`, `--rail-w/--drawer-w`…) are in place for F1 to consume.
