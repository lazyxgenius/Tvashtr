# Implementer brief — Tvashtr revamp, backend slices

You are implementing ONE slice of the Tvashtr frontend revamp's backend work, in your own git
worktree (you were started in it). Other slices are being built in parallel in other worktrees by
other engineers; the lead merges them afterwards.

## Read first (in your worktree)
1. `docs/superpowers/plans/2026-09-25-frontend-revamp.md` — the plan. Your slice's section lists
   what to build. Also read "Global constraints".
2. `docs/superpowers/specs/2026-09-25-frontend-revamp-design.md` — the spec; §4 answers the open
   questions for your area. Follow the spec where it decided something.
3. Your area's analysis file(s) in `docs/superpowers/specs/2026-09-25-revamp-analysis/` — the §3
   backend gap table + proposals give exact shapes, file locations and line references (line
   numbers may have drifted slightly). The requirement IDs (e.g. `ENG-53`) tell you what the UI
   will do with your data.
4. `prompts/CLI-RULES.md` §3 (invariants).

## Environment setup (do this first)
```bash
cp <repo root>/.env .                  # the backend reads ../.env; worktrees don't have it
cd backend && uv sync --extra dev        # pytest, ruff
export DATABASE_URL=postgresql://tvashtr:tvashtr@localhost:5433/tvashtr_<YOUR_DB>
```
The lead creates your database `tvashtr_<YOUR_DB>` and migrates it to head before you start. Use it for
EVERY pytest/uvicorn command (export it in each shell). Never run `alembic downgrade`, never touch
the default `tvashtr` database or another slice's database. Postgres is on `localhost:5433`
(user/pass `tvashtr`).

## Rules
- Never edit an existing migration (0001–0041; a hook enforces 0001–0040, and 0041 is shipped on
  this branch). If your slice needs schema, the lead adds ONE new migration for the whole round
  first; don't add your own.
- Put new endpoints in YOUR router module `backend/tvashtr/routes/<module>.py` (already created and
  registered in `main.py` behind `get_current_user` — don't edit `main.py` includes). Logic goes in
  `backend/tvashtr/control_plane/`. Change an existing endpoint in `routers.py` only where your
  slice's plan section says to change that endpoint; keep edits there tight and local so merges
  with other slices are easy.
- Additive APIs: never remove or rename an existing response key; add new ones.
- Never change the return shape of an existing DBOS `@DBOS.step`/workflow function — add a new
  step. `team_run.py` must stay OpenHands-free at import time. Don't change the `EngineAdapter`
  interface or `build_two_node_team`.
- Owner scoping on every new read/write (another account's object → 404).
- Tests: pytest for every new endpoint and behaviour (see `tests/test_engines_subscriptions_api.py`
  for the fresh-registered-client pattern, `tests/conftest.py` for the shared `client` fixture and
  fake adapters). Run your new test files plus the existing test files for every module you
  touched. Do NOT run the whole suite (it is long; the lead runs it after merging).
  `uv run --extra dev pytest tests/<file> -q -p no:cacheprovider`
  `uv run --extra dev ruff check tvashtr tests && uv run --extra dev ruff format --check tvashtr tests`
  (format only the files you touched: `ruff format <files>`).
- Existing tests you break because behaviour intentionally changed (e.g. create-only POST, no more
  auto-seeding): update them, and say which and why in your report.
- Commit on your worktree's branch with conventional commits (`feat(backend): …`, `fix(backend): …`,
  `test(backend): …`), small logical commits. End every commit message with:
  ```
  <the attribution trailer your session uses>
  ```
  Never push, never merge, never rebase onto other branches, never `git config`.
- The frontend will be built against what you ship. Write your final API contract to
  `docs/superpowers/plans/api/<slice>.md`: for every new or changed endpoint, method + path, query
  params, request body, a realistic response JSON example, error codes with their exact `detail`
  copy. Commit it.

## Final report (your last message)
- Branch name and the list of commits.
- Per file: what changed and why.
- Every command you ran to verify, with its result (pass counts).
- Deviations from the plan/spec and why; anything you did not do; residual risks.
- Anything another slice or the frontend must know (e.g. a field name that differs from the plan).
