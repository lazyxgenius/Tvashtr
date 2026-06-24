# Tvashtr — Autonomous Execution State

## Current Milestone
P1.7a — **live-document steering, the BACKEND seam** (J3: "the document, not agent memory, is the
source of truth; a human edit propagates to the relevant agents on their next read"). READ + a
recorded re-read step only: a `POST /api/documents/{id}/versions` save-edit endpoint, and the
executor re-sources the PRD at EVERY agent-node entry via a recorded `@DBOS.step`
(`read_latest_prd_step`), replacing the PM's once-captured `prd_text` snapshot. NO frontend
(that's P1.7b), NO migration (head stays 0011), NO executor-contract change. — **DONE,
offline-green, adversarially reviewed (0 blocking / 0 major), READY_TO_MERGE.**

## Last Completed Step
P1.7a (live-document steering backend) — 2026-06-24 — branch: feat/p1.7a-steering-backend —
make test 177 GREEN (+6), lint clean, alembic head 0011 (NO migration), import tvashtr.main
openhands-free, test_registry green, keystone steering test passes + its mutation-revert FAILS
(non-vacuity proven), adversarial multi-agent review 0 blocking / 0 major. READY_TO_MERGE.

## In Progress
None — P1.7a is implemented, offline-green, and adversarially reviewed (0 blocking / 0 major).
Awaiting operator FF-merge of feat/p1.7a-steering-backend + the operator's live gate (loop-crash /
loop-run / skeleton-crash / skeleton-run must stay green — the live proof the live re-source
composes with crash-resume; needs a live LLM, off the offline path). NEXT: P1.7b (the TipTap
editor + lock-aware UI + the live visual smoke), and/or P1.8 Supervisor-first onboarding.

## Completed Steps (append-only, newest last)
- [x] P1.7a — live-document steering (backend seam): documents/service.py `get_latest_version`;
  routers.py `POST /api/documents/{id}/versions` (body {content}; 400 bad uuid / 404 missing;
  fresh idempotency key per request -> each save is a NEW version; returns {document_id,
  version_no, content, created_at}); team_run.py NEW `@DBOS.step read_latest_prd_step(run_id)`
  re-reading the LATEST DocumentVersion, wired at EACH agent-node entry (Engineer AND Reviewer,
  every iteration) in run_graph, replacing the removed workflow-local `prd_text` snapshot (idea
  stays the snapshot). Tests: NEW tests/test_live_prd_steering.py (endpoint x3, read-step,
  keystone mid-run steering, structural is-a-DBOS-step); shared `seed_pm_prd` conftest helper +
  3 existing stub sites updated (the live re-read now needs a real persisted PRD). NO migration /
  NO frontend / NO executor-contract change — pm_step, engines/*, docker_runtime.py, shipping.py,
  registry.py, teams.py, migrations 0001-0011 untouched. — feat/p1.7a-steering-backend @ 5c19828 —
  2026-06-24
- [x] P1.5c §14.3 — A/B comparison view: routers.py read endpoint + FE side-by-side + reviewer
  reasons. — feat/p1.5c-ab-comparison @ b420da8 — 2026-06-24
- [x] P1.5c §14.2 — A/B pair + launch (migration 0010). — feat/p1.5c-ab-pair @ 48e50d3 — 2026-06-23
- [x] P1.5c — verdict-reasons persistence (migration 0011). — main @ 7bf5e14 — 2026-06-23

## Blocked
None.

## Acceptance evidence (P1.7a)
- `git diff --stat main -- backend/`: 7 files — `tvashtr/routers.py` (+endpoint), `tvashtr/
  documents/service.py` (+get_latest_version), `tvashtr/control_plane/team_run.py` (+read step,
  +wiring, -dead prd_text), `tests/conftest.py` (+seed_pm_prd), `tests/test_review_cap.py` /
  `test_review_loop.py` / `test_reviewer_agent.py` (stub sites use seed_pm_prd). New untracked
  `tests/test_live_prd_steering.py`. DO-NOT-TOUCH list (alembic/versions/, frontend/, engines/*,
  docker_runtime.py, shipping.py, registry.py, teams.py, migrations 0001-0011) — `git diff
  --name-only main` over them is EMPTY. pm_step body byte-identical.
- `make test` → **177 passed** (+6 over the 171 baseline; +6 test_live_prd_steering.py, and the
  3 existing run_team suites updated for the live re-read). `make lint` → clean (75 files).
- Alembic head still `0011_invocation_outcome_detail` — NO migration.
- `import tvashtr.main` is openhands-free (`openhands` not in sys.modules); `test_registry` green.
- Endpoint payload sample (POST /api/documents/{id}/versions over a v1 doc):
  `{"document_id": "...", "version_no": 2, "content": "human-edited PRD body (steered)",
  "created_at": "2026-06-24T07:50:24.684659+00:00"}` (HTTP 200).
- Keystone `test_mid_run_prd_edit_reaches_the_revision_engineer` PASSES; the mutation-revert
  (flip `get_latest_version` to ascending order, so the re-read returns v1 not the latest) makes
  it FAIL at `assert engineer_prds[1][1] == _STEERED_PRD` (the round-2 Engineer would get the PM's
  original, not the human edit) — non-vacuity proven, then restored.
- No new pip dep (pyproject.toml not in the diff). No frontend.
- Adversarial 2-agent review (correctness+determinism / invariants+test-rigor): **0 blocking /
  0 major**; NITs all withdrawn-on-verification or accepted per-brief. Both independently re-ran
  the mutation-revert. Gates re-green after they restored the working tree (177 passed, lint clean).

## Deviations / decisions (two-way-door, logged)
- **read_latest_prd_step returns `str` (the content), not `{version_no, content}`** — the brief
  permitted either; bare content keeps the agent-step signatures byte-identical (`prd_text: str`)
  and the determinism guarantee is unaffected (the step's recorded return replays regardless of
  shape).
- **Removed the workflow-local `prd_text`** (init + the PM-node assignment) — it became unused
  after the live re-source (would be a ruff F841). pm_step still RETURNS `prd_text` (byte-identical);
  the walk just no longer threads the snapshot. Updated the two run_graph/module docstrings that
  listed `prd_text` as recomputed workflow-local state.
- **Shared `seed_pm_prd` conftest helper** — the live re-read makes the executor genuinely read
  the run's PRD document, so the offline run_team tests' fake `pm_step` (which returned a random
  uuid and never persisted a doc) had to persist a real v1 + set `Run.pm_document_id`. Factored
  the shared stand-in into conftest rather than duplicating it across the 5 stub sites; the
  existing assertions (cap termination, per-iteration metering, invocation sequences) are unchanged.
- **Endpoint mirrors GET /api/documents/{id}**: 400 on a malformed uuid (the brief named only the
  404; mirroring the sibling GET's 400 is the consistent contract). Fresh idempotency key per POST.

## Open Questions
- None blocking. (The document soft-lock is a deliberate deferral — see the brief / §15: in this
  loop only the PM writes the PRD; the Engineer/Reviewer only read it, so a human edit never
  collides with an agent write. The lock lands when an agent re-writes a doc the human also edits.)

## Test Count
177 offline tests passing — 2026-06-24 (171 baseline + 6 new test_live_prd_steering.py; the 3
updated run_team suites stay in the count). ruff clean. (Frontend untouched — vitest unchanged.)

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/p1.7a-steering-backend, sha=5c19828, tests=177 passing
  (make test 177 GREEN [171 baseline + 6 new test_live_prd_steering.py]; make lint clean; alembic
  head 0011 — NO migration, nothing under alembic/versions/; git diff --name-only main over the
  do-not-touch list [engines/*, docker_runtime.py, shipping.py, registry.py, teams.py, migrations
  0001-0011, frontend/] is EMPTY; pm_step byte-identical; import tvashtr.main openhands-free;
  test_registry green; the keystone steering test passes AND its mutation-revert FAILs [non-vacuity];
  endpoint payload sample echoed; no new dep; no frontend). Operator's remaining gate = the LIVE
  composition proof (make loop-crash / loop-run / skeleton-crash / skeleton-run stay green — the
  live re-source composes with crash-resume), which needs a live LLM and is off the offline path.
