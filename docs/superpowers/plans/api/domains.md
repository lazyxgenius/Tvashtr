# API contract — Domains (revamp round 2, `Dm-*` / `DmF-*`)

Requirements: `docs/superpowers/specs/2026-09-25-revamp-analysis/domains.md` (DM-1…DM-110, §3 gap
table, §6 decisions). Built group by group; each group appends its endpoints here.

Every endpoint needs a session (`tv_session` cookie) — without one: `401 {"detail": "Not authenticated"}`.
Every change is additive: no existing key was removed or renamed. Timestamps are ISO 8601 with offset.
Every route is owner-scoped: another account's domain answers `404 {"detail": "domain not found"}`
(a malformed id: `400 {"detail": "invalid domain id"}`).

New endpoints live in `backend/tvashtr/routes/domains.py`; the original `/api/domains*` endpoints stay
in `routers.py` and changed there in place.

| Method + path | Change | Group |
|---|---|---|
| `GET /api/domains` | items gain `files`, `pieces`, `state`, `quality`, `usage`, `last_activity_at`, `reading_model` | G1 |
| `GET /api/domains/{id}` | gains the same keys as a list item | G1 |
| `GET /api/domain-templates` | served in design order; items gain `short`, `piece_size`, `overlap`; `description` is the dialog copy | G1 |
| `GET/PATCH /api/account/preferences` | new whitelisted key `domains_howto_hidden` | G1 |

Schema: migration `0042_domain_message_meta` adds `domain_messages.meta JSONB NULL` (the Ask tab's
answer meta `{model, used_history, source}`; written from the Ask group on).

---

## The domain summary

Returned by `GET /api/domains` (as `domains[]`, **creation order** — the nav's order, OQ-3; the list
page sorts client-side) and by `GET /api/domains/{id}`.

```json
{
  "domain_id": "7f3a2c1e-0b4d-4c55-9a51-2f7d8e6b1a90",
  "name": "Support docs",
  "template": "support",
  "config": {
    "chunking": {"strategy": "fixed", "size": 600, "overlap": 100},
    "embedding": {"model": "text-embedding-3-small"},
    "retrieval": {"top_k": 8, "mode": "hybrid", "rerank": {"enabled": false, "model": null, "top_n": 20}, "graph": {"enabled": false}},
    "generation": {"model": null}
  },
  "status": "ready",
  "doc_count": 14,
  "created_at": "2026-09-23T09:12:40.118201+00:00",
  "updated_at": "2026-09-25T08:02:11.401233+00:00",

  "files": {"total": 14, "ready": 14, "reading": 0, "waiting": 0, "waiting_for_key": 0, "needs_attention": 0},
  "pieces": 1212,
  "state": "ready",
  "quality": {
    "cases": 12,
    "last_run_at": "2026-09-24T10:02:31.550310+00:00",
    "hit_at_k": 0.8333,
    "keyword_hit": 0.75,
    "retrieval_mode": "hybrid",
    "top_k": 8
  },
  "usage": {"uses": 3, "teams": 2, "steps": 1, "agents": 2},
  "last_activity_at": "2026-09-26T07:58:02.912004+00:00",
  "reading_model": {
    "slug": "openai/text-embedding-3-small",
    "label": "OpenAI text-embedding-3-small",
    "provider": "openai",
    "dim": 1536,
    "key_saved": true
  }
}
```

- `files` — the domain's files by phase. `ready`: read. `reading`: being read now (`ingest_status`
  `indexing`). `waiting`: queued and the reading model's key is saved. `waiting_for_key`: queued but the
  account holds no key for `reading_model.provider`. `needs_attention`: the read failed (`error`).
- `pieces` — chunks of **ready** files only.
- `state` — one word for the card badge and the nav dot, first match wins:
  `empty` (no files) → `reading` / `rereading` (any file reading or waiting; `rereading` when one of
  them was read before, `version > 1`) → `waiting_for_key` → `needs_attention` → `ready`.
- `quality` — `cases`: test questions; the rest come from the latest **completed** test run (`null`
  when none). `hit_at_k` / `keyword_hit` are 0–1 fractions (the card shows `round(hit_at_k × 100)%`).
- `usage` — over the account's **library** teams only: `steps` = Query domain nodes whose
  `config.domain_id` is this domain; `agents` = thinker/worker nodes whose
  `tool_config.tvashtr.domains` is `true` (the legacy "all domains" switch — counts for every domain)
  or a list containing this id; `uses` = `steps + agents`; `teams` = distinct teams among them.
- `last_activity_at` — the newest of the domain's and its files' `updated_at`.
- `reading_model` — the configured embedding model: normalised `slug`, the design's `label`
  (`OpenAI text-embedding-3-small`, `OpenAI text-embedding-ada-002`, `OpenRouter text-embedding-3-small`,
  `Gemini embedding-001`, `Hugging Face BGE-small (free)`), `provider` (the Engines key it needs),
  `dim`, and `key_saved` (the account holds that provider's key).

`GET /api/domains/{id}` — `404 {"detail": "domain not found"}` for an unknown id or another account's
domain; `400 {"detail": "invalid domain id"}` for a malformed id.

---

## `GET /api/domain-templates`

Served in the design's order (support, legal, financial, scientific, blank).

```json
{
  "templates": [
    {"template": "support", "name": "Support", "description": "Help center and product docs", "short": "Help center and product docs", "piece_size": 600, "overlap": 100},
    {"template": "legal", "name": "Legal", "description": "Contracts and policies · precise sources", "short": "Contracts and policies", "piece_size": 500, "overlap": 80},
    {"template": "financial", "name": "Financial", "description": "Filings, metrics, investor docs", "short": "Filings and investor docs", "piece_size": 700, "overlap": 100},
    {"template": "scientific", "name": "Scientific", "description": "Papers and methods · more context", "short": "Papers and methods", "piece_size": 1000, "overlap": 150},
    {"template": "blank", "name": "Blank", "description": "Start from defaults and tune it yourself", "short": "Start from defaults", "piece_size": 800, "overlap": 100}
  ]
}
```

`description` is the New domain dialog's line; `short` is the empty page's template card line.

---

## `GET /api/account/preferences`, `PATCH /api/account/preferences`

The whitelist gains `domains_howto_hidden` (bool, default `false`): the account hid the Domains list's
"how it works" strip (DM-6).

```json
{"get_started_hidden": false, "domains_howto_hidden": true}
```

`PATCH` body `{"domains_howto_hidden": true}` → `200` with the merged object;
a non-boolean → `422 {"detail": "domains_howto_hidden must be true or false."}`.
