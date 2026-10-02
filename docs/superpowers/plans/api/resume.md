# API — Resume from here (M3, brief §4 M3, ruling R8)

A failed, stopped or stalled run picks up from one of its agent steps as a NEW run linked to it
(`runs.resumed_from_run_id`, `runs.resumed_from_step`). The new run uses the old run's team snapshot
(copied, not the team as it is now) and its repo / base / scope / budget; every step before the
chosen one is carried: never run again, never billed again, shown "Carried over". The chosen step and
everything after it run again; round numbers continue. The workspace is rebuilt from the durable
checkpoint of the step before the chosen one (`run_checkpoints`, migration 0044), never from the
old sandbox. The existing Retry is unchanged.

All words are made server-side (`control_plane/resume.py`, `control_plane/activity.py`).

## `GET /api/runs/{run_id}/resume`

404 unless the run is the caller's. Always 200 otherwise; `available` says whether Resume is offered.

```jsonc
{
  "run_id": "…",
  "number": 12,                  // "run #12" — the run's place among its library team's runs; null without a team
  "next_number": 13,             // the number the resumed run will get (null without a team)
  "available": true,
  "reason": null,                // when available=false, why, in plain words (never shown as a button)
  "stops_run": false,            // true: the run is still running with a Stalled step — Resume stops it first (Prob-ConfirmStalled)
  "points": [                    // the run's steps in the order they ran (agent steps and gates; never the terminal)
    {
      "invocation_id": 101,
      "node_id": "…",            // the OLD run's snapshot node
      "origin_node_id": "…",     // its library node (null for a non-library run)
      "label": "Engineer",
      "kind": "agent",           // agent | gate
      "iteration": 1,
      "title": "Engineer · round 1",   // "Product manager" / "Approval gate" when the node never loops
      "text": "Edited 2 files · tests passed",
      "at": "…",                 // when the step started (the app shows it in local time)
      "cost_usd": 0.41,          // null for a gate
      "state": "kept",           // kept | suggested (the step that failed or stalled)
      "resumable": true,         // only agent steps whose previous agent step has a checkpoint
      "confirm": {               // present when resumable — the Prob-Confirm dialog
        "title": "Resume from Engineer, round 2?",
        "step_label": "Engineer, round 2",
        "kept": [{"text": "Spec v2", "at": null}, {"text": "Your approval", "at": "…"},
                 {"text": "Engineer round 1: changes to core/indicators.py and tests/test_indicators.py", "at": null},
                 {"text": "Reviewer round 1: the 2 fixes it asked for", "at": null}],
        "runs_again": ["Engineer · round 2", "Reviewer · round 2, and round 3 if it asks for more",
                       "Ship, if the reviewer approves"],
        "skips_cost_usd": 0.56,  // what the carried steps cost
        "skips_s": 480           // how long they took ("took about 8 minutes")
      }
    }
  ]
}
```

`available=false` reasons: the run is still running and nothing is stalled ("The run is still
going"), it finished ("The run finished"), a Desktop-folder run (its source folder is gone once
cloned: "Resume isn't available for a folder run yet"), no resumable step.

## `POST /api/runs/{run_id}/resume`

Body `{"invocation_id": 101}`. 201 `{"run_id": "<new>", "number": 13}`.
404 another account's run (or an unknown one). 409 `{"detail": …}` when the run or that step can't be
resumed (see above), or this run already has a resumed run that is still going. The same refusals as
`POST /api/runs` otherwise: 429 the run caps, 422 a missing provider key / a retired model (same
detail shapes). A run that is still running with a Stalled step is stopped first (the Stop path).

## Additions to existing replies (additive only)

`number` is null for a run launched without a library team: the copy then drops "#n" ("Resume this
run", "Resumed from an earlier run", "This starts a new run. It picks up where this one stopped.").

- Run payloads (`GET /api/runs/{id}`, `/api/runs` rows): `number`, `resumed_from: {run_id, number,
  step_label} | null`.
- `GET /api/runs/{id}/graph`: each node gains `carried: {from_run_id, number, text} | null` — set on a
  resumed run's node that has a carried step and no step of its own yet (its `status` stays as it
  was, `idle`; the canvas card shows `text`, e.g. "From run #12" / "Approved in run #12", and treats the
  node as reached, never "Not reached" / "Starts after …").
- Home's progress chips (`/api/runs` rows' `progress[]`, Running now): a carried node's chip has
  `state: "done"` and `carried: true` (every chip gains `carried`, false otherwise).
- `GET /api/runs/{id}/activity`:
  - `resumed_from` (as above) and `number` at the top level.
  - lines: a carried step is ONE line, `kind: "carried"`, text its step summary ("Wrote the spec
    (v2)", "You approved the spec", "Round 1 · edited 2 files", "Round 1 · asked for 2 fixes"),
    `from_run: {run_id, number}`; then one `kind: "resumed"` Run line ("Resumed from run #12 at
    Engineer, round 2"); then the new run's own lines. Every line gains `from_run` (null when it is the
    run's own).
  - agents: a node whose every step was carried and that won't run again: `live_state:
    "carried_over"`, activity "From run #12 · spec v2" / "Approved in run #12"; a node that will run
    again after its carried rounds: `waiting`, activity "Round 1 notes carried over".
  - `pinned` (failed / stalled) gains `resume: {invocation_id, label} | null` (label "Engineer,
    round 2"; the stalled callout's button reads "Resume from the last finished step") and `safe`
    ("your approved spec (v2) and the Engineer’s round 1 changes are saved" | null).
- Inbox items `run_failed` / `run_stalled` gain `resume: {invocation_id, label} | null`. A failed run
  that was resumed leaves Needs you (like one that was retried).
- Carried Activity lines have ids of their own (`c:<n>:<id>`), the new run's node ids (mapped through
  each Resume's copy of the graph) and labels; the old run's own `run:*` lines are never carried.
