# Brief — Option A Milestone 2: the authoring-panel "last run" brief + the `cloned_from_node_id` linkage

> Architect-authored detailed brief. The `/goal` references this file. You (Claude Code) self-decompose the steps; this brief is the precise spec. **Run ALL verification yourself, to green — the operator runs nothing.** Commit on a branch; **never push, never merge** (the operator FF-merges).

---

## 0. Outcome (the one thing this milestone delivers)

The per-node "what I did last run" brief — which M1 surfaced in the **run view** — now also appears in the **authoring view**. Clicking an authored node in `TeamNodePanel` shows, beneath its editable prompt/model/capability, a read-only "Last run" brief of what **that editable node** did the last time it actually executed (across all of the team's runs), tagged with how long ago. A node that has never run reads "No runs yet."

The enabler is a new back-reference column **`agent_nodes.cloned_from_node_id`**: a run executes against a CLONE of the team (clone-on-launch), and today the clone keeps no link back to the origin node, so "what did THIS authored node do" can't be answered (matching clone↔origin by `role_name` shows the WRONG node's brief on duplicate-named nodes). The column lets the authoring graph endpoint join each authored node to its clones' invocations and read the latest one.

---

## 1. Context — current state on disk (read these to confirm before editing)

- **Data model** (`backend/tvashtr/models.py`):
  - `AgentNode` (table `agent_nodes`): `id (Uuid pk)`, `team_graph_id (FK->team_graphs, CASCADE)`, `role_name`, `kind` ("completion"|"agent"|"gate"|"terminal"), `prompt (Text nullable, 0012)`, `model`, `engine`, `position (JSONB)`, `config (JSONB nullable)`, `created_at`. **You will add `cloned_from_node_id`.**
  - `AgentInvocation` (table `agent_invocations`): `id (BigInteger Identity pk)`, `run_id (Text, indexed)`, `node_id (Uuid FK->agent_nodes.id, CASCADE — NOT indexed today)`, `iteration (Integer)`, `status`, `outcome (Text nullable)`, `outcome_detail (Text nullable, 0011 — the brief lives here)`, `started_at (server_default now())`, `ended_at (nullable)`. Unique on `(run_id, node_id, iteration)`.
  - `Run` (table `runs`): `id`, `idea`, `team_graph_id`, `pm_document_id`, `ship_tag`, `status`, `budget_cap_usd`, `budget_overridden`, `pair_id`, `pair_label`, `created_at`, `updated_at`.
- **Clone-on-launch** (`backend/tvashtr/teams.py` → `clone_team_graph`): builds a deep-clone of a library team into a new **non-library** snapshot team graph — fresh node ids, edges remapped onto the new node ids, `deepcopy` on every jsonb, a distinct snapshot name. It builds an origin-node-id → new-node-id mapping while cloning (that mapping is how edges are remapped). `create_run` (in `routers.py`) calls it on the `team_graph_id` path. **This function is currently byte-intact across several slices; M2 legitimately changes it (the one new line that sets the back-reference).**
- **The authoring graph endpoint** (`backend/tvashtr/routers.py`): `GET /api/teams/{id}/graph` returns the authored (library) team's nodes+edges with **no run-state** (P1.8b team library). Node serialization goes through a shared node-dict helper (`_node_base_dict` / the `_team_*` serialization path) that already carries `prompt`. **You augment THIS endpoint's node serialization with `last_run`.**
- **The run-view graph endpoint** `GET /api/runs/{id}/graph` already returns per-node `invocations.outcome_detail` (M1). **Do NOT touch it.**
- **M1's brief content** (`backend/tvashtr/team_run.py`, ADDITIVE-ONLY, already on `main` @ `d568850`): a thinker closes its invocation with `outcome_detail = _thinker_brief(is_first, n)` → "Drafted the spec from the idea." (first/root) or "Refined the spec (version N)." (later); a non-emitting worker (Engineer) with `_worker_brief(files_changed)` → "Built the feature — changed N file(s): …" (cap 5, "+K more") or "Ran but changed no files."; an emitting worker (Reviewer) keeps the verdict reasons. **`team_run.py` is NOT changed by M2 — the executor already populates `outcome_detail`; M2 only adds the linkage + the authoring read surface.**
- **FE** (`frontend/src/`):
  - `SidePanel.tsx` (the **run-view** inspector) contains a local `LastRun` element (takes `outcome` + `outcome_detail`; renders tone via the pure-and-total `reviewerVerdictLabel().tone` + an `OUTCOME_LABELS` text map; styled `tv-lastrun` / `tv-verdict--*`). **You extract this into a shared component.**
  - `TeamNodePanel.tsx` (the **authoring** node panel) shows the prompt textarea + model field + capability segmented control, with a dirty-aware Save (P1.8b/P1.8c). **You add the read-only brief below these.**
  - `App.tsx` switches authoring↔run view on `runId` and re-fetches the authoring team graph on team-load/switch (P1.8b). Confirm the authoring graph is re-fetched when returning to the authoring view after a run, so the brief repopulates without a manual reload; if it is not, make it so.
  - `api.ts` has the authoring `GraphNode` type (carries `prompt`) + `getTeamGraph(teamId)` + `MODEL_PRESETS`. **You add `last_run` to the authoring node type.**
- **Migrations:** `backend/alembic/versions/`, head is **`0013`**. The freeze hook `.claude/hooks/protect-migrations.sh` currently freezes `^00(0[1-9]|1[0-3])_`.
- **Existing live `*-e2e` targets** in the `Makefile` (pattern to copy): `work-brief-e2e`, `topology-e2e`, `thinker-chain-e2e`, `capability-edit-e2e`, `team-edit-e2e`, `team-library-e2e`. They orchestrate backend + Vite like `hitl_demo.sh`, set `TVASHTR_AUTO_APPROVE_GATES=1`, `TVASHTR_AGENT_SANDBOX=local`, and run a Playwright spec under `frontend/e2e/`. The seeded default library team is **"My team"** (a `review_loop`: PM thinker → Engineer worker ⇄ Reviewer worker, with a PRD gate + ship/stop terminals).

---

## 2. Constraints / do-NOT-touch (expressed as on-disk evidence where possible)

- **`backend/tvashtr/team_run.py` MUST be byte-identical to `main`.** Evidence: `git diff main -- backend/tvashtr/team_run.py` is EMPTY. (The executor already writes `outcome_detail`; M2 adds no executor change.)
- **The run-view graph endpoint `GET /api/runs/{id}/graph` is unchanged**, and `last_run` is added ONLY to the authoring endpoint `GET /api/teams/{id}/graph`.
- **A/B endpoints + `_AB_CONFIGS` + `_TEAM_BUILDERS` + the legacy builders (`build_two_node_team`, `build_review_loop_team`, `build_thinker_chain_team`) are byte-intact.** The ONLY changed `teams.py` function is `clone_team_graph` (one added line). These builders build fresh nodes (not clones), so their nodes correctly get `cloned_from_node_id = NULL` and never pollute the authoring brief.
- **Migrations `0001`–`0013` are frozen** — never edit one. Add exactly ONE new migration `0014`. Chain `down_revision` off the current head (read the `0013` file for its revision id). Provide a real downgrade that drops the column **and** both indexes.
- **The engine adapters (`engines/*`) are byte-intact.**
- **No new runtime dependency** (the relative-time formatter is a hand-written pure function, no date library).
- The FF `git diff --stat main <branch>` is the authoritative file-set gate: it must show nothing under `backend/tvashtr/engines/`, no edits to `backend/alembic/versions/0001`–`0013`, exactly one new `0014` file, and `team_run.py` absent from the diff.

---

## 3. Tasks (granular, ordered)

### Backend

1. **`models.py`** — add to `AgentNode`:
   `cloned_from_node_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, index=True)` — a **plain Uuid value, NO `ForeignKey`** (a back-reference value, deliberately not a relational-integrity edge: P1.8d made authored nodes deletable/re-addable, so an FK would force an unwanted cascade/SET-NULL coupling between immutable snapshots and the mutable authored graph; a dangling value simply matches nothing). Add a clear docstring comment.
2. **Migration `0014`** (`backend/alembic/versions/0014_agent_node_cloned_from.py`):
   - `down_revision = "0013"` (confirm against the actual `0013` revision id on disk).
   - `upgrade`: `op.add_column("agent_nodes", sa.Column("cloned_from_node_id", sa.Uuid(), nullable=True))`; `op.create_index("ix_agent_nodes_cloned_from_node_id", "agent_nodes", ["cloned_from_node_id"])`; **and** `op.create_index("ix_agent_invocations_node_id", "agent_invocations", ["node_id"])` (the unindexed join key the read needs).
   - `downgrade`: drop both indexes, then drop the column.
   - Additive, nullable, no backfill. Verify an empty-autogenerate round-trip (ORM↔DB agree) after running it.
3. **`teams.py` → `clone_team_graph`** — when creating each cloned node, set `cloned_from_node_id` to the **source (origin) node's id** (the function already has the origin node in hand while building the origin→new id map). One line. Every cloned node (including gate/terminal) gets it set, uniformly. Leave everything else in the function byte-identical (the deepcopy, the edge remap, the snapshot name). (You may optionally refresh the stale `PERSISTENT_TEAM_NAME` comment registered in §15 — but ONLY if trivial and clearly safe; otherwise leave it.)
4. **`routers.py` → augment `GET /api/teams/{id}/graph`** so each node in the response carries a nested
   `last_run: {outcome: str|None, outcome_detail: str|None, run_id: str, iteration: int, started_at: <iso>} | None`.
   - Compute it with ONE query over all the team's current node ids (NOT N queries), Postgres `DISTINCT ON`:
     ```sql
     SELECT DISTINCT ON (clone.cloned_from_node_id)
            clone.cloned_from_node_id AS origin_id,
            inv.outcome, inv.outcome_detail, inv.run_id, inv.iteration, inv.started_at
     FROM agent_invocations inv
     JOIN agent_nodes clone ON inv.node_id = clone.id
     WHERE clone.cloned_from_node_id = ANY(:authored_node_ids)
     ORDER BY clone.cloned_from_node_id, inv.started_at DESC
     ```
     Express it via SQLAlchemy 2 (`select(...).distinct(AgentNode.cloned_from_node_id).order_by(AgentNode.cloned_from_node_id, AgentInvocation.started_at.desc())` with the join + `where(... .in_(ids))`).
   - Build a `{origin_id -> last_run_dict}` map from the result; for each node in the graph response, attach its `last_run` (or `None` if absent). Nodes that have never run simply aren't in the map → `None`.
   - This is the AUTHORING endpoint only. Do NOT add `last_run` to the run-view endpoint.

### Frontend

5. **Extract `LastRun` into `frontend/src/components/LastRun.tsx`** — move the existing run-view `LastRun` (its `OUTCOME_LABELS` map + the `reviewerVerdictLabel().tone` usage) into a shared component. Add an **optional** `provenance?: { startedAt: string; runId: string }` prop: when present, render a muted relative-time tag (e.g. "ran 2h ago"); when absent, render exactly as before. Import it in `SidePanel.tsx` (run-view — pass NO provenance, so the render is byte-identical; `SidePanel.test.tsx` must still pass unchanged) and in `TeamNodePanel.tsx` (authoring).
6. **Relative-time formatter** — `frontend/src/lib/time.ts`: a pure `formatRelativeTime(iso: string): string` ("just now" / "{n}m ago" / "{n}h ago" / "{n}d ago" / a short date past ~7d). No dependency.
7. **`api.ts`** — add `last_run?: { outcome: string | null; outcome_detail: string | null; run_id: string; iteration: number; started_at: string } | null` to the authoring `GraphNode` type.
8. **`TeamNodePanel.tsx`** — below the editable prompt/model/capability fields, render a read-only "Last run" section:
   - if `node.last_run` is present → `<LastRun outcome={...} outcomeDetail={...} provenance={{ startedAt, runId }} />`;
   - if `null` → a muted "No runs yet."
   - The brief is **NOT** part of the dirty-check (it's historical, read-only — editing the prompt must not mark it dirty, and Save must not touch it).
9. **`App.tsx`** — ensure the authoring team graph (now carrying `last_run`) is fetched on team-load, team-switch, AND when returning to the authoring view after a run terminates, so the brief repopulates automatically. If the existing re-fetch already covers the return-to-authoring case, leave it; otherwise add it.

### Tests (must be mutation-real — assert specific values; show RED-on-mutation in the transcript)

10. **Backend keystone** (`backend/tvashtr/.../test_authoring_brief.py` or extend the M1 test module):
    - **(linkage end-to-end)** Create a library team (use `review_loop`). `POST /api/runs` with its `team_graph_id` (this clones it). Drive the real `run_team` to completion with faked agents (reuse the M1 `test_work_brief_executor.py` faking pattern — fake `complete` + the worker so the REAL executor runs and writes invocations + `outcome_detail` on the CLONE nodes). Then `GET /api/teams/{authored_id}/graph` and assert: the authored PM (thinker) node's `last_run.outcome_detail == "Drafted the spec from the idea."`; the authored Engineer (worker) node's `last_run` is populated with the files brief; a never-run/extra authored node's `last_run is None`.
    - **(decision-b robustness — the property that justifies "per-node latest across runs")** Run the team a SECOND time but arrange that one node does NOT execute in the second run (e.g. the second run fails/stops before reaching it). Assert that node's authoring `last_run` STILL reflects the FIRST run's invocation (the last time it actually ran) — NOT blank. Conversely, a node that DID run in the second run shows the second run's invocation (proving `ORDER BY started_at DESC` picks the latest, not arbitrary).
    - **(mutation proof)** Revert the `clone_team_graph` `cloned_from_node_id` set → the join matches nothing → every authored node's `last_run` is `None` → the assertions FAIL. Show RED, then restore GREEN.
11. **FE vitest:**
    - `LastRun.test.tsx`: renders `outcome_detail` + the correct tone; with `provenance` renders the relative time; without `provenance` renders identically to the run-view (the existing `SidePanel.test.tsx` assertions still hold).
    - `TeamNodePanel.test.tsx`: a node with `last_run` renders the brief + provenance below the editable fields; a node with `last_run: null` renders "No runs yet"; editing the prompt does NOT mark the brief dirty / the brief is read-only.
    - `time.test.ts`: relative-time formatter boundary cases (minutes/hours/days/old).
12. **Live e2e** — add `make authoring-brief-e2e` (Makefile target + a Playwright spec under `frontend/e2e/`, patterned on `work-brief-e2e`/`topology-e2e`): orchestrate backend + Vite, `TVASHTR_AUTO_APPROVE_GATES=1`, `TVASHTR_AGENT_SANDBOX=local`, real NIM (`TVASHTR_AGENT_MODEL=nvidia_nim/meta/llama-3.3-70b-instruct`). Steps: open the seeded **"My team"** (review_loop) in the authoring view → "Run this team" → wait for the run to reach a terminal (ships) → return to the authoring view → click the **PM (thinker) node** → assert the "Last run" section shows **"Drafted the spec from the idea."** plus a relative-time provenance tag. (No field edit is needed → no dirty-Save hazard. The thinker brief is deterministic and meaningful on the LOCAL path — the worker files-changed path is already covered by M1's docker-pull reasoning + the offline non-empty variant, so this e2e proves the **linkage + surface + the view-switch re-fetch**, not the adapter again.) **Capture a screenshot of the authoring panel showing the brief** as a self-sign-off artifact.

### Last step

13. **Bump the freeze** — `.claude/hooks/protect-migrations.sh` regex → `^00(0[1-9]|1[0-4])_` (now freezing `0001`–`0014`). Do this LAST, after `0014` is verified.

---

## 4. Acceptance / evidence — run every check yourself, debug to green, echo each into the chat

- `make db-up` → Postgres (+ proxy) up.
- `make migrate` → alembic head **`0014`**; empty-autogenerate round-trip clean.
- `make test` → all green and the count grows (the keystone + the decision-b test + any unit tests); **show the keystone RED-on-mutation** (revert `clone_team_graph`'s set → fail → restore → pass) in the transcript.
- `make lint` → clean.
- `make test-frontend` → vitest green, count grows.
- `make build-frontend` → clean (tsc-strict, no `eslint-disable`/`any` escapes).
- `make authoring-brief-e2e` → GREEN on real NIM (local sandbox); screenshot captured.
- Regression smokes GREEN: `make skeleton-run`, `make skeleton-crash`, `make loop-run`, `make loop-crash` (proves the clone path + migration didn't break shipping/crash-resume).
- Regression e2es GREEN (features M2 doesn't touch, confirm no regression): `make thinker-chain-e2e`, `make capability-edit-e2e`, `make topology-e2e`, `make work-brief-e2e`.
- Invariant evidence: `git diff main -- backend/tvashtr/team_run.py` EMPTY; the branch's `git diff --stat main <branch>` shows the expected set (one `0014`, nothing under `engines/`, no frozen-migration edits, `team_run.py` absent).
- A `READY_TO_MERGE` line at the end with the branch name + tip sha.

## 5. Playwright notes (bake into the e2e)

- The Playwright **MCP** full-accessibility `browser_snapshot` WEDGES on the large React Flow canvas — if you drive the canvas interactively, use **targeted `browser_evaluate` on specific selectors + screenshots**, NOT a whole-tree snapshot. The `make authoring-brief-e2e` scripted spec uses targeted selectors anyway (pattern off the existing specs).
- Reaching the brief needs NO dirty-aware Save, so the M1 "disabled-Save-hangs-the-proof" trap does not apply here. (If you ever add a field edit, change the field to a value KNOWN to differ from the seeded default, per the M1 lesson — but you should not need to.)

## 6. Stop conditions

- Write `NEEDS_HUMAN` to `STATE.md` and STOP on a genuine external blocker (NIM unreachable / credits exhausted; an unresolvable schema or migration conflict) or a hard turn cap.
- Distinguish: **a second/unknown problem that would need a broad or unproven change → STOP + `NEEDS_HUMAN`**; **a code-proven, contained, regression-guarded fix → you may proceed** (and document exactly what you changed and why, with the proof).

## 7. Report-back

Files changed (grouped), commands run WITH output (incl. `make test`/`make lint`/`make test-frontend`/`make build-frontend` + every live target), the keystone RED-on-mutation demonstration, the e2e screenshot path, any deviations from this brief with justification, open questions, and the `READY_TO_MERGE` line. Commit on `feat/m2-authoring-brief-linkage`; **do not push, do not merge.**
