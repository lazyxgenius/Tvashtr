# B-MEMORY API contract

Slice B-MEMORY of the frontend revamp (plan `../2026-09-25-frontend-revamp.md`; analysis
`../../specs/2026-09-25-revamp-analysis/toolkit-skills-memory.md` MEM rows, `panel.md` PANEL-65–69,
`focus-docs.md` FOCUS-55–59 / OQ-18). Every endpoint needs the `tv_session` cookie (401
`{"detail":"Not authenticated"}` without it) and only ever reads or writes the caller's memories:
another account's memory id gives the same 404 as an unknown one.

All changes are additive: no existing response key was removed or renamed.

## Behaviour changes

- **Repo identity.** A memory's `repo_key` is the run's GitHub `owner/name` for hosted runs
  (`run.github_repo or run.repo_path`). This applies at every write site (run-end distillation,
  agent "remember" captures) and in run-time retrieval, so repo memories now carry over from one
  hosted run to the next. Migration 0041 already rewrote the old clone-path keys. For manual
  memories, send `repo_key` as the `owner/name` from `GET /api/memory/repos`.
- **Node-only tier ("Not repo-specific").** `node_id` set with `repo_key: null` is valid
  (`tier: "node"`). It used to be a 422. It applies to that agent on every repo and on greenfield
  runs. `tier` is still `"account" | "repo" | "node"`: the UI's **Agent** scope is `tier === "node"`,
  and `repo_key === null` means "Not repo-specific".
- **Pinned notes always reach the agent.** If the retrieval query embed fails (provider error, or an
  owner with no OpenAI key), pinned facts are still injected first. Unpinned facts are then ranked
  by confirmations, then by recency, instead of by similarity.
- **Learning without an OpenAI key.** Run-end distillation and agent "remember" captures use the
  operator key when the owner has no OpenAI key, the same way manual memories already embed. That
  cost is metered off-ledger (`workflow_id NULL`), so it is not added to the run's cost. Owners who
  have a key are unchanged: their own key is used, and the cost is metered on the run.
- **Provenance.** Distilled facts now record `source_invocation_id` (the round) and `source_node_id`
  (the agent that learned it: its `node_role`, or the only role that ran).

## The memory object

Returned by `GET /api/memories` (`{"memories":[…]}`), `POST /api/memories`,
`PATCH /api/memories/{id}`, `/pin`, `/unpin`, `/promote`, `/reject`, `/requeue`, and
`GET /api/runs/{id}/memories`. `agent`, `source` and `source_iteration` are joined in batched
queries, so they cost the same for 1 row or 100.

```json
{
  "id": "0b8d2c7e-5f7a-4a55-9b1e-2a4f0f1f6c11",
  "content": "Run `uv run pytest -q` before shipping.",
  "polarity": "require",
  "repo_key": "lazyxgenius/trade_mcp",
  "repo_label": "lazyxgenius/trade_mcp",
  "node_id": "5d1f7a90-3c2e-4b8e-8f53-1f0c9a1d2e44",
  "tier": "node",
  "pinned": false,
  "status": "pending_review",
  "confirmation_count": 1,
  "source_run_id": "9a4c1e2b-7d3f-4f7a-a1c2-6b5e8d9f0a13",
  "source_invocation_id": 4812,
  "source_node_id": "5d1f7a90-3c2e-4b8e-8f53-1f0c9a1d2e44",
  "superseded_by": null,
  "embedding_dim": 1536,
  "valid_from": "2026-09-25T09:12:03.114Z",
  "invalid_at": null,
  "edited_at": null,
  "created_at": "2026-09-25T09:12:03.114Z",
  "updated_at": "2026-09-25T09:12:03.114Z",
  "agent": {
    "node_id": "5d1f7a90-3c2e-4b8e-8f53-1f0c9a1d2e44",
    "role_name": "reviewer",
    "title": "Reviewer",
    "team_id": "c2e0a8b4-11d9-4c55-9e2f-0d4b7a6c3f21",
    "team_name": "Indicator sprint team"
  },
  "source": {
    "kind": "run",
    "run_id": "9a4c1e2b-7d3f-4f7a-a1c2-6b5e8d9f0a13",
    "run_title": "Add an RSI indicator",
    "run_status": "completed",
    "run_succeeded": true,
    "round": 3,
    "agent_role": "reviewer",
    "team_name": "Indicator sprint team",
    "node_id": "5d1f7a90-3c2e-4b8e-8f53-1f0c9a1d2e44"
  },
  "source_iteration": 3,
  "superseded_reason": null
}
```

New fields:

| Field | Meaning |
|---|---|
| `repo_label` | A readable repo name: `owner/name` as-is, or the last folder of a local path (the repo folder in front of a legacy `/.tvashtr_clones/<run>` suffix). `null` when `repo_key` is `null`. |
| `agent` | The agent a node-tier memory is scoped to (`node_id`), or `null` for account and repo memories. `title` comes from the node's `config.title` (`null` if unset). If the node was deleted or belongs to another account, you get `{node_id, role_name:null, title:null, team_id:null, team_name:null}`. Show "Removed agent" in that case. |
| `source` | `kind: "manual"` means added by a person (every other field is `null`). `kind: "run"` means the run that taught it: `run_title` is `runs.idea`, capped at 120 characters. `run_succeeded` is `run_status === "completed"`. `round` is the teaching invocation's iteration. `agent_role` is the agent that learned it. `team_name` is the run's library team, or its snapshot. `node_id` is the learner (`source_node_id`). If the run was deleted, the run fields are `null`. |
| `source_iteration` | Same as `source.round` (for the drawer's "Learned in round n"). |
| `source_node_id` | The agent that learned it, even for repo-tier facts. Agent-remember captures and manual memories have `null`. |
| `superseded_by` | For `status: "superseded"`: the id of the memory that replaced it. |
| `superseded_reason` | For `status: "superseded"`: `"merged"` when the memory that replaced it has the same force sign (a Keep or Restore folded it into a memory you already had), `"replaced"` when the sign differs (a memory that says the opposite replaced it). `null` for every other status, when the replacing memory is gone, and when either memory's force was edited after the retirement (the reason is read from the forces, so an edit would otherwise flip it; the retirement kind isn't stored). The Archive says "Merged into a memory you already had", "Replaced by a newer memory", or for `null` "Another memory took its place". |
| `edited_at` | When a person last changed the content, force or scope ("Edited by you · …"). A pin never sets it, and neither does a PATCH that changes nothing. |

UI hints:
- "From a failed run · … · a caution": `source.kind === "run" && source.run_succeeded === false` with
  `polarity` in `avoid|forbid`.
- `"<Role> · <Team>"`: `agent.title ?? agent.role_name` and `agent.team_name`.
- The "Kept. <Role> uses it…" toast: `agent?.role_name ?? source.agent_role`.

## Changed endpoints

### `POST /api/memories`
Unchanged, except that `node_id` without `repo_key` is now accepted (the node-only tier) and returns
200. Errors are unchanged: 422 `"content is required"`, 422 `"node_id must be a uuid"`, 422 for an
invalid polarity (`"invalid polarity 'x' (must be one of [...])"`), 502 `"the embedding call failed"`.

### `PATCH /api/memories/{memory_id}`
Body (every field optional):

```json
{ "content": "…", "polarity": "forbid", "pinned": true, "scope": "repo", "repo_key": "octo/app" }
```

- `scope` is one of `"account" | "repo" | "agent"`:
  - `account`: `repo_key = null`, `node_id = null`.
  - `repo`: `repo_key` = the one you send, otherwise the memory's own, otherwise its source run's
    repo; `node_id = null`.
  - `agent`: `node_id` = the memory's agent, otherwise the agent that learned it
    (`source_node_id`). The repo stays the memory's own unless you send `repo_key`; an explicit
    `"repo_key": null` makes it "Not repo-specific".
- `repo_key` is only read together with `scope`.
- `edited_at` is set when the content, polarity or scope actually changes. The content is only
  re-embedded when the text changes.

Response: the memory object.

Errors:

| Status | `detail` |
|---|---|
| 422 | `"This memory has no repo to scope to."` |
| 422 | `"This memory has no agent to scope to."` |
| 422 | `"scope must be one of account, repo, agent"` |
| 422 | `"Send a scope with repo_key."` |
| 422 | `"content cannot be blank"` (unchanged) |
| 422 | `"invalid polarity 'x' (must be one of [...])"` (unchanged) |
| 404 | `"memory not found"` |
| 502 | `"the embedding call failed"` (only when the content changes) |

### `POST /api/memories/{memory_id}/promote`
The response is unchanged apart from enrichment, plus:
- `action: "promote_merged"`: the response is the **existing** memory it merged into (`id` is that
  memory), and it now also carries **`merged_id`**: the id you promoted. Undo must call
  `/requeue` with `merged_id`.
- `action: "promote_supersede"` still carries `superseded` (the id it replaced).

### `GET /api/runs/{run_id}/memories`, `/pin`, `/unpin`, `/reject`, `GET /api/memories`
The same shapes as before, with the enriched memory object.

## New endpoints

### `POST /api/memories/{memory_id}/requeue`
Sends a memory back to the Inbox (`status: "pending_review"`). This is the Undo for **Keep** and
**Discard** (and for the drawer's Keep, PANEL-66). Call it with the id you promoted or rejected; for
a merge, that is the promote response's `merged_id`. No body.

What it reverses:
- `promote`: active → pending_review.
- `promote_supersede`: active → pending_review, and every memory it superseded goes back to
  `active` (their `invalid_at` and `superseded_by` are cleared).
- `promote_merged`: superseded → pending_review (`invalid_at` and `superseded_by` cleared), and the
  memory it merged into loses the confirmation it gained (`confirmation_count - 1`, never below 1).
- `reject`: rejected → pending_review (`invalid_at` cleared).
- A memory that is already pending is left unchanged (`action: "already_pending"`).

Response 200: the memory object plus the fields below.

```json
{
  "id": "0b8d2c7e-5f7a-4a55-9b1e-2a4f0f1f6c11",
  "status": "pending_review",
  "…": "…the memory object…",
  "action": "requeue",
  "restored": ["7c1e9a33-2b4d-4e6f-8a0b-9d8c7e6f5a41"],
  "unmerged_from": null
}
```

- `action` is `"requeue"` or `"already_pending"`.
- `restored` lists the ids that were made active again (after a supersede).
- `unmerged_from` is the id whose confirmation was taken back (after a merge), or `null`.

Errors: 404 `"memory not found"` (unknown or malformed id, or another account's memory).

### `GET /api/memories/counts`
Returns the counts for the tabs and the nav badge ("Memory 2 new" is `inbox`).

```json
{ "inbox": 2, "active": 14, "archive": 3 }
```

`inbox` is `pending_review`. `active` is `active`. `archive` is `superseded` + `rejected`.

### `GET /api/memory/repos?include_github=false`
The repos a memory can be scoped to: the Active tab's Repo filter, and the "One repo" select in Add
memory. The list combines:
- the `repo_key` of your active and pending memories;
- the repos of your runs (`github_repo`, otherwise a local `repo_path`). Per-run clone folders and
  Desktop snapshot folders are skipped;
- with `include_github=true`, the repos your GitHub App installation can reach. This is one GitHub
  call per installation, and it is best-effort: failures are skipped silently.

Sorted by `label`, case-insensitive.

```json
{
  "repos": [
    {
      "repo_key": "lazyxgenius/cryptoground-mcp",
      "label": "lazyxgenius/cryptoground-mcp",
      "memory_count": 0,
      "pending_count": 0,
      "last_run_at": "2026-09-24T17:40:11.502Z"
    },
    {
      "repo_key": "lazyxgenius/trade_mcp",
      "label": "lazyxgenius/trade_mcp",
      "memory_count": 9,
      "pending_count": 2,
      "last_run_at": "2026-09-25T09:02:44.020Z"
    }
  ]
}
```

- `memory_count` counts active memories only. `pending_count` counts Inbox memories.
- `last_run_at` is the time of your latest run on that repo, or `null`. The latest one is a
  sensible default for Add memory.

The Repo filter should match `memory.repo_key === repo.repo_key` and also include account-scoped
memories (spec Q9).
