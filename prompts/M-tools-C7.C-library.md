# M-tools · C7.C — The reusable account LIBRARY (Tools shelf + Skills shelf; node references)

**The LAST piece of M-tools.** A SOLO, full-stack milestone — NO parallel split, NO worktree.
You run in the MAIN checkout on your OWN branch `feat/m-tools-c7c-library`. C7.A (Tools) and C7.B
(Skills) are already merged; you EXTEND their two per-node verticals with an account-level library
of reusable tools/skills that a node can REFERENCE.

**Prime directive.** Let a user define a tool (one MCP server) or a skill (one skill source) ONCE
at the account level, then REFERENCE it from any node — resolved + merged with the node's own inline
config at run time. Decision 4 (RATIFIED Tvashtr-50): "define once, reference anywhere; edit once,
propagates; a node still has its one-off inline." A node with NO library references and NO inline
config (every node until a user adds one) must still run **byte-for-byte** as it does on `main` —
your changes are inert until a node references or inlines something.

**The design is fully decided (verified against Claude Code + Cursor — the same model as their
user-scope MCP servers + user rules). Do not redesign it. Implement exactly the below.**

---

## 0. Current state (authoritative — overrides any stale line in CLI-RULES.md / CLI-SETUP.md)
- `main` @ **`ecef1f7`** (the docs-closeout commit; branch off current `main`) · alembic head
  **`0022`** · migration freeze **`0001-0022`** · floors **423 backend / 235 vitest**. (CLI-RULES
  still says head `0014` / floors 239/114 and references a non-existent `graph_runner.py` — ALL
  stale; use THESE numbers and read `team_run.py`, not `graph_runner.py`.)
- Proven agent model for any live run: `nvidia_nim/meta/llama-3.3-70b-instruct` (NIM, via
  `NVIDIA_BUILD_API_KEY`; set by `.env` `TVASHTR_AGENT_MODEL`). ~1.4s/call, clean tool_calls.
- The account tables you MIRROR already exist: `McpSecret` + `ProviderCredential` in
  `backend/tvashtr/models.py` (Uuid PK, `owner_id` FK→`users.id` indexed, a name/provider Text
  column, `created_at`/`updated_at` timestamptz, UNIQUE `(owner_id, name|provider)`). The account
  shelf UI you MIRROR is `frontend/src/components/SecretsShelf.tsx` (a `tv-dash__panel tv-dash__prov`
  section with a head + add-form + chip list), mounted in `Dashboard.tsx` right after the providers
  `<section>` as `<SecretsShelf />` (line ~411). The two per-node editors you EXTEND are
  `frontend/src/panel/ToolsSection.tsx` (worker-only) + `frontend/src/panel/SkillsSection.tsx`
  (both kinds). The two run-time resolvers you EXTEND are `control_plane/node_tools.py`
  (`build_mcp_config`) + `control_plane/node_skills.py` (`_resolve_skills`).

---

## 1. THE STORAGE MODEL (the load-bearing decision — implement exactly)

**A library item is ONE named reusable thing** (mirrors a Secret / a Provider = one named item):
- a library **Tool** = ONE MCP server: a `name` (the `mcpServers` key) + `server_config` (the value
  under that key — `{command,args,env}` for stdio or `{url,headers,type}` for http/sse).
- a library **Skill** = ONE skill source: a `name` (display label) + `source` (one C7.B source
  object — `{type:"inline",name,content,mode,triggers?}` or `{type:"repo",url,ref,filter?}`).

**A node REFERENCES a library item by id, stored INSIDE the node's existing field — NO new node
column.** This is what lets the two resolvers expand references WITHOUT a signature change (which is
what keeps C7.C out of `team_run.py`):
- **Skills:** a NEW source element `{"type": "library", "id": "<uuid>"}` appended to the node's
  `skills` list — a fourth `SkillSource` variant alongside inline/repo/project_rules.
- **Tools:** an id array at `tool_config.tvashtr.library` — a list of referenced tool-library ids,
  stored BESIDE the existing `tvashtr.servers` allow-list metadata (which `build_mcp_config` already
  reads + strips before handing the config to the SDK).

**The reference is LIVE, never a snapshot.** The node stores only the id; the item's content is
fetched FRESH from the library table inside the resolver at run time. Editing an item in its shelf
propagates to every referencing node's next run automatically — nothing is copied onto the node.
A referenced id that no longer exists (deleted item) is SKIPPED + warned via the existing recorder;
the run continues. (This is exactly Claude Code's user-scope-MCP + Cursor's user-rules behavior:
define once, read live, local overrides shared.)

---

## 2. Migration `0023` — two library tables (the ONLY schema; freeze bumped LAST)
Create `backend/alembic/versions/0023_tool_skill_library.py`, `down_revision = "0022_mcp_secrets_run_warnings"`.
Mirror `0022`'s `mcp_secrets` style exactly.
- **`tool_library`** — one account's reusable MCP server: `id` Uuid PK (default uuid4); `owner_id`
  Uuid FK→`users.id`, not-null, indexed; `name` Text not-null (the server key); `server_config`
  JSONB not-null (the single server's config object); `created_at`/`updated_at` timestamptz
  server-default now() (`updated_at` also `onupdate=now()`). UNIQUE `(owner_id, name)`
  (`uq_tool_library_owner_name`) — one server per name per account; add is upsert/replace.
- **`skill_library`** — one account's reusable skill: `id` Uuid PK; `owner_id` Uuid FK→`users.id`,
  not-null, indexed; `name` Text not-null (display label); `source` JSONB not-null (one C7.B source
  object); `created_at`/`updated_at` timestamptz as above. UNIQUE `(owner_id, name)`
  (`uq_skill_library_owner_name`).
- Both additive + nullable-safe (fresh child tables, no backfill); `downgrade()` drops both (+ their
  indexes). Keep the revision id ≤ 32 chars. After EVERYTHING else is green, bump
  `.claude/hooks/protect-migrations.sh` freeze regex from `…2[0-2])_` to `…2[0-3])_` (blocks
  `0001-0023`) — the LAST step.

## 3. Models (`backend/tvashtr/models.py`)
Append `ToolLibraryItem` (`__tablename__ = "tool_library"`) + `SkillLibraryItem`
(`__tablename__ = "skill_library"`) mirroring `McpSecret`'s style (Mapped columns, `__table_args__`
UNIQUE + FK). Keep them near the other account tables. No other model change (no node column is
added — a reference lives inside the existing `tool_config`/`skills` JSONB).

## 4. The library store + resolver-facing fetch (`backend/tvashtr/control_plane/node_library.py`, NEW)
Openhands-free + litellm-free at import (only `uuid` + sqlalchemy + app modules — it is imported by
`node_tools.py`/`node_skills.py`, which must stay openhands-free). Provide:
- **Account CRUD** the endpoints (§6) call — for BOTH tables:
  `list_owner_tools(owner_id) -> list[row]`, `create_owner_tool(owner_id, name, server_config)`,
  `update_owner_tool(owner_id, id, name, server_config)`, `delete_owner_tool(owner_id, id)`; and the
  same four for skills (`…_owner_skills` with `source`). Create is an upsert-on-`(owner,name)`
  replace (mirror `set_owner_mcp_secret`); update targets by id and is owner-scoped; delete is
  idempotent + owner-scoped.
- **Resolver-facing fetch** (owner-scoped, returns the content or `None` when the id is absent /
  not the owner's):
  `resolve_owner_tool(owner_id, id) -> tuple[str, dict] | None` (returns `(name, server_config)`),
  `resolve_owner_skill_source(owner_id, id) -> dict | None` (returns the `source` object).
- `owner_for_run(run_id) -> uuid.UUID | None` — the `select(Run.owner_id).where(Run.id == uuid(run_id))`
  lookup, so both resolvers can resolve the owner from `run_id` without duplicating it. (`node_tools`
  already has a private `_owner_for_run`; it may keep it or switch to this — your call; do NOT change
  the proven secret path's behavior.)

## 5. Extend `build_mcp_config` — merge library refs (`control_plane/node_tools.py`)
Signature STAYS EXACTLY `build_mcp_config(tool_config: dict | None, run_id: str) -> dict` (do NOT
widen it). New behavior, inserted BEFORE the existing per-server resolution loop:
1. Read `tool_config.tvashtr.library` (a list of ids; absent/empty ⇒ no refs). If it is non-empty
   (OR any server has `${NAME}` refs), resolve the owner from `run_id` (via `owner_for_run`).
2. Build a **base servers dict** from the refs: for each id, `resolve_owner_tool(owner_id, id)` →
   `{name: server_config}`. A ref that returns `None` (deleted / not owned) is SKIPPED AND
   `record_resolution_warning(run_id, "tool", "library:<id>", "referenced library tool not found")`.
3. **Overlay the node's inline `mcpServers` on top of the base dict — INLINE WINS on a name
   collision** (`merged = {**library_servers, **inline_servers}`; the node's own pasted server
   overrides a library server of the same name — the local override, matching Claude Code's
   local>project>user MCP precedence).
4. From here, run the EXISTING logic UNCHANGED over `merged`: the per-server on/off allow-list
   (`tvashtr.servers.<name>.enabled`, default on — applies to the resulting server NAME whether it
   came from a ref or inline), `${NAME}` secret substitution + skip/warn, and the `tvashtr` block
   (incl. `library`) STRIPPED from the returned `{"mcpServers": …}`.
Still `{}` for a NULL/empty `tool_config` with no refs (byte-for-byte inert). No module-level
`openhands` import.

## 5-skills. Extend `_resolve_skills` — expand library refs + de-dup (`control_plane/node_skills.py`)
Signatures of `build_skills` / `inject_skills_into_prompt` / `_resolve_skills` STAY EXACTLY as they
are (all keep `run_id`). New behavior:
1. In the `_resolve_skills` dispatch loop, add `elif stype == "library":` → resolve the owner from
   `run_id` (via `node_library.owner_for_run`), `resolve_owner_skill_source(owner_id, id)` → the
   source object → resolve THAT source ONE level (reuse `_resolve_inline`/`_resolve_repo`; a library
   source is only ever inline/repo — if it is `project_rules` treat it like the existing
   project_rules branch; a nested `library` source is unsupported → skip + warn). A ref that returns
   `None` → SKIP + `_emit_skill_warning(run_id, "library:<id>", "referenced library skill not found")`.
2. **De-dup the FINAL resolved list by skill NAME, FIRST occurrence wins** (drawer/list order — the
   row higher in the section wins, which is what the user sees). Benign (no warning). This is the
   only precedence rule for skills; it applies uniformly to inline/repo/library-expanded results.
   (Referenced below as the §5-skills de-dup rule.)
A NULL/empty `skills` still returns `[]` (byte-for-byte inert). Keep the module openhands-free at
import (every `openhands.*` import stays function-local).

## 6. Library endpoints (`backend/tvashtr/routers.py`)
Add owner-scoped CRUD mirroring the `/api/secrets` shape/auth (`get_current_user`,
`uuid.UUID(current_user.id)`), for BOTH libraries. UNLIKE secrets, these RETURN content (a library
tool/skill is editable, not a secret):
- `GET /api/tool-library` → `{tools: [{id, name, server_config, created_at}, …]}` oldest first.
- `POST /api/tool-library` `{name, server_config}` → create/replace (422 on empty name or non-object
  config) → `{id, name}`.
- `PATCH /api/tool-library/{id}` `{name, server_config}` → update owner's item (404 if not owner's).
- `DELETE /api/tool-library/{id}` → 204, idempotent, owner-scoped.
- Same four for `/api/skill-library` with `{name, source}` (validate `source.type ∈
  {inline,repo,project_rules}`; reject a `library`-typed source — no nesting).
No change to the node PATCH handler, `UpdateTeamNodeRequest`, or `_node_base_dict` — a reference
rides inside the existing `tool_config`/`skills`, which already round-trip + clone.

## 7. Frontend — the two account shelves (`ToolsShelf.tsx` + `SkillsShelf.tsx`, NEW; mount in Dashboard)
Mirror `SecretsShelf.tsx`'s structure + `tv-dash__prov*` classes so they look native. Mount BOTH in
`Dashboard.tsx` beside `<SecretsShelf />` (in the same account-panel column). Reuse existing
primitives — do NOT add to `index.css` (SecretsShelf reuses `tv-dash__prov*`; add only a scoped rule
if genuinely needed).
- **Tools shelf** — list the account's library servers (name + a transport badge); add/edit one via
  a small form (name + a Local/Remote guided add like ToolsSection's add-server, or a one-server
  JSON textarea); delete. Editing an item is the "edit once → propagates" moment.
- **Skills shelf** — list the account's library skills (name + an Inline/Repo badge); add/edit one
  (name + inline SKILL.md content + mode, or repo url+ref); delete.

## 8. Frontend — "Add from library" in both drawer sections (extend `ToolsSection.tsx` + `SkillsSection.tsx`)
- **`ToolsSection.tsx`** (worker-only — keep the thinker note as-is): add an **"Add from library"**
  control beside the guided Add-server form. It opens a picker of `listToolLibrary()` items,
  **greying out any whose name already matches an inline server OR an already-referenced item**.
  Picking one appends its id to `tool_config.tvashtr.library`. Render a **library-reference row** in
  the SAME server list, marked with a distinct **"Library"** badge + the item's name (resolved from
  the library list), an on/off toggle writing `tvashtr.servers.<name>.enabled`, and a
  **remove-reference** control (drops the id from `tvashtr.library`). If a library-ref row's name
  collides with an inline server, show a small muted **"overridden"** tag on the library row (inline
  wins — §5 step 3). The `🔧 N` count includes referenced servers.
- **`SkillsSection.tsx`** (both kinds): add an **"Add from library"** control beside "New skill" /
  "Add from a repo". Picker of `listSkillLibrary()` items, greying out already-referenced ones.
  Picking one appends `{type:"library", id}` to `skills`. Render a **library-reference row** with a
  **"Library"** badge + the item's name (from the library list) + a **remove** control. If a
  library skill's name collides with an inline skill's name (or another library skill's name), show
  the muted **"overridden"** tag on the later row (first-in-list wins — §5-skills step 2). Repo-typed
  refs resolve to unknowable-at-author-time names → no tag for those (acceptable). Clearing the last
  source still calls `onChange(null)` (the C7.A clear path).

## 9. Types + client (`frontend/src/lib/api.ts`)
- Add the library `SkillSource` variant additively:
  `export interface LibrarySkillSource { type: "library"; id: string }` and include it in the
  `SkillSource` union. (Extend the existing C7.B region; clearly comment the C7.C addition.)
- Add `ToolLibraryItem` (`{id,name,server_config,created_at}`) + `SkillLibraryItem`
  (`{id,name,source,created_at}`) interfaces + the CRUD clients:
  `listToolLibrary/createToolLibraryItem/updateToolLibraryItem/deleteToolLibraryItem` and the four
  skill equivalents (mirror `listSecrets/addSecret/removeSecret`).
- No change to `updateTeamNode`/`TeamGraphNode`/`GraphData` (a reference is data inside the existing
  `tool_config`/`skills`).

## 10. Tests — mutation-real (backend + FE)
Backend (`backend/tests/test_node_library.py`, NEW):
- **Library CRUD + endpoints**: create → list (returns content) → update → delete, owner-scoped
  (another owner's id → 404 on PATCH/GET-of-one; the list only shows the caller's items); upsert on
  `(owner,name)`; skill-library rejects a `library`-typed source. Assert `GET` returns the stored
  `server_config`/`source` verbatim.
- **Tools resolver expansion + precedence**: a node whose `tool_config.tvashtr.library` names a
  library tool → `build_mcp_config` merges that server into the returned `mcpServers`; an inline
  server of the SAME name OVERRIDES the library one (assert the inline config wins); the allow-list
  `enabled:false` drops a referenced server; a `${NAME}` inside a library server resolves from
  `mcp_secrets`; the `tvashtr` block (incl. `library`) is stripped.
- **Tools missing-ref**: a `tvashtr.library` id with no row → the server is absent AND a
  `run_warnings` row is written; drive `/api/runs/{id}/graph` and assert `resolution_warnings` names
  it (`source_kind="tool"`).
- **Skills resolver expansion + de-dup + missing-ref**: a `{type:"library",id}` source → the
  library skill's source is resolved + appears; two sources resolving to the same skill NAME →
  de-duped, FIRST wins (assert the surviving one); a missing library id → skipped AND
  `_emit_skill_warning` records a `run_warnings` row (`source_kind="skill"`). Use a LOCAL git fixture
  for any repo path (no network).
- **Wire-through-the-real-executor** (the deterministic end-to-end proof, mirroring C7.A's leak
  test): drive the real `run_team` worker path with a node that references a library tool through a
  capturing adapter, and assert the resolved server config reaches `task.mcp_config` VERBATIM (the
  library expansion works through the actual executor — no live NIM/uvx needed).
- **Inertness backstop**: the existing offline suite passes UNCHANGED — a node with NO refs + NULL
  `tool_config`/`skills` yields `build_mcp_config → {}` / `_resolve_skills → []`, no `run_warnings`,
  byte-identical Agent construction. Do NOT modify existing tests except unavoidable fixture-signature
  updates (list them; keep assertions identical).
FE (`frontend/src/`):
- `ToolsShelf.test.tsx` + `SkillsShelf.test.tsx`: add/list/edit/delete round-trip (mock the network).
- `ToolsSection.test.tsx` (extend): the "Add from library" picker lists items + greys out a
  name-collision; picking one appends a `tvashtr.library` id + renders a Library-badged row; the
  "overridden" tag shows for an inline-vs-library name clash; remove-reference drops the id.
- `SkillsSection.test.tsx` (extend): the picker appends `{type:"library",id}` + renders a
  Library-badged row; the "overridden" tag shows for an inline-vs-library name clash.
- `api.test.ts` (extend): the new library types + the `library` `SkillSource` variant type-check.

## 11. Out of scope (do NOT build here)
- No "used by N nodes" blast-radius count on shelf items (§15 deferred — delete is already safe via
  skip+warn; an accurate count means scanning every team the account owns).
- No per-run snapshotting of library content (live-at-resolve is the ratified posture; the mid-run-
  edit edge is an accepted §15 note).
- No nested library refs (a library skill's source is inline/repo only; a library tool is one
  server). No "paste a whole mcp.json → N library rows" convenience (one server per row this
  milestone).
- No new live `make` target — the two existing live e2e targets (`tools-e2e`/`skills-e2e`) stay
  NEEDS_HUMAN on external infra (the container `uvx mcp-server-fetch` first-run init / the NIM
  polling wall) and are NOT C7.C's job; the wire-through-executor backend test is C7.C's end-to-end
  proof.

## 12. Acceptance / evidence (run it ALL yourself, debug to green, echo each decisive line — CLI-RULES §4.3a)
- `make test` → `=== N passed ===`, N ≥ **423** (+ your new backend tests). Re-baseline from a fresh
  run FIRST; report old→new.
- `make lint` clean — run the FULL `make lint` on ALL files you add (backend modules + tests +
  migration), INCLUDING any files added late in the session (the C7.A miss: files added after the
  main green pass shipped unlinted). Do NOT pin an exact file-count clause anywhere.
- `cd frontend && npx tsc --noEmit` clean; `npm run build` green; `npx vitest run` → total ≥ **235**
  (+ your new tests). Quote the counts.
- Alembic: `uv run alembic upgrade head` → head `0023`; `downgrade -1` then `upgrade head`
  round-trips clean (prove reversible).
- The resolver-precedence + missing-ref + de-dup + wire-through-executor + inertness tests green
  (quote the decisive lines).
- **Playwright self-sign-off** (targeted `browser_evaluate` on specific selectors + screenshots, NOT
  a whole-tree snapshot — it chokes on the React Flow canvas): (a) the dashboard → add a tool to the
  Tools shelf + a skill to the Skills shelf, screenshot both listed; (b) open a team, select a
  WORKER node → the Tools section's "Add from library" picker → pick one → screenshot the
  Library-badged row; (c) the same in the Skills section on a thinker OR worker node; (d) a node
  with an inline server AND a library ref of the SAME name → screenshot the "overridden" tag. Record
  the screenshot paths in `STATE.md`.
- The `READY_TO_MERGE: branch=feat/m-tools-c7c-library, sha=<sha>, tests=<N> passing` line in `STATE.md`.

## 13. Invariants to verify in the FINAL REPORT (with proof, not "unchanged")
- **No executor drift:** `git diff main -- backend/tvashtr/control_plane/team_run.py` is EMPTY.
  Quote it. (Word the no-drift check this way — do NOT pin an exact changed-file COUNT alongside the
  full-lint gate; a full lint can surface unrelated pre-existing debt and a count clause would make
  the goal self-contradictory. C7.A-51 lesson.)
- `git diff --name-only main` lists ONLY C7.C's files (the `0023` migration, `models.py`,
  `node_library.py`, `node_tools.py`, `node_skills.py`, `routers.py`, `api.ts`, `ToolsSection.tsx`,
  `SkillsSection.tsx`, `ToolsShelf.tsx`, `SkillsShelf.tsx`, `Dashboard.tsx`, tests). NO `team_run.py`,
  NO `base.py`, NO adapter, NO `TeamNodePanel.tsx`. Quote it.
- `build_mcp_config` signature unchanged (`(tool_config, run_id) -> dict`); `build_skills` /
  `inject_skills_into_prompt` / `_resolve_skills` signatures unchanged (all keep `run_id`).
  `node_tools.py` + `node_skills.py` + `node_library.py` have NO module-level `openhands` import
  (grep each).
- `EngineAdapter` protocol + `AgentTask` dataclass byte-unchanged (base.py untouched); both adapters'
  Agent-construction blocks unchanged.
- Migrations `0001-0022` untouched; `0023` is the only new migration; the freeze regex is bumped to
  `0023` as the LAST step (show the before/after of the hook line).
- Existing tests unmodified except unavoidable fixture-signature updates (list them; assertions
  identical). The inertness backstop holds.

## 14. Stop conditions
- A dead credential / docker outage / NIM unavailable would only affect a LIVE target — and C7.C has
  none (its end-to-end proof is the deterministic wire-through-executor test). So an infra outage is
  NOT a blocker here; complete the offline + FE work green.
- A SECOND, unrelated problem needing a broad or unproven change → STOP + `NEEDS_HUMAN`. A contained,
  regression-guarded fix to a single identified cause inside this scope may proceed.
- If you find you must widen a resolver signature, edit `team_run.py`, or touch `base.py` / an
  adapter / `TeamNodePanel.tsx` → STOP + `NEEDS_HUMAN` (that means the storage model was
  misunderstood — the reference is supposed to live INSIDE `tool_config`/`skills`).
- Hard cap: 45 turns. If not green, write the FINAL REPORT and stop.

End with the 8-section FINAL REPORT (CLI-RULES §4.7).
