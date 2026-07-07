# HANDOVER — for Tvashtr-53

> Structured snapshot for the next architect chat. Read this AND `PROJECTPLAN.md` (root) before doing anything. The living docs are the source of truth; this file carries the standing directives + the immediate next step so the next instance inherits them.

---

## 0. Who you are + how we work (STANDING — carry forward every handover)

You are **Tvashtr-53**, the **architect/planner** for Tvashtr. **Open by stating your name** so the operator can title the chat.

**Division of labor (strict):** ALL implementation — product code, diagnostic scripts, build/Makefile/config — goes through **Claude Code** (the CLI agent). You DESIGN, write the `/goal` (+ optional `prompts/*.md` brief), hand the operator a complete copyable launch package, and **audit the result on disk**. The ONLY architect-direct edits: the two living docs (`PROJECTPLAN.md`, `HANDOVER.md`), `prompts/*.md` briefs, and trivial doc/typo fixes. When tempted to write code, write a `/goal` instead.

**The loop:** you write ONE lean `/goal` for a full bounded milestone (outcome + hard invariants-as-evidence + acceptance/evidence checklist the transcript must show + stop conditions; CC self-decomposes) → hand the operator the **3 copyable blocks** (shell launch / full init prompt / full `/goal`) inline, every time, never "same as last time" → operator runs it (bypass mode) → operator pastes the report (or you read `STATE.md`/the branch) → **you audit on disk** (read changed files, diff against pre-images, verify git from `.git` plumbing, confirm tests are mutation-real, check invariants) → **you give ALL the merge commands copyable; operator FF-merges** → repeat.

**Filesystem access:** full read/write on `/Users/adimac/Desktop/Tvashtr` (**capital T load-bearing**). Confirm the allowed dir at session start (`list_allowed_directories`). **No `git` CLI in the MCP** — reconstruct git state from `.git/refs/heads/<b>`, `.git/logs/HEAD`, `.git/logs/refs/heads/<b>`. The disk audit is your real control point — verify, never rubber-stamp; scrutinize any deviation from the brief by reading the actual change.

**Guardrails (survive bypass — they're PreToolUse hooks):** the agent never pushes (`.claude/hooks/protect-no-push.sh`); the existing migration set is frozen (`.claude/hooks/protect-migrations.sh`, now `0001-0023`) — never edit a frozen migration, create a NEW one and bump the freeze LAST (only if the slice adds a migration). `--dangerously-skip-permissions` skips the permission layer so allow/deny rules go inert — only hooks survive.

**Operator comms (preferences):** terse — "Go"/"proceed"/"merged"/"done" = ratify + move forward; a message starting **"By the way"** wants a short answer. Give **procedures one step at a time** (one step, they report, next). **Analogies help.** **Simple, everyday language — avoid jargon.** Always hand over **copyable artifacts** (commands, init prompt, `/goal`, merge commands, sign-off scripts) — never make them scroll back or retrieve from a file.

**Design decisions:** decide from the §1 vision + the Tvashtr-25 pivot, **never from effort/path-of-least-resistance**; **one design question at a time**, decide it directly (don't present option menus except for genuine strategic-direction calls), get sign-off before the next; **pair every decision with its concrete user-facing UX consequence** (what the user sees/does on the canvas/UI), every time.

**Merge handoff + visual sign-off:** give ALL merge commands copyable every time (cd → checkout main → `git merge --ff-only <branch>` → verify line, + expected tip sha + "if FF fails, stop — that's divergence" + optional `git branch -d`). Prefer CC's Playwright self-sign-off with screenshots; when you DO ask the operator for a visual check, make it a NUMBERED, click-by-click script keyed on VISIBLE labels (never "a thinker node").

---

## 1. Where we are RIGHT NOW

- **`main` @ `2c13d56`** (M-tools C7.C merged). Alembic head **`0023`**; migration freeze **`0001-0023`**. Floors: **442 backend / 252 vitest**.
- **M-tools is COMPLETE** (C7.0 scaffold + C7.A Tools + C7.B Skills + C7.C library). This was Tvashtr-52's ship.
- **Proven live agent model:** `nvidia_nim/meta/llama-3.3-70b-instruct` via `.env` `TVASHTR_AGENT_MODEL` (~1.4s/call). `qwen3-next-80b` is parked (~40% TextContent serialization crashes in the OpenHands/LiteLLM path).
- Nothing is in flight — this is a clean milestone boundary.
- One **untracked** file from Tvashtr-52: `prompts/M-tools-C7.C-library.md` (the C7.C brief). It doesn't affect anything; commit it at the next docs closeout (or leave it — the operator merges docs).

---

## 2. What C7.C shipped (so you have the mental model)

An **account-level library**: define a **tool** (one MCP server) or a **skill** (one skill source) ONCE, then **reference** it from any node. The reference lives INSIDE the node's existing field — **no new node column**: tools = an id list at `tool_config.tvashtr.library`; skills = a `{type:"library","id":…}` element in `skills`. That's the load-bearing choice — it lets the two resolvers (`build_mcp_config`, `_resolve_skills`) expand references with **frozen signatures**, which keeps C7.C entirely out of `team_run.py` (verified: empty diff).

- **Backend:** mig `0023` (`tool_library` + `skill_library`, owner-scoped, mirror `mcp_secrets`); new openhands-free `control_plane/node_library.py` (owner-scoped CRUD + LIVE resolver fetch + `owner_for_run`); `build_mcp_config` merges library servers with inline **inline-wins** on a name clash; `_resolve_skills` expands a library ref one level (rejects nesting) then de-dups by name **first-in-list-wins**; 8 owner-scoped `/api/tool-library` + `/api/skill-library` endpoints (content returned; 422/404; skill source rejects nested `library`). A dangling/foreign ref is skipped + warned through C7.A's recorder. Reference is **LIVE** (id only, fetched fresh each run → edit-once-propagates).
- **FE:** the `library` `SkillSource` variant + 8 clients in `api.ts`; an "Add from library" picker in both drawer sections (Library-badged rows + a muted "overridden" tag on a name clash — inline wins; no tag for repo refs); two account shelves `ToolsShelf`/`SkillsShelf` mounted beside Secrets in the dashboard.
- **Design was verified against Claude Code + Cursor first** — their user-scope MCP servers + user rules are the same model (define-once/reference, local-overrides-shared, live-not-snapshot).

Full as-built: PROJECTPLAN §17 (2026-07-07, Tvashtr-52).

---

## 3. Immediate next step — the operator sequences this (3 live options)

M-tools is done. The next milestone is an **operator call** — present these and let them pick (this IS a genuine strategic-direction choice, so a short menu is appropriate here):

**(a) The two live-target re-runs** — the only pieces of M-tools that never ran on real infra: the agent actually **invoking** an MCP tool end-to-end (`make tools-e2e`, wedged on the container `uvx mcp-server-fetch` first-run MCP-init) and actually **using** a skill end-to-end (`make skills-e2e`, hung on the NIM/SDK polling wall). Both seams are proven; only the final agent-execution line awaits a healthy NIM + warmed-uvx window. This is a verification pass, not a build — needs the infra window, not new code.

**(b) M-rails (C8)** — the first guardrail GATE-nodes: `output_schema_check` / `secret_leak_scan` / `diff_touches_forbidden_paths`, built as deterministic / single-completion gate nodes emitting approved/rejected (NOT NeMo Guardrails as a dependency — that's reject X4), + codify the per-owner request-time credential invariant with a test. Built **one check at a time** (each its own `/goal`). *Its trigger:* first multi-user exposure or first externally-consequential repo write.

**(c) M-unify** — collapse the thinker/worker boundary so every node is a full agent differing ONLY by an **"Edits allowed / Not allowed"** toggle (whether the file-write tool is attached). A "thinker" becomes "an agent with edits off" — keeps the reasoning loop, read-only + MCP tools, on-demand skill invocation. **Forward-compat is already banked:** C7.B built skills capability-agnostic with the thinker's prompt-injection delivery as a THIN BRIDGE that simply gets dropped here (authored skills keep working via the identical `AgentContext` path). Touches the executor thinker path (`pm_step`/`thinker_refine_step`), the `kind`/capability model + the drawer's Capability toggle → an edits toggle, and spec-writing behavior. A dedicated milestone.

Also standing (§15, NOT queued): the **brownfield stronger-worker thesis re-run** (deferred — partially supported; the blocker is rate-limit/BYOK robustness, not model capability; kimi-k2 was writing correct output before a free-tier 429 crashed the loop); the **LIVE validation of C1 + C9** (condensation events + the full `make model-bench` table — needs an NVIDIA key from `main`).

**Mv — a non-founder shipping real value on their own repo — remains THE real gate.** No amount of shipping resolves it; only a Wizard-of-Oz demand probe (≥1 non-founder paying/using) does.

---

## 4. Key decisions + rationale (so they're not re-litigated)

- **Reference-inside-the-existing-field, no new node column** (C7.C) — chosen so the resolvers expand refs with frozen signatures → C7.C stays out of `team_run.py`, and refs ride the existing PATCH/round-trip/clone paths for free.
- **Inline-wins (tools) / first-in-list-wins (skills)** — local override beats the shared library on a name clash; matches Claude Code's MCP precedence.
- **Live reference, not a snapshot** — editing a library item propagates to every referencing node's next run; the clone-on-launch carries the ref id. (Per-run snapshotting is deferred, §15.)
- **Owner-scoped everything** — a node can never reach another account's library item; every query filters `owner_id`. This is the security property; the tests assert it.
- **M-tools ran C7.0 scaffold → C7.A ‖ C7.B (parallel) → C7.C (solo).** The scaffold-first pattern (laying the shared skeleton INERT) is what let the two per-node verticals run file-disjoint in parallel.

---

## 5. Gotchas + working-method notes (not already in PROJECTPLAN)

- **`copy_file_user_to_claude` caches by basename** — re-copying a changed file returns the STALE version. For current disk state, use `read_multiple_files` (cache-free), or copy a file you haven't cached this session. (This bit during the C7.C audit — api.ts/Dashboard.tsx had to be read cache-free.)
- **`Filesystem:edit_file` needs an exact on-disk anchor** — always `dryRun: true` first with a unique multi-line anchor, then apply. `write_file` is more reliable than `edit_file` for a full `HANDOVER.md` rewrite.
- **`PROJECTPLAN.md` is ~320KB; the header banner is a giant single-line entry at line 6.** Index headers with `grep -nE '^#{1,3} '`, read targeted ranges with `sed -n`. To bump the banner, replace a short unique PREFIX of line 6 (prepend the new entry + `_Prior:_`, demote the old).
- **`/goal` has a ~4000-char hard limit** — put the detailed brief in `prompts/*.md`, keep the `/goal` lean with a pointer.
- **Goal-writing lesson (banked):** never pin an exact changed-file COUNT alongside a full-lint gate — a full lint can surface unrelated pre-existing debt, making the goal self-contradictory. Word the no-drift invariant as "`git diff main -- <path>` is empty."
- **`prompts/CLI-RULES.md` + `CLI-SETUP.md` are STALE** (say head 0014, floors 239/114, reference a non-existent `graph_runner.py`; the real executor is `control_plane/team_run.py`). The per-session init prompt overrides them. Worth a refresh pass someday, but not blocking.
- All git commands to the operator must be **comment-free** (zsh `INTERACTIVE_COMMENTS` is off non-interactively).

---

## 6. Key files

- **Living docs:** `PROJECTPLAN.md` (§1 vision, §9 data model, §13 strategy, §14 features, §15 deferred register, §16 milestones, §17 append-only decision log, §18 glossary), `HANDOVER.md` (this), `STATE.md` (CLI agent's log — you read it, don't maintain it).
- **Contracts:** `prompts/CLI-RULES.md`, `prompts/CLI-SETUP.md`; hooks `.claude/hooks/protect-migrations.sh` + `protect-no-push.sh`; `.claude/settings.json`.
- **Backend:** `backend/tvashtr/{models.py, routers.py, config.py, control_plane/*}` (C7 seams: `node_tools.py`, `node_skills.py`, `node_library.py`, `mcp_secrets.py`, `resolution_warnings.py`, `team_run.py`); migrations `backend/alembic/versions/0001-0023*`.
- **FE:** `frontend/src/{lib/api.ts, panel/*, components/*}` (C7: `panel/ToolsSection.tsx` + `SkillsSection.tsx`; `components/{SecretsShelf,ToolsShelf,SkillsShelf,Dashboard}.tsx`).

---

## 7. Ready-to-paste opener for Tvashtr-53

> You are Tvashtr-53. Read `HANDOVER.md` and `PROJECTPLAN.md` at the project root first; then help me pick the next milestone (the two live-target re-runs, M-rails, or M-unify) and scope its first `/goal`. Don't start work until you've read both.
