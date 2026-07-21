# HANDOVER — for Tvashtr-80

> Read this **and** `PROJECTPLAN.md` (§1 vision, §15 register, §17 log) before doing anything. You are the ARCHITECT/PLANNER; ALL implementation goes through a Claude Code `/goal`. The disk audit is your control point.

---

## §1 — Where we are

- **`main` @ `f15c357`** (the Tvashtr-79 `--no-ff` merge; parents S1 `0baea5a` + S2 `64c8092`). Working tree CLEAN except the uncommitted doc-closeout (§2).
- **alembic head `0031`** (`0031_run_artifacts`). Floors: **1091 backend / 403 vitest**; lint + build clean.
- **LIVE at `tvashtr.fly.dev`** (2 Fly machines, suspend-when-idle). Hosted GitHub App integration live (`TVASHTR_HOSTED_MODE=true`).
- **Just shipped (Tvashtr-79):** a parallel 2-session batch closing §15 items **5** (condenser events → `run_events`), **6** (greenfield-workspace retention = persist-then-reap, mig `0031`), **7** (mid-run provider failover). Item **4** (the `test_auth` flake) was DROPPED — the disk audit found it already fixed in Tvashtr-70/M-h2a. Full as-built: §17 Tvashtr-79.

## §2 — Pending housekeeping (state once, don't nag)

The **doc-closeout is UNCOMMITTED** in the working tree: the Tvashtr-78 §17 edits (carried from last session) **plus** this session's Tvashtr-79 §17 + §15 edits to `PROJECTPLAN.md` **plus** this `HANDOVER.md` rewrite. Land them whenever with:
```
cd /Users/adimac/Desktop/Tvashtr
git add PROJECTPLAN.md HANDOVER.md
git commit -m "docs(tvashtr-79): as-built + §15 register (items 5·6·7 shipped, batch follow-ons)"
```
(Explicit paths only — never `-A`; the ambient untracked noise `.claude/skills/`, `.grok/`, `AGENTS.md`, `CLAUDE.md`, `design/`, old `prompts/M-*.md`, and modified `.gitignore`/`frontend/.gitignore` stays out.) This doesn't block any work.

## §3 — Your job (Tvashtr-80), in order

**FIRST: the live-gate fix `/goal` (the top-priority Tvashtr-79 follow-on — §15).** The persist-then-reap GC now RECLAIMS a greenfield workspace once its diff is persisted, but **4–5 LIVE gate scripts still git-read `.tvashtr_workspaces/<run_id>` AFTER the run goes terminal** and will FAIL post-merge:
- `scripts/loop_run.py:191,373` · `scripts/skeleton_run.py:92` · `scripts/sandbox_reuse_check.py:264` · `scripts/check_loop_crash.py:98`

The offline suite is green + the feature is correct — this is latent (bites the next `make loop-run-docker` / any live loop gate from `main`), not an immediate break. The data survives: `run_artifacts.files` (the persisted diff) + `runs.ship_commit_sha`/`ship_tag`. The fix is **mechanical** — re-point each post-terminal workspace read to the ship tag (`git show ship-<run_id>` in the workspace's git dir) or the DB snapshot. **But it needs docker + a live LLM to verify**, so it is a STANDALONE `/goal` (not batchable, not offline). Steps for you: (1) read those 5 read-sites on disk to see exactly what each expects from the workspace; (2) decide the re-point target per site (most want the shipped tree / diff, which the ship tag or `run_artifacts` gives); (3) write the `/goal` with a live acceptance (`make loop-run-docker` or the specific gate green) + reproduce-first; (4) hand the 3-block launch package (single session, NOT a worktree batch — it's one coherent fix). Note: a live/docker `/goal` runs alone (no sibling), so the container-sweep hazard doesn't apply, and it needs a real provider key in `.env`.

**THEN: the launch-planning direction pass** (a strategic call, NOT a `/goal`): which pre-launch polish to do, and the cost/ops posture for real users (the `tvashtr.online` cutover is DROPPED per §15). Surface options; the operator decides.

## §4 — Standing directives (carry these forward verbatim)

- **Role boundary (permanent):** you are ARCHITECT/PLANNER ONLY. ALL implementation — product code, diagnostic scripts, Makefile/build/config — goes through a Claude Code `/goal`. Your only direct edits: `PROJECTPLAN.md`, `HANDOVER.md`, `prompts/*.md`, trivial typo/comment fixes. Diagnose bugs yourself (read code/logs/git), but the FIX goes through a `/goal`.
- **The `/goal` loop:** ONE lean `/goal` per bounded milestone (outcome + hard invariants-as-evidence + acceptance/evidence checklist Claude Code runs itself + stop conditions). Claude Code self-decomposes. `/goal` hard cap **4000 chars** — measure with `wc -c`. Claude Code runs EVERY gate itself (make test / lint / build / live smoke) and debugs to green — never hand the operator verification commands.
- **Every Claude Code handoff = THREE fully-copyable inline blocks, every time** (even if unchanged): (1) shell launch (`cd … && claude --dangerously-skip-permissions`), (2) the FULL init prompt verbatim, (3) the FULL `/goal` verbatim. Never say "same as before" or point at a `prompts/` file for the init/`/goal` text. The init prompt must: after a ≤5-line summary STOP + WAIT for the `/goal`; and when running the `/goal`, USE ultracode / dynamic-workflows / superpowers.
- **Merge handoff = ALL commands every time** (FF the first branch, `--no-ff --no-commit` the second, `alembic upgrade head` if a migration landed + FULL suite green on the MERGED tree BEFORE committing, then commit, then worktree/branch cleanup). Never assume the operator remembers them.
- **Do NOT nag (operator directive, Tvashtr-78):** never repeatedly prompt about seeking a first real user / the Mv gate — the operator pursues that in their own time. Same for acknowledged housekeeping — state once, then drop.
- **Design decisions:** decide from the §1 vision + the Tvashtr-25 pivot, never path-of-least-resistance; one question at a time; pair every decision with its user-facing UX consequence; don't present option menus for vision calls (reserve that for genuine strategic-direction calls).
- **Two chat sequences (permanent):** "Tvashtr-N" (main build) + "Tvashtr Sidechat-N" (open-ended/brainstorm). Shared project memory. State the sequence + number on opening.
- **Communication:** the operator is terse — "proceed"/"go"/"merged"/"done" = ratify + advance; "By the way" = wants a short answer; pasted terminal output = a confirmation signal. Give procedures one step at a time (they run a step, report, then the next). Prefer analogies + plain language.

## §5 — Key gotchas & patterns (this batch's, plus carried)

- **The disk audit is the control point — and worktrees are OUT of Filesystem-MCP scope, but their commits are in the SHARED object store.** Audit a branch by walking `.git/objects` from the MAIN repo: refs → commit → tree → subtree → blob (a Python `zlib.decompress` + tree-parser). **Subtree/blob SHA identity = byte-identity in one comparison** (proved S1's `shipping.py`/`run_diff.py` untouched; S2's `models.py`/`alembic` unchanged; which top-level trees each branch touched). Loose objects for recent commits copy fine via `copy_file_user_to_claude`.
- **Merge-safety without merging:** decompress the shared-file blobs (base/ours/theirs) and run `git merge-file -p --diff3 ours base theirs` in the container — exit 0 + no conflict markers = the real merge is clean. This batch's only shared file was `team_run.py`; its 3-way merge was clean (additive line math confirmed disjoint regions), and the test subtrees were disjoint files.
- **Register entries go STALE — always disk-verify a "known" open item before acting.** Item 4 (the `test_auth` flake) had been fixed 9 sessions earlier but the §15 entry still said 🔴 open, and the prior HANDOVER propagated it into the batch plan. Reading the actual test file caught it. This is exactly why the audit exists.
- **The worktree-brief gotcha (Tvashtr-66):** a `git worktree` can't see an UNTRACKED `prompts/*.md` brief. Fix used this batch: commit the briefs to `main` FIRST (`c6411bf`), then create the worktrees — the `/goal` then cleanly references its brief.
- **Parallel-batch setup:** each session = own worktree (`git worktree add ../Tvashtr-sN -b feat/parallel-sN`) + own DB (`docker exec tvashtr-postgres createdb -U tvashtr tvashtr_sN`; if `createdb` balks on collation, `psql … "ALTER DATABASE template1 REFRESH COLLATION VERSION;"` first) + a copied `.env` with `DATABASE_URL=…/tvashtr_sN` appended LAST. ALL-offline gates, NO docker/live-LLM gate across a batch (the boot container-sweep can reap a sibling's containers). ≤1 migration across the batch, isolated to one session.
- **`.claude/` IS tracked** (only `.claude/settings.local.json` is gitignored) — so a migration-freeze bump lands via the branch, and worktrees inherit the PreToolUse guards. Structural backstop: `.git/config` has NO remote (nothing to push to).
- **PROJECTPLAN.md editing:** ~630KB; **line 6 is an ~80K single-line banner blob — NEVER read it directly** (it echoes the whole line). Index by `grep -nE '^#{1,3} '` on a container copy; edit via `Filesystem:edit_file` with a unique multi-line anchor + `dryRun:true` first. §17 is append-only (bold-lead entries now, not `###`); §15 deferrals go in immediately. **NOTE: the line-6 banner was NOT bumped for Tvashtr-79 this session** (deprioritized for budget; §17 is authoritative + the register itself flags the banner as a redundant duplicate) — bump it at your next closeout if you like, or leave it.
- **Docker/DB:** `tvashtr-postgres` is a fixed-name container (host port 5433, user/pass/db `tvashtr`). Restart a stopped one with `docker compose start postgres` from the project root (not `up`).

## §6 — Living docs

`PROJECTPLAN.md` + `HANDOVER.md` at the project root (you maintain both). `prompts/CLI-RULES.md` = the Claude Code operating contract. `STATE.md` = the CLI agent's scratch log (gitignored; you read, don't maintain). **Mv** (a non-founder shipping real value on their own repo) remains the real product-value gate — no milestone completion resolves it.
