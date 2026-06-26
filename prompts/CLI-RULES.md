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
- **Migrations:** `cd backend && uv run alembic upgrade head`. Current head: `0014`.
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
make test               # full offline suite (239+ tests; confirm the live count at session start)
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
*(A `/goal` for a UI slice also adds its own live acceptance target, e.g. `make work-brief-e2e`, `make topology-e2e`, `make steering-e2e`.)*

**Key source files (most likely to be touched this session):**
- `backend/tvashtr/config.py` — `agent_llm_routing` (the routing chokepoint), idea constants, env vars
- `backend/tvashtr/control_plane/team_run.py` — Control Plane / the graph executor: `run_graph`, `reviewer_agent_run_step`, `_harvest_verdict`, `clone_team_graph` (there is NO top-level `graph_runner.py`)
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
   changes. Never edit migrations `0001`–`0014` (ALL existing migrations are frozen; the
   `protect-migrations.sh` PreToolUse hook blocks edits to them even under bypass — create a
   NEW migration `0015`+ instead, and bump the hook's freeze regex as the LAST step). Document
   new ones in `STATE.md`.
4. **Offline suite never regresses** — **239+** backend pytest + **114+** vitest (the M1/M2
   baseline; confirm the live count with `make test` at session start). Never merge a step that
   reduces either passing count. New tests required for every new module or behaviour.
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
    migrations `0001`–`0014`, or files unrelated to the current step.
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
- Tests live in `backend/tests/` (pytest) or **co-located `*.test.ts(x)` next to the source**
  (vitest + React Testing Library; the jsdom env + `frontend/src/test/setup.ts` provide jest-dom
  matchers + the React Flow shims — see HANDOVER §4).
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
- the live acceptance target's final status / exit (e.g. `make work-brief-e2e`, the
  `make agent-smoke` status, or the slice's own `*-e2e` target)
- the `READY_TO_MERGE: ...` line you wrote to `STATE.md`
If the evidence isn't in the transcript, the evaluator cannot confirm the goal and the loop
will spin. Echo it.

### 4.4 Playwright for frontend acceptance
For any step involving UI changes:
1. Start the backend (`make backend` in a background process) + frontend (`make frontend`).
2. Use the Playwright MCP to open `http://localhost:5173`.
3. Write Playwright tests in `frontend/e2e/` covering the acceptance criteria.
4. Run them and confirm green. **Note (HANDOVER §4):** `browser_snapshot` (the full a11y
   tree) HANGS on the large editable React Flow canvas — use targeted `browser_evaluate` on
   specific selectors + screenshots, or the scripted headless-Playwright fallback, NOT a
   whole-tree snapshot.
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
- A missing secret that must come from the operator (e.g., the agent model's API key is
  genuinely DEAD and no alternative provider is available). A rate-limited/throttled free
  tier is NOT this — switch `TVASHTR_AGENT_MODEL` to the proven NIM slug (§4.6) and proceed.
- An OAuth or MFA login flow that cannot be scripted.
- A third-party service outage confirmed by a status page.
- A git merge conflict on `main` that cannot be auto-resolved.
- Exhausting ≥ 3 distinct fix strategies on the same failure with no progress.
- **A second/unknown problem that would need a broad or unproven change** to fix — STOP and
  write `NEEDS_HUMAN`. (A code-proven, contained, regression-guarded fix to a SINGLE identified
  cause may proceed.)

For everything else — compiler errors, import failures, test failures, Docker issues,
migration drift, dependency conflicts, flaky timing — fix it yourself.

---

## 6. State Tracking — `STATE.md`

Maintain `/Users/adimac/Desktop/Tvashtr/STATE.md`. Update it after every completed step.

```markdown
# Tvashtr — Autonomous Execution State

## Current Milestone
M-brownfield — local-execution / "work on a real local folder" run mode

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

## 7. Milestone Sequence (current)

**Position: Phase 1 is COMPLETE (P1.1–P1.8d shipped + merged); the Tvashtr-25 prompt-driven
pivot is fully realized; the active bet is now M-brownfield (Phase 1.5 — local execution →
"work on a real local folder" run mode), per the Tvashtr-31 strategic pivot.** The architect
scopes each milestone into ONE lean `/goal` (often pointed at a detailed `prompts/<name>.md`
brief) and audits the result on disk; you self-decompose and RUN every gate to green yourself.
**When the architect has written a `prompts/` brief for the current milestone, that brief
SUPERSEDES this section for that run.**

### Done — do NOT re-do (context only)
- **P1.5** — the cyclic PM→Engineer⇄Reviewer review loop (5a executor + crash-resume; 5b
  gates/terminals-as-nodes + the Tasks-for-Human drawer; 5c the real agent-Reviewer capstone —
  M1 proven).
- **§14** — the team A/B "which config ships better" attributability instrument (14.1 verdict
  view → 14.2 pair/launch → 14.3 comparison view).
- **P1.7** — live-document steering (J3): the in-flight PRD is the source of truth (P1.7a backend
  re-source + P1.7b the human-editable TipTap editor; proven by `make steering-e2e`).
- **FE-infra** — ESLint (type-checked) + Prettier + a protective RTL suite + `scripts/` in the
  ruff gate; `make test-frontend`/`build-frontend`; `make lint`/`fmt` cover FE.
- **The Tvashtr-25 PIVOT (P1.8a–d) — fixed-function role nodes RETIRED for a prompt-driven node
  model.** Every node = `prompt` (its whole identity) + `capability` (thinker=`completion` /
  worker=`agent`, on the existing `kind`) + `model`; the executor runs `node.prompt` generically
  and routes on the AUTHORED topology (generic outcome labels matched by `Edge.conditions {when}`;
  the reviewer loop-back is a no-`when` catch-all). `teams.py` builders are an editable TEMPLATE
  library; the old "Supervisor" survives ONLY as an optional generator, never a runtime node.
  Shipped: P1.8a backend core (mig `0012`) · P1.8b editable team + clone-on-launch + team library
  (mig `0013` `is_library`) · P1.8c the generic thinker node + capability authoring + `thinker_chain`
  · P1.8d canvas topology editing (node/edge CRUD + `validate_graph`).
  **⚠️ "Supervisor-first onboarding" is RETIRED — do NOT build it; the pivot replaced it with blank
  prompt-driven nodes + the template library + the optional generator.**
- **Per-node work-brief (Option A) — "what I did last run" legibility.** M1: the brief in the
  RUN view (generalized `AgentInvocation.outcome_detail`, no migration). M2: the same brief in
  the AUTHORING view via `agent_nodes.cloned_from_node_id` (mig `0014`) — the converse-with-a-node
  Mode-A substrate.

### Next — M-brownfield (local execution → real-folder run mode)
Read `PROJECTPLAN.md` §1 ("strategic direction") + §15 Phase 1.5 + the 2026-06-26 §17 entry +
`HANDOVER.md` §2 first, then work to the milestone's `/goal` (and its `prompts/` brief). The shape:
run the existing stack locally and add a run mode that mounts the user's REAL chosen repo as the
agent workspace (instead of an ephemeral clone) — the Engineer edits real files, the Reviewer gates
the real diff, ship commits to a real branch. **The hard part is correctness on existing code, NOT
the mounting.** It is a multi-milestone bet — the architect sizes each `/goal` to ONE bounded,
transcript-verifiable slice. A schema change gets a NEW migration (`0015`+; `0001`–`0014` frozen).
New FE lands under the FE-infra gate — mind the FE-testing gotchas (HANDOVER §4: user-event ⊥ vitest
fake timers → use `fireEvent`; React Flow needs the `frontend/src/test/setup.ts` jsdom shims).

### Also remaining in the backlog (architect-sequenced)
P1.9 (GitHub greenfield + PR — overlaps the brownfield real-branch ship target, so sequence it
WITH M-brownfield), P1.6 (WebSocket transport, deferrable), and the registered §15 follow-ons
(the `deriveNodeStatus` fix, the cosmetic renames, M3 mid-run prompt re-read → converse-with-a-node
Mode B). See `PROJECTPLAN.md` §15/§16. Do not start a milestone until the prior one is merged and
recorded.

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
- [ ] `make test` green (239+ backend tests; confirm the live count at session start; never regresses).
- [ ] `make lint` clean.
- [ ] `make test-frontend` (vitest, 114+ currently) + `make build-frontend` (tsc-strict + vite) green (if frontend touched).
- [ ] Live acceptance `make` target green for this step.
- [ ] `STATE.md` updated with sha, test count, branch name, completion date.
- [ ] `READY_TO_MERGE` written to `STATE.md`.
