# API contract — B-TEAMS (Home team cards, templates, duplicate, account)

Slice B-TEAMS of the [frontend revamp plan](../2026-09-25-frontend-revamp.md). Requirements:
`home-teams.md` G-1, G-3–G-5, G-7, G-10, G-12–G-14; `home-run.md` P5 (readiness), P12, P13.

Every endpoint needs a session (`tv_session` cookie) — without one: `401 {"detail": "Not authenticated"}`.
Every change is additive: no existing key was removed or renamed. Timestamps are ISO 8601 with offset.

| Method + path | Change |
|---|---|
| `GET /api/teams` | summary rows gain run counts, activity, origin, `shape`, `readiness`; live `spend_usd`; **no auto-seeding** |
| `POST /api/teams` | name trimmed; blank name → 422; stores `template_key`; returns the new summary |
| `PATCH /api/teams/{id}` | unchanged, but returns the new summary shape |
| `POST /api/teams/{id}/duplicate` | **new** |
| `DELETE /api/teams/{id}` | unchanged response; also deletes the runs' Desktop job rows |
| `GET /api/teams/{id}/runs` | rows gain `updated_at`, `status_group`, `pr_url`, `pr_number`, `spent_usd` |
| `GET /api/templates` | items gain `shape` + the design copy; response gains `blank` |
| `GET /api/account/preferences` | **new** |
| `PATCH /api/account/preferences` | **new** |
| `GET /api/auth/me`, `POST /api/auth/login`, `POST /api/auth/register` | gain `github_login`, `display_name` |

---

## The team summary

Returned by `GET /api/teams` (as `teams[]`, oldest first), `POST /api/teams`, `PATCH /api/teams/{id}`
and `POST /api/teams/{id}/duplicate`.

```json
{
  "team_graph_id": "d4427ab6-2d4d-4ab9-b925-bd7e107ce3a4",
  "name": "Indicator sprint team",
  "created_at": "2026-09-23T08:10:02.140985+00:00",
  "node_count": 7,
  "last_run": {
    "status": "awaiting_human",
    "at": "2026-09-25T07:48:11.402113+00:00",
    "run_id": "0b8f6c1e-5d7a-4a57-9a0e-3f3c1d7e2a10",
    "idea": "Add an RSI indicator with tests",
    "updated_at": "2026-09-25T08:14:40.018224+00:00",
    "pr_url": null
  },
  "spend_usd": 4.82,
  "run_count": 7,
  "active_run_count": 0,
  "awaiting_run_count": 1,
  "last_active_at": "2026-09-25T08:14:40.018224+00:00",
  "template_key": "review_loop",
  "template_name": "PM → Engineer ⇄ Reviewer",
  "duplicated_from": null,
  "shape": {
    "nodes": [
      {"id": "caf4bd86-8193-44b4-9d45-e70e6a644956", "kind": "thinker", "role": "pm", "label": "PM"},
      {"id": "c34745cd-627a-4b9f-b297-68c19c7a5006", "kind": "gate", "role": "gate", "label": "Approval"},
      {"id": "40de840c-643d-45f0-be48-eb36b543068b", "kind": "worker", "role": "engineer", "label": "Engineer"},
      {"id": "1390b92b-9033-430c-8409-610b63a4d3ae", "kind": "worker", "role": "reviewer", "label": "Reviewer"},
      {"id": "46fd7062-ba91-43ec-9437-e3cc6c6054ad", "kind": "terminal", "role": "ship", "label": "Ship"}
    ],
    "loops": [{"from": 3, "to": 2}]
  },
  "readiness": {
    "website": {"ready": false, "missing_providers": ["xai"], "missing_nodes": ["engineer"]},
    "desktop": {"ready": true, "missing_providers": [], "missing_nodes": [], "routed_subscriptions": ["grok"]},
    "subscriptions_connected": ["grok"]
  }
}
```

Fields (existing keys `team_graph_id`, `name`, `created_at`, `node_count`, `last_run.{status,at,run_id}`,
`spend_usd` keep their meaning, except `spend_usd` is now honest — see below):

- **Which runs are a team's runs:** runs whose `runs.library_team_id` is the team; a run with no
  `library_team_id` (older rows, and launches until B-RUNS starts setting it) falls back to the
  clone→origin node join. Each run counts once.
- `last_run` — the newest run by `created_at` (ties: lowest run id), or `null` when never run.
  `at` = that run's `created_at` (unchanged); new: `idea`, `updated_at` (last activity), `pr_url`
  (`null` until a PR is opened).
- `spend_usd` — **all time**, what the team's runs actually spent: per run, the live sum of its
  `cost_records` (so running, awaiting, failed and cancelled runs count), falling back to the
  stored `cost_total_usd` for a run with no ledger rows, else 0.
- `run_count`; `active_run_count` = runs in `pending|running`; `awaiting_run_count` = runs in
  `awaiting_human`. Use these (not `last_run.status`) for the delete dialog's impact warning.
- `last_active_at` — newest `updated_at` over the team's runs, else the team's `created_at`
  (the "Last active" sort key).
- `template_key` — `blank | two_node | review_loop | plan_review | full_squad | seed | null`
  (`null` = created before the revamp). A duplicate inherits its source's key.
- `template_name` — `"Blank"`, or the template's name from `GET /api/templates`; `null` for `seed`
  and legacy teams (render "Created {x}").
- `duplicated_from` — `null`, or `{"team_graph_id": "<source id>", "name": "<source name>"}` for a
  team made by Duplicate. `name` becomes `null` once the source team is deleted. Render "Copied {x}".
- `shape` — the pipeline strip: the main path from the start node to Ship.
  - `nodes[]`: `id` (the node id), `kind` (`thinker | worker | gate | terminal | domain_query`),
    `role` (`pm | architect | engineer | reviewer | thinker | worker | gate | ship | domain_query`),
    `label` (`PM`, `Architect`, `Engineer`, `Reviewer`, `Thinker`, `Worker`, `Approval`, `Ship`,
    `Domain`; a thinker/worker/domain node with a `config.title` uses that title).
  - `loops[]`: `{from, to}` — indices into `nodes`; draw **⇄** between `nodes[to]` and `nodes[from]`.
  - Stop terminals, escalation gates and rejected branches never appear. A graph with no start node
    (invalid) has `{"nodes": [], "loops": []}`.
- `readiness` — can the team launch, per target, using the same rule `POST /api/runs` enforces:
  - `website`: only API keys count. `missing_providers` sorted; `missing_nodes` = sorted
    **role names** (`pm`, `engineer`, …) of the nodes needing them — the same values as the launch
    422's `missing_nodes`.
  - `desktop`: a connected Claude/Grok subscription **whose Desktop runner polled recently** also
    covers its provider; `routed_subscriptions` = the subscriptions whose nodes would run on the
    user's computer ("Ready on this computer · Claude, Grok").
  - `subscriptions_connected`: connected Desktop subscriptions (`claude`, `grok`; mirror state,
    ignoring runner freshness) that this team's models would use — for "Desktop runs still work with
    your Claude plan" on the website and the web's Desktop verdict (Engines OQ-3).
  - A team with no model nodes is ready on both targets.

`GET /api/teams` returns `{"teams": []}` for an account with no teams — **"My team" is no longer
auto-created** (and deleting the last team leaves the list empty).

## POST /api/teams

Request (unchanged): `{"template": "review_loop", "name": "Payments squad"}` — `template` is a key
from `GET /api/templates` or `"blank"`.

Response `200`: the team summary above (`run_count: 0`, `last_run: null`, `template_key` set).

Errors (checked in this order):

| Status | `detail` |
|---|---|
| 422 | `"A team name is required."` (name empty after trimming) |
| 400 | `"unknown template"` |

The stored name is trimmed.

## POST /api/teams/{team_id}/duplicate — new

Request body optional: `{}` / none, or `{"name": "Indicators squad"}` (trimmed). Default name
`"{source name} (copy)"`.

Response `201`: the new team's summary:

```json
{
  "team_graph_id": "5b1f0e8e-9a53-4c61-b2a0-6d7e2f9c1a44",
  "name": "Indicator sprint team (copy)",
  "created_at": "2026-09-25T09:02:17.551204+00:00",
  "node_count": 7,
  "last_run": null,
  "spend_usd": 0.0,
  "run_count": 0,
  "active_run_count": 0,
  "awaiting_run_count": 0,
  "last_active_at": "2026-09-25T09:02:17.551204+00:00",
  "template_key": "review_loop",
  "template_name": "PM → Engineer ⇄ Reviewer",
  "duplicated_from": {"team_graph_id": "d4427ab6-2d4d-4ab9-b925-bd7e107ce3a4", "name": "Indicator sprint team"},
  "shape": {"nodes": ["…same strip as the source, new node ids…"], "loops": [{"from": 3, "to": 2}]},
  "readiness": {"…": "as for the source"}
}
```

Copies every node (prompt, model, engine, position, config, tools, skills, edits toggle) and edge
with new ids. Copies **no runs and no agent (node-tier) memories**.

| Status | `detail` |
|---|---|
| 400 | `"invalid team id"` |
| 404 | `"library team not found"` (unknown id, a run snapshot, or another account's team) |
| 422 | `"A team name is required."` (a `name` that is blank after trimming) |

## DELETE /api/teams/{team_id}

Unchanged: `200 {"team_graph_id": "<id>", "deleted": true}`; 400 `"invalid team id"`, 404
`"library team not found"`. It now also deletes the `desktop_node_jobs` rows of the deleted runs
(a Desktop runner still holding one gets a 404 on its next call), and it finds runs through
`runs.library_team_id` as well as the clone join.

## GET /api/teams/{team_id}/runs

Response `200` (newest first; `{"runs": []}` for a team that never ran):

```json
{
  "runs": [
    {
      "run_id": "0b8f6c1e-5d7a-4a57-9a0e-3f3c1d7e2a10",
      "status": "awaiting_human",
      "idea": "Add an RSI indicator with tests",
      "created_at": "2026-09-25T07:48:11.402113+00:00",
      "cost_total_usd": 0.0,
      "updated_at": "2026-09-25T08:14:40.018224+00:00",
      "status_group": "needs_you",
      "pr_url": null,
      "pr_number": null,
      "spent_usd": 1.21
    },
    {
      "run_id": "7e0c2d55-18f4-4b0e-9d1f-2a6b8c3e4f51",
      "status": "completed",
      "idea": "Add a MACD crossover alert",
      "created_at": "2026-09-24T15:20:03.118200+00:00",
      "cost_total_usd": 0.96,
      "updated_at": "2026-09-24T15:41:57.902311+00:00",
      "status_group": "completed",
      "pr_url": "https://github.com/lazyxgenius/trade_mcp/pull/39",
      "pr_number": 39,
      "spent_usd": 0.96
    }
  ]
}
```

- `cost_total_usd` — unchanged: the stored final cost (`0` until a run finalizes). **Show `spent_usd`**:
  the live cost (same rule as the summary's `spend_usd`).
- `status_group` — `running` (pending, running) · `needs_you` (awaiting_human) · `completed` ·
  `failed` · `stopped` (cancelled, rejected, over_budget).
- `pr_number` — parsed from `pr_url` (`…/pull/{n}`), else `null`.

Errors unchanged: 400 `"invalid team id"`, 404 `"library team not found"`.

## GET /api/templates

```json
{
  "templates": [
    {
      "template": "review_loop",
      "name": "PM → Engineer ⇄ Reviewer",
      "description": "Adds a Reviewer that runs the tests and loops back for fixes.",
      "shape": {
        "nodes": [
          {"id": null, "kind": "thinker", "role": "pm", "label": "PM"},
          {"id": null, "kind": "gate", "role": "gate", "label": "Approval"},
          {"id": null, "kind": "worker", "role": "engineer", "label": "Engineer"},
          {"id": null, "kind": "worker", "role": "reviewer", "label": "Reviewer"},
          {"id": null, "kind": "terminal", "role": "ship", "label": "Ship"}
        ],
        "loops": [{"from": 3, "to": 2}]
      }
    }
  ],
  "blank": {
    "template": "blank",
    "name": "Blank",
    "description": "An empty canvas: one thinker into Ship. Wire the rest yourself.",
    "shape": {
      "nodes": [
        {"id": null, "kind": "thinker", "role": "thinker", "label": "Thinker"},
        {"id": null, "kind": "terminal", "role": "ship", "label": "Ship"}
      ],
      "loops": []
    }
  }
}
```

`templates[]`, in order (Blank is **not** in the list; it is `blank`, so the dialog can still show its
own Blank card when this call fails):

| `template` | `name` | `description` | strip |
|---|---|---|---|
| `two_node` | PM → Engineer | A PM writes the spec; an Engineer builds and ships it. No review step. | PM › Approval › Engineer › Ship |
| `review_loop` | PM → Engineer ⇄ Reviewer | Adds a Reviewer that runs the tests and loops back for fixes. | PM › Approval › Engineer ⇄ Reviewer › Ship |
| `plan_review` | PM → Architect → Engineer ⇄ Reviewer | Two thinkers plan it, then a build-and-review loop ships it. | PM › Architect › Approval › Engineer ⇄ Reviewer › Ship |
| `full_squad` | Full feature squad | Plan, you approve, build and test in a loop, you approve the ship. | PM › Architect › Approval › Engineer ⇄ Reviewer › Approval › Ship |

The strips equal what `team_shape` returns for a team built from each template (tested). The
first-time checklist's shorter Full-feature-squad copy ("Plan, you approve, build and test, you
approve the ship.") is a frontend string.

## GET /api/account/preferences — new

Response `200`: `{"get_started_hidden": false}` — defaults merged server-side; only whitelisted keys
are ever returned.

## PATCH /api/account/preferences — new

Request: a JSON object with any subset of the keys, e.g. `{"get_started_hidden": true}`. Merges and
returns the full object: `200 {"get_started_hidden": true}`. `{}` returns the current object.

| Status | `detail` |
|---|---|
| 422 | `"Unknown preference: <key>."` (first unknown key, sorted) |
| 422 | `"get_started_hidden must be true or false."` |
| 422 | FastAPI validation detail when the body is not a JSON object |

A rejected patch stores nothing. Existing accounts are not migrated: Home shows first-time mode only
when the account has no runs and the checklist is not hidden (spec §4.6 Q13/14).

## Identity: GET /api/auth/me, POST /api/auth/login, POST /api/auth/register

```json
{
  "id": "85329f0b-73a4-418a-84b2-88182e8eb70a",
  "email": "lazyx@example.com",
  "github_login": null,
  "display_name": "Lazyx"
}
```

- `github_login` — the GitHub handle for accounts linked via GitHub sign-in, else `null`.
- `display_name` — `github_login` when set, else the email's local part with its first letter
  capitalised. Use it for "Good morning, {display_name}." and the account menu.

## For the frontend

- `lib/api.ts` fixtures that relied on `GET /api/teams` always returning ≥1 team must handle `[]`
  (e.g. `App.tsx`'s standalone `list[0]` default, `Dashboard.test.tsx`, `App.test.tsx`,
  `App.addDownstream.test.tsx`, `TeamCanvas.authoring.test.tsx` mention "My team") and the
  Playwright specs that mention "My team" and may rely on a fresh account getting one
  (`e2e/accounts.spec.ts`, `team-edit`, `edits-toggle`, `steering`, `scope-picker`, `fix1_signoff`,
  `run-diff`, `node-ask`, `model-picker`, `authoring-brief`, `launch-panel` — not checked one by one).
- The stale `deleteTeam` doc comment ("runs are unaffected") should go: deleting a team stops and
  deletes its runs.
