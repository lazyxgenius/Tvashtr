# S1 — Greenfield-workspace retention (persist-then-reap) · migration `0031`

**Session 1 of the Tvashtr-79 parallel batch.** This session owns the batch's ONE migration (`0031`). Runs in its own git worktree + its own Postgres DB; all gates OFFLINE (no docker, no live-LLM — the boot container-sweep must not cross into the sibling session). Operating contract: `prompts/CLI-RULES.md`.

---

## Outcome (the one thing this milestone delivers)

A terminal **greenfield** run's shipped diff is snapshotted **durably into the database at ship time**, so the run-view "Changes" tab keeps working **after the workspace directory is reaped** — and the workspace GC is then allowed to reclaim a greenfield workspace **once (and only once) its artifact is persisted**. Brownfield/hosted + orphan reaping is unchanged.

This REVISES the Tvashtr-78 ruling: greenfield was "spared forever because it IS the deliverable"; it becomes "spared **until its artifact is persisted**, then reclaimable." (§17 Tvashtr-78 has the full finding; read it.)

**The load-bearing hard invariant:** a greenfield workspace is NEVER reaped before its diff is durably saved in the DB. Destroying an un-persisted deliverable is exactly the bug Tvashtr-78 caught — do not reintroduce it.

---

## The seams (all read + grounded — build from these, self-decompose the steps)

### 1. New table `run_artifacts` — this is migration `0031`
- Add a `RunArtifact` model to `backend/tvashtr/models.py`, **modelled on `RunWarning`** (models.py:619): `id` `BigInteger, Identity(), primary_key`; `run_id` `Uuid`, `ForeignKey("runs.id", ondelete="CASCADE")`, **`unique=True`**, `index=True` (exactly one artifact per run); `files` `JSONB, nullable=False` (stores the whole `compute_run_diff` result dict — `{run_id, base_ref, ship_branch, files, total}`); `created_at` `DateTime(timezone=True), server_default=func.now()`.
- Create the migration as a **NEW** file `0031_*` under `backend/alembic/versions/` (down_revision `0030`). NEVER edit a frozen migration — the freeze hook will block it.
- **Bump the migration-freeze hook (`.claude/hooks/protect-migrations.sh`) to cover `0031` — as the VERY LAST step, only once everything else is green.**

### 2. Persist at ship time (greenfield only) — `ship_step`, team_run.py:1214
- `ship_step(run_id, workspace)` calls `idempotent_ship` then records `ship_commit_sha`/`ship_tag`. **After that**, if the run is **greenfield** (`run.repo_path IS NULL`), compute the greenfield diff and UPSERT it into `run_artifacts`:
  - Call `run_diff.compute_run_diff(run_id=run_id, repo_path=None, base_ref=None, ship_branch=None)` — at ship time the workspace still exists, so this reads the produced files exactly as the endpoint does today. Store the returned dict as `RunArtifact.files`.
  - **Idempotent**: `ship_step` can be re-run on crash (it's a DBOS step) — the persist must not duplicate. Use an UPSERT (`unique` on `run_id`, ON CONFLICT DO UPDATE) or check-then-write. Re-running ship_step re-persists the same snapshot harmlessly.
  - **Brownfield/hosted runs write NO artifact** — their deliverable is the `tvashtr/<run_id>` branch in the real repo (untouched here). Gate strictly on `repo_path IS NULL`.
- This persist MUST complete before any teardown/reap can run. It already does: `ship_step` runs inside the workflow body well before `_run_end_teardown` (team_run.py:1378 → `delete_run_workspace` at :1415). Keep it that way.

### 3. Serve the Changes tab from the DB when the workspace is gone — `get_run_diff`, routers.py:1191
- `get_run_diff` owner-scopes the run, reads `repo_path`/`base_ref`/`ship_branch`, and calls `compute_run_diff(...)`. Change it so that **for a greenfield run** (`repo_path is None`): if a `RunArtifact` row exists for the run, **return its stored `files` dict verbatim** (the durable snapshot — identical shape to a live `compute_run_diff` result); otherwise fall through to `compute_run_diff(...)` (a greenfield run not yet persisted, or mid-flight, reads the live workspace exactly as today).
- Brownfield runs are byte-identical to today (they never hit the artifact branch).
- **Keep `run_diff.py` PURE** — it is deliberately openhands-free AND DBOS-free (pure `subprocess`+`pathlib`, "importable anywhere, unit-testable against a temp repo"). Do NOT add a DB read inside `run_diff.py`. The DB-fallback lives in the router (which already has `db.session_scope()`), not in the diff module. Its module-level imports must stay unchanged.

### 4. GC: spare-until-persisted — `_spared_run_ids`, workspace_reaper.py:121
- Today (line 150) the spare rule is `status in LIVE_STATUSES or repo_path is None` (greenfield spared forever). Change the greenfield arm to **spare a greenfield run only while it has NO persisted artifact**:
  - Extend the `select` to also learn which candidate run_ids have a `RunArtifact` row (a LEFT JOIN, or a second `select(RunArtifact.run_id).where(RunArtifact.run_id.in_(...))` to build a `persisted` set).
  - New spare condition: `status in LIVE_STATUSES OR (repo_path is None AND run_id NOT in persisted)`.
- This shared helper feeds BOTH reclaim paths (`delete_run_workspace` at run-end AND `sweep_orphaned_workspaces` at boot / the `*/10` Fly cron), so both get the new behavior for free — which is the whole reason the rule lives in one place (do not move it to a call site).
- Keep every existing fence intact: UUID-only `_workspace_path`, `os.scandir(..., follow_symlinks=False)`, refuse-if-root-is-symlink, never-raises, openhands-free, the Fly-mode gate on the `*/10` decorator. LIVE statuses still spared. Brownfield-terminal + absent-row still reaped.

---

## Reproduce-first (prove it before the fix; ALL OFFLINE against a temp repo + the test DB)

Write these as failing regressions first, confirm they FAIL on the current code, then implement:
1. **Persist-then-reap-then-serve:** a terminal greenfield run whose artifact IS persisted → `delete_run_workspace` AND `sweep_orphaned_workspaces` now REAP its workspace (RED today — spared forever), AND after the workspace is gone `get_run_diff` / `compute_run_diff`-via-artifact still returns its files from the DB (RED today — empty once the dir is gone).
2. **Not-yet-persisted is still spared:** a greenfield run with NO `run_artifacts` row (mid-flight, or terminal-before-persist) is STILL spared by both paths (guards the hard invariant).
3. **Brownfield unchanged:** a terminal brownfield workspace is still reaped; a live run of any type still spared. (Existing `test_workspace_gc.py` cases stay green.)
4. **ship_step persist is greenfield-only + idempotent:** a greenfield ship writes exactly one `run_artifacts` row; re-running ship_step does not duplicate; a brownfield ship writes none.

Extend `backend/tests/test_workspace_gc.py`, `test_run_diff.py`, `test_shipping.py` (all already offline, in `make test`).

---

## Invariants / do-not-touch (expressed AS on-disk evidence)

- `shipping.py`'s `idempotent_ship` UNTOUCHED — the persist lives in `ship_step`, not in the pure ship function. (`git diff main -- backend/tvashtr/control_plane/shipping.py` empty.)
- `run_diff.py` stays openhands-free + DBOS-free — the DB-fallback is in the router. (`run_diff.py` module-level imports unchanged.)
- The brownfield/orphan reap paths unchanged; LIVE always spared; all reaper fences intact.
- No user-visible change to the greenfield Changes tab (same files, now served from DB when the dir is gone).
- Migration `0031` is a NEW file; freeze bumped LAST; `models.py` change is purely additive (existing tables/rows byte-intact).

**Known residual (register as a §15 rider, don't fix here):** a *failed* greenfield run never ships, so it never persists an artifact → it stays spared (a small, safe leak). This matches reproduce-first case #2 ("not-yet-persisted → spared"). Do not widen the reap to failed-no-artifact runs in this slice.

---

## Acceptance / evidence (Claude Code runs EVERY check itself, debugs to GREEN, echoes each into the chat)

- `make test` GREEN — floor **≥1000 backend**, plus the new item-6 regressions above.
- `make lint` clean; ruff/`make fmt` clean (re-run the FULL lint on ALL added files before READY — a green suite before adding test files can hide E501/format debt in them).
- FE build + `make vitest` GREEN — floor **≥403 vitest** (this is a backend-only slice; run it to prove zero FE regression).
- `alembic upgrade head` applies cleanly on the worktree DB and reports `0031`; a fresh DB migrates `0001→0031` clean.
- **NO docker / live-LLM gate** (offline batch). The live reaper gate `make workspace-gc-check`, if it needs docker or a live agent, is OUT OF SCOPE for this worktree (it runs from `main` post-merge, driven by the architect — never handed to the operator). If it is fully offline (workspace dirs + a DB only, no agent container), you MAY run it; otherwise skip it and say so.
- End on a `READY_TO_MERGE` line naming the branch + the head migration (`0031`).

---

## Stop conditions

- Write `NEEDS_HUMAN` to `STATE.md` and stop on an external blocker (the worktree DB won't migrate/connect; a dependency is missing).
- A **code-proven, contained, regression-guarded** fix to something you uncover MAY proceed. A **second/unknown problem that needs a broad or unproven change** → STOP + `NEEDS_HUMAN` (do not improvise a wide change to force a green).
- Hard turn cap per CLI-RULES. Commit only THIS session's changed paths on its own branch (never `-A`; never sweep `prompts/*.md` or the living docs).
