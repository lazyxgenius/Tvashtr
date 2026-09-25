# B-NODES API contract — agent panel, focus view, node history

Slice: B-NODES (plan `2026-09-25-frontend-revamp.md`). Every endpoint is behind the session cookie
(`401 {"detail": "Not authenticated"}` without one). Owner scoping: another account's team, node or
run is always a `404`, never a `403`. All changes to existing responses are additive.

Names decided by the spec/plan (where the two analyses differed): the agent's display name and
tagline are `config.title` / `config.description` (not `display_name`); "reads nothing" is
`config.reads_default = false` (not `reads_from: null` vs `[]`); history is
`GET …/nodes/{node}/runs` (not `/history`); the preview is `POST …/context-preview` (not `/preview`).
`role_name` never changes on a rename (memory and trajectories key on it).

---

## GET /api/node-templates

The four built-in agent templates (drawer Templates menu, focus Templates dialog, canvas presets).

Response `200`:

```json
{
  "templates": [
    {
      "key": "pm",
      "title": "Product manager",
      "description": "Drafts the spec",
      "role_name": "pm",
      "node_kind": "thinker",
      "edits_allowed": false,
      "writes_to": null,
      "verdict_labels": [],
      "prompt": "You are the PM on a software team. Write a concise mini-PRD (3-5 sentences) …"
    },
    { "key": "architect", "title": "Architect", "description": "Adds the technical design",
      "role_name": "architect", "node_kind": "thinker", "edits_allowed": false,
      "writes_to": null, "verdict_labels": [], "prompt": "You are the software architect …" },
    { "key": "engineer", "title": "Engineer", "description": "Writes & ships it",
      "role_name": "engineer", "node_kind": "worker", "edits_allowed": true,
      "writes_to": null, "verdict_labels": [], "prompt": "Read the PRD below and create …" },
    { "key": "reviewer", "title": "Reviewer", "description": "Checks against the spec",
      "role_name": "reviewer", "node_kind": "worker", "edits_allowed": false,
      "writes_to": null, "verdict_labels": ["approved", "changes_requested"],
      "prompt": "You are the Reviewer on a software team. …" }
  ]
}
```

`edits_allowed` is the template's default File access for the UI to apply with the template (the
server does not change a node's access when a preset is dropped — see POST below).

---

## POST /api/teams/{team_id}/nodes (changed)

New optional body fields: `title` (string), `description` (string). `model` may now be `""`.

```json
{ "node_kind": "worker", "preset": "reviewer", "position": {"x": 600, "y": 0} }
```

- A `preset` seeds `config.title` / `config.description` from its template unless the body sends
  them. Without a preset and without `title`/`description`, `config` stays `null` (as before).
- `title` / `description` are validated like the PATCH (below) and apply to thinker, worker,
  terminal and domain_query nodes (gates keep their own `title`/`description` semantics).
- `"model": ""` creates a blank agent that "needs a model" (validity `no_model` blocks Run). An
  omitted `model` still gets the account default.

Response `200` — the node (same shape as before), e.g.:

```json
{
  "id": "5b0c…", "role_name": "reviewer", "kind": "agent", "model": "xai/grok-4.7",
  "engine": "openhands", "prompt": "You are the Reviewer …", "position": {"x": 600, "y": 0},
  "config": {"title": "Reviewer", "description": "Checks against the spec"},
  "tool_config": null, "skills": null, "edits_allowed": true
}
```

Errors (new): `422 {"detail": "An agent name is required."}` (blank `title`),
`422 {"detail": "Keep the name to 60 characters or fewer."}`,
`422 {"detail": "Keep the description to 120 characters or fewer."}`.

---

## PATCH /api/teams/{team_id}/nodes/{node_id} (changed)

Agent / completion nodes:

| Field | Behaviour |
|---|---|
| `prompt` | Applied only when sent. `null` → 422; blank/whitespace → 422. |
| `model` | Applied only when sent (trimmed). `null` → 422. `""` allowed (the agent then "needs a model"). |
| `title` | `config.title`: trimmed, 1–60 chars. `null` removes it. |
| `description` | `config.description`: trimmed, ≤120 chars. `null` or `""` removes it. |
| `reads_default` | `config.reads_default`: `false` = reads NOTHING when `reads_from` is empty. `true` stores true; `null` removes the key (default: reads the spec). `reads_from` names always win. |
| `edits_allowed` | `true` on the entry agent (the team's root) → 409. |

Every other field keeps its existing meaning (`edits_allowed`, `capability`, `tool_config`,
`skills`, `memory_remember_enabled`, `writes_to`, `reads_from`, `fallback_model`, `output_schema`,
`multimodal`). So the Remember switch can now save alone: `{"memory_remember_enabled": true}`.

Terminal and domain_query nodes also accept `title` / `description` (same rules). Gates are
unchanged.

Example body: `{"title": "QA lead", "description": "Checks against the spec", "reads_default": false}`

Response `200` — the node (as before); `config` carries the new keys:

```json
{ "id": "…", "role_name": "reviewer", "kind": "agent", "model": "xai/grok-4.7",
  "config": {"title": "QA lead", "description": "Checks against the spec", "reads_default": false},
  "…": "…" }
```

Errors:

| Status | `detail` |
|---|---|
| 422 | `"prompt and model are required for an agent node"` (either sent as `null`) |
| 422 | `"Instructions can’t be empty."` |
| 422 | `"An agent name is required."` / `"Keep the name to 60 characters or fewer."` / `"Keep the description to 120 characters or fewer."` |
| 409 | `"The first agent writes the shared spec the team reads, so it stays read-only."` (`edits_allowed: true` on the entry agent) |
| 409 | `"the first node scopes the work — it must stay a thinker"` (unchanged) |
| 404 | `"library team not found"` / `"node not found in the team"` |

---

## GET /api/teams/{team_id}/validate (changed)

New findings (same `{code, message, node_id, edge_id}` shape), checked for reachable agent /
completion nodes:

| Code | Severity | `message` |
|---|---|---|
| `no_model` | error (blocks Run and `POST /api/runs`) | `This agent needs a model before the team can run.` |
| `no_instructions` | warning | `This agent has no instructions yet — write them, or start from a template.` |
| `writes_on_emitting_node` | warning (any agent node with `config.writes_to` that branches on a verdict) | `This agent routes on a verdict, so it can’t write a document — its verdict goes to Runs. Remove its Writes, or move it to an agent that doesn’t branch.` |

---

## GET /api/teams/{team_id}/graph (changed)

- Top level gains `"name"` (the team's name).
- `nodes[].last_run` gains `"status"` (`running` | `done` | `failed` | `stopped` — a failed round
  has `outcome: null`) and `"ended_at"` (ISO or `null`).

```json
{
  "team_graph_id": "…",
  "name": "Indicator sprint team",
  "nodes": [
    { "id": "…", "role_name": "reviewer", "config": {"title": "Reviewer", "description": "Checks against the spec"},
      "last_run": { "outcome": "changes_requested", "outcome_detail": "The new function is not registered on `INDICATORS`.",
                    "run_id": "…", "iteration": 3, "started_at": "2026-09-25T10:02:11+00:00",
                    "status": "done", "ended_at": "2026-09-25T10:04:25+00:00" },
      "…": "…" }
  ],
  "edges": []
}
```

## GET /api/runs/{run_id}/graph (changed)

- `nodes[].origin_node_id` — the authored node this run-snapshot node was cloned from (`null` when
  the graph is not a clone).
- `nodes[].invocations[].invocation_id` — the invocation's id (matches `rounds[].invocation_id`
  below).

---

## GET /api/teams/{team_id}/nodes/{node_id}/runs

One authored agent's rounds across the team's runs (drawer Runs/Docs tabs, focus rounds rail).

Query: `run_id` (optional — which run to expand; default the newest), `limit` (1–100, default 20;
caps `runs`).

Response `200`:

```json
{
  "runs": [
    {
      "run_id": "0f7c…",
      "idea": "Add an RSI indicator",
      "status": "completed",
      "created_at": "2026-09-25T09:58:40+00:00",
      "live": false,
      "rounds_count": 3,
      "last_outcome": "approved",
      "last_status": "done",
      "last_round_at": "2026-09-25T10:21:03+00:00"
    }
  ],
  "run": {
    "run_id": "0f7c…",
    "idea": "Add an RSI indicator",
    "status": "completed",
    "created_at": "2026-09-25T09:58:40+00:00",
    "live": false,
    "rounds": [
      {
        "invocation_id": 812,
        "iteration": 2,
        "status": "done",
        "outcome": "changes_requested",
        "outcome_detail": "The tests ran, but the new function is not registered on `INDICATORS`.",
        "started_at": "2026-09-25T10:10:02+00:00",
        "ended_at": "2026-09-25T10:12:16+00:00",
        "cost": { "prompt_tokens": 16000, "completion_tokens": 900, "total_tokens": 16900, "cost_usd": 0.0 },
        "model_used": "xai/grok-4.7",
        "runs_on": { "via": "subscription", "provider": "grok" },
        "given": {
          "documents": [
            { "document_id": "…", "name": "spec", "version_no": 3, "is_shared_spec": true },
            { "document_id": "…", "name": "build-notes", "version_no": 2, "is_shared_spec": false }
          ],
          "memory": [ { "id": "…", "polarity": "require" } ],
          "skills": [
            { "type": "inline", "name": "house-style", "mode": "always", "triggers": [] },
            { "type": "library", "id": "…", "name": "security-checklist", "mode": "trigger", "triggers": ["auth", "secrets"] },
            { "type": "repo", "name": "pytest-*", "url": "https://github.com/org/skills", "ref": "main", "mode": null, "triggers": [] },
            { "type": "project_rules", "name": "Repo rules files", "mode": null }
          ]
        },
        "produced": {
          "verdict": { "file": "REVIEW_VERDICT.json", "verdict": "changes_requested",
                       "reasons": "The tests ran, but the new function is not registered on `INDICATORS`." },
          "documents": [],
          "files": null
        }
      }
    ]
  }
}
```

- `runs`: every run of the caller's where this agent had ≥1 round, newest first. A team that never
  ran this agent → `{"runs": [], "run": null}`.
- `live`: the run's status is not one of `completed`, `failed`, `rejected`, `over_budget`,
  `cancelled`.
- `rounds`: newest first. `cost` is `null` when no cost row links to the round (gates, Desktop
  jobs record usage only when the CLI reported it, zero-usage rounds). `model_used`: the model the
  cost row recorded (a fallback may have swapped it), else the Desktop job's, else the node's.
- `runs_on.via`: `"subscription"` when a Tvashtr Desktop job ran the round (`provider` =
  `claude`/`grok`), else `"api_key"` (`provider` = the model's provider prefix).
- `given.documents`: what the executor recorded in the round's `context_manifest.documents` when
  present (B-DOCS records it); for older rounds, reconstructed from the agent's reads and the
  version that existed when the round started (the entry agent's first round reads nothing).
  `given.memory`: the round's manifest lessons. `given.skills`: the run's snapshot of the node's
  skill sources.
- `produced`: `null` while the round is running. `verdict` only for an agent that branches on a
  verdict (`approved`/`changes_requested`); `documents` = versions this round wrote (the shared
  spec for the entry agent, its `writes_to` document otherwise); `files` = the Desktop job's
  changed files when known, else `null` (hosted workers list their files in `outcome_detail`).

Errors: `404 {"detail": "library team not found"}` (malformed id, not a library team, or another
account's), `404 {"detail": "node not found in the team"}`, `404 {"detail": "run not found for this
agent"}` (`run_id` malformed, not the caller's, or a run this agent was not part of), `422`
(FastAPI validation) for `limit` outside 1–100.

---

## POST /api/teams/{team_id}/nodes/{node_id}/context-preview

"Preview as the agent sees it": the agent's FIRST-round context compiled by the executor's own
`compile_context`, with the unsaved draft applied. No model or embedding calls.

Body (every field optional; absent = the saved node):

```json
{
  "prompt": "You are the Reviewer …",
  "model": "xai/grok-4.7",
  "edits_allowed": false,
  "reads_from": ["build-notes"],
  "reads_default": true,
  "skills": [ { "type": "inline", "name": "house-style", "content": "…", "mode": "always" } ],
  "memory_remember_enabled": false,
  "run_id": "0f7c…",
  "idea": "Add an RSI indicator"
}
```

`run_id` picks whose idea + documents to use (default: the team's latest run; must be a run of this
team). `idea` overrides the run's idea with typed text.

Response `200`:

```json
{
  "source_run": { "run_id": "0f7c…", "idea": "Add an RSI indicator", "created_at": "2026-09-25T09:58:40+00:00" },
  "parts": [
    { "key": "node_prompt", "label": "Your instructions", "text": "You are the Reviewer …",
      "tokens": 321, "source": { "label": "Setup → Instructions" }, "placeholder": false },
    { "key": "memory", "label": "Remembered lessons", "text": "--- REMEMBERED LESSONS ---\n…",
      "tokens": 40, "source": { "label": "Pinned lessons · 2" }, "placeholder": false },
    { "key": "idea", "label": "The idea", "text": "--- ORIGINAL IDEA ---\nAdd an RSI indicator",
      "tokens": 10, "source": { "label": "Typed when you pressed Run", "run_id": "0f7c…" }, "placeholder": false },
    { "key": "spec", "label": "The latest spec", "text": "--- PRD ---\n…", "tokens": 180,
      "source": { "document_id": "…", "name": "spec", "version_no": 3, "label": "Shared spec · v3" },
      "placeholder": false },
    { "key": "capability_note", "label": "Report-only note", "text": "--- REPORT-ONLY NODE ---\n…",
      "tokens": 70, "source": { "label": "Setup → File access: Read-only" }, "placeholder": false }
  ],
  "skills": [
    { "name": "house-style", "mode": "always", "triggers": [], "delivery": "context",
      "content": "…", "tokens": 25, "source_type": "inline", "fetched_at_run_time": false },
    { "name": "https://github.com/org/skills", "mode": null, "triggers": [], "delivery": "context",
      "content": null, "tokens": 0, "source_type": "repo", "fetched_at_run_time": true,
      "url": "https://github.com/org/skills", "ref": "main" }
  ],
  "skills_tokens": 25,
  "total_tokens": 621,
  "budget": 110000,
  "over_budget": false,
  "handle_used": false,
  "notes": [
    "Pinned lessons are shown. At run time, other lessons that match the task are added too.",
    "On a rework round, the requested changes are added after the documents.",
    "Repo map is added at run time when working on a real folder.",
    "Repo skills and rules files are fetched when the team runs.",
    "On Tvashtr Desktop with your Grok subscription, skills are added to the instructions and tools aren’t used yet."
  ]
}
```

- `parts` are in the real order the agent receives them (instructions first, then lessons, the
  idea, the spec or the Reads documents, then the report-only note / remember protocol). `key` is
  one of `node_prompt`, `memory`, `idea`, `spec`, `read_documents`, `capability_note`,
  `remember_protocol`. `text` has the leading blank lines stripped; `tokens` ≈ chars/4 (same as
  the executor's budget check). `total_tokens` = the sum of `parts` tokens (what the budget checks);
  skills are delivered separately as agent context (`skills_tokens` = always-on skill tokens).
- `placeholder: true` on `idea` when the team never ran ("No run yet — the idea you type when you
  press Run goes here.") and on `spec` when there is no spec yet ("No spec yet — <entry agent
  name> writes it on the first run.").
- `read_documents` source: `{ "label": "build-notes v2", "documents": [{document_id, name, version_no}] }`.
  A Reads name not written in that run is skipped with a note `“design” isn’t written yet in this
  run, so it’s skipped.`
- The entry agent previews its first round (no spec; note "It writes the shared spec, so its first
  round starts from the idea alone."). `reads_default: false` → no spec (note "It reads no
  documents: the default spec is turned off.").
- Lessons: pinned in-scope lessons only (account + the run's repo + this agent); no embedding.

Errors: `404 {"detail": "library team not found"}`, `404 {"detail": "node not found in the team"}`,
`404 {"detail": "run not found for this team"}`, `422 {"detail": "Only agents have a context
preview."}` (gate / terminal / domain_query node), `422` FastAPI validation for wrong body types.

---

## Executor behaviour the UI can rely on (run warnings)

Surfaced in `GET /api/runs/{id}/graph` → `resolution_warnings[] {source_kind, name, reason}`:

| `source_kind` | When | `name` | `reason` |
|---|---|---|---|
| `output_schema` | an agent (any kind) has `config.output_schema` and its output doesn't match. Non-verdict agents: their `REPORT.md`; verdict agents: their raw `REVIEW_VERDICT.json`. Never fails the run. | role_name | e.g. `output fails schema at reasons`, `output is not valid JSON`, `no REPORT.md to check against the output format`, `no REVIEW_VERDICT.json to check against the output format` |
| `multimodal` | Images is on but the model is text-only, or the agent ran on a Desktop subscription | model slug | `model 'x/y' does not accept image input — the Images setting has no effect` / `images aren't sent to Desktop subscription agents yet — the Images setting has no effect there` |
| `tools` | a Desktop subscription agent has tools (MCP servers, library tools, or Domains) | comma-joined server names (+ `N library tool(s)`, `domains`) | `tools aren't used by Desktop subscription agents yet — this agent ran without them` |

Also: `config.reads_default = false` makes an agent with no `reads_from` read no document; Images on
+ a vision-capable hosted model builds the agent's LLM with vision explicitly on; Desktop
subscription agents get their skills folded into the instruction (always-on and agent-mode skills
prepended; triggered skills when a trigger word appears; repo rules files are not applied).
