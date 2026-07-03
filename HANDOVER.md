# HANDOVER — Tvashtr-45 → Tvashtr-46

> Read this FIRST, then the named `PROJECTPLAN.md` sections, then the relevant source on disk — evidence before design. You are the **architect/planner**; all implementation goes through Claude Code.

---

## 0. First message for the next chat
> You are Tvashtr-46. Read `HANDOVER.md` and `PROJECTPLAN.md` at the project root first (HANDOVER first). Then pick up at **F2b** — hand the operator the F2b launch package (below), audit it on disk, FF-merge; then **F2-delete**, then **F2c**. Don't start work until you've read both.

---

## 1. Where we are RIGHT NOW
- **`main` @ `fa4370f`.** Alembic head **`0018`** (freeze `0001–0018` holds; NO migration this session). Floors on merged `main`: **331 backend** (was 328; +3 from the F2a template tests) / **193 vitest** (unchanged — no FE touched yet; note F2c will DELETE `TeamsRail.test.tsx`'s 5 tests + add its own, so re-baseline the vitest floor from a fresh `make test-frontend` at F2c start).
- **F2a is SHIPPED + FF-merged** (the New-team catalog is now four templates — see §2). **The whole M-frontend canvas overhaul + F4 landing were already on `main`** from Tvashtr-44.
- **Working tree:** `PROJECTPLAN.md` + `HANDOVER.md` are modified-uncommitted (this closeout), and there are **four untracked `prompts/*.md` briefs** I authored this session (`F2a-templates.md`, `F2b-teams-status-spend.md`, `F2-delete-teardown.md`, `F2c-dashboard.md`). **They need one commit** (command in §6). Nothing else is dirty; the F2a branch is deleted. `STATE.md` is tracked now (committed as part of F2a) — don't touch it (it's the CLI agent's log).

## 2. What Tvashtr-45 did
1. **Shipped F2a** (`main` @ `fa4370f`, off `6c2fdbb`): the New-team template catalog is a four-template ladder — `two_node`, `review_loop`, `plan_review` (NEW = `review_loop` + an Architect thinker), `full_squad` (NEW = `plan_review` + a `ship_approval` gate). `thinker_chain` dropped from the picker (its BUILDER kept byte-intact for the executor keystone `test_thinker_chain.py`). NO executor change, NO migration; backend floor 328 → 331. Full as-built in PROJECTPLAN §17 (2026-07-03 Tvashtr-45).
2. **Handled a correct NEEDS_HUMAN + re-hand.** The brief's mandated guard-grep caught that `test_capability_edit.py` creates teams via the `thinker_chain` KEY (a file my manual diagnosis had missed) → Claude Code halted clean (zero commits). I read all 5 tests, verified `plan_review` is a safe drop-in (same `pm`/`architect`/`engineer` roles by name; root-lock 409 still fires), authorized the re-point in the F2a brief §4, re-handed; the re-run finished green. **Lesson: the brief's guard-grep is what caught my miss — keep those greps in briefs.**
3. **Audited F2a on disk** (git plumbing + a byte-diff of `teams.py` vs a session pre-image proving the 3 existing builder bodies unchanged + the new builders' edges mirror `review_loop` line-for-line + both test re-points confined + the new test mutation-real + the merge stat confirming exactly 5 files) → gave the merge commands; operator FF-merged + deleted the branch.
4. **Fully DESIGNED + BRIEFED all of F2** (the dashboard) — see §3/§4 — and wrote the 3 remaining briefs.
5. **Docs closeout** (this file + PROJECTPLAN §17/§15/header).

## 3. IMMEDIATE NEXT STEP — hand F2b, audit, merge; then F2-delete, then F2c
The M-frontend ordering: F0✅ → F1a✅ → F1b✅ → F1c✅ → (canvas fidelity 1–2✅) → F4 landing✅ → **F2 (now split F2a✅ → F2b → F2-delete → F2c)** → F3 (auth wizard) → any F4-polish.

**F2 is one dashboard milestone split into 4 sub-slices, STRICTLY SEQUENTIAL** (all touch the teams path — `teams.py`/`routers.py`/`test_team_library.py` — so a parallel session would collide; that's why they can't parallelize). F2a is done. The 3 remaining are fully briefed:
- **F2b** — `prompts/F2b-teams-status-spend.md` — backend: enrich `GET /api/teams` so each team summary carries `last_run: {status, at, run_id} | null` + `spend_usd` (lifetime total), via the existing `cloned_from_node_id` clone→origin join (mirror `_latest_invocation_by_origin`). Read-only, NO migration.
- **F2-delete** — `prompts/F2-delete-teardown.md` — backend: make `DELETE /api/teams/{id}` first CANCEL any in-flight run of the team (reuse the `cancel_run` core), then hard-delete the team AND its runs (run rows + run-scoped records + clone snapshots — the run-scoped tables link by a text `run_id`, no FK cascade → an ordered multi-table delete). Reproduce-first: a delete-mid-run test proving the run stops + everything's gone. NO migration.
- **F2c** — `prompts/F2c-dashboard.md` — FE: reskin `Dashboard.tsx` to `design/Tvashtr Frontend Overhaul/Dashboard.dc.html` — the **single unified teams table** (Team · Nodes · Status · Spend · Created · open · delete), the **template picker** on New team (Blank + the 4 catalog templates from `getTemplates()`), the **delete confirm** (stops-run warning), the **stat strip** (Teams · Active runs · Total spend, all real), reskinned providers, **delete `TeamsRail.tsx`/`TeamsRail.test.tsx`**, and the **status-pill overflow RIDER** (`flex-wrap: wrap` on `.rf-node__meta` in `canvas.css`). `api.ts` ADDITIVE-only (2 fields on `TeamSummary`); NO backend change; NO migration.

**The F2b launch package is ready in §8 below — hand it, wait for the report, audit, merge.**

## 4. The F2 design decisions (LOCKED this session — do NOT re-litigate)
All ratified by the operator. Grounded in §1 vision ("the team is mine"; the template library is a drop-and-edit scaffold) + the operator's model **"a run is a team that ran."**
1. **New-team template picker** — clicking New team opens a warm pop-up (F1c's pop-up language) with a name field + five starting-point cards: a **Blank** card the FE adds (→ `createTeam("blank", name)`; the backend already treats `"blank"` specially) + the four catalog templates (name + description from `getTemplates()`). Create → lands on the canvas in authoring mode.
2. **ONE unified teams table** (the operator OVERRODE a two-table proposal) — each library team shows its **latest run's status** (Running / Awaiting you / Completed / Failed / Stopped / Over budget, or "Not run yet") + its **lifetime total spend**. NO separate runs table. This needs the F2b backend enrichment (the FE can't link runs→teams alone: `RunSummary` has no team id or cost, and a run points at the CLONE snapshot, not the library team). Status = latest run; spend = sum across all the team's runs.
3. **Delete STOPS + REMOVES** — the operator was emphatic ("a deleted team that keeps running is nonsense; remove it from existence even if running"). So delete cancels any in-flight run, then removes the team + its runs. This SUPERSEDES the old "delete leaves runs untouched, no run orphaned" endpoint behavior (that docstring is now obsolete). The confirm pop-up names the team + warns if a run is in progress.
- **§15 deferred (added):** an explicit `runs.source_team_graph_id` FK (the clean run→library-team link, for when a migration window opens; F2b reconstructs it via the join meanwhile); a per-run history drill-down from a team row (single-table shows only the latest run).

## 5. Standing operator directives (CARRY FORWARD — inherited every session)
- **Role = architect/planner ONLY.** All implementation (product code, diagnostic/throwaway scripts, build/Makefile/config) goes through a Claude Code `/goal`. Architect-direct edits are ONLY: the two living docs, `prompts/*.md` briefs, and trivial doc/typo fixes. When tempted to write code, write a `/goal`.
- **The disk audit is the main control point.** Never trust the self-report — read the changed files, diff "untouched" claims against pre-images stashed to `/tmp/`, read test bodies to confirm they're mutation-real. **The brief's guard-greps catch what your manual diagnosis misses — keep them in.** The **merge stat** (`git show --stat` / the FF output) is a free confirmation of the exact changed-file set (→ the byte-intact set by omission).
- **No `git` CLI in the MCP** — reconstruct git state from `.git` plumbing: `.git/refs/heads/<branch>` (tip SHA; note a `feat/x` branch's ref is at `.git/refs/heads/feat/x`), `.git/logs/refs/heads/<branch>` (reflog → parent chain + FF-ability + nothing-pushed). Operator is your git-CLI proxy for a diff you can't compute.
- **The copy-cache gotcha:** `copy_file_user_to_claude` caches by basename — a 2nd copy of a file you already copied may return the STALE version. Detect via line-count vs a stashed pre-image (a CHANGED file will differ; for an EXPECTED-unchanged file the line-count test is ambiguous → read it via `Filesystem:read_text_file`, which is cache-free). `Filesystem:read_text_file` **ignores `view_range`** and returns the whole file — fine for small files.
- **`Filesystem:edit_file` for operator-disk edits** (NOT `str_replace`, which writes to Claude's container only) — always `dryRun:true` first with unique multi-line anchors; the apply diff is the authoritative verifier. `Filesystem:write_file` overwrites the whole file.
- **Merges: operator FF-merges** (`git merge --ff-only`). ALWAYS give ALL merge commands as copyable text (cd, checkout, merge, verify line + expected SHA, what-if-it-fails, branch cleanup). The 3 remaining F2 slices are simple FFs (each branches off the prior merged tip).
- **Every Claude Code handoff = the COMPLETE copyable launch package, every time** (even if unchanged): (1) `cd /Users/adimac/Desktop/Tvashtr && claude --dangerously-skip-permissions`, (2) the FULL init prompt verbatim, (3) the FULL `/goal` verbatim. NEVER "same as before"; NEVER point them at a `prompts/` file for the init/`/goal` text. The detailed BRIEF lives in `prompts/<n>.md` (the `/goal` references it) — the init + `/goal` text are always inline.
- **`/goal` = one bounded milestone**: outcome + invariants-as-on-disk-evidence + the acceptance checklist CC runs ITSELF to green (make test/lint, FE build+vitest, live smoke, Playwright self-sign-off with a screenshot per check) + reproduce-first for bug-fixes + stop conditions (NEEDS_HUMAN + turn cap; distinguish "unknown/broad → stop" from "code-proven contained fix → proceed"). CC runs ALL verification — never hand the operator manual commands, never defer a live target.
- **Design decisions: from the vision (§1) + the Tvashtr-25 pivot, never from effort. One at a time, explicit sign-off before the next. No option menus for vision calls — decide. Pair EVERY decision with its concrete user-facing UX consequence.** (The operator overrode a two-table dashboard + demanded delete-stops-runs — both times the vision-grounded call was the bigger, more-correct one, not the easier one.)
- **Deferred items → §15 register IMMEDIATELY** (with the decision that deferred them).
- **Visual sign-off = a concrete, NUMBERED, click-by-click script** (name the exact team by rail label + the exact node by VISIBLE label + the exact action + explicit pass/fail). Default to CC's Playwright self-sign-off with screenshots; the operator eyeball is the backstop.
- **Bypass mode caveat** (`--dangerously-skip-permissions`): allow/deny rules go INERT — only PreToolUse hooks survive. `protect-migrations.sh` (freeze) + `protect-no-push.sh` (no-push) are BOTH hooks, so they hold. The agent NEVER pushes; commits only its OWN changed paths (leaves the living docs + `prompts/*.md` uncommitted for the architect).
- **Communication (operator preferences):** terse — "proceed"/"go"/"merged"/"done" (and running the merge itself) = ratify + move on; "By the way" wants a short answer. **Procedures ONE step at a time.** **Analogies help. Simple, everyday language — avoid jargon.** Always hand copyable artifacts; never make them scroll back or reconstruct.
- **Session hygiene:** watch context; wrap up cleanly BEFORE running out (warn proactively). This session hit a natural handover at the F2a-merged boundary rather than gamble on one more audit cycle. "handover" from the operator is an immediate trigger. Close out = PROJECTPLAN (§17 + §15 + header) then a full HANDOVER rewrite then the ready-to-paste opener.

## 6. Gotchas & tools
- **Commit the docs closeout + the F2 briefs** (the only dirty state):
  ```
  cd /Users/adimac/Desktop/Tvashtr
  git add PROJECTPLAN.md HANDOVER.md prompts/F2a-templates.md prompts/F2b-teams-status-spend.md prompts/F2-delete-teardown.md prompts/F2c-dashboard.md
  git commit -m "docs(tvashtr-45): F2a shipped; F2 designed (unified teams table) + F2b/F2-delete/F2c briefs; handover to Tvashtr-46"
  ```
  (The deep-dive `.md` files + `design/` stay untracked, as they were.)
- **PROJECTPLAN.md is ~230KB / ~870 lines.** NEVER read it whole. Copy it (`copy_file_user_to_claude`) → `grep -nE '^#{1,3} '` for a header index → `sed -n 'A,Bp'` targeted reads. Key sections: §1 vision, §6.4 the human-authored-graph constitution, §14 features, **§15 roadmap + deferred register**, §16 milestones, **§17 append-only as-built log**, §18 glossary.
- **`Filesystem:read_multiple_files` can hang (~4 min).** Prefer individual reads / copies.
- **`create_file`/`bash_tool` write to Claude's CONTAINER only** (invisible to the operator). ALL operator-disk writes use `Filesystem:write_file` (overwrite) or `Filesystem:edit_file`.
- **The seeded dev team is "My team"** = the `review_loop` template: visible node labels **Product manager** (entry), **Engineer**, **Reviewer** (workers), **PRD approval** + **Escalation** (gates), **Ship** + **Stop** (terminals). Bring-up: `make db-up && make migrate && make seed && make backend` + `make frontend` (Vite :5173); login `operator@tvashtr.local` / `tvashtr-dev`.
- **Backend key facts for F2b/F2-delete** (verified this session): the team-summary is built by `_team_summary`/`list_library_teams` in `teams.py` (F2b edits these). `DELETE /api/teams/{id}` currently just cascades nodes/edges (F2-delete rewrites it). The run→team link is per-NODE (`AgentNode.cloned_from_node_id`), NOT a direct FK; `_latest_invocation_by_origin` in `routers.py` already does this clone→origin join. The cancel core is in `cancel_run` (`routers.py`): `DBOS.cancel_workflow(run_id)` + `UPDATE runs SET status='cancelled'` + close pending `HumanTask`s. Run-scoped tables (`cost_records`, `run_events`, `agent_invocations`, `human_tasks`, `engineer_run_attempts`) link by a TEXT `run_id` (no FK cascade); `runs.team_graph_id` (the clone) has no cascade either.
- **Tools:** Filesystem MCP (operator disk), `bash_tool` (container-only, for files copied into `/mnt/user-data/uploads/`), Playwright MCP (automated UI/E2E inside a `/goal`), the `/tvashtr-loop` skill. Briefs: `prompts/CLI-RULES.md` + `prompts/CLI-SETUP.md` (operating contracts).
- **Deferred behind the frontend wall** (do NOT start until M-frontend is done): the Sidechat-4 deep-dive milestones **M-ctx0 → M-ctx1 → M-ledger → M-tools → M-rails** (migrations `0019–0021`, freeze-bumped last), and the **brownfield stronger-worker thesis re-run** (DEFERRED, NOT queued). **Mv (a non-founder shipping real value on their own repo) remains the real demand gate.**

## 7. Open questions / to-confirm
- **F2c vitest floor** — re-baseline from a fresh `make test-frontend` at F2c start (TeamsRail's 5 tests are removed + new dashboard/picker/delete tests added).
- **F2-delete concurrency** — the brief handles cancel-then-delete ordering + a reproduce-first delete-mid-run test; watch that CC doesn't hit a DBOS race it can't contain (its stop condition covers it → NEEDS_HUMAN).
- **F2c greeting** — the mockup uses a first name ("Ava"); we only have email. The brief lets CC derive a friendly handle from the email or use a generic greeting (no new PII).

## 8. F2b launch package (READY — hand this after the docs closeout commit)

**1 — Shell launch:**
```
cd /Users/adimac/Desktop/Tvashtr && claude --dangerously-skip-permissions
```

**2 — Init prompt** (paste first; eyeball the 5-line summary before the `/goal`):
```
Read and internalize, in order:
  /Users/adimac/Desktop/Tvashtr/prompts/CLI-RULES.md   (your operating contract)
  /Users/adimac/Desktop/Tvashtr/HANDOVER.md
  /Users/adimac/Desktop/Tvashtr/PROJECTPLAN.md   (sections 6, 15, 16, 17 - the rest is background)
Then read, as the working context for THIS milestone:
  /Users/adimac/Desktop/Tvashtr/prompts/F2b-teams-status-spend.md   (the brief - follow it exactly)
  /Users/adimac/Desktop/Tvashtr/backend/tvashtr/control_plane/teams.py
  /Users/adimac/Desktop/Tvashtr/backend/tvashtr/routers.py
  /Users/adimac/Desktop/Tvashtr/backend/tests/test_team_library.py

This session is launched with --dangerously-skip-permissions (bypass): the allow/deny lists go INERT, so ONLY the PreToolUse hooks are enforcing - the migration-freeze + no-push guards both still hold. You will NOT push (the operator merges). Commit ONLY the paths this milestone changes; do NOT touch or commit the living docs (PROJECTPLAN.md, HANDOVER.md) or any prompts/*.md.

This is a BACKEND-ONLY, READ-ONLY milestone: NO Alembic migration (head stays 0018), NO change under frontend/, and the executor (team_run.py) + graph_validity.py stay byte-intact. The change is confined to the team-summary path (_team_summary / list_library_teams in teams.py) + new tests.

After reading, output a 5-line summary and then STOP (implement nothing yet): (1) the milestone in one line; (2) the do-not-touch set you'll keep byte-intact; (3) your first concrete action; (4) the branch you'll create; (5) confirmation you must echo every acceptance evidence line into the chat.
```

**3 — The `/goal`** (paste second):
```
/goal Follow prompts/F2b-teams-status-spend.md exactly. Outcome: enrich GET /api/teams so each library-team summary ALSO carries last_run ({status, at, run_id} | null, the most recent run across all clones of the team by created_at) and spend_usd (the SUM of runs.cost_total_usd, NULL as 0, across all the team's runs) - computed via the existing cloned_from_node_id clone->origin link (mirror _latest_invocation_by_origin's join). Do it in the shared summary builder (_team_summary / list_library_teams in teams.py) so list + create + seed all return the enriched shape; owner-scoped + library-only (no other team's or account's runs leak in); batched, no N+1; de-dup the run join fan-out. Invariants (must show on disk): NO migration (alembic head stays 0018; nothing under backend/alembic/); NO change under frontend/; git diff main -- backend/tvashtr/control_plane/team_run.py backend/tvashtr/control_plane/graph_validity.py is EMPTY; only SELECTs (no writes/new columns); the teams.py diff is confined to _team_summary (+ a private join helper). Tests (build runs via the REAL clone path - reuse the actual clone helper + insert a Run pointing at the clone with a status + cost_total_usd + a few real run-scoped rows - not a faked shortcut): (a) never-run team -> last_run null, spend_usd 0; (b) one run (status S, cost C) -> last_run.status==S, run_id matches, spend_usd==C; (c) multiple runs -> last_run is the most recent by created_at, spend_usd == the SUM (NULL cost as 0); (d) isolation -> a second team's runs + a second owner's runs never appear; (e) GET /api/teams returns each team with last_run + spend_usd. Acceptance - run every check yourself and echo each into the chat: (1) make test all green, report the new pass count (was 331); (2) make lint clean; (3) echo the GET /api/teams payload for an account with one RUN team + one never-run team, showing last_run populated on the first + null on the second + the spend numbers; (4) echo the empty diffs for team_run.py + graph_validity.py + the scoped teams.py diff; (5) branch feat/f2b-teams-status-spend + a READY_TO_MERGE line. Stop conditions: if enriching the summary seems to need a NEW column/migration or any executor/builder edit -> write NEEDS_HUMAN to STATE.md with specifics and STOP (it should NOT - the link is the existing cloned_from_node_id). Hard cap 30 turns.
```
