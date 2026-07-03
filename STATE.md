# Tvashtr — Autonomous Execution State

## Current Milestone
M-frontend prerequisite — **F2a: enrich the New-team template catalog** (backend-only, ahead of F2).
Brief: `prompts/F2a-templates.md`. Branch: `feat/f2a-templates` (off `main` @ `6c2fdbb`).

## OUTCOME — F2a SHIPPED (READY_TO_MERGE; clean SUCCESS)
The New-team template catalog is now the four-template ladder (simple → rich): `two_node`,
`review_loop`, **`plan_review`** (NEW — PM → Architect → Engineer ↔ Reviewer), **`full_squad`** (NEW —
`plan_review` + a `ship_approval` gate; two thinkers, two workers, two human checkpoints). The thin
`thinker_chain` ENTRY is dropped from `_TEMPLATE_CATALOG` (so `GET /api/templates` offers EXACTLY
four), while `build_thinker_chain_team` the FUNCTION stays byte-intact for the executor keystone. Both
new builders mirror `build_review_loop_team` (reused prompt + gate constants; NO new prompts, NO
executor change) and run under the generic executor with zero new code — `plan_review` reuses the
proven non-start-thinker dispatch, `full_squad`'s `ship_approval` gate reuses the generic
`wait_at_gate`. Backend-only; NO migration (alembic head `0018`); nothing under `frontend/` or
`backend/alembic/`.

## Last Completed Step
F2a — starter-team catalog enrichment — 2026-07-03 — branch: feat/f2a-templates — commit: (tip of the
branch; exact sha in the FINAL REPORT).

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/f2a-templates, backend=331 passing, templates=4 (two_node, review_loop, plan_review, full_squad)

## The change (4 files + STATE.md; backend-only)
- **`backend/tvashtr/control_plane/teams.py`** — `+_SHIP_GATE_CONFIG` constant; `+build_plan_review_team`
  (8 nodes / 10 edges = `review_loop` with `pm→prd_gate` replaced by `pm→architect→prd_gate`);
  `+build_full_squad_team` (9 nodes / 12 edges = `plan_review` + a `ship_approval` gate in front of
  ship, both ship-bound approvals rerouted through it); `_TEMPLATE_CATALOG` tuple swapped (drop the
  `thinker_chain` entry; add `plan_review` + `full_squad`). The three existing builder BODIES are
  byte-unchanged (the only deletions are the 5-line `thinker_chain` catalog entry).
- **`backend/tests/test_f2a_templates.py`** (NEW) — exact shape test per new builder (node roles/kinds/
  configs + the EXACT edge set) + a runnable proof per new template (`validate_graph` → `runnable`).
- **`backend/tests/test_team_library.py`** — the two catalog-contract assertions + the stale comment
  re-pointed to `["two_node", "review_loop", "plan_review", "full_squad"]`.
- **`backend/tests/test_capability_edit.py`** — the 5 `create_team_from_template("thinker_chain", …)`
  calls → `"plan_review"` (ARCHITECT-APPROVED; same `pm`/`architect`/`engineer` roles) + docstring.

## Acceptance evidence (all green this session)
- `make test` → **331 passed, 1 warning in 15.65s** (floor 328 → **331**, +3 new template tests; the
  three keystones + the re-pointed `test_capability_edit`/`test_team_library` all green).
- `make lint` → ruff **All checks passed! 127 files already formatted** + eslint (`--max-warnings 0`)
  clean + prettier **All matched files use Prettier code style!**.
- Runnable proof (create each + `validate_graph`): `two_node` / `review_loop` / `plan_review` /
  `full_squad` / `blank` → **runnable = true** (5/5).
- `GET /api/templates` → keys **exactly** `["two_node","review_loop","plan_review","full_squad"]`, each
  with a name + description (payload echoed in the FINAL REPORT).
- Byte-intact: `git diff main --` EMPTY for `team_run.py`, `graph_validity.py`, `test_teams.py`,
  `test_thinker_chain.py`, `test_review_loop.py`; `teams.py` deletions = ONLY the 5-line `thinker_chain`
  catalog entry (the three existing bodies verified AST-identical by the independent review).
- Independent review (fresh subagent over the diff) → **0 blocking after fix**: 1 blocking finding (the
  runnable test called `auth_user_id()` without the `client` fixture → order-dependent, green only via
  alphabetical collection) FIXED (declared `client`) + re-verified (isolation **3 passed**, was 2p/1f);
  1 non-blocking nit (a stale comment in the UNCHANGED `test_graph_validity.py`) left as-is (out of
  scope; that file tests the builders directly and stays green).

## Invariants held (proofs on disk)
- WALL / byte-intact — the 5 executor/keystone files EMPTY diff vs `main`; alembic head **`0018`** (NO
  migration); nothing under `frontend/` or `backend/alembic/`.
- Keystones (`test_teams.py` / `test_thinker_chain.py` / `test_review_loop.py`) pass UNCHANGED.
- `teams.py` diff confined to the two new builders + `_SHIP_GATE_CONFIG` + the catalog tuple.
- Commit stages ONLY `teams.py` + `test_f2a_templates.py` + `test_team_library.py` +
  `test_capability_edit.py` + `STATE.md` — no living docs (PROJECTPLAN/HANDOVER), no `prompts/*.md`, no
  side-chat `.md`/`design/` (untracked, left alone), never `.tvashtr/loop-state.md` (gitignored).

## Test Count
**331 backend pytest** (floor 328 → 331; +3 new) — 2026-07-03. FE untouched (no vitest/build run).

## Blocked
None — clean SUCCESS. Next: **F2 (the dashboard)** consumes this four-template catalog live via
`GET /api/templates` (the picker-on-create). The M-frontend revamp is not "done" until F4.
