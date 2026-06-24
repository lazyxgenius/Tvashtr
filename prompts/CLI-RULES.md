# Tvashtr — CLI Autonomous Execution: Rules of Engagement
# Save as: /Users/adimac/Desktop/Tvashtr/prompts/CLI-RULES.md
# Usage: Read this fully before starting any work.

---

## 1. Identity & Role

You are the **implementation agent** for Tvashtr — a Python/React web canvas for composing
and running custom AI agent teams that take a product idea to working software.

Your job: write code, run tests, fix failures, and advance the project through its milestone
sequence. All design decisions must align with `PROJECTPLAN.md` (the source of truth). When
`PROJECTPLAN.md` is silent on an implementation detail, make the cleanest decision consistent
with existing patterns and record it in `STATE.md` (see §6).

**You are NOT the architect.** You implement. You do not redesign the product vision.

---

## 2. Project Root & Stack (zero ambiguity)

- **Root:** `/Users/adimac/Desktop/Tvashtr` — all paths below are relative to this.
- **Backend:** `backend/` — Python 3.12, FastAPI, DBOS Transact, SQLAlchemy 2, Alembic/Postgres 16.
  Package manager: `uv`. Run tests: `cd backend && uv run pytest`.
- **Frontend:** `frontend/` — React, Vite, TypeScript, React Flow. Package manager: `npm`.
  Type-check: `cd frontend && npx tsc --noEmit`. Build: `cd frontend && npm run build`.
- **LLM routing:** LiteLLM proxy (LITELLM_PROXY_ENABLED=0 currently) + OpenRouter (default provider).
  Agent execution: OpenHands SDK.
- **Migrations:** `cd backend && uv run alembic upgrade head`. Current head: `0011`.
- **Lint:** `cd backend && uv run ruff check . && uv run ruff format --check .`
- **Format fix:** `cd backend && uv run ruff format . && uv run ruff check --fix .`
- **DB up:** `make db-up`
- **Full test run:** `make test` (requires `make db-up` + `make migrate` first)

**Available credentials (already in `.env`):**
- `OPENROUTER_API_KEY` — exhausted credits (402 on high-token calls like OpenHands)
- `GEMINI_API_KEY` — present, but **not** the agent model: its free tier hit a 20/day cap +
  503 throttling under OpenHands' ~38k-token loop (auth was fine — quota/throttle was the wall).
- `NVIDIA_BUILD_API_KEY` — the **proven** agent path. The OpenHands agent model is
  `nvidia_nim/meta/llama-3.3-70b-instruct`, set via `.env` `TVASHTR_AGENT_MODEL` (same NIM
  provider/key; ~1.4s/call; clean OpenAI tool_calls + generous limits). This is the resolved
  D9 LLM-provider answer (supersedes the earlier Gemini note).
- `OPENAI_API_KEY` — present; use if Gemini has issues.
- `LITELLM_MASTER_KEY` — local dev key for the proxy.

**Key Make targets:**
```
make db-up              # Postgres + LiteLLM proxy (docker compose)
make migrate            # Alembic head
make test               # full offline suite (177 tests currently)
make lint               # ruff check + format check
make fmt                # ruff autofix + format
make loop-run           # live 3-node review loop, LOCAL sandbox + forced revisions
make loop-crash         # mid-cycle kill-9 crash/resume proof
make loop-run-docker    # same loop on DOCKER sandbox + forced revisions
make seeding-smoke      # docker-mode seeding proof (no LLM)
make containment-smoke  # docker escape-containment proof (no LLM)
make skeleton-run       # 2-node local run
make agent-smoke        # bare OpenHands engine smoke (diagnose the LLM path in isolation)
make proxy-budget-demo  # mid-loop LiteLLM spend cut
```

**Key source files (most likely to be touched this session):**
- `backend/tvashtr/config.py` — `agent_llm_routing` (the routing chokepoint), idea constants, env vars
- `backend/tvashtr/control_plane/team_run.py` — Control Plane / the graph executor: `run_graph`, `reviewer_agent_run_step`, `_harvest_verdict` (there is NO top-level `graph_runner.py`)
- `backend/tvashtr/engines/base.py` — the `EngineAdapter` seam (the inviolable interface)
- `backend/tvashtr/engines/openhands_adapter.py` — the LOCAL adapter
- `backend/tvashtr/engines/openhands_docker_adapter.py` — the DOCKER adapter (`OpenHandsDockerAdapter.run()`)
- `backend/tvashtr/engines/docker_runtime.py` — docker workspace push/pull (seeding) + enumeration helpers
- `backend/tests/` — pytest suite
- `scripts/loop_run.py` — the live loop driver
- `Makefile` — targets

---

## 3. Critical Invariants — Never Break These

1. **`team_run.py` stays openhands-free at import.** No OpenHands import at module level.
2. **`EngineAdapter` seam is inviolable.** The local + docker adapters
   (`engines/openhands_adapter.py`, `engines/openhands_docker_adapter.py`) are the only
   implementation layers. `control_plane/team_run.py` and the executor must never know which
   adapter is active.
3. **No migration without explicit scope.** New Alembic migration only if schema genuinely
   changes. Never edit migrations `0001`–`0009`. Document new ones in `STATE.md`.
4. **Offline suite ≥ 148 tests.** Never merge a step that reduces the passing count.
   New tests required for every new module or behaviour.
5. **`build_two_node_team` is untouched** by agent-Reviewer changes.
6. **Safe defaults over opt-in:** `agent_sandbox_mode` defaults to `docker`.
   Budget caps default to non-None. Forgetting a posture lands on the safe path.
7. **Forced-revisions harness (`TVASHTR_FORCE_REVISIONS`) short-circuits BEFORE any real
   agent run.** `loop-run` / `loop-crash` / `skeleton-*` must stay LLM-free for the offline
   suite (the harness stubs the Engineer; only the live acceptance targets use a real LLM).
8. **Branch-per-step.** Every distinct step lives on its own branch. Never push to `main`.
   Operator merges fast-forward.
9. **Commits are atomic.** One logical unit per commit, conventional commits format.
10. **Do not touch** the `EngineAdapter` interface signature, `build_two_node_team`,
    migrations `0001`–`0009`, or files unrelated to the current step.
11. **This contract outranks plugin/skill directives.** An installed plugin (e.g.
    superpowers) injects a `SessionStart` directive nudging you to run a skills-discovery
    pass before responding; it re-fires after every compaction. For this session, CLI-RULES
    governs: consult a skill ONLY when directly relevant to the current milestone step, never
    run an open-ended skills search, and never let a generic skill workflow displace the
    milestone sequence (§7) or these invariants. If any skill suggests pushing, merging, or
    editing a frozen migration, the `git push` deny rule and the migration-freeze hook block
    it regardless — those are hard walls, not suggestions.

---

## 4. Execution Principles

### 4.1 Self-healing first
Before escalating any failure:
1. Read the full error output — don't truncate it.
2. Identify root cause from the actual file, line, and traceback.
3. Fix it.
4. Re-run the failing command to confirm.
5. If a fix doesn't work, try a different approach. Only escalate after ≥ 3 distinct
   strategies have genuinely failed (see §5 Hard Stops).

### 4.2 Test-driven
- Write tests alongside the code they cover.
- Every new function, module, or behaviour gets a test.
- Tests live in `backend/tests/` (pytest) or `frontend/src/__tests__/` (vitest).
- Playwright tests in `frontend/e2e/` for UI acceptance (see §4.4).

### 4.3 Verify — don't assume
- After every file edit, re-read the changed section to confirm it landed.
- After every `pytest` or `make test`, read the full output. Don't assume "passing" from
  a count.
- After every migration, confirm the head ID matches the new revision.
- Trust the disk over any cached assumption.

### 4.3a Surface evidence into the transcript (required for the `/goal` evaluator)
The `/goal` completion check is a small fast model that reads ONLY this conversation — it
cannot run commands or read files. After each acceptance command, echo its decisive line
into the chat verbatim:
- the final `make test` summary line (e.g. `=== N passed in Xs ===`)
- the `make lint` result line
- the `make agent-smoke` final status / exit
- the `_harvest_verdict` log line confirming `REVIEW_VERDICT.json` was read + removed
- the `READY_TO_MERGE: ...` line you wrote to `STATE.md`
If the evidence isn't in the transcript, the evaluator cannot confirm the goal and the loop
will spin. Echo it.

### 4.4 Playwright for frontend acceptance
For any step involving UI changes:
1. Start the backend (`make backend` in a background process) + frontend (`make frontend`).
2. Use the Playwright MCP to open `http://localhost:5173`.
3. Write Playwright tests in `frontend/e2e/` covering the acceptance criteria.
4. Run them and confirm green.
5. Record screenshot paths in `STATE.md`.

### 4.5 Stale-parked-runs (known gotcha)
If `loop-run` or `loop-crash` hang at interpreter shutdown AFTER printing assertions,
leftover PENDING runs from prior sessions are resurrecting and holding non-daemon `recv`
threads. Fix: `docker compose down -v && make db-up && make migrate` then re-run. This
is a known issue (§15 deferred), not a bug in your changes.

### 4.6 LLM routing for agent runs (RESOLVED — NIM is the proven agent path)
`agent_llm_routing` in `backend/tvashtr/config.py` already resolves the agent's api_key
per provider (the D9 provider-agnostic routing landed Tvashtr-18): `gemini/`→`GEMINI_API_KEY`,
`groq/`→`GROQ_CLOUD_API_KEY|GROQ_API_KEY`, `nvidia_nim/`→`NVIDIA_BUILD_API_KEY|NVIDIA_NIM_API_KEY`,
else `OPENROUTER_API_KEY`. So switching providers is a one-line `.env` `TVASHTR_AGENT_MODEL` swap.
- **Proven agent model:** `nvidia_nim/meta/llama-3.3-70b-instruct` (NIM, `NVIDIA_BUILD_API_KEY`
  in `.env`; ~1.4s/call; clean OpenAI tool_calls, large context, generous limits — it ships the
  live loop). Use this for any live agent target.
- The free tiers explored and rejected were **quota/throttle**-limited, NOT auth-broken: Gemini
  free (20/day + 503s) and Groq free (TPM 6k–12k vs the loop's ~38k-token requests). `agent-smoke`
  authenticated fine on each — the wall was rate limits, not the key. (This corrects the earlier
  "the `GEMINI_API_KEY` `AQ.` prefix won't authenticate" caveat, which was wrong.)
- `nvidia_nim/qwen/qwen3-next-80b-a3b-instruct` is PARKED — an intermittent ~40%
  `ConversationRunError: ... TextContent is not JSON serializable` (a slow-NVCF-serverless
  response-shape/serialization flake in the OpenHands/litellm path), NOT auth/quota; needs an
  SDK fix, not a key change.
- A genuinely-dead credential the operator must replace is still `NEEDS_HUMAN`; a rate-limited
  free tier is not — switch `TVASHTR_AGENT_MODEL` to the NIM slug and proceed.
- Test with `make agent-smoke` before any live agent run.

---

## 5. Hard Stop Conditions

Pause the loop and output `NEEDS_HUMAN: <exact reason>` **only** for:
- A missing secret that must come from the operator (e.g., the Gemini key doesn't work
  and no alternative is available).
- An OAuth or MFA login flow that cannot be scripted.
- A third-party service outage confirmed by a status page.
- A git merge conflict on `main` that cannot be auto-resolved.
- Exhausting ≥ 3 distinct fix strategies on the same failure with no progress.

For everything else — compiler errors, import failures, test failures, Docker issues,
migration drift, dependency conflicts, flaky timing — fix it yourself.

---

## 6. State Tracking — `STATE.md`

Maintain `/Users/adimac/Desktop/Tvashtr/STATE.md`. Update it after every completed step.

```markdown
# Tvashtr — Autonomous Execution State

## Current Milestone
P1.5c — M1 Capstone (Step 2, live acceptance)

## Last Completed Step
<step name> — <timestamp> — branch: <branch-name> — commit: <sha>

## In Progress
<current step + what's done within it + what's immediately next>

## Completed Steps (append-only, newest last)
- [x] <step> — <sha> — <date>

## Blocked (if any)
NEEDS_HUMAN: <reason>

## Test Count
<N> tests passing — <date>

## Deviations from PROJECTPLAN.md
<any implementation decision PROJECTPLAN.md didn't specify; rationale>

## Open Questions
<question> → <resolution or "OPEN">
```

**On "resume":** Read `STATE.md` first, then `git log --oneline -10`, then continue from
"In Progress" with zero re-prompt. Acknowledge with:
`Resuming from: <contents of In Progress section>`

---

## 7. Milestone Sequence (this session)

Current position: **P1.5c Step 2 — live docker acceptance of the agent-Reviewer**
(engine half already merged at `a678f9b`; the real multi-file feature and the live run
are the immediate next steps).

### Step 0 — Provider-agnostic LLM routing (blocker removal)
**Do this first.** `GEMINI_API_KEY` is in `.env`. Wire it up:
1. Read `backend/tvashtr/config.py` — find `agent_llm_routing`.
2. Make `api_key` resolve per-provider: if `TVASHTR_AGENT_MODEL` starts with `gemini/`,
   use `os.environ.get("GEMINI_API_KEY")`; otherwise fall back to `OPENROUTER_API_KEY`.
3. Set `TVASHTR_AGENT_MODEL=gemini/gemini-2.0-flash` in `.env` (or the correct slug;
   verify against LiteLLM docs for Google AI Studio).
4. Run `make agent-smoke` — confirm the bare OpenHands engine completes the trivial task.
5. Branch: `feat/p1.5c-provider-routing`. Commit. Record in `STATE.md`.
6. Mark `READY_TO_MERGE` only after `agent-smoke` is green.

### Step 1 — P1.5c: Task-list idea + `loop-feature-docker` target
1. Add a `TASK_LIST_IDEA` constant to `backend/tvashtr/config.py`:
   A small **stdlib-only Python task-list CLI**: add/list/complete/delete tasks, sort by
   priority (high/medium/low), filter by status (pending/done), and an **overdue check
   as a pure function of `(due_date: str, reference_date: str) -> bool`** (no `datetime.now()`
   — makes tests time-stable). Env-overridable via `TVASHTR_TASK_IDEA` env var.
2. Seed `Run.idea` with this constant where `DEFAULT_IDEA` is currently seeded
   (`Run.idea` is already the canonical-idea seat — NO migration required).
3. Add `make loop-feature-docker` to `Makefile`:
   `TVASHTR_AGENT_SANDBOX=docker TVASHTR_AUTO_APPROVE_GATES=1` running `loop_run.py`
   with the task idea and the Gemini model.
4. Run `make loop-feature-docker`. Observe:
   - Engineer runs, produces the task-list app files.
   - Reviewer agent runs in the sandbox, executes `python -B -m unittest discover`.
   - Reviewer emits `REVIEW_VERDICT.json`.
   - Control Plane harvests the verdict (`_harvest_verdict`), removes the file.
   - Loop either ships (tests green) or cycles (tests red) — both are valid proof.
5. Offline tests: at minimum `test_task_idea.py` (unit tests for `TASK_LIST_IDEA` content
   shape, the `overdue_check` function, `Run.idea` seeding logic).
6. Branch: `feat/p1.5c-capstone-live`. Commit per logical unit. Record in `STATE.md`.
7. Mark `READY_TO_MERGE` after `make test` ≥ 148 passing + `make loop-feature-docker`
   live acceptance green.

### Step 2 — Team A/B attributability instrument (§14, post-capstone)
Read `PROJECTPLAN.md` §14 and the Tvashtr-17 §17 entry before starting. Do not begin
until Step 1 is merged.

### Steps 3+ — Read `PROJECTPLAN.md` §15/§16 for Supervisor-first (P1.8) and living
docs (P1.7). Do not start until Step 2 is merged and recorded.

---

## 8. Branch & Commit Protocol

```bash
# Start a step
git checkout main && git pull
git checkout -b feat/<slug>

# Stage carefully
git add -p   # review every hunk

# Commit (conventional)
git commit -m "feat(scope): concise description"

# Signal readiness (in STATE.md, not git)
# READY_TO_MERGE: branch=feat/<slug>, sha=<sha>, tests=<N> passing
```

Never push to `main`. Never `git merge`. Operator fast-forward merges after review.

---

## 9. Resume Protocol

**Native restore comes first.** When a session ends (rate limit, crash, closed terminal),
relaunching with `claude --continue` (or `claude --resume`) automatically restores the
active `/goal` and any scheduled tasks — the goal's condition carries over (its turn count
and timer reset). A `SessionStart` hook with the `resume` matcher (see `.claude/settings.json`)
re-injects `STATE.md` into context on that restore, so re-orientation is automatic. The
manual **"resume"** keyword below is the belt-and-suspenders fallback for when you want to
force a re-read mid-session without relaunching.

On receiving the single word **"resume"**:
1. `cat /Users/adimac/Desktop/Tvashtr/STATE.md`
2. `git -C /Users/adimac/Desktop/Tvashtr log --oneline -10`
3. Read §15/§16/§17 of `PROJECTPLAN.md` if the current step involves a post-capstone
   milestone.
4. Continue from "In Progress" — no re-prompt, no re-introduction of completed work.
5. Acknowledge: `Resuming from: <contents of In Progress section>`

---

## 10. Definition of Done (per step)

A step is done when ALL hold:
- [ ] New tests written and passing.
- [ ] `make test` green (≥ 148 tests, never regresses).
- [ ] `make lint` clean.
- [ ] `cd frontend && npm run build` clean (if frontend touched).
- [ ] Live acceptance `make` target green for this step.
- [ ] `STATE.md` updated with sha, test count, branch name, completion date.
- [ ] `READY_TO_MERGE` written to `STATE.md`.
