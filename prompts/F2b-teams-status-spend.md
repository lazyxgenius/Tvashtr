# F2b — Enrich the teams list with per-team status + spend (backend-only)

**Runs AFTER F2a merges** (both touch `teams.py`, so they must be sequential, not parallel).

**Milestone.** Give the single dashboard teams table its two new columns — **Status** and **Spend** —
by enriching the existing teams list so every library-team summary also carries its latest run's
status and its total spend. **Backend only. NO migration** (the link already exists in the schema; we
only READ it). **NO frontend change** — the FE type + render is F2c.

**The model (from the operator).** "A run is a team that ran." One library team can be run many
times (each run clones the team and runs the copy). So a team's **Status = its most recent run's
status**, and its **Spend = the total across all its runs**. Never run → status `null` (the FE shows
"Not run yet") + spend `0`.

**The link (already proven in-repo).** A run points at an immutable CLONE of the library team
(`runs.team_graph_id` = the clone). The clone's nodes carry `cloned_from_node_id` back to the origin
library-team nodes. So: run → clone graph → clone node → `cloned_from_node_id` → origin node →
origin `team_graph_id` (the library team). The endpoint `_latest_invocation_by_origin` in `routers.py`
ALREADY does exactly this clone→origin join (for the per-node "last run" brief) — **mirror its shape**.

---

## 1. The enrichment

The single summary builder is `_team_summary(session, graph)` in
`backend/tvashtr/control_plane/teams.py`; `list_library_teams` and `get_team_summary` both go through
it. Enrich **`_team_summary`** so every summary path (list + create + seed) returns the same enriched
shape. Add to each team's summary dict:

- `last_run`: `{"status": <str>, "at": <iso8601>, "run_id": <str>}` — the MOST RECENT run (max
  `created_at`) across ALL clones of this library team — or **`null`** if the team was never run.
  (`at` = the run's `created_at`.)
- `spend_usd`: a number — the SUM of `runs.cost_total_usd` (treat NULL as 0) across ALL runs of ALL
  clones of this library team. `0` (or `0.0`) when never run.

Do it **without N+1**: one batched query mapping origin-library-team-id → `{latest_run, spend_sum}`
for all of the owner's library teams at once (mirror `_latest_invocation_by_origin`'s `DISTINCT ON` /
group-by pattern). A clone has many nodes, so the run join fans out — de-dup to one row per run before
aggregating.

**Owner-scoped + library-only** (same as the current list): a team's summary must only reflect runs of
ITS OWN clones; another team's runs and another account's runs never leak in.

---

## 2. Invariants / do-not-touch (verify on disk)

- **NO migration.** Alembic head stays `0018`. Nothing under `backend/alembic/`.
- **NO frontend change.** Nothing under `frontend/`. (The `TeamSummary` TS type + the render are F2c.)
- **Read-only.** No new columns, no writes — only SELECTs over `runs` + `agent_nodes` + `team_graphs`.
- **Only the summary path changes.** The F2a builders/catalog are already on `main`; do NOT touch them.
  The `teams.py` diff is confined to `_team_summary` (+ any new private join helper it calls).
- **Executor + validity untouched:** `git diff main -- backend/tvashtr/control_plane/team_run.py backend/tvashtr/control_plane/graph_validity.py` is EMPTY.

---

## 3. Tests to add

Build the test runs via the **REAL clone path** (clone the library team the way a launch does — reuse
the actual clone helper — then insert a `Run` pointing at the clone with a `status` and a
`cost_total_usd`), so the test exercises the genuine `cloned_from_node_id` link, NOT a hand-faked
shortcut that bypasses the join. Cover:

1. **Never run** → the team's summary has `last_run == null` and `spend_usd == 0`.
2. **One run** (status `S`, cost `C`) → `last_run.status == S`, `last_run.run_id` matches, `spend_usd == C`.
3. **Multiple runs** → `last_run` is the MOST RECENT by `created_at`; `spend_usd` == the SUM of all
   their `cost_total_usd` (with a NULL cost counted as 0).
4. **Isolation** → a second library team's runs, and a second owner's runs, do NOT appear in this
   team's `last_run`/`spend_usd`.
5. **Endpoint shape** → `GET /api/teams` returns each team with the `last_run` + `spend_usd` fields
   (a run team and a never-run team in the same response).

---

## 4. Acceptance / evidence (run it all yourself; echo each into the chat)

1. `make test` (backend) — ALL pass; report the new pass count (was the F2a floor).
2. `make lint` — clean.
3. Echo the `GET /api/teams` payload for an account that has one RUN team + one never-run team,
   showing `last_run` populated on the first and `null` on the second, and the `spend_usd` numbers.
4. **Read-only proof** — echo the empty diffs for `team_run.py` + `graph_validity.py`, and the scoped
   `teams.py` diff confirming only `_team_summary` (+ a private helper) changed.
5. Branch `feat/f2b-teams-status-spend`; end with a `READY_TO_MERGE` line.

## 5. Stop conditions
- A contained read-only join that stays inside this brief → proceed to green.
- If enriching the summary seems to need a NEW column / migration, or any executor/builder edit →
  write `NEEDS_HUMAN` to `STATE.md` with the specifics and STOP (it should NOT — the link is the
  existing `cloned_from_node_id`).
- Hard cap: 30 turns. On the cap, write the blocking reason to `STATE.md` and stop.
