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

Any run whose distilled memories still wait for review (`node_memories.source_run_id` = the run's workflow id, `status
'pending_review'`) gets one run-level line near its end: `"Saved 3 new memories from this run · review them in
Toolkit"` ("1 new memory" when one) — who `Run` (`node_id` null), `at` the newest such memory's `created_at`, kind
`memories`, and a top-level `"review_memories": true` (the page adds the "Review" link to Toolkit › Memory › Inbox).
No line when none wait.

### `GET /api/runs/{run_id}/log?format=text|jsonl` — Download the run log (Next-Log)

An attachment (`run-12.txt` / `run-12.jsonl`), every step in order:

- **text** — a header `run #12 · <team> · <idea> · team setup v7`, then one line per Activity line (`HH:MM:SS  <who,
  padded>  <what>`) with its detail (the command, its output tail, its error) indented under it.
- **jsonl** — one JSON object per run event, in order: `{"at", "agent", "round", "kind", "text", "detail"}`.
  Built: "run event" is each Activity line (the run's events in plain words, the same lines as the text format):
  `agent` = the line's label, `round` = its iteration, `kind` = its Activity kind, `detail` = the indented text
  joined with `\n` (or `null`). Raw `run_events` rows are never exported — they hold the agents' own words, which
  R9 and §2.5 keep out.

Secrets are replaced with `••••` in both: `guardrails.mask_secrets` patterns AND every known secret value (the owner's
stored provider keys, the GitHub token, the server's secret settings). It can't be loaded back (no import route).

## As built (backend, M10)

- `GET /next` when `available` is false: the same keys, `reason` set ("Only a run that finished can start the next
  one", "Only a run on a GitHub repo can start the next one", "A compare run can’t start the next one", "The team this
  run used is gone"), `run` filled, `spec`/`pr`/`team`/`default_start` null, lists empty, `pending_memories` 0.
- A decision's title is what the gate asked about plus the decision: "Spec approved", "Ship rejected", "Shipping the last
  build approved", "Going over the budget approved", "This step approved" (any other gate). A gate whose note is
  `auto-approved` (`gates.wait_at_gate`'s automatic approval) is never a decision.
- A summary is the agent's newest finished step's work brief (`agent_invocations.outcome_detail`); a reviewer's verdict
  reads "Approved[: reasons]" / "Asked for changes[: reasons]"; masked, 600 characters at most.
- `POST /next` body: `carry` booleans default to true (an omitted `carry` brings everything). 422 details: "Write the
  next task first", the `reason` above, "This run has no pull request to start from", "The pull request was merged —
  start from <default branch>". The new run takes only `idea`, `team_graph_id` (the library team), `github_repo` and
  `base_ref` (`null` for "main": `POST /api/runs` resolves the repo's default branch) — budget, scope and Desktop
  routing are `POST /api/runs`'s defaults. 201 `{"run_id", "number"}`.
- `started_from` (run payloads), the Activity line, the canvas card and `GET /carry` need both
  `started_from_run_id` and `carry`: once the old run is deleted (SET NULL) they read as a run that didn't start from
  one; the agents still get the snapshot. The summary names the summaries too ("brought spec v3, 1 decision, 3
  memories and 3 summaries"); nothing ticked reads "brought nothing".
- The Activity line: `{"id": "run:from", "kind": "started", "came_along": true, "refs": {"run_id", "number"}, …}` —
  `came_along` is a key of that line only. The entry agent's first-step lines are kind `read` with
  `refs: {"files": [], "run_id"}`; one memory reads `Read 1 memory, “…”`. The canvas card: in
  `GET /api/runs/{id}/graph` the entry node's `live.activity` reads "From spec v3 of run #12" while it has no
  activity of its own and the run has no spec of its own (its `live_state` and `carried` stay as they are).
- `GET /next` also carries `"entry_agent"`: the display name of the team's entry agent as the team is now (the agent
  that updates the starting spec); `null` when not available.
- `started_from` sits in `GET /api/runs/{id}`'s `run` object (beside `resumed_from`) and on each `GET /api/runs` row.
- Compiled parts: `--- FROM RUN #12: THE PERSON'S DECISIONS ---` (`- Spec approved: <note>`), `--- FROM RUN #12:
  WHAT THE AGENTS LEARNED ---` (`- <content>`), `--- FROM RUN #12: WHAT EACH AGENT DID ---` (`- Engineer: <text>`).
  Resume (M3) copies `carry` to the resumed run, so the steps that run again read it too.
- The log: `format` defaults to `text` (anything but `text`/`jsonl` is a 422); clock times are UTC; the header
  leaves out the team and `team setup vN` when the run has none. Known secrets: the owner's provider keys, the GitHub
  installation tokens this server holds for the owner's installations, every `SecretStr` server setting (values under 8
  characters are left to the patterns); event texts are masked before any line is cut, then every field again.
