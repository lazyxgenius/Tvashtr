# B-RUNS API contract — Home: inbox, runs, spend, launch options

Slice B-RUNS of the frontend revamp (plan `../2026-09-25-frontend-revamp.md`; analyses
`home-run.md` P1–P9, P11 and `home-teams.md` G-2, G-6, G-8, G-9). Every endpoint needs a signed-in
session (`tv_session` cookie; 401 otherwise) and is owner-scoped: another account's run, team, task or
repo is never returned (404 where an id is named). Money is a JSON number in US dollars. Timestamps
are ISO 8601 with an offset.

Changed endpoints are additive: every existing response key is still there.

| Method | Path | New / changed |
|---|---|---|
| GET | `/api/inbox` | new |
| POST | `/api/inbox/dismissals` | new |
| DELETE | `/api/inbox/dismissals/{key}` | new |
| GET | `/api/runs` | changed (filters, paging, richer rows) |
| GET | `/api/runs/{run_id}` | changed (`run` gains fields) |
| POST | `/api/runs` | changed (budget range, `retry_of_run_id`, GitHub `base_ref`/`subpath`) |
| POST | `/api/runs/{run_id}/cancel` | behaviour: records the run's cost |
| GET | `/api/spend` | new |
| GET | `/api/costs` | changed (owner-scoped) |
| GET | `/api/github/repos/{owner}/{repo}/branches` | new |
| GET | `/api/github/repos/{owner}/{repo}/subpaths` | new |

---

## Shared shapes

### Status groups

| `status` | `status_group` |
|---|---|
| `pending`, `running` | `running` |
| `awaiting_human` | `needs_you` |
| `completed` | `completed` |
| `failed` | `failed` |
| `cancelled`, `rejected`, `over_budget` | `stopped` |

The UI label for `rejected` / `cancelled` is "Stopped"; `over_budget` keeps its own badge but groups
under `stopped`.

### `team`

`{"id": "<library team uuid>", "name": "Indicator sprint team"}` — the library team the run was
launched from (`runs.library_team_id`), or `null` for a run launched without one (API-only
`team_shape` / A/B runs). Open a run's canvas with this id.

### `target`

```json
{ "kind": "github", "label": "lazyxgenius/trade_mcp", "base_ref": "main", "subpath": null }
```
`kind`: `github` (hosted GitHub repo), `desktop_folder` (Desktop local-folder run; `label` is the
folder label, set by B-LOCAL), `local` (self-hosted server path), `none` (fresh app, `label: null`).

### `awaiting` (only while a blocking task is pending, else `null`)

```json
{
  "task_id": 812,
  "kind": "prd_approval",
  "title": "Approve the PRD before the Engineer builds",
  "gate_node_id": "5b0c…",
  "gate_role": "Approval",
  "next_role": "Engineer",
  "since": "2026-09-25T08:14:00+00:00"
}
```
`kind` is the task kind: `prd_approval`, `ship_approval`, `review_escalation`, `budget_approval`, or
another gate kind. `gate_role` labels: `prd_approval` → "Approval", `ship_approval` → "Ship
approval", `review_escalation` → "Escalation", a budget gate → "Budget". `next_role` is the label of
the node the gate's approved edge leads to (`null` for a budget gate). `gate_node_id` is the run
graph's node id (`null` for a budget gate). Resolve it with the existing
`POST /api/runs/{run_id}/tasks/{task_id}/resolve`.

### `failure` (only when `status == "failed"`, else `null`)

```json
{
  "code": "missing_credential",
  "message": "Engineer has no xai key on the website",
  "node_id": "9e1f…",
  "origin_node_id": "77aa…",
  "node_role": "Engineer",
  "provider": "xai",
  "target": "website"
}
```
- `message` is one readable sentence — show it as is.
- `code`: `missing_credential`, `desktop_offline` ("Tvashtr Desktop went offline — reopen it and
  retry."), `desktop_run_ended`, `github_delivery` ("Couldn't open the pull request: …"), `no_spec`
  ("PM finished without writing a spec"), `over_context` ("PM ran out of context: …"),
  `domain_query`, `invalid_graph` ("The team's graph ended without reaching Ship or Stop"),
  `agent_error` (any other agent error: "<Role>: <first line of the reason>"), `unknown`.
- `node_id` is the run graph's node (the `/api/runs/{id}/graph` id); `origin_node_id` the authored
  node on the library team (for opening the agent drawer). Either may be `null`.
- `provider` is set only for `missing_credential`. `target` is `desktop` for a Desktop-targeted run,
  else `website`.
- Runs that failed before this release have no stored reason; the server derives it from the failed
  node's recorded error, else `code: "unknown"`, `message: "The run stopped with an error."`.

### Node labels (`label`, `node_role`, `gate_role`, `learned_by`, `missing_nodes`)

An agent's `config.title` when set; else `pm` → "PM", `architect` → "Architect", `engineer` →
"Engineer", `reviewer` → "Reviewer", `thinker` → "Thinker", `worker` → "Worker", `ship` → "Ship",
`stop` → "Stop", `domain_query` → "Domain"; other slugs are humanised (`my_role` → "My role"). Gates
use the gate labels above.

---

## GET /api/inbox

Home's "Needs you": every item across the caller's runs and teams, **oldest first**, minus dismissed
and currently-snoozed items.

Query: `surface` = `website` (default) | `desktop`. On `desktop`, a team that can't run on this
computer either (no key and no fresh Claude/Grok subscription) reports its gap as
`setup:<team>:desktop`; otherwise its website gap is shown as on the website.

Response 200:
```json
{
  "count": 5,
  "items": [
    {
      "key": "memories",
      "kind": "memories",
      "since": "2026-09-22T10:02:11+00:00",
      "count": 2,
      "learned_by": ["Reviewer"],
      "repos": ["lazyxgenius/trade_mcp"]
    },
    {
      "key": "setup:0f7c2d1e-…:website",
      "kind": "setup_gap",
      "since": "2026-09-23T09:00:00+00:00",
      "team": {"id": "0f7c2d1e-…", "name": "Indicator sprint team"},
      "target": "website",
      "missing_providers": ["anthropic", "xai"],
      "missing_nodes": ["Architect", "PM"],
      "desktop_covers": ["claude", "grok"]
    },
    {
      "key": "gate:812",
      "kind": "approval",
      "since": "2026-09-25T08:14:00+00:00",
      "team": {"id": "0f7c2d1e-…", "name": "Indicator sprint team"},
      "run": {
        "id": "4c1d…", "idea": "Add an RSI indicator with tests", "status": "awaiting_human",
        "spent_usd": 1.21, "budget_cap_usd": 5.0
      },
      "task": {
        "id": 812, "kind": "prd_approval", "title": "Approve the PRD before the Engineer builds",
        "blocking": true, "gate_node_id": "5b0c…", "gate_role": "Approval", "next_role": "Engineer"
      },
      "document_id": "d3e4…"
    },
    {
      "key": "nudge:815",
      "kind": "nudge",
      "since": "2026-09-25T08:20:00+00:00",
      "team": {"id": "…", "name": "Docs team"},
      "run": {"id": "…", "idea": "Write the API reference", "status": "running",
              "spent_usd": 4.1, "budget_cap_usd": 5.0},
      "task": {"id": 815, "kind": "budget_threshold", "title": "…"}
    },
    {
      "key": "run_failed:9a8b…",
      "kind": "run_failed",
      "since": "2026-09-24T21:40:00+00:00",
      "team": {"id": "…", "name": "Bugfix squad"},
      "run": {
        "id": "9a8b…", "idea": "Fix the flaky login test", "status": "failed",
        "created_at": "2026-09-24T21:10:00+00:00", "ended_at": "2026-09-24T21:40:00+00:00",
        "target": {"kind": "github", "label": "lazyxgenius/trade_mcp", "base_ref": "main", "subpath": null},
        "github_repo": "lazyxgenius/trade_mcp", "base_ref": "main", "subpath": null,
        "budget_cap_usd": 5.0, "desktop_target": false, "library_team_id": "…"
      },
      "failure": {"code": "missing_credential", "message": "Engineer has no xai key on the website",
                  "node_id": "…", "origin_node_id": "…", "node_role": "Engineer",
                  "provider": "xai", "target": "website"}
    }
  ]
}
```

Item kinds:

| kind | key | appears when | ⋯ actions allowed |
|---|---|---|---|
| `approval` | `gate:<task id>` | a pending **blocking** task (spec / ship / escalation gate, `budget_approval`) on a run that hasn't ended | snooze only |
| `nudge` | `nudge:<task id>` | a pending non-blocking task (80%-of-budget note) on a live run | dismiss, snooze (or acknowledge via the existing `/acknowledge`) |
| `run_failed` | `run_failed:<run id>` | a failed run whose last update was in the last 14 days and that no run retries (`retry_of_run_id`) | dismiss, snooze |
| `setup_gap` | `setup:<team id>:website` / `setup:<team id>:desktop` | a library team whose node models need providers with no API key, active (created or run) in the last 30 days | dismiss, snooze |
| `setup_gaps_folded` | `setup:more` | the same for teams inactive for 30+ days, folded into one item: `{count, teams:[{id, name, target, missing_providers}]}` | dismiss, snooze |
| `memories` | `memories` | memories in `pending_review` | dismiss, snooze |

Notes:
- `count` = `items.length`; it is the number for the nav badge, the greeting and the section pill.
- `setup_gap.desktop_covers`: Claude/Grok subscriptions the account has connected that would cover
  missing providers on Desktop ("Desktop runs still work with your Claude and Grok plans"). Always
  `[]` for a `desktop` gap.
- `memories.repos`: the GitHub `owner/name` of the run that learned each memory when known, else the
  memory's `repo_key`. `learned_by` are node labels.
- `document_id` on an approval is the run's spec (`pm_document_id`, may be `null`).
- A dismissed item comes back when its information changes: a setup gap when its
  `missing_providers` change, `memories` when a newer memory arrives, `setup:more` when the folded
  team set changes. A snooze ends at `until` (or earlier on such a change).

Errors: 422 `"surface must be website or desktop"`.

## POST /api/inbox/dismissals

Request:
```json
{ "key": "memories", "action": "snooze", "until": "2026-09-26T09:00:00+02:00", "surface": "website" }
```
- `action`: `"dismiss"` | `"snooze"`. `until` is required for a snooze and must be in the future
  ("Remind me tomorrow" = 09:00 local next day, sent as an absolute time). `surface` (default
  `website`) is the Home the item was seen on (send `desktop` for `setup:<team>:desktop`).
- Re-posting the same key replaces the earlier dismissal/snooze.

Response 200:
```json
{ "key": "memories", "action": "snooze", "until": "2026-09-26T07:00:00+00:00" }
```
(`until` is `null` for a dismiss.)

Errors:
- 404 `"inbox item not found"` — the key isn't one of the caller's current items.
- 422 `"An approval can't be dismissed. Snooze it instead."`
- 422 `"Snoozing needs an until time."`
- 422 `"The snooze time must be in the future."`
- 422 (FastAPI validation list) — unknown `action` / `surface`.

## DELETE /api/inbox/dismissals/{key}

Undo. `key` URL-encoded (e.g. `setup%3A0f7c…%3Awebsite`; a raw `:` also works). 204, no body —
idempotent (204 even when nothing was dismissed).

---

## GET /api/runs

The caller's runs, newest first (`created_at DESC, id DESC`), one page at a time. Runs without a
library team are included with `team: null`.

Query:
| param | values | default |
|---|---|---|
| `status` | `all`, `active` (pending+running+awaiting_human), `running` (pending+running), `needs_you`, `completed`, `failed`, `stopped` (cancelled+rejected+over_budget) | `all` |
| `team_id` | a library team uuid | — |
| `q` | case-insensitive substring of the idea **or** the team name (`%`/`_` are literal) | — |
| `limit` | 1–100 | 50 |
| `cursor` | the previous page's `next_cursor` | — |
| `include` | `progress` | — |

Response 200:
```json
{
  "runs": [
    {
      "run_id": "4c1d…",
      "idea": "Add an RSI indicator with tests",
      "status": "awaiting_human",
      "created_at": "2026-09-25T07:48:00+00:00",
      "repo_path": null,
      "status_group": "needs_you",
      "updated_at": "2026-09-25T08:14:00+00:00",
      "github_repo": "lazyxgenius/trade_mcp",
      "base_ref": "main",
      "subpath": null,
      "target": {"kind": "github", "label": "lazyxgenius/trade_mcp", "base_ref": "main", "subpath": null},
      "pr_url": null,
      "pr_number": null,
      "ship_branch": "tvashtr/4c1d…",
      "budget_cap_usd": 5.0,
      "desktop_target": false,
      "library_team_id": "0f7c2d1e-…",
      "retry_of_run_id": null,
      "team": {"id": "0f7c2d1e-…", "name": "Indicator sprint team"},
      "spent_usd": 1.21,
      "awaiting": {"task_id": 812, "kind": "prd_approval", "title": "…", "gate_node_id": "5b0c…",
                   "gate_role": "Approval", "next_role": "Engineer", "since": "2026-09-25T08:14:00+00:00"},
      "failure": null,
      "progress": [
        {"node_id": "a1…", "origin_node_id": "o1…", "role_name": "pm", "label": "PM", "kind": "completion", "state": "done", "loops_with": null},
        {"node_id": "5b0c…", "origin_node_id": "o2…", "role_name": "prd_gate", "label": "Approval", "kind": "gate", "state": "waiting", "loops_with": null},
        {"node_id": "e3…", "origin_node_id": "o3…", "role_name": "engineer", "label": "Engineer", "kind": "agent", "state": "idle", "loops_with": null},
        {"node_id": "r4…", "origin_node_id": "o4…", "role_name": "reviewer", "label": "Reviewer", "kind": "agent", "state": "idle", "loops_with": "e3…"},
        {"node_id": "s5…", "origin_node_id": "o5…", "role_name": "ship", "label": "Ship", "kind": "terminal", "state": "idle", "loops_with": null}
      ]
    }
  ],
  "next_cursor": "MjAyNi0wOS0yNVQwNzo0ODowMCswMDowMHw0YzFk…"
}
```
- The original keys `run_id, idea, status, created_at, repo_path` are unchanged.
- `spent_usd` is live: the sum of the run's cost ledger (in flight and after the end), falling back to
  `cost_total_usd`, else 0. `budget_cap_usd` is `null` for an uncapped run.
- `pr_number` is parsed from `pr_url`. `next_cursor` is `null` on the last page.
- `progress` (only with `include=progress`): one chip per node in walk order from the root, following
  forward edges (escalation-only nodes and Stop terminals left out; Ship included). `state`: `done`,
  `active`, `waiting` (paused at this gate for a human), `idle` (not reached), `failed`, `stopped`
  (was running when the run ended). `loops_with` on a loop-back's source node names the node it
  loops back to — draw "Engineer ⇄ Reviewer" between the two.

Errors (422): `"unknown status filter: <x>"`, `"invalid team_id"`, `"include accepts only:
progress"`, `"invalid cursor"`; `limit` outside 1–100 → FastAPI validation list.

## GET /api/runs/{run_id}

Unchanged envelope `{run_id, workflow_status, run, costs}`. `run` keeps every existing key (`id`,
`team_graph_id`, `idea`, `status`, `pm_document_id`, `ship_commit_sha`, `ship_tag`, `repo_path`,
`base_ref`, `ship_branch`, `subpath`, `github_repo`, `pr_url`, `cost_total_usd`, `pair_id`,
`pair_label`, `created_at`, `updated_at`) and adds: `status_group`, `target`, `pr_number`,
`budget_cap_usd`, `desktop_target`, `library_team_id`, `retry_of_run_id`, `team`, `spent_usd`,
`awaiting`, `failure` — same shapes as the list rows (no `progress`; the graph endpoint has node
states). This is the prefill source for Retry / Start again (team = `library_team_id`, idea, target,
`base_ref`, `subpath`, `budget_cap_usd`).

## POST /api/runs

Body — existing fields unchanged, plus:
```json
{
  "team_graph_id": "0f7c2d1e-…",
  "idea": "Fix the flaky login test",
  "github_repo": "lazyxgenius/trade_mcp",
  "base_ref": "dev",
  "subpath": "packages/indicators",
  "budget_cap_usd": 5.0,
  "desktop_target": false,
  "retry_of_run_id": "9a8b…"
}
```
Response 200 unchanged: `{"run_id": "…"}`.

Behaviour changes:
- `budget_cap_usd`, when sent, must be > 0 and ≤ 500. Omitted → the server default
  (`default_run_budget_usd`, $5.00).
- `retry_of_run_id` (optional): one of the caller's runs in a finished state (`completed`, `failed`,
  `rejected`, `cancelled`, `over_budget`). Stored on the new run; the failed run then leaves the
  inbox. The retry uses whatever `team_graph_id` you send (the current library team).
- A launch with `team_graph_id` of a library team records it as the run's `library_team_id`.
- Hosted GitHub runs: `base_ref` is honoured (absent/blank → the repo's default branch) and `subpath`
  is accepted (leading/trailing `/` trimmed; absent/blank → whole repo). Both are checked against the
  repo through the caller's GitHub App installation. The executor cuts the run's branch from that
  base (from `origin/<base_ref>` in the server's clone), and the PR targets it.

New errors (all before any run or clone is created):
- 422 `"budget must be above $0"` / 422 `"budget can't be more than $500"`
- 422 `"retry_of_run_id is not one of your runs"` (malformed, unknown or another account's)
- 422 `"retry_of_run_id must be a run that has finished"`
- 422 `{"code": "unknown_base_ref", "message": "base_ref is not a branch of lazyxgenius/trade_mcp", "base_ref": "nope", "branches": ["main", "dev"]}`
  (FE copy: "No branch named {x} in {repo}.")
- 422 `{"code": "unknown_subpath", "message": "subpath is not a folder of lazyxgenius/trade_mcp on dev", "subpath": "missing"}`
- 502 `"Couldn't reach GitHub. Try again in a moment."` (GitHub failed while checking branch/scope)

All earlier refusals (`missing_providers`, not runnable, unservable models, 429 ceilings,
`github_repo is not in your installations`, …) are unchanged.

## POST /api/runs/{run_id}/cancel

Response unchanged. The cancelled run now records `cost_total_usd` (what it spent so far), as a
failed run now does too, so team and account spend no longer count them as $0.

---

## GET /api/spend

Query: `tz` — IANA time zone of the browser (default `UTC`). The month is the calendar month and the
week starts Monday 00:00, both in `tz`. Live from the cost ledger of the caller's runs (in-flight,
failed and cancelled runs count; cost rows with no run, e.g. embeddings, are not anyone's).

Response 200:
```json
{
  "tz": "Europe/Berlin",
  "month": {"label": "September", "start": "2026-09-01T00:00:00+02:00", "total_usd": 15.93},
  "week": {"start": "2026-09-21T00:00:00+02:00", "total_usd": 6.19},
  "by_team": [
    {"team_id": "…", "name": "Full feature squad", "total_usd": 9.1},
    {"team_id": "…", "name": "Indicator sprint team", "total_usd": 4.82}
  ],
  "other_usd": 0.0,
  "default_run_budget_usd": 5.0
}
```
- `by_team`: this month, library teams with spend > 0, largest first. `other_usd`: this month's spend
  of runs without a library team.
- `default_run_budget_usd` feeds the footnote "Each run stops at $5.00 unless you change its budget."
  (`null` if the operator configured no default).

Errors: 422 `"Unknown time zone: <tz>"`.

## GET /api/costs

Same shape as before (`{"costs": [{id, workflow_id, idempotency_key, model_requested, model_used,
prompt_tokens, completion_tokens, total_tokens, cost_usd, created_at}]}`), optional `workflow_id`
filter. **Now owner-scoped**: only cost rows of the caller's own runs (it used to return every
account's rows). Home should use `/api/spend` instead.

---

## GET /api/github/repos/{owner}/{repo}/branches

The Options popover's "Base branch". The repo must be reachable through a GitHub App installation
the caller owns.

Response 200:
```json
{ "default_branch": "main", "branches": ["main", "dev", "feature/rsi"], "truncated": false }
```
Default branch first, then GitHub's (alphabetical) order; capped at 300 (`truncated: true` when there
are more — a branch past the cap is still accepted by `POST /api/runs`).

Errors: 404 `"repo not found"`; 502 `"Couldn't reach GitHub. Try again in a moment."`

## GET /api/github/repos/{owner}/{repo}/subpaths

The Options popover's "Scope". Query: `ref` — a branch (default: the repo's default branch).

Response 200:
```json
{
  "ref": "main",
  "subpaths": [
    {"path": "packages", "file_count": 42},
    {"path": "web", "file_count": 17}
  ],
  "truncated": false
}
```
Top-level folders only (sorted, at most 100), each with the number of files anywhere under it — the
same shape `POST /api/repo/inspect` returns for a local path. `truncated` is GitHub's flag for a
tree too large to list whole. Any folder (nested ones too, e.g. `packages/indicators`) is accepted
as `subpath` on launch.

Errors: 404 `"repo not found"`; 422 `{"code": "unknown_ref", "message": "ref is not a branch of
<owner>/<repo>", "ref": "<ref>"}`; 502 `"Couldn't reach GitHub. Try again in a moment."`
