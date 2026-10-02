# API — My agents and recent tasks (M6, brief §4 M6, ruling R4)

A **saved agent** ("my agent") is one agent's setup, saved from its panel to use in any of the
account's teams. Saving it again under the same name makes v2, v3 … Teams keep the version they use
until you update them. Every route is owner-scoped (another account's agent / team / node → 404). The
words are made server-side (`control_plane/my_agents.py`).

## What a version holds — the included parts

| part | holds | in "Included" |
|---|---|---|
| `instructions` | the prompt (secrets masked) | "Instructions" — "The current text (v7)" |
| `model` | model + backup model | "Model: xai/grok-4.7" — "Teams without Grok can pick another model" |
| `skills_tools` | skills (inline skill text masked; a repo skill only as a plain GitHub URL) + tools (library tools, switches, connector grants, Domains; an inline server travels only when it is made of references — its env / header values `${NAME}` (optionally after Bearer / Token / Basic), a plain URL with no sign-in, query or fragment, and nothing in its address or arguments that looks like a token — else it is left out) | "Skills (2) and tools (1)" |
| `file_access` | can edit / read-only | "File access: read-only" |
| `memories` | the agent's own memories (what it learned, on any repo; never the repo's or the account's shared memories; a memory the node already has isn't copied twice) — **off by default** | "Memories (3)" — "Usually about this team’s repo. Leave off to start fresh." |

Never included: sign-ins, keys and secrets (connector sign-ins and secret values stay where they are;
a grant or `${NAME}` is a reference). Never moved by using one: the node's id, role, kind, routes,
documents, position and its own memories (R4).

A node made from a saved agent carries `config.based_on = {"id", "name", "version"}`; it is not a
change of the team (M5's What changed ignores it).

## `GET /api/my-agents`

```jsonc
{"agents": [
  {"id": "…", "name": "Strict reviewer", "purpose": "Reviews Python changes against the spec. …",
   "latest": 2, "updated_at": "…",
   "built_on": "Reviewer",            // the role label of the agent it was saved from
   "model": "xai/grok-4.7", "skills": 2, "tools": 1, "file_access": "read-only",  // of the latest
   "versions": [{"number": 2, "created_at": "…", "included": ["instructions", "model", "skills_tools", "file_access"]}, …],
   "used_in": [{"team_id": "…", "team_name": "Indicator sprint team", "version": 2, "node_ids": ["…"]},
               {"team_id": "…", "team_name": "Bugfix squad", "version": 1, "node_ids": ["…"]}],
   "behind": [{"team_id": "…", "team_name": "Bugfix squad", "version": 1}]   // teams on an older version
  }]}
```
Newest first by `updated_at`. `used_in`: the account's library teams whose agents are based on it (a
team using two versions appears with its lowest). The Templates menu's "v2 · 2 teams" is `latest` +
`used_in.length`.

## `POST /api/my-agents` → 201 — Save as my agent

Body `{"team_id", "node_id", "name": "Strict reviewer", "purpose": "…", "include": ["instructions",
"model", "skills_tools", "file_access"]}` (`memories` only when asked). The agent's SAVED state is used
(the drawer saves its draft first). `name` (1–60 chars, trimmed) names the agent: a name the account
already has makes the next version of it ("Saved as version 3"), a new name makes v1. `purpose` ≤ 300
characters (422 beyond — never cut). The node then
carries `based_on` this version (`purpose` left out keeps the agent's). → `{"agent": <the agents[] item>, "version": 2, "created": false}`.
422 for an empty name / nothing included; 404 for a node that isn't the caller's agent.

## `PATCH /api/my-agents/{agent_id}` — rename / what it's for

Body `{"name"?, "purpose"?}` → the agents[] item. 409 `{"detail": "You already have an agent called
Spec writer."}`. Renaming changes no team (the nodes keep the name they were made with).

## `DELETE /api/my-agents/{agent_id}` → 204

Deletes the agent and its versions; **never changes a team** (its nodes keep their parts and their
`based_on`, which then reads as a deleted agent).

## `POST /api/teams/{team_id}/nodes/{node_id}/use-agent` — use a saved agent (R4)

Body `{"agent_id", "version"?}` (default: the latest). Applies the version's included parts to the
node at once (an agent the team's entry must stay read-only: `file_access` is skipped there) and sets
`based_on`. → `{"node": <the node as PATCH returns it>, "before": <parts>, "text": "Reviewer now uses
Strict reviewer v2"}`. `before` is what Undo puts back. 409 for a gate / end / Domain node.

## `POST /api/teams/{team_id}/nodes/{node_id}/undo-agent`

Body `{"before": <parts from use-agent / update-team>}` → the node, back as it was (its memories copied
by the use are removed again).

## `POST /api/teams/{team_id}/nodes/{node_id}/detach-agent`

→ the node without `based_on`. Its parts stay.

## `POST /api/my-agents/{agent_id}/update-team` — "1 team is on v1 · Update Bugfix squad"

Body `{"team_id"}` → applies the latest version to every agent of that team based on an older one:
`{"updated": [{"node_id", "before": <parts>}], "text": "Bugfix squad now uses Strict reviewer v2"}`.

## `POST /api/my-agents/{agent_id}/use-in-team` — "Use in a team"

Body `{"team_id"}` → 201 `{"team_id", "node_id"}`: a NEW agent of that kind, made from the latest
version, placed on the team's canvas (unconnected, to the right of the others).

## `GET /api/recent-tasks?q=&limit=` — Home › Recent tasks

The account's recent run tasks, newest first, one per task text (case and spaces ignored), only runs of
the account's own library teams. `q` matches the task (case-insensitive substring; `%` / `_` literal).
`limit` 1–20 (default 6).
```jsonc
{"tasks": [{"task": "Add an RSI indicator", "team": {"id": "…", "name": "Indicator sprint team"},
            "status": "completed", "status_group": "done", "run_id": "…", "number": 12,
            "created_at": "…"}]}
```
