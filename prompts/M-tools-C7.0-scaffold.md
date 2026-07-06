# M-tools · C7.0 — Scaffold the seam (inert, end-to-end)

**Milestone type:** foundation / scaffold. This is the FIRST of three M-tools milestones. It adds
the whole shared skeleton for per-node **tools (MCP)** and **skills**, wired end-to-end but **inert
by default**, so the two follow-on sessions (C7.A Tools, C7.B Skills) can each fill in only their own
disjoint files without touching the executor or each other. **You are implementing the scaffold, not
the tools/skills behavior** — the real MCP resolution and skill resolution are deliberately stubs here.

**Prime directive: this milestone changes ZERO agent behavior.** With the new columns NULL (there is
no UI to set them yet), every existing run must behave byte-for-byte as it does on `main`. The offline
suite staying green is the proof; do not weaken any test to make it pass.

---

## 0. Current state (authoritative — overrides any stale line in CLI-RULES.md)
- `main` @ `cef32b5` · alembic head **`0020`** · migration freeze **`0001-0020`** · floors **382 backend / 211 vitest**.
- The proven agent model is `nvidia_nim/meta/llama-3.3-70b-instruct` (NIM). No live agent run is
  needed for this scaffold — it's offline + a Playwright screenshot.

---

## 1. Migration `0021` — two nullable node columns (the ONLY schema this milestone adds)
Create `backend/alembic/versions/0021_agent_node_tools_skills.py` (down_revision `0020`). Add to
`agent_nodes`, both **JSONB, nullable, no server default, no backfill** (additive + reversible):
- `tool_config` — the raw MCP config object `{"mcpServers": {…}}` (inline servers; the exact schema
  Cursor's `mcp.json` / Claude Code's `.mcp.json` use). NULL = the node has no inline tools.
- `skills` — a JSON **array** of inline skill-source objects. NULL = the node has no inline skills.

`downgrade()` drops both columns. After everything else is green, **bump the freeze LAST** (§9).

Do NOT add any other table this milestone. (The `mcp_secrets` table lands in C7.A; the library
tables land in C7.C — each in its own later migration.)

## 2. Model (`backend/tvashtr/models.py`)
Add the two columns to `AgentNode`, mirroring the existing `config` JSONB column's style:
```python
tool_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
skills: Mapped[list | None] = mapped_column(JSONB, nullable=True)
```

## 3. Two NEW helper modules (the seams the follow-on sessions fill)
Create these so C7.A/C7.B edit ONLY their own module, never the executor. **Anticipate the parameters
the follow-on sessions will need and pass them from the call sites NOW**, even though the stubs ignore
them — this is what keeps the follow-on sessions out of `team_run.py`.

**`backend/tvashtr/control_plane/node_tools.py`** (owned by C7.A):
```python
def build_mcp_config(tool_config: dict | None, run_id: str) -> dict:
    """Resolve a node's inline MCP config into the dict passed to Agent(mcp_config=…).
    SCAFFOLD STUB: pass-through. C7.A resolves ${NAME} secret refs (owner via run_id)."""
    return dict(tool_config or {})
```
No openhands import needed here (it returns a plain dict).

**`backend/tvashtr/control_plane/node_skills.py`** (owned by C7.B):
```python
def build_skills(skills: list | None, workspace_dir: str, run_id: str) -> list:
    """Resolve a worker node's skill sources into the list passed to AgentContext(skills=…).
    SCAFFOLD STUB: returns []. C7.B builds Skill objects from inline sources + resolves
    repo / repo-rules sources (workspace_dir feeds project-adopt; run_id gives owner)."""
    return []

def inject_skills_into_prompt(skills: list | None, base_prompt: str, run_id: str) -> str:
    """Fold a thinker node's skill content into its direct-LLM prompt (thinkers don't run
    through OpenHands). SCAFFOLD STUB: returns base_prompt unchanged. C7.B prepends content."""
    return base_prompt
```
**Invariant 1 guard:** `node_skills.py` must NOT import `openhands.*` at module level (it's imported
by `team_run.py`). C7.B will add any openhands imports **function-locally** inside the bodies. The
scaffold stubs need no openhands import at all.

## 4. AgentTask contract (`backend/tvashtr/engines/base.py`)
Add two ADDITIVE, defaulted fields to the `AgentTask` frozen dataclass — same pattern as
`llm_api_key` / `pull_paths`. Keep base.py **openhands-free**, so type `skills` as an opaque `list`:
```python
mcp_config: dict | None = None
skills: list | None = None   # opaque list of Skill objects (the adapter knows the type)
```
Update the docstring in the same additive spirit. The Control Plane never learns tool/skill content
beyond passing these through.

## 5. Both adapters — construct the Agent with the new kwargs, None-safe
In **both** `engines/openhands_adapter.py` and `engines/openhands_docker_adapter.py`, extend the
IDENTICAL `agent = Agent(llm=…, tools=[…], condenser=…)` block to:
```python
agent_context = AgentContext(skills=task.skills) if task.skills else None
agent = Agent(
    llm=llm,
    tools=[Tool(name=TerminalTool.name), Tool(name=FileEditorTool.name)],
    condenser=LLMSummarizingCondenser(llm=condenser_llm, keep_first=2, max_size=80),
    mcp_config=task.mcp_config or {},
    agent_context=agent_context,
)
```
Import `AgentContext` (from `openhands.sdk.context`) in each adapter (adapters are already
openhands-land). **Critical inertness detail:** when there are no skills you MUST pass
`agent_context=None`, NOT `AgentContext(skills=[])` — an empty `AgentContext` still injects a datetime
into the system message and would change the prompt. Likewise `mcp_config={}` (empty) creates no MCP
tools. With both columns NULL everywhere, the Agent is byte-identical to today.

## 6. Executor wiring (`backend/tvashtr/control_plane/team_run.py`)
Thread the two columns from the node → the graph dict → the step functions, and call the helpers.
Keep `team_run.py` openhands-free at import (it already is; the helper modules preserve that).
- **`load_graph_step`** (~line 101): the per-node dict currently carries `prompt`, `model`, etc.
  Add `"tool_config": n.tool_config` and `"skills": n.skills` to it.
- **`agent_run_step`** (the worker path; builds `AgentTask(...)` ~line 830): it already receives the
  node's fields as params — thread `tool_config` and `skills` in the same way `node_prompt`/`model`
  arrive, and set on the AgentTask:
  `mcp_config=build_mcp_config(tool_config, run_id)`, `skills=build_skills(skills, workspace, run_id)`
  (use the worker's workspace dir for the `workspace_dir` arg).
- **`pm_step`** (~line 254) and **`thinker_refine_step`** (~line 333): each builds a `prompt`/`prompt_full`
  for a direct gateway call. Thread the node's `skills` in as a param and wrap the assembled prompt:
  `prompt = inject_skills_into_prompt(skills, prompt, run_id)` (right before the gateway `complete`).
- **`run_graph`** (~line 1000): where it calls the above steps with `node["prompt"]`, `node["model"]`,
  also pass `node["tool_config"]` / `node["skills"]` as the new params.
- Import the helpers at the top: `from tvashtr.control_plane.node_tools import build_mcp_config` and
  `from tvashtr.control_plane.node_skills import build_skills, inject_skills_into_prompt`.

## 7. Clone-on-launch copies the two columns
Find where the launch snapshot copies authored nodes to the run's clone graph (the clone helper —
grep for where `agent_nodes` rows are duplicated at run creation; CLI-RULES calls it
`clone_team_graph`; it may live in `routers.py` or `team_run.py`). Copy `tool_config` and `skills`
onto each cloned node exactly as `prompt`/`model`/`config` are copied. Verify by test (§8).

## 8. Router round-trip (`backend/tvashtr/routers.py`)
- The node **GET** shape (the authoring graph endpoint that returns nodes, and whatever the FE
  `TeamGraphNode` reads) must include `tool_config` and `skills`.
- The node **update** endpoint (the one the FE `updateTeamNode` calls with prompt/model/capability)
  must accept optional `tool_config` and `skills` and persist them. Additive — a request omitting
  them leaves them unchanged.

## 9. Tests (backend) — prove inertness + the wire, mutation-real
Add `backend/tests/test_tools_skills_scaffold.py`:
1. **Inertness:** build an `AgentTask` with `mcp_config=None, skills=None`; assert the constructed
   Agent has no MCP tools and `agent_context is None`. And assert `build_mcp_config(None, "r")=={}`,
   `build_skills(None, "/w", "r")==[]`, `inject_skills_into_prompt(None, "hi", "r")=="hi"`.
2. **Wire reaches the AgentTask:** drive the worker path with a node whose `tool_config` is a sample
   `{"mcpServers": {"fetch": {"command": "uvx", "args": ["mcp-server-fetch"]}}}` and assert the
   `AgentTask` handed to the adapter carries that exact `mcp_config` (mock/patch the adapter to
   capture the task; do NOT start a real agent). Same style check that a sample `skills` list flows
   to `build_skills`'s call.
3. **Persistence round-trip:** PATCH a node with a sample `tool_config` + `skills`, GET it back,
   assert deep-equality; then clone the team (launch/snapshot path) and assert the cloned node
   carries the copied `tool_config` + `skills`.
The existing offline suite is the inertness backstop — **do not modify existing tests** except for
unavoidable fixture-signature updates (e.g. a fake adapter/task that now needs the two new fields);
if you must, keep the assertions identical.

## 10. Frontend (`frontend/src/`)
- **`lib/api.ts`:** `TeamGraphNode` gains `tool_config?: Record<string, unknown> | null` and
  `skills?: unknown[] | null`. `updateTeamNode(...)` gains the two as optional args and sends them in
  the PATCH body.
- **Two NEW stub components** (owned by C7.A / C7.B respectively), styled with the existing
  `tv-field` / `tv-btn` primitives so they look native in the drawer:
  - `frontend/src/panel/ToolsSection.tsx` — props `{ value, onChange, capability }`. STUB body: a
    collapsible `tv-field` block titled **Tools** with a short note ("MCP servers — configured in the
    Tools milestone") and a minimal `<textarea>` bound to the raw JSON of `value` calling `onChange`
    (this proves the state+Save wire). Render nothing but the worker-only note when
    `capability !== "worker"` (see below).
  - `frontend/src/panel/SkillsSection.tsx` — props `{ value, onChange }`. STUB body: a collapsible
    `tv-field` block titled **Skills** with a short note and the same minimal JSON `<textarea>` wire.
- **`panel/TeamNodePanel.tsx`** (the authoring drawer): in the agent/completion editor branch, add
  `toolConfig` and `skills` to the panel's local state (seed from `node.tool_config` / `node.skills`,
  reset via the existing `key` remount), include them in the `dirty` check, and pass them into the
  existing **Save** → `updateTeamNode(...)`. Render, **between the Model field and the Save bar**:
  - `<SkillsSection value={skills} onChange={…}/>` for BOTH thinker and worker.
  - `<ToolsSection value={toolConfig} onChange={…} capability={capability}/>` — which itself shows the
    real editor only when `capability === "worker"`, and otherwise a one-line note: *"Tools run inside
    a worker's sandbox — switch this node to Worker to add them."* (Track the live `capability` state,
    not `node.kind`, so toggling Worker↔Thinker updates the section immediately.)
  Do NOT touch the gate/terminal read-only branches.
- **vitest:** add `ToolsSection.test.tsx` + `SkillsSection.test.tsx` (render + the JSON round-trip via
  `onChange`), and extend the `TeamNodePanel` test to assert both sections render for a worker and that
  Tools shows the worker-only note for a thinker. Keep existing assertions intact.

## 11. Out of scope (do NOT build here)
- No secret storage/brokering, no real MCP server connection, no live tool call (that's C7.A).
- No skill parsing, no repo/marketplace import, no `.cursor/rules` reader, no thinker skill content
  (that's C7.B — the stubs stay stubs).
- No library tables, no "add from library" picker (that's C7.C).
- No new Make target; this milestone is offline + a Playwright screenshot.

## 12. Acceptance / evidence (echo each decisive line into the chat — CLI-RULES §4.3a)
- `make test` → the `=== N passed ===` line, N ≥ **382** (plus the new backend tests).
- `make lint` → the clean result line.
- Frontend: `cd frontend && npx tsc --noEmit` clean; `npm run build` succeeds; `npx vitest run` →
  vitest total ≥ **211** (plus the new tests). Quote the counts.
- Alembic: `cd backend && uv run alembic upgrade head` → head is `0021`; `uv run alembic downgrade -1`
  then `upgrade head` round-trips clean (prove reversible).
- **Inertness proof:** state that the offline suite passed unchanged and quote the passed count; note
  that `agent_context=None` is passed when there are no skills.
- **Playwright self-sign-off** (per CLI-RULES §4.4 — targeted `browser_evaluate` + screenshots, NOT a
  whole-tree snapshot): open a team, select a **worker** node → screenshot showing both a **Tools** and
  a **Skills** section in the drawer; select/flip a node to **thinker** → screenshot showing the Skills
  section present and the Tools worker-only note. Record the screenshot paths in `STATE.md`.
- The `READY_TO_MERGE: branch=feat/m-tools-scaffold, sha=<sha>, tests=<N> passing` line in `STATE.md`.

## 13. Invariants to verify in the FINAL REPORT (with proof, not "unchanged")
- `team_run.py` has NO module-level `openhands` import (grep it). `node_skills.py` has NO module-level
  `openhands` import (grep it).
- `EngineAdapter` protocol signature in `base.py` is unchanged (only the `AgentTask` dataclass gained
  two defaulted fields).
- Migrations `0001-0020` untouched; `0021` is the only new migration; freeze bumped to `0021` LAST.
- Existing tests unmodified except any unavoidable fixture-signature update (list them + show the
  assertions are identical).

## 14. Stop conditions
- A genuinely dead credential / OAuth / outage → `NEEDS_HUMAN` (none expected — this is offline).
- A second, unrelated problem needing a broad or unproven change → STOP + `NEEDS_HUMAN`. A contained,
  regression-guarded fix to a single identified cause may proceed.
- Hard turn cap: if not green after sustained effort, write the FINAL REPORT and stop.

End with the 8-section FINAL REPORT (CLI-RULES §4.7).
