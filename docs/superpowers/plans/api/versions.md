# API — team versions (M5, brief §4 M5, ruling R3)

The team as you edit it is a working copy, exactly as today (the drawer's Save, "All changes saved").
A **version** is an explicit checkpoint of a library team: `v7`. Every route is owner-scoped (another
account's team → 404). The words (summaries, field names) are made server-side
(`control_plane/versions.py`).

- A version stores the team in the M4 team-file format (`snapshot`, for the file and Compare) and a
  full copy of its rows (for What changed and Restore; never sent to the browser).
- **Changes since vN** = what differs between the working copy and the latest version. Positions never
  count (moving a node, Tidy, groups make no version).
- **v1**: a team with no versions gets v1 = its current state the first time anything asks
  (summary "Imported from a team file" for an imported team, else "First version").
- **Starting a run** (`POST /api/runs` with a library team) saves the changes as a new version first
  when there are any, so every run has a version: the run row carries `team_version_number`. Resume
  keeps the old run's version (R8); Retry from the start is a new run (it saves first like any run).
- **Restore vK** makes a NEW version equal to vK (applied to the working copy in place: nodes keep their
  ids, so memory and history stay attached); nothing is deleted; a run in flight keeps its version. If
  the working copy has changes since the latest version, they are saved as their own version first.

## Change rows (What changed, the restore preview, the chip's count)

One row per changed thing, in this order: team fields, then agents / gates / ends (canvas order), then
routes.

```jsonc
// an agent's or gate's field
{"key": "node:<node_id>:prompt", "node_id": "<uuid>", "agent": "Reviewer", "role": "reviewer",
 "field": "Instructions", "kind": "text", "removed": 1, "added": 2,
 "lines": [{"op": "context", "text": "3. Compare the build with the spec, item by item."},
           {"op": "removed", "text": "4. Approve when the tests pass."},
           {"op": "added", "text": "4. Fail the round if any new indicator is not registered on INDICATORS."},
           {"op": "added", "text": "5. Approve only when the tests pass and every spec item is met."}]}
{"key": "node:<id>:model", "node_id": "…", "agent": "Engineer", "role": "engineer", "field": "Model",
 "kind": "value", "before": "openai/gpt-4.1-mini", "after": "anthropic/claude-sonnet-4"}
// fields: Instructions (text) · Model · Backup model · File access ("can edit" / "read-only") · Skills ·
// Tools · Name · Description · Gate · Settings (other config) — values are names, never secrets
// a whole agent / gate / end
{"key": "node:<id>", "node_id": "…", "agent": "Spec approval", "role": "prd_gate", "field": null,
 "kind": "added" | "removed"}
// a route
{"key": "route:<n>", "agent": null, "field": "Routes", "kind": "added" | "removed",
 "text": "Reviewer → Engineer · when changes requested · up to 3 rounds"}
// a team field
{"key": "team:budget_usd", "agent": null, "field": "Budget", "kind": "value", "before": "$5.00",
 "after": "$8.00"}   // also team:name ("Team name"), team:repo ("Repo")
```
`lines` holds only the changed lines with up to 1 line of context around each hunk (the board's diff).

## `GET /api/teams/{team_id}/versions`

The header chip and History › Versions. 404 unless the library team is the caller's.
```jsonc
{
  "current": 7,                 // the latest version's number
  "saved_at": "2026-10-02T…Z",  // when it was made ("v7 · saved 2m ago")
  "changes": 2,                 // changes since v7 (0: the chip reads "saved …")
  "next": 8,                    // the number "Save as v8" / a run would make
  "total": 7,
  "versions": [                 // newest first, all of them (the panel shows 5, then "Show 2 older versions")
    {"number": 7, "created_at": "…", "author": "you", "summary": "Reviewer: instructions changed",
     "note": null, "runs": 1, "source": "save", "restored_from": null},
    {"number": 3, "created_at": "…", "author": "you", "summary": "Imported from a team file",
     "note": null, "runs": 0, "source": "first", "restored_from": null}
  ]
}
```
`source`: `first` (v1) · `save` (Save as vN) · `run` (saved by starting a run) · `restore`.
The row's line 2 is `note` when set, else `summary`. `author` is "you" for the caller.

## `POST /api/teams/{team_id}/versions` — Save as vN

Body `{"note": "…"}` (optional, ≤200 chars). 201 → the new version (shape of a `versions[]` item).
409 `{"detail": "Nothing changed since v7."}` when there are no changes.

## `GET /api/teams/{team_id}/versions/{number}` — What changed in vN

404 for a number the team doesn't have.
```jsonc
{
  "number": 7, "created_at": "…", "author": "you", "summary": "…", "note": null, "source": "save",
  "restored_from": null,
  "current": true,              // it's the latest version ("v7 is your current version")
  "compared_with": 6,           // null for v1 (nothing before it)
  "changes": [ /* change rows: vN-1 → vN */ ],
  "same": ["models", "routes", "gates", "budget"],   // categories with no change in vN — "Nothing else
                                // changed: models, routes, gates and budget are the same as v6."
  "runs": [{"run_id": "…", "number": 12, "idea": "Add an RSI indicator", "status": "completed"}]
}
```

## `GET /api/teams/{team_id}/versions/{number}/restore` — the Restore dialog

```jsonc
{"number": 6, "makes": 8,       // "Restoring makes a new version, v8, that matches v6."
 "current": 7,                  // "v7 stays in History"
 "draft_saved_as": null,        // 8 when the working copy's changes are saved as v8 first (then makes = 9)
 "changes": [ /* change rows: the working copy → v6 (what goes back) */ ]}
```
409 `{"detail": "v7 is already the current version."}` when restoring the latest version with no changes.

## `POST /api/teams/{team_id}/versions/{number}/restore` → 201

`{"number": 8, "restored_from": 6, "draft_saved_as": null}` (the new version). The canvas reloads the
team graph after it.

## `GET /api/teams/{team_id}/nodes/{node_id}/instruction-history`

The drawer's Instructions › History: the versions in which this agent's instructions changed, newest
first (a version that didn't change them is skipped). 404 for another account / a node not in the team.
```jsonc
{"count": 3,
 "entries": [
   {"number": 7, "created_at": "…", "author": "you", "current": true, "first": false,
    "text": "…the whole text in v7…",
    "added": ["Fail the round if any new indicator is not registered on INDICATORS."],
    "removed": ["Approve when the tests pass."]},
   {"number": 4, "created_at": "…", "author": "you", "current": false, "first": true,
    "text": "…", "added": [], "removed": [], "from_builtin": "Reviewer"}   // "First text, from the built-in Reviewer"
 ]}
```
`current`: this text is the one in the latest version. `from_builtin` is set on the first entry when its
text is the built-in role's default. "Use this text" puts `text` in the drawer as a draft; Compare diffs
`text` against the drawer's current text (client-side, `panel/setup/lineDiff.ts`).

## Runs carry their version (additive fields)

- `GET /api/runs/{id}` (`run`), `GET /api/runs` rows: `team_version_number` (int | null — null for a
  run of an ephemeral team or one from before M5).
- `GET /api/teams/{id}/runs` rows gain `number`, `team_version_number`, `pr_url`, `updated_at`,
  `resumed_as` (the number of the run that resumed it, or null) — History › Runs.
- `POST /api/runs` → `{"run_id": …, "team_version_number": 8, "version_saved": true}` (`version_saved`:
  this launch saved the changes as v8 first).
