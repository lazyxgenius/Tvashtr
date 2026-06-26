# HANDOVER — for Tvashtr-32

> A structured snapshot for the next architect/planner chat. Read this **and** the relevant `PROJECTPLAN.md` sections (the header banner, §1 + the "strategic direction", §13 S3/S4, §15 Phase 1.5 + the deferred register, §16, and the **2026-06-26 §17 strategic-pivot entry**) before taking any action. STATE.md is the CLI agent's own execution log.

---

## 0. Read-me-first / how we work (the standing operator directives)

You are the **architect/planner** — you design, scope, write the `/goal` (or a detailed `prompts/*.md` brief), hand the operator a complete copyable launch package, and **audit on disk**. Claude Code (the CLI agent, launched with `--dangerously-skip-permissions`) does ALL implementation. Your only direct edits: the two living docs (`PROJECTPLAN.md`, `HANDOVER.md`), `prompts/*.md`, and trivial fixes.

**The three operator directives locked into memory — honor them EVERY time, no exceptions:**
1. **Copyable launch package, every time.** Whenever anything goes to Claude Code, paste the COMPLETE copyable text inline — (1) the shell launch command (`cd /Users/adimac/Desktop/Tvashtr && claude --dangerously-skip-permissions`), (2) the FULL init prompt verbatim, (3) the FULL `/goal` command verbatim — every single time, even if unchanged. NEVER say "the same as before", NEVER refer back, NEVER tell the operator to fetch the init-prompt/`/goal` text from `prompts/` or anywhere. (The detailed brief MAY live in `prompts/*.md` and the `/goal` references it — but the init-prompt and `/goal` TEXT are always reproduced inline.)
2. **Detailed visual sign-off.** Whenever you ask the operator for a visual/manual check, give a concrete, NUMBERED, click-by-click script: which exact team/screen to open first, which node **by its visible label** (never "a thinker" — "the node labeled PM"), exactly where to click/drag FROM and TO, what to type, and the precise expected pass/fail. Never an abstract checklist that assumes the operator knows node types/kinds or how to drive React Flow. If you don't know the live labels, read the FE source first.
3. **All merge commands, every time.** Whenever a merge is called for, give ALL the commands as copyable text (`cd`, `git checkout main`, `git merge --ff-only <branch>`, the verify line + expected tip sha, optional `git branch -d`). Never just "FF-merge it".

**Plus the standing decision discipline:** make every architecture/design/scoping call **directly from the §1 vision + the Tvashtr-25 pivot — never from effort-minimization** (when the operator asks "are you deciding from the vision and not shying from work?", that's the calibration signal); surface ONE design question at a time and decide it (don't present option menus for vision calls); and **pair every decision with its concrete user-facing UX consequence** (what the user sees/does on the canvas). The operator communicates tersely ("proceed"/"go"/"merged"/"done" = ratify + go; "by the way" = short answer). Analogies help.

**The Project Instructions are the source of truth for working method** (they encode all of the above plus the disk-audit-against-pre-images discipline, the Playwright self-sign-off model, reproduce-first, and the stop-clause wording). This §0 is the quick version.

---

## 1. Where we are (state of `main`)

- **`main` is at `5f65904`.** Option A **Milestone 2 — the authoring-panel per-node work-brief — is MERGED** (clean FF; branch `feat/m2-authoring-brief-linkage` can be `-d`'d if not already). Alembic head **`0014`** (migration `0014` added `agent_nodes.cloned_from_node_id`).
- **What M2 shipped:** a new **`cloned_from_node_id`** column on `agent_nodes` (nullable, **no FK** — authored nodes are deletable, so a dangling clone-ref simply matches nothing; indexed, plus a new index on the previously-unindexed `agent_invocations.node_id`), set by `clone_team_graph` so each run-clone node points back to its origin authored node. The authoring `GET /api/teams/{id}/graph` now eager-loads each authored node's **latest invocation across ALL of the team's runs** (`DISTINCT ON (cloned_from_node_id) … ORDER BY started_at DESC` — survives a later run that skipped a node) and surfaces the per-node "last run" brief in `TeamNodePanel` alongside prompt/model/capability. The run-view `GET /api/runs/{id}/graph` is **untouched**; the shared **`LastRun.tsx`** component was extracted (run-view rendering byte-identical to M1). **This is the converse-with-a-node Mode-A substrate.**
- **The pivot is realized end-to-end and legible both ways:** prompt-driven nodes (P1.8a), prompt/model editing + the team library (P1.8b), capability/thinker authoring (P1.8c), topology authoring (P1.8d), per-node run-legibility in the **run view** (M1) and now the **authoring view** (M2). The J2 "author your own wiring" differentiator is shipped; "what did this node do" is legible where you tune it.
- **Brief:** `prompts/m2-authoring-brief-linkage.md` (commit it in the docs closeout if it's still untracked). The CLI agent typically leaves STATE.md + the prompt untracked after a merge.

---

## 2. Immediate next step — the STRATEGIC PIVOT: spec the brownfield "work on a real local folder" run mode (M-brownfield)

**This session (Tvashtr-31) decided a strategic pivot — read the 2026-06-26 §17 entry + §1 "strategic direction" + §15 Phase 1.5 first.** In short: the next strategic bet is **local execution → brownfield** — Tvashtr runs locally and ships a *reviewed* feature into the user's **real existing repo**, built as the **cheapest version on the current stack** (run the stack locally + mount the user's chosen folder as the agent workspace), **NOT** a native-desktop re-platform and **NOT** local-LLMs-as-a-pillar. **The operator's overriding stance is build-first:** *no demand validation is sought until a real feature-shipping Tvashtr exists* (a half-working brownfield probe would fail on the hard case and produce a false "no").

**The milestone (M-brownfield):** a composed, human-steered team ships a **correct, reviewed, shippable** feature into a real existing repo, run locally — with per-node legibility + live document steering intact. This is the new near-term gate that *precedes* validation.

**Where the difficulty actually is — say this plainly when you scope it:** the hard part is **correctness on existing code**, NOT the repo-mounting plumbing (that's the easy half). Existing-repo agentic coding is the 41–87% multi-agent-failure zone on the hardest case; the proven greenfield setup (`llama-3.3-70b` on NIM) may not clear that bar as-is. The real content of the milestone is *making* it clear that bar — model choice, context handling, the review gate actually catching breakage.

**Your FIRST action before designing the mount:** read how the current run wires the agent workspace — the **ephemeral-clone path** — so the "mount a real repo instead" design is grounded in what's on disk, not assumed. Trace: `clone_team_graph` (clones the team for the run), `team_run.py` (the run workflow — how the workspace dir is created/passed), and the OpenHands adapter's workspace setup (`openhands_adapter.py` local + `openhands_docker_adapter.py` docker, incl. `_push_workspace`/`_pull_workspace`). Understand where `.tvashtr_workspaces/<run_id>/` is rooted and how the agent's working dir is set, THEN design the "point the workspace at the user's real folder + ship to a real branch" change.

**Scope discipline (S4):** keep this bet BOUNDED — the smallest feature-shipping version on the current stack, weeks not a re-platform. Local-model (Ollama via LiteLLM) is a near-free *option* in the model selector with **zero milestone scope** — do not let it grow into the milestone.

**Smaller alternatives if the operator reprioritizes (all in §15):** the local-adapter `files_changed` fix is now **low priority** — M2 confirmed the **docker** adapter (the product default) DOES populate `files_changed` via `_pull_workspace`; only the LOCAL sandbox's snapshot returns empty, so the hollow worker brief is a `local`-dev-smoke-only cosmetic gap. Other registered options: M3 mid-run prompt re-read (→ converse-with-a-node Mode B); the `deriveNodeStatus` "never-reached node reads Failed" fix (operator-flagged); the cosmetic renames (`pm_step`→generic, `REVIEW_VERDICT.json`→`OUTCOME.json`, drop `config.agent_kind`); P1.9 (swap the local-workspace ship for a real-repo PR — note this overlaps the brownfield ship target, so sequence it with M-brownfield).

**The real value gate (standing, now explicitly gated):** the Wizard-of-Oz demand probe (≥1 non-founder user validating willingness to pay) is **deliberately deferred behind M-brownfield** per the build-first stance — but it remains the gate that ultimately matters (§13 S1/S4). Don't let "build first" quietly become "never validate".

---

## 3. Key facts / environment

- **Proven OpenHands agent model:** `nvidia_nim/meta/llama-3.3-70b-instruct` (set via `.env TVASHTR_AGENT_MODEL`; ~1.4s/call; ships live gates cleanly). `qwen3-next-80b-a3b-instruct` is **parked** (~40% `TextContent is not JSON serializable` flake — a serialization bug in the OpenHands/LiteLLM path, not auth/quota).
- **`DEFAULT_MODEL`** (PM/completion knob, distinct from the agent knob) **must be a non-reasoning instruct model** (`openai/gpt-4o-mini`) — a reasoning model there silently returns an EMPTY PRD.
- **Migration freeze:** `protect-migrations.sh` (a PreToolUse hook, survives bypass) freezes the existing set; head is now **`0014`** (regex should now cover `0001`–`0014`, i.e. `^00(0[1-9]|1[0-4])_`). Add a NEW migration, never edit a frozen one — and **bump the regex as the last step if you add one** (a brownfield run-mode column/table would be `0015`).
- **No-push guard:** `protect-no-push.sh` is a **PreToolUse(Bash) hook** (a `permissions.deny` rule does NOT survive `--dangerously-skip-permissions` — only hooks do). The agent never pushes; the operator merges.
- **No `git` tool in the MCP.** Reconstruct git state from `.git` plumbing (`refs/heads/<branch>`, `logs/HEAD`, the branch reflog `logs/refs/heads/<branch>`). Verify "untouched/byte-intact" claims by diffing the post-run file against a **pre-image you copy before the run** — and **don't overwrite your pre-image** (copy pre-images to a distinct path like `/tmp/pre/` first; the M1 audit lost `team_run.py`'s pre-image to a copy-tool basename collision). `/mnt/user-data/uploads/` is **read-only** in the container; bash writes must go to `/tmp` or `/home/claude`. The operator's `git diff --stat main <branch>` is the authoritative file-set gate.
- **Stack:** Python 3.12 / FastAPI / DBOS Transact / SQLAlchemy 2 + Alembic / Postgres 16; React 19 / Vite 7 / TS 5.6 / React Flow / vitest 3; LiteLLM proxy + OpenHands SDK + NVIDIA NIM. Project root `/Users/adimac/Desktop/Tvashtr` (capital T load-bearing). Host = a MacBook Air (run bypass containerized when practical).
- **The two adapters (load-bearing for the brownfield mount):** `openhands_adapter.py` (LOCAL sandbox; empty `files_changed` on the greeting via its before/after snapshot — dev-only gap) and `openhands_docker_adapter.py` (the product default; populates `files_changed` via `_pull_workspace`, and `_push_workspace` seeds the container per-iteration). The docker path is where the real run lives.

---

## 4. Gotchas (not all in PROJECTPLAN)

- **A disabled dirty-aware Save will hang a Playwright UI proof forever-until-timeout (M1 lesson).** If a `/goal`'s UI proof must enable a dirty-aware Save, change the field to a value KNOWN to differ from the seeded default (and prefer `FORCE_REVISIONS=0` for a UI proof that doesn't need a real revision round; an API-side `*-check.py` proves the template runs on NIM).
- **The local adapter under-reports `files_changed`** (now known to be LOCAL-only — the docker default is fine). Don't trust `files_changed` from the local sandbox as ground truth.
- **Playwright MCP wedges on a large React Flow canvas:** `browser_snapshot` (the full accessibility tree) hangs on the editable canvas. For Claude Code self-sign-off use **targeted `browser_evaluate` on specific selectors + screenshots**, or the scripted headless-Playwright fallback — NOT a whole-tree snapshot. Bake this into any visible-slice `/goal`.
- **React Flow needs jsdom shims under RTL** (`ResizeObserver`/`DOMMatrixReadOnly`/box-metrics/`getBBox`) or the canvas renders zero nodes — they live in `frontend/src/test/setup.ts`. And **user-event ⊥ vitest fake timers** — use `fireEvent` when the test drives virtual time.
- **`reviewerVerdictLabel` (in `frontend/src/lib/status.ts`) is pure + TOTAL** — it returns a neutral tone for any non-reviewer/null outcome, which is why `LastRun` reuses it for thinker/engineer/null rounds. If you touch it, keep it total.
- **The two-loop-source lesson (P1.8d-fix1):** the editable canvas once hung from TWO independent infinite loops — a fresh `[]` literal into a `TeamCanvas` effect dep AND `withLayout`'s longest-path BFS not terminating on a cyclic graph. **Reproduce-first** caught the second after the diagnosis found only the first. Lesson: **trace the called helpers, not just the top-level file, before declaring a sole root cause.** `topology.spec.ts` fails on any "Maximum update depth exceeded"/console error during authoring — keep that gate.
- **Eyeball/visual regressions slip past disk audits** (e.g. the P1.8b-1 vanished loop-back arc). For visible slices, lean on Claude Code's Playwright self-sign-off (screenshots) and, when a human check is needed, a detailed click-by-click script.
- **`team_run.py` is the most-protected file.** Its docstring is stale (`pm_step` still says "dispatched by `current == start_id`" though dispatch moved to the `pm_document_id is None` branch); the `pm_step`/`pm_document_id` PM-era names persist; `config.agent_kind` is unread; `REVIEW_VERDICT.json` keeps its reviewer-era name. The next legitimate `team_run.py` touch (the brownfield run-mode work will touch the workspace wiring here) is the natural moment to refresh the docstring + do these cosmetic cleanups — but keep the slice focused.

---

## 5. Pointers

- **`PROJECTPLAN.md` (compressed this session — 433KB→84KB, an 81% audit; durable §0–§12 unchanged):** §1 (vision + the **"strategic direction"** = brownfield/local-execution + the honest "positioning vs neighbors"); §13 (the strategic risks — **S3 confirmed/widened**, **S4 build-first discipline**); §15 (**Phase 1.5 — Brownfield/local execution** = the active bet, + the **deferred register**, now open-items-only — all named upgrades preserved); §16 (**M-brownfield** the active gate, Mv re-gated behind it); §17 (the **2026-06-26 strategic-pivot entry in full** + the compressed durable-decision log T1→T31). The header banner is the at-a-glance "where are we".
- **`prompts/`** — archived briefs (M2 = `m2-authoring-brief-linkage.md`; M1 = `work-brief-run-view.md`; P1.8d = `p1.8d-topology-editing.md` + `p1.8d-fix1-authoring-render-loop.md`); `CLI-RULES.md` + `CLI-SETUP.md` are the agent's operating contract (**note: `CLI-SETUP.md`'s init-prompt is STALE/P1.5c-era — always write a FRESH init prompt for each launch**).
- **Project settings** — the Project Instructions (the working method, source of truth).

---

## 6. Your first move

Read this + the PROJECTPLAN sections named in §5 (especially the 2026-06-26 §17 entry + §1 strategic direction + §15 Phase 1.5) + the header banner. Then confirm with the operator that the next milestone is **M-brownfield — the "work on a real local folder" run mode** (or hear a reprioritization). **Before designing**, read the ephemeral-clone workspace-wiring path (`clone_team_graph` → `team_run.py` → the OpenHands adapters' workspace setup) so the mount design is grounded on disk. Present the design ONE decision at a time, each paired with its UX consequence, decided directly from the vision — and be clear that the hard part is correctness on existing code, not the mounting. Don't start work until you've read both docs. When you scope the `/goal`, hand the operator the full copyable launch package (shell + init prompt + `/goal`), and when it's verified + ready, give ALL the merge commands.
