# M-memory S1b — the polarity substrate (SOLO slice, migration 0026)

**Context.** M-memory S1 shipped `node_memories` (owner-scoped, pgvector, `embed()`, CRUD) — `main` @
`cba8b7a`, alembic head **`0025`**, floors **534 backend / 296 vitest**. This slice adds ONE
first-class attribute — **`polarity`** — to every memory row, so the later write slice (S2) can label
each learned fact and the read slice (S3) can render it with the right force. It runs SOLO (like S1),
because BOTH S2 (writes polarity) and S3 (reads/renders it) import this column — a second session
cannot branch off a `main` that lacks it.

**This is PURE SUBSTRATE. In scope: the column + the model field + the enum/validation + the CRUD
plumbing + tests + the freeze bump. OUT of scope (do NOT build here): run distillation, context
injection, the anti-backfire triage/consolidation logic, and any frontend — those are S2/S3/S5.**

---

## The polarity taxonomy (RFC-2119-grounded — the exact 6 values)

Every memory row carries exactly one `polarity`. The six values and their meaning (bake these into the
enum + the module docstring):

| value | RFC 2119 | meaning |
|---|---|---|
| `require` | MUST | hard positive — always do this |
| `prefer` | SHOULD | soft positive — desirable, do this unless there's a reason |
| `allow` | MAY | explicitly permitted here (often an exception to a general prohibition) |
| `context` | — | a neutral fact, no directive (the DEFAULT) |
| `avoid` | SHOULD NOT | soft negative — undesirable |
| `forbid` | MUST NOT | hard negative — never do this |

`context` is the default for any memory created without an explicit polarity (and the backfill value for
every pre-existing row).

---

## 1. Migration `0026` (the ONLY migration)

- Revision id `0026_memory_polarity`; `down_revision = "0025_node_memories"`; keep the id <= 32 chars.
- `upgrade()`: add `polarity` to `node_memories` as `sa.Text(), nullable=False,
  server_default=sa.text("'context'")`. Because it is added NOT NULL **with** a server default, every
  existing row auto-fills `'context'` — confirm that in the SQL check (no separate backfill UPDATE
  needed, but verify existing rows read `'context'`).
- Add a CHECK constraint restricting the value set:
  `polarity IN ('require','prefer','allow','context','avoid','forbid')` (name it
  `ck_node_memories_polarity`). If the CHECK + the installed alembic/pg interplay proves awkward, a
  plain `Text` column with app-level validation only (no CHECK) is an ACCEPTABLE fallback — note the
  choice in the report; otherwise ship the CHECK.
- `downgrade()`: drop the CHECK (if present) then the column. The migration MUST round-trip
  (`downgrade -1` -> `upgrade head`).

## 2. The model (`models.py`, `NodeMemory`)

- Add `polarity: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'context'"),
  default="context")`, placed logically near `content`/`status`. Document the 6 values in a short
  comment.

## 3. The enum + validation (`control_plane/memory.py`)

- Add `MemoryPolarity = Literal["require","prefer","allow","context","avoid","forbid"]`.
- Add `is_valid_polarity(value) -> bool` and an `InvalidPolarityError(ValueError)` (the router maps it
  to HTTP 422), MIRRORING the existing `is_valid_tier` / `InvalidTierError` pattern exactly.
- Document each value's RFC-2119 meaning where the type/error lives.

## 4. The CRUD (`control_plane/memory.py`)

- `create_memory`: add a `polarity: str = "context"` param. Validate it (raise `InvalidPolarityError`
  on an invalid value) **up front, BEFORE spending an embedding call** (same ordering as the tier
  validation). Store it on the row.
- `update_memory`: add a `polarity: str | None = None` param. When provided + valid, set it. A
  polarity-only change MUST NOT re-embed — only a real `content` change re-embeds (preserve the exact
  existing re-embed-on-content-change rule).
- `_to_dict`: add `"polarity": row.polarity` to the returned dict.
- Do NOT add polarity FILTERING to `list_memories` here (S3/S5 can add it later if needed) — keep this
  slice minimal.

## 5. The API (`routers.py`)

- `POST /api/memories`: accept an optional `polarity` in the request body (default `context`); an
  invalid value -> 422.
- `PATCH /api/memories/{id}`: accept an optional `polarity`; invalid -> 422; a polarity-only patch does
  NOT re-embed.
- `GET` (list + single): return `polarity` in each row (it flows from `_to_dict`).
- Owner-scoping is UNCHANGED — every path stays owner-scoped exactly as today.

---

## Invariants (verify AS on-disk evidence)

- `git diff main` is **EMPTY** for `gateway/gateway.py`, `gateway/types.py`, `control_plane/
  context_compiler.py`, `control_plane/team_run.py`, `control_plane/run_explain.py`, and `config.py`.
  S1b touches NONE of the run path, the compiler, or the gateway — polarity does not affect embedding.
- Migrations `0001`-`0025` are byte-unchanged; `0026` is a NEW file.
- The three EXISTING memory test files (`test_memory_tier.py`, `test_gateway_embed.py`,
  `test_memory_api.py`) are **NOT modified** and still pass — `polarity` is an additive response field
  + a defaulted param, so the existing POSTs (which omit polarity) default to `context` and the
  existing assertions (which never check polarity's absence) stay green. Prove this by running them
  unchanged.
- Bump the freeze regex in `.claude/hooks/protect-migrations.sh` from `2[0-5]` to `2[0-6]` as the
  **LAST** step, only after `0026` exists and everything is green.

## Acceptance (you run every check + debug to green; echo each into the chat)

1. Migration `0026` applies on the pgvector DB — a SQL check shows the `polarity` column (`text`, NOT
   NULL, default `'context'`, and — unless the noted fallback — the `ck_node_memories_polarity` CHECK)
   on `node_memories`, and any existing rows read `'context'`.
2. A NEW `backend/tests/test_memory_polarity.py` (mutation-real):
   - create one memory at EACH of the 6 valid polarities -> the row is stored + returned with EXACTLY
     that polarity;
   - create with an INVALID polarity (e.g. `"maybe"`) -> **422**;
   - create with NO polarity -> defaults to `context`;
   - PATCH an existing row's polarity -> it changes, and the stored embedding is UNCHANGED (a
     polarity-only edit does not re-embed — read the raw vector before/after and assert equal);
   - PATCH an invalid polarity -> **422**;
   - owner-isolation still holds — owner B cannot set the polarity on owner A's memory (**404**).
3. `make test` green (the 534 floor rises by the new tests); `make lint` clean; `make build-frontend`
   green; `make test-frontend` -> 296 held (no FE change).
4. Migration reverses cleanly: `downgrade 0026 -> 0025` drops the column; `upgrade head` re-adds it.

## Stop conditions

- If the CHECK-constraint + alembic interplay is genuinely awkward on the installed stack, fall back to
  a `Text` column with app-level validation (no CHECK) and NOTE it — do NOT block on it.
- On the hard turn cap -> write `NEEDS_HUMAN` + the blocker to `STATE.md` and stop.
- A code-proven, contained, regression-guarded fix may proceed; a second/unknown problem needing a
  broad or unproven change -> `STATE.md` + stop.

## Branch

`m-memory-s1b-polarity`. Commit ONLY your own changed paths; do NOT push and do NOT checkout/merge
`main` — the operator does all merges.
