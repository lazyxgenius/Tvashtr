# HANDOVER — Tvashtr-6 → Tvashtr-7

> Structured snapshot to start the next chat. **Read this, then read `PROJECTPLAN.md` in full** (it's the source of truth; this file adds emphasis + what's not already there).
> **Written:** 2026-06-16 by Tvashtr-6.

---

## 1. Where we are
**Phase 1 is in progress. P1.1 (HitL foundation) and P1.2 (cost caps + budget enforcement) are both COMPLETE, verified, and merged to `main`.** Phase 0 (the M0 walking skeleton) closed earlier. Phase 1 is "the painkiller" (idea → real features with a default team), decomposed into **P1.1–P1.9, sequence LOCKED** (loop-first; safety/cost/control enablers front-loaded — PROJECTPLAN §15). **The next chat (Tvashtr-7) picks up at P1.3 — the Docker sandbox** (real containment for the demonstrated write-escape).

**Two things changed this session beyond shipping P1.2 — absorb both:**
1. **The working process shifted to a build *loop*.** We no longer hand-write one Claude Code prompt per step and copy the output back. The architect writes a tightly-scoped **brief**; the operator runs **`/tvashtr-loop <brief-path>`** (the project skill at `.claude/skills/tvashtr-loop/SKILL.md`); the loop implements + self-verifies against fact-based gates + commits on a branch + returns an auditable report. **Two human gates remain:** the architect designs the brief and **audits the diffs**; the operator **visual-checks** the UI and **runs the live targets**. This is the single most important thing to internalize — see §6.
2. **Budget caps are safety-by-default** ($5/run) — see §2.

## 2. What P1.2 delivered (all verified — code audit + offline gates + 3 live checks)
A **per-run dollar cap** enforced in the **Control Plane**, with the Model Gateway kept a pure dollar-*metering* chokepoint. Built to the locked DP-A–D design (full detail + verification in PROJECTPLAN §17; brief at `prompts/P1.2-cost-caps-budget-enforcement.md`):
- **DP-A (data model).** `runs.budget_cap_usd Numeric(12,6) NULL` + `budget_overridden Boolean NOT NULL DEFAULT false` (migration **`0007`**). The live running total is a **query** — `metering.running_cost(run_id)` (`COALESCE(SUM(cost_records.cost_usd),0) WHERE workflow_id==run_id`), shared by `finalize_run_step` and the cap check — **not** a stored field; `Run.cost_total_usd` stays finalize-only. `POST /api/runs` seeds the cap from the request body else `Settings.default_run_budget_usd`. **Default = `Decimal("5.00")` — safety-by-default (every run bounded; opt out via `budget_cap_usd: null`).** (The build loop first shipped this as opt-in `None`; the architect changed it to $5 — recorded in §17.)
- **DP-B (enforcement; gateway stays pure).** New boundary-clean `backend/tvashtr/control_plane/budget.py` (`budget_check_step` — recorded `@DBOS.step`, pure read, `over = cap is not None and not budget_overridden and spent > cap`; idempotent `mark_budget_overridden_step`). `gateway.complete()` got NO run context / DB reads. The breach is reactive / between-steps (it can overshoot ~one step's spend — mid-step interruption is **P1.4's** job).
- **DP-C (breach reuses P1.1's gate).** A workflow-body helper `enforce_budget()` (issues `wait_at_gate` → `DBOS.recv`) at **two** checkpoints in `run_team`: after PRD approval / before the Engineer (`budget:{run_id}:pre-engineer`) and after `persist_agent_cost_step` / before `ship_step` (`:pre-ship`). `kind="budget_approval"`, `priority="high_blocker"`. **Reject → terminal `over_budget` (no ship); approve → record the override and continue (the rest of the run is not re-gated).** `enforce_budget` lives in `team_run.py` (not `budget.py`) precisely so `budget.py` needn't import `gates`.
- **DP-D (per-call cap IN; ceilings OUT).** `Settings.default_max_tokens_per_call = 4096`, applied in `gateway.complete()` only when a request omits `max_tokens` (static config; the PM's explicit 400 is unaffected). Depth/loop/active-agent ceilings NOT built (deferred to P1.5, §15).
- **Frontend (reuses P1.1c's Stopped visual).** `status.ts`: `over_budget` joins the terminal set and a `RUN_STOPPED` set routes it (with `rejected`/`cancelled`) to the muted **Stopped** node status before the failed-fold; `deriveOverall` reads a legible **"Over budget"**. **No new CSS, no ad-hoc hex.**
- **Verified:** architect audit of 17/19 changed files; offline `make test` **41** + `npm test` **37** + lint + `0007` round-trip + a mocked-`over_budget` browser gate + an independent 2-agent review (caught + fixed one demo-script `SyntaxError`); and **three live operator checks all passed** — `make budget-demo` (breach at pre-ship → auto-approve → ship), `make skeleton-crash` (**crash-resume still ships exactly once with the new budget steps in the workflow — DBOS replay unperturbed; the central regression risk is retired**), `make hitl-demo` (PRD gate intact).

## 3. What's in flight
**Clean boundary — P1.3 is not started; P1.2 is merged to `main`.** One loose end: **git housekeeping** (do it before/at P1.3 start). The build loop had been committing its scratch state file `.tvashtr/loop-state.md`, which causes a merge-blocking branch divergence (you commit it → the loop writes the new commit hash *into* it → the tree is dirty → `git checkout main` aborts — exactly what happened merging P1.2). Fixed this session at the skill + gitignore level (`.tvashtr/` is now gitignored; the skill no longer stages it). The **already-tracked** copy still needs untracking once:
```
git rm --cached .tvashtr/loop-state.md
git add .gitignore .claude/skills/tvashtr-loop/SKILL.md
git commit -m "chore: gitignore loop scratch + harden tvashtr-loop skill"
```
(Drop the `.claude/...` path if you'd rather not track the skill in git — operator's call. The skill is a build artifact like `prompts/`, so tracking it is reasonable.)

Also uncommitted from this session: the two **skill hardening** edits in `.claude/skills/tvashtr-loop/SKILL.md` (the posture-default escalation clause + the don't-commit-loop-state rule) and the `.gitignore` change — both folded into the commit above.

## 4. Immediate next steps (Tvashtr-7) — in order
1. **Read both docs** (`HANDOVER.md` + `PROJECTPLAN.md`); call `Filesystem:list_allowed_directories` to confirm the path (`/Users/adimac/Desktop/Tvashtr`, capital T).
2. **(Quick) The git housekeeping** in §3.
3. **Research + settle P1.3's design points with the operator** (§5), and **verify against the installed OpenHands 1.28.1** what the containerized path actually is (Agent Server REST vs the SDK's Docker-workspace mode — *verify, don't assume*; check `.venv/.../openhands*`). Resolve the design points one-at-a-time, the usual way.
4. **Write the P1.3 brief** (`prompts/P1.3-*.md`) **for the loop** — set the escalation mode (**`halt`** for a big brief like this), whether live targets are authorized in-loop (almost certainly **not** — the Docker bring-up + the escape-containment proof are operator live checks), the **fact-based exit conditions**, and the ⚠️Human-checks. Use `prompts/P1.2-cost-caps-budget-enforcement.md` as the worked template. **Likely split** (e.g. P1.3a = container plumbing + the adapter's guts; P1.3b = re-prove crash-resume + escape containment) — your call after sizing it.
5. **Run the loop:** operator runs `/tvashtr-loop prompts/P1.3a-*.md` → pastes the report → **you audit the diffs against the brief** (read every changed file; never trust the report/scrollback over the disk) → surface gaps/decisions → operator does the live checks → you finalize the §17/§15 docs → operator merges. Repeat for P1.3b.

## 5. P1.3 — what it is, and the design points to settle first
**Goal (§15):** replace local-unsandboxed agent execution with the **OpenHands Agent Server Docker sandbox**, behind the existing `EngineAdapter` seam, **before** the loop (P1.5) runs real multi-file/build/test code. The `EngineAdapter` *contract* holds; the adapter's *guts* move from in-process `conversation.run()` to driving a **containerized** agent. **Motivation — the risk is concrete:** the write-escape is **DEMONSTRATED** (P0.4b — the agent wrote `greeting.txt` *outside* its workspace on an absolute `/greeting.txt` path; the current fix is a prompt-level band-aid, not containment). The container is what actually contains it.

**What must be re-proven over the container (this is the friction):**
- **Event capture** — the live-callback event seam (→ `RunEvent`) now over the Agent Server, not in-process.
- **`files_changed` + git-ship over a mounted volume** — the ship reads the agent's work from a mounted dir on the host.
- **Usage telemetry** — the Decision-2 path (`conversation.conversation_stats.get_combined_metrics()` → the agent-cost `CostRecord`) over the server.
- **Crash-resume container lifecycle (the crux)** — the coarse `@DBOS.step` agent run now spans a container; on `kill -9` + resume, a fresh container re-runs the step. This should be consistent with **Decision 1's restart-and-idempotent-ship** model (§17) — but **verify** the container lifecycle doesn't break exactly-once-ship. `make skeleton-crash` is the regression that proves it.
- **Apple-Silicon (arm64) Docker friction** — P0.3 quarantined Docker into its own step *because* of this. Expect image/build/pull friction; budget for it.

**Design points to settle (operator) + verify (installed OpenHands) before the brief:**
- **Agent Server (REST, containerized) vs SDK Docker-workspace mode** — confirm what 1.28.1 exposes and which slots into the adapter cleanly.
- **Container ↔ step ↔ crash-resume** — how a container's lifecycle (start → run → tear down) maps onto the one coarse `@DBOS.step` and survives the crash-resume.
- **The ship / volume** — the mounted volume + git operations from the host side.
- **Containment acceptance** — the absolute-path escape (`/greeting.txt`) is now *contained* by the container boundary (so the band-aid prompt instruction can be relaxed and the agent still can't escape the workspace).
- **One brief or split** — given the friction, a split is likely.

(After P1.3: **P1.4 = the LiteLLM proxy** — the agent-internal spend chokepoint that can cut a runaway agent off *mid-loop*, closing the mid-step gap P1.2 can't; then **P1.5 = the multi-node cyclic loop + alignment check**, which proves M1.)

## 6. Standing conventions (load-bearing) — incl. THE BUILD LOOP (new)

### THE BUILD LOOP (how we now work — read `.claude/skills/tvashtr-loop/SKILL.md`)
- Build via **`/tvashtr-loop <brief-path>`**. The architect authors a tight brief in `prompts/`; the loop branches → implements → offline gates (`make test`/`lint`, `npm run build`/`test`) → **Playwright MCP** functional gate (if UI) → an **independent review pass** → commits on a **branch** (never merges) → returns a report with a **decision ledger** (AUTONOMOUS two-way-door calls logged for audit; ESCALATED one-way-door calls halted).
- **Two human gates:** (1) the architect **designs the brief up front** and **audits the diffs** against it — read every changed file; **never trust the report or scrollback over the disk**; (2) the operator **visual-checks** the UI (the "n8n-level" bar) and **runs the live targets** (the loop does **not** run money/minutes targets unless the brief explicitly authorizes them).
- **Autonomy rule:** two-way door (reversible / local — naming, file placement, a test assertion, equivalent implementations) → the loop **decides + logs**. One-way door (architectural / cross-cutting / irreversible / plan-deviating; a new entity or migration; a contract change; anything that extends a §17 decision; **a default value that sets cost/safety/security posture**) → **halt + escalate** (`halt` mode, the default for big briefs). *(The posture-default clause was added to the skill this session — it's the lesson from P1.2's `None`-vs-$5 default, which the loop had logged as "just config" when it was really a safety-posture call.)*
- The loop **commits on a branch**; the **operator merges** (after the architect finalizes the §17/§15 docs). **`.tvashtr/loop-state.md` is gitignored scratch — never committed.**
- **The brief carries:** Objective; Context (where it fits, the files, the current state to assume); Constraints/hard-rails + what not to touch; Scope **IN / OUT**; ordered Tasks; **fact-based exit conditions**; in-loop gates; the **escalation mode**; **live-targets-authorized?**; the ⚠️Human-checks; doc-drafts. (`prompts/P1.2-cost-caps-budget-enforcement.md` is the worked example.)

### The hard rails (unchanged — the loop honors these too)
- **Boundary discipline:** only `gateway/gateway.py` imports `litellm`; only `engines/openhands_adapter.py` imports `openhands.*` (lazily, inside the functions that need it); app startup + the offline suite stay openhands-free (a test enforces it). New control-plane modules import only `dbos`/`sqlalchemy`/`tvashtr.{db,models,...}` — **`budget.py` and `gates.py` both keep this** (and `enforce_budget` lives in `team_run.py`, not `budget.py`, so `budget.py` needn't import `gates`).
- **At-least-once-safe writes:** every side-effecting write inside a `@DBOS.step` is idempotent on a `DBOS.workflow_id`-derived key (`{run_id}:pm-prd-v1`, `{run_id}:agent-cost`, the `ship-{run_id}` git tag, `(run_id, seq)` events, gate unique `(run_id, topic)`). `workflow_id == run_id == str(Run.id)` via `SetWorkflowID`.
- **The gate primitive is reusable and now reused twice:** the PRD gate (P1.1) and the **budget-breach blocker** (P1.2, via `enforce_budget` → `wait_at_gate` → `DBOS.recv`, resumed by `DBOS.send`). The kill switch (`DBOS.cancel_workflow` + `Run.status="cancelled"`, excluded from PENDING-only recovery) is the interrupt path.
- **Running cost is a query** (`metering.running_cost(run_id)`), not a stored field; `Run.cost_total_usd` is finalize-only.
- **Frontend:** consume the Design System from the **token CSS** (**no ad-hoc hex** — tokens or `color-mix` of tokens only). `status.ts::deriveNodeStatus`/`deriveOverall`/`isRunTerminal` is the **single source of truth** for derived status — it knows the full vocabulary (`idle/running/paused/done/stopped/failed`) + the terminal set (incl. `over_budget`); extend it there, not in components. **Polling (~1.8–2s)** is the transport (WebSocket = named **P1.6** upgrade). The **canvas is read-only** (authoring is Phase 2). Frontend gates: `npm run build` (strict `tsc --noEmit` + `vite build`) + `npm test` (vitest).
- **Verify fast-moving SDKs against the installed package** (DBOS was checked against `.venv/.../dbos/_dbos.py`; OpenHands against the installed `openhands*`); **verify reports against the disk.**
- **Single `OPENROUTER_API_KEY`** for both the gateway and the agent's internal LiteLLM (exported from `.env` by the Makefile). `.env` gitignored; no key has reached a commit; repo has no remote.
- **UI bar = "n8n-level (or better)."** Visual acceptance is the operator's **live eyeball** — a green build is not enough (P1.1b's StrictMode bug passed every headless gate and only the live check caught it). Make small fixes directly when faster than a round-trip; substantial work goes through a loop brief.

## 7. Open risks & carried items (PROJECTPLAN §13 + the §15 register)
- **⚠️ Unsandboxed write-escape DEMONSTRATED (P0.4b)** — **P1.3 is the fix and the immediate next step.** Still the strongest open safety item.
- **Budget enforcement is reactive / between-steps (P1.2, by design):** a breach can overshoot by ~one step's spend, and the agent's own mid-step spend can't be interrupted until **P1.4 (the LiteLLM proxy)**. The $5 default bounds a runaway *between* steps; P1.4 bounds it *mid-step*.
- **Carried from P1.1b/c (registered §15):** the per-run resolve-suppression hides a task whose resolve POST *fails* (benign single-operator; clear-on-`catch` is the fix); the **FE component/lifecycle tests gap** (vitest is pure-function only; the StrictMode bug needed a real `<App/>`-under-`<StrictMode>` render test); the sub-second "Working…" flash before Stopped on reject.
- **Cancelled-gate blocked-`recv` thread lingers** up to `GATE_WAIT_SECONDS` (3600s) after cancel (sync `recv` isn't preempted) — benign single-operator; revisit at many concurrent gates.
- `run_events` is a "Frankenstein" log after a crash; **verbose run-event payloads** (`_payload_of` stores repr-ish strings); **workspaces accumulate** under `backend/.tvashtr_workspaces/<run_id>/` (no GC); in dev **DBOS resumes abandoned `running` runs on every backend boot** (the M0 property + why the kill switch exists) — old runs churn a little API spend; harmless to a fresh run.
- **Named upgrades parked in §15 (do NOT drop — operator-flagged):** per-project budget cap; cost threshold / 80% alert; richer budget-breach resolution (grant-an-increment vs the binary override); agent-native resume; exact spend-accounting across crashes; in-process unified metering; the **LiteLLM proxy (P1.4)**; **section-level** then **CRDT/Yjs** doc locks; the **Docker sandbox (P1.3 — next)**; **WebSocket (P1.6)**; the **Tasks-for-Human drawer (P1.5)**; FE component tests; workspace GC.

## 8. Tech stack (all LOCKED — PROJECTPLAN §8 for rationale)
DBOS Transact 2.23.0 · LiteLLM 1.89.0 · React Flow `@xyflow/react` 12.11.0 · OpenHands SDK 1.28.1 (`openhands-sdk` + `openhands-tools`; **local-dir workspace now, Docker sandbox = P1.3**) · Postgres 16 · FastAPI · SQLAlchemy 2 + Alembic · Python 3.12 / uv · Vite 7 / React 19 / Tailwind v4 · `lucide-react` 1.18.0 · **vitest 3.2.6** · the operator's **Design System** (vendored tokens). **Build tooling:** the loop uses **Playwright MCP** for its functional gate (configured in Claude Code — `npx @playwright/mcp@latest`). **Coming in Phase 1:** the **OpenHands Agent Server Docker sandbox** (P1.3) · the **LiteLLM proxy** (agent-spend chokepoint, P1.4) · **TipTap** (live doc editor, P1.7) · **WebSockets via FastAPI** (P1.6). Doc-concurrency v1 = **document-level** advisory soft lock (section-level → Yjs are named upgrades).

## 9. Repo state & how to drive it
- **Project root:** `/Users/adimac/Desktop/Tvashtr` (Claude Code runs here; the architect chat edits the living docs here directly via Filesystem MCP).
- **Build/branching:** the loop works on a **feature branch** and commits there; the **operator merges** to `main` (after the architect finalizes docs). P1.2 was `feat/p1.2-cost-caps`, now merged.
- **Make targets:** `setup`, `db-up`, `db-down`, `migrate`, `backend`, `frontend`, `test` (backend pytest), `lint`, `fmt`, `smoke`, `agent-smoke`, `skeleton-run`, `skeleton-crash`, `crash-demo`, `hitl-demo`, **`budget-demo`** (new — tiny cap → breach → auto-approve → ship). Live targets skip cleanly without `OPENROUTER_API_KEY` and take minutes. **The UI is `make backend` + `make frontend` → `http://localhost:5173`** (Vite proxies `/health` + `/api` → `:8000`; no CORS config). To exercise a gate manually use `make backend` (NOT the auto-approve targets, which set `TVASHTR_AUTO_APPROVE_GATES=1`); to see an `over_budget` stop live, POST a tiny cap: `curl -X POST .../api/runs -d '{"budget_cap_usd": 0.0001}'` then reject the budget blocker in the UI. Frontend tests: `cd frontend && npm test`.
- **Migrations:** `0001`–`0007`; **`0007_run_budget_caps` is newest** (P1.2). Next is `0008`.
- **Prompts/briefs archived in `prompts/`:** `P0.1`…`P0.5b`, `P1.1a/b/c-*`, **`P1.2-cost-caps-budget-enforcement.md`** (the loop-brief template). Add `P1.3-*` there.
- **HTTP surface (all in `routers.py`):** `POST /api/runs` → `{run_id}` (accepts optional `budget_cap_usd`); `GET /api/runs/{id}` (workflow status + run row + costs); `GET /api/runs/{id}/graph` (canvas); `GET /api/runs/{id}/tasks` + `POST …/tasks/{task_id}/resolve` + `POST …/cancel`; `GET /api/documents/{id}`; `GET /api/spike/run-events/{id}`; plus the P0.2 spike endpoints. **Run `status` vocabulary: `pending|running|awaiting_human|completed|failed|rejected|cancelled|over_budget`.**
- **Backend control plane:** `control_plane/{team_run.py, gates.py, budget.py, shipping.py, teams.py, doc_writer.py}`; `gateway/`; `metering.py` (`running_cost`, `record_cost`, `record_agent_cost`); `engines/{base.py (contract), openhands_adapter.py, registry.py, run_event_sink.py}`; `models.py`; `config.py` (the `Settings` incl. `default_run_budget_usd=$5`, `default_max_tokens_per_call=4096`).
- **Frontend layout:** `lib/` (api client; `status.ts` = the derived-status SoT; `events.ts`; `status.test.ts` + `events.test.ts` = vitest), `canvas/`, `panel/`, `components/` (StatusPill, RunBanner, BackendDot, TasksForHuman, CancelRunButton), `design-system/` (vendored tokens), `index.css`/`canvas.css`/`panel.css` (`.tv-pill--*` / `.rf-node--*` carry the status visuals incl. `paused`/`stopped`).
- **Commit state:** P1.2 merged to `main`; the only loose end is the git housekeeping in §3.

## 10. Operator working style (apply throughout)
- **Analogies help** when explaining concepts.
- A message starting with **"By the way"** = give a **short** answer.
- **Procedures one step at a time** — deliver step 1, wait for the reported result, then step 2 (governs hands-on bits: commands, installs, the live visual checks; a checklist of *independent* verifications can be given together).
- **We now build via the loop:** one **tight brief per step** (`prompts/`), run via `/tvashtr-loop`; the architect **audits the diffs**. Prefer several tightly-scoped briefs over one sprawling one (and a split is fine, as P1.1 a/b/c and the likely P1.3 a/b show).
- **Decision log over silent revision** — when the operator pushes back or a direction changes, record the reasoning in §17.
- **Operator flags things he doesn't want forgotten** — capture them in the §15 register / §17 immediately.
- **UI/UX quality matters — "n8n-level (or better)";** the operator's live eyeball is the visual gate. Don't call UI done on a green build alone.
- **Chat naming:** open by stating your name ("This is Tvashtr-7"); the number comes from the first message of the chat.

## 11. Pointers
- **Source of truth:** `PROJECTPLAN.md` — esp. §6 architecture, §7 decisions (D1–D10), §8 stack (locked), §9 data model, §13 risks, §15 roadmap + the **Deferred refinements register**, §16 milestones (**M0 ✅; P1.1 ✅; P1.2 ✅**), §17 decision log (every P0.x/P1.x decision + verification, incl. the P1.2 design+verification entry and the loop-process-shift entry).
- **The build loop:** `.claude/skills/tvashtr-loop/SKILL.md` (how it runs, the decision rule, the gates). The worked brief template: `prompts/P1.2-cost-caps-budget-enforcement.md`.
- **Working loop, brief structure, review discipline:** the project instructions.
- **The verified code P1.3 builds on:** the **engine/adapter layer** — `engines/base.py` (the engine-neutral contract that must hold across the Docker move), `engines/openhands_adapter.py` (the guts that move in-process → containerized), `engines/{registry.py, run_event_sink.py}`; plus `control_plane/team_run.py` (the coarse `@DBOS.step` agent run + idempotent ship that crash-resume depends on) and `control_plane/shipping.py`.
- **The Phase-0 closeout narrative:** `docs/M0-walkthrough.md`.
