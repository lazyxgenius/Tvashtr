# Tvashtr — Autonomous Execution State

## Current Milestone
P1.5c — M1 Capstone (Step 2, live acceptance)

## Last Completed Step
Step 0 — Provider-agnostic LLM routing — 2026-06-23 — branch: feat/p1.5c-provider-routing
— commit: 86a6685 — READY_TO_MERGE

## In Progress
Step 1 (P1.5c capstone-live) — branch feat/p1.5c-capstone-live — commit 1d91572.
CODE COMPLETE + offline-green (159 tests, lint clean). **LIVE docker acceptance BLOCKED on
the LLM credential** — see Blocked. The agent-Reviewer machinery, the TASK_LIST_IDEA brief,
the seeding, the `loop-feature-docker` target, and Run.idea seeding all work; the loop reaches
a REAL Engineer agent run inside the docker sandbox. It cannot complete the multi-file build
because no available LLM both (a) drives OpenHands tool-use AND (b) has free-tier quota for the
many calls a real build+review needs.

## Completed Steps (append-only, newest last)
- [x] Step 0 — provider-agnostic LLM routing (`agent_llm_routing` resolves api_key per
  provider on the proxy-OFF path: `gemini/` → `GEMINI_API_KEY`, else `OPENROUTER_API_KEY`;
  `_direct_agent_api_key`). +4 tests. — feat/p1.5c-provider-routing @ 86a6685 — 2026-06-23
- [x] Step 1 CODE — `config.TASK_LIST_IDEA` (env-overridable), `routers.resolve_run_idea`
  seeding rule, `loop_run.py` feature mode (TVASHTR_FEATURE_RUN), `make loop-feature-docker`,
  `test_task_idea.py` (+7 tests). Offline-green; live acceptance pending the LLM. —
  feat/p1.5c-capstone-live @ 1d91572 — 2026-06-23

## Blocked
NEEDS_HUMAN: P1.5c capstone LIVE docker acceptance (`make loop-feature-docker`) is blocked —
no available LLM can drive the OpenHands agent loop within free-tier quota. Findings:
- The `AQ.`-prefixed `GEMINI_API_KEY` is a VALID Google AI Studio key (HTTP 200 as `?key=`,
  401 as Bearer — it is an API key, NOT an OAuth/Vertex token as HANDOVER feared). Provider
  routing works: `make agent-smoke` GREEN on `gemini/gemini-2.5-flash`.
- This project's Gemini FREE TIER cap is ~20 requests/day PER MODEL
  (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, quotaValue 20). A multi-file
  build+review loop needs far more than 20 LLM calls.
  - `gemini-2.5-flash` — CAPABLE (drove agent-smoke) but daily-cap EXHAUSTED.
  - `gemini-2.0-flash`, `gemini-2.0-flash-lite` — daily-cap EXHAUSTED.
  - `gemini-2.5-flash-lite` — daily HEADROOM but TOO WEAK: returns empty `choices=[]`
    (completion_tokens=0) → OpenHands `ConversationRunError: Response choices is less than 1`.
  - `gemini-2.5-flash` POST-RESET (waited out the Pacific-midnight reset; probe → HTTP 200,
    fresh quota) — still FAILED, now on **503 ServiceUnavailable** ("high demand"): 9× 503 vs
    1× 429, no files written. Google DEPRIORITIZES free-tier requests under load, exhausting
    OpenHands' retry budget on the Engineer's first step → build never starts. So even with
    quota, the FREE tier is throttled below what the agent loop needs.
- `OPENROUTER_API_KEY` — credits exhausted (the original blocker); free `gpt-oss-20b:free`
  too weak for tool-use (only survives the small PM call).
- FOUR distinct LLM strategies tried (2.0-flash, 2.5-flash, 2.5-flash-lite, 2.5-flash post-
  reset); per CLI-RULES §4.6/§5 the loop is NOT spun further — this is an operator credential
  decision (D9 / HANDOVER options A–D): a PAID Gemini key (paid tier removes BOTH the 20/day cap
  AND the free-tier 503 throttle), a Groq free key (strong tool-use), a few $ of OpenRouter
  credit, or local Ollama.
- `.env TVASHTR_AGENT_MODEL` is set to `gemini/gemini-2.5-flash` (the proven-capable slug) so
  the operator's retry uses it once quota/billing is available. Then: `make loop-feature-docker`.

## Test Count
159 tests passing — 2026-06-23 (148 baseline + 4 routing + 7 task-idea)

## Deviations from PROJECTPLAN.md
- Agent model is Gemini 2.5-flash, not 2.0-flash (CLI-RULES Step 0 invited "the correct
  slug"). 2.5-flash is the only free model that both drove OpenHands (agent-smoke) and exists;
  2.0-flash's daily quota was already exhausted. Two-way-door (a slug in `.env`).
- `loop_run.py` gained a `TVASHTR_FEATURE_RUN` feature mode rather than a new script (Step 1
  point 3 said "running loop_run.py"); forced-revisions mode is byte-for-byte unchanged.

## Open Questions
- Does a paid Gemini key (or Groq) let `gemini-2.5-flash` complete the capstone loop? → expected
  yes (it drove agent-smoke cleanly); unverified pending the credential. OPEN.

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/p1.5c-provider-routing, sha=86a6685, tests=159 passing
  (agent-smoke GREEN on gemini/gemini-2.5-flash; make test 159; make lint clean)

NOT-READY (blocked): branch=feat/p1.5c-capstone-live, sha=1d91572 — code complete + offline
  green (159 tests, lint), but the §10 live-acceptance gate (`make loop-feature-docker`) is
  BLOCKED on the LLM credential above. Do NOT merge until the live loop ships-or-cycles with a
  harvested REVIEW_VERDICT.json on a capable+sufficient-quota LLM.
