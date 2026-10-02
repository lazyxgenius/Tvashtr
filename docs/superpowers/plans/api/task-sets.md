# M9 — Task sets and a check before saving: API contract

Brief: `prompts/m1-m11.md` §4 M9 + rulings R6, R11, R12; addendum `prompts/m8-m11.md` ("R11 is absolute — the hidden
check never appears in any compiled instruction, file, memory or event an agent can read (asserted)"). Boards: Quality ›
`Set-List`, `Set-Edit`, `Set-Results`, `Set-SaveCheck`, `Set-Checked` and the M9 boards `Set-Empty`, `Set-StartSet`,
`Set-Running`, `Set-AddRecent`, `Set-RowMenu`, `Set-DeleteConfirm`, `Set-CheckedWorse`; M8's `Cmp-Start` ("One task |
A task set") and `Cmp-Results` ("One task is a small sample" + "Compare on <set>"). Builds on M8 (`api/compare.md`).

Every new route is owner-scoped (another account → 404) and listed in `test_owner_scope_guard.py`.

## Model (migration **0050**, additive)

- `task_sets`: `id`, `owner_id`, `team_graph_id` (the LIBRARY team, `ON DELETE CASCADE`), `name` (1–80 chars,
  unique per team ignoring case), `created_at`, `updated_at`.
- `task_set_items`: `id`, `task_set_id` (`ON DELETE CASCADE`), `position`, `task` (1–2000), `starts_from` (branch,
  NULL ⇒ the target's default branch), `hidden_check` (1–2000; the command). 1–20 items per set.
- `compares.task_set_id` (nullable, `ON DELETE SET NULL`) — a compare on a set; `compares.task` stays the set's name
  for display. `runs.task_set_item_id` (nullable, `ON DELETE SET NULL`) — which item a set compare's run is for.
- `hidden_check_results`: `run_id` (unique), `passed` bool, `exit_code` int null, `timed_out` bool, `output_tail` text
  (the last 12 lines, secrets masked), `duration_s`, `created_at`. Owner-scoped through the run.
- Version checks (R6) are DERIVED, not stored: a version's set check is the newest finished set compare whose
  `version_b` is that version (A = an earlier version).

## The hidden check (R11)

- Runs for a compare run whose compare has a task set: at the walk's compare terminal, after the run's last step and
  before `finalize_run_step` and teardown, as a PLAIN call (no new DBOS step / workflow) gated on the recorded
  `load_graph_step` dict (`"compare": {"auto_approve": …, "check": true}`), so a workflow recorded before M9 replays
  unchanged. Idempotent: a recovery that finds a `hidden_check_results` row does not run it again.
- Where: in the run's OWN sandbox — Fly: the run's microVM (`_ensure_run_sandbox`, a fresh `/workspace/__check__` dir
  pushed from the host workspace, `execute_command`); docker: a fresh container from the host workspace; LOCAL (dev):
  the host workspace with a process-group kill. Never on the control-plane host in hosted mode.
- Limit 10 minutes (timed out ⇒ failed, "It took more than 10 minutes"); pass = exit code 0; the last 12 lines of output
  kept, masked by `guardrails.mask_secrets`.
- Never reaches an agent: the command is read only by the check runner from `task_set_items`; it is never written to
  `runs.idea`, `compares.task`, `run_events`, `agent_invocations.outcome_detail`, documents, memories, the compiled
  instruction, `AgentTask`, or any workspace file (asserted in tests).
- A set compare's runs stay `running` (slot counted, R12) until the check ends.

## Routes

### `GET /api/teams/{team_id}/task-sets` → `{"sets": [Set…]}`

```json
{"id": "…", "name": "Indicators", "items": [{"id": "…", "position": 1, "task": "Add an RSI indicator",
  "starts_from": "main" | null, "hidden_check": "pytest -q -k rsi"}],
 "last_used": {"compare_id": "…", "a": 6, "b": 7, "at": "…", "summary": "v7 better on 4 of 5"} | null,
 "estimate": {"cost_usd": 5.6, "minutes": 40} | null}
```

### `POST /api/teams/{team_id}/task-sets` `{name, items: [{task, starts_from, hidden_check}]}` → 201 Set ·
### `PATCH /api/task-sets/{id}` (same body; items replaced as a whole) → Set · `DELETE /api/task-sets/{id}` → 204

422 on an empty name / no items / more than 20 / an empty task or check; 409 on a name the team already has. Deleting a
set never deletes compares or runs (their `task_set_id` becomes NULL; History keeps their results).

### Compare on a set (M8 routes, additive)

- `GET /api/teams/{id}/compare` gains `"task_sets": [{"id", "name", "count"}]` and `"last_task"`-free behaviour
  unchanged.
- `POST /api/teams/{id}/compare` accepts `{"a", "b", "task_set_id", "auto_approve"}` instead of `task` (exactly one of
  `task` / `task_set_id`). Hosted: a set whose 2 × N runs can't fit the owner's daily run limit is refused (422, plain
  words). Launch: item by item, both versions of an item together, as two of the owner's run slots free (the M8 waiter
  keeps going until every item is launched; re-armed at startup).
- `GET /api/compares/{id}` gains, for a set compare, `"set": {"id", "name", "count"}`, `"started": n`, `"runs_waiting": m` (M8's `waiting` keeps its shape)
  and `"items": [{"task", "a": Cell, "b": Cell, "badge": "v7 better" | "v7 costs more" | "same" | null}]` where
  `Cell = {"run_id", "status": "waiting"|"running"|"finished"|"failed"|"stopped", "now": "Engineer · round 2" | null,
  "check": "passed"|"failed"|null, "rounds", "cost_usd", "note": "signal line missing" | "stalled, then resumed" | null}`
  (the note is the check's last output line on a failed check, else the run's failure words); and `results` gains
  `"cards": [{"key": "checks"|"rounds"|"cost"|"retries", "label", "a", "b", "note", "tone": "good"|"warn"|null}]`
  (`a` / `b` bare values — the page adds "v6 " / "v7 "; `tone`: B better / worse / neither) ("2 more tasks really work",
  "about 1 fewer round", "$0.90 less in all", "steadier runs") with `rows` empty.
- A one-task compare's `results` gains `"sample": {"set_id", "name", "count"} | null` — the team's set for "One task is
  a small sample · Compare on <set>" (null when the team has none).

### Save and check (R6) — `POST /api/teams/{id}/versions` (M5/M7, additive)

Body gains `"check_set": "<task set id>"`: after the save commits, a compare of the new version vs the previous one on
that set starts (`auto_approve` true); never blocking or failing the save (a refusal is returned as
`"check_started": null` with `"check_error"`). The versions listing gains, per version, `"check": {"compare_id",
"set": "Indicators", "passed": 5, "total": 5, "against": 7, "against_passed": 4, "cost_delta_usd": -0.70, "status": "running"|"finished",
"worse": false, "ended_at": "…" | null} | null` and, at the top, `"check_sets": [{"id", "name", "count", "estimate"}]` for the Save-as dialog.
