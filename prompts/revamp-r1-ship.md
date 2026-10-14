# Brief — ship revamp round 1 (branch `ship/revamp-r1`)

Architect: Tvashtr Sidechat-15, 2026-09-25. Operator wants round 1 of the frontend revamp LIVE on
tvashtr.fly.dev (and in a new Desktop DMG) BEFORE round 2 starts. This session makes round 1
releasable and proves it end to end. The operator merges, deploys and tags the DMG afterwards.

## Where things are
- Round 1 lives on `claude/tender-maxwell-0wxvan` @ `9c40a13` (local and on GitHub). It is 0 behind
  GitHub `main` (`1f2781e`). Local `main` is `4e86abc` (behind GitHub — not your concern; do not touch main).
- Read the revamp's own handover: `git show claude/tender-maxwell-0wxvan:docs/superpowers/HANDOVER-2026-09-25-revamp.md`.
- Architect audit (fresh clone): backend 1,811 passed / 2 skipped / 0 failed; vitest 607/607; tsc + build clean.
- Round 1 removed `LaunchPanel` and the old dashboard. The canvas's Run now opens Home's composer.
  New accounts start with NO team. So several e2e specs drive UI that no longer exists.

## 1. The stray `.venv` symlink (do this FIRST, carefully)
Round 1 committed `backend/.venv` as a symlink to `/home/user/Tvashtr/backend/.venv` (a cloud
sandbox path). Your working tree has a REAL `backend/.venv` directory (ignored). Checking out the
branch as-is would try to put the symlink where that directory is.
1. `mv backend/.venv backend/.venv.keep`
2. `git checkout -b ship/revamp-r1 claude/tender-maxwell-0wxvan`
3. `git rm --cached backend/.venv` and delete the symlink file; add a `.venv` line to `.gitignore`
   (the existing `.venv/` only matches directories). Commit just those two paths.
4. `mv backend/.venv.keep backend/.venv`, then `cd backend && uv sync --extra dev`.
5. Check nothing else from the sandbox is tracked: `git ls-files -s | awk '$1==120000'` (symlinks)
   and `git grep -n '/home/user/'`. Remove anything that is sandbox junk; report what you found.

## 2. Rewrite the stale e2e specs for the new UI
Must: `frontend/e2e/demo-proof.spec.ts`, `accounts`, `auth`, `capability-edit`, `endpoint-edit`.
Then run every other spec in `frontend/e2e/` against the real local stack and fix or rewrite any
that fail because the UI changed (round 1 already updated `revamp-shell`, and partly
`team-library`, `edits-toggle`, `node-ask`, `run-diff`, `scope-picker`, `steering`, `team-edit`,
`model-picker`, `fix1_signoff` via `e2e/_myTeam.ts`).
- demo-proof keeps its C1–C12 meaning. C1 lands on the new Home (not the old dashboard). C3/C4 use
  Home's "New team" dialog and create the `PM -> Engineer <-> Reviewer` (review_loop) team. The
  launch goes through Home's composer (the canvas Run button opens it) — not LaunchPanel.
  Approve every human gate by CLICKING Approve in the real UI (Needs you / run view), never the API.
  C12 still needs a real non-empty `pr_url`.
- Get labels/selectors from the real components under `frontend/src/pages/` (home, shell) — read them,
  don't guess. Scope queries with `within(region)`; Home repeats names across sections.
- Never weaken an assertion to make a spec pass. If a spec finds a real product bug: write a failing
  test that proves it on the current code, then fix it (small, contained), then show it green.

## 3. Desktop version
Set `desktop/package.json` `"version"` to `0.3.0` (tags are already at `desktop-v0.2.0`; the app
still says 0.1.0). The operator will tag `desktop-v0.3.0` after merge; the GitHub workflow builds
`Tvashtr-mac.dmg` and the website's Download button (`frontend/src/lib/desktopDownload.ts`,
`/releases/latest/download/Tvashtr-mac.dmg`) serves it automatically. Do not change that link or
the DMG file name.

## 4. Checks (you run all of them, debug to green)
- `make test` (Postgres up: `docker compose start postgres`; `make migrate` first) — ≥1811 passed, 0 failed.
- `cd frontend && npx vitest run` (≥607), `npx tsc --noEmit`, `npm run build`.
- `cd desktop && npm test` (≥88).
- `docker build -t tvashtr-r1 .` — Fly builds this Dockerfile; `frontend/e2e` is in `.dockerignore`,
  so a green local build does not prove the Docker build.
- eslint `--max-warnings 0` + `prettier --check` on every frontend file you changed; ruff check +
  format-check on backend files you changed. Don't reformat files you didn't touch.
- Each rewritten spec + `revamp-shell.spec.ts` against the real stack.
- `make demo-proof` → real PR URL on `lazyxgenius/trade_mcp`, screenshots in `artifacts/demo-proof/local/`.

## Gotchas
- Run `make seed` before `demo-proof` if `make test` has run since.
- Clear stale runs before a live gate (else the fleet ceiling 429s you):
  `docker exec tvashtr-postgres psql -U tvashtr -d tvashtr -c "update runs set status='cancelled' where status in ('pending','running','awaiting_human');"`
  Never raise the ceiling env vars instead.
- `demo-proof` needs 2–3 attempts sometimes (PM short output, provider 5xx). Not a defect.
- Never edit `frontend/src` while `demo-proof` drives Vite (HMR resets the run). Stop, edit, restart.
- Playwright's full accessibility snapshot chokes on the React Flow canvas — use targeted locators.
- Models: NIM retires slugs often. If C2/C5 fail because a catalogue slug is dead, that is an external
  blocker → NEEDS_HUMAN with the dead slug named; don't swap models on your own.

## Do not
- Push, merge into main, `fly deploy`, create tags or releases.
- Add or edit migrations (head stays `0041`). Touch `backend/tvashtr/control_plane/team_run.py`.
- `git add -A` / `git add .`. Commit `HANDOVER.md`, `PROJECTPLAN.md` or anything in `prompts/`.
