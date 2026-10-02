# M10 — Start a new run from this one: API contract

Brief: `prompts/m1-m11.md` §4 M10 + ruling R9 (and R3: a run uses the team as it is now, saving its changes as a
version first). Boards: Runs › `Next-Finished`, `Next-Carry`, `Next-Started`, `Next-Log` and the M10 boards drawn for
the undrawn states: `Next-More` (the run's ⋯ menu), `Next-CameAlong` ("See what came along"), `Next-CarryMerged` (a
merged pull request, nothing decided, an error starting).

Every new route is owner-scoped (another account → 404, never 403), listed in `test_owner_scope_guard.py`.

## Model (migration **0051**, additive)

- `runs.started_from_run_id` (uuid, nullable, FK `runs.id` `ON DELETE SET NULL`, indexed) — the run this one started
  from.
- `runs.carry` (JSONB, nullable) — a SNAPSHOT taken at start of what came along (later changes to the old run never
  change it):

```json
{"from": {"run_id": "…", "number": 12},
 "spec": {"version": 3, "text": "…the final spec…"} | null,
 "decisions": [{"title": "Spec approved", "text": "…the person's note…" | null}],
 "memories": [{"id": "…", "content": "Register every indicator on INDICATORS", "polarity": "require"}],
 "summaries": [{"agent": "Engineer", "text": "Added RSI to core/indicators.py, … in 3 rounds."}],
 "start_from": {"kind": "pr" | "main", "branch": "tvashtr/run-12", "pr_number": 42 | null}}
```

  An item the person unticked is `null` / `[]`. Never the agents' conversations (run events, transcripts, tool
  output): only the four kinds above.

## Who can start one (R9)

A run of yours that ended `completed`, on a GitHub repo (`runs.github_repo` set: R9's "Start from" needs a repo), not a
compare run (`pair_id` NULL), whose library team still exists. Anything else: `available: false` (no button, 2.4).

## What comes along

- **The final spec** — the newest version of the run's spec document (`runs.pm_document_id`), its version number and
  text. It becomes the new run's starting spec: the entry agent's FIRST invocation gets it as a named part (below) and
  updates it for the new task.
- **Your decisions** — the run's gates a PERSON resolved (approved / rejected, never an automatic approval): the gate's
  title in plain words ("Spec approved", "Spec rejected") and the person's note, if any.
- **What the agents learned** — the run's CONFIRMED memories (`node_memories.source_run_id` = the run, `status
  'active'`); memories still waiting for review are counted (the dialog says "New ones still wait for your review") but
  never carried.
- **A short summary from each agent** — each agent's newest work brief in the run (what it did and why), at most 600
  characters each, in the run's step order.

## Compiled context (named parts, visible in the manifest)

`context_compiler.compile_context` gains `carry: dict | None = None`. `None` (every run that didn't start from one, and
every test today) ⇒ byte-identical instruction + manifest. Present ⇒ named parts after the idea:

- `carried_spec` — ONLY in the entry agent's first invocation (which has no spec of its own yet):
  `--- STARTING SPEC (spec v3 of run #12; update it for the new task) ---`.
- `carried_decisions`, `carried_memories`, `carried_summaries` — in EVERY agent invocation of the run, each only when
  non-empty: `--- FROM RUN #12: THE PERSON'S DECISIONS ---` etc.

The executor reads `carry` from `load_graph_step`'s recorded dict (`"carry": run.carry` — absent for runs recorded
before M10, so they replay unchanged) and passes it to `agent_run_step`; no new DBOS step or workflow, the DBOS
application version unchanged.

## Routes

### `GET /api/runs/{run_id}/next` — the dialog (Next-Carry)

```json
{"available": true, "reason": null,
 "run": {"id": "…", "number": 12, "idea": "Add an RSI indicator"},
 "spec": {"version": 3} | null,
 "decisions": [{"title": "Spec approved", "text": null}],
 "memories": [{"id": "…", "content": "…"}], "pending_memories": 1,
 "summaries": [{"agent": "Product manager", "text": "…"}],
 "pr": {"number": 42, "branch": "tvashtr/run-12", "merged": false} | null,
 "start_from": [{"value": "pr", "label": "tvashtr/run-12 (pull request #42)"}, {"value": "main", "label": "main"}],
 "default_start": "pr" | "main",
 "team": {"id": "…", "version": 7}}
```

`pr` from `runs.pr_url` / `runs.ship_branch`; `merged` asks GitHub through the owner's installation (unknown ⇒ false).
The PR option is offered only when the PR is not merged (`default_start` "pr"); else only the repo's default branch
(the label is that branch's name; "main" in the boards). `team.version` is the version the new run will use (the
current one, or the next one when the team has unsaved changes — R3).

### `POST /api/runs/{run_id}/next` `{"task", "carry": {"spec", "decisions", "memories", "summaries"} (booleans), "start_from": "pr" | "main"}` → **201** `{"run_id", "number"}`

422: an empty task, `available` false, "pr" when no unmerged PR is offered. Otherwise exactly `POST /api/runs`'s path —
the same launch pre-flight, hosted ceilings (the same 429 bodies), GitHub installation check, budget cap, the team as it
is now (R3: changes saved as a version first) — with `github_repo` = the old run's, `base_ref` = the PR branch or the
default branch, `started_from_run_id` and the `carry` snapshot.

### `GET /api/runs/{run_id}` and run lists — additive

`"started_from": {"run_id", "number", "summary": "brought spec v3, 2 decisions and 3 memories"} | null` (the summary
names only what came along; "brought the spec" when there is no version number).

### `GET /api/runs/{run_id}/carry` — "See what came along" (Next-CameAlong)

The run's `carry` snapshot as the dialog shows it: `{"from", "spec": {"version"} | null, "decisions", "memories",
"summaries"}` (the spec's text is not repeated). 404 for a run that didn't start from another.

### Activity (`activity.py`, additive)

A run with `started_from_run_id`: its first line is `"Started from run #12 · brought spec v3, 2 decisions and 3
memories"` (kind `started`, with `came_along: true` — the page links "See what came along"), then the run's own start
line as today. At the entry agent's first invocation: `"Read the spec from run #12 (v3)"` and `"Read 3 memories,
including “<the first>”"` (when carried). The run view's canvas card for the entry agent reads `"From spec v3 of run
#12"` until the run has a spec of its own.

### `GET /api/runs/{run_id}/log?format=text|jsonl` — Download the run log (Next-Log)

An attachment (`run-12.txt` / `run-12.jsonl`), every step in order:

- **text** — a header `run #12 · <team> · <idea> · team setup v7`, then one line per Activity line (`HH:MM:SS  <who,
  padded>  <what>`) with its detail (the command, its output tail, its error) indented under it.
- **jsonl** — one JSON object per run event, in order: `{"at", "agent", "round", "kind", "text", "detail"}`.

Secrets are replaced with `••••` in both: `guardrails.mask_secrets` patterns AND every known secret value (the owner's
stored provider keys, the GitHub token, the server's secret settings). It can't be loaded back (no import route).
