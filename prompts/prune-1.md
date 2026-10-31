# Brief — Prune 1: delete dead code, zombie routes and duplicates (code edits only)

Architect: Tvashtr Sidechat-25, 2026-10-20. Path: `/Users/adimac/Desktop/Tvashtr/prompts/prune-1.md`.
`prompts/`, `HANDOVER.md`, `PROJECTPLAN.md` and `design/` belong to the architect: never stage or commit
them. `STATE.md` is your log (git-ignored). Where this brief and `prompts/CLI-RULES.md` differ, this
brief wins.

## Why

Every line in the repo is something the next agent has to read, and dead code looks just as alive to
it: an agent copies patterns from features we abandoned. Duplicates mean a fix lands in one copy while
the other copy keeps shipping the bug. A route whose button is gone is still live on tvashtr.fly.dev.
This session makes the codebase smaller **without changing anything a user sees or does**.

## What this session is — and isn't

- **Code edits only**, on one branch **`chore/prune-1`** from `main` = **`65d4b194`**. No push, no
  deploy, no Desktop tag, no Fly, no Neon, no migration, no database writes outside the local test and
  dev databases. The operator merges after the architect's audit; it ships with the next release.
- **Nothing a user sees changes.** No screen, label, button, link, setting or behaviour removed or
  altered. The operator's "additive only" rule still holds for the product: this milestone removes only
  what nothing uses. (The visible-text check below proves it.)
- **No dependency changes.** Every `package.json`, `package-lock.json`, `backend/pyproject.toml` and
  `backend/uv.lock` stays byte-identical. Unused dependencies are listed, not removed. Analysis tools
  run through `uvx` / `npx` and are never added to the project.

## State on disk (checked by the architect, 2026-10-20)

- `main` = `65d4b194` (the Sidechat-23/24 docs commit on top of V3b `7ec86760`). `origin/main` =
  `6b35addc` = production (Fly v46, Desktop `desktop-v0.27.0`, alembic `0053`). Push guard:
  `remote.origin.pushurl` = `DISABLED-no-push-during-video-work`.
- Floors at 0.27.0's ship (V3/V3b since then touched only `video/**`): `make test` 3555 passed /
  1 xfailed; vitest 2776; desktop 161; `make lint` 38 (the baseline); e2e 21 pass + 3 known fails
  (`work_brief`, `steering` at 1280×720, `thinker_chain` — its template was removed on 07-03).
- Blobs on `main`: `backend/tvashtr/control_plane/team_run.py` `9a22d313d5c9`;
  `desktop/electron/runner/grokLock.cjs` `18fd231559de`; `desktop/electron/harness/spawnEnv.cjs`
  `7834802de55f` (it has a known open issue with its own future milestone — don't touch it). DBOS
  application versions `3011d7ac…` (local) / `c7320dd5…` (fly mode) — compute them the way the ship
  sessions did (see the end of `STATE.md`).
- The working tree holds many **untracked files that are the operator's** (agent configs, `design/`,
  `graphify-out/`, `frontend/undefined/`, `backend/greeting.txt`, `FINAL-REPORT-…md`, …). **Never touch,
  stage, move or delete an untracked file.** This milestone covers tracked files only.

## Scope

- **May edit or delete** (tracked files only): `backend/tvashtr/**`, `backend/tests/**`,
  `frontend/src/**`, `frontend/e2e/**`, `desktop/electron/**`, `desktop/scripts/**`, top-level
  `scripts/*.py` and `scripts/*.sh`, and `Makefile` (only to remove a target whose whole recipe runs
  code this session deletes).
- **Never edit — but DO search them as callers:** `backend/alembic/**`, `video/**`,
  `scripts/design-parity/**`, `docs/**`, `design/`, `prompts/`, `.claude/**`, `.github/**`, `fly.toml`,
  `Dockerfile`, every package/lock file, `.env`, `HANDOVER.md`, `PROJECTPLAN.md`.
- **Byte-identical:** `team_run.py`, `grokLock.cjs`, `spawnEnv.cjs`, and the body of
  `build_two_node_team` in `control_plane/teams.py`.

## Rule 0 — commit first, then delete

- At start the tracked tree is clean (`git diff --quiet && git diff --cached --quiet`) on `main`
  `65d4b194`. Create the branch before any edit.
- Each commit holds **one kind of change in one area** (e.g. `chore(prune): remove unused backend
  helpers — dead code, round 1`), so any one of them can be undone with `git revert <sha>`. Never
  `reset --hard`, force, stash, rebase or amend.
- **No proof, no deletion.** The proof is recorded before the delete, in the ledger (below).

## Pass 0 — the keep list (the trap). Build it FIRST, post it, apply it in every pass

These look unused because something outside our code calls them. They stay, whatever a tool says.

1. **Called from outside:** the GitHub App webhook and GitHub sign-in callbacks; connector OAuth
   callbacks (`connector_oauth.py`); web sign-in (`web_signin.py`) and Desktop sign-in
   (`desktop_auth.py`); the routes the Desktop's main process calls (`desktop_runner_routes.py`,
   `desktop_jobs.py`, `desktop_asks.py`, read from `desktop/electron/runner/api.cjs` and the rest of
   `desktop/electron/`); `desktop_release` (download page + updater); `/health` and `/healthz` (Fly's
   health check uses `/healthz`); the `tvashtr://` deep-link handlers; `site_info`.
2. **Called by agents at run time, not by our UI:** `node_tools` (Domains run token),
   `connector_proxy` (run tokens; MCP servers inside sandboxes), `domain_mcp`, the tool/skill
   catalogue, the LiteLLM admin/proxy calls.
3. **Run by a schedule or the durable engine:** every function decorated `@DBOS.*` (workflow, step,
   scheduled, transaction) or registered with DBOS — including `hello_durable.py`, `stall_sweep`,
   `workspace_reaper`, `clone_reaper`, `fly_reaper`. Never delete or edit a decorated function. The
   count of `@DBOS.` decorators under `backend/tvashtr` stays identical and the app versions stay equal.
4. **Looked up by name or string:** guardrail kinds (`secret_leak_scan`,
   `diff_touches_forbidden_paths`, `output_schema_check`, `tests_pass`), node/team template builders and
   the template library, `PROVIDER_CATALOGUE` entries, `data/connector_registry.jsonl`, engine
   adapters, Electron IPC channel names (`preload.cjs` ↔ `ipcMain` handlers), React lazy routes,
   `data-testid` values and CSS class names used by e2e / design-parity / the video camera, pytest
   fixtures in `conftest.py`, pydantic validators, **every `Settings` field** (a Fly secret may set it),
   and **SQLAlchemy models and columns** (that's the schema — never touched).
5. **Reads stored data:** code that reads a shape that can exist in the database, in DBOS's recorded
   step outputs (e.g. `load_graph_step`'s dict keys), in exported team files, in `run_events`
   payloads or in saved settings — even when no current code writes that shape. Old runs, replays and
   imports still need it.
6. **Used by tools we keep:** every Makefile target is an entry point a human runs, and every script
   it calls is live; `scripts/design-parity/**` and `video/**` import frontend and backend code —
   whatever they import is live; the `desktop/scripts` gates and build scripts; the CI workflow.
7. **Old Desktop apps:** an installed Desktop app bundles its own frontend and calls tvashtr.fly.dev.
   A route whose path appears in any `desktop-v*` tag's `frontend/` or `desktop/` tree counts as called
   (Pass 2).
8. **Security code:** owner-scope checks, run-token checks, redaction, the git hooks, `grokLock.cjs`.
   No edits inside a security check at all; a wholly unreachable one is listed for the architect, not
   deleted.

Post `KEEP-LIST:` (each entry: path or pattern + why) before Pass 1.

## Pass 1 — dead code (files, functions, classes, components, exports, constants, branches)

Tools find candidates; they never prove anything. Run (none added to the project):
`uvx vulture backend/tvashtr backend/tests --min-confidence 60`; `ruff check --select F401,F811,F841`;
`npx knip` for `frontend/` and `desktop/`; a one-off `npx tsc --noEmit --noUnusedLocals
--noUnusedParameters` (tsconfig unchanged).

A candidate is dead only when **all** of these hold, each recorded:
- (a) **No reference by name anywhere in the repo** — `git grep -nw <name>` across **all tracked
  files**, including the out-of-scope folders and non-code files (JSON, JSONL, YAML, TOML, Makefile,
  `.md`, HTML), shows only its own definition and its own tests. History files —
  `PROJECTPLAN.md`, `HANDOVER.md`, `prompts/**`, `docs/superpowers/**` — are not callers; note any
  mention there in the ledger.
- (b) **No dynamic use** — no string lookup, `getattr`, registry, import-by-path, lazy import or IPC
  string reaches it.
- (c) **Not on the keep list.**
- (d) For a file: nothing imports it, and no build or config file names it.

Delete its tests with it — only tests of the deleted thing, each listed. Repeat in rounds until a round
finds nothing new (deleting one thing can make another dead), at most 4 rounds. Commented-out code
blocks and unreachable branches (after a `return`, `if False`, a flag constant at every call site)
count as dead code, at the same proof standard.

**Scripts:** a top-level script that no Makefile target, other script, CI file or current doc names is
deleted only if it is already broken (it imports or calls something that no longer exists — show the
error). One that still runs is listed as `UNCALLED-SCRIPT` for the architect. A Makefile target whose
feature is gone (e.g. `thinker-chain-e2e`, if its template really is gone — prove it) is removed with
its script.

**Ledger** (in `STATE.md` and echoed): `path:symbol | kind | flagged by | proof command → result |
tests removed | commit`.

## Pass 2 — zombie routes

List every backend route from the app's own route table (not grep): method, path, handler, and every
caller with `file:line`, by kind — website/Desktop frontend, Desktop main process, agents/sandbox,
scripts/Makefile, external (keep list), tests (tests are not callers).

For each route with no non-test caller in current code, check old Desktop apps:
`git grep -n "<the path's static prefix>" $(git tag -l 'desktop-v*') -- frontend desktop`.
- No caller anywhere, in no tag, not on the keep list → delete the handler, the helpers that become
  dead (Pass 1's rules), its tests and its row in `backend/tests/test_owner_scope_guard.py`.
- Called only by an old tag → keep; list as `OLD-CLIENT-ONLY` with the newest tag that calls it.
- Unsure → keep and list.

Post `ROUTES:` (counts) and the full table (also in `STATE.md`).

## Pass 3 — duplicates

`npx jscpd` over `backend/tvashtr`, `frontend/src` and `desktop/electron` (about 8 lines / 60 tokens
minimum). Also look for the same logic written twice in different words: money/time/plan-name
formatters, provider-name maps, path guards, error-to-sentence mappers.

For each group:
- **Copies that behave the same today** → one function in the most natural existing module, every call
  site using it. First a test at each call site that passes before the merge (write it if none
  exists); it passes after.
- **Copies that have drifted** (one has a fix or a case the other lacks) → never pick one silently. If
  the difference is a plain bug in one copy, you may merge onto the correct version only with a
  regression test shown **failing first** at the buggy call site (a code-proven, contained fix).
  Otherwise list it as `DRIFT` with both versions and the difference.
- **Copies in keep-list, DBOS or security code** → list, don't touch.
- Tests may repeat themselves; don't dedupe tests.

## Pass 4 — /simplify

Run Claude Code's bundled **`/simplify`** skill on this branch's changes (`git diff main...HEAD`). It
runs four review agents in parallel — reuse of existing helpers, simplification, efficiency, and
whether the change sits at the right level of abstraction — and applies fixes. If you can't invoke it
yourself, run that same four-angle review with four parallel subagents over the files this branch
touched. Keep only fixes that remove or merge code, or simplify without changing behaviour, with tests
green; revert anything else and list it as a suggestion. It never touches keep-list code.

## Gates (on the final head; echo each command and its decisive line)

- **Baseline first**, before any deletion: the gates below on `65d4b194`, the `@DBOS.` count, the app
  versions, the untracked-file list (`git ls-files --others --exclude-standard`), and the visible-text
  snapshot.
- `make test` on `tvashtr_gate` (one line proving the database): 0 failed; passed ≥ 3555 minus the
  tests removed with deleted code (listed). Any other drop is a failure.
- `cd frontend && npx vitest run` (≥ 2776 minus listed), `npx tsc --noEmit`, `npm run build`;
  `cd desktop && npm test` (≥ 161 minus listed).
- `make lint`: ≤ 38, no new error.
- e2e against a real local stack (clear stale runs and PENDING DBOS workflows first): `revamp-shell`
  and every `frontend/e2e` spec and `scripts/*_e2e.sh` the baseline ran — the same passes as the
  baseline; the 3 known fails fail the same way, or are deleted with proof (say which).
- **Visible-text check:** with the local stack and the seeded account, headless Playwright visits every
  route in the frontend router (website and Desktop-shell paths; sample-data mode allowed) and saves
  each page's visible text plus the list of buttons, links and inputs by accessible name. Once on the
  baseline, once on the final head. **The diff must be empty.**
- **Live:** `make demo-proof` C1–C12 with a real PR (`make seed` first; up to 3 attempts for provider
  flakes — if every attempt fails on a provider's error, not the product's, record the decisive line
  and carry on). If any route, any `desktop/**` file or any backend `desktop_*` module changed, also the
  Desktop live gate `node desktop/scripts/live-subscription-gate.mjs` to a real PR on the Claude
  subscription (1 run). Not needed → say why.
- **Invariants (`main..HEAD`):**
  - `git diff --stat main -- backend/alembic video scripts/design-parity docs design prompts .claude
    .github fly.toml Dockerfile` → empty;
  - `git diff --stat main -- frontend/package.json frontend/package-lock.json desktop/package.json
    desktop/package-lock.json backend/pyproject.toml backend/uv.lock` → empty;
  - blobs `team_run.py` `9a22d313d5c9`, `grokLock.cjs` `18fd231559de`, `spawnEnv.cjs`
    `7834802de55f`; `build_two_node_team`'s body identical;
  - `@DBOS.` count equal before/after; app versions `3011d7ac…` / `c7320dd5…` unchanged;
  - asserts removed only with deleted code: `git diff main -- backend/tests frontend/src frontend/e2e
    desktop/scripts | grep -E '^-\s*(assert |expect\()'` — every hit belongs to a deleted test of
    deleted code (list them);
  - the untracked-file list equal before/after.
- **Net:** `git diff --shortstat main`, plus the count of files deleted.

## Stop with NEEDS_HUMAN (to `STATE.md`, echoed, with the FINAL REPORT)

- At start: `main` isn't `65d4b194`, the push guard isn't the dummy value, tracked changes are present,
  or :8000 / :5173 are held.
- A gate fails and `git revert` of the responsible prune commit doesn't bring it back, or the cause
  needs a broad or unproven change.
- The DBOS app version changes and you can't trace the commit.
- `make demo-proof` or the Desktop gate fails for a product reason after reverting the suspects.
- The Desktop gate needs a sign-in that has expired (Claude CLI or GitHub) — say which; never sign in yourself.
- A safeguards notice.

**Not stops:** a candidate you can't prove dead (keep it, list it); a drifted duplicate (list it); an
`OLD-CLIENT-ONLY` route (list it); a provider flake on all three demo-proof tries (record it, carry on).

## Rules

Auto mode, never bypass. No push, force, `reset --hard`, stash, rebase or amend; never change git
config. `.env` is fenced: load it per command with `DATABASE_URL` overridden; never open, copy, print or
edit it. Never print a key, token, cookie or connection string; never open CLI credential files. Tests
on `tvashtr_gate`, never on `tvashtr_film`, never next to a running stack. One stack, one Desktop.
`caffeinate -dimsu` for the session. Three-attempt rule. Time box 8 hours. Safe state at any stop:
nothing running, on `chore/prune-1`, tracked tree clean.

## Evidence lines

`PREFLIGHT: main=<sha> pushurl=<value> tracked=clean docker=<ok> ports=free` ·
`BASELINE: make test <n>/<n>xf, vitest <n>, tsc ok, build ok, desktop <n>, lint <n>, e2e <pass>/<fails>,
dbos decorators <n>, app versions <a>/<b>, visible-text <n> pages, untracked <n>` ·
`KEEP-LIST: <n> entries` (+ the list) · `DEAD-CODE round <k>: <n> candidates, <n> deleted, <n> kept`
(+ the ledger) · `ROUTES: <n> total, <n> called, <n> keep-list, <n> old-client-only, <n> deleted`
(+ the table) · `DUPLICATES: <n> groups, <n> merged, <n> drift (listed), <n> left` ·
`SIMPLIFY: <skill|four subagents>, <n> applied, <n> suggestions` · `GATES: …` (as BASELINE) ·
`VISIBLE-TEXT: <n> pages, diff empty` · `LIVE: demo-proof C1–C12 PR #<n> | provider FAIL: <line>;
desktop gate PR #<n> | not needed: <why>` · `INVARIANTS: …` (each item above) ·
`NET: <n> files deleted, -<n>/+<n> lines` · `READY_TO_MERGE chore/prune-1 <sha>`.

## Close

Echo `READY_TO_MERGE chore/prune-1 <sha>`, then the eight-section FINAL REPORT (CLI-RULES §4.7). In
section 7 list everything that needs a ruling: `OLD-CLIENT-ONLY` routes, `DRIFT` groups,
`UNCALLED-SCRIPT`s, candidates you couldn't prove dead, unused dependencies, and the `/simplify`
suggestions you didn't apply.
