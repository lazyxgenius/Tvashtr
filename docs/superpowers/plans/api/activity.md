# API — the run view's Activity (M2, brief §4 M2, R10, R15)

One owner-scoped endpoint feeds the Now bar, the Activity panel, the pinned callout and the node
cards' activity line. Polled every 2 s (R15). The words are made here, server-side, in
`control_plane/activity.py` (which extends `live_state.activity_line`): the ONE place the run view's
plain words come from. `frontend/src/lib/events.ts summarizeEvent` keeps serving the drawer's Raw log
only.

## `GET /api/runs/{run_id}/activity?after=<cursor>`

404 unless the run belongs to the caller (`_require_owned_run`). `after` is the `cursor` of a previous
reply: only lines newer than it come back (`lines`), everything else is always whole. No `after` ⇒
every line.

**Cursor (as built).** A line can still change while its step runs: a running `command` (it gains
its result, and may become a `tests` line) and a step's last `read` group (it grows). The `cursor`
never passes such a line, so every poll re-sends it until it is final — **the client upserts lines
by `id`** (ids are stable; `kind`/`text`/`refs` of a re-sent line may differ). `cursor` is `""` when
the very first line is still changing (send no `after`). An `after` the server doesn't recognise ⇒
every line.

```jsonc
{
  "run_id": "…",
  "status": "running",            // the run's status
  "live_state": "working",        // the run's worst step (M1), or done/failed/stopped
  "cursor": "2026-10-02T10:45:20.123456+00:00|ev:1234",  // pass back as ?after=
  "total": 21,                    // lines in the whole run
  "agents": [                     // one per graph node, left to right (canvas x, then y); kind: agent|completion|gate|ship|stop|domain_query
    {
      "node_id": "…", "origin_node_id": "…", "label": "Engineer", "kind": "agent",
      "iteration": 2, "rounds_limit": 3,          // rounds_limit: the loop limit on its back-edge, else null
      "live_state": "running_command",            // waiting|working|running_command|needs_you|retrying|quiet|stalled|failed|done|stopped
      "activity": "Running a command: python -m pytest -q",  // see "Agent activity" below
      "last_event_at": "…", "activity_started_at": "…",
      "retry": {"attempt": 2, "of": 3, "next_at": "…"} | null,
      "backup_model": "openai/gpt-4.1-mini" | null,
      "model": "anthropic/claude-sonnet-4"
    }
  ],
  "lines": [
    {
      "id": "ev:1234",                    // stable: ev:<run_events.id> | task:<id>:open|done | inv:<id>:start|end | doc:<document_id>:v<n> | run:start|done|pr
      "at": "…",                          // ISO
      "node_id": "…" | null,              // null = the run itself ("Run")
      "label": "Engineer",                // the node label, or "Run"
      "iteration": 2 | null,
      "kind": "edited",                   // see "Line kinds"
      "text": "Edited core/indicators.py",// the plain line (never model reasoning)
      "tone": "neutral",                  // neutral | ok | warn | danger
      "refs": { … }                       // per kind, below
    }
  ],
  "pinned": {                             // the one thing needing action, or null
    "kind": "gate" | "retrying" | "stalled" | "failed",
    "node_id": "…", "label": "Engineer",
    "title": "The approval gate is waiting for you",
    "body": "Read the spec, then approve or reject it. …",
    "task_id": 12 | null,                 // gate: the human task to resolve
    "backup_model": "openai/gpt-4.1-mini" | null,  // retrying: what "Switch to the backup model now" switches to
    "gate_kind": "prd_approval" | null    // gate: the task's kind (prd_approval | ship_approval | review_escalation | budget_approval | …); else null
  } | null,
  "summary": {                            // a finished run only (status completed), else null
    "pr_url": "…" | null, "pr_number": 42 | null, "rounds": 3, "elapsed_s": 1358, "cost_usd": 1.12,
    "branch": "tvashtr/run-12" | null,    // Run.ship_branch
    "base_ref": "main" | null,            // Run.base_ref — "branch tvashtr/run-12 → main"
    "tests_passed": 41 | null             // `passed` of the run's last `tests` line ("41 tests passing")
  } | null
}
```

## Agent activity (`agents[].activity` / `last_event_at`)

- **Running** step: M1's live block as-is (`live_state.node_live`) — e.g. "Running a command: …",
  "Asked the model for the next step", the retry line.
- **Finished** (done / failed / stopped): the text of that agent's last line in this run (PM "Wrote
  the spec (v2)", Reviewer "Asked for 2 fixes: …", Engineer "Ran the tests: all 41 passed"), and
  `last_event_at` = that line's `at`. A finished step with no line keeps `null`.
- **Gate**: open ⇒ `live_state` `needs_you`, activity "Waiting for you", `last_event_at` = when the
  task opened; decided ⇒ "You approved" / "You rejected" (the gate's LATEST decision; no clock in the
  text — the frontend appends `last_event_at` in the person's local time, "You approved · 10:42"),
  `last_event_at` = the decision.
- **Waiting** (never reached): `activity` `null` (the frontend writes "Starts after …").
- A step still `running` when the run ended shows `failed` (run failed) or `stopped`.

## Line kinds (`kind`, `text`, `refs`)

Every `text` is plain text (no markup, nothing to bold). Tool names are matched lower-cased, so the
Desktop runner's Claude Code tools (`Bash`, `Read`, `Edit`, `Write`, `MultiEdit`, `Grep`, `Glob`)
and Grok's (`read_file`, `write`, `grep`) map like OpenHands' (`terminal`, `file_editor`).
Unrecognised tools (MCP/connector tools, `think`, `task_tracker`, …) make no line — the drawer's
Raw log shows them.

| kind | from | text (examples, the boards' words) | refs |
|---|---|---|---|
| `started` | run start / an agent's round start | "Started on lazyxgenius/trade_mcp, branch main" (run; "Started" with no target) · "Started" (round 1) · "Started round 2" · "Started round 2 with the reviewer's notes" (after a `changes_requested` verdict) | run: `{repo, branch}`; a round: `{}` |
| `read` | consecutive reads of one step (collapsed; a re-read counts once) | "Read 6 files in core/ and tests/" · "Read core/indicators.py" · "Read 2 files" (folders are named only when every file is inside one) | `{files: [...]}` (paths relative to the workspace) |
| `searched` | terminal grep/rg/ag/find, or a search tool (Grep, Glob, …) | "Searched for INDICATORS" (the pattern; `-A`/`-B`/`-C`/`-m` values are skipped, `-e` names it) | `{query}` |
| `edited` | `file_editor` create/str_replace/insert, Edit/Write/MultiEdit | "Edited core/indicators.py" | `{file, added, removed}` (a diff of old/new; `null` when the call didn't carry the text) |
| `wrote_doc` | a document version (`doc:<document_id>:v<n>`) | "Wrote the spec (v2)" · a person's edit: "You edited the spec (v3)" (`node_id` null) | `{document_id, version, name}` |
| `command` | terminal action (+ its observation) | "Ran python -m pytest -q" / running: "Running python -m pytest -q"; tone `warn` on a non-zero exit | `{command, running: bool, started_at, exit_code, output_tail: [last ≤12 non-empty lines]}` |
| `tests` | a terminal observation with a test summary (pytest, jest, vitest; errors count as failed) | "Ran the tests: 3 failed, 38 passed" · "Ran the tests: all 41 passed" · "Ran the tests: 1 failed"; tone `ok` / `warn` | `{command, passed, failed, output_tail}` + the `command` keys (`running`, `started_at`, `exit_code`) |
| `gate_waiting` / `gate_approved` / `gate_rejected` | blocking human tasks (gates and the budget gate) | "Waiting for you to approve the spec" · "You approved the spec" · "You rejected the spec"; what is approved by gate kind: the spec / the ship / shipping the last build / going over the budget / this step | `{task_id, title}` (`title`: the gate's own title) |
| `verdict` | a reviewer round's close | "Asked for 2 fixes: a; b" · "Asked for 1 fix: …" · "Approved" · "Approved: …" | `{verdict, reasons: [str]}` |
| `retry` | host event | "Model busy (too many requests). Trying again in 10 s · 1 of 3" | `{attempt, of, wait_s, next_at, reason}` |
| `backup` | host event | "Switched to the backup model, openai/gpt-4.1-mini" | `{from_model, to_model}` |
| `stalled` | host event (the sweep) | "Stopped responding: no update for 20 minutes" | `{after_s}` |
| `error` | a failed close (`inv:<id>:end`) / an engine error event (`ev:`) | "Failed: the model didn't answer after 3 tries" · engine error: "Hit an error: …" (the step may carry on) · a stalled close has no error line (its `stalled` line says it) | `{message}` |
| `pr` | ship (`node_id` = the Ship node) | "Pushed branch tvashtr/run-12 and opened pull request #42" | `{pr_url, pr_number, branch}` |
| `done` | run end | "Done in 22m 38s · $1.12" · "Failed after 3m 10s · $0.12" · "Stopped. Nothing shipped." | `{elapsed_s, cost_usd}` (the run's end = its latest step close / event, a step left open counting from its start; `updated_at` only when it has neither — it moves on any later write; `at` and `summary.elapsed_s` likewise) |
| `message` | an agent's closing message: the `finish` tool, an OpenHands agent reply, Claude Code's "Finished:" (never its words or reasoning) | "Finished its step" | `{}` |

`quiet`, `carried_over` are states, not lines (`carried_over` arrives with M3).

Tones: `started`/`read`/`searched`/`edited`/`wrote_doc`/`message` neutral; `retry`, `backup`,
`gate_waiting`, a `changes_requested` verdict, failing tests, a non-zero exit warn; `gate_approved`,
`approved`, passing tests, `pr`, `done` (completed) ok; `error`, `stalled`, `gate_rejected`, `done`
(failed) danger; `done` (stopped) neutral.

### The pinned callout

One at most, in this order: an open **gate** (title "The {gate label, lower-cased} gate is waiting
for you" — "The approval gate is waiting for you", "The budget gate …"; body = the gate's own
description; `task_id`), a **stalled** step ("{label} stopped responding" / "No update for 6
minutes."), a **retrying** step ("{label} is retrying" / its latest retry line; `backup_model` =
the backup that retry names, `null` when it has none — then hide the switch), a **failed** run
("{label} failed" or "The run failed" / the run's failure message).

### Known ceilings (as built)

- OpenHands' adapter keeps the first 2000 characters of an action and of an observation. A long
  edit's `added`/`removed` undercount, and a long test run's summary line and exit code fall past
  the cut — it shows as a `command` line with `exit_code` null. (Fix, if it matters: have
  `_payload_of` also keep a terminal observation's tail — an engine change, not done here.)
- Every poll rebuilds the run's lines from its rows (fine at today's run sizes).

## `POST /api/runs/{run_id}/nodes/{node_id}/switch-backup`

The Retrying callout's "Switch to the backup model now": ends the node's current retry wait at once
so the call switches to its backup (R2). Only while that node is `retrying` on a host-visible retry
(a gateway call); else 409 `{"detail": "nothing to switch"}`. 404 unless the run is the caller's
(and the node is in it). In-process signal (`live_state.request_switch(run_id, invocation_id)`),
honoured by the gateway's backoff wait. Replies `{"switched": true}`.

As built: 409 also when the newest retry names no backup (its payload's `backup_model` is null), and
when the step's call isn't running in this API process (the signal registry is per process). Today
only a Query domain round's call is switchable; an agent step's retries happen inside its sandbox
(R2: not host-visible). The retry event's payload gains `backup_model` (what the switch would switch
to); a switch the person asked for is a `backup_model` event with `reason: "asked"`, and its
`RunWarning` reads "primary 'x' was busy — you switched to the backup model".

## Run payloads: `live` (Home's Running now cards)

`GET /api/runs` rows and `GET /api/runs/{id}` (everything built by `run_views.run_extras`) gain
`live`: the run's WORST running step as `{"label", "live_state", "activity", "last_event_at",
"activity_started_at"}` (that step's M1 live block; `label` via `run_failure.node_label`), or `null`
when the run is not in flight or no step is running. `live_state` stays as it was.

## Preferences (R10)

`GET/PATCH /api/account/preferences` gains four booleans (whitelist in `control_plane/preferences.py`):
`notify_asked` (false — the bell asked once), `notify_needs_you` (true), `notify_stalls_fails`
(true), `notify_finishes` (true — the `Prob-NotifyAsk` board draws all three choices checked).
