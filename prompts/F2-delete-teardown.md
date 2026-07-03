# F2-delete — Deleting a team stops its run and removes the team + its runs (backend-only)

**Runs AFTER F2b** (both touch the teams path). **Backend only. NO migration** (app-level deletes;
no schema change).

**Why.** Today `DELETE /api/teams/{team_id}` only removes the library team; a run of that team keeps
executing on its immutable clone and keeps spending — a zombie run under a deleted team. That is the
bug. The operator's rule: **deleting a team stops any run it has in progress and removes the team AND
its runs from existence.** Nothing tied to a deleted team keeps running, spending, or existing.

**The two facts that shape the teardown** (verified on disk):
- Stopping a run = the cancel core in `cancel_run` (`routers.py`): `DBOS.cancel_workflow(run_id)`
  flips the workflow to CANCELLED (aborts at its next boundary; recovery won't resurrect it) + set
  `Run.status="cancelled"` + close the run's pending `HumanTask`s (`resolution="cancelled"`). An
  already-terminal run is left untouched. **Extract this into a shared helper** so `cancel_run` and
  `delete_team` call the SAME logic (don't duplicate it).
- The run-scoped tables (`cost_records`, `run_events`, `agent_invocations`, `human_tasks`,
  `engineer_run_attempts`) link to a run by a **plain text `run_id`** — NO FK cascade. And
  `runs.team_graph_id` (→ the clone) has **no** `ondelete=CASCADE`. So the teardown is an explicit,
  ordered multi-table delete, not one automatic cascade. (A clone graph's own `agent_nodes`/`edges`
  DO cascade when the clone graph is deleted.)

---

## 1. The new delete behavior

`DELETE /api/teams/{team_id}` (owner-scoped; still 400 on a malformed id, 404 on a non-library team):

1. **Enumerate the team's runs.** Use the SAME clone→origin link F2b uses (a run → its clone graph →
   the clone's nodes' `cloned_from_node_id` → this library team's nodes). Reuse F2b's helper /
   `_latest_invocation_by_origin`'s pattern to get this team's run ids (ALL of them) + their clone
   graph ids.
2. **Stop the in-flight ones.** For each of the team's runs that is NOT already terminal, apply the
   shared cancel helper (cancel the workflow + status→cancelled + close its pending tasks).
3. **Tear the runs down.** For each of the team's runs, in FK-safe order: delete its `cost_records`,
   `run_events`, `agent_invocations`, `human_tasks`, `engineer_run_attempts` (by `run_id`), then the
   `Run` row, then its clone `TeamGraph` (its nodes/edges cascade). Grep for EVERY table keyed by
   `run_id` and include each — a missed table = an orphan (the isolation test must prove none remain).
4. **Delete the library team.** As today (its `agent_nodes`/`edges` cascade).

Do it transactionally / safely-ordered so a failure can't half-delete. **Owner-scoped throughout** —
only the current account's team + its own runs; never another team's or another account's data.

Update the endpoint's docstring — the old "Safe: a Run points at its immutable clone snapshot… so no
run is orphaned" line is now OBSOLETE (we deliberately stop + delete the runs).

---

## 2. Invariants / do-not-touch (verify on disk)

- **NO migration.** Alembic head stays `0018`. Nothing under `backend/alembic/`.
- **NO frontend change.** Nothing under `frontend/`. The endpoint's URL + method are UNCHANGED (the
  FE delete button + confirm dialog are F2c) — only its behavior grows.
- **Executor + validity untouched:** `git diff main -- backend/tvashtr/control_plane/team_run.py backend/tvashtr/control_plane/graph_validity.py` is EMPTY.
- The F2a builders/catalog + the F2b summary enrichment are already on `main`; don't touch them
  beyond calling F2b's linkage helper.

---

## 3. Tests (reproduce-first + coverage)

**Reproduce-first (prove the bug):** a test that, on the PRE-CHANGE delete, a team's non-terminal run
SURVIVES deleting the team (the run row + its clone + its cost rows still exist, status still
running). Confirm it FAILS to show the desired state on current code; the fix makes it pass (run
cancelled + everything gone). Set the "in-flight" run up faithfully — a real clone of the team (reuse
the actual clone helper) + a `Run` row in a non-terminal status pointing at it + a few real
`cost_records`/`run_events`/`human_tasks` rows for it — so the teardown is exercised for real (no
faked shortcut). Assert after DELETE: the run was marked `cancelled` (and the cancel core was
invoked), and the run row + ALL its run-scoped rows + its clone graph are GONE, and the library team +
its nodes/edges are GONE, with no error.

Also cover:
- **Completed run** → deleting the team removes the run + its records + its clone too.
- **Never-run team** → delete still works (no runs to stop/purge); team + nodes/edges gone.
- **Isolation** → deleting team A leaves team B's runs/records/clones fully intact, and leaves another
  account's data untouched. Prove NO run-scoped orphan rows remain for the deleted team (count == 0
  across every `run_id`-keyed table).
- **Re-point** the existing delete test in `test_team_library.py` if its expectations change.

---

## 4. Acceptance / evidence (run it all yourself; echo each into the chat)

1. `make test` (backend) — ALL pass; report the new pass count.
2. `make lint` — clean.
3. Echo a create→(insert a run + records)→DELETE→re-query sequence proving the run + its records +
   its clone are gone AND the run was cancelled, plus a sibling team's data still present.
4. **Byte-intact proof** — echo the empty diffs for `team_run.py` + `graph_validity.py`.
5. Branch `feat/f2-delete-teardown`; end with a `READY_TO_MERGE` line.

## 5. Stop conditions
- A contained, ordered, regression-guarded teardown that stays inside this brief → proceed to green.
- If safely stopping + deleting a run needs a BROAD or UNPROVEN change (a DBOS concurrency problem you
  can't contain; a table you can't safely delete from; anything requiring a migration) → write
  `NEEDS_HUMAN` to `STATE.md` with the specifics and STOP.
- Hard cap: 30 turns. On the cap, write the blocking reason to `STATE.md` and stop.
