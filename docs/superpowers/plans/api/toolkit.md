# B-TOOLKIT API contract (Toolkit › Tools, Skills, Secrets)

Source of truth for the F3/F4/F5 frontend slices. All routes need a session (401 otherwise) and are
owner-scoped: another account's tool, skill, secret or agent answers exactly like an absent one
(404). Timestamps are ISO 8601 with offset. Unless noted, `detail` is a user-facing string you can
show as-is; the multi-item endpoints (import, scan) use a `{code, message, …}` object instead.

Code: `backend/tvashtr/routes/toolkit.py` (new routes), `routers.py` (changed tool/skill/secret
routes), `control_plane/toolkit.py` (rules), `control_plane/tool_usage.py` (who uses what),
`control_plane/skill_repo.py` (GitHub scan/import), `node_skills.py` (per-agent load mode).

## Where references live (unchanged storage)

- A library **tool** is referenced by id in `agent_nodes.tool_config.tvashtr.library` (list of id
  strings). The per-agent switch is `tool_config.tvashtr.servers[<tool name>].enabled` (absent =
  on). An inline `tool_config.mcpServers[<name>]` with the same name wins at run time.
- A library **skill** is `{"type":"library","id":"…","mode"?,"triggers"?}` in `agent_nodes.skills`.
  **New:** `mode` (`always` | `trigger` | `agent`) and `triggers` (list, or a comma string) on the
  ref are this agent's load-mode override; the resolver applies them over the library skill's own
  mode. Absent = follow the skill. (Validating them on the node PATCH is B-NODES' call; an unknown
  mode makes the resolver skip that skill with a run warning.)
- **Usage** ("used by") counts only the owner's **library** teams (`is_library`), and only
  `agent`/`completion` nodes. A tool counts for an agent when it is referenced, not switched off,
  and not overridden by an inline server of the same name. Run-snapshot clones never count and are
  never rewritten.

## Shapes

**Tool item** (every tool endpoint; `GET /api/tool-library` returns `{"tools": [item…]}` oldest
first — sort by name client-side):

```json
{
  "id": "0b6c…", "name": "linear",
  "server_config": {"url": "https://mcp.linear.app/sse", "headers": {"Authorization": "Bearer ${LINEAR_TOKEN}"}},
  "created_at": "2026-09-25T10:02:11.482+00:00", "updated_at": "2026-09-25T10:02:11.482+00:00",
  "secret_refs": ["LINEAR_TOKEN"], "missing_secrets": ["LINEAR_TOKEN"],
  "status": "needs_attention",
  "used_by": {"agent_count": 2, "team_count": 1}
}
```
`secret_refs` = every `${NAME}` in the config's `env`/`headers` values (the only places the runtime
substitutes). `status` is `needs_attention` when a referenced secret has no value **or** the config
can't connect (not exactly one of a command / an http(s) URL); otherwise `ready`.

**Skill item** (`GET /api/skill-library` → `{"skills": [item…]}` oldest first):
```json
{
  "id": "5f1e…", "name": "house-style",
  "source": {"type": "inline", "name": "house-style", "content": "…", "mode": "trigger", "triggers": ["auth", "secrets"]},
  "created_at": "…", "updated_at": "…",
  "usage": {"agents": 2, "teams": 1}
}
```
Repo source (bundle row or an imported skill):
`{"type":"repo","url":"https://github.com/lazyxgenius/skills","ref":"main","filter":"review-*, pytest-*","mode":"agent","triggers"?:[…],"resolved_sha":"<40 hex>"}`.
At run time `resolved_sha` wins over `ref`, `filter` is comma-separated globs (any match keeps a
skill) and `mode` applies to every loaded skill (absent = each file's own format).

**Usage row** (`used_by_agents`, `used_by`, PUT responses):
`{"node_id","role_name","title","team_id","team_name"}` — `title` is `config.title` or `null`.

## Summary and agents

### `GET /api/toolkit/summary`
```json
{"tools": 3, "tools_needing_attention": 1, "skills": 3,
 "memory": {"inbox": 2, "active": 14, "archive": 5}, "secrets_missing": 1}
```
`memory.archive` = superseded + discarded. `secrets_missing` = distinct referenced names with no
stored value.

### `GET /api/agents?tool_id=<uuid>` | `?skill_id=<uuid>` | (no filter)
```json
{"teams": [
  {"team_id": "…", "team_name": "Indicator sprint team", "agents": [
    {"node_id": "…", "role_name": "Product manager", "title": null, "kind": "completion",
     "edits_allowed": false, "enabled": false, "overridden": false},
    {"node_id": "…", "role_name": "Reviewer", "title": "Reviewer", "kind": "agent",
     "edits_allowed": false, "enabled": true, "overridden": false}
  ]}
]}
```
Teams oldest first; agents left→right (`position.x`). `thinker` tag = `edits_allowed: false`.
Tool query: `enabled` = effectively uses it; `overridden` = an inline server of that name wins.
Skill query: `enabled` = has the ref; `overridden` = an inline skill of the same name wins the
first-in-list de-dup; each agent also has `mode` / `triggers` (its override, `null` when none).
No filter: all `enabled`/`overridden` false.
Errors: 404 `tool not found in your library` / `skill not found in your library`; 422 `Pass tool_id
or skill_id, not both.`

## Tools

| Method + path | Body | 200/201 response | Errors |
|---|---|---|---|
| `GET /api/tool-library` | — | `{"tools":[tool…]}` | — |
| `GET /api/tool-library/{id}` **new** | — | tool + `"used_by_agents":[usage row…]` | 404 `tool not found in your library` |
| `POST /api/tool-library` **changed: create-only** | `{"name","server_config"}` | full tool (200, was `{id,name}`) | 422 name/config (below); 409 `You already have a tool named <name>.` |
| `PATCH /api/tool-library/{id}` **changed** | `{"name"?,"server_config"?}` (partial) | full tool (was `{id,name}`) | 404; 422 as POST; 409 `You already have a tool named <name>.` (was a 500) |
| `DELETE /api/tool-library/{id}` **changed** | — | `{"removed_from_agents": 3}` (was 204) | none (idempotent: absent/foreign → `{"removed_from_agents":0}`) |
| `POST /api/tool-library/{id}/duplicate` **new** | — | 201, full tool named `<name>-copy`, then `-copy-2`… (no agents) | 404 |
| `POST /api/tool-library/import` **new** | `{"servers":{name:config…},"on_conflict":"error"\|"replace"\|"rename"}` | `{"added":[tool…],"conflicts":["linear"]}` | see below |
| `PUT /api/tool-library/{id}/agents` **new** | `{"node_ids":["…"]}` (the full desired set) | see below | 404 `tool not found in your library`; 404 `Agent not found.` |

Name + config rules (POST, PATCH when the name changes — an unchanged legacy name is allowed —,
import):
- 422 `A tool name is required.`
- 422 `Use lowercase letters, numbers, - and _, like my-server.` (rule `^[a-z0-9][a-z0-9_-]{0,63}$`)
- 422 `Add a command or a URL.` (neither, or config `{}`)
- 422 `Use a command or a URL, not both.`
- 422 `Use an http:// or https:// URL.`
- 422 `Arguments must be a list of strings.`
- 422 `Environment must be an object of names and values.` / `Headers must be an object of names and values.`

PATCH: a rename moves each agent's `servers[<old>]` switch to `servers[<new>]` (a switched-off
agent stays off). `used_by.agent_count` in the response feeds "Saved. N agents use the new settings".

DELETE strips the id from every library-team agent's `tvashtr.library` and drops its
`servers[<name>]` switch in the same transaction; `removed_from_agents` counts agents that were
effectively using it.

Import (one transaction, all or nothing):
- `added` = every tool written, in input order (replaced ones keep their id; renamed ones get
  `<name>-2`, `-3`…). `conflicts` = pasted names you already had. Read `added[].missing_secrets`
  for "linear needs a secret".
- 409 `{"code":"name_taken","message":"You already have a tool named linear.","conflicts":["linear"]}`
  (plural: `You already have tools named linear and jira.`) when `on_conflict` is `error` (default).
- 422 `{"code":"invalid_name","server":"Linear","message":"Use lowercase letters, numbers, - and _, like my-server."}`
- 422 `{"code":"invalid_server","server":"x","message":"Add a command or a URL."}` (any config rule above)
- 422 `Paste at least one server.`; 422 `on_conflict must be error, replace or rename.`
- VS Code `${input:x}`/`${env:X}` normalisation and `"type":"stdio"` stripping stay client-side.

PUT agents — a listed agent gets the ref and its switch on (a stale `enabled:false` is removed);
an unlisted agent that uses it loses the ref and its switch (unchecking = removing); a listed agent
with an inline server of the same name is skipped:
```json
{"agents": [{"node_id":"…","role_name":"Reviewer","title":null,"team_id":"…","team_name":"Indicator sprint team"}],
 "agent_count": 1, "team_count": 1,
 "skipped": [{"node_id":"…","reason":"an inline server named linear overrides it"}]}
```

## Secrets

| Method + path | Body | Response | Errors |
|---|---|---|---|
| `GET /api/secrets` **changed** | — | below | — |
| `POST /api/secrets` **changed: create-only** | `{"name","value"}` | `{"name","created_at","updated_at"}` (was `{name}`) | 422 / 409 below |
| `PUT /api/secrets/{name}` **new** | `{"value"}` | `{"name","created_at","updated_at"}` | 404 `No secret named <NAME>.`; 422 `A secret value is required.` |
| `DELETE /api/secrets/{name}` | — | 204 (unchanged, idempotent) | — |

```json
{"secrets": [
   {"name": "GITHUB_TOKEN", "created_at": "…", "updated_at": "…",
    "used_by_tools": [{"id": "…", "name": "github"}]},
   {"name": "SENTRY_TOKEN", "created_at": "…", "updated_at": "…", "used_by_tools": []}
 ],
 "missing": [{"name": "LINEAR_TOKEN", "used_by_tools": [{"id": "…", "name": "linear"}]}]}
```
`secrets[]` = stored rows only (`secrets[].name` still means "present"). `missing[]` = names library
tools reference with no stored value — a deleted secret that is still used shows up here (Q2).
No endpoint returns a value.

POST errors:
- 422 `A secret name is required.` / `A secret value is required.`
- 422 `Use capital letters, numbers and _, like <SUGGESTION>.` — rule `^[A-Z_][A-Z0-9_]{0,127}$`;
  the server computes the suggestion (upper-case, runs of other characters → `_`, e.g.
  `notion-token` → `NOTION_TOKEN`; falls back to `NOTION_TOKEN` when that is still invalid).
- 409 `<NAME> already exists. Use Replace value on it instead.`

Legacy names that break the rule still list, replace (`PUT`) and delete.

## Skills

| Method + path | Body / query | Response | Errors |
|---|---|---|---|
| `GET /api/skill-library` | — | `{"skills":[skill…]}` | — |
| `GET /api/skill-library/{id}` **new** | — | skill + `"used_by":[usage row…]` | 404 `skill not found in your library` |
| `POST /api/skill-library` **changed: create-only** | `{"name","source"}`; `?on_conflict=error` (default) \| `replace` | full skill (was `{id,name}`) | 422 below; 409 `You already have a skill called <name>.`; 422 `on_conflict must be error or replace.` |
| `PATCH /api/skill-library/{id}` **changed** | `{"name"?,"source"?}` (partial) | full skill | 404; 422 as POST; 409 `You already have a skill called <name>.` (was a 500) |
| `DELETE /api/skill-library/{id}` **changed** | — | `{"removed_from_agents": 2}` (was 204) | none (idempotent) |
| `POST /api/skill-library/{id}/duplicate` **new** | — | 201, full skill `<name>-copy` / `-copy-2`… | 404 |
| `GET /api/skill-library/{id}/agents` **new** | — | same as `GET /api/agents?skill_id=` | 404 |
| `PUT /api/skill-library/{id}/agents` **new** | `{"node_ids":[…]}` | same shape as the tool PUT (`skipped` always `[]`) | 404 skill / `Agent not found.` |
| `POST /api/skill-library/scan` **new** | `{"url","ref"?}` | below | below |
| `POST /api/skill-library/import` **new** | below | `{"added":[skill…],"skipped":["api-conventions"]}` | below |

Name + source rules (POST; PATCH when the name changes / a source is sent):
- 422 `A skill name is required.`
- 422 `Use lowercase letters, numbers and single hyphens, like house-style.` (`^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64)
- 422 `A skill source must be inline, repo, or project_rules.` (a `library` source is rejected)
- 422 `Add the SKILL.md content.` (inline with empty content)
- 422 `Pick how the skill loads: always, trigger or agent.`
- 422 `Add at least one trigger word.` (mode `trigger`)
- 422 `Use a GitHub repo URL, like https://github.com/org/skills.`
- 422 `resolved_sha must be a full 40-character commit SHA.`

Normalisation (what you get back): inline `name` defaults to the row name, `mode` defaults to
`always`, `triggers` becomes a trimmed list (a comma string is accepted); repo `url` becomes
`https://github.com/<o>/<r>` (`.git`, no scheme and bare `o/r` accepted), `ref` defaults to `main`,
`filter` becomes `"a, b"` (a list is accepted). A rename-only PATCH also renames an inline
source's `name` when it matched the row name; duplicate does the same for the copy.

DELETE strips every `{"type":"library","id":…}` ref from the owner's library-team agents in the
same transaction (a kept agent's other skills are untouched; an emptied list becomes `null`).

### Scan — `POST /api/skill-library/scan`
Body `{"url":"https://github.com/lazyxgenius/skills","ref":"main"}` (`ref` optional → the repo's
default branch). Private repos are read with the account's GitHub App installation token; public
ones also work unauthenticated.
```json
{"repo": "lazyxgenius/skills", "url": "https://github.com/lazyxgenius/skills",
 "ref": "main", "sha": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b", "short_sha": "1a2b3c4",
 "skills": [
   {"name": "api-conventions", "path": "skills/api-conventions.md", "description": null, "in_library": true},
   {"name": "pytest-review", "path": "skills/pytest-review/SKILL.md", "description": "Review pytest suites.", "in_library": false}
 ]}
```
Skills = what the SDK loader reads: `skills/<dir>/SKILL.md` (named by frontmatter `name`, else the
dir) and any other `skills/**.md` outside those dirs except `README.md` (frontmatter name, else the
file stem); sorted by name. `in_library` = the kebab-case row name import would use already exists
(mark those "Already in your skills", unchecked). "Only these skills" filtering stays client-side.
Errors (`detail` is an object):
- 404 `{"code":"repo_not_found","message":"We couldn’t find that repo. Check the name, or install the GitHub App on it if it’s private."}`
- 422 `{"code":"invalid_url","message":"Use a GitHub repo URL, like https://github.com/org/skills."}`
- 422 `{"code":"ref_not_found","message":"We couldn’t find <ref> in that repo."}`
- 422 `{"code":"no_skills","message":"No skills found. Skills live in a skills/ folder, like skills/review/SKILL.md."}`
- 502 `{"code":"github_unreachable","message":"GitHub didn’t answer. Try again."}`

### Import — `POST /api/skill-library/import`
```json
{"url": "https://github.com/lazyxgenius/skills", "ref": "main",
 "sha": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
 "skills": ["pytest-review", "house_style_py"],
 "mode": "agent", "triggers": null, "on_conflict": "skip"}
```
One row per skill, in one transaction. Row name = the skill name in kebab-case (`house_style_py` →
`house-style-py`); source =
`{"type":"repo","url","ref","mode","resolved_sha":sha,"filter":"<exact skill name>"}` (+`triggers`
for `mode:"trigger"`). `on_conflict`: `skip` (default; name listed in `skipped`), `replace`
(overwrites that row's source, keeps its id and agents), `error` → 409
`{"code":"name_taken","message":"You already have skills called a, b.","conflicts":[…]}`.
Errors: 422 `Pick at least one skill.`, 422 `sha must be the full 40-character commit SHA from the
scan.`, 422 `on_conflict must be skip, replace or error.`, plus the repo-source rules above.

## GitHub

### `GET /api/github/status` **new**
```json
{"hosted": true, "installed": true, "installation_count": 1, "repo_count": 2}
```
Owner-scoped, with the same one-shot App-side backfill as `GET /api/github/repos` for an account
with zero installation rows. `repo_count` sums GitHub's `total_count` per installation (one call
each); a dead installation is skipped. Self-hosted: `{"hosted":false,"installed":false,
"installation_count":0,"repo_count":0}` without calling GitHub. Install/manage URLs are still
`/api/config.github_install_url` / `github_manage_url`.

### `GET /api/auth/github/callback` **changed**
`code` is now optional. Without it (an App install whose Setup URL is the callback) the browser is
redirected (302) to the frontend origin (or the allow-listed Desktop loopback origin) with no
session change and nothing recorded — the app re-reads `/api/github/status` (whose backfill picks
up the installation). Still 404 when not hosted.

## Catalog / presets copy (`GET /api/tool-catalog`, `GET /api/skill-presets`)
- `fetch`: description `Fetch web pages over HTTP. Runs locally with uvx mcp-server-fetch.`, badge
  `Free · no login`.
- `github`: now the **remote** GitHub MCP — title `GitHub`, `server_config`
  `{"url":"https://api.githubcopilot.com/mcp/","headers":{"Authorization":"Bearer ${GITHUB_TOKEN}"}}`,
  badge `Needs GITHUB_TOKEN`, description (proposed, not designed) `GitHub's remote MCP server:
  issues, pull requests and code. Uses a token saved as GITHUB_TOKEN.`
- `github-app`: description `Hosted runs use your Tvashtr GitHub App installation. Install the App,
  then launch against an App repo.`
- Presets: `Ultra-compressed output style that keeps technical substance.`, `Red → green →
  refactor. Smallest code that makes the failing test pass.`, `Smallest change that solves the asked
  problem, no speculative extras.` Preset badges stay `Free`.

## Behaviour changes for existing callers
1. `POST /api/tool-library` is create-only (409 on a taken name; was a silent upsert) and enforces
   the name/config rules; returns the full item. `ToolsSection.attachFetch` already looks up first.
2. `POST /api/skill-library` is create-only by default; the preset path in
   `panel/SkillsSection.tsx` / `SkillsShelf.tsx` looks up by name first, but should pass
   `?on_conflict=replace` if it wants the old upsert. Names must now be kebab-case.
3. `POST /api/secrets` is create-only (409) with the name rule; replacing is `PUT
   /api/secrets/{name}`. `SecretsShelf.handleAdd`'s "add again to replace" no longer works.
4. `DELETE /api/tool-library/{id}` and `DELETE /api/skill-library/{id}` return 200
   `{"removed_from_agents":N}` instead of 204, and strip the refs from agents.
5. `PATCH` on tools/skills accepts a partial body and returns the full item (was `{id,name}`);
   clashes are 409 (were 500).
6. List items gain fields only; `GET /api/secrets` gains `missing` and per-secret fields.
7. A drawer holding a stale copy of a node's `tool_config`/`skills` will overwrite a Toolkit-side
   attach/remove when it saves (the node PATCH replaces them wholesale) — refetch the node on focus.
