# M8 — Compare two versions: API contract

Brief: `prompts/m1-m11.md` §4 M8 + ruling R5, addendum `prompts/m8-m11.md` (M8 note). Boards: Quality ›
`Cmp-Start`, `Cmp-Running`, `Cmp-Results` and the M8 boards added for the undrawn states (`Cmp-OneVersion`,
`Cmp-Queued`, `Cmp-NeedsYou`, `Cmp-SideFailed`, `Cmp-StopConfirm`, `Cmp-Versions`).

Every route is owner-scoped (another account → 404, never 403), listed in `test_owner_scope_guard.py`.

## Model

- Migration **0049** `compares`: `id uuid pk` (= the runs' `pair_id`), `owner_id`, `team_graph_id` (the LIBRARY team,
  `ON DELETE CASCADE`), `version_a int`, `version_b int`, `task text`, `auto_approve bool not null default true`,
  `repo text null`, `base_ref text null` (the GitHub target, NULL ⇒ greenfield), `status text` (`waiting` | `running`
  | `finished` | `stopped`), `stop_requested bool default false`, `created_at`, `started_at null`, `ended_at null`.
  Index `(team_graph_id, created_at desc)`. Additive only; `runs` gains nothing (the A/B `pair_id` / `pair_label`
  columns link a run to its compare: `pair_id = compares.id`, `pair_label = 'A' | 'B'`).
- A compare run is an ordinary run (own team snapshot, own workspace / clone, own DBOS `run_team` workflow) with:
  its snapshot built from **version N's stored graph** (`team_versions.graph`), never from the working copy;
  `team_version_number = N` set directly (never `versions.for_run`, which would save a new version);
  `library_team_id` = the team; the same idea (`task`), budget cap and target (repo/base_ref) on both sides.
- R5: **no Ship** (no commit, no branch push, no PR) and gates **approved automatically** unless the compare says
  otherwise — without a new DBOS step or workflow:
  - `load_graph_step`'s recorded dict gains `"compare": {"auto_approve": bool} | None` (from the run's `pair_id`
    matching a `compares` row). A workflow recorded before M8 replays a dict without it.
  - At the ship terminal the walk (`run_graph`, a plain function) checks `graph.get("compare")`: a compare run
    calls no ship / push / bundle step; it finalizes `completed` with no PR. Its Ship invocation closes with
    outcome `compare`, the Activity's end line reads "Finished · no pull request in a compare" and its `summary`
    names no `branch` (a hosted run's setup branch is never pushed) and no PR. It also
    distils no memory (no `distill_run_memory_step` / `ingest_agent_remembers_step`): a compare run is a trial
    of a version, not the team's work.
  - `gate_auto_resolution_step`'s BODY also answers "approved" for a `gate:` topic of a compare run with
    `auto_approve` (budget breaches still ask a person). Its recorded output replays as before for runs in flight.
  - A compare run is never resumed (a resumed run would be an ordinary run, and ship): `GET /api/runs/{id}/resume`
    answers `available: false`, reason "A compare run can’t be picked up again. Start a new compare instead.",
    `POST` 409s with it and the run view's failed / stopped callout offers no Resume.
- R5 caps (R12: compare runs count fully, like any run): a compare starts BOTH runs together when the hosted
  ceilings have room for two (`_enforce_run_ceilings(launching=2)` succeeds). When only the owner's own run slots
  are full (code `owner_concurrency_limit`, what Cmp-Queued draws) the compare is `waiting` (no run rows yet) and a
  plain daemon waiter (no DBOS; like M7's replays) starts both as soon as two slots are free, polling every 5 s;
  waiters are re-armed on app startup for every `waiting` compare. The fleet (`global_concurrency_limit`) and daily
  (`owner_daily_limit`) caps refuse the POST with the same 429 body `POST /api/runs` gives (no compare is made); a
  waiter that later meets either keeps waiting. Self-hosted (no ceilings) ⇒ always immediate.
- Targets: the team's own repo (`team_graphs.repo`, M4), else the newest GitHub-repo run of the team, else none
  (greenfield). A Desktop-folder target is not offered. Hosted mode only (`POST /api/runs` takes `github_repo`
  only there); self-hosted compares are greenfield. At launch the repo is checked against the owner's GitHub
  installations exactly as `POST /api/runs` checks it (a team file can name any repo); a missing `base_ref`
  is the repo's default branch.
- One `waiting` or `running` compare per team: a partial unique index (`uq_compares_team_active`) backs the 409.
- Deleting the team (`DELETE /api/teams/{id}`) stops its `waiting` / `running` compare FIRST (as Stop does), before
  its runs are cancelled, so a waiter never starts two runs in the slots those cancels free; the waiter re-checks
  under the compare's row lock that the compare is still `waiting` and the team still exists.
- A running compare becomes `finished` when both runs have ended — set when it is read (the page, the 409
  check, Stop); nothing watches it.

## Routes

### `GET /api/teams/{team_id}/compare`

The Compare tab. 404 for another account's team / a non-library team.

```json
{
  "team": {"id": "…", "name": "Indicator sprint team"},
  "versions": [
    {"number": 7, "when": "2026-10-02T…", "runs": 1, "summary": "Reviewer: stricter about the INDICATORS registry",
     "current": true}
  ],
  "defaults": {"a": 6, "b": 7},            // previous vs current; null a when there is one version
  "changes": 1,                             // diff(version a graph, version b graph) row count for the defaults
  "target": {"repo": "lazyxgenius/trade_mcp", "base_ref": "main"} | null,
  "estimate": {"cost_usd": 2.3, "minutes": 25} | null,  // null: no finished run of either version yet
  "latest": {"id": "…", "status": "running"} | null       // the newest compare of this team (the page opens it)
}
```

`GET /api/teams/{team_id}/compare/changes?a=6&b=7` → `{"a": 6, "b": 7, "rows": [ …versions.diff rows… ],
"summary": "…"}` (the "1 change" link opens M5's What changed with these rows). 404 for an unknown version.

### `POST /api/teams/{team_id}/compare`

Body `{"a": 6, "b": 7, "task": "Add an RSI indicator", "auto_approve": true}`. 422 when `a == b`, a version is
unknown, the task is empty, or the launch pre-flight fails on either side's snapshot (the graph-validity check
and `_launch_preflight`: not runnable / missing provider key / unservable model — the same 422 bodies as
`POST /api/runs`), or the target repo is not in the owner's installations (same body as `POST /api/runs`). 409 while another compare of this team is `waiting` or
`running`. 429 (the body of `POST /api/runs`) when the fleet or the daily cap is full; only full run slots of
your own make it wait. → **201**

```json
{"id": "…", "status": "running" | "waiting", "runs": [{"label": "A", "version": 6, "run_id": "…" | null}, …]}
```

`run_id` is null while the compare waits.

### `GET /api/compares/{compare_id}`

Polled every 2 s (R15) by the running page.

```json
{
  "id": "…", "team_id": "…", "task": "Add an RSI indicator", "auto_approve": true,
  "status": "waiting" | "running" | "finished" | "stopped",
  "elapsed_s": 1150, "cost_usd": 2.02, "created_at": "…", "ended_at": null,
  "waiting": {"in_use": 3, "limit": 3} | null,        // status waiting: the owner's slots
  "sides": [
    {
      "label": "A", "version": 6, "run_id": "…" | null, "number": 12 | null,
      "status": "waiting" | "running" | "needs_you" | "finished" | "failed" | "stopped",
      "elapsed_s": 1150, "cost_usd": 1.10,
      "strip": [ …the run's progress chips, the same shape Home's RunProgressStrip gets… ],
      "current": {"label": "Engineer", "text": "round 3"} | {"label": "Approved", "text": "in round 2"} | null,
      "lines": [ …the run's last 4 Activity lines (activity.py line objects)… ],
      "gate_task_id": 41 | null
    }
  ],
  "results": null | {
    "headline": "v7 did better on this task",
    "rows": [
      {"key": "result", "label": "Result", "a": "Approved in round 4", "b": "Approved in round 2",
       "better": "b", "difference": "2 fewer rounds"},
      {"key": "cost", "label": "Cost", "a": "$1.48", "b": "$0.92", "better": "b", "difference": "−$0.56"},
      {"key": "time", "label": "Time", "a": "31m 12s", "b": "16m 02s", "better": "b", "difference": "−15m"},
      {"key": "repo_tests", "label": "Repo tests passing", "a": "41 of 41", "b": "41 of 41", "better": null,
       "difference": "same"},
      {"key": "agent_tests", "label": "Reviewer’s tests", "a": "4 of 6", "b": "5 of 6", "better": "b",
       "difference": "+1"},
      {"key": "retries", "label": "Retries and stalls", "a": "2 retries", "b": "none", "better": "b",
       "difference": ""},
      {"key": "files", "label": "Files changed", "a": "2", "b": "2", "better": null, "difference": ""}
    ],
    "current_version": 7, "restore": 6 | null
  }
}
```

Result values: "Approved in round N" (the reviewer approved), "Finished in round N" (no reviewer), "Failed: <the
run's failure words>", "Stopped". Rounds = the highest round of the run's looping agent. Cost/Time/"better" only when
both finished. Repo tests = the run's last `tests` Activity line ("N of M"; "—" when none). Agent tests = M7's
per-version results of an agent that has tests ("<Agent>’s tests"; the row is left out when no agent has tests).
Retries and stalls = counts of the run's host `retry` and `stalled` events ("none", "2 retries", "1 stall",
"2 retries, 1 stall"). Files changed = files in the run's newest M3 checkpoint diff. The headline is factual: both
finished → "vB did better on this task" / "vA did better on this task" when one side has more better rows, else
"vA and vB did about the same"; one failed → "vA finished; vB failed on this task" (a side that ended stopped:
"… stopped on this task"); neither finished → "Neither version finished this task"; stopped → "You stopped this
compare". `restore` = the better version when it is not the current version, else null.

Built details: the values always show; `better` and `difference` only when both finished (else null / "").
Result: approval first — an "Approved" side beats a "Finished" one (`better` set, no `difference`); the rounds
decide only between two sides in the same state.
`difference` is B against A: rounds "2 fewer rounds" / "1 more round"; cost "−$0.56" (within a cent: "same");
time "−15m" (within a minute: "same", no mark); tests "+1" / "same". Retries and stalls: fewer is better, no
difference text. Files changed: never marked ("—" with no checkpoint). The agent-tests row is the agent with the
most tests, from its newest finished test run on each version ("—" when none). A compare stopped while waiting
has `results` with `rows: []`. `sides[].strip` is exactly Home's progress chips (`run_views._progress`).
`sides[].current`: a working step `{"label": "Engineer", "text": "round 3"}`, a gate waiting
`{"label": "<gate>", "text": "waiting for you"}`, an ended run `{"label": "Approved" | "Finished" | "Failed" |
"Stopped", "text": "in round N"}`.

### `POST /api/compares/{compare_id}/stop`

Stops a waiting or running compare: both runs end Stopped (the existing Stop path, sandboxes released), the compare
`stopped`. Idempotent. → `{"status": "stopped"}` (a compare that had already finished answers
`{"status": "finished"}` and is left as it is).

### `GET /api/runs/{run_id}` and run lists

Additive: a compare run's payload gains `"compare": {"id": "…", "label": "A", "version": 6}`.
