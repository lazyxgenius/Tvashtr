# Tvashtr — Autonomous Execution State

## Current Milestone
M-accounts → BYOK. **Slice C — the per-node model picker in the canvas + recommendation hints** (the
FINAL M-accounts slice). Branch `feat/m-accounts-model-picker` cut from `main` @ `15e64c2` (the
Slice-B docs-closeout commit, which contains all of `28c2ce3`; FF-safe). Slices A + B shipped +
merged. **COMPLETE — all gates green; READY_TO_MERGE below.**

## Last Completed Step
M-accounts Slice C — branch `feat/m-accounts-model-picker` — 5 atomic commits. Awaiting operator
audit + FF-merge.

## In Progress
Nothing — Slice C is COMMITTED and all gates are green. Awaiting operator audit + FF-merge.

## The change (Slice C)
The user picks each node's model from THEIR configured providers; Tvashtr recommends, never enforces.
Three pieces, all UI/thin-default over the SAME single `node.model` string — NO migration, NO schema
change, fully `.env`-free:
1. **A provider-gated per-node picker** in `TeamNodePanel`: a Provider select (from
   `GET /api/providers` + the node's own provider) with an inline "+ Add a provider…" affordance that
   reuses `addProvider` (the SAME endpoint+table the dashboard uses) then refetches+selects, and a
   Model free-text field whose quick-picks are scoped to the chosen provider. Provider is derived from
   the slug (`providerOf`, matching the backend `provider_for_model`); switching rewrites the leading
   segment.
2. **A dismissible per-node recommendation hint** that fires for a gating worker (a verdict/branch
   reviewer) when a worker it reviews/sends-rework-to runs the IDENTICAL live model; absent on
   thinkers / non-gating workers / gate-terminal / when the models differ; never blocks Save.
   Registry-free same-model detection (NOT slug ranking).
3. **An account-aware node-create default**: a newly-dropped node with no explicit model defaults to a
   model whose provider the account already holds (static `PROVIDER_DEFAULT_MODEL` map, fixed
   preference order), else today's hardcoded default. The model stays mandatory; the launch pre-flight
   422 is the single runnability gate (unchanged).

## What landed (5 atomic commits, branch `feat/m-accounts-model-picker`)
1. `9186d7c` — backend account-aware node-create default (§3.1): `teams.PROVIDER_DEFAULT_MODEL` +
   `account_default_model` threaded into `_build_node` via the owner's held providers; 7 discriminating
   tests (exact slug per provider-set, preference order, endpoint wiring).
2. `a0b7951` — FE `providerOf` (parity with `provider_for_model`, pinned by a unit test) +
   `presetsForProvider` + gemini/groq quick-picks (map parity); +2 vitest.
3. `6f27184` — the FE picker (Provider select + inline add + provider-scoped Model) + the
   recommendation hint + `App` passes the team nodes down; panel tests updated for the two-combobox +
   mount fetch; +4 vitest (picker ×2, the discriminating hint pair).
4. `d552f78` — the live `make model-picker-e2e` (.env-free: a fresh account self-seeds dummy encrypted
   creds via the API, NO run) + spec + script.
5. (the branch HEAD) — this STATE closeout + the PROJECTPLAN §15 deferral-register entries (the two
   §7 out-of-scope items: rank-aware "heavier-reviewer" recommendation; mirror the nudge into the
   launch panel).

## Invariants held (checkable on disk)
- **NO migration / NO schema change**: alembic head stays `0017`; `node.model` is still one
  `provider/model` string (the picker composes/derives; no new column/field/endpoint); freeze hook
  unchanged (`0001`–`0017`). The provider endpoints' contracts + the `create_run` pre-flight 422 are
  byte-unchanged; the inline add reuses `POST /api/providers` (no new path).
- **`.env`-INDEPENDENT**: nothing in the slice's code/tests/e2e reads a `.env` provider key — the
  picker reads `GET /api/providers` (encrypted DB), the hint is FE-only same-model detection, the
  create-default reads `ProviderCredential` rows, and the e2e self-seeds dummy encrypted creds +
  launches NO run. The only env value needed is the stable Fernet `TVASHTR_SECRET_KEY` (encryption,
  not a provider key). Passes identically with the `.env` provider keys present or deleted.
- **ONE canonicalization rule**: the FE `providerOf` = the leading slug segment lower-cased/trimmed =
  the backend `provider_for_model` (parity unit-tested on the SAME cases).
- `team_run.py` untouched (openhands-free at import); `build_two_node_team` + the `EngineerAdapter`
  seam untouched.

## Gate results — decisive lines echoed into the /goal transcript
- `make test` — **`316 passed, 1 warning in 14.94s`** (309 floor + 7 new: the create-default unit +
  endpoint tests).
- `make lint` — ruff **`All checks passed!`** + eslint `--max-warnings 0` (exit 0) + prettier
  **`All matched files use Prettier code style!`**.
- `make test-frontend` — **`Tests 165 passed (165)`** (159 floor + 6: `providerOf` parity ×2, picker
  ×2, the discriminating hint pair ×2); `make build-frontend` — **`✓ built in 1.20s`** (tsc-strict +
  vite).
- `make model-picker-e2e` — **`MODEL-PICKER E2E PASSED`** (`1 passed`): a fresh account → seed dummy
  providers → open the team → Engineer node (the picker lists the seeded providers + the model slug) →
  inline-add groq (appears in the panel + the dashboard) → Reviewer (same-model hint visible) + PM
  thinker (absent). Screenshots in `/tmp/tvashtr_model_picker_shots/` (check2-engineer-picker,
  check3-inline-add, check4-reviewer-hint).

## Test Count
**316 backend pytest** (309 floor + 7 new) + **165 vitest** (159 floor + 6 new) — 2026-06-28.

## Deviations / notes
- Branched off `main` @ `15e64c2` (the Slice-B docs-closeout commit, one docs commit atop `28c2ce3`)
  rather than `28c2ce3` itself — `15e64c2` is the current `main` HEAD + contains all of `28c2ce3`, so
  the FF-merge stays clean (branching off `28c2ce3` would leave `15e64c2` off the branch).
- The two PROJECTPLAN §15 deferral entries were already drafted (uncommitted) in the working tree when
  the slice started (the architect's Slice-C §7 deferral register) — carried + committed here.

## Open Questions
None. M-accounts (A → B → C) is COMPLETE. The two §15 deferrals (rank-aware heavier-reviewer
recommendation; mirror the nudge into the launch panel) are out of scope by design.

READY_TO_MERGE: branch=feat/m-accounts-model-picker, sha=<branch HEAD — the closeout commit>, tests=316 backend / 165 vitest
