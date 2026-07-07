# M-tools · C7.A — Tools (MCP): per-node servers, brokered secrets, resolution warnings

**Session A of a two-session PARALLEL batch (Tools ‖ Skills). You are the TOOLS half, running in
your OWN git worktree off `main`.** A separate session (C7.B, Skills) is built against the SHARED
CONTRACT below — that block is byte-identical in both briefs; do NOT change any name/shape in it.
You are ALREADY on your branch in this worktree — do NOT `git checkout`. Your Postgres DB is
`tvashtr_c7a` (exported as `DATABASE_URL`); your Vite dev port is **5173**.

**File ownership (keep the batch disjoint so cherry-pick stays clean).** You OWN, and may edit,
only: `backend/alembic/versions/0022_*.py` (the ONE migration in this batch — C7.B adds none),
`backend/tvashtr/models.py` (append two classes), `backend/tvashtr/control_plane/node_tools.py`,
two NEW backend modules (`control_plane/mcp_secrets.py`, `control_plane/resolution_warnings.py`),
`backend/tvashtr/engines/openhands_docker_adapter.py` (only if §6 proves an override is needed),
`backend/tvashtr/routers.py` (the node PATCH handler + the `/graph` builder + new Secrets
endpoints), `frontend/src/panel/ToolsSection.tsx`, `frontend/src/lib/api.ts` (append your own
block + the shared clear-path change per the SHARED CONTRACT), the account **Secrets shelf** UI +
the run-inspector **warning banner** (both run-view / dashboard, NOT the authoring drawer), and
your tests. **Do NOT touch** `control_plane/team_run.py`, `control_plane/node_skills.py`,
`frontend/src/panel/SkillsSection.tsx`, `frontend/src/panel/TeamNodePanel.tsx`, either engine
adapter's Agent-construction block, or any other file. If you think you need to, STOP and write
`NEEDS_HUMAN`.

**Prime directive.** Make a worker node's inline MCP `tool_config` actually work end-to-end: its
`${NAME}` secret refs resolve server-side from a per-account encrypted store, the resolved config
reaches the docker sandbox as plaintext (the same posture the LLM key travels today), per-server
on/off toggles are honored, a server that fails to resolve is SKIPPED with a visible warning, and
the node's Tools drawer section is a real editor. **A node with NULL `tool_config` (every node
until a user sets one) must still run byte-for-byte as it does on `main`** — your changes are inert
until a node has tools.

---

## 0. Current state (authoritative — overrides any stale line in CLI-RULES.md / CLI-SETUP.md)
- `main` @ **`ce14b96`** (the branch point for this worktree) · alembic head **`0021`** · migration
  freeze **`0001-0021`** · floors **392 backend / 220 vitest**. (CLI-RULES still says head `0014` /
  floors 239/114 — stale; use these numbers.)
- Proven agent model for any live run: `nvidia_nim/meta/llama-3.3-70b-instruct` (NIM, via
  `NVIDIA_BUILD_API_KEY`; set by `.env` `TVASHTR_AGENT_MODEL`). ~1.4s/call, clean tool_calls.
- The M-accounts secret posture you MIRROR: `backend/tvashtr/control_plane/credentials.py` already
  has `encrypt_secret` / `decrypt_secret` (Fernet under `settings.secret_key` — the stable
  `TVASHTR_SECRET_KEY`) and `resolve_owner_api_key(owner_id, model)` reading the encrypted
  `provider_credentials` table. `team_run.py`'s `_owner_api_key(run_id, model)` resolves the run
  owner from `run_id` via `select(Run.owner_id).where(Run.id == uuid.UUID(run_id))`. REUSE
  `encrypt_secret`/`decrypt_secret`; do NOT reimplement crypto.

---

## SHARED CONTRACT — IDENTICAL in the C7.A and C7.B briefs. Do NOT change these names/shapes; the other parallel session is built against this exact text.

**S1. The resolution-warning recorder (OWNED BY C7.A; C7.B emits through it).**
Create `backend/tvashtr/control_plane/resolution_warnings.py` with EXACTLY this function (name,
params, order fixed):
```python
def record_resolution_warning(run_id: str, source_kind: str, name: str, reason: str) -> None:
    """Record a run-scoped resolution warning: a tool/skill source that FAILED to resolve at run
    time and was SKIPPED (the run continued). `source_kind` is "tool" | "skill"; `name` is the MCP
    server name or the skill-source label; `reason` is the human cause (e.g. "missing secret
    GITHUB_TOKEN", "repo unreachable"). Writes one `run_warnings` row; de-dupes on
    (run_id, source_kind, name, reason). Openhands-free + litellm-free at import."""
```
- Backed by a new `run_warnings` table (in C7.A's `0022`): `id` bigint PK, `run_id` Uuid FK→`runs.id`
  (`ondelete="CASCADE"`, indexed), `source_kind` Text, `name` Text, `reason` Text, `created_at`
  timestamptz server-default now().
- Surfaced to the run inspector: `GET /api/runs/{run_id}/graph` gains a TOP-LEVEL
  `resolution_warnings` array — `[{ "source_kind": string, "name": string, "reason": string }, …]`,
  ordered by `created_at` ASC, `[]` when none. (This is a NEW top-level key — do NOT reuse the
  authoring `GraphValidity.warnings` name, which is a different concept.)

**S2. The clear path (OWNED BY C7.A; for BOTH `tool_config` AND `skills`).**
The scaffold's `updateTeamNode` omits null fields and the PATCH handler persists only non-null — so
a node can't be cleared. You fix both, for BOTH fields:
- `frontend/src/lib/api.ts` `updateTeamNode`: ALWAYS send `tool_config` and `skills` in the PATCH
  body (as explicit `null` when cleared), not only when non-null.
- `backend/tvashtr/routers.py` node PATCH handler + `UpdateTeamNodeRequest`: distinguish "field
  absent → leave unchanged" from "field present-and-null → set NULL (clear)". Use pydantic v2
  `body.model_fields_set` (a field name is in it only when the client sent that key):
  `if "tool_config" in body.model_fields_set: node.tool_config = body.tool_config` (and the same
  for `skills`).
- C7.B relies on this: its `SkillsSection` clears via `onChange(null)` and its test asserts the
  clear reaches `updateTeamNode` with `skills: null` (mocking the network). C7.B does NOT edit
  `updateTeamNode` or the PATCH handler.

**How C7.B uses S1 (for your awareness — do not implement C7.B's side):** C7.B does NOT create
`resolution_warnings.py` or the `run_warnings` table. It emits via a lazy, import-guarded private
shim in its own `node_skills.py` that calls `record_resolution_warning(run_id, "skill", name,
reason)` and is a no-op in isolation; the REAL recording works once your half is merged first and
C7.B is cherry-picked on top.

---

## 1. Migration `0022` — two tables (the ONLY schema in this batch; freeze bumped LAST)
Create `backend/alembic/versions/0022_mcp_secrets_and_run_warnings.py`, `down_revision = "0021"`.
- **`mcp_secrets`** — one account's MCP secret, encrypted at rest (mirror `provider_credentials`):
  `id` Uuid PK (default uuid4); `owner_id` Uuid FK→`users.id`, not-null, indexed; `name` Text
  not-null (the `${NAME}` key, e.g. `GITHUB_TOKEN`); `secret_encrypted` Text not-null (Fernet
  ciphertext); `created_at` / `updated_at` timestamptz server-default now() (updated_at also
  `onupdate=now()`). UNIQUE `(owner_id, name)` (`uq_mcp_secrets_owner_name`) — one value per name
  per account; add is upsert/replace.
- **`run_warnings`** — per the SHARED CONTRACT S1 (bigint PK, `run_id` Uuid FK→`runs.id` CASCADE +
  index, `source_kind`/`name`/`reason` Text, `created_at` timestamptz default now()).
- Both additive + nullable-safe; `downgrade()` drops both tables. After EVERYTHING else is green,
  bump `.claude/hooks/protect-migrations.sh` freeze regex from `…2[01])_` to `…2[0-2])_` (blocks
  `0001-0022`) — the LAST step.

## 2. Models (`backend/tvashtr/models.py`)
Append `McpSecret` and `RunWarning` classes mirroring `ProviderCredential`'s style (Mapped columns,
`__table_args__` unique/FK). Keep them near the other account tables. No other model change (the
`agent_nodes.tool_config` column already exists from the scaffold).

## 3. Secret storage + resolver (`backend/tvashtr/control_plane/mcp_secrets.py`, NEW)
Openhands-free + litellm-free at import (like `credentials.py`). Provide:
- `resolve_owner_mcp_secret(owner_id: uuid.UUID, name: str) -> str | None` — look up the
  `(owner_id, name)` `mcp_secrets` row; return `decrypt_secret(row.secret_encrypted)` (import from
  `credentials`) or `None` if absent. `None` (not an exception) so `build_mcp_config` can SKIP +
  WARN a server with a missing secret instead of failing the run.
- Account CRUD helpers the endpoints (§7) call: create/replace (encrypt via `encrypt_secret`),
  list NAMES only (never values), delete. The plaintext is decrypted ONLY at run time here; it is
  never stored, logged, or returned by any endpoint.

## 4. The recorder (`backend/tvashtr/control_plane/resolution_warnings.py`, NEW)
Implement `record_resolution_warning(...)` EXACTLY as pinned in SHARED CONTRACT S1: write a
`run_warnings` row inside a `session_scope()`, first checking for an existing identical
`(run_id, source_kind, name, reason)` row (dedupe — the same server can fail on multiple iterations
of the same run; record it once). Openhands-free + litellm-free at import.

## 5. `build_mcp_config` — the real resolver (`backend/tvashtr/control_plane/node_tools.py`)
Replace the pass-through stub. Signature STAYS EXACTLY `build_mcp_config(tool_config: dict | None,
run_id: str) -> dict` (do NOT widen it — that is what keeps you out of `team_run.py`). Behavior:
1. `None`/empty `tool_config` → return `{}` (byte-for-byte inert — the adapter builds no MCP tools).
2. Deep-copy the config. Resolve the run owner from `run_id` (the same
   `select(Run.owner_id).where(Run.id == uuid.UUID(run_id))` lookup `_owner_api_key` uses).
3. **Per-server enable toggle (C7.A-2 allow-list).** The on/off state lives in a Tvashtr metadata
   block stored BESIDE `mcpServers`, shaped `{"tvashtr": {"servers": {"<name>": {"enabled": bool}}}}`.
   A server absent from that block, or `enabled: true`, is INCLUDED; `enabled: false` is DROPPED. A
   pasted config (no `tvashtr` block) = every server enabled. This block is Tvashtr-only — STRIP it
   from the dict you return (the SDK's `Agent(mcp_config=…)` validates only `{"mcpServers": {…}}`).
4. **`${NAME}` secret substitution.** For each still-enabled server, scan its `env` values and its
   `headers` values for `${NAME}` references (a value may be exactly `${NAME}` or embed it, e.g.
   `Bearer ${GH_TOKEN}` — substitute every `${…}` occurrence). Resolve each NAME via
   `resolve_owner_mcp_secret(owner_id, NAME)`. If ANY referenced NAME resolves to `None` (or the
   server is otherwise unresolvable), DROP that server AND call
   `record_resolution_warning(run_id, "tool", "<server-name>", "missing secret <NAME>")`. Servers
   whose refs all resolve get their plaintext substituted in place.
5. Return `{"mcpServers": {…enabled, resolved servers…}}` (possibly `{"mcpServers": {}}` if all were
   dropped/disabled — the adapter then builds no MCP tools, and the run continues).
No module-level `openhands` import (you return a plain dict); the plaintext values in the returned
dict are the design — they travel into the sandbox exactly like the LLM key (see §6).

## 6. The docker secret-brokering — VERIFY first; override only if disproven on disk (C7.A-1)
**Do NOT blindly add `expose_secrets=True` to the docker adapter.** On disk, the SDK's
`RemoteConversation.__init__` conversation-CREATE path (`.../openhands/sdk/conversation/impl/remote_conversation.py`,
~line 769) ALREADY serializes the agent with `agent.model_dump(mode="json",
context={"expose_secrets": True})`, and the docker adapter always hits the create path (it passes
no `conversation_id`). The Agent's `_serialize_with_mcp_handling` (`.../openhands/sdk/agent/base.py`)
takes the `expose_secrets` branch → keeps `mcp_config` as PLAINTEXT (it does NOT hit the default
REDACT branch). So the resolved plaintext `mcp_config` you build in §5 reaches the container as-is —
which is the intended C7.A-1 posture (plaintext into the sandbox, NOT Fernet-encrypted-to-the-
container, which would require the master key inside the sandbox).
- **Confirm this on disk** (grep `remote_conversation.py` for `expose_secrets`; read the create
  payload) and state it in the FINAL REPORT.
- **Prove it live** (§12 `make tools-e2e`): a worker whose `tool_config` names a REAL MCP server
  actually invokes an MCP tool through the docker sandbox. This is the definitive check — if the
  tool is unavailable in the sandbox, `mcp_config` was redacted and you investigate. **Only if the
  live test shows redaction** do you touch the docker adapter to inject the serialization context.
- Do NOT put the Fernet cipher (or `TVASHTR_SECRET_KEY`) anywhere near the container.

## 7. Secrets endpoints + the account Secrets shelf (the `${NAME}` store's UI + API)
- Add owner-scoped endpoints mirroring the provider endpoints' shape/auth: create/replace a secret
  (`{name, value}` → encrypt + upsert), list secret NAMES (never values), delete by name. The list
  endpoint feeds both the shelf UI and ToolsSection's pre-launch check (§10). NEVER return a value.
- FE: a minimal **Secrets shelf** beside the existing Providers management (find where
  `listProviders`/`addProvider` render — the dashboard/account area): add masked secret, list names
  (`name` + a `••••` indicator), delete. Reuse `tv-field`/`tv-btn` primitives so it looks native.
  Keep it lean — this is the central store, not a full manager.

## 8. The clear path (SHARED CONTRACT S2 — you own it for BOTH fields)
Implement S2 exactly: `updateTeamNode` always sends both fields (explicit null clears); the node
PATCH handler + `UpdateTeamNodeRequest` use `body.model_fields_set` to clear on present-null and
leave-unchanged on absent, for `tool_config` AND `skills`. Test both directions (§12).

## 9. The `/graph` warnings field (SHARED CONTRACT S1 wire)
In `get_run_graph` (`routers.py`), add the TOP-LEVEL `resolution_warnings` array (query
`run_warnings` for this run, ordered by `created_at` ASC, mapped to `{source_kind, name, reason}`).
Owner-scoping + every existing field stays byte-unchanged.

## 10. Frontend — the real `ToolsSection.tsx` + the run-inspector banner
- **`ToolsSection.tsx`** (worker-only editor; keep the thinker worker-only note exactly as-is):
  - **Paste-config**: a textarea accepting a raw `{"mcpServers": {…}}` object (Cursor/Claude Code
    parity — a user pastes their `mcp.json`); validate JSON on save.
  - **Guided Add-server** (Local = stdio `command`/`args`/`env`; Remote = HTTP/SSE `url`/`headers`)
    that appends into `mcpServers`.
  - **Per-server rows**: one row per server showing a transport badge (stdio / http / sse) and an
    on/off toggle that writes the `tvashtr.servers.<name>.enabled` metadata (default on). Remove-
    server drops it from `mcpServers`.
  - **Masked secret field / paste-safety**: `${NAME}` refs are shown as references; offer to move an
    inline token into the Secrets store. A **pre-launch warning** — "needs GITHUB_TOKEN" — for any
    `${NAME}` in the config whose NAME is not in the account's secret-names list (fetch it like
    `listProviders`). Never render a secret value.
  - Save flows through the existing `onChange` → the drawer's Save → `updateTeamNode` (which, per
    S2, now sends the full/cleared config). Clearing/emptying the config persists as "no tools".
  - Keep the node card's "🔧 N" chip working off the server count (if the scaffold added a chip
    hook; otherwise leave card rendering to its owner and do not touch `TeamNodePanel.tsx`).
- **Run-inspector warning banner** (run-view, NOT the authoring drawer): the component that fetches
  `getRunGraph` holds `GraphData.resolution_warnings`. When non-empty, render a compact amber
  banner — "⚠ N tools/skills didn't load" — listing each `name` + `reason`. This is run-view
  territory (e.g. `App.tsx` / a small new `RunWarnings` component / `SidePanel` host) — disjoint
  from `SkillsSection`. Add classes to `panel.css` or a scoped stylesheet, NOT `index.css`.

## 11. Types (`frontend/src/lib/api.ts`)
Append your own clearly-commented block: the `resolution_warnings` field on the `GraphData` type
(`resolution_warnings: { source_kind: string; name: string; reason: string }[]`), any MCP-server /
secrets-list types, and the S2 `updateTeamNode` change. Keep additions in their own region so the
cherry-pick touch-up (if any) with C7.B's skill types is trivial.

## 12. Tests — mutation-real (backend + FE)
Backend (`backend/tests/`):
- **The 3 secret guarantees** (the C8 credential invariant pulled forward): with a seeded
  `mcp_secrets` row and a node whose `tool_config` references `${NAME}` — assert (a) the stored
  `agent_nodes.tool_config` row holds only `${NAME}`, never the plaintext; (b) the plaintext never
  appears in the model prompt / any Tvashtr-controlled store (DBOS step records, `run_events`, host
  worktree); (c) the value is encrypted at rest in `mcp_secrets` (row ≠ plaintext; decrypt →
  plaintext). And that `build_mcp_config` substitutes the resolved plaintext into the returned dict.
- **Allow-list**: a server with `enabled: false` is dropped from the returned `mcpServers`; a pasted
  config (no `tvashtr` block) keeps all servers; the `tvashtr` metadata is stripped from the return.
- **Skip + warn**: a `${NAME}` with no `mcp_secrets` row → the server is dropped AND a `run_warnings`
  row is written; drive it and assert `resolution_warnings` on `/graph` names the server + reason.
- **Recorder + wire**: `record_resolution_warning` writes a row + dedupes; `/graph`
  `resolution_warnings` returns the contract shape, ordered, `[]` when none, owner-scoped.
- **Clear (S2)**: PATCH a node clearing `tool_config` (explicit null) → row NULL; PATCH omitting it →
  unchanged. Same for `skills`.
- **Inertness backstop**: the existing offline suite passes UNCHANGED (a NULL-`tool_config` node's
  `build_mcp_config` returns `{}`; no `run_warnings`; the Agent construction is byte-identical). Do
  NOT modify existing tests except unavoidable fixture-signature updates (list them; keep assertions
  identical).
FE (`frontend/src/`):
- `ToolsSection` vitest: paste-config round-trip; add-server appends; per-server toggle writes the
  metadata; the pre-launch "needs GITHUB_TOKEN" note shows for an unstored `${NAME}`; clearing emits
  `onChange(null)`.
- Run-inspector banner vitest: given `resolution_warnings` fixtures, the banner lists name+reason;
  empty → no banner.
- `api.test.ts`: the new field/types type-check.
Live:
- **`make tools-e2e`** (NEW target, opt-in, NOT in `make test`): create a worker node with a
  `tool_config` naming a REAL MCP server (e.g. `mcp-server-fetch` via `uvx` — a no-secret public
  fetch server), run the team through the DOCKER sandbox, and assert from the trajectory/events that
  the agent actually invoked the MCP tool (proving §6 — plaintext `mcp_config` survived to the
  container). Also add a secret-bearing variant seeded via the store (assert the `${NAME}` resolved).
  Run it yourself and echo the decisive line; if docker/NIM is genuinely unavailable, write
  `NEEDS_HUMAN` with the exact blocker.

## 13. Out of scope (do NOT build here)
- No skills work (that is C7.B — do not touch `node_skills.py` / `SkillsSection.tsx`).
- No reusable account LIBRARY tables / "Add from library" picker (that is C7.C).
- No interactive MCP OAuth (autonomous agents use token/header auth — §15).
- No per-TOOL-within-server allow-list (server-level on/off only this milestone — §15 if wanted).
- No distinct warning styling beyond the plain banner (§15 follow-on).

## 14. Acceptance / evidence (run it ALL yourself, debug to green, echo each decisive line — CLI-RULES §4.3a)
- `make test` → `=== N passed ===`, N ≥ **392** (+ your new backend tests). Re-baseline from a fresh
  run first; report old→new.
- `make lint` clean.
- `cd frontend && npx tsc --noEmit` clean; `npm run build` green; `npx vitest run` → total ≥ **220**
  (+ your new tests). Quote the counts.
- Alembic: `uv run alembic upgrade head` → head `0022`; `downgrade -1` then `upgrade head`
  round-trips clean (prove reversible).
- The 3 secret guarantees + allow-list + skip/warn + clear tests green (quote the decisive lines).
- `make tools-e2e` → the line proving the agent invoked a real MCP tool through docker (or a
  `NEEDS_HUMAN` with the exact external blocker).
- **Playwright self-sign-off** (targeted `browser_evaluate` on specific selectors + screenshots, NOT
  a whole-tree snapshot — it chokes on the React Flow canvas): (a) open a team, select a WORKER node
  → screenshot the real Tools section (paste + add-server + a per-server row + toggle); (b) a config
  with an unstored `${NAME}` → screenshot the "needs GITHUB_TOKEN" pre-launch note; (c) a run whose
  `/graph` (stub/intercept) carries `resolution_warnings` → screenshot the run-inspector banner.
  Record the screenshot paths in `STATE.md`.
- The `READY_TO_MERGE: branch=feat/m-tools-c7a-tools, sha=<sha>, tests=<N> passing` line in `STATE.md`.

## 15. Invariants to verify in the FINAL REPORT (with proof, not "unchanged")
- `git diff --name-only main` shows ONLY your owned files (NO `team_run.py`, NO `node_skills.py`, NO
  `SkillsSection.tsx`, NO `TeamNodePanel.tsx`). Quote it.
- `git diff main -- backend/tvashtr/control_plane/team_run.py` is EMPTY. Quote it.
- `build_mcp_config`'s signature is unchanged (`(tool_config, run_id) -> dict`); `node_tools.py` has
  no module-level `openhands` import (grep it).
- `EngineAdapter` protocol + `AgentTask` dataclass are byte-unchanged (you didn't touch base.py); the
  docker adapter's Agent-construction block is unchanged UNLESS §6 was disproven (if changed, show
  the live redaction evidence that forced it).
- Migrations `0001-0021` untouched; `0022` is the only new migration; freeze bumped to `0022` LAST.
- Existing tests unmodified except unavoidable fixture-signature updates (list them; assertions
  identical).

## 16. Stop conditions
- A dead credential / docker outage / NIM unavailable on the LIVE target → `NEEDS_HUMAN` (the offline
  + FE work must still be complete and green).
- A SECOND, unrelated problem needing a broad or unproven change → STOP + `NEEDS_HUMAN`. A contained,
  regression-guarded fix to a single identified cause inside this scope may proceed.
- If you find you must edit `team_run.py`, `node_skills.py`, or `SkillsSection.tsx` → STOP +
  `NEEDS_HUMAN` (that breaks the parallel split).
- Hard cap: 40 turns. If not green, write the FINAL REPORT and stop.

End with the 8-section FINAL REPORT (CLI-RULES §4.7).
