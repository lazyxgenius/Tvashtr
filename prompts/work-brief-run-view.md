# Brief — Per-node work-brief (Option A, Milestone 1): generalize `outcome_detail` + the run-view "Last run" panel

> Architect-authored brief for the CLI `/goal` loop. Tvashtr-30. Read `HANDOVER.md` + the relevant `PROJECTPLAN.md` §17 entries first if you have not. This is a **feature** slice (not a bug-fix) — no reproduce-a-failing-bug-first requirement, but every new test must be **mutation-real** (revert the change → the test goes RED; show it in the transcript).

---

## 0. Outcome (the one thing this milestone delivers)

Every **thinker** (`kind="completion"`) and **worker** (`kind="agent"`) node writes a short, human-readable **"what I did last run"** brief into its `AgentInvocation.outcome_detail` at close — **deterministically, with NO extra LLM call** — and the **run-view side panel** surfaces that brief for **any** selected agent/thinker node (not just the three hardcoded roles `pm`/`engineer`/`reviewer`). A custom/blank node you author now shows a real brief instead of the irrelevant raw event feed it shows today.

This is part (b) of the two-layer document model (the per-node work-brief), generalizing the reviewer-only `outcome_detail` to every LLM/agent node. It is the substrate for "converse with a node (Mode A)".

**Explicitly OUT of scope this milestone (deferred, see §7):** the *authoring*-view "last run alongside prompt/model" panel (it needs a new `cloned_from_node_id` linkage + a migration + cross-run aggregation — a separate Milestone 2); the agent's natural-language final-message brief (richer than files-changed, but brittle); gate/terminal briefs (control primitives — they never open a panel).

---

## 1. Context — exact files, current state, snippets

### 1.1 The schema + plumbing already exist (reviewer-only by call-site, not by design)

- **`backend/tvashtr/models.py`** — `AgentInvocation.outcome_detail: Mapped[str | None]` (Text, nullable, migration `0011`) already exists. **NO migration needed.** Alembic head is **`0013`** and stays there. (The `protect-migrations.sh` PreToolUse hook freezes `0001`–`0013`; do not edit any existing migration; this slice adds none.)
- **`backend/tvashtr/control_plane/invocations.py`** — `close_invocation_step(run_id, node_id, iteration, status, outcome, outcome_detail=None)` **already takes the optional `outcome_detail`** and writes it. No change needed here. (Read it to confirm.)
- **`backend/tvashtr/routers.py` → `get_run_graph` (`GET /api/runs/{run_id}/graph`, ~line 632)** — **already returns, per node, the full `invocations` list including `outcome_detail`** for every node (see the `"invocations": [...]` block ~line 697, fields `iteration/status/outcome/outcome_detail/started_at/ended_at`). **The run-side data path is already end-to-end — no backend read change is needed.** Do NOT change this endpoint's shape.

### 1.2 The executor close sites — `backend/tvashtr/control_plane/team_run.py` (the most-protected file; touch surgically + additively)

The `run_graph` walk (~lines 736–915) dispatches on `kind`. The relevant close sites:

- **Thinker (`completion`)** — ~line 780. Today: `close_invocation_step(run_id, current, n, "done", "prd_written")` (no detail). The branch above it (~759–779) already distinguishes first-vs-later:
  - first thinker (`pm_document_id is None`): `result = pm_step(run_id, idea, node["model"], node["prompt"])`
  - later thinker: `result = thinker_refine_step(...)`
  - then `pm_document_id = result["document_id"]`. **Capture "was this the first thinker" BEFORE that reassignment** (or set the brief inside each branch).
  - Both `pm_step` and `thinker_refine_step` return `{"document_id": ..., "prd_text": result.text}`.
- **Worker (`agent`)** — close at ~lines 862–864: `close_invocation_step(run_id, current, n, "done", label or "built", outcome_detail=result["reasons"])`. `result["reasons"]` is the verdict reasons for an **emitting** worker (Reviewer) and **`None`** for a **non-emitting** worker (Engineer). `label = result["outcome"]` (None for a non-emitting worker).
- **Gate** (~886) and **Terminal** (~897/910) — **DO NOT TOUCH.** Control primitives; never open a panel.

### 1.3 The worker's material is already computed and currently DISCARDED

- **`backend/tvashtr/engines/base.py`** — `AgentRunResult` carries `summary: str` and `files_changed: list[str]` (in addition to status/error/tokens).
- **`backend/tvashtr/engines/openhands_adapter.py`** (~line 297–316) — `files_changed = sorted(p for p in after if before.get(p) != after[p])`; `summary = f"{status}: {len(collected)} events ({n_action} actions, {n_obs} observations); files_changed={files_changed}"`.
- **`team_run.py` → `agent_run_step` (~lines 527–621)** reads only `result.status`, `result.error`, and the token/cost fields — it **throws away `result.files_changed` and `result.summary`**. Its return dict is `{"status", "outcome", "reasons", "error"?, **usage}`. **Thread `files_changed` (and optionally `summary`) up through this return** so the worker close site can build the brief. No LLM call — `files_changed` is already computed.

### 1.4 The run-view FE — `frontend/src/`

- **`App.tsx`** — run view (`runId !== null`): state `selectedRole: string | null` (~line 76). Render (~631–667): `onSelectNode={setSelectedRole}`, `panelOpen={selectedRole !== null}`, and:
  ```tsx
  <SidePanel
    selectedRole={selectedRole}
    invocations={graph?.nodes.find((n) => n.role_name === selectedRole)?.invocations ?? []}
    runId={runId} run={run} workflowStatus={workflowStatus}
    onClose={() => setSelectedRole(null)}
  />
  ```
  `selectedRole` is also reset to null in `resetRunState` (~281), `backToAuthoring` (~317), and on team switch (~330, ~355). **The `find(n => n.role_name === selectedRole)` is the per-node-attribution bug for custom topologies:** two blank thinkers share a `role_name`, so clicking the second shows the first's data. **Switch run-view selection to NODE-ID** (the run-view twin of the fix P1.8d already made for authoring's `selectedNodeId`).
- **`canvas/TeamCanvas.tsx`** — `onNodeClick` (~339–345): for `data.kind === "agent" || "completion"`, in the run view it calls `else onSelectNode?.(data.role_name)`. **Change the run-view branch to pass `node.id`** (the canvas already has it). Gates/terminals still open nothing (leave that). (`nodeData` ~line 80–95 maps `role_name`/`kind` onto the card — fine.)
- **`panel/SidePanel.tsx`** — the run-view inspector. Today it switches **entirely on `selectedRole`** (a string) with hardcoded keys: `pm` → `PrdView` (the shared spec, live-editable in-flight via `isPrdEditable`, P1.7b steering); `reviewer` → `ReviewerView` (per-round verdict history reading `invocations` + `outcome_detail`); **everything else → `EventFeed`** (the agent step feed). `TITLES` is a 3-key map. This is the pre-pivot residue to retire.
- **`lib/api.ts`** — `GraphNode` (run view) has `id`, `role_name`, `kind`, `model`, `engine`, `prompt`, `position`, `config`, `status`, `iteration`, and `invocations: NodeInvocation[]`. `NodeInvocation` = `{iteration, status, outcome, outcome_detail, started_at, ended_at}`. Everything the panel needs is already in the run-graph payload.
- **`lib/status.ts`** — `reviewerVerdictLabel(outcome)` (→ `{label, tone}`) and `isPrdEditable(...)` live here; reuse them.

---

## 2. The brief content (deterministic, no LLM) — DECIDED, implement exactly

A small **pure helper** (e.g. `_work_brief(...)` in `team_run.py`, or a tiny module — your call, but keep it pure + unit-tested) composes the strings:

- **Thinker, first/root** → `"Drafted the spec from the idea."`
- **Thinker, later** → `f"Refined the spec (version {n})."` (use the node's iteration `n`; the shared spec's version equals the thinker's contribution order — a deterministic, honest line. No spec-text extraction.)
- **Worker, non-emitting** (Engineer) → from `files_changed`:
  - non-empty: `f"Built the feature — changed {k} file(s): {a, b, c}"` where the list is **capped** (first 5, then `+N more` if longer).
  - empty: `"Ran but changed no files."`
  - (Drop the action/observation counts — noise for a human.)
- **Worker, emitting** (Reviewer) → **UNCHANGED**: `outcome_detail` stays `result["reasons"]` exactly as today. **Do not alter the Reviewer's `outcome_detail`** — the §14.1 `ReviewerView` and the §14.3 A/B `get_ab_comparison` both read it; keep them byte-compatible.

**The close-site `outcome` LABELS stay byte-stable** — thinker still emits `"prd_written"`, worker still `label or "built"`. You only **add** the `outcome_detail` argument to the thinker close and to the **non-emitting** worker close. Purely additive: the new detail string is the only behavioral change.

---

## 3. The run-view panel generalization (FE) — DECIDED, implement exactly

Retire the `role_name`-keyed switch in `SidePanel`; switch on **`kind`**, select by **node-id**, and add a uniform **"Last run"** section that works for any node:

1. **Selection → node-id.** `App.tsx`: replace `selectedRole` with a run-view `selectedRunNodeId: string | null` (reset it everywhere `selectedRole` was reset). `onSelectNode` receives the id (from the canvas change in §1.4). Find the node: `const node = graph?.nodes.find((n) => n.id === selectedRunNodeId)`. Pass the whole `GraphNode` to `SidePanel` (`node={node}`), keeping `runId`/`run`/`workflowStatus`/`onClose`.
2. **`SidePanel` signature** → `{ node: GraphNode; runId; run; workflowStatus; onClose }`. Title from `node.role_name` (keep the nice labels for the seeded roles `pm`/`engineer`/`reviewer`; fall back to the raw `role_name` for a custom node — a small humanizer/title-case).
3. **"Last run" section (every agent/thinker node)** — a **generalized** version of today's `ReviewerView`: render `node.invocations` as a per-round list, each round `"Round {iteration} — {humanized outcome}"` with the `outcome_detail` line beneath when present.
   - Humanize known outcomes via a small map (fallback = title-case the raw): `prd_written → "Wrote the spec"`, `built → "Built"`, `approved → "Approved"`, `changes_requested → "Changes requested"`, `over_budget → "Over budget"`. For the Reviewer this must stay **identical** to today's output (reuse `reviewerVerdictLabel` for `approved`/`changes_requested` + tone classes, so the existing `tv-verdict--*` styling and the `SidePanel.test.tsx` assertions hold). For a single-iteration node the list is one row.
   - Empty (`invocations === []`, node not yet reached) → the existing "No … yet." style note.
4. **Kind-specific body beneath the brief:**
   - `kind === "completion"` (thinker) → the **`PrdView`** (the shared spec — every thinker refines the SAME shared `pm_document_id`, so this is correct for any thinker, not just the PM; editability stays run-status-based via `isPrdEditable`, NOT role-based). The PM's existing empty-hint copy is generic enough; keep it.
   - `kind === "agent"` (worker) → the **`EventFeed`** (unchanged).
   - The Reviewer is a worker (`agent`) → it gets the "Last run" brief (= its verdict history, identical to today) + the event feed. Its current behavior (verdict history) is preserved by the generalized brief section; the event feed is additive-but-fine. **Confirm the §14.1 verdict-history rendering is visually unchanged for the Reviewer.**

**Preserve, do not regress:** the PM's live-editable PRD (P1.7b steering); the Reviewer's per-round verdict history + reasons (§14.1); the `App.test.tsx` keystone (poll → DOM + polling-stops, the `mountedRef` guard) and the `TeamCanvas.test.tsx` rework-edge guard. Update `SidePanel.test.tsx` for the new `node` prop and add coverage per §5.

---

## 4. Invariants / do-not-touch (expressed as on-disk acceptance where possible)

- **NO migration.** Alembic head stays `0013`; `backend/alembic/versions/` gains no `0014_*` file. (Show `ls backend/alembic/versions/ | tail` + `alembic heads`.)
- **`team_run.py` is NOT byte-intact this slice** (the executor touch is the point), but the diff must be **surgical + additive**: the new pure helper, `agent_run_step` returning `files_changed`, and the two close-site `outcome_detail` args — nothing else. **Do NOT** rename `pm_step`/`pm_document_id`, **do NOT** drop `config.agent_kind`, **do NOT** rename `REVIEW_VERDICT.json` (all deferred cosmetics — leave them). Show `git diff main -- backend/tvashtr/control_plane/team_run.py` is confined to those additive changes.
- **`teams.py` builders + `clone_team_graph` BYTE-INTACT** (`git diff main -- backend/tvashtr/control_plane/teams.py` empty). **A/B endpoints + `_AB_CONFIGS`/`_TEAM_BUILDERS` BYTE-INTACT** in `routers.py`. **`get_run_graph` shape unchanged.**
- **The Reviewer's `outcome_detail` is byte-stable** (still `result["reasons"]`) → `get_ab_comparison` (§14.3) and `ReviewerView` (§14.1) unchanged. Add/keep a test asserting the A/B comparison still reads the reviewer reasons.
- **Backend offline-import boundary preserved:** `team_run` imports no `litellm`/`openhands.*` at module load; the new helper stays pure (no heavy imports). (`make test` runs offline; the import test stays green.)
- **Gates/terminals untouched** in both the executor and the FE click behavior.

---

## 5. Tests (mutation-real — revert → RED, shown in transcript)

**Backend (`backend/tests/`):**
- Unit-test the pure `_work_brief` helper: first-thinker, later-thinker (version N), non-emitting worker with files (capped list), non-emitting worker with no files, emitting worker leaves reasons untouched.
- An executor-level test (in the spirit of the existing `test_thinker_chain.py` / loop tests) asserting, after a faked run over a thinker→worker(→reviewer) graph, that the **thinker's** and the **non-emitting worker's** latest `AgentInvocation.outcome_detail` are the expected non-NULL briefs, and the **Reviewer's** `outcome_detail` is still its reasons. Mutation-prove (revert the close-site additions → RED).
- Keep `get_ab_comparison`'s reviewer-reasons test green (add one if absent).

**Frontend (RTL, co-located):**
- `SidePanel.test.tsx` (update for `node` prop): the "Last run" brief renders for (a) a **custom-role** thinker node (e.g. `role_name="architect"`, `kind="completion"`) showing its brief + the PRD body — NOT an empty event feed; (b) an **Engineer** (`kind="agent"`) showing the files-changed brief + event feed; (c) the **Reviewer** showing the per-round verdicts identical to today (assert the existing `tv-verdict--*` + reasons-under-`changes_requested` behavior is intact).
- A small App-level (or canvas-level) test that run-view selection is by **node-id** (two same-`role_name` nodes select independently). Keep `App.test.tsx` + `TeamCanvas.test.tsx` green.

---

## 6. Live acceptance — `make work-brief-e2e` + Playwright self-sign-off

Add a `Makefile` target `work-brief-e2e` (and its `scripts/work_brief_e2e.sh` + any Python/Playwright helper), following the house pattern (`thinker-chain-e2e` is API-driven; `team-edit-e2e`/`team-library-e2e` are Playwright UI-driven). Required evidence, **all run by Claude Code to green** (the operator runs nothing):

1. **Executor-populate proof (API-driven, the most important + cheapest):** run a real `review_loop` team on the NIM agent model (`.env TVASHTR_AGENT_MODEL=nvidia_nim/meta/llama-3.3-70b-instruct`, LOCAL sandbox, auto-approve gates, forced revisions so the loop genuinely runs), then `GET /api/runs/{id}/graph` and **assert on disk** that the **thinker (PM)** node's latest `outcome_detail` is non-NULL + well-formed AND the **Engineer** node's latest `outcome_detail` is the files-changed brief (non-NULL) — i.e. the brief is populated for **more than just the Reviewer**. Echo the asserted values into the transcript.
2. **FE proof (scripted headless Playwright, screenshots — the React-Flow `browser_snapshot` gotcha applies: use targeted `browser_evaluate` on specific selectors + screenshots, NOT a whole-tree snapshot):** drive the Vite dev server + a real run, click the **thinker** node → screenshot the panel showing its "Last run" brief; click the **Engineer** node → screenshot the panel showing its files-changed brief. Capture ≥2 screenshots so the operator's eyeball is an optional glance at artifacts.
3. The **four regression smokes** GREEN on NIM: `skeleton-run`, `skeleton-crash`, `loop-run`, `loop-crash`. The existing `thinker-chain-e2e`, `capability-edit-e2e`, `topology-e2e` GREEN.

---

## 7. Deferred follow-ons (register in §15 at closeout — already decided, do not silently drop)

- **Milestone 2 — authoring-panel "what I did last run":** surface the brief in `TeamNodePanel` (authoring view) alongside prompt/model/capability. Needs a new `cloned_from_node_id` column on `agent_nodes` (a migration) set by `clone_team_graph`, plus a cross-run "latest invocation per origin node" read — because the run executes against a clone with no back-reference today. This is also the **converse-with-a-node (Mode A)** substrate. **The harder, more steering-central half — explicitly the next milestone, not dropped.**
- **Worker brief enrichment — the agent's natural-language final message** (richer than files-changed; requires harvesting the last `message`-kind `EngineEvent` payload, which is brittle and not returned by `agent_run_step` today).
- The standing cosmetic cleanups when `team_run.py` is next touched for that reason (the `pm_step`/`pm_document_id` renames + stale docstring; `config.agent_kind` drop; `REVIEW_VERDICT.json`→`OUTCOME.json`) — **NOT this slice** (keep the diff surgical).

---

## 8. Stop conditions

- Write `NEEDS_HUMAN` to `STATE.md` and stop on an **external blocker** (missing key/credits, Docker/infra down) OR if a **second/unknown problem surfaces that needs a broad or unproven change**. A **code-proven, contained, regression-guarded** fix to a problem you hit **may proceed** (note it in the report).
- Hard turn cap: stop and write `NEEDS_HUMAN` if you exceed a reasonable bound without converging.

## 9. Report-back (echo as you go; final summary at the end)

Files changed (with the surgical `team_run.py` diff confirmed additive); commands run **with output** — `make test` (count, the mutation tests shown RED-on-revert then GREEN), `make lint`, `make test-frontend` (count), `make build-frontend`, `make work-brief-e2e` (with the on-disk `outcome_detail` assertion echoed) + the four smokes + thinker-chain/capability/topology e2e; the git-plumbing evidence (head `0013`, no `0014` file, `teams.py`/A-B byte-intact); the Playwright screenshots; deviations (with justification); open questions; the branch name + a `READY_TO_MERGE` line. Commit on a branch `feat/work-brief-run-view` (do NOT push — the operator merges; do NOT sweep `prompts/*.md` or the living docs into your commit).
