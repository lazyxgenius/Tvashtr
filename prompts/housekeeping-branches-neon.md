# Brief — Housekeeping: old git branches and old Neon snapshot branches

Architect: Tvashtr Sidechat-16, 2026-10-01 (~18:25 IST, v2). Read this whole file before doing anything.

**Paths.** This file is `/Users/adimac/Desktop/Tvashtr/prompts/housekeeping-branches-neon.md`. `prompts/` is
untracked, so a git worktree doesn't contain it: always use the absolute paths in this brief. The record
file is `/Users/adimac/Desktop/Tvashtr/prompts/housekeeping-2026-10-01.record.md`.
The operator authorizes this session to delete old git branches (local and on GitHub) and to create and
delete Neon branches, within the rules below. Nothing else.

## Why it's safe to run next to another session

Another Claude Code session is working in the main checkout (`/Users/adimac/Desktop/Tvashtr`, on
`fix/connectors-parity` at ~18:12 IST); it may merge to `main`, push, tag `desktop-v0.14.0` and
`fly deploy`. Run this job from its own worktree (the operator starts it with worktree on); all
worktrees share one repository, so branch and tag work is the same from there. This job only touches
refs that session doesn't use, and never any working tree:

- **Never run:** `checkout`, `switch`, `stash`, `reset`, `restore`, `clean`, `add`, `commit`, `merge`,
  `rebase`, `pull`, `gc`, `prune`, `worktree prune`, `worktree remove`, any test, build, server, `fly`
  command, or any write to `main`, to any tag other than `archive/*`, or to `STATE.md`.
- **Allowed git commands:** `ls-remote`, `for-each-ref`, `rev-parse`, `rev-list`, `log`,
  `merge-base`, `worktree list`, `tag` (only `archive/*`), `branch -d` / `branch -D`,
  `push origin refs/tags/archive/...`, `push origin --delete <branch>`, and fetch ONLY as
  `git -c maintenance.auto=false -c gc.auto=0 fetch --no-write-fetch-head origin` (no background
  upkeep, and it leaves `FETCH_HEAD` alone, which the other session's `git pull` reads).
- If a git command fails on a lock file (`*.lock: File exists`), wait 30 seconds and retry, up to
  three times; never delete a lock file yourself. Then record it and move on.

## Rules

1. **Never delete, under any circumstances:** `main`; any branch whose tip commit is newer than 24
   hours (this covers your own worktree's `worktree-*` branch); the branch checked out in the main
   checkout or in any worktree (`git worktree list`); `fix/security-s1` and `fix/connectors-parity` by
   name; any tag except creating new `archive/*` ones.
2. **Merged** (its tip is an ancestor of `origin/main`, checked after the fetch above): delete it on
   GitHub and locally. Nothing is lost; its commits live in `main`.
3. **Not merged:** first create an annotated tag `archive/<branch name>` at its tip (message: "Archived
   by housekeeping 2026-10-01: <branch> @ <sha>, never merged") and push it to GitHub. Confirm with
   `git ls-remote origin refs/tags/archive/<branch name>` that it points at the same sha. Only then
   delete the branch on GitHub and locally. A local-only branch gets its tag pushed too, so nothing
   exists only on this Mac.
4. **First write the plan, then act.** Before any deletion, write the full table (branch · where:
   local/GitHub/both · tip sha · merged? · commits ahead of `origin/main` · last commit date · action)
   to the record file (absolute path above) and echo it in the chat. Then do exactly that plan. If
   anything at run time differs from the plan, stop for that branch and record why.
5. **Record how to restore.** For each deleted branch, the record keeps its sha and the restore
   command: `git push origin <sha>:refs/heads/<branch>`.

The architect's snapshot at ~18:12 IST, for comparison only — recompute it yourself: on GitHub, 41
branches (36 merged besides `main` and `fix/security-s1`, plus `docs/polyrag-phase1-plan` +2,
`docs/polyrag-tvashtr-design` +1 and `docs/spike-hosted-subscription-apis` +2 not merged); locally,
34 (30 merged besides `main` and `fix/security-s1`, plus `fix/fly-create-app-403` +1 from 09-05 —
local only, not merged — and `fix/connectors-parity`, in use).

## Neon

The prod database is the Neon project `billowing-mud-37479513`; its default branch is `production`.
Use the Neon CLI (`neonctl`) and the repo's `neon` skill if it helps.

1. List the project's branches (name, id, parent, created at, has compute?) and echo the list.
2. Create one fresh snapshot branch of `production`, named `snap-2026-10-01`, from "now", with **no
   compute**, unless a branch created today already exists. Confirm it in the list. If creating it
   fails because the project is at its branch limit, do step 3 first, then create it.
3. Then delete exactly these two, matched by exact name AND parent `production` AND created before
   2026-10-01: `before-revamp-r1` (created 2026-09-26) and `pre-0042-2026-09-30` (id
   `br-spring-night-azbi4vfk`). If either doesn't match on all three, don't delete it; record why.
4. **Never:** delete or modify `production` or any other branch; touch an endpoint or compute; run SQL;
   change a project setting.
5. Echo the branch list after.

## Stopping point

Stop when the branch table is carried out and the Neon steps are done, or after **30 minutes**,
whichever comes first. Three-attempt rule: anything that fails three times is recorded with its output
and skipped. Never claim something was deleted without the command's output.

## Handover

Append to the record file (absolute path above), and echo in the chat:
- **Done:** branches deleted (GitHub / local), tags created, Neon branch created and deleted — each with
  its command output.
- **Verified:** `git ls-remote --heads origin` and `git for-each-ref refs/heads` after (counts and
  names), `git ls-remote --tags origin 'archive/*'`, the Neon branch list after.
- **Skipped or blocked:** with the reason and the output.
- **Left for later:** `fix/security-s1` and `fix/connectors-parity` (in use today), and anything
  skipped.
