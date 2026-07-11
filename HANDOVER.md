# HANDOVER — Tvashtr

_A structured snapshot for the next architect chat. Read this first, then `PROJECTPLAN.md` (the source of truth). Last rewritten: Tvashtr-56 (2026-07-11)._

---

## §0 — Standing operator directives (carry forward EVERY session)

- **Your role = ARCHITECT / PLANNER only.** ALL implementation goes through Claude Code `/goal` runs — product code, diagnostic scripts, AND build/Makefile/config changes alike. When tempted to write code, write a `/goal` instead.
- **Architect-direct edits ONLY:** `PROJECTPLAN.md`, `HANDOVER.md`, `prompts/*.md` briefs, and trivial doc/comment/typo fixes. Also acceptable: **resolving a mechanical merge conflict** during the operator's merge (a pure union of two already-Claude-Code-authored changes is a merge fix, not new code — e.g. the Tvashtr-56 Makefile `.PHONY` conflict). Everything else → a `/goal`.
- **The disk audit is the control point.** Never trust Claude Code's report. Read the changed files, byte-diff "untouched" claims vs a pre-image, confirm tests are mutation-real (they must fail on the pre-fix code), reconstruct git state from `.git/` plumbing (no git CLI in the MCP: `.git/refs/heads/<b>`, `.git/logs/refs/heads/<b>`). **Worktree files are OUTSIDE the Filesystem MCP scope** → the full file audit happens POST-merge once files land in the main checkout (plumbing pre-check first; rollback is `git reset --hard <base>` since nothing is pushed).
- **Chat naming:** open each chat by stating its name (Tvashtr-N), from the operator's opening message.
- **Design from the vision, one decision at a time, each paired with its concrete canvas/UX consequence.** Decide directly (don't present option menus) except for genuine strategic-direction calls. If the operator says "take all decisions / don't shy from work," decide the whole set ambitiously (grounded in the vision + market practice — Claude Code / Cursor), don't ask for per-decision sign-off.
- **The Claude Code launch package is ALWAYS three fully-copyable blocks, every time, reproduced inline** (never "same as before", never "get it from a file"): (1) the shell launch command (`… && claude --dangerously-skip-permissions`), (2) the FULL init prompt verbatim, (3) the FULL `/goal` verbatim. Worktree runs can't see `prompts/*.md`, so the `/goal` must be **self-contained** (inline the whole spec; the `/goal` cap is ~4000 chars).
- **Init prompt must explicitly tell Claude Code to** (1) after its ≤5-line summary + env check, STOP and WAIT for the `/goal`; (2) when executing the `/goal`, USE ultracode, dynamic workflows, and the superpowers skills; (3) run ALL verification itself (make test / test-frontend / lint + the live proof) and debug to green before `READY_TO_MERGE`; (4) end with a detailed final report.
- **`/goal` must specify:** outcome; hard invariants/do-not-touch (expressed AS on-disk evidence where possible); the acceptance/evidence checklist (tests + pass thresholds + live smoke targets + a `READY_TO_MERGE` line, Claude Code runs it all itself, never the operator); reproduce-first for bug-fixes (a failing regression proven on current code); stop conditions (`NEEDS_HUMAN` → `STATE.md` on an external blocker; a turn cap; distinguish "a contained, regression-guarded, code-proven fix → may proceed" from "a broad/unproven change → STOP").
- **Parallel batches = TWO DIFFERENT features** (never two halves of one). Each its own worktree + Postgres DB + Vite port; **≤1 Alembic migration across the batch**. **File overlap is ACCEPTABLE — zero overlap is NOT required (operator, Tvashtr-56):** still MAP the overlap FIRST (predictable merge), but overlapping files are fine and the conflict is RESOLVED AT MERGE (FF the first branch; cherry-pick/rebase the second with keep-both on shared files, then re-verify green).
- **Merge handoff = ALL commands copyable, every time** (`cd` root · `git checkout main` · the exact FF/cherry-pick · a verify `git log` + expected tip sha · what to do if FF is refused · optional branch cleanup). FF-only for the first branch; same-base second branch → cherry-pick (not FF). Merges are operator-run; the architect may resolve a conflicted file.
- **Guardrails survive bypass as PreToolUse hooks** (deny rules in `.claude/settings.json` go inert under `--dangerously-skip-permissions`): the no-push guard (`protect-no-push.sh`) + the migration-freeze (`protect-migrations.sh`, blocks 0001–0024). Convert any new guard to a hook before a bypass run.
- **Operator comms:** terse ("go"/"proceed"/"merged"/"done" = ratify + advance; "by the way" = wants a short answer); procedures ONE step at a time (give step 1, wait for the output, then step 2); analogies help; simple everyday language, minimal formatting/jargon; always hand over copyable artifacts (never make them reconstruct or scroll back).
- **Living docs (maintain in place):** `PROJECTPLAN.md` (source of truth: §1 vision, §14 features, §15 deferred register + build sequence, §16 milestones, append-only §17 decision/as-built log, §18 glossary), `HANDOVER.md` (this file). `STATE.md` is the CLI agent's log (they own it; now gitignored — never rides onto `main`).

---

## Current state

- **`main` @ `6e1d8f4`; alembic head `0024`; floors 497 backend / 285 vitest; repo is `main`-only (worktree-list clean).**
- **Nothing is in flight.** Tvashtr-56 ratified the M-unify **U2** design pass (4 decisions) and shipped the **U2 ‖ M-changes** parallel batch — both DISK-AUDITED, merged (FF U2 `→0c8f277`, then M-changes cherry-picked `→6e1d8f4`), and cleaned up. Both zero-migration.
  - **U2 (sandbox reuse) — DONE.** A process-level sandbox cache keyed per (run_id, node_id) OUTSIDE the DBOS durable model (`engines/sandbox_cache.py`, stdlib-only, opaque handle); an additive `AgentTask.session_key`; an engine-neutral `close_run_sandboxes(run_id)` teardown step called from `run_team`'s `try/finally`; conversation-carry (keep the OpenHands Conversation alive + continue it); the reaper spares live cached containers via `keep_ids` (boot sweep still reaps everything). A node stays warm across its own review-loop rounds (no docker re-spin on round 2+). Adversarial pass fixed a HIGH (teardown must `except BaseException` for the DBOS-cancel path). Live-proven on deepseek+docker.
  - **M-changes (Run Changes view) — DONE.** A read-only owner-scoped `GET /api/runs/{run_id}/diff` (`control_plane/run_diff.py`, subprocess git, stdlib-only, three-dot merge-base for brownfield / produced-files-as-added for greenfield, never raises → []/200) + a `RunDiff.tsx` "Changes" tab in the run view. The user can now SEE the reviewed change.
- **Milestone status:** M-frontend COMPLETE · M-tools COMPLETE · M-ctx0/M-ctx1 shipped (live model-bench validation still deferred, §15) · M-ledger shipped · **M-unify COMPLETE** (U1+U2+U3 all shipped) · M-rails content-check surface COMPLETE (secret_leak_scan + diff_touches_forbidden_paths + output_schema_check + the credential invariant; further gate kinds on-trigger only) · M-robust shipped (DeepSeek `deepseek/deepseek-chat` is the go-forward agent model; both sandbox modes serialize reasoning-model output cleanly).

---

## Next steps (Tvashtr-57)

1. **The next parallel batch** — pick TWO DIFFERENT brief-ready features, map the file overlap first (overlap OK, resolved at merge), ≤1 migration across the batch, each its own worktree + DB + Vite port. Design each enough to write a self-contained `/goal`; audit each on disk post-merge.
2. **M-memory** (agentic memory / RAG via pgvector — committed Sidechat-7, a §16 milestone) still needs **its own design pass** before it can be briefed (it's a real architectural direction: Postgres-now → pgvector-next, a per-node Memory surface). Don't rush it into a parallel batch.
3. **§15 hygiene the operator may pick up** (all in PROJECTPLAN §15): modernize the stale `skeleton-crash-docker` demo (add login+cookie, un-hardcode compose-project/port/DB); filter workspace scaffolding (`.gitignore` + init-commit files) from the greenfield `/diff`; LOCAL-mode containment; the C9 4-option gate picker `.tv-seg` treatment; the Option-B crash-time re-attach-by-id (the crash twin of U2); per-node fallback models; typed output schemas.
- **Mv** (a non-founder shipping real value on their own repo) remains the standing value gate no amount of shipping resolves.

---

## Key gotchas & lessons

- **`copy_file_user_to_claude` caches by basename** — re-copying a changed file returns STALE content. Use `Filesystem:read_multiple_files` / `read_text_file` (cache-free) for a file that changed this session; or stash a pre-image to `/tmp/pre/`. `/mnt/user-data/uploads/` is read-only to bash, and bash runs in Claude's container (can't reach the operator's disk or git).
- **PROJECTPLAN.md is ~365 KB.** Copy it to `/mnt/user-data/uploads` and `grep -nE '^#{2,3} '` for the header index, then `sed -n 'X,Yp'` targeted reads. Line 6 is one giant "Last updated" banner. **§17 append anchor:** the last entry's closing (`…remains the real gate.`) + `\n\n---\n\n## 18. Glossary` (unique — disambiguates the repeated closing phrase). **Header update:** prepend the new Tvashtr-N summary + `_Prior:_` before the current lead entry.
- **`Filesystem:edit_file` needs exact `oldText` match** — `dryRun: true` first for risky matches (or accept a failed apply is no worse than a dry-run). For full HANDOVER rewrites use `write_file` (it overwrites).
- **Same-base parallel pair:** both branches fork from the same `main` tip → only the FIRST fast-forwards; the SECOND must be cherry-picked (`git cherry-pick <sha>`) or rebased, and gets a NEW sha (so `git branch -D` it at cleanup, not `-d`). A shared file (e.g. the Makefile `.PHONY` line) conflicts at cherry-pick — resolve keep-both.
- **Parallel docker hazard:** the container reaper is image-based (reaps ALL agent-server containers). Two sessions running docker agent-runs at once would reap each other — scope live proofs so only one uses docker at a time (the other uses LOCAL/fixture), or stagger them.
- **`GIT_EDITOR=true git cherry-pick --continue`** avoids the commit-message editor popping up (useful when guiding the operator).
- **Reproduce-first for design-pass milestones too:** the "prove the new behavior" test must be mutation-real (U2's round-2 cache-HIT went RED as `[None,None,None]` before the seam was threaded; M-changes' owner-isolation asserts a foreign user → 404).

---

## Ready-to-paste opener for Tvashtr-57

> You are Tvashtr-57. Read `HANDOVER.md` (especially §0 + Current state) and `PROJECTPLAN.md` at the project root first; don't start work until you've read both. There is nothing in flight — Tvashtr-56 ratified the M-unify U2 design pass and shipped + merged the U2 ‖ M-changes parallel batch (main @ `6e1d8f4`, head `0024`, floors 497/285, repo main-only). M-unify is COMPLETE (U1+U2+U3). Your first work: propose the next parallel batch — two DIFFERENT brief-ready features (file overlap OK, resolved at merge; ≤1 migration; own worktree+DB+port each), overlap-mapped first — OR, if the operator wants it, the M-memory design pass (it needs one before a brief). Mv (a non-founder shipping real value on their own repo) remains the real gate.
