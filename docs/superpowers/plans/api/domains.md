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

