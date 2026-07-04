# FE-papercuts — two registered §15 test/component cleanups (parallel-safe with F3)

**Owner:** Claude Code (a SECOND session, in its own git worktree off `main`). **Architect:** Tvashtr-47. **Type:** FRONTEND test-harness + one component guard. No migration, no backend, no visible-surface change.

## Why this is safe to run parallel to F3
F3 (the auth wizard, running in the MAIN checkout on `feat/f3-auth-wizard`) touches: `AuthWizard.tsx` (+test), deletes `LoginScreen.tsx` (+test), edits `AuthGate.tsx`, `LandingPage.tsx`, `index.css`. THIS session touches a disjoint set (below) and MUST NOT touch any of F3's files — above all **do NOT edit `index.css`, `api.ts`, `AuthGate.tsx`, `LandingPage.tsx`, `AuthWizard.tsx`, `LoginScreen.*`, or `Dashboard.tsx`**.

## Two tasks

### Task 1 — silence the React-Flow minimap `NaN` / `act()` warnings in canvas vitest
**Symptom:** the canvas test files emit `Received NaN for the 'cx'/'cy'/'r'/'x'/'y' attribute` and "An update to MiniMap inside a test was not wrapped in act(...)" on stderr. jsdom has no layout, so React-Flow's `<MiniMap>` computes NaN geometry. ALL tests still PASS — this is cosmetic stderr noise only.

**Fix:** stub/neutralize `MiniMap` in the test harness so it renders nothing (or a static stub) under jsdom, WITHOUT changing any real component. Prefer a single mock in `frontend/src/test/setup.ts` that mocks ONLY the `MiniMap` export from the React-Flow package (leave every other export — `ReactFlow`, `Background`, `Controls`, handles, hooks — untouched), so production code and the auth/dashboard tests (which don't render a minimap) are entirely unaffected. If a global mock proves awkward, fall back to a small shared test helper imported by the four `TeamCanvas.*.test.tsx` files + `AgentNodeCard.modelChip.test.tsx`. Keep it minimal and localized.

- Files in play: `frontend/src/test/setup.ts` (the existing React-Flow shims already live here — extend that pattern), and possibly `frontend/src/canvas/TeamCanvas.test.tsx`, `TeamCanvas.affordances.test.tsx`, `TeamCanvas.authoring.test.tsx`, `TeamCanvas.hover.test.tsx`, `AgentNodeCard.modelChip.test.tsx`.
- Determine the exact React-Flow import specifier used by the canvas source (grep `frontend/src/canvas/TeamCanvas.tsx` for the import — it may be `reactflow` or `@xyflow/react`) and mock THAT specifier's `MiniMap`.
- **Do not** delete or weaken any existing assertion. Every canvas test must still pass and still test what it tested.

**Acceptance for Task 1:** after the fix, a full `make test-frontend` run shows the same tests passing with the `NaN`/`act(...)`-MiniMap warnings GONE from stderr. Capture proof: run vitest capturing stderr and grep it for `Received NaN` and `not wrapped in act` scoped to MiniMap → zero matches (paste the grep result). If a couple of unrelated `act()` warnings from other sources remain, that's fine — the target is specifically the MiniMap NaN/act noise.

### Task 2 — add the unmounted-`setState` guard to `NewTeamDialog`
**Symptom:** in `frontend/src/components/NewTeamDialog.tsx`, `create()` awaits `createTeam(...)`; on SUCCESS it calls `onOpenTeam(...)` which unmounts the dialog, and on FAILURE its `catch` runs `setError(...)` + `setCreating(false)`. If the component unmounted before the catch resolves, those set-states fire after unmount (benign under React 18, but a latent divergence from the `mountedRef` guard `Dashboard.tsx` already uses).

**Fix:** add a `mountedRef` (a `useRef(true)` set to `false` in a cleanup effect, mirroring `Dashboard.tsx`'s existing pattern — read it for the exact shape) and guard the `catch` branch's set-states (and any post-await set-state) behind `if (mountedRef.current)`. The existing `getTemplates` effect already uses a local `cancelled` flag — leave it as-is or align it to the same ref, your call, but keep behavior identical on the mounted path.

- File in play: ONLY `frontend/src/components/NewTeamDialog.tsx`.
- Optional (not required): a vitest that renders the dialog, triggers a failing `createTeam` (stub `fetch` to reject), unmounts mid-flight, and asserts no post-unmount state warning. Only add it if it's clean and deterministic; do NOT add a flaky timer-coupled test. If you add one, it goes in a new `NewTeamDialog.test.tsx` (a NEW file — no collision).

**Acceptance for Task 2:** `NewTeamDialog.tsx` now guards its post-await set-states with `mountedRef.current`, matching `Dashboard.tsx`. `make test-frontend` stays green. `make build-frontend` (tsc-strict) passes.

## Invariants — prove each as evidence (paste the command output)
- `git diff --stat main -- backend alembic` → EMPTY (no backend, no migration; head stays 0018).
- `git diff --stat main -- frontend/src/lib/api.ts` → EMPTY.
- `git diff --stat main -- frontend/src/index.css` → EMPTY (F3 owns index.css this round — this session must not touch it).
- `git diff --stat main -- frontend/src/components/AuthGate.tsx frontend/src/components/LandingPage.tsx frontend/src/components/Dashboard.tsx` → EMPTY.
- Executor byte-intact: `git diff --stat main -- backend` → EMPTY covers it (no backend touched at all).
- The ONLY files this branch changes are: `frontend/src/test/setup.ts` (± the canvas `*.test.tsx` files) and `frontend/src/components/NewTeamDialog.tsx` (± a new `NewTeamDialog.test.tsx`). Show `git diff --stat main` for the whole branch and confirm the changed set is exactly that.

## Acceptance / evidence (run every one yourself, debug to green, echo the decisive line)
1. `make test-frontend` — all green; report before/after counts (should be unchanged, or +1 if you add the optional NewTeamDialog test). No test removed or weakened.
2. `make build-frontend` — tsc-strict + vite build succeed.
3. The MiniMap-warning-absence grep from Task 1 (paste it).
4. Backend is untouched — the `git diff --stat main -- backend alembic` EMPTY invariant above IS the proof. Do NOT run the backend `make test` suite here: the parallel F3 session is using the same dev Postgres, and running backend pytest could contend with its live demo DB. The empty diff is the stronger, DB-free proof.
5. Write `READY_TO_MERGE` (branch=feat/fe-papercuts, sha, final test counts) to `STATE.md`.

No Playwright / live browser / DB needed — nothing user-visible changes here, and this session stays fully data-less so it can't interfere with F3.

## Stop conditions
- `NEEDS_HUMAN` to `STATE.md` if mocking the MiniMap cleanly is not possible without touching a real component or breaking other tests, or if any acceptance needs a broad/unproven change. A contained fix within the two files above proceeds.
- Turn cap: 25. Commit ONLY the changed FE files on branch `feat/fe-papercuts`; do NOT commit `PROJECTPLAN.md`, `HANDOVER.md`, or `prompts/*.md`. Do NOT push (the operator merges — this branch merges LAST, after F3, via cherry-pick).
