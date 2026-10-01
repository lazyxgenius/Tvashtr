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

```jsonc
{
  "run_id": "…",
  "status": "running",            // the run's status
  "live_state": "working",        // the run's worst step (M1), or done/failed/stopped
  "cursor": "2026-10-02T10:45:20.123456+00:00|ev:1234",  // pass back as ?after=
  "total": 21,                    // lines in the whole run
  "agents": [                     // one per graph node a person sees: agent/completion/gate/ship/stop/domain_query, left to right
    {
      "node_id": "…", "origin_node_id": "…", "label": "Engineer", "kind": "agent",
      "iteration": 2, "rounds_limit": 3,          // rounds_limit: the loop limit on its back-edge, else null
      "live_state": "running_command",            // waiting|working|running_command|needs_you|retrying|quiet|stalled|failed|done|stopped
      "activity": "Running the tests · tests/test_indicators.py",
      "last_event_at": "…", "activity_started_at": "…",
      "retry": {"attempt": 2, "of": 3, "next_at": "…"} | null,
      "backup_model": "openai/gpt-4.1-mini" | null,
      "model": "anthropic/claude-sonnet-4"
    }
  ],
  "lines": [
    {
      "id": "ev:1234",                    // stable: ev:<run_events.id> | task:<id>:open|done | inv:<id>:start|end | run:start|done|pr
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
    "backup_model": "openai/gpt-4.1-mini" | null   // retrying: what "Switch to the backup model now" switches to
  } | null,
  "summary": {                            // a finished run only (status completed), else null
    "pr_url": "…" | null, "pr_number": 42 | null, "rounds": 3, "elapsed_s": 1358, "cost_usd": 1.12
  } | null
}
```

## Line kinds (`kind`, `text`, `refs`)

| kind | from | text (examples, the boards' words) | refs |
|---|---|---|---|
| `started` | run start / an agent's round start | "Started on lazyxgenius/trade_mcp, branch main" · "Started round 2 with the reviewer's notes" | `{repo, branch}` |
| `read` | consecutive `file_editor view` actions (collapsed) | "Read 6 files in core/ and tests/" · "Read core/indicators.py" | `{files: [...]}` |
| `searched` | terminal grep/rg/find, or a search tool | "Searched for INDICATORS" | `{query}` |
| `edited` | `file_editor` create/str_replace/insert | "Edited core/indicators.py" | `{file, added, removed}` |
| `wrote_doc` | a document version written by the step | "Wrote the spec (v2)" | `{document_id, version, name}` |
| `command` | terminal action (+ its observation) | "Ran python -m pytest -q" / running: "Running python -m pytest -q" | `{command, running: bool, started_at, exit_code, output_tail: [last ≤12 lines]}` |
| `tests` | a terminal observation with a test summary | "Ran the tests: 3 failed, 38 passed" · "Ran the tests: all 41 passed" | `{command, passed, failed, output_tail}` |
| `gate_waiting` / `gate_approved` / `gate_rejected` | human tasks | "Waiting for you to approve the spec" · "You approved the spec" · "You rejected the spec" | `{task_id}` |
| `verdict` | a reviewer round's close | "Asked for 2 fixes: …" · "Approved: …" | `{verdict, reasons}` |
| `retry` | host event | "Model busy (too many requests). Trying again in 10 s · 1 of 3" | `{attempt, of, wait_s, next_at, reason}` |
| `backup` | host event | "Switched to the backup model, openai/gpt-4.1-mini" | `{from_model, to_model}` |
| `stalled` | host event (the sweep) | "Stopped responding: no update for 20 minutes" | `{after_s}` |
| `error` | engine error event / a failed close | "Failed: the model didn't answer after 3 tries" | `{message}` |
| `pr` | ship | "Pushed branch tvashtr/run-12 and opened pull request #42" | `{pr_url, pr_number, branch}` |
| `done` | run end | "Done in 22m 38s · $1.12" · "Stopped. Nothing shipped." | `{elapsed_s, cost_usd}` |
| `message` | an agent's own closing message (never its reasoning) | "Finished its step" | `{}` |

`quiet`, `carried_over` are states, not lines (`carried_over` arrives with M3).

## `POST /api/runs/{run_id}/nodes/{node_id}/switch-backup`

The Retrying callout's "Switch to the backup model now": ends the node's current retry wait at once
so the call switches to its backup (R2). Only while that node is `retrying` on a host-visible retry
(a gateway call); else 409 `{"detail": "nothing to switch"}`. 404 unless the run is the caller's.
In-process signal (`live_state.request_switch(run_id, invocation_id)`), honoured by the gateway's
backoff wait.

## Preferences (R10)

`GET/PATCH /api/account/preferences` gains four booleans (whitelist in `control_plane/preferences.py`):
`notify_asked` (false — the bell asked once), `notify_needs_you` (true), `notify_stalls_fails`
(true), `notify_finishes` (true — the `Prob-NotifyAsk` board draws all three choices checked).
