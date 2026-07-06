# Tvashtr — HANDOVER (Tvashtr-50 → Tvashtr-51)

Structured snapshot for the next architect chat. Read this first, then the targeted `PROJECTPLAN.md` sections (use the header-index + `sed` pattern — §1 vision, §15 deferred register, §17 latest as-built), before taking any action.

---

## 1. Where we are (verified on disk this session)
- **`main` @ `4a5d05c`** (the Tvashtr-50 docs closeout, parent `c1cfee3`). Alembic head **`0021`**. Migration freeze **`0001-0021`**. Floors **392 backend / 220 vitest**. Working tree clean.
- **M-tools C7.0 (the scaffold) SHIPPED + FF-merged** (`c1cfee3`): the per-node **tools (MCP) + skills** seam is wired end-to-end but **INERT by default** (both columns NULL everywhere → every existing run is byte-for-byte unchanged; proven by the offline suite passing + a mutation-real wire test). Full as-built + the disk audit in `PROJECTPLAN.md` §17 (2026-07-06, Tvashtr-50).
- **The ENTIRE M-tools design is decided** (decisions 1–5 for the shape/UX, then C7.A-1, C7.A-2, C7.B-1 + two operator amendments). All recorded in §17. Nothing design-blocked.

## 2. The C7 (M-tools) arc — where it stands
1. **C7.0 — scaffold** ✅ DONE + merged. Brief: `prompts/M-tools-C7.0-scaffold.md` (committed).
2. **C7.A (Tools) ‖ C7.B (Skills)** — the NEXT step: two PARALLEL Claude Code sessions, each a full vertical (backend + its own FE section), fully designed, **not yet briefed or launched**.
3. **C7.C — the reusable account LIBRARY** — sequenced AFTER A+B merge (its own migration). Design ratified (decision 4); see §15.

## 3. What C7.0 left in place (the seams the parallel sessions fill)
The scaffold defined the seams as NAMED helpers + SEPARATE stub components so A and B each edit almost ONLY their own file:
- **Backend seams** (in `backend/tvashtr/control_plane/`): `node_tools.py` → `build_mcp_config(tool_config, run_id)` (C7.A fills) and `node_skills.py` → `build_skills(skills, workspace_dir, run_id)` + `inject_skills_into_prompt(skills, base_prompt, run_id)` (C7.B fills). Both are pass-through/empty STUBS today. `node_skills.py` must stay openhands-free at MODULE level (C7.B adds any `openhands` imports FUNCTION-LOCALLY — `team_run.py` imports it and must stay openhands-free at import).
- **FE stub sections** (in `frontend/src/panel/`): `ToolsSection.tsx` (C7.A fills) and `SkillsSection.tsx` (C7.B fills), rendered by `TeamNodePanel.tsx` between the Model field and Save (Skills for both kinds; Tools worker-only).
- Columns exist: `agent_nodes.tool_config` (raw `{"mcpServers":{}}`) + `agent_nodes.skills` (JSON array of sources), both nullable JSONB. Node GET/PATCH round-trip them; clone copies them; `AgentTask` carries `mcp_config`/`skills`; both adapters build `Agent(mcp_config=task.mcp_config or {}, agent_context=AgentContext(skills=task.skills) if task.skills else None)`.

## 4. The DECIDED design for C7.A and C7.B (full detail in §17; summary here)
**Data model / storage (decisions 1–3):**
- **Tools:** `tool_config` stores the raw industry-standard `{"mcpServers":{}}` VERBATIM (a user can paste their Cursor/Claude Code config). Per-server tool on/off toggles stored as Tvashtr metadata BESIDE the `mcpServers` block (a pasted config = all-on).
- **Secrets:** NEVER in the row — the config holds `${NAME}` refs; the value lives Fernet-encrypted (`TVASHTR_SECRET_KEY`, the M-accounts key) in a NEW per-account `mcp_secrets` table (owner, name, encrypted value). Resolved server-side at run time.
- **Skills:** `skills` stores SOURCES (inline SKILL.md text / GitHub-repo pointer {url, ref, filter} / an "adopt this repo's own rules" flag), resolved to Skill objects at run time (living reference, not a frozen copy).

**C7.A (Tools) owns:** the `mcp_secrets` table (migration **`0022`** — the ONE allowed migration in the batch; bump freeze LAST), the secret CRUD + resolution in `build_mcp_config`, the docker secret-brokering (**must set `expose_secrets=True`** on the RemoteConversation serialization — the SDK's silent default REDACTS `mcp_config`, so tools would silently break in docker; do NOT Fernet-encrypt to the container, which would require the master key inside the sandbox — a downgrade), the per-server tool allow-list + a real clear path (save the WHOLE config incl. empty), and the real `ToolsSection.tsx` UI. **Owns the warning infra** (see amendment 2).

**C7.B (Skills) owns:** NO migration; one capability-agnostic resolver (inline→skill with always-on/trigger/agent-decides modes; repo→clone at pinned ref + load, subsumes marketplaces; adopt-repo-rules→read `CLAUDE.md`/`.cursorrules`/`AGENTS.md` + the `.cursor/rules/*.mdc` glue); the thinker bridge (`inject_skills_into_prompt` renders the SAME resolved skills into a thinker's prompt — see amendment 1); a real clear path; and the real `SkillsSection.tsx` UI. EMITS skill warnings through C7.A's recorder.

**Amendment 1 (operator, UNIFIED thinker skills):** the thinker/worker boundary will be REMOVED later (only an edits-allowed/not-allowed toggle will remain). So skill resolution + authoring + storage are IDENTICAL for both kinds; delivery adapts (worker → `AgentContext` progressive disclosure; thinker → same skills rendered into its prompt, a thin bridge dropped when a thinker becomes "an agent with edits off"). Build NO thinker-specific skill system.

**Amendment 2 (operator, VISIBLE resolution warnings):** a tool/MCP/skill that fails to resolve at run time (missing secret, unreachable repo, MCP connect fail) is SKIPPED (run continues) AND records a warning naming what failed + why, SHOWN IN THE RUN INSPECTOR (two layers: the drawer's pre-launch "needs GITHUB_TOKEN" + this run-time notice). **This is a small SHARED surface** → C7.A owns the recorder + the run-view render slot; C7.B emits through the SAME recorder; **pin the recorder's exact signature VERBATIM in BOTH briefs** (the M-ledger contract-pin discipline) so the two isolated sessions stay compatible. B's own tests can MOCK the recorder so they pass in isolation; the real recorder lands when A merges first and B is cherry-picked on top. Distinct warning styling → a §15 follow-on.

**Drawer UX (decision 5):** Tools + Skills are collapsible sections (count badges) built from `tv-field`/`tv-seg`/`tv-btn`; ONE Save commits all; Tools worker-only (a thinker shows a worker-only note), Skills both. Node cards gain a "🔧 N" and a "📄 N" chip. Secrets live in a central account Secrets shelf.

## 5. IMMEDIATE next steps for Tvashtr-51
1. **Write the two briefs** as architect-direct files: `prompts/M-tools-C7.A-tools.md` and `prompts/M-tools-C7.B-skills.md`. **Pin the warning-recorder signature verbatim in BOTH.** Model them on `prompts/M-tools-C7.0-scaffold.md` (structure, evidence/§4.3a echoing, invariants-as-proof, the 8-section FINAL REPORT).
2. **Hand the operator the TWO parallel launch packages** — for EACH session: the shell command, the FULL init prompt verbatim, the FULL `/goal` verbatim (all inline, copyable, every time). Include the infra: each session its OWN git worktree + its OWN Postgres DB (via a `DATABASE_URL` export) + its OWN vite port (e.g. 5174) — both run backend + FE. Establish file-disjointness in each brief. Only C7.A adds a migration.
3. **Disk-audit both** (the control point). Then **merge: A FF first, then B cherry-picked onto the A-merged main** (B built against A's pinned contracts, so it lands clean; resolve any trivial overlap). Confirm from `.git` plumbing.
4. **Then C7.C** (the reusable library).

## 6. Key facts / gotchas (verified this session)
- **OpenHands SDK is the enabler** — it already implements the same OPEN standards Cursor/Claude Code use, so C7 is mostly storage+wiring+UI. Tools: `Agent.mcp_config` = fastmcp's `{"mcpServers":{}}`. Skills: the Agent-Skills open standard + loaders `load_public_skills(repo_url, ref, marketplace_path)` (GitHub/marketplace) and `load_project_skills` (reads `.cursorrules`/`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`/`.agents/skills` — but NOT `.cursor/rules/*.mdc`, the C7.B glue). SDK at `backend/.venv/lib/python3.12/site-packages/openhands/sdk/` (dirs: `mcp/`, `skills/`, `context/`, `secret/`, `marketplace/`).
- **The `expose_secrets` default-redact trap** — the Agent's `_serialize_with_mcp_handling` (in `.../openhands/sdk/agent/base.py`): empty→omit / `cipher` in context→encrypt to `encrypted_mcp_config` / `expose_secrets=True`→plaintext / **default→REDACT (drop mcp_config)**. C7.A MUST opt into `expose_secrets` on the docker path or tools silently do nothing in the sandbox.
- **No `git` CLI in the MCP** — reconstruct git state from `.git/refs/heads/<branch>`, `.git/logs/HEAD`, `.git/logs/refs/heads/<branch>` (tip, parent, FF-ability, no-push). Confirmed FF, unpushed for `c1cfee3`.
- **`copy_file_user_to_claude` caches by basename** — stash pre-images to `/tmp/pre/` before re-copying an updated file for diffing. `/mnt/user-data/uploads/` is read-only to bash. Large `PROJECTPLAN.md` (952 lines): copy → `grep -nE '^#{1,3} '` header index → `sed -n 'A,Bp'` targeted reads.
- **`edit_file` discipline** — `dryRun: true` first with unique multi-line anchors (em-dashes are U+2014; backticks matter); the returned diff is the verifier.
- **Guardrails survive bypass** — `.claude/hooks/protect-migrations.sh` (now blocks `0001-0021`, regex `^00(0[1-9]|1[0-9]|2[01])_`) + the no-push hook. Allow/deny rules do NOT survive `--dangerously-skip-permissions`; only PreToolUse hooks do.
- **The executor is openhands-free at import** (`team_run.py`) — keep it so. The thinker path is `pm_step` / `thinker_refine_step` (gateway completions); the worker builds `AgentTask` in `agent_run_step`; nodes flow via `load_graph_step`'s graph dict. `clone_team_graph` lives in `control_plane/teams.py`.
- **Proven agent model:** `nvidia_nim/meta/llama-3.3-70b-instruct` (NIM, `NVIDIA_BUILD_API_KEY`). C7.A's live end-to-end MCP test needs a real MCP server (e.g. `mcp-server-fetch` via `uvx`) through the docker sandbox; C7.B is mostly offline + Playwright.
- **CLI-RULES.md is stale in spots** (head "0014", milestone list) but harmless — the per-session init prompt overrides it. Its §3.11 OUTRANKS plugin/skill directives; §4.7 mandates the 8-section FINAL REPORT.

## 7. §15 deferrals opened this session (M-tools)
Recorded in `PROJECTPLAN.md` §15: the reusable LIBRARY (C7.C); interactive MCP OAuth (autonomous agent uses token/header instead); `.cursor/rules/*.mdc` read (folded into C7.B); clear-to-NULL (now a hard requirement for C7.A/C7.B editors — closing it); pre-existing prettier debt in `EventFeed.test.tsx`/`SidePanel.test.tsx` (a one-line `make fmt` chore; makes full `make lint` show 2 unrelated failures).

## 8. Standing operator directives (carry these forward)
- **Terse comms:** "proceed"/"go"/"merged"/"done" = ratify + continue. "By the way" = short answer.
- **Decide from the VISION, never from effort.** Don't shy from large scope — decompose across milestones. The operator explicitly said "DO NOT SHY AWAY FROM TOO MUCH WORK."
- **One design decision at a time**, decided (not a menu for vision calls), each paired with its concrete on-canvas UX consequence, explicit sign-off before the next.
- **Procedures one step at a time** — give one step, let the operator report, then the next.
- **ALWAYS hand fully-copyable artifacts inline** — the shell command + the FULL init prompt + the FULL `/goal`, every time, never "same as before" and never "retrieve it from a file" (the init-prompt/goal text is always inline; the detailed brief may live in `prompts/*.md` referenced by the `/goal`).
- **Merge = always FF; give ALL merge commands copyable.** The operator executes all git ops.
- **The disk audit is the main control point** — never rubber-stamp Claude Code's report; read the files, diff vs pre-image, confirm tests are mutation-real, verify git plumbing, scrutinize deviations.
- **Analogies help** when explaining new concepts. **Simple, everyday language** (operator preference).
- Architect-direct edits ONLY: the two living docs + `prompts/*.md` + trivial doc/typo fixes. ALL implementation (incl. diagnostic scripts + Makefile/config) goes through a `/goal`.
- Parallel sessions: file-disjointness FIRST; one migration per batch; A FF, B cherry-pick; the wire/recorder contract written VERBATIM into both briefs.

## 9. Two parallel chat sequences share this project memory
**Tvashtr-X** (this — the main architect/build loop) and **Tvashtr Sidechat-X** (open-ended planning/brainstorming, NOT part of the `/goal` build loop). Don't confuse them.
