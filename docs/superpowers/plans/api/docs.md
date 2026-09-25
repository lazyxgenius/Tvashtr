# B-DOCS — API contract (Focus view + Documents)

Slice B-DOCS of the frontend revamp. Every endpoint below requires the `tv_session` cookie (401
otherwise, as for all `/api/*`). All changes are **additive** except the owner checks (§3.6 of the
spec), which now 404 documents that belong to another account.

**Ownership.** A document belongs to the account that owns its run: `documents.run_id → runs.owner_id`,
or — for a legacy pre-0028 document with no `run_id` — the run whose `pm_document_id` points at it. A
document with neither (the `/api/spike/generate-doc` proof workflow) belongs to nobody: every
document endpoint 404s it and the list never includes it.

**Author object** (used by versions, `latest_version`, the stale-version 409):

```json
{ "kind": "agent", "node_id": "6f1c…", "role_name": "pm", "label": "Product manager" }
{ "kind": "human", "node_id": null, "role_name": null, "label": "You" }
```

- `node_id` is the **authored** node (the node on the team canvas — a run executes a clone, and the
  clone's `cloned_from_node_id` is followed). It can be `null` for an agent when the writer can't be
  resolved (e.g. a deleted node on an old row).
- `label`: the node's `config.title` when set, else `pm → "Product manager"`, `architect →
  "Architect"`, `engineer → "Engineer"`, `reviewer → "Reviewer"`, else the humanized role
  (`tech_writer → "Tech writer"`), else `"Agent"`.

**Agent ref** (used by `written_by[]` / `read_by[]`):

```json
{ "node_id": "6f1c…", "clone_node_id": "a02e…", "role_name": "pm", "label": "Product manager" }
```

`node_id` = authored node, `clone_node_id` = the node in the run's snapshot graph (the ids
`GET /api/runs/{id}/graph` returns).

**Change notes** (`note`), deterministic (spec OQ-22, no LLM):

| Written by | Note |
|---|---|
| entry agent, first version of the shared spec | `First draft` |
| entry agent, a later round | `Revised in round {n}` |
| an agent's `writes_to` document | `Round {n}` |
| a human save (default) | `Edited while the run was live` |

Stored on new rows; derived from `idempotency_key` for rows written before this slice. `null` when
nothing fits (e.g. a proof-workflow document).

**Live run.** A run is live while `status` ∈ `pending`, `running`, `awaiting_human`; every other
status (`completed`, `failed`, `rejected`, `cancelled`, `over_budget`) is finished.

---

## GET /api/documents

Owner-scoped now (was: every account's documents). Shape unchanged.

```json
{
  "documents": [
    {
      "id": "0b7d6a0e-2f5e-4f27-9f0b-3d7f7a2c9c11",
      "title": "Mini-PRD",
      "doc_type": "prd",
      "name": "spec",
      "created_at": "2026-09-25T13:02:11.482113+00:00",
      "updated_at": "2026-09-25T13:09:40.120551+00:00"
    }
  ]
}
```

The frontend doesn't need this endpoint; use `GET /api/runs/{id}/documents`.

## GET /api/runs/{run_id}/documents

Every document the run produced, oldest first, with its latest version, writers and readers.

```json
{
  "run_id": "3c1f4d8e-9a57-4b3e-8a51-2f0d7c0b6e12",
  "run": {
    "run_id": "3c1f4d8e-9a57-4b3e-8a51-2f0d7c0b6e12",
    "idea": "Add a dark-mode toggle to settings",
    "status": "running",
    "created_at": "2026-09-25T13:02:05.001234+00:00",
    "live": true
  },
  "documents": [
    {
      "id": "0b7d6a0e-2f5e-4f27-9f0b-3d7f7a2c9c11",
      "title": "Mini-PRD",
      "doc_type": "prd",
      "name": "spec",
      "created_at": "2026-09-25T13:02:11.482113+00:00",
      "updated_at": "2026-09-25T13:09:40.120551+00:00",
      "is_shared_spec": true,
      "version_count": 3,
      "latest_version": {
        "version_no": 3,
        "created_at": "2026-09-25T13:09:40.120551+00:00",
        "author": { "kind": "human", "node_id": null, "role_name": null, "label": "You" },
        "note": "Edited while the run was live"
      },
      "written_by": [
        { "node_id": "6f1c…", "clone_node_id": "a02e…", "role_name": "pm", "label": "Product manager" }
      ],
      "read_by": [
        { "node_id": "6f1c…", "clone_node_id": "a02e…", "role_name": "pm", "label": "Product manager" },
        { "node_id": "91be…", "clone_node_id": "c7d4…", "role_name": "engineer", "label": "Engineer" },
        { "node_id": "e3a0…", "clone_node_id": "5b9f…", "role_name": "reviewer", "label": "Reviewer" }
      ]
    },
    {
      "id": "5d2e8f3a-7c41-4a0b-b6f1-0e9c2d4a8b77",
      "title": "Document: build-notes",
      "doc_type": "build-notes",
      "name": "build-notes",
      "created_at": "2026-09-25T13:05:52.310000+00:00",
      "updated_at": "2026-09-25T13:05:52.310000+00:00",
      "is_shared_spec": false,
      "version_count": 1,
      "latest_version": {
        "version_no": 1,
        "created_at": "2026-09-25T13:05:52.310000+00:00",
        "author": { "kind": "agent", "node_id": "91be…", "role_name": "engineer", "label": "Engineer" },
        "note": "Round 1"
      },
      "written_by": [
        { "node_id": "91be…", "clone_node_id": "c7d4…", "role_name": "engineer", "label": "Engineer" }
      ],
      "read_by": [
        { "node_id": "e3a0…", "clone_node_id": "5b9f…", "role_name": "reviewer", "label": "Reviewer" }
      ]
    }
  ]
}
```

- `is_shared_spec`: the run's shared spec (`runs.pm_document_id`) — label it "Shared spec".
- `latest_version` is `null` for a document with no versions (not produced by the executor today).
- `written_by`: the entry agent for the shared spec, plus every non-verdict agent whose Writes names
  the document, plus any agent that actually wrote a version. Humans are never listed (they show in
  the versions).
- `read_by`: every agent that gets the document in its context, derived from the run's snapshot
  config: an agent with Reads (`config.reads_from`) reads exactly those names; one without reads the
  shared spec unless `config.reads_default` is `false`. It **includes the entry agent** (it re-reads
  the spec on refine rounds — OQ-12), so the "read by all {k} agents" count is `read_by.length`;
  the "Read by" badges should drop anyone also in `written_by`.
- Errors: `404 {"detail": "run not found"}` (unknown run or another account's).

## GET /api/documents/{document_id}

```json
{
  "id": "0b7d6a0e-2f5e-4f27-9f0b-3d7f7a2c9c11",
  "title": "Mini-PRD",
  "doc_type": "prd",
  "name": "spec",
  "created_at": "2026-09-25T13:02:11.482113+00:00",
  "updated_at": "2026-09-25T13:09:40.120551+00:00",
  "run_id": "3c1f4d8e-9a57-4b3e-8a51-2f0d7c0b6e12",
  "is_shared_spec": true,
  "editable": true,
  "versions": [
    {
      "id": "d1e0…",
      "document_id": "0b7d6a0e-2f5e-4f27-9f0b-3d7f7a2c9c11",
      "version_no": 1,
      "content": "# Dark mode\n\n## Goal\n…",
      "created_by": "agent:entry",
      "created_at": "2026-09-25T13:02:11.482113+00:00",
      "note": "First draft",
      "author": { "kind": "agent", "node_id": "6f1c…", "role_name": "pm", "label": "Product manager" }
    },
    {
      "id": "77aa…",
      "document_id": "0b7d6a0e-2f5e-4f27-9f0b-3d7f7a2c9c11",
      "version_no": 2,
      "content": "# Dark mode\n\n## Goal\n…",
      "created_by": "agent:entry",
      "created_at": "2026-09-25T13:06:30.000100+00:00",
      "note": "Revised in round 2",
      "author": { "kind": "agent", "node_id": "6f1c…", "role_name": "pm", "label": "Product manager" }
    },
    {
      "id": "9c3b…",
      "document_id": "0b7d6a0e-2f5e-4f27-9f0b-3d7f7a2c9c11",
      "version_no": 3,
      "content": "# Dark mode\n\n## Goal\n…",
      "created_by": "human",
      "created_at": "2026-09-25T13:09:40.120551+00:00",
      "note": "Edited while the run was live",
      "author": { "kind": "human", "node_id": null, "role_name": null, "label": "You" }
    }
  ]
}
```

- Versions are oldest first (`version_no` ascending); every version carries its full `content`, so
  Compare diffs client-side.
- `editable`: the server accepts a new version right now (the run is live). Per OQ-7 the UI shows
  **Edit only when `editable && is_shared_spec`** and the latest version is shown; the server itself
  also accepts named documents of a live run.
- `updated_at` now moves with every new version (it never changed before).
- Errors: `400 {"detail": "invalid document id"}`, `404 {"detail": "document not found"}` (unknown,
  another account's, or run-less).

## POST /api/documents/{document_id}/versions

Request:

```json
{ "content": "# Dark mode\n…", "base_version_no": 3, "note": "Narrowed the scope" }
```

- `content` (string, required) — the full markdown.
- `base_version_no` (int, optional) — the version the editor was opened on (the latest shown). When
  it is not the document's newest version the save is refused (below). Omit it to skip the check.
- `note` (string, optional) — defaults to `"Edited while the run was live"` (blank → default).

`200` — the full new version (the old keys `document_id`, `version_no`, `content`, `created_at` are
still there):

```json
{
  "id": "4e1f…",
  "document_id": "0b7d6a0e-2f5e-4f27-9f0b-3d7f7a2c9c11",
  "version_no": 4,
  "content": "# Dark mode\n…",
  "created_by": "human",
  "created_at": "2026-09-25T13:12:03.554120+00:00",
  "note": "Edited while the run was live",
  "author": { "kind": "human", "node_id": null, "role_name": null, "label": "You" }
}
```

Errors:

| Status | `detail` |
|---|---|
| 400 | `"invalid document id"` |
| 404 | `"document not found"` (unknown, another account's, or run-less) |
| 409 | `{"code": "run_finished", "message": "This run has finished — edits can’t reach its agents."}` |
| 409 | `{"code": "stale_version", "message": "Product manager saved v4 while you were editing. Compare, then save again.", "latest_version_no": 4, "latest_author": {"kind": "agent", "node_id": "6f1c…", "role_name": "pm", "label": "Product manager"}}` |
| 422 | FastAPI validation error (missing `content`, non-integer `base_version_no`) |

- `run_finished` is checked first; nothing is written in either 409 case.
- `stale_version.message`: `"{latest_author.label} saved v{n} while you were editing. Compare, then
  save again."`; when the newer version is a human save it reads `"A newer v{n} was saved while you
  were editing. Compare, then save again."`. The UI may compose its own copy from the fields.
- The base check runs in the same transaction as the insert (document row locked), and an agent
  that wins the race to the same `version_no` is also reported as `stale_version`.

## Context manifest: which document versions each agent read (FOCUS-66)

Every agent round's `context_manifest` (exposed on `GET /api/runs/{id}/graph` →
`nodes[].invocations[].context_manifest` and on `GET /api/runs/{id}/trajectory`) gains a
`documents` list when the agent was given any document:

```json
{
  "parts": [{ "name": "node_prompt", "tokens": 412 }, { "name": "idea", "tokens": 18 }, { "name": "read_documents", "tokens": 950 }],
  "total_tokens": 1380,
  "budget": 100000,
  "handle_used": false,
  "documents": [
    { "name": "spec", "document_id": "0b7d…", "version_no": 3, "is_shared_spec": true },
    { "name": "build-notes", "document_id": "5d2e…", "version_no": 1, "is_shared_spec": false }
  ]
}
```

- Absent on the entry agent's first round (it reads nothing) and on rounds recorded before this
  slice. For those, the frontend (or the B-NODES rounds endpoint) can fall back to "the latest
  version with `created_at ≤` the round's `started_at`".
- A missing Reads name is simply not listed (the executor skips documents that don't exist yet).
- "Shared spec v3" / "build-notes v2" = `is_shared_spec ? "Shared spec" : name` + ` v{version_no}`.
