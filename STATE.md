# Tvashtr — Autonomous Execution State

## Current Milestone
P1.5c — M1 Capstone (Step 2) — **COMPLETE**. The live docker agent-Reviewer acceptance
SHIPPED ON GREEN. M1 (machinery proven end-to-end) is met.

## Last Completed Step
Step 1 (P1.5c capstone-live) — 2026-06-23 — branch: feat/p1.5c-capstone-live —
commit: 254c14d — live acceptance GREEN, READY_TO_MERGE.

## In Progress
None — both P1.5c steps are done, offline-green, and live-accepted. Awaiting operator FF-merge.

## Completed Steps (append-only, newest last)
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
160 tests passing — 2026-06-23 (148 baseline + 4 gemini-routing + 1 groq + 1 nvidia + 6 task-idea)

## Deviations / decisions (PROJECTPLAN.md didn't specify)
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
READY_TO_MERGE: branch=feat/p1.5c-provider-routing, sha=86a6685, tests=160 passing
  (agent-smoke green; offline green; gemini routing)

READY_TO_MERGE: branch=feat/p1.5c-capstone-live, sha=254c14d, tests=160 passing
  (make loop-feature-docker GREEN — agent-Reviewer ran the build's unittest suite, approved,
  REVIEW_VERDICT.json harvested+removed, SHIPPED on green; make lint clean)
