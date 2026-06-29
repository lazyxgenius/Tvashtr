# Tvashtr — Autonomous Execution State

## Current Milestone
M-brownfield **rung 2** — run the already-proven brownfield `review_loop` (PM → prd_gate → Engineer ⇄
Reviewer → ship) against a FRESH CLONE of the user's REAL `trade_mcp` repo to ship a **DEMA**
indicator into `core/indicators.py`, gated by an INDEPENDENT numeric correctness check the driver
runs itself (NOT the 70b Reviewer's approval). Branch `feat/brownfield-rung2` cut from `main` @
`75deea4`.

## Outcome: RUNG-2 FINDING  (a complete result, NOT a harness bug — the harness is provably correct and MERGES)
The committed harness (`scripts/trade_mcp_rung2_check.py` + `make brownfield-rung2`) ran the proven
docker+NIM `review_loop` end-to-end against a fresh clone of the real `trade_mcp` repo **twice** (§C1
bounded retry ≤2). **BOTH attempts ERRORed on MACHINERY before the Engineer could ship a DEMA** — the
loop never reached DEMA-correctness, no branch shipped, the operator's real repo was never touched.
This is the rung-2 FINDING (§C3.ii): the proven NIM-70b / OpenHands-docker agent path does not scale
from the tiny rung-1 fixture to a **264-file real multi-component repo**.

## In Progress
Nothing — the harness is committed + all HARNESS gates green; the rung-2 live result is a recorded
FINDING (NEEDS_HUMAN below). Awaiting the architect's machinery decision (the harness itself is ready
to FF-merge).

## RUNG-2 FINDING — the recorded result (evidence on disk + in the /goal transcript)
- **The real repo is far larger than the brief's "indicator library" framing.** The clone is **264
  tracked files** on `main` @ `4691064f`: `core/` (the indicator library — the DEMA target) PLUS
  `servers/` MCP servers PLUS a whole `web/` Next.js dashboard (`web/app/dashboard/**/error.tsx`,
  `web/lib/pyodide/**`, …). The DEMA target is trivial; the SURROUNDING repo size defeats the agent's
  exploration.
- **Attempt 1** (run_id `c6ec456a-8cba-4198-a74a-f358ee8319ed`): the Engineer (NIM
  `llama-3.3-70b`, 128k window) **overflowed the model context** while exploring the 264-file repo —
  `openai.BadRequestError 400: maximum context length is 131072 tokens, your request has 132790
  input tokens` (1718 over, ~1.3%). It errored BEFORE editing `core/indicators.py`; the Reviewer
  never ran (`reviewer outcomes = []`). `run.status = failed`, no branch.
- **Attempt 2** (run_id `587b724f-fa19-49a0-9a7a-6d69442a72b6`): NO context overflow this time; the
  Engineer built something and the **Reviewer ran once (`changes_requested`)**, then the rework round
  died on `run_team agent node failed … Conversation run failed … **Remote conversation got stuck**`
  (`team_run.py:1037`; an OpenHands remote-conversation hang in the container). `run.status =
  failed`, no branch.
- **Both attempts**: `def dema` absent, the independent numeric gate + the `tests/test_indicators.py`
  count-tripwire gate correctly SKIPPED (no branch to check), shipped `core/indicators.py` diff =
  **empty**, clone HEAD unchanged (`4691064f → 4691064f`), operator's real `trade_mcp` untouched (0
  `tvashtr/*` branches leaked). Two attempts → two DISTINCT machinery failure modes (context
  overflow; remote-conversation-stuck), both rooted in the 264-file repo size — NOT in DEMA
  correctness, which the loop never reached.

## The harness is PROVABLY CORRECT (it MERGES — the durable artifact; this FINDING is its first result)
Across both runs the driver: honored its clean-skip guards; `git clone --local` the real repo into a
tempdir; `POST /api/repo/inspect` (asserted is_git / branch=main / 264 tracked files); `POST
/api/runs {review_loop, idea=§B verbatim, repo_path=clone, base_ref=main}`; polled to terminal
(`workflow=SUCCESS run=failed`); correctly detected `shipped=False` and SKIPPED the verify venv;
printed a clean `RUNG-2 FINDING` summary + the (empty) diff; cleaned up worktrees + clone + workspace
in `finally`. A separate **baseline plumbing dry-run PROVED the verify path works**: clone → venv →
`pip install -e ".[dev]"` (rc 0 in 12s) → `tests/test_indicators.py` **127 passed** at the pristine
28-indicator baseline. So the numeric gate + the suite gate are sound and fire the moment a run ever
ships a branch.

## What I did NOT do (per §C3/§C4 — doing any of these corrupts the test)
NOT hand-edit/ship a DEMA, NOT prompt-tune the model, NOT patch the agent's output, NOT rework the
grounding / `WORKER_PROTOCOL` dep-install nudge / executor / model choice to force the check green.
The gap (a 128k-context 70b + OpenHands-docker cannot traverse a 264-file real repo to land a
1-function change) is a PRODUCT-machinery limitation for the architect (§C4 → STOP + NEEDS_HUMAN).
Candidate resolutions for rung 2 (architect's call): a larger-context agent model; sub-path / scoped
repo mounting so the agent isn't handed a 264-file surface for a `core/indicators.py` change; or
agent-side context management.

## Deliverable (the mergeable artifact — branch `feat/brownfield-rung2`)
- `scripts/trade_mcp_rung2_check.py` (new) — the rung-2 live proof driver, modeled on
  `brownfield_loop_check.py`: clean-skip → clone the real repo → `review_loop` with the §B verbatim
  DEMA idea → poll to terminal → (on ship) isolated verify venv + the INDEPENDENT numeric check
  (`compute("dema") == 2*EMA-EMA(EMA)` within 1e-8 on a non-constant series, ≥2 lengths) + registry
  presence + `tests/test_indicators.py` green + tree-untouched → PASS/FINDING + shipped diff →
  cleanup in `finally`. All `tvashtr`/app imports lazy inside `main()` (offline collector never
  imports it).
- `Makefile` — `make brownfield-rung2` (opt-in; **NOT** in `make test`) mirroring `brownfield-loop-check`
  + a safe `TVASHTR_RUNG2_REPO ?= /Users/adimac/Desktop/trade_mcp` default + `.PHONY`.

## Calibration decision (evidence-bound plumbing, §C4) — recorded
The driver's "existing suite green" gate is scoped to **`tests/test_indicators.py`** (proven green at
baseline: 127 passed; carries the 28→29 count tripwire + every indicator test), NOT the whole
`pytest -q`. EVIDENCE: a PRISTINE clone's whole `pytest -q` is ALREADY RED offline — 3 collection
errors in `servers/kline_cache/tests/` + 1 failure in `tests/test_engine_facts_pinning.py`, all
`No module named 'fastapi'` (fastapi is NOT a declared trade_mcp dependency) — pre-existing and
unrelated to DEMA. A whole-suite gate would FINDING on every run regardless of DEMA correctness. The
whole `pytest -q` is still RUN + RECORDED as an OBSERVATION.

## Setup notes (NOT committed; reversible)
- **`.env` (gitignored)**: the live run needs the operator's BYOK keys active (imported into the
  operator account by `login_operator → seed.main()` at run time). M-accounts Slice C had commented
  out all provider keys (the offline `.env`-free posture). I uncommented `NVIDIA_BUILD_API_KEY`
  (Engineer/Reviewer = `nvidia_nim/meta/llama-3.3-70b-instruct`) and `OPENAI_API_KEY` (PM =
  `DEFAULT_MODEL=openai/gpt-4o-mini`) — exactly the rung-1 `brownfield-loop-check` config.
  OpenRouter/Gemini/Groq stay commented (unused; OpenRouter exhausted). `.env` is gitignored (never
  committed); original backed up in the job tmp.
- **`make agent-smoke` is STALE under M-accounts BYOK** (observation for the architect): it passes no
  per-owner api_key, so `agent_llm_routing` raises `ValueError: proxy-OFF agent routing requires a
  per-owner api_key (BYOK)` BEFORE any NIM call — a script-staleness gap, NOT NIM-dead, and
  `scripts/smoke_agent.py` is OUT of this slice's edit scope (left untouched). NIM liveness (§C1) was
  instead confirmed by a direct litellm probe with the exact agent slug:
  `nvidia_nim/meta/llama-3.3-70b-instruct → 'pong'` in 11.6s (key live, not dead/throttled); PM model
  `openai/gpt-4o-mini → 'pong'` in 2.5s.

## Gate results — decisive lines echoed into the /goal transcript
- `make test` — **`316 passed, 1 warning in 17.10s`** (no regression; the live driver is NOT in the
  offline suite). alembic head **`0017_ownership_and_credentials (head)`** (no migration).
- `make lint` — ruff **`All checks passed!`** + `124 files already formatted` + eslint clean +
  prettier **`All matched files use Prettier code style!`**.
- NIM probe — **`NIM_LIVE ok in 11.6s -> 'pong'`**; PM probe — **`PM_LIVE ok in 2.5s -> 'pong'`**.
- `make brownfield-rung2` — **`RUNG-2 FINDING`** on BOTH attempts (run.status=failed, no branch,
  empty `core/indicators.py` diff): attempt 1 = context overflow (132790 > 131072 tokens); attempt 2
  = "Remote conversation got stuck" after one `changes_requested`.

## Test Count
**316 backend pytest** + **165 vitest** — unchanged (this slice adds no offline tests; the driver is a
live proof harness like `brownfield_loop_check.py`). — 2026-06-29.

## Invariants held (checkable on disk)
- NO migration (head `0017`; freeze `0001`–`0017` unchanged; no `0018`). NO schema change. NO FE change.
- NO product-code change: `git diff main -- backend/` is EMPTY; `team_run.py` / `worktree.py` /
  `teams.py` / the engines / the `EngineAdapter` seam / `build_two_node_team` byte-unchanged. The only
  changed/new paths are `scripts/trade_mcp_rung2_check.py` + the `Makefile` target.
- Operator's real `trade_mcp` NEVER touched (runs operate only on the tempdir clone; 0 `tvashtr/*`
  branches leaked; clone + venv + workspace cleaned up in `finally`).
- Never pushed; branch-per-step (`feat/brownfield-rung2`); operator FF-merges. `prompts/*.md`,
  `PROJECTPLAN.md`, `HANDOVER.md` left untouched/untracked.

## Open Questions
- Rung-2 machinery gap → OPEN (architect): the proven NIM-70b / OpenHands-docker path cannot complete
  a 1-function change on a 264-file real repo (context overflow / remote-conversation-stuck). Pick a
  rung-2 resolution (larger-context model / scoped mount / context management) then re-run
  `make brownfield-rung2` (the harness is ready).

## Blocked
NEEDS_HUMAN: rung-2 result — the proven NIM-70b / OpenHands-docker brownfield path could not ship a
DEMA into the 264-file real `trade_mcp` repo; BOTH attempts ERRORed on machinery before
DEMA-correctness (attempt 1: context-window overflow 132790>131072; attempt 2: "Remote conversation
got stuck") — no branch shipped, clone untouched. The harness (driver + `make brownfield-rung2`) is
provably correct and MERGES; the machinery gap is the recorded finding for the architect. See the
RUNG-2 FINDING block above. (Branch `feat/brownfield-rung2`; 316 backend / 165 vitest unchanged; lint
clean.)
