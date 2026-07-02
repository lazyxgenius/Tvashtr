# Tvashtr — Autonomous Execution State

## Current Milestone
M-frontend (Tvashtr-41) — the premium reskin of the warm cream-paper FE, decomposed F0→F4.
This slice: **F1a — the canvas cluster, slice 1: the node cards + the `deriveNodeStatus` fix.**

## OUTCOME — F1a SHIPPED (READY_TO_MERGE; clean SUCCESS)
The three canvas node variants (agent/thinker/worker card, gate, terminal) are reskinned to the
design's premium n8n look, and the `deriveNodeStatus` never-reached bug is fixed (with a
reproduce-first regression). FE-only; the backend contract is the wall (api.ts byte-untouched,
`node.model` stays a string, satellites visual-only, NO migration). All gates green; all invariant
proofs empty/clean; Playwright self-sign-off captured against `design/Canvas.dc.html`.

## Last Completed Step
F1a node cards + deriveNodeStatus fix — 2026-07-02 — branch: feat/f1a-node-cards — commit: e861b4c

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/f1a-node-cards, sha=e861b4c, frontend=167 passing

## Completed Steps (append-only, newest last)
- [x] F0 — extend-tokens + shared-primitive lift — b43a0d0 (STATE docs f0aabfd) — 2026-07-02
- [x] F1a — canvas node cards + deriveNodeStatus never-reached fix — e861b4c — 2026-07-02

## The change (4 files, FE-only)
- **`frontend/src/canvas.css`** — restyle ONLY the node rules to the design recipe: `.rf-node`
  (13px radius, 1.5px border via `--border-width-2`, `--shadow-node` → `-hover` on hover, tinted
  status fills), `--entry` (asymmetric `18px 13px 13px 18px` + coral bar + coral-tinted glyph),
  `__head/__glyph/__titles/__role/__caption`, the new `__meta` row (capability pill thinker=blue /
  worker=coral, `__engine` chip, StatusPill pushed right), the clickable `__model` footer button
  (top `--border-faint` hairline + CPU glyph + mono text ellipsis), `--running` coral-200 border +
  `::after` `tv-breathe` glow, `__badge--done` (sage check, `tv-stamp`) / `__badge--failed` (red ×),
  the coral `__round` badge, and the `.rf-gate`/`.rf-terminal` restyle (gate pill + coral awaiting
  ring; terminal dashed idle @0.82 → solid shipped/stopped). Dead `--paused` + `rf-pulse-once/
  -paused` keyframes removed; reduced-motion keeps a STATIC `--glow-soft` ring on the running node.
  Canvas chrome / edge / handle rules (F1b) untouched; the `.tv-node--invalid/--orphan` flags kept.
- **`frontend/src/canvas/AgentNodeCard.tsx`** — restructure `AgentCard` to the design anatomy;
  entry node renders the coral bar + "Start · entry" eyebrow + a `Zap` spark glyph; `isEntry?:
  boolean` added to `AgentNodeData`; the model row is an inert `type="button"` (picker = F1c);
  gate/terminal keep structure (restyled via CSS). Icons stay lucide-react (+ `Cpu`/`Check`/`X`/`Zap`).
- **`frontend/src/canvas/TeamCanvas.tsx`** — ONE behavioral add: `entryNodeIds(graph)` (a node is
  entry iff no edge with `conditions?.loop_limit == null` targets it — loop-backs carry `loop_limit`
  and don't disqualify), threaded into `nodeData(...)` at BOTH the topo-build + in-place-refresh
  effects. Pure FE; no backend field.
- **`frontend/src/lib/status.ts` (+ `status.test.ts`)** — `deriveNodeStatus` fix: the failed/stopped
  run/workflow override now applies ONLY when `backendStatus === "running"`; a never-reached
  ("idle") node stays "idle" regardless of a terminal run. Reproduce-first regressions added (idle +
  failed/cancelled/over_budget → idle) + the prior idle→stopped test re-pointed; running-fold tests
  kept as the scope guard.

## Acceptance evidence (all run to green this session)
- `make test-frontend` → **Tests  167 passed (167)** (floor 165 → **167**, +2 from the new
  deriveNodeStatus regressions).
- Reproduce-first: pre-fix `npx vitest run src/lib/status.test.ts` → **3 failed | 38 passed** (the
  never-reached regressions FAIL: `idle + failed run` got `'failed'`, expected `'idle'`); post-fix →
  **41 passed (41)**.
- `make build-frontend` → **✓ built in 1.16s** (tsc-strict + vite clean).
- `make lint` → ruff **All checks passed! 126 files already formatted** + eslint (`--max-warnings 0`)
  clean + prettier **All matched files use Prettier code style!**.
- Playwright self-sign-off (headless chromium 1400×760; targeted `browser_evaluate` + screenshots on
  a Vite-served component harness that mounts the REAL `TeamCanvas` + `canvas.css`, NO whole-canvas
  a11y snapshot): (1) LIVE canvas — entry PM (coral bar + "Start · entry" + Zap + coral-100 glyph +
  Thinker/blue pill + done sage-check badge + mono footer), Engineer running (coral-200 border +
  `tv-breathe` verified + round-2 badge + Worker/OpenHands + "Working…"), idle Reviewer, awaiting
  Gate (coral pill, radius 999px), dashed Ship @0.82; (2) FAILED canvas — **the fix visible**:
  Engineer `rf-node--failed` (red `#c25a4b` + × badge) WHILE the unreached downstream Reviewer stays
  `rf-node--idle` (neutral `#d2cebe`, "Waiting", no badge), PM stays done; (3) AUTHORING — invalid
  red ring + orphan (dashed, opacity 0.5). Real mouse drag moved a node (`0,60`→`80,110`) incl. from
  the model button (`260,60`→`325,-3`) — drag not broken; no layout break. Compared vs
  `design/Canvas.dc.html` — faithful.
- Screenshots (OUTSIDE the repo): `…/scratchpad/f1a-screenshots/f1a-01-live-run.png`,
  `f1a-02-failed-run-fix.png`, `f1a-03-authoring-flags.png`.

## Invariants held (proofs run on disk this session)
- `git diff main -- frontend/src/lib/api.ts` → **EMPTY**.
- `git diff main -- frontend/src/design-system/tokens/extend.css frontend/src/index.css` → **EMPTY**.
- `git diff --name-only main` (my commit) → the 4 product files + `status.test.ts` only; NOTHING
  under `backend/`, no `alembic/versions/*`. Alembic head stays **0018**.
- Nothing under `design/` staged or committed (untracked before + after). `PROJECTPLAN.md` /
  `HANDOVER.md` / `prompts/*.md` untouched (PROJECTPLAN.md's working-tree ` M` predates F1a — the
  architect's in-flight edit; never staged).

## Deviations from the brief
- **Playwright sign-off ran against a Vite-served component harness** (temporary
  `frontend/f1a-harness.html` + `src/f1a_harness.tsx`, both DELETED after capture, never committed)
  that mounts the REAL `TeamCanvas` + `canvas.css` with fabricated graphs, INSTEAD of a live-driven
  backend run. Rationale: the fix LOGIC is already proven authoritatively by the reproduce-first
  unit test; the harness deterministically renders every node variant + status + the exact
  failed-with-unreached-downstream fix scenario against the real compiled CSS, avoiding live-run
  (NIM/throttle) flakiness. It exercises the identical component DOM the app renders.
- **Entry node uses a `Zap` spark glyph** (design fidelity, surfaced by an adversarial diff review):
  the design recipe's `glyphFor()` returns `#i-zap` for the start node before the role map. The
  brief enumerated only the coral bar + eyebrow + tinted glyph, but "map the design glyphs to the
  existing Lucide set" + the "compare against Canvas.dc.html" acceptance make the swap in-scope.
- **Reduced-motion keeps a static `--glow-soft` ring** on the running node (a11y regression fix
  surfaced by the same review): pre-F1a the running card kept a static focus-ring for reduced-motion
  users; moving the glow into the `tv-breathe` keyframe would have removed it, so the guard now sets
  a static soft coral ring.

## Test Count
**167 vitest** (floor 165 → 167; backend untouched this slice — proven by the empty backend diff) —
2026-07-02.

## Blocked
None — clean SUCCESS. Next: F1b (canvas chrome / edges / handles / connection affordances +
the n8n "+"/hover-delete authoring), then F1c (the premium right drawer + the model picker the
inert model footer will open). The F0 extend tokens (`--shadow-node/-hover`, `--glow-running/-soft`,
`tv-breathe`, `tv-stamp`) are consumed here; the node-card classes are in place for F1b/F1c.
