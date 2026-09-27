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
| `GET /api/domains/{id}` | also gains `setup`, `answer_model`, `last_question_at` | G2 |
| `GET /api/domains/{id}/documents` | `?q=&status=`; items gain `kind`, `phase`, `pieces`, `pieces_total`, `pieces_done`, `progress`, `problem` (+ `matched`); answer gains `counts`, `total_pieces`, `query`, `status` | G2 |
| `POST /api/domains/{id}/documents` | starts reading by itself; answer gains `reading` | G2 |
| `POST /api/providers` | saving a key starts files waiting for that provider's key | G2 |
| `POST /api/domains/{id}/reread` | **new** — read some or all files again | G2 |
| `GET /api/domains/{id}/documents/{doc}/pieces` | **new** — one file's pieces + how often answers cite it | G2 |
| `GET /api/domains/{id}/documents/{doc}/file` | **new** — download the original | G2 |
| `POST /api/domains` | optional `embedding_model`; the name rule (1–120 characters, unique per account ignoring case → `409`); answers with the full summary | G3 |
| `PATCH /api/domains/{id}` | a new `name` follows the name rule (`409` on a clash, `422` copy) | G4 |
| `POST /api/domains/{id}/duplicate` | **new** — Duplicate settings: an empty copy with the same template and settings | G4 |
| `DELETE /api/domains/{id}` | clears the steps and agents that used it; answer gains `steps_cleared`, `agents_cleared` | G4 |
| `POST /api/domains/{id}/ask` | optional `use_history`; the NOT_FOUND rule; answer gains `covered`, `answer_text`, `sources`, `searched`, `used_history`, `model_label` | G6 |
| `GET /api/domains/{id}/messages` | answers gain the same keys (+ `model`) | G6 |
| `DELETE /api/domains/{id}/messages` | **new** — Clear chat | G6 |
| `GET /api/domains/{id}/eval/cases` | items gain `expected_files` | G7 |
| `POST /api/domains/{id}/eval/cases` | needs a file or a key word; Quality copy for every `422`; answer gains `expected_files` | G7 |
| `PATCH /api/domains/{id}/eval/cases/{case_id}` | **new** — edit a test question | G7 |
| `POST /api/domains/{id}/eval/runs` | **new** — run all tests in the background (`202`) | G7 |
| `GET /api/domains/{id}/eval/runs` | **new** — the runs, newest first | G7 |
| `GET /api/domains/{id}/eval/runs/{run_id}` | **new** — one run with every case's result and top passages | G7 |
| `POST /api/domains/{id}/eval` (sync, old) | `scores` gains `config`; each `per_case` entry gains `top` | G7 |
| `PATCH /api/domains/{id}` | optional `template` (the starting point; `400` unknown); the Settings numbers are checked with the tab's copy (`422`) | G9 |
| retrieval (Ask, tests, nodes, MCP) | "Look wider, then keep the best" (`retrieval.rerank.enabled`) re-scores its wider pool — no longer a passthrough | G9 |
| `PATCH /api/domains/{id}` | a reading model with other weights re-reads every file (bug fix: not only on a dimension change); answer gains `reread` | G10 |
| `GET /api/domains/{id}` | gains `rereading` (the running re-read: files, done, estimate, reason, tests after) | G10 |
| `POST /api/domains/{id}/reread` | the files share one version (a re-read asked for during another joins it); `run_tests_after` holds even when a read was already running | G10 |
| `POST /api/domains/{id}/ask`, `…/retrieve` (+ nodes, MCP) | `409` while a new reading model re-reads the files | G10 |
| `GET /api/domains/{id}/usage` | **new** — the Query domain steps that ask it and the agents that can search it | G11 |
| `GET /api/domains/{id}/step-places` | **new** — the Add step dialog's teams, main paths and "After <agent>" places | G11 |
| `POST /api/domains/{id}/steps` | **new** — add the domain to a team as a Query domain step (`201`) | G11 |
| `GET /api/domains/{id}/agents` | **new** — every agent and whether it can search the domain | G11 |
| `PUT /api/domains/{id}/agents` | **new** — exactly these agents can search the domain | G11 |
| agent tools (`tool_config.tvashtr.domains`) | a list of domain ids now works (sends `X-Tvashtr-Domains`); the Domains MCP tools take the domain by name | G11 |
| `POST /api/teams/{team_id}/nodes` (`domain_query`) | a new node's `config` gains `pass_to_spec: true`, `on_no_answer: "continue"` | G12 |
| `PATCH /api/teams/{team_id}/nodes/{node_id}` (`domain_query`) | optional `pass_to_spec`, `on_no_answer` (`"continue"`/`"stop"`, else `422`) | G12 |
| `GET /api/teams/{team_id}/validate`, `POST /api/runs` | `domain_query_no_domain` also for a domain that isn't one of the account's (deleted) | G12 |
| `GET /api/teams/{team_id}/nodes/{node_id}/runs` | `run` gains `number`; a Query domain node's rounds gain `domain` | G12 |
| runs (Query domain nodes with the settings) | the answer goes into the spec, a not-covered answer can stop the run (`failure_code: "domain_no_answer"`), the lookup waits while the domain re-reads, its spend is on the run | G12 |
| `POST /api/domains/{id}/ask` | answer gains `usage` (tokens + cost, question embedding included) | G12 |

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

---

## Automatic reading (G2)

Uploading a file starts reading it; there is no Ingest step any more (`POST /ingest` still works for
old clients). A domain reads **one file at a time**, oldest first (OQ-24): the durable DBOS workflow
`read_domain_files` reads a file (`prepare_document_step` → `embed_batch_step` × ⌈pieces ÷ 16⌉ →
`finish_document_step`), and each file's last step claims the next waiting file under a per-domain
advisory lock, so files uploaded during a read are picked up by the running read. Pieces are stored
with no embedding first and filled 16 at a time — that is the per-file `progress`. PDF pieces carry
`meta.page` (the page they start on); every new piece carries `meta.chunk_size`.

A file whose reading key is missing waits (`phase: "waiting_for_key"`). Saving that provider's key
(`POST /api/providers`, below) starts it. A file left `indexing` for 10 minutes with no progress (a
crashed process) is picked up again by the next upload, re-read or key save.

Loading `GET /api/domains` or `GET /api/domains/{id}` also starts reading any domain it shows as
`reading`/`rereading` whose waiting files have no read running (files uploaded before reading was
automatic, or left by a read that died) — best-effort, the answer is unchanged. A "Reading" state
always has a reader behind it.

---

## `GET /api/domains/{id}` (G2 additions)

```json
{
  "...": "every key of the domain summary above",
  "setup": {"key": true, "files_read": false, "tested": false, "used": false},
  "answer_model": {
    "configured": null,
    "resolved": "openai/gpt-4o-mini",
    "label": "OpenAI gpt-4o-mini",
    "provider": "openai",
    "key_saved": true
  },
  "last_question_at": null
}
```

- `setup` — the four setup-strip steps (DM-37). `key`: the reading key is saved. `files_read`: the
  first read has finished — sticky: once some file was read before the files now waiting were added
  (or any file was read twice), it stays `true`, so later uploads and re-reads don't bring the setup
  strip back. `tested`: it has test questions or someone asked it a question. `used`: `usage.uses > 0`.
  The page shows the setup strip while `files_read` is `false`, else the summary strip (Sources only).
- `answer_model` — `configured` is `config.generation.model` (`null` = account default); `resolved` is
  what answers now (`null` when nothing resolves); `label` is the design's name for the three presets
  (`Groq gpt-oss-120b`, `OpenAI gpt-4o-mini`, `OpenRouter gpt-4o-mini`), else the slug; `key_saved`: the
  account holds `provider`'s key.
- `last_question_at` — the newest question asked in Ask (`null` when none).

---

## `GET /api/domains/{id}/documents`

Query: `q` (≤ 200 chars; matches the file name, case-insensitively, **or** the file's text via the
English full-text index — "refund" finds a file that says "Refunds"), `status` — `all` (default) |
`ready` | `reading` (reading, re-reading, waiting and waiting for a key) | `needs_attention`.

```json
{
  "documents": [
    {
      "document_id": "3b0c1f2e-7a55-4d8e-9f10-2c4b6d8e0a11",
      "domain_id": "7f3a2c1e-0b4d-4c55-9a51-2f7d8e6b1a90",
      "filename": "refund-policy.md",
      "content_type": "text/markdown",
      "byte_size": 18432,
      "ingest_status": "ready",
      "error_message": null,
      "version": 1,
      "created_at": "2026-09-12T09:14:02.118201+00:00",
      "updated_at": "2026-09-12T09:14:31.401233+00:00",
      "kind": "MD",
      "phase": "ready",
      "pieces": 42,
      "pieces_total": 42,
      "pieces_done": 42,
      "progress": null,
      "problem": null,
      "matched": "name"
    },
    {
      "document_id": "9d2e4f60-1b3c-4a5d-8e7f-0a1b2c3d4e5f",
      "filename": "billing-faq.pdf",
      "kind": "PDF",
      "ingest_status": "error",
      "error_message": "AuthenticationError: 401 Incorrect API key provided",
      "phase": "needs_attention",
      "pieces": null,
      "pieces_total": 0,
      "pieces_done": 0,
      "progress": null,
      "problem": {"kind": "key_rejected", "message": "OpenAI rejected the key (401).", "fix": "engines_key"},
      "matched": "text",
      "...": "the other keys as above"
    }
  ],
  "counts": {"all": 14, "ready": 13, "reading": 0, "needs_attention": 1},
  "total_pieces": 1212,
  "query": "refund",
  "status": "all"
}
```

- Files are listed **oldest first** (the order they were added).
- `kind` — `PDF` | `MD` | `HTML` | `TXT` (the table's tile).
- `phase` — `ready` | `reading` (first read) | `rereading` (`version > 1`) | `waiting` (queued, key
  saved) | `waiting_for_key` | `needs_attention`.
- `pieces` — the piece count of a **ready** file, else `null` (the table shows "—"). `pieces_total` /
  `pieces_done` — pieces cut / embedded so far. `progress` — `pieces_done ÷ pieces_total` (0–1, 4
  decimals; `0.0` before the file is cut) while `reading`/`rereading`, else `null`.
- `problem` — only for `needs_attention`: the stored error in the table's words (DM-43). `kind` is
  `key_rejected` ("<Vendor> rejected the key (401)." + `fix: "engines_key"`), `no_text` ("No text
  found. It may be a scanned image. Export it as text-based PDF."), `rate_limited` ("<Vendor> is busy
  right now. Re-read it in a minute."), `unsupported` ("Only PDF, Markdown, text or HTML files can be
  read."), `wrong_dim` / `other` ("Couldn’t read this file: <first line of the error>.").
  G5: `fix` turns `null` once a key for the reading model's provider was saved **after** the file
  failed (the fix is made; the row's ⋯ → Re-read this file, DmF-Fail-2); the message stays.
- `matched` — only with `q`: `name` or `text`.
- `counts` — the Show filter's numbers, **unfiltered** by `q`/`status`. `total_pieces` — ready pieces
  of every file.

Errors: `404 {"detail": "domain not found"}`; `422 {"detail": "status must be one of: all, ready,
reading, needs_attention"}`.

---

## `POST /api/domains/{id}/documents` (G2 addition)

Unchanged request (multipart `file`) and item keys; the answer gains `reading`:
`"started"` (this upload started a read), `"queued"` (a read is running and will take it) or
`"waiting_for_key"` (no key for the reading model yet).

```json
{"document_id": "…", "filename": "refund-policy.md", "ingest_status": "pending", "...": "…", "reading": "started"}
```

---

## `POST /api/providers` (G2 addition)

After the key is saved, every domain of the account whose files wait for **that provider's** key
starts reading. Best-effort: it never changes the answer or fails the save.

---

## `POST /api/domains/{id}/reread` → `202`

Body (optional): `{"document_ids": ["<uuid>", …], "run_tests_after": false}` — omit `document_ids` to
read every file again. Each file goes back to waiting with `version` + 1 (so it shows as
"Re-reading"), then reading starts. A file being read at that moment is left to that read. With
`run_tests_after`, the domain's test questions run when the read finishes (a test run like
`POST /eval`).

```json
{"reading": 1, "run_tests_after": false, "state": "started"}
```

`state` — `started` | `queued` | `waiting_for_key` | `idle`.

Errors: `404 {"detail": "domain not found"}`, `404 {"detail": "document not found"}` (an id that isn't
one of the domain's files), `400 {"detail": "invalid document id"}`,
`409 {"detail": "This domain is already re-reading."}` (every file asked for while a full re-read runs).

---

## `GET /api/domains/{id}/documents/{doc}/pieces`

Query: `q` (≤ 200; keeps pieces whose text contains it, case-insensitively, literally), `offset`
(≥ 0, default 0), `limit` (1–200, default 50).

```json
{
  "document": {"document_id": "3b0c1f2e-…", "filename": "refund-policy.md", "kind": "MD", "phase": "ready", "pieces": 42, "...": "a files-list item"},
  "pieces": [
    {"ordinal": 0, "number": 1, "chars": 598, "page": null, "text": "# Refund policy. This page explains when and how customers can get their money back…"},
    {"ordinal": 1, "number": 2, "chars": 600, "page": null, "text": "Refunds apply to the subscription price only. …"}
  ],
  "total": 42,
  "query": "",
  "used_in_answers": {"count": 6, "of": 20}
}
```

- `number` is `ordinal + 1` ("Piece 1 of 42" — the "of" is `document.pieces_total`); `total` counts
  the pieces matching `q` (for paging); `page` is the PDF page the piece starts on (`null` for other
  kinds and for pieces read before G2).
- `used_in_answers` — of the domain's last 20 answers (`of` ≤ 20), how many cite this file: an answer
  cites the passages its `[n]` markers name; a `NOT_FOUND:` answer cites none; an answer with no marker
  counts its top two passages. The sheet hides the line when `of` is 0.

Errors: `404 {"detail": "domain not found"}`, `404 {"detail": "document not found"}`, `400` for a
malformed id, `422` for an out-of-range `offset`/`limit`.

---

## `GET /api/domains/{id}/documents/{doc}/file`

The uploaded bytes with the stored `content_type` and
`Content-Disposition: attachment; filename*=UTF-8''<stored name>`. The page links to it **in the same
window** (`<a href download>`), so Desktop's loopback proxy carries the session (D2).

Errors: `404 {"detail": "domain not found"}`, `404 {"detail": "document not found"}`,
`404 {"detail": "The original file isn’t available any more."}` (the bytes are gone).

---

## `POST /api/domains` (G3 additions — the New domain dialog)

```json
{"name": "Support docs", "template": "support", "embedding_model": "huggingface/BAAI/bge-small-en-v1.5"}
```

- `embedding_model` (optional, new) — the reading model picked in the dialog (DM-23/DM-26). It must
  normalise to one of the `EMBEDDING_PRESETS` slugs (bare OpenAI names gain `openai/`); it is stored
  in `config.embedding.model`. Left out, the template's default (`text-embedding-3-small`) stays.
  NVIDIA NIM and every other model outside the list are refused.
- The name rule (HTTP create only; internal callers keep trim-only): trimmed, 1–120 characters, and
  unique within the account ignoring case. Domains that already share a name keep working.
- The answer is the full summary — the list-item keys plus `setup`, `answer_model` and
  `last_question_at` (a superset of the old `domain_to_dict` answer), so the dialog can land on
  `#/domains/<domain_id>` without a second read:

```json
{
  "domain_id": "7f3a2c1e-0b4d-4c55-9a51-2f7d8e6b1a90",
  "name": "Support docs",
  "template": "support",
  "config": {"chunking": {"strategy": "fixed", "size": 600, "overlap": 100}, "embedding": {"model": "huggingface/BAAI/bge-small-en-v1.5"}, "retrieval": {"…": "…"}, "generation": {"model": null}},
  "status": "empty",
  "doc_count": 0,
  "files": {"total": 0, "ready": 0, "reading": 0, "waiting": 0, "waiting_for_key": 0, "needs_attention": 0},
  "pieces": 0,
  "state": "empty",
  "reading_model": {"slug": "huggingface/BAAI/bge-small-en-v1.5", "label": "Hugging Face BGE-small (free)", "provider": "huggingface", "dim": 384, "key_saved": false},
  "setup": {"key": false, "files_read": false, "tested": false, "used": false},
  "…": "the other summary keys"
}
```

Errors (`detail` copy is shown under the Name field or in the dialog as is):

| Status | `detail` |
|---|---|
| `400` | `"unknown template"` (checked before the name clash) |
| `409` | `"You already have a domain named “<trimmed name>”."` |
| `422` | `"Give this domain a name."` (empty after trimming) |
| `422` | `"Use 120 characters or fewer."` |
| `422` | `"Pick a reading model from the list."` (`embedding_model` outside the list) |

## `PATCH /api/domains/{id}` (G4 addition — Rename)

```json
{"name": "Q3 2026 filings"}
```

A new `name` follows the same name rule as create (DM-14): trimmed, 1–120 characters, unique within the
account ignoring case — the domain itself excluded, so "Support docs" → "Support Docs" is fine. The
answer is unchanged (the old `domain_to_dict` shape, `name` trimmed). `config` changes are unaffected.

| Status | `detail` |
|---|---|
| `404` | `"domain not found"` (not this account's) |
| `409` | `"You already have a domain named “<trimmed name>”."` |
| `422` | `"Give this domain a name."` / `"Use 120 characters or fewer."` |

## `POST /api/domains/{id}/duplicate` → `201`

Duplicate settings (DM-16): a new, **empty** domain with the same `template` and `config` (reading
model, piece size, search and answer settings) — no files, no test questions, no chat.

```json
{"name": "Help centre"}
```

- `name` (optional) follows the name rule. Left out (or no body), the copy is named
  `"<name> copy"`, then `"<name> copy 2"`, `"<name> copy 3"`… — the first free one; a long name is cut
  so the copy stays within 120 characters.
- The answer is the new domain's full summary (as `POST /api/domains`):

```json
{
  "domain_id": "0c9d3b52-7e1a-4f0c-8a33-5b2e9d4c7f18",
  "name": "Support docs copy",
  "template": "support",
  "config": {"chunking": {"strategy": "fixed", "size": 600, "overlap": 100}, "embedding": {"model": "text-embedding-3-small"}, "retrieval": {"…": "…"}, "generation": {"model": null}},
  "status": "empty",
  "doc_count": 0,
  "files": {"total": 0, "ready": 0, "reading": 0, "waiting": 0, "waiting_for_key": 0, "needs_attention": 0},
  "state": "empty",
  "…": "the other summary keys"
}
```

| Status | `detail` |
|---|---|
| `400` | `"invalid domain id"` |
| `404` | `"domain not found"` |
| `409` | `"You already have a domain named “<trimmed name>”."` (only with an explicit `name`) |
| `422` | `"Give this domain a name."` / `"Use 120 characters or fewer."` |

## `DELETE /api/domains/{id}` (G4 addition — tidy the uses)

Before the domain goes (with its files, pieces, chat and test questions), its uses in the account's
**library** teams are tidied (DM-15, OQ-14):

- each Query domain step that used it gets `config.domain_id = null` — graph validity then asks for
  another domain before that team can run ("Select a Domain on this Query domain node before
  running.");
- each agent whose `tool_config.tvashtr.domains` **list** names it drops it (an emptied list stays
  `[]`); the legacy `true` / `{"enabled": …}` switch is left as it is.

A past run's snapshot team keeps what it ran with. The answer gains two counts:

```json
{"domain_id": "7f3a2c1e-0b4d-4c55-9a51-2f7d8e6b1a90", "deleted": true, "steps_cleared": 1, "agents_cleared": 2}
```

| Status | `detail` |
|---|---|
| `400` | `"invalid domain id"` |
| `404` | `"domain not found"` (nothing is tidied) |

Deleting a **file** is unchanged (`DELETE /api/domains/{id}/documents/{doc}` → `{"document_id", "deleted": true}`,
`404 "document not found"`). The page hides the row at once and sends the delete when its Undo toast
closes (OQ-12: also on leaving the page and on `pagehide`, with `fetch(…, {keepalive: true})`).

---

## `POST /api/domains/{id}/ask` (G6 additions — the Ask tab)

Body: `{"question": "How long do customers have to ask for a refund?", "use_history": true}`.
`use_history` (default `false`, the tab's **Use earlier messages**): the last 3 question/answer turns
of the chat go to the model (answers without their markers) and the search runs on
`"<previous question> <question>"`. The chat route always asks with the NOT_FOUND rule: an answer the
files don't cover starts with `NOT_FOUND:` (OQ-22). Agent tools (`domain_ask` MCP) no longer write
into the chat (finding 8); Query domain nodes are unchanged until their new step lands (G12).

```json
{
  "answer": "Customers can ask for a full refund within **30 days** of purchase [3]. … [5].",
  "citations": [{"document_id": "…", "filename": "refund-policy.md", "chunk_id": "…", "ordinal": 0, "excerpt": "…", "score": 0.82}],
  "message_id": "…", "user_message_id": "…", "latency_ms": 1800, "cost_usd": 0.0004,
  "model": "gpt-4o-mini-2024-07-18",
  "covered": true,
  "answer_text": "Customers can ask for a full refund within **30 days** of purchase [1]. … [2].",
  "sources": [
    {"number": 1, "citation_index": 3, "document_id": "…", "filename": "refund-policy.md", "chunk_id": "…",
     "ordinal": 2, "piece_number": 3, "pieces_in_file": 42, "page": null, "excerpt": "Customers may request…"},
    {"number": 2, "citation_index": 5, "document_id": "…", "filename": "billing-faq.pdf", "chunk_id": "…",
     "ordinal": 16, "piece_number": 17, "pieces_in_file": 86, "page": 4, "excerpt": "For annual subscriptions…"}
  ],
  "searched": [{"…every citation, in rank order, with piece_number / pieces_in_file / page": "…"}],
  "used_history": false,
  "model_label": "OpenAI gpt-4o-mini"
}
```

- `answer`, `citations`, `model` (the provider's own model name) keep their meaning.
- `answer_text`: `NOT_FOUND:` stripped; markers renumbered `[1]…[m]` in order of first mention
  (`[1, 3]` groups stay groups); a marker pointing at no passage is dropped; a not-covered answer
  keeps none.
- `sources`: the passages the answer cites, numbered like `answer_text` (`citation_index` = its
  1-based place in `citations`). No marker at all, or not covered: the two passages that came up
  first (OQ-22/23).
- `page`: the PDF page the piece starts on (`null` for other files, and for answers whose pieces were
  re-read since). `pieces_in_file`: the file's pieces now (`null` once the file is gone).
- `model_label`: the design's label for the three listed models, else `"<Vendor> <model name>"`
  (e.g. `"OpenAI gpt-4.1-mini"`) — for the model asked for (the domain's answer model or the account
  default it resolved to).
- `persist`, `mark_not_found` are Python-only flags of `ask_domain` (not in the body). `persist`
  defaults to false: this endpoint is the one caller that passes `persist=True` (the chat thread);
  the Query domain steps (the legacy `domain_query_step` by the default, `domain_query_step_v2`
  explicitly) and the MCP tools keep their asks out of it (finding 8, OQ-13).
- Errors unchanged: `404 "domain not found"`, `422` (`"question must be non-empty"`, `"ingest documents
  before asking"`, `{"message": "you have no API key for: openai — …", "missing_providers": ["openai"]}`,
  no model), `502` (`"generation failed: …"` / `"embedding failed: …"`).

Stored: the question row `meta {"source": "chat"}`, the answer row
`meta {"model": "openai/gpt-4o-mini", "used_history": false, "source": "chat"}` (migration 0042).

## `GET /api/domains/{id}/messages` (G6 additions)

Oldest first, as before. Question rows are unchanged; answer rows gain `covered`, `answer_text`,
`sources`, `searched`, `used_history`, `model` (the slug asked for) and `model_label` — all derived
at read time from `content`, `citations` and `meta`. Answers from before 0042: `used_history`,
`model`, `model_label` are `null`.

## `DELETE /api/domains/{id}/messages` → `204`

Clear chat (DM-67): deletes every question and answer of the domain. Idempotent. The page shows
"Chat cleared." with **Undo** and sends this only when the toast closes, on leaving the domain, or on
`pagehide` with `keepalive` (OQ-12). `404 "domain not found"`.

Not built (the frontend keeps them): `/api/config` `domain_generation_presets` — the answer-model
list's labels and taglines live in `frontend/src/pages/domains/answerModels.ts`, like the reading
models in `readingModels.ts`.

---

## Quality (G7 — test questions and test runs, DM-70…DM-79)

### Test questions: `GET /api/domains/{id}/eval/cases`, `POST …/eval/cases`
Each case gains `expected_files` — the expected ids with their file names; a deleted file keeps its
id with `filename: null, exists: false` (DM-54):

```json
{"cases": [{
  "case_id": "4b7c…", "domain_id": "9f1e…", "question": "How do I verify webhook signatures?",
  "expected_answer": null,
  "expected_citation_doc_ids": ["d1a2…"],
  "expected_files": [{"document_id": "d1a2…", "filename": "webhooks.md", "exists": true}],
  "expected_keywords": ["signature", "secret"], "ordinal": 8, "created_at": "2026-09-27T10:02:00+00:00"
}]}
```

`POST` body unchanged (`question`, `expected_citation_doc_ids`, `expected_keywords`, `ordinal`, …).
`422` details (exact copy):
- `"Write the question first."` — blank question
- `"Add a file or a key word, so there’s something to check."` — no file and no key word (HTTP only;
  the Python helper keeps accepting question-only cases for old callers)
- `"You can have up to 50 test questions."` — the 51st (OQ-26)
- `"invalid document id: <x>"` — a malformed file id

### `PATCH /api/domains/{id}/eval/cases/{case_id}` → the case
Body: any of `question`, `expected_citation_doc_ids`, `expected_keywords`; only the fields sent change.
Same `422` copy as `POST`. `404 {"detail": "case not found"}`; another account's domain → `"domain not found"`.

### `POST /api/domains/{id}/eval/runs` → `202` the run
Starts the durable workflow `run_domain_eval_workflow` (one step per case). A run already going
(started in the last 15 minutes) is answered instead of starting another.

```json
{"run_id": "70c2…", "number": 4, "status": "running",
 "created_at": "2026-09-27T10:05:00+00:00", "completed_at": null,
 "hit_at_k": null, "keyword_hit": null, "retrieval_mode": "dense", "top_k": 8,
 "config": {"chunking": {"strategy": "fixed", "size": 600, "overlap": 100}, "embedding": {"model": "text-embedding-3-small"},
            "retrieval": {"mode": "dense", "top_k": 8}, "generation": {"model": null}},
 "progress": {"done": 0, "total": 8}, "error_message": null,
 "domain_id": "9f1e…", "scores": {"cases_total": 8, "top_k": 8, "retrieval_mode": "dense", "config": {…}, "per_case": []}}
```

`422 {"detail": "Add a test question first."}` with no test questions.

### `GET /api/domains/{id}/eval/runs?limit=20` → `{"runs": [...]}`
Newest first (`limit` 1–100). Items are the run above WITHOUT `scores`/`domain_id`. `number` counts
the domain's runs from 1 (oldest). `status`: `running` | `completed` | `failed` (every case failed;
`error_message` = the first case's reason, e.g. a missing key).

### `GET /api/domains/{id}/eval/runs/{run_id}` → the run with `scores`
`scores.per_case[]` (appended as cases finish, so `progress.done` grows):

```json
{"case_id": "4b7c…", "question": "How do I verify webhook signatures?",
 "hit": false, "keyword_hit": false, "citation_doc_ids": ["…", "…"], "latency_ms": 212, "error": null,
 "top": [{"number": 1, "document_id": "…", "filename": "integrations.html",
          "excerpt": "…signed payloads are sent to your endpoint with an X-Signature header…"}]}
```

`hit`/`keyword_hit` are `null` when the case has no files / no key words to check. `top` holds the
first 3 passages search found (DM-77). `404 {"detail": "run not found"}`. The path only matches a
uuid, so the old `GET …/eval/runs/latest` keeps working.

## `PATCH /api/domains/{id}` (G9 additions — the Settings tab)

```json
{"template": "legal",
 "config": {"chunking": {"strategy": "fixed", "size": 500, "overlap": 80},
            "embedding": {"model": "text-embedding-3-small"},
            "retrieval": {"mode": "hybrid", "top_k": 8, "rerank": {"enabled": true, "model": null, "top_n": 20},
                          "graph": {"enabled": false}},
            "generation": {"model": null}}}
```

- `template` (optional) is the starting point (DM-81): `support` | `legal` | `financial` | `scientific` |
  `blank`. It only sets the template; the client sends the piece size and overlap it fills in.
- `config` numbers are checked (DM-83, DM-85) — a key the config leaves out is not checked:
  - `chunking.size`: a whole number 100–4000
  - `chunking.overlap`: a whole number 0…size−1
  - `retrieval.top_k` (Passages per question): a whole number 1–30
  - with `retrieval.rerank.enabled`, `rerank.top_n` (the wider pool) ≥ `top_k`
- The answer is the old `domain_to_dict` shape plus `reread` (G10, below). A changed piece size applies
  to files read from now on; a changed reading model re-reads every file (G10).

| Status | `detail` |
|---|---|
| `400` | `"unknown template"` |
| `404` | `"domain not found"` (not this account's) |
| `422` | `"Use a number from 100 to 4,000."` (piece size) |
| `422` | `"Use a number from 0 to <size − 1, e.g. 1,199>."` (overlap not a whole number ≥ 0) |
| `422` | `"Overlap must be smaller than the piece size."` |
| `422` | `"Use a number from 1 to 30."` (passages per question) |
| `422` | `"Look wider needs at least as many passages as it keeps."` |

### "Look wider, then keep the best" (retrieval, G9)
With `retrieval.rerank.enabled`, every search (Ask, test runs, Query domain nodes, MCP) fetches `top_n`
candidates per list, then re-scores that pool: Reciprocal Rank Fusion (k = 60) of the pool's own order
and each piece's exact-word overlap with the question (stop words dropped; a piece sharing no word gets
no second term), then keeps the first `top_k`. Deterministic, no model, no cost; `rerank.model` stays
reserved. Off, nothing changes.

---

## Changing how files are read (G10 — DmF-Embed-1…4, DmF-Piece-1…3; DM-88…DM-90, OQ-17, OQ-24)

### `PATCH /api/domains/{id}` (G10 addition)
The answer gains `reread` — what saving meant for the domain's files:

```json
{"domain_id": "…", "name": "Support docs", "template": "support", "config": {…}, "status": "indexing",
 "doc_count": 14, "created_at": "…", "updated_at": "…",
 "reread": {"needed": "required", "reason": "reading_model"}}
```

- `required` / `reading_model` — `config.embedding.model` names other weights than before (bug fix,
  finding 1: before, vectors were cleared only when the dimension changed, so 3-small → ada-002 kept
  vectors ada-002 can't compare). Every file's vectors are cleared, every file goes back to waiting as
  one re-read, and reading starts (one file at a time, OQ-24). No separate `POST …/reread` is needed.
- `none` — the same weights through another route keep their vectors (OQ-17):
  `text-embedding-3-small` ≡ `openai/text-embedding-3-small` ≡ `openrouter/openai/text-embedding-3-small`.
  Also a domain with no files, and any change that doesn't touch the files.
- `optional` / `pieces` — `chunking.size` or `chunking.overlap` changed: existing files keep their pieces
  until they're read again; the client offers `POST …/reread` (DM-90).

### `GET /api/domains/{id}` (G10 addition)
`rereading` — the re-read still running, else `null`:

```json
{"rereading": {"total": 14, "done": 1, "eta_seconds": 121, "reason": "reading_model", "run_tests_after": false}}
```

- A re-read's files share one `version` — the domain's highest; `total` counts them, `done` those read
  since (ready or needing attention). A single "Re-read this file" is a re-read of `total: 1`.
- `eta_seconds` — the pieces left at the reading model's pace (`domain_embedding.READ_PIECES_PER_SECOND`:
  10 a second for OpenAI, OpenRouter and Gemini, 2 for Hugging Face; a fixed guess, the copy says
  "about"). A file not read yet counts the pieces it had (or its size in pieces).
- `reason` — `reading_model` while a new reading model is being read (asking pauses), else `files`.
- `run_tests_after` — the tests run when the re-read is done.

### `POST /api/domains/{id}/reread` (G10 changes)
The files asked for get one shared version (the domain's highest + 1, or the running re-read's own when
one is still running — it joins it). `run_tests_after` is kept on the waiting files, so a read that is
already running (`state: "queued"`) runs the tests when it's done. Answer and errors unchanged.

### Asking pauses while a new reading model is read
`POST /api/domains/{id}/ask` and `POST /api/domains/{id}/retrieve` — and the same asks from Query domain
nodes and the MCP tools — refuse while `rereading.reason` is `reading_model`:

| Status | `detail` |
|---|---|
| `409` | `"Ask is paused while <domain name> re-reads its files."` |

A piece-size or single-file re-read doesn't pause asking: a file being re-read with the same model
keeps its old pieces searchable (they count in `pieces`) until its new pieces replace them. Only files
at `version > 1` pause asking — a pre-revamp "dimension changed" mark on a file never read (version 1)
is a first read.

A reading-model change while a file is being read leaves that file to the running read (no second
reader, OQ-24): its vectors are cleared, so when the read finishes it the file goes back to waiting
and is read again with the new model; a batch embedded with the old model after the change is dropped.


## Use in teams (G11 — Dm-Teams, DmF-Step-1…3, DmF-Agent-1…3; DM-92…97, OQ-19, OQ-20)

Only the owner's LIBRARY teams count; a run's snapshot never does. Agents are thinker/worker nodes
(`kind` `completion`/`agent`); a *step* is a `domain_query` node whose `config.domain_id` is the domain.
An agent's access lives in `tool_config.tvashtr.domains`: `true` (or the old `{"enabled": …}` object)
= every domain (the legacy switch, `scope: "all"`), a list of ids = just those (`scope: "this"`).
Agent `title` = `config.title`, else the role's name ("Product manager", "Engineer", …).

### `GET /api/domains/{id}/usage`

```json
{
  "steps": [
    {"node_id": "5b0e…", "team_id": "d442…", "team_name": "Docs team",
     "title": "Look up support docs", "pass_to_spec": true}
  ],
  "agents": [
    {"node_id": "caf4…", "team_id": "a1b2…", "team_name": "Indicator sprint team",
     "role_name": "pm", "title": "Product manager", "model": "xai/grok-4.7",
     "scope": "this", "subscription": null}
  ]
}
```

- Canvas order: teams oldest first, then left to right. A step with no `config.title` reads "Query
  domain"; `pass_to_spec` is `false` when the key is absent (nodes made before round 2, OQ-21).
- `subscription`: `"claude"`/`"grok"` when the agent's model maps to a Desktop plan the account has
  connected — on Tvashtr Desktop such an agent runs on the plan and gets no Domains tools yet (DM-96,
  B-16); else `null`. The tab count is the detail's `usage.uses` (= `steps` + `agents`).

### `GET /api/domains/{id}/step-places`

```json
{
  "teams": [
    {
      "team_id": "d442…",
      "name": "Docs team",
      "path": ["Product manager", "Writer", "Reviewer"],
      "places": [
        {"after_node_id": "caf4…", "after": "Product manager", "next": "Writer"},
        {"after_node_id": "40de…", "after": "Writer", "next": "Reviewer"},
        {"after_node_id": "1390…", "after": "Reviewer", "next": "Ship"}
      ]
    }
  ]
}
```

- Every library team, oldest first. `path` = the agents and steps on the team's main path (the same
  walk as the team summary's `shape`; gates and terminals left out; `[]` for a team with no agents).
- `places` (OQ-20): each agent on the main path with exactly one way out — one unconditional,
  non-escalation edge. A gate, a terminal, an agent with a verdict (`when` branches or a rework loop)
  or a fan-out has none. There is no "At the start" place. `next` = the node that edge leads to.

### `POST /api/domains/{id}/steps` → `201`

Body `{"team_id": "<uuid>", "after_node_id": "<uuid>", "prompt": "What do our support docs say about
{idea}?", "pass_to_spec": true}` (`pass_to_spec` defaults to `true`).

```json
{
  "node_id": "9f1c…",
  "team_id": "d442…",
  "title": "Look up support docs",
  "after": {"node_id": "caf4…", "title": "Product manager"},
  "connected_to": {"node_id": "40de…", "title": "Writer"}
}
```

- Adds a `domain_query` node (`prompt` = the trimmed question, `edits_allowed` false,
  `config {domain_id, title: "Look up <name>", pass_to_spec, on_no_answer: "continue"}` — the name's
  first letter lower-cased unless the first word is an acronym: "Look up Q3 filings"). The agent's
  edge `after → next` now ends at the step, and a new unconditional `work` edge runs `step → next`.
  The step takes `next`'s canvas position; every node at or right of it moves 260px right.
- `422 {"detail": "Pick where the step goes."}` — `after_node_id` is not one of the team's `places`
  (or an id is malformed); `422 {"detail": "Write the question to ask."}` — a blank `prompt`.
- `404 {"detail": "library team not found"}` (not the owner's library team), `404 {"detail": "node not
  found in the team"}`, `404 {"detail": "domain not found"}`.
- The run side of `pass_to_spec` / `on_no_answer` is the Query domain node's (G12).

### `GET /api/domains/{id}/agents`

`{"agents": [ …the usage agent rows for EVERY agent… ]}` with `scope: null` for those without access —
the Give access dialog's rows (it disables the ones with a `scope`). Deviation: the analysis proposed
`GET /api/agents?domain_id=`; the domain's own route keeps the Toolkit router untouched.

### `PUT /api/domains/{id}/agents`

Body `{"node_ids": ["caf4…", …]}` — the FULL set that can search the domain afterwards (like a tool's
agents). A listed agent without access gains the id in its list (created as `[id]` when it had none);
an unlisted agent with `scope: "this"` loses it; an unlisted `scope: "all"` agent keeps every OTHER
domain of the account as an explicit list. Answers `{"agents": [ …usage agent rows with access… ]}`.
`404 {"detail": "Agent not found."}` for an id that isn't one of the owner's library agents.

### The run side of agent access

- `node_tools.build_mcp_config`: a non-empty `tvashtr.domains` list injects the Domains MCP like
  `true` does, plus a header `X-Tvashtr-Domains: <id>,<id>` (absent = every domain). An empty list
  gives no Domains tools.
- The Domains MCP tools `domain_ask(question, domain)` and `domain_retrieve(query, domain, top_k?)`
  take the domain by name (any case) or id (`domain_id` still works for older agents), within the
  header's allowlist; with one domain to search `domain` may be left out. Anything else errors with
  "Domains you can search: Support docs, Vendor contracts." (or "You can’t search any domains.").
- The tool list names them: each tool's description (MCP `tools/list`) ends with a blank line and
  "Domains you can search: Support docs, Vendor contracts." — the agent's allowlist, or every domain
  of the account for the legacy switch; no session → the plain descriptions. Deviation: the analysis
  put this line in the context compiler, which needs an edit inside the existing `agent_run_step`
  (the brief allows only new `team_run.py` steps); the tool descriptions reach the same model prompt.

## The Query domain node (G12 — Dm-QueryNode, DmF-Step-4/5, DmF-Canvas-1…4; DM-98…104, OQ-21)

### `POST /api/teams/{team_id}/nodes` with `node_kind: "domain_query"` (changed)

A new node passes its answer on and keeps going when there's none (DM-98):

```json
{
  "id": "5b0e…",
  "kind": "domain_query",
  "role_name": "domain_query",
  "prompt": "{idea}",
  "config": { "domain_id": null, "pass_to_spec": true, "on_no_answer": "continue" }
}
```

### `PATCH /api/teams/{team_id}/nodes/{node_id}` on a `domain_query` node (changed)

Body (every key optional; only sent keys change):

```json
{
  "domain_id": "3c9d…",
  "prompt": "What do our support docs say about {idea}?",
  "title": "Look up support docs",
  "pass_to_spec": true,
  "on_no_answer": "stop"
}
```

Response `200`: the node, `config` carrying the keys. Errors: `422` for an `on_no_answer` other than
`"continue"` / `"stop"` (FastAPI's validation body), `400 {"detail": "invalid domain_id"}`, `404` for
another account's team.

**Which run steps a node uses (OQ-21).** A node whose `config` has the `pass_to_spec` key (new nodes,
Add step, any drawer save) runs the new steps below. A node without it keeps today's lookup, unchanged:
its answer never reaches the spec and a not-covered answer never stops the run.

### Validity (DM-102)

`GET /api/teams/{team_id}/validate` and the `POST /api/runs` guard flag
`{"code": "domain_query_no_domain", "message": "Select a Domain on this Query domain node before running."}`
also when `domain_id` is not one of the account's domains. Only nodes the walk reaches are checked (an
unconnected new node shows "Needs a domain" from the canvas's own check).

### What a run does (DM-104)

- The lookup asks with the NOT_FOUND rule and stays out of the domain's chat. A node from before
  the settings (no `pass_to_spec`) keeps today's lookup but also stays out of the chat (OQ-13).
- **Covered**, passing on: the spec gets a new version (note `"Added by <title>"`, authored by the
  node) ending in:

  ```md
  ## What the docs say

  **Asked Support docs:** What do our support docs say about a self-serve refund button?

  Refunds are requested from Billing → Refunds within 30 days [1]. Annual plans are prorated after that [2].

  Sources:
  1. refund-policy.md · piece 3 of 42
  2. billing-faq.pdf · page 4 · piece 17 of 86
  ```

  The round closes `done` / `answered`.
- **Not covered**, "Keep going": the section reads `Support docs had no answer for: “<question>”` (when
  passing on); the round closes `done` / `no_answer` and the run goes on.
- **Not covered**, "Stop the run and tell me": the round closes `failed` / `no_answer`; the run fails with
  `failure_code: "domain_no_answer"`, `failure_message`
  `"Look up support docs stopped the run: Support docs has no answer for “<question>”."`.
- **Re-reading** with a new reading model: it waits (checks every 30 s) up to 10 minutes, then fails
  with `failure_code: "domain_query"`, message `"<title>: Support docs was still re-reading its files."`.
- A missing key, no files or a deleted domain fail as before (`domain_query`, humanised reason).
- The lookup's spend (answer + question embedding) is a cost row on the run against the round
  (`idempotency_key` `<run>:domain-cost:<node>:<round>`).

### `GET /api/teams/{team_id}/nodes/{node_id}/runs` (additions)

`run` gains `number` — its place among the library team's runs ("run 14"; `null` for a run launched
without a library team). Each round of a Query domain node gains `domain`:

```json
{
  "run": {
    "run_id": "0f7c…",
    "number": 14,
    "rounds": [
      {
        "iteration": 1,
        "status": "done",
        "outcome": "answered",
        "cost": { "prompt_tokens": 940, "completion_tokens": 40, "total_tokens": 980, "cost_usd": 0.0012 },
        "domain": {
          "question": "What do our support docs say about a self-serve refund button?",
          "answer_text": "Refunds are requested from Billing → Refunds within 30 days [1]. Annual plans are prorated after that [2].",
          "covered": true,
          "sources": [
            { "number": 1, "document_id": "…", "filename": "refund-policy.md", "chunk_id": "…",
              "piece_number": 3, "pieces_in_file": 42, "page": null,
              "excerpt": "Customers may request a full refund within 30 days of their original purchase date." }
          ],
          "citations": [ { "document_id": "…", "filename": "refund-policy.md", "chunk_id": "…", "ordinal": 2, "excerpt": "…" } ],
          "latency_ms": 1900,
          "cost_usd": 0.0012,
          "spec_section": "What the docs say"
        }
      }
    ]
  }
}
```

- `spec_section`: `"What the docs say"` when the answer went into the spec, else `null`.
- A round from before these steps has `question: null`, `sources: []`, `spec_section: null`;
  `answer_text` is its `outcome_detail` and `covered` follows its outcome.

### `POST /api/domains/{id}/ask` (addition)

The answer gains `usage: {prompt_tokens, completion_tokens, total_tokens, cost_usd}` — the answer's
tokens plus the question embedding's.

