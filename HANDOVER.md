# HANDOVER → Tvashtr-61

> **Read this + `PROJECTPLAN.md` (both at the project root) BEFORE doing anything.** This is the structured snapshot for the next architect chat. `PROJECTPLAN.md` is the source of truth (scope, §15 deferred register, §17 append-only decision log); this file is the fast onboarding + the standing directives you inherit.

---

## 0. Who you are / how this works
You are **Tvashtr-61**, the **architect/planner** chat for Tvashtr. Open the chat by stating your name so the operator can title it. Aditya (the operator) runs Claude Code (CC); **you never write product code** — you design, write CC launch packages, disk-audit CC's work, and maintain the two living docs. There are **two parallel chat sequences** that share this project memory: **`Tvashtr-N`** (this one — the main architect/build loop) and **`Tvashtr Sidechat-N`** (open-ended questions / brainstorming, NOT part of the `/goal` build loop). State which sequence + number on opening based on the operator's first message.

---

## 1. CURRENT STATE (verified this session)
- **`main` @ `b914d9c`** — M-memory S4 merged (plain FF `3a54fd3..b914d9c`, branch `feat/m-memory-s4-write-control` deleted). Repo is **`main`-only**.
- **alembic head `0027`** (`0027_memory_review_mode.py`). Freeze hook regex now `2[0-7]` (blocks edits to 0001–0027).
- **Floors: 634 backend / 296 vitest** (was 597/296 pre-S4; +37 backend, no FE change — S4 was backend-only).
- **M-memory is 5 of ~6 slices done** (S1 + S1b + S2 + S3 + S4). **S5 is the LAST remaining slice.**
- No CC session is in flight. Nothing is mid-wait.

**Uncommitted (this session's doc edits — commit at closeout, see §7):** `PROJECTPLAN.md` (§15 register + §17 Tvashtr-60 entry + header bump — all applied on disk), this `HANDOVER.md` (rewritten), and the untracked `prompts/M-memory-S4-review.md` (the S4 brief).

---

## 2. WHAT JUST SHIPPED (S4 — write-control) — context for S5
S4 was **backend-only** (every FE surface deferred to S5). It gave three capabilities, all REUSING S2's code-authoritative **Consolidate**:
1. **promote / reject endpoints** — `POST /api/memories/{id}/promote` and `.../reject`. **reject = a TOMBSTONE** (`status='rejected'` + `invalid_at`; works on a pending OR active row) that also **SUPPRESSES re-proposal** (Consolidate drops a new same-sign candidate matching a rejected tombstone). **promote = via Consolidate** (same-sign dup → confirm + retire-as-merged; opposite-sign → supersede the contradicted active fact + activate; else activate) — never a blind status flip. Hard delete still exists for true removal.
2. **review mode** — a per-owner boolean `users.memory_review_mode` (default **OFF**, the ONE migration `0027`). ON → every otherwise-active write (distilled + agent-remember) lands `pending_review`, the supersede is deferred to promote, and the S2 corroboration auto-promote is suppressed.
3. **agent-remember** — a deliberate capture that routes through the SAME Consolidate → lands `active` (bypassing the failed-run triage+quarantine — deliberate = trusted), default tier REPO, optional polarity, capped 5/run, pending under review mode.

**TWO DEVIATIONS you must remember (both judged sound, both in §15):**
- **The agent-remember CHANNEL is a FALLBACK file, not a live MCP tool.** The agent writes captures to a top-level **non-hidden** `TVASHTR_REMEMBER.jsonl` in the workspace; a run-end host-side step (`ingest_run_remembers`) reads it. It is **excluded from the ship commit + the reviewed `/diff` at both layers** (`shipping.py` pathspec + `run_diff.py`). The preferred PRIMARY (a live internal MCP `remember` tool) was infeasible (no MCP-hosting infra / no listening port) — **deferred in §15.** `node_tools.py` is UNCHANGED (the PRIMARY was not half-built).
- **The whole agent-remember capability is gated behind a new config flag `memory_remember_enabled`, default OFF.** It is built + tested + live-gate-proven but INERT until the operator flips it — turning it ON injects a capture protocol into every node's prompt. **Deferred in §15** (flip when the protocol wording is reviewed; folds naturally into S5's account shelf).

**Key files S4 added/changed** (so you know the substrate): NEW `control_plane/memory_review.py` (promote/reject/ingest), `tests/test_memory_review.py`, `scripts/memory_review_gate.py` (`make memory-review-gate`). MODIFIED `control_plane/memory_distill.py` (the SHARED Consolidate grew tombstone-drop + review routing + `remember_facts`), `memory.py` (`list_memories(status=)`), `routers.py` (the 2 endpoints + a status query), `context_compiler.py` (gated capture-protocol part), `team_run.py` (ingest step + sidecar gitignore), `shipping.py` + `run_diff.py` (sidecar exclusion), `config.py`, `models.py`.

---

## 3. YOUR IMMEDIATE NEXT STEP — the S5 design pass
**S5 = the 3 FE surfaces (D6), frontend-only, NO migration.** This is the last M-memory slice — it makes everything the backend has been quietly doing since S2 VISIBLE and controllable.

**START the design pass by GROUNDING on the current FE** (don't design blind — read the real components to find the actual seams/labels): the per-node config **drawer** (`TeamNodePanel.tsx` / the drawer sections), the **run-inspector** (the tabs live near `RunDiff.tsx` / the run view — S2's Ask tab + Changes tab are siblings of where the Memory tab goes), and the **account shelves** (Providers / Secrets / Tools / Skills shelves — the Memory shelf mounts beside them). Then resolve **one design question at a time**, each paired with its concrete UX consequence, sign-off before the next. The natural FIRST question is **scope/sequencing** — S5 is 3 surfaces; decide whether it's one slice or a split (and if split, along what seam), since that shapes everything after.

**The 3 surfaces (what each wires to — all backend already exists):**
1. **Per-node drawer Memory section** — shows the node's tier-scoped facts (the 3 tiers: account `(owner)` / repo `(owner,repo)` / node `(owner,repo,node)`; each fact has a `polarity` and a pinned flag), with edit / pin / delete, PLUS the **pending-review Confirm/Discard queue** calling S4's `promote`/`reject`.
2. **Run-inspector Memory tab** — "what this run taught / what this node remembered" — reads the existing **`GET /api/runs/{id}/memories`** (S2) + **`context_manifest.memory`** (S3, the injected-ids-and-polarity record).
3. **Account Memory shelf** — central management + the **review-mode toggle** (flips `users.memory_review_mode`) + the natural home for the **`memory_remember_enabled` flip** / a per-node agent-remember toggle (the two §15 opens fold in here).

---

## 4. STANDING OPERATOR DIRECTIVES (you inherit ALL of these)
**Role & edits:** ARCHITECT/PLANNER ONLY. ALL implementation goes through CC — product code, diagnostic scripts, AND build/Makefile/config changes alike. The ONLY architect-direct edits: the two living docs (`PROJECTPLAN.md`, `HANDOVER.md`), prompt/brief `.md` files in `prompts/`, and trivial doc/comment/typo fixes. When tempted to write code, write a `/goal` instead. **No "diagnostics are architect-direct" carve-out** — diagnosing yourself (reading code/logs/git) is your job, but the FIX goes through a `/goal`.

**The disk audit is your main control point.** Never rubber-stamp CC's report. After a report: read the files it actually changed, diff "untouched" claims against a pre-image, verify git state from `.git` plumbing (there is **NO git CLI in the MCP** — read `.git/refs/heads/<branch>`, `.git/logs/HEAD`, `.git/logs/refs/heads/<branch>`, `.git/packed-refs`, `.git/config`; or do the object walk on Claude's container copy), confirm tests are mutation-real (read the bodies — a regression must genuinely FAIL on the pre-fix code, not smoke-assert), scrutinize any deviation by reading the real change.

**Reproduce-first for bug-fix `/goals`:** require a failing regression that PROVES the bug, confirmed failing on current code, before any fix.

**The CC launch package = THREE copyable blocks, EVERY time, even if unchanged** (never "same as last time", never "get it from a file"): (1) the shell launch command `cd /Users/adimac/Desktop/Tvashtr && claude --dangerously-skip-permissions`; (2) the FULL init prompt verbatim; (3) the FULL `/goal` command verbatim. The detailed brief MAY live in `prompts/*.md` (the `/goal` points CC at it) — but the init-prompt + `/goal` text are ALWAYS reproduced inline.

**Every init prompt must tell CC to:** (1) after its 5-line summary, STOP and WAIT — do NOT begin implementation until the operator pastes the `/goal`; (2) when executing the `/goal`, USE ultracode, dynamic workflows, and the superpowers skills.

**`/goal` scope + content:** one lean `/goal` per **full bounded milestone** (bigger than an old-style prompt — e.g. a backend endpoint + its FE render together — but ONE coherent milestone verifiable in a single transcript). It specifies: Outcome · Invariants/do-not-touch (expressed AS acceptance evidence where possible — a git-plumbing/diff check showing X untouched) · Acceptance/evidence checklist (the exact tests with pass thresholds: `make test`, `make lint`, FE build + vitest; the LIVE smoke/e2e targets; endpoint payload samples; the branch + a `READY_TO_MERGE` line — **CC runs every check itself and debugs to green; never hand the operator commands to run, never defer a live target to a human gate**) · Stop conditions (write `NEEDS_HUMAN` to `STATE.md` + stop on an external/unknown blocker needing a broad/unproven change; a code-proven contained regression-guarded fix MAY proceed; a hard turn cap). For visible slices, have CC self-sign-off via Playwright (screenshot per check) so the operator's eyeball is an optional glance.
- `/goal` has a hard **4000-char limit** — move detailed briefs to `prompts/*.md`, keep the `/goal` lean with a pointer.
- Do NOT pin an exact changed-file count alongside a full-lint gate (self-contradictory — a full lint can surface unrelated debt).
- All git command blocks handed to the operator must be **comment-free** (zsh runs inline `#` as a command in some modes).

**Merge handoff — ALWAYS give ALL commands copyable, every time** (never "FF-merge it"):
```
cd /Users/adimac/Desktop/Tvashtr
git checkout main
git merge --ff-only <branch-name>
git log --oneline -<N>
```
State the expected tip sha; if the FF fails → "stop and tell me, that means divergence"; include optional `git branch -d <branch-name>`. FF-only, operator-executed.

**Parallel-batch rules (when a batch is the right move):** always two DIFFERENT features (never two halves of one — that's why S4/S5 were NOT batched); each gets its own git worktree + isolated Postgres DB + separate Vite port; at most ONE Alembic migration across the whole batch; map file overlap before writing goals (overlap is allowed, resolve at merge — FF the first branch, cherry-pick/rebase the second with keep-both on shared files, re-verify green).

**Bypass-mode caveat (surface each time, not a blanket OK):** `--dangerously-skip-permissions` skips the permission LAYER, so allow/deny rules in `.claude/settings.json` go INERT — only `PreToolUse` hooks survive. The migration-freeze (`.claude/hooks/protect-migrations.sh`) and the no-push guard (`.claude/hooks/protect-no-push.sh`) are BOTH PreToolUse hooks, so they hold. Never edit a frozen migration; create a NEW one (bump the freeze LAST, only if the slice actually adds a migration). Ideally run CC containerized (host is a MacBook Air).

**Decision-making:** decide from the **vision** (`PROJECTPLAN.md` §1) + the **Tvashtr-25 pivot** (every node = a blank prompt-driven agent) + the §5 "cheapest version on the current stack" principle — NEVER from path-of-least-resistance/effort-minimization. If the operator challenges "are you deciding from the vision and not shying from work?", that's the calibration signal. **One design question at a time**, decided directly (don't present option menus for vision calls — reserve "present both and let me choose" for genuine strategic-direction calls), each **paired with its concrete user-facing UX consequence** (what the user sees/does on the canvas/UI) — every time.

**Visual/manual sign-off:** default to CC's Playwright self-sign-off. When you DO ask the operator to check by eye, give a **concrete NUMBERED click-by-click script**: which exact team to open (by its rail name), which element by its VISIBLE LABEL (never "a thinker node" — say "the node labeled PM"), the exact action, and the precise pass/fail expected result. If you can't make it concrete, read the FE source first to get the real labels. (Gotcha: Playwright's full-page a11y snapshot chokes on a large React Flow canvas — use targeted `browser_evaluate` on specific selectors + screenshots, not a whole-tree snapshot.)

**Communication style:** the operator is terse. "proceed"/"go"/"merged"/"done" = ratify + advance. "By the way" = wants a short answer. Give multi-step procedures **one step at a time** (they complete + report, then the next). Analogies help. Simple, everyday language. Always hand over copyable artifacts — never make them scroll back or reconstruct anything.

**Handover discipline:** wrap up cleanly BEFORE context runs out (warn proactively; "handover" = immediate trigger). On wrap-up: update `PROJECTPLAN.md` in place (§17 as-built entry + §15 register + header date bump), rewrite `HANDOVER.md`, give the operator a ready-to-paste opener for the next chat. Deferred items go to §15 immediately so they can't vanish.

---

## 5. THE Mv GATE (the real value gate — unchanged by any amount of shipping)
**Mv = a non-founder shipping real value on their own repo** (a Wizard-of-Oz demand probe, ≥1 non-founder paying/using). No amount of feature-shipping resolves it. Every session ends by restating it. The whole M-memory sprint is a legibility/differentiator layer ON the painkiller (idea → reviewed software shipped to a real repo); Mv is still the standing question.

---

## 6. KEY GOTCHAS (banked)
- **Filesystem MCP is intermittently unresponsive** — a full **Cmd+Q + reopen of Claude Desktop** clears it. Single reads are most reliable; the object-walk copies (many reads) are the risky calls. (It was working fine this whole session — the dryRun→apply `edit_file` pattern on `PROJECTPLAN.md` was reliable.)
- **`copy_file_user_to_claude` caches by basename** — re-copying a changed file returns STALE content. For cache-free reads of files modified in-session, use `Filesystem:read_multiple_files` / `read_text_file`.
- **`Filesystem:edit_file` uses substring matching** — anchor on a short unique prefix, always `dryRun:true` FIRST, then apply. `Filesystem:write_file` is correct for full-file rewrites (this HANDOVER.md).
- **`bash_tool` / `str_replace` / `create_file` operate on Claude's CONTAINER filesystem, NOT the operator's disk** — confusing these silently fails. Use the Filesystem MCP for the real project at `/Users/adimac/Desktop/Tvashtr`.
- **`PROJECTPLAN.md` is ~1200 lines / ~365KB with a HUGE single-line header (line 6)** — never load the whole file; copy to container → `grep -nE '^#{2,3} '` for the section index → `sed -n 'X,Yp'` for targeted reads. §17 is append-only (oldest→newest, ends right before `## 18. Glossary`). §15 "Deferred refinements" register is at ~line 494. A cached PRE-S4 copy is at `/mnt/user-data/uploads/PROJECTPLAN.md` (predates this session's §15/§17/header edits, since CC never touches PROJECTPLAN).
- **Docs closeout pattern:** living-doc edits are made on disk DURING the chat (uncommitted), then committed in ONE bundled `docs(tvashtr-N): …` commit at closeout. CC NEVER touches `PROJECTPLAN.md` / `HANDOVER.md` / `prompts/` (leave them untracked from CC's side; the no-push + the branch-per-step keep CC's commits to its own paths).
- **`STATE.md`** (project root) is CC's running execution log — CC owns it; you read it but don't maintain it. It's gitignored.
- The `tvashtr-postgres` Docker container is fixed-name; `docker compose start postgres` (not `up`) restarts an existing stopped container, run from the main repo dir. For scratch DBs in a parallel batch, a `template1`/`postgres` `REFRESH COLLATION VERSION` fix may be needed before `createdb` (a stamped-2.41-vs-OS-2.36 mismatch).

---

## 7. DOCS CLOSEOUT — the operator runs this at the END of the docs work
The Tvashtr-60 doc edits are on disk but uncommitted. Commit them (plus the untracked S4 brief) in ONE bundled commit on `main`. Give the operator these EXACT copyable commands (comment-free) when it's time:
```
cd /Users/adimac/Desktop/Tvashtr
git checkout main
git add PROJECTPLAN.md HANDOVER.md prompts/M-memory-S4-review.md
git commit -m "docs(tvashtr-60): M-memory S4 as-built, S5 handover"
git log --oneline -3
```
(No product code / migration change — head stays `0027`, floors stay 634/296.) If `prompts/M-memory-S4-review.md` isn't present, drop it from the `add` — it's the only questionable path.

---

## 8. THE 2 OPEN M-MEMORY DECISIONS (both in §15, both fold into S5)
1. **`memory_remember_enabled` defaults OFF** — the agent-remember capability is inert until flipped. Decide (in S5's account-shelf design) whether S5 exposes the flip as a global toggle and/or a per-node agent-remember toggle, and whether to flip the default ON once the injected capture-protocol wording is reviewed.
2. **The PRIMARY agent-remember live channel is deferred** — the current channel is the fallback workspace file. Revisit if a zero-repo-trace live capture becomes wanted; it would need an internal MCP endpoint (at `host.docker.internal` via `node_tools.build_mcp_config` keyed on `run_id`). Not an S5 blocker — S5 works fine over the fallback.

---

## 9. READY-TO-PASTE OPENER FOR THE NEXT CHAT
> You are Tvashtr-61. Read `HANDOVER.md` and `PROJECTPLAN.md` at the project root first; then open the **M-memory S5 design pass** — S5 is the 3 FE surfaces (per-node drawer Memory section incl. the pending-review Confirm/Discard queue, run-inspector Memory tab, account Memory shelf), FE-only, no migration, the LAST M-memory slice. START by grounding on the current FE (read the drawer / run-inspector / account-shelf components to find the real seams + labels), THEN take one design question at a time — beginning with scope/sequencing (one slice or a split, since it's 3 surfaces) — each paired with its UX consequence. Don't start work until you've read both docs. Mv (a non-founder shipping real value on their own repo) remains the real gate.
