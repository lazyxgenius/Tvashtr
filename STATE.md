# Tvashtr — Autonomous Execution State

## Current Milestone
P1.5c §14.2 — the team A/B **pair + launch** — **DONE, offline-green, reviewed, READY_TO_MERGE**.
(§14 = the team A/B "which config ships better" attributability instrument; §14.1 verdict view
already merged at 3f02189. This adds ONLY the A/B pairing + launch — no executor change.)

## Last Completed Step
P1.5c §14.2 (A/B pair + launch) — 2026-06-23 — branch: feat/p1.5c-ab-pair — commit: 48e50d3 —
make test 164 GREEN, lint clean, migration 0010 round-trips, adversarial review 0 blockers,
READY_TO_MERGE.

## In Progress
None — §14.2 is implemented, offline-green, and adversarially reviewed (multi-agent: 0 blockers /
0 majors; 1 minor test-coverage gap found AND fixed + mutation-verified). Awaiting operator
FF-merge of feat/p1.5c-ab-pair. NEXT: §14.3 (the comparison view) + the deferred verdict-reasons
persistence (kept as its own migration+executor milestone — the seam the freeze hook guards).

## Completed Steps (append-only, newest last)
- [x] P1.5c §14.2 — A/B pair + launch: migration 0010 (nullable pair_id [indexed
  ix_runs_pair_id] + pair_label on runs), POST /api/ab-runs (one idea -> two paired runs
  A=two_node / B=review_loop, same idea + same budget cap, each its own workflow keyed on its
  run_id), _run_to_dict surfaces the pairing, tests/test_ab_pair.py (offline, launch stubbed).
  NO executor change — team_run.py / teams.py / migrations 0001-0009 untouched. —
  feat/p1.5c-ab-pair @ 48e50d3 — 2026-06-23
- [x] Step 0 — provider-agnostic LLM routing (`agent_llm_routing` resolves api_key per
  provider on the proxy-OFF path) — feat/p1.5c-provider-routing @ 86a6685 — 2026-06-23
- [x] Step 1 — `config.TASK_LIST_IDEA` capstone feature, `routers.resolve_run_idea` seeding,
  `loop_run.py` feature mode, `make loop-feature-docker`, +8 routing/task tests; plus the
  provider routing extended to groq/ and nvidia_nim/, and an env-overridable agent iteration
  cap. LIVE DOCKER ACCEPTANCE GREEN (shipped on green). — feat/p1.5c-capstone-live @ 254c14d

## Blocked
None. (The earlier free-tier LLM block was resolved when the operator added an NVIDIA NIM key.)

## Live acceptance evidence (the capstone)
`make loop-feature-docker` on `nvidia_nim/qwen/qwen3-next-80b-a3b-instruct` (docker sandbox):
- PM → real Engineer multi-file build → agent-Reviewer ran `python -B -m unittest` on the
  build → tests passed → verdict `approved` → Control Plane harvested + removed
  `REVIEW_VERDICT.json` → SHIPPED on green.
- run.status=completed, engineer_iters=[1], reviewer_rounds=[(1,'approved')], 1 engineer +
  1 reviewer cost row, ship tag `ship-f08d1e56-…`, ship commit `7a8263a…`.
- `ALL FEATURE-LOOP CAPSTONE ASSERTIONS PASSED`.

## Test Count
164 offline tests passing — 2026-06-23 (161 baseline incl. §14.1 + 3 new test_ab_pair.py). ruff clean.
(Earlier capstone milestone was 160; §14.1 verdict view took it to 161.)

## Deviations / decisions (PROJECTPLAN.md didn't specify)
- **§14.2 — indexed pair_id (migration 0010):** added `ix_runs_pair_id` on the new `pair_id`
  column. pair_id is the §14.3 comparison-view lookup key, and the codebase already indexes its
  other grouping/lookup columns (runs.team_graph_id; the run_id text cols). Cheap, additive,
  and the column's whole purpose is to be queried by.
- **§14.2 — scope isolated from verdict-reasons (operator call, this /goal):** this milestone
  adds ONLY pair_id/pair_label + POST /api/ab-runs with NO executor change. Verdict-reasons
  persistence (a new column + close_invocation_step param + the reviewer call site in
  team_run.py) is deferred to its own later milestone — it's the migration+executor risk seam
  the freeze hook exists to guard, so it gets its own auditable evidence.
- **§14.2 — A/B configs fixed in v1:** A=two_node (no review), B=review_loop (agent-Reviewer);
  ABRunRequest carries only idea + budget_cap (same on both = fair comparison). Arbitrary-config
  A/B is Phase-2. create_run left untouched; create_ab_runs is a separate endpoint.
- **§4.5 stale-parked-runs hit during this run:** 2 stale PENDING `run_team` workflows in
  dbos.workflow_status resurrected on TestClient startup and hung the suite. Remediated
  surgically (`UPDATE dbos.workflow_status SET status='CANCELLED' WHERE status='PENDING'` —
  recovery's PENDING-only scan then skips them; mirrors what cancel_run does) rather than the
  heavier `docker compose down -v` reset. Suite green afterward; migration 0010 round-trips clean.
- **Agent provider = NVIDIA NIM** (`nvidia_nim/qwen/qwen3-next-80b-a3b-instruct`). The free
  tiers explored first could NOT drive OpenHands' ~38k-token loop: Gemini free (20/day cap +
  503 throttle); Groq free (TPM 6k–12k vs 38k requests, + llama tool-format). NVIDIA NIM's
  free tier has clean OpenAI tool_calls, large context, and generous limits — it ships the
  loop. `qwen3-next-80b-a3b` (3B active) is fast AND strong; plain `llama-3.3-70b` thrashed on
  rework and `qwen3.5-122b` was too slow. Routing wired for gemini/, groq/, nvidia_nim/ (all
  unit-tested) so any is a one-line `.env` swap.
- **`_MAX_ITERATIONS` env-overridable** (`TVASHTR_AGENT_MAX_ITERATIONS`, default 20). 20 was
  too few for a real multi-file build + rework (tripped `MaxIterationsReached`); loop-feature-
  docker sets 40. Skeleton/smoke targets unchanged (default preserved).
- `loop_run.py` gained `TVASHTR_FEATURE_RUN` feature mode (real Engineer + real agent-Reviewer,
  no forced revisions); forced-revisions mode byte-for-byte unchanged.

## Open Questions
- NIM cost shows $0 (litellm has no NIM price map entry) — cosmetic; the $0-agent-cost gap is
  the same class as the pre-existing OpenRouter-pricing note (§15). Not blocking.

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/p1.5c-ab-pair, sha=48e50d3, tests=164 passing
  (make test 164 GREEN [161 baseline + 3 new test_ab_pair.py]; make lint clean; migration 0010
  round-trips down->up clean [head 0009<->0010, pair_id/pair_label/ix_runs_pair_id]; real
  POST /api/ab-runs payload verified [shared pair_id, A=two_node/B=review_loop, same idea+cap];
  adversarial multi-agent review 0 blockers / 0 majors [1 minor test-gap fixed + mutation-verified];
  executor [team_run.py], teams.py, and migrations 0001-0009 UNTOUCHED in git diff --stat)

READY_TO_MERGE: branch=feat/p1.5c-provider-routing, sha=86a6685, tests=160 passing
  (agent-smoke green; offline green; gemini routing)

READY_TO_MERGE: branch=feat/p1.5c-capstone-live, sha=254c14d, tests=160 passing
  (make loop-feature-docker GREEN — agent-Reviewer ran the build's unittest suite, approved,
  REVIEW_VERDICT.json harvested+removed, SHIPPED on green; make lint clean)
