# HANDOVER — for Tvashtr-31

> A structured snapshot for the next architect/planner chat. Read this **and** the relevant `PROJECTPLAN.md` sections (the header banner, §15 deferred register, §17 decision/as-built log) before taking any action. STATE.md is the CLI agent's own execution log.

---

## 0. Read-me-first / how we work (the standing operator directives)

You are the **architect/planner** — you design, scope, write the `/goal` (or a detailed `prompts/*.md` brief), hand the operator a complete copyable launch package, and **audit on disk**. Claude Code (the CLI agent, launched with `--dangerously-skip-permissions`) does ALL implementation. Your only direct edits: the two living docs (`PROJECTPLAN.md`, `HANDOVER.md`), `prompts/*.md`, and trivial fixes.

**The three operator directives locked into memory (#10–#12) — honor them EVERY time, no exceptions:**
1. **Copyable launch package, every time.** Whenever anything goes to Claude Code, paste the COMPLETE copyable text inline — (1) the shell launch command (`cd /Users/adimac/Desktop/Tvashtr && claude --dangerously-skip-permissions`), (2) the FULL init prompt verbatim, (3) the FULL `/goal` command verbatim — every single time, even if unchanged. NEVER say "the same as before", NEVER refer back, NEVER tell the operator to get the init-prompt/`/goal` text from `prompts/` or anywhere. (The detailed brief MAY live in `prompts/*.md` and the `/goal` references it — but the init-prompt and `/goal` TEXT are always reproduced inline.)
2. **Detailed visual sign-off.** Whenever you ask the operator for a visual/manual check, give a concrete, NUMBERED, click-by-click script: which exact team to open, which node **by its visible label** (never "a thinker" — "the node labeled PM"), exactly where to click/drag FROM and TO, what to type, and the precise expected pass/fail. Never an abstract checklist. If you don't know the live labels, read the FE source first.
3. **All merge commands, every time.** Whenever a merge is called for, give ALL the commands as copyable text (cd, `git checkout main`, `git merge --ff-only <branch>`, the verify line + expected tip sha, optional `git branch -d`). Never just "FF-merge it".

**Plus the standing decision discipline:** make every architecture/design/scoping call **directly from the §1 vision + the Tvashtr-25 pivot — never from effort-minimization**; surface ONE design question at a time and decide it (don't present option menus for vision calls); and **pair every decision with its concrete user-facing UX consequence** (what the user sees/does on the canvas). The operator communicates tersely ("proceed"/"go"/"merged" = ratify + go; "by the way" = short answer). Analogies help.

**The Project Instructions are the source of truth for working method** (they encode all of the above plus the disk-audit-against-pre-images discipline, the Playwright self-sign-off model, reproduce-first, and the stop-clause wording). This §0 is the quick version.

---

## 1. Where we are (state of `main`)

- **`main` is at `d568850`.** Option A **Milestone 1 — the per-node work-brief — is MERGED** (one commit, clean FF from `1becdc0`; branch deleted). Alembic head **`0013`**, NO migration. `team_run.py` is **additive-only**; every other backend file (`routers.py`, `teams.py`, `models.py`, `openhands_adapter.py`, `invocations.py`) is **BYTE-INTACT** vs the pre-run `main` (disk-verified by pre-image diff).
- **What M1 shipped:** the reviewer-only `agent_invocations.outcome_detail` (column from `0011`) is now a per-node **"what I did last run" brief** on every thinker/worker node, written deterministically at close with **no extra LLM call** — a thinker writes "Drafted the spec from the idea." / "Refined the spec (version N).", a non-emitting worker (Engineer) writes a files-changed line from `AgentRunResult.files_changed` ("Built the feature — changed N file(s): …", or the empty-fallback "Ran but changed no files."), and the emitting worker (Reviewer) is **unchanged** (its `outcome_detail` stays the verdict reasons — §14.1 + §14.3 read it byte-identical). The run-view `SidePanel` was **de-roled**: it now selects by **node-id** (not `role_name`, so duplicate role names attribute correctly — the run-view twin of P1.8d's authoring fix) and switches its body on **`kind`** (completion → the shared-spec PRD for ANY thinker; agent → the event feed) atop a uniform "Last run" section.
- **Two-layer document model (Tvashtr-28, now half-built):** (a) ONE shared spec a thinker chain refines [forward] + (b) the per-node work-brief [backward] — both presentation-layer. M1 built (b) in the **RUN view**. The AUTHORING-view half of (b) is M2 (see §2). Agentic memory is a separate orthogonal layer (Postgres-now → pgvector-next, still registered).
- **Gates:** 239 backend (+7, mutation-real) / 114 vitest (+2); `make work-brief-e2e` green on NIM + the four smokes + thinker-chain/capability/topology e2e; operator FF-merged after the live e2e self-recovered from a 24-min hang (see §4).

The pivot is realized end-to-end: prompt-driven nodes (P1.8a), prompt/model editing (P1.8b-1), the team library (P1.8b), capability/thinker authoring (P1.8c), topology authoring (P1.8d), and now per-node run-legibility (the work-brief, M1). **The J2 "author your own wiring" differentiator is shipped; per-node "what did it do" is now legible in the run view.**

---

## 2. Immediate next step — recommended: Option A **Milestone 2** (the authoring-panel brief + the `cloned_from_node_id` linkage)

M1 surfaced the per-node brief in the **RUN view** (no migration — the run executes a clone, and `get_run_graph` already serves each node's `invocations.outcome_detail`). **M2 surfaces the same brief in the AUTHORING view** — clicking a node in `TeamNodePanel` shows, alongside its prompt/model/capability, a "last run" brief of what **that editable node** did on its most recent run.

**Why it needs more than M1 (the disk fact that forced the M1/M2 split):** a run executes against a **CLONE** of the team and `clone_team_graph` keeps **NO back-reference** to the origin node — so "what did THIS editable node do last run" can't be answered correctly by matching clone↔origin on `role_name` (two blank thinkers share a name → you'd show the WRONG node's brief; the exact duplicate-role case P1.8d/M1 handle by node-id). **The fix:** a new **`cloned_from_node_id` column on `agent_nodes`** (a migration — the **first since `0013`**; bump the `protect-migrations.sh` regex as the last step), set by `clone_team_graph`, plus a cross-run "latest invocation per origin node" read surfaced in `TeamNodePanel`.

**Why it's the recommended next milestone (vision-first, not effort-min):** this linkage is exactly the substrate **"converse with a node (Mode A)"** needs — a per-node recorded-history surface in the authoring panel. It's the harder, more steering-central half of the two-layer model, and it advances the converse-with-a-node vision directly.

**UX consequence (pair this when you present the design):** the authoring canvas — where the user actually lives between runs — grows a per-node "last run" memory; you click a node you're editing and see what it did last time, making each node's behavior legible right where you tune it.

**Alternatives if the operator wants to reprioritize (all registered in §15 / the roadmap):**
- **The local-adapter `files_changed` fix** *(the one substantive M1 caveat)* — on real **LOCAL-sandbox** runs the OpenHands adapter reports EMPTY `files_changed` for the greeting build (the file IS written + committed — the smokes assert it), so the Engineer's LIVE brief is the hollow "Ran but changed no files." (the files-changed variant is proven only in `test_work_brief_executor.py`). **First verify whether the DOCKER adapter (the product default) populates `files_changed`** — if the gap is local-only it's low priority; if it's both, fix `openhands_adapter.py`'s before/after snapshot so the worker brief is meaningful wherever shown. Smaller, an adapter-layer patch (not vision-advancing), but it makes M1's worker brief actually useful — worth doing before/with M2 so M2 doesn't surface a hollow brief. The richer alternative (surface the agent's natural-language final message) is also registered.
- **M3 — mid-run prompt re-read** (reuse P1.7's recorded read-latest-before-each-use pattern on the node *prompt*) → enables Mode B of "converse with a node".
- **The smaller §15 P1.8d follow-ons:** gate/terminal post-drop config editing (the node panel doesn't yet open for gates/terminals); `REVIEW_VERDICT.json` → `OUTCOME.json` rename (cosmetic); thinker-as-router; the `deriveNodeStatus` "never-reached node reads Failed" fix (operator-flagged "do not let disappear" — fold into an FE touch or take standalone).

**The real value gate (standing, unchanged):** no amount of shipping resolves it — run the **Wizard-of-Oz demand probe**: ≥1 NON-founder user validating willingness to pay (the differentiator is built and demoable; this is the gate that matters most). **Brownfield** is the registered demand-aligned north star shaping post-capstone sequencing.

---

## 3. Key facts / environment

- **Proven OpenHands agent model:** `nvidia_nim/meta/llama-3.3-70b-instruct` (set via `.env TVASHTR_AGENT_MODEL`; ~1.4s/call; ships live gates cleanly). `qwen3-next-80b-a3b-instruct` is **parked** (~40% `TextContent is not JSON serializable` flake — a serialization bug in the OpenHands/LiteLLM path, not auth/quota).
- **`DEFAULT_MODEL`** (PM/completion knob, distinct from the agent knob) **must be a non-reasoning instruct model** (`openai/gpt-4o-mini`) — a reasoning model there silently returns an EMPTY PRD.
- **Migration freeze:** `protect-migrations.sh` (a PreToolUse hook, survives bypass) freezes the existing set (regex currently `^00(0[1-9]|1[0-3])_`, i.e. `0001`–`0013`); head is `0013`. Add a NEW migration, never edit a frozen one — and **bump the regex as the last step if you add one** (M2's `cloned_from_node_id` would be `0014` → regex `^00(0[1-9]|1[0-4])_`).
- **No-push guard:** `protect-no-push.sh` is a **PreToolUse(Bash) hook** (a `permissions.deny` rule does NOT survive `--dangerously-skip-permissions` — only hooks do). The agent never pushes; the operator merges.
- **No `git` tool in the MCP.** Reconstruct git state from `.git` plumbing (`refs/heads/<branch>`, `logs/HEAD`, the branch reflog `logs/refs/heads/<branch>`). Verify "untouched/byte-intact" claims by diffing the post-run file against a **pre-image you copy before the run** — and **don't overwrite your pre-image** (the M1 audit lost `team_run.py`'s pre-image to a copy-tool basename collision and fell back to a structural token+region audit; copy pre-images to a distinct path like `/tmp/pre/` first). `/mnt/user-data/uploads/` is **read-only** in the container; copy there is via the copy tool, but bash writes must go to `/tmp` or `/home/claude`. The operator's `git diff --stat main <branch>` is the authoritative file-set gate.
- **Stack:** Python 3.12 / FastAPI / DBOS Transact / SQLAlchemy 2 + Alembic / Postgres 16; React 19 / Vite 7 / TS 5.6 / React Flow / vitest 3; LiteLLM proxy + OpenHands SDK + NVIDIA NIM. Project root `/Users/adimac/Desktop/Tvashtr` (capital T load-bearing). Host = a MacBook Air (run bypass containerized when practical).

---

## 4. Gotchas (not all in PROJECTPLAN)

- **A disabled dirty-aware Save will hang a Playwright UI proof forever-until-timeout (M1 lesson).** `work-brief-e2e` first hung ~24 min because the spec edited the Engineer model to the value the `review_loop` template **already seeds** → the dirty-detection never enabled Save → the spec waited on a never-enabled button. Playwright's finite per-test timeout fired and the agent self-recovered. **When a `/goal`'s UI proof must enable a dirty-aware Save, change the field to a value KNOWN to differ from the seeded default** (and prefer `FORCE_REVISIONS=0` for a UI proof that doesn't need a real revision round; the API-side `*-check.py` proves the template runs on NIM).
- **The local adapter under-reports `files_changed`** (the M1 §15 caveat) — see §2. The file is written + committed but the adapter's before/after workspace snapshot comes back empty for the trivial greeting build. Don't trust `files_changed` from the local sandbox as ground truth.
- **Playwright MCP wedges on a large React Flow canvas:** `browser_snapshot` (the full accessibility tree) hangs on the editable canvas. For Claude Code self-sign-off, use **targeted `browser_evaluate` on specific selectors + screenshots**, or the **scripted headless-Playwright fallback** — NOT a whole-tree snapshot. Bake this into any visible-slice `/goal`.
- **React Flow needs jsdom shims under RTL** (`ResizeObserver`/`DOMMatrixReadOnly`/box-metrics/`getBBox`) or the canvas renders zero nodes — they live in `frontend/src/test/setup.ts`. And **user-event ⊥ vitest fake timers** — use `fireEvent` when the test drives virtual time.
- **`reviewerVerdictLabel` (in `frontend/src/lib/status.ts`) is pure + TOTAL** — it returns a neutral tone for any non-reviewer/null outcome, which is why M1's `LastRun` can reuse it for thinker (`prd_written`) / engineer (`built`) / null rounds without breaking. If you touch it, keep it total.
- **The two-loop-source lesson (P1.8d-fix1):** the editable canvas hung from TWO independent infinite loops — (A) a fresh `[]` `tasks` literal into a `TeamCanvas` effect dep, (B) `withLayout`'s longest-path BFS not terminating on a cyclic graph. **Reproduce-first** caught (B) after the architect's diagnosis found only (A). Lesson: **trace the called helpers, not just the top-level file, before declaring a sole root cause.** `topology.spec.ts` fails on any "Maximum update depth exceeded"/console error during authoring — keep that gate.
- **Eyeball/visual regressions slip past disk audits** (e.g. the P1.8b-1 vanished loop-back arc). For visible slices, lean on Claude Code's Playwright self-sign-off (screenshots) and, when a human check is needed, a detailed click-by-click script.
- **`team_run.py` is the most-protected file.** Its docstring is stale (`pm_step` still says "dispatched by `current == start_id`" though dispatch moved to the `pm_document_id is None` branch); the `pm_step`/`pm_document_id` PM-era names persist; `config.agent_kind` is unread; `REVIEW_VERDICT.json` keeps its reviewer-era name. The next legitimate `team_run.py` touch should refresh the docstring + do these cosmetic cleanups — but keep the slice focused (M1 correctly did NOT do them).

---

## 5. Pointers

- **`PROJECTPLAN.md`** — §1 (vision), §13 (the value-proven re-aim + S1–S3 buyer dead-zone), §15 (deferred register — all the named upgrades + the M2 linkage + the local-adapter `files_changed` caveat + the worker-brief enrichment + the P1.8d follow-ons), §17 (the append-only as-built/decision log; **the Tvashtr-30 work-brief entry is the latest**), §16 (milestones M1/M2/M3…). The header banner is the at-a-glance "where are we".
- **`prompts/`** — archived briefs (the M1 brief is `work-brief-run-view.md`; P1.8d is `p1.8d-topology-editing.md` + `p1.8d-fix1-authoring-render-loop.md`); `CLI-RULES.md` + `CLI-SETUP.md` are the agent's operating contract (note: `CLI-SETUP.md`'s init-prompt is STALE/P1.5c-era — write a fresh init prompt for each launch).
- **Project settings** — the rewritten Project Instructions (the working method, source of truth).

---

## 6. Your first move

Read this + the PROJECTPLAN §15/§17 + the header banner. Then confirm with the operator the next milestone — recommended: **Option A Milestone 2 (the authoring-panel brief + the `cloned_from_node_id` linkage — the converse-with-a-node Mode-A substrate)**, OR the local-adapter `files_changed` fix if the operator wants M1's worker brief made meaningful first. Present the design ONE decision at a time, each paired with its UX consequence, decided directly from the vision. Don't start work until you've read both docs. When you scope the `/goal`, hand the operator the full copyable launch package (shell + init prompt + `/goal`), and when it's verified + ready, give ALL the merge commands.
