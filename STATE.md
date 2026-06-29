# Tvashtr — Autonomous Execution State

## Current Milestone
Milestone B (Tvashtr-39) — BYOK agent-loop rate-limit robustness (the retry envelope) +
the brownfield thesis verdict.

## OUTCOME — offline fix SHIPPED (READY_TO_MERGE) + live thesis run = outcome (c) THROTTLE-FINDING (GOAL MET)
The config-only BYOK retry-envelope fix is **GREEN + COMMITTED** (`3ad4d9d`) — the merge artifact,
complete regardless of the live run. The live Kimi thesis run is a CLEAN, VALID **outcome (c)**: the
widened envelope **demonstrably WORKED** — the loop rode out 8x NIM 429s and got all the way to a
**REVIEWER `approved`** of a correct, registered DEMA (far past where the Tvashtr-38 runs crashed) —
but one final SUSTAINED 429 window exhausted even the 8x120s envelope at ~14.5 min and crashed the
conversation BEFORE the ship step persisted the branch, so the INDEPENDENT numeric gate never ran
(`shipped a branch: False`). A throttle/quota wall, NOT a model-capability or wiring fault. Per brief
B §4 this is goal-met; re-run after a NIM quota reset (optionally bump the env knobs) to land the verdict.

## Last Completed Step
feat/byok-retry-envelope — 2026-06-29 — branch: feat/byok-retry-envelope — commit: 3ad4d9d

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/byok-retry-envelope, sha=3ad4d9d, tests=328 backend passing (+4 over the
324 floor), lint clean, alembic head 0018 (no migration). FE untouched (vitest floor 165 intact).

## The change (config.py ONLY — one chokepoint)
- Two env-overridable `Settings` fields: `agent_num_retries` (default 8, `TVASHTR_AGENT_NUM_RETRIES`)
  + `agent_retry_max_wait_s` (default 120, `TVASHTR_AGENT_RETRY_MAX_WAIT`), matching the
  `agent_sandbox_mode` AliasChoices pattern.
- Carried as `num_retries` + `retry_max_wait` on the proxy-OFF (BYOK) branch of `agent_llm_routing`
  ONLY; they splat into the OpenHands `LLM` and SERIALIZE into the in-container agent-server (docker
  path inherits them). 8 x 120s ~= a ~10-min worst-case wait-out per call, sized vs the rung-2 2400s poll.
- Proxy-ON branch byte-identical (NO retry keys — protects the budget-429 latency).
- No dependency, no migration (head stays 0018); `engines/` + `team_run.py` byte-untouched.

## Offline hard gate (GREEN + COMMITTED `3ad4d9d`)
- `make test` -> **328 passed in ~18s** (floor 324 + 4 new). `make lint` -> `All checks passed!` +
  `All matched files use Prettier code style!`. alembic head still **0018**.
- New tests: BYOK carries 8/120 (local+docker, exact-shape guard); proxy-ON OMITS both; env override
  re-tunes; the values land on a real constructed `LLM` (`llm.num_retries==8`, `llm.retry_max_wait==120`).
  Updated 4 existing M-accounts BYOK-shape tests for the new dict keys (`test_proxy_config` x2,
  `test_proxy_adapter_wiring` x2) — a contained, code-proven ripple of the new contract.

## Live thesis run — outcome (c) (the fix helped; the verdict is still throttle-blocked today)
- **Probe (STEP 1):** `PROBE nvidia_nim/moonshotai/kimi-k2.6 attempt1: OK content='pong' (reasoning_len=0)`
  — usable; no self-heal needed (the /goal-named `kimi-k2.6` is the live id).
- **Model verify (STEP 3, run `63aef0d7-…`):** ENGINEER + REVIEWER = `nvidia_nim/moonshotai/kimi-k2.6`,
  PM = `openai/gpt-4o-mini`, `run.subpath = core` — NO silent 70b fallback.
- **Run `63aef0d7-ec62-46e9-9aec-e296266ea8d9`:** `run.status=failed`, `shipped a branch: False`,
  `(no diff on core/indicators.py)`. 8x `Too Many Requests` / 9x `RateLimitError` ridden out; 93
  indicators.py edits; the in-container code was CORRECT + REGISTERED (`"dema": IndicatorSpec`,
  `2 * ema1 - ema2`, `ewm(span=length, adjust=False).mean()`); the REVIEWER **`approved`** it once —
  THEN one sustained 429 -> `ConversationRunError` (`Nvidia_nimException - Error code: 429 - Too Many
  Requests`) crashed the conversation at ~14.5 min, before the ship step. The numeric gate is
  `(not run — no branch)`.
- Same 429 wall as Tvashtr-38, but the fix pushed survival from a 2-edit/5-429 crash to a full
  Engineer->correct-DEMA->Reviewer-APPROVED cycle. PASS vs gate-ran-FINDING needs a non-throttled
  window — recommend a re-run after a NIM quota reset (the harness + the fix are ready).

## Invariants held (checkable on disk)
- `git diff main -- backend/tvashtr/engines/` EMPTY; `… control_plane/team_run.py` EMPTY; `… frontend/` EMPTY.
- alembic head `0018` (migration freeze not bumped — this slice adds none).
- proxy-ON branch returns NO retry keys (`test_proxy_config::test_proxy_on_branch_omits_the_retry_envelope`).
- `build_two_node_team` + the `EngineAdapter` seam untouched.
- `.env` `TVASHTR_AGENT_MODEL` reverted to `nvidia_nim/meta/llama-3.3-70b-instruct` (gitignored;
  restored from backup; secret VALUES never echoed). DBOS `PENDING=0` (surgical, no `down -v`).
- Architect docs (`PROJECTPLAN.md`, `HANDOVER.md`, `prompts/CLI-RULES.md`, `prompts/*.md`) left
  uncommitted / untouched; only my own paths committed.

## Test Count
**328 backend pytest** (+4 over the 324 floor) + **165 vitest** (FE untouched) — 2026-06-29.

## Blocked
None — goal met: the offline gate is green + committed AND a live outcome (c) is recorded with the
§4.7 FINAL REPORT. The brownfield thesis VERDICT (PASS vs gate-ran-FINDING) remains one re-run away —
architect: re-run rung-2 with `kimi-k2.6` (scope=core) after a NIM quota reset; the fix + harness are ready.
