# M-tools · C7.B — Skills: one capability-agnostic resolver, repo + repo-rules import, the thinker bridge

**Session B of a two-session PARALLEL batch (Tools ‖ Skills). You are the SKILLS half, running in
your OWN git worktree off `main`.** A separate session (C7.A, Tools) owns the ONE migration + the
shared warning recorder + the shared clear-path plumbing described in the SHARED CONTRACT below —
that block is byte-identical in both briefs; do NOT change any name/shape in it, and do NOT
implement C7.A's side of it. You are ALREADY on your branch in this worktree — do NOT `git
checkout`. Your Postgres DB is `tvashtr_c7b` (exported as `DATABASE_URL`); your Vite dev port is
**5174**.

**File ownership (keep the batch disjoint so cherry-pick stays clean).** You OWN, and may edit,
only: `backend/tvashtr/control_plane/node_skills.py`, `frontend/src/panel/SkillsSection.tsx`,
`frontend/src/lib/api.ts` (append ONLY your own skill-source type block — do NOT touch
`updateTeamNode`, which C7.A owns per the SHARED CONTRACT), your tests, and a NEW live target
(`make skills-e2e`). **Do NOT touch** `control_plane/team_run.py`, `control_plane/node_tools.py`,
either engine adapter, `backend/tvashtr/routers.py`, `frontend/src/panel/ToolsSection.tsx`,
`frontend/src/panel/TeamNodePanel.tsx`, and — critically — you NEVER create
`control_plane/resolution_warnings.py` or a `run_warnings` table or ANY migration (C7.A owns all
schema in this batch; you add none). If you think you need any of these, STOP and write
`NEEDS_HUMAN`.

**Prime directive.** Make a node's inline `skills` actually work end-to-end: each source resolves
server-side into Skill objects via ONE capability-agnostic resolver — inline SKILL.md text (three
modes), a GitHub-repo clone at a pinned ref, and "adopt this repo's own rules" (including the modern
`.cursor/rules/*.mdc` files the SDK doesn't read) — a WORKER gets them via `AgentContext`
progressive disclosure, a THINKER gets the SAME resolved skills rendered into its prompt, and a
source that fails to resolve is SKIPPED with a visible warning. **A node with NULL `skills` (every
node until a user sets one) must still run byte-for-byte as it does on `main`** — your changes are
inert until a node has skills.

---

## 0. Current state (authoritative — overrides any stale line in CLI-RULES.md / CLI-SETUP.md)
- `main` @ **`ce14b96`** (the branch point for this worktree) · alembic head **`0021`** · migration
  freeze **`0001-0021`** · floors **392 backend / 220 vitest**. (CLI-RULES still says head `0014` /
  floors 239/114 — stale; use these numbers.)
- Proven agent model for any live run: `nvidia_nim/meta/llama-3.3-70b-instruct` (NIM, via
  `NVIDIA_BUILD_API_KEY`; set by `.env` `TVASHTR_AGENT_MODEL`).
- **The OpenHands Agent-Skills machinery you build on** (read it on disk):
  `backend/.venv/lib/python3.12/site-packages/openhands/sdk/skills/` and `.../context/`. The SDK
  implements the open Agent-Skills standard (`is_agentskills_format`, scripts/references/assets,
  `<available_skills>` + an auto `InvokeSkillTool`) and the loaders `load_public_skills(repo_url,
  ref, marketplace_path)` (GitHub clone / marketplace = repo+manifest) and `load_project_skills`
  (reads `.cursorrules`/`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`/`.agents/skills` — but NOT
  `.cursor/rules/*.mdc`, which is YOUR glue). A worker's resolved skills ride into the adapter via
  the SCAFFOLD's existing `AgentContext(skills=task.skills)` — you do NOT touch the adapters.

---

## SHARED CONTRACT — IDENTICAL in the C7.A and C7.B briefs. Do NOT change these names/shapes; the other parallel session is built against this exact text.

**S1. The resolution-warning recorder (OWNED BY C7.A; C7.B emits through it).**
C7.A creates `backend/tvashtr/control_plane/resolution_warnings.py` with EXACTLY this function
(name, params, order fixed):
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
  ordered by `created_at` ASC, `[]` when none. (This is a NEW top-level key — distinct from the
  authoring `GraphValidity.warnings`.)

**S2. The clear path (OWNED BY C7.A; for BOTH `tool_config` AND `skills`).**
The scaffold's `updateTeamNode` omits null fields and the PATCH handler persists only non-null — so
a node can't be cleared. C7.A fixes both, for BOTH fields:
- `frontend/src/lib/api.ts` `updateTeamNode`: ALWAYS send `tool_config` and `skills` in the PATCH
  body (as explicit `null` when cleared).
- `backend/tvashtr/routers.py` node PATCH handler + `UpdateTeamNodeRequest`: use
  `body.model_fields_set` to clear on present-null and leave-unchanged on absent, for BOTH fields.
- **C7.B relies on this: your `SkillsSection` clears via `onChange(null)` and your test asserts the
  clear reaches `updateTeamNode` with `skills: null` (mock the network). You do NOT edit
  `updateTeamNode` or the PATCH handler.** The real end-to-end skills clear lands once C7.A is
  merged first and you are cherry-picked on top.

**How you (C7.B) use S1 — this IS your side (implement exactly this):** Do NOT create
`resolution_warnings.py` or the `run_warnings` table. Your worktree is branched off `ce14b96`
(before that module exists), so add a SMALL private, lazy, import-guarded shim in YOUR
`node_skills.py`:
```python
def _emit_skill_warning(run_id: str, name: str, reason: str) -> None:
    """Emit a skill resolution warning through C7.A's shared recorder (SHARED CONTRACT S1). Lazy +
    import-guarded because the recorder module lands with C7.A (merged A-first, then this session
    cherry-picked on top); a no-op in isolation. Tests patch THIS function to assert the emit."""
    try:
        from tvashtr.control_plane.resolution_warnings import record_resolution_warning
    except ImportError:
        return
    record_resolution_warning(run_id, "skill", name, reason)
```
Every skill source that fails to resolve calls `_emit_skill_warning(run_id, "<source-label>",
"<reason>")`. Your tests assert the call (patch `_emit_skill_warning`); the REAL recording is proven
post-merge (A merged first).

---

## 1. The skill-source storage shape (what the `skills` JSON array holds — you own both ends)
`AgentNode.skills` is a JSON array (already a nullable column from the scaffold). `SkillsSection`
(§4) writes it and the resolver (§2) reads it. Each element is ONE source object — pin these three
shapes (extend only additively):
- **Inline**: `{ "type": "inline", "name": string, "content": string (full SKILL.md text),
  "mode": "always" | "trigger" | "agent", "triggers"?: string[] }` — `always` = always available;
  `trigger` = surfaced when the conversation matches `triggers`; `agent` = exposed as an invokable
  skill the agent chooses (the SDK's `InvokeSkillTool` path).
- **Repo**: `{ "type": "repo", "url": string, "ref": string, "filter"?: string | null }` — a GitHub
  repo cloned at the PINNED `ref` (a living reference, not a frozen copy; the ref pins
  reproducibility). `filter` selects a subset of skills. Subsumes marketplaces (a marketplace is a
  repo + manifest).
- **Repo-rules (adopt this repo's own rules)**: `{ "type": "project_rules" }` — read the rule files
  of the repo the run OPERATES ON (the worker's workspace): `CLAUDE.md` / `.cursorrules` /
  `AGENTS.md` / `GEMINI.md` / `.agents/skills` (via the SDK's `load_project_skills`) PLUS
  `.cursor/rules/*.mdc` (your glue). No URL — it's the run's own workspace.

## 2. `build_skills` + the ONE capability-agnostic resolver (`control_plane/node_skills.py`)
Replace the two stubs. **Signatures STAY EXACTLY** `build_skills(skills: list | None, workspace_dir:
str, run_id: str) -> list` and `inject_skills_into_prompt(skills: list | None, base_prompt: str,
run_id: str) -> str` (do NOT widen them — that keeps you out of `team_run.py`).
- **INVARIANT 1 (openhands-free import):** `node_skills.py` is imported by `team_run.py`, which must
  stay openhands-free at import. So NO module-level `openhands` import — put EVERY `openhands.*`
  import (`Skill`, `load_public_skills`, `load_project_skills`, etc.) FUNCTION-LOCALLY inside the
  bodies.
- **ONE resolver** (a private helper, e.g. `_resolve_skills(skills, workspace_dir | None, run_id) ->
  list[Skill]`) turns each source into Skill objects (map to the exact SDK `Skill` constructor/fields
  you read on disk):
  - `inline` → one Skill from the `content`, honoring `mode` (`always` → always-available;
    `trigger` → gated on `triggers`; `agent` → invokable).
  - `repo` → `load_public_skills(url, ref, …)` cloned at the pinned `ref`, then apply `filter`.
  - `project_rules` → ONLY when a `workspace_dir` is available: `load_project_skills(workspace_dir)`
    PLUS your `.cursor/rules/*.mdc` reader (glob the workspace's `.cursor/rules/*.mdc`, parse each
    markdown-with-frontmatter rule file into a Skill). With no workspace (a thinker — see below),
    `project_rules` yields nothing.
  - Any source that raises / can't resolve (repo unreachable, bad ref, unreadable rules) → SKIP it
    and `_emit_skill_warning(run_id, "<label>", "<reason>")`; the run continues.
- **`build_skills`** = `_resolve_skills(skills, workspace_dir, run_id)` → the list handed to
  `AgentContext(skills=…)` by the (untouched) adapter. `None`/empty → `[]` (so the adapter passes
  `agent_context=None`, byte-for-byte inert).
- **`inject_skills_into_prompt`** = the THINKER BRIDGE (SHARED amendment 1). Resolve the SAME sources
  with `_resolve_skills(skills, None, run_id)` (workspace=None → `project_rules` is skipped), then
  RENDER the resolved skills' content into `base_prompt` and return it. A thinker is ONE completion
  with no tool loop, so it has no progressive disclosure: `always` skills are prepended in full;
  `trigger` skills are prepended when the prompt text matches their triggers; an `agent`-mode skill
  degrades to prepended reference (no loop to invoke it). `None`/empty → return `base_prompt`
  unchanged (byte-for-byte inert). This bridge is deliberately thin — it is simply dropped later when
  a "thinker" becomes "an agent with edits off" and takes the identical `AgentContext` path. **Build
  NO thinker-specific skill system** — the resolver is shared; only the DELIVERY differs.

## 3. Emit-through-the-recorder shim (`node_skills.py`)
Add `_emit_skill_warning` EXACTLY as pinned in the SHARED CONTRACT ("How you (C7.B) use S1"). It is
the ONLY way your resolution failures reach the run inspector; never write a `run_warnings` row
yourself.

## 4. Frontend — the real `SkillsSection.tsx` (BOTH thinker and worker)
Replace the stub JSON textarea. Render for BOTH kinds (a thinker folds skills into its prompt; a
worker gets an `AgentContext`). Build from `tv-field`/`tv-seg`/`tv-btn` primitives so it looks
native:
- **New-skill (inline)**: a name + a SKILL.md content textarea + a `mode` segmented control
  (Always / On trigger / Agent decides); On-trigger reveals a trigger-words input. Appends an
  `inline` source.
- **Add-from-repo**: a URL + ref (+ optional filter) → appends a `repo` source.
- **Use-this-repo's-rules**: a toggle → adds/removes the single `project_rules` source.
- **Rows**: one per source with an Inline / Repo / Repo-rules badge + a remove control.
- **Clear**: removing the last source (or an explicit clear) calls `onChange(null)` → the drawer's
  Save → `updateTeamNode` (which, per S2, C7.A makes send `skills: null`). Persisting a cleared list
  as "no skills" works end-to-end only post-merge; your vitest asserts the emit (mock the network).
- Keep the node card's "📄 N" chip working off the source count IF the scaffold exposes a chip hook
  in `SkillsSection`; otherwise leave card rendering alone and do NOT touch `TeamNodePanel.tsx`.

## 5. Types (`frontend/src/lib/api.ts`)
Append ONLY your own clearly-commented block: the skill-source union type (Inline / Repo /
ProjectRules) matching §1. Do NOT touch `updateTeamNode`, the `GraphData` type, or any other
existing export (those are C7.A's / shared). Keep your additions in their own region so the
cherry-pick with C7.A's block is a trivial touch-up.

## 6. Tests — mutation-real (backend + FE)
Backend (`backend/tests/`):
- **Resolver — inline**: each `mode` produces a Skill with the right disclosure behavior (assert the
  SDK Skill fields, not a smoke check). `build_skills(None, "/w", "r") == []`;
  `inject_skills_into_prompt(None, "hi", "r") == "hi"`.
- **Resolver — repo**: use a LOCAL git fixture repo (a temp dir with a valid SKILL.md, `git init` +
  commit; NO network) as the `url`, resolve at a pinned ref, assert the Skill loads; assert `filter`
  narrows it.
- **Resolver — project_rules**: a fixture workspace dir containing `CLAUDE.md` + `.cursor/rules/x.mdc`
  → assert BOTH are read (the `.mdc` glue is the point — prove the SDK-alone path would miss it, then
  your reader catches it). With `workspace_dir=None` (thinker path) → `project_rules` is skipped.
- **The thinker bridge**: `inject_skills_into_prompt` with an `always` inline skill prepends its
  content to `base_prompt`; a `trigger` skill is included only when the prompt matches; assert the
  SAME resolver output feeds both `build_skills` and the bridge (capability-agnostic).
- **Skip + warn**: an unreachable `repo` source → the source is skipped AND `_emit_skill_warning` is
  called with `(run_id, "<label>", "<reason>")` (patch the shim; assert the call). Drive it through
  `build_skills` and `inject_skills_into_prompt` both.
- **Inertness backstop**: the existing offline suite passes UNCHANGED (a NULL-`skills` node →
  `build_skills` `[]` / `inject` unchanged / Agent byte-identical). Do NOT modify existing tests
  except unavoidable fixture-signature updates (list them; keep assertions identical).
- **INVARIANT 1 check as a test/grep**: `node_skills.py` has NO module-level `openhands` import.
FE (`frontend/src/`):
- `SkillsSection` vitest: new-inline appends a correctly-shaped source with the chosen mode;
  add-from-repo appends a `repo` source; the use-repo-rules toggle adds/removes the single
  `project_rules` source; badges render per type; clearing the last source emits `onChange(null)`.
- `api.test.ts`: the new skill-source types type-check.
Live:
- **`make skills-e2e`** (NEW target, opt-in, NOT in `make test`): a WORKER node with an `always`
  inline skill carrying a distinctive instruction runs through the DOCKER sandbox; assert from the
  trajectory/output that the skill reached the agent and shaped its behavior (the `AgentContext`
  path end-to-end). Run it yourself and echo the decisive line; if docker/NIM is genuinely
  unavailable, write `NEEDS_HUMAN` with the exact blocker (the offline + FE work must still be
  complete and green).

## 7. Out of scope (do NOT build here)
- No tools/MCP work, no secrets, no migration, no `run_warnings` table, no recorder module (all
  C7.A / not this batch).
- No edits to `updateTeamNode` or the PATCH handler (C7.A owns the clear plumbing — SHARED S2).
- No reusable account LIBRARY tables / "Add from library" picker (that is C7.C).
- No interactive browser-OAuth skill import (autonomous agents use token/header auth — §15).
- No thinker-specific skill system (the resolver is shared; only delivery differs — amendment 1).

## 8. Acceptance / evidence (run it ALL yourself, debug to green, echo each decisive line — CLI-RULES §4.3a)
- `make test` → `=== N passed ===`, N ≥ **392** (+ your new backend tests). Re-baseline from a fresh
  run first; report old→new.
- `make lint` clean.
- `cd frontend && npx tsc --noEmit` clean; `npm run build` green; `npx vitest run` → total ≥ **220**
  (+ your new tests). Quote the counts.
- The resolver (inline 3 modes / repo via local fixture / project_rules incl. `.mdc`), the thinker
  bridge, and skip/warn tests green (quote the decisive lines).
- `make skills-e2e` → the line proving the inline skill reached the worker through docker (or a
  `NEEDS_HUMAN` with the exact external blocker).
- **Playwright self-sign-off** (targeted `browser_evaluate` on specific selectors + screenshots, NOT
  a whole-tree snapshot — it chokes on the React Flow canvas): (a) open a team, select a WORKER node
  → screenshot the real Skills section (new-inline with a mode control + add-from-repo +
  use-repo-rules toggle + a row with a badge); (b) select a THINKER node → screenshot the SAME Skills
  section present (skills fold into a thinker's prompt). Record the screenshot paths in `STATE.md`.
- The `READY_TO_MERGE: branch=feat/m-tools-c7b-skills, sha=<sha>, tests=<N> passing` line in
  `STATE.md`.

## 9. Invariants to verify in the FINAL REPORT (with proof, not "unchanged")
- `git diff --name-only main` shows ONLY your owned files (NO `team_run.py`, NO `node_tools.py`, NO
  `routers.py`, NO `ToolsSection.tsx`, NO `TeamNodePanel.tsx`, NO adapter, NO migration). Quote it.
- `git diff main -- backend/tvashtr/control_plane/team_run.py` is EMPTY. Quote it.
- `node_skills.py` has NO module-level `openhands` import — every `openhands.*` import is
  function-local (grep it, show the import lines are inside function bodies).
- `build_skills` / `inject_skills_into_prompt` signatures unchanged.
- You added NO migration and NO new table; `resolution_warnings.py` does NOT exist in your diff.
- `EngineAdapter` protocol + `AgentTask` + both adapters byte-unchanged (you didn't touch them).
- Existing tests unmodified except unavoidable fixture-signature updates (list them; assertions
  identical).

## 10. Stop conditions
- A dead credential / docker outage / NIM unavailable on the LIVE target → `NEEDS_HUMAN` (the offline
  + FE work must still be complete and green).
- A SECOND, unrelated problem needing a broad or unproven change → STOP + `NEEDS_HUMAN`. A contained,
  regression-guarded fix to a single identified cause inside this scope may proceed.
- If you find you must edit `team_run.py`, `node_tools.py`, `routers.py`, `ToolsSection.tsx`, an
  adapter, or add a migration → STOP + `NEEDS_HUMAN` (that breaks the parallel split / the batch's
  one-migration rule).
- Hard cap: 40 turns. If not green, write the FINAL REPORT and stop.

End with the 8-section FINAL REPORT (CLI-RULES §4.7).
