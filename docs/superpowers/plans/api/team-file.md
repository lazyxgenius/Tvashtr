# API — the team file (M4, brief §4 M4)

The whole team as one readable file: export it (YAML or JSON), check a file before importing it, and
import it as a NEW team. Never secret values, keys, sign-ins, tokens or memory contents. All three
routes are owner-scoped. The words are made server-side (`control_plane/team_file.py`).

## The format — `tvashtr_team: 1`

```yaml
# Tvashtr team file · Indicator sprint team · made 2026-10-02
tvashtr_team: 1
name: Indicator sprint team
budget_usd: 5.0                 # the team's default budget (or its last run's); omitted when none
repo: lazyxgenius/trade_mcp     # the team's default repo (or its last run's); omitted when none

agents:
  - id: pm                      # file-local id, unique; routes / gates / layout refer to it
    name: Product manager
    based_on: built-in/product-manager   # built-in/<role> for the built-in roles, else custom/<role>
    kind: thinker               # only when it differs from what based_on implies (thinker|worker|query-domain)
    model: xai/grok-4.7
    backup_model: openai/gpt-4.1-mini    # config.fallback_model
    file_access: can-edit       # can-edit | read-only (edits_allowed)
    skills: [spec-writing, repo-map]     # Toolkit skills by NAME; an inline skill is {name, mode?, inline: "…"}; a repo skill {repo, ref?, filter?, mode?}; project-rules
    tools: [chart-render]       # Toolkit tools by NAME, and inline servers by name (their ${SECRET} names go to needs.secrets; their values never leave)
    connectors: [{connector: notion, access: read}]   # by provider key
    domains: all | [<domain name>, …]
    reads: [design]             # config.reads_from;  reads_spec: false  (config.reads_default)
    writes: design              # config.writes_to
    remember: true              # config.memory_remember_enabled
    images: true                # config.multimodal
    context_budget: 120000      # config.model_config.worker_context_token_budget
    output_format: {…}          # config.output_schema
    description: Drafts the spec        # config.description (the card's subtitle)
    domain: <domain name>       # a Query domain agent's Domain (config.domain_id), with pass_to_spec / on_no_answer
    instructions: |
      …
gates:
  - {id: spec-approval, after: pm, asks: you, kind: prd_approval, title: …, description: …}
  - {id: leak-check, after: engineer, checks: secret_leak_scan, …}   # a guardrail gate
ends:
  - {id: ship, kind: ship}
  - {id: stop, kind: stop}
routes:
  - {from: pm, to: spec-approval}
  - {from: spec-approval, to: engineer, when: approved}
  - {from: reviewer, to: engineer, when: changes requested, loop_limit: 3, type: review}
needs:
  connectors: [github, notion]  # each person signs in on their own computer (github: the repo is on GitHub)
  secrets: [GITHUB_TOKEN]       # names only, never values
layout:
  pm: [0, 0]
  …
```

Reading a file: YAML or JSON (both parse); unknown keys are ignored with a warning naming them; an
invalid file is an error naming its line ("Line 12: `agents` should be a list of agents."). Every id
used by `routes` / `gates.after` / `layout` must exist.

## `GET /api/teams/{team_id}/file?format=yaml|json`

404 unless the library team is the caller's.
`{"filename": "indicator-sprint-team.yaml", "format": "yaml", "content": "…", "lines": 48,
"needs": {"connectors": ["github"], "secrets": ["GITHUB_TOKEN"]}}`

## `POST /api/teams/import-check` — a dry run, nothing changes

Body `{"content": "…", "filename": "indicator-sprint-team.yaml"}`. 200:
```jsonc
{
  "ok": true,                       // false: the file can't be imported (error set)
  "error": null,                    // {"line": 12, "message": "`agents` should be a list of agents."}
  "filename": "indicator-sprint-team.yaml",
  "lines": 48,
  "name": "Indicator sprint team (copy)",       // the suggested name
  "counts": {"agents": 4, "gates": 1, "routes": 5},
  "checks": [                       // in the board's order; tone ok | warn
    {"key": "shape",      "tone": "ok",   "title": "4 agents, 1 gate and 5 routes", "detail": "The canvas will look the same as in the file."},
    {"key": "models",     "tone": "ok",   "title": "Both models are set up on this computer", "detail": "xai/grok-4.7 and anthropic/claude-sonnet-4", "code": ["xai/grok-4.7", "anthropic/claude-sonnet-4"]},
    {"key": "connector:github", "tone": "warn", "title": "GitHub isn’t signed in here", "detail": "The Engineer needs it to open pull requests. Runs still work; sign in before you want one to ship."},
    {"key": "tool:chart-render", "tone": "warn", "title": "The tool chart-render isn’t in your Toolkit", "detail": "The Engineer runs without it until you add it or remove it from the team.", "code": ["chart-render"]},
    {"key": "secrets",    "tone": "ok",   "title": "No secrets inside the file", "detail": "It names GITHUB_TOKEN. You’ll use your own."},
    {"key": "unknown",    "tone": "warn", "title": "2 fields Tvashtr doesn’t know were left out", "detail": "agents[0].colour, notes"}
  ],
  "fixes": 2                        // the warn checks that need you after importing
}
```
`code` lists the substrings the app sets in code style. Model, tool, skill, connector and secret
checks each say who needs it.

## `POST /api/teams/import` → 201

Body `{"content": "…", "name": "Indicator sprint team (copy)"}`. Re-runs the check; 422 with the same
`error` when the file can't be imported. Creates a NEW library team (never touches another):
```jsonc
{"team_graph_id": "…", "name": "Indicator sprint team (copy)",
 "fixes": [                         // the canvas's "things to fix" card (File-Imported)
   {"key": "connector:github", "text": "Sign in to GitHub", "action": "sign_in", "target": "github", "node_ids": ["…"]},
   {"key": "tool:chart-render", "text": "Add chart-render or remove it", "action": "open_toolkit", "target": "chart-render", "node_ids": ["…"]}
 ],
 "note": "You can run the team now. It can’t open a pull request until GitHub is signed in."}
```
Actions: `sign_in` (GitHub: the GitHub App install; a connector: Toolkit › Connectors), `open_toolkit`
(a tool, skill or secret), `open_engines` (a model's provider key). `node_ids` are the new team's nodes
that need it (their cards show "Needs GitHub" / "1 tool missing").
