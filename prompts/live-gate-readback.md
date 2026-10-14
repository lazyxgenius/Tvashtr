# Brief — Live-gate readback fix (Tvashtr-80)

## Outcome
Re-point the **5** live-gate scripts that read a greenfield run's `backend/.tvashtr_workspaces/<run_id>`
git repo **after the run goes terminal** so they read the **durable persisted snapshot** instead of the
(now-deleted) workspace. Nothing else changes.

## The bug (already confirmed on disk — reproduce it live, don't re-derive it)
Tvashtr-79 S1 shipped persist-then-reap: `ship_step` snapshots a greenfield run's whole
`compute_run_diff` result into the `run_artifacts` table, and `workspace_reaper.delete_run_workspace`
then reclaims the greenfield workspace. That delete runs inside **`run_team`'s `finally`** (via
`_run_end_teardown`), which fires **before `run_team` returns**, i.e. before the DBOS workflow reports
`SUCCESS`. So the sequence is always: ship → persist `run_artifacts` row → reap the workspace → *then*
report SUCCESS. Every affected gate polls "until SUCCESS, then read the workspace" — so by the time it
reads, `.tvashtr_workspaces/<run_id>` is gone and every `git -C <workspace> …` fails against a missing
directory. **Deterministic, not flaky.** The offline suite is green + the feature is correct; only these
live gates are broken (they were never run live from `main` after S1 merged).

## The 5 scripts + their post-terminal `git -C <workspace>` read-sites
1. `scripts/skeleton_run.py` — `git show <ship_tag>:<TARGET_FILE>` → asserts committed file content
   **byte-exact** `== REQUIRED_LINE`.
2. `scripts/loop_run.py` — **TWO** sites (the feature-loop fn + the loop-run fn): `git tag --list <tag>`
   (shipped-once) + `git show <tag>` / `git show <tag>:<TARGET_FILE>`.
3. `scripts/sandbox_reuse_check.py` — `git tag --list <tag>` (shipped-once).
4. `scripts/check_loop_crash.py` — `git tag --list <tag>` + `git log --all --grep "Ship: <run_id>"`
   (exactly one commit) + `git show <tag>:<TARGET_FILE>` (substring `REQUIRED_LINE in content`).
5. `scripts/check_skeleton_crash.py` — the same three as check_loop_crash (its file-content check is
   byte-exact).

**Also `grep -rn 'tvashtr_workspaces' scripts/` and confirm this list is complete** — fix any other
post-terminal `git -C <workspace>` read you find (the list is believed complete but verify on disk).

## The durable sources (what survives the reap)
- `runs.ship_tag`, `runs.ship_commit_sha` — plain string columns, already in the `GET /api/runs/{id}`
  payload.
- `run_artifacts.files` = the **whole** `compute_run_diff` result dict
  `{run_id, base_ref, ship_branch, files:[{path, status, additions, deletions, patch}], total}` —
  greenfield-only, **one row per run** (`run_id` UNIQUE). Written by `ship_step`
  (`_persist_greenfield_artifact`). Served verbatim by `GET /api/runs/{id}/diff` (owner-scoped: 404
  unless the run belongs to the current user) **or** read directly off the `RunArtifact` row via
  `session_scope()`.
- For a greenfield run every shipped file is `status:"added"` and its **content lives in the `patch`**
  as `+` hunk lines (for a one-line file the sole `+` line minus the leading `+` == the content).

## Re-point per assertion type — preserve each assertion's MEANING
- **"committed file content / feature present"** (skeleton_run; loop_run's `show tag:FILE`; both crash
  checkers' `show tag:FILE`) → read the persisted diff, find the entry with `path == TARGET_FILE`,
  assert `status == "added"` and `REQUIRED_LINE` is present in its `patch`. Keep **byte-exact** where the
  original was byte-exact (extract the added-line body from the patch — strip the `+`); **substring**
  where the original was substring (the crash-loop checker deliberately tolerates a cosmetic edit).
- **"shipped once / exactly one tag"** (loop_run; sandbox_reuse; both crash checkers' `tag --list`) →
  assert `runs.ship_tag == f"ship-{run_id}"` AND `runs.ship_commit_sha` is set.
- **"exactly one 'Ship: <run_id>' commit"** (the 2 crash checkers' `git log --grep`) → **DESIGN
  DECISION (ratified):** the empirical git-log count CANNOT survive the reap (the greenfield workspace
  was the only repo that ever held that commit — there is no remote). Replace it with the durable
  single-ship witnesses: **exactly one `run_artifacts` row** for the run (unique `run_id` UPSERT) +
  `runs.ship_commit_sha` set + the DBOS workflow at `SUCCESS`. The single-ship **guarantee** is
  `idempotent_ship`'s `ship-{run_id}` **tag-dedup**, which is unchanged — the git-log count was only
  *confirming* a guarantee that is still fully in force. Equivalent in practice; marginally weaker only
  in theory. Do NOT try to reconstruct the commit graph.

## Preferred implementation — one shared readback helper
Factor a single helper module (e.g. `scripts/_ship_readback.py`) that all 5 gates import, so **one
offline test covers all five**:
- `shipped_diff(run_id) -> dict` — read `RunArtifact.files` via `session_scope()` and return the stored
  dict (empty-ish `{"files": [], "total": 0}` if no row). **Prefer the DB read over the `/diff`
  endpoint** — `check_loop_crash.py` / `check_skeleton_crash.py` talk to the backend over raw `urllib`
  with no session cookie, and `/diff` is owner-scoped, so a direct `RunArtifact` read is the uniform,
  auth-free path.
- small helpers: `shipped_once(run) -> bool` (ship_tag/ship_commit_sha set) and
  `added_file(diff, path) -> str | None` (the added content extracted from that file's patch), plus a
  single-`run_artifacts`-row check for the crash checkers.
Each script keeps its existing DB/`urllib`/`session_scope` access; only the `git -C <workspace>` lines
are swapped for helper calls.

## Reproduce-first + acceptance (run every check yourself; echo each decisive line into the transcript)
1. **REPRODUCE-FIRST (live, cheap — provider key only, NO Docker):** from `main` (before any fix) run
   `make skeleton-run` (LOCAL sandbox) and CONFIRM it goes **RED** because the workspace was reaped and
   `git show <ship_tag>:<TARGET_FILE>` fails against a missing dir. Echo the decisive failing line as the
   "fails on current code" proof. (Note: the reap fires in ALL sandbox modes, so the cheap LOCAL gate
   reproduces the bug — no Docker needed.)
2. **OFFLINE REGRESSION in `make test`** — a NEW test under `backend/tests/` **loaded by file path**
   (the `backend/tests/test_model_bench.py` pattern, so `make test` actually runs it and it can't rot).
   Follow the fixture pattern in `scripts/workspace_gc_check.py` / the S1 mutation tests: build a
   greenfield run + its `.tvashtr_workspaces/<run_id>` git repo, persist a `run_artifacts` row, call
   `workspace_reaper.delete_run_workspace(run_id)`, then assert (a) the shared readback returns the
   shipped file + line, (b) `run_diff._greenfield_files(run_id)` now returns `[]` for that run (the old
   workspace path is genuinely dead — this is the "would fail on the old logic" half), (c)
   `runs.ship_tag`/`ship_commit_sha` set + **exactly one** `run_artifacts` row. Mutation-real (assert
   real values, not smoke).
3. **`make test` GREEN** (confirm the live floor with the count at session start — it must not regress; it
   should RISE by the new test) + **`make lint` clean**.
4. **LIVE GREEN (2 cheap LOCAL gates, provider key only, NO Docker):** `make skeleton-run` +
   `make loop-run` → both GREEN via the durable readback. Echo each final status line.
5. **The 3 heavier gates** (`make sandbox-reuse-check`, `make skeleton-crash`, `make loop-crash` —
   Docker / kill-9, flaky + costly) use the **same** shared readback helper, proven by the 2 live locals
   + the offline regression. **Do NOT re-run them live this run** — no new signal, real Fly/LLM cost.
   Fixing them = wiring them through the shared helper.

## Invariants / fences (prove as evidence)
- **ZERO migration** — alembic head stays `0031`. Do NOT touch anything under `backend/tvashtr/alembic/`
  and do NOT touch `models.py`.
- **Do NOT touch backend product code.** `ship_step` / `_persist_greenfield_artifact` (team_run.py),
  `workspace_reaper.py`, `get_run_diff` (routers.py), and `run_diff.py` are DONE and correct. This run
  touches ONLY: the 5 gate scripts + the new shared readback helper (both under `scripts/`) + the new
  test (under `backend/tests/`). Prove it: **`git diff main -- backend/tvashtr/` is EMPTY** (the new test
  lives under `backend/tests/`, which is outside `backend/tvashtr/`).
- Branch `feat/live-gate-readback`, off `main`. **Commit ONLY your own changed paths.** There are
  uncommitted doc edits (`PROJECTPLAN.md`, `HANDOVER.md`) in the working tree — do NOT stage or commit
  them.

## Stop conditions
- If a gate stays RED after the re-point for a reason OTHER than the workspace-reap (a genuinely
  different / second cause that would need a broad or unproven change) → STOP and write `NEEDS_HUMAN`
  with the decisive line. A contained, code-proven, regression-guarded fix to the identified readback
  cause may proceed.
- Standard: `NEEDS_HUMAN` on a genuinely dead provider key (a throttled/rate-limited tier is NOT — see
  CLI-RULES §4.6); a hard turn cap.
