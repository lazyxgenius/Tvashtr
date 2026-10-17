# Brief — Ship the Desktop bundle (M-desk-routes → M-desk-7) to production

Architect: Tvashtr Sidechat-23, 2026-10-14. Path: `/Users/adimac/Desktop/Tvashtr/prompts/ship-desk-bundle.md`.
`prompts/`, `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md` and `design/` belong to the architect: never stage
or commit them. Where this brief and `prompts/CLI-RULES.md` differ, this brief wins. The ship steps
follow the Ship Protocol of `prompts/m1-m11.md` §6 (read it), adapted below. **This session builds
nothing:** it bumps the Desktop version, gates, pushes, and ships on the operator's approval.

## What ships (checked by the architect on disk, 2026-10-14)

- Production today: `origin/main` = `e30b8bd9` → Fly **v44**, Desktop **`desktop-v0.25.0`**, alembic
  head **`0052`**.
- Local `main` = **`71ca1078`**, a fast-forward of `origin/main` carrying (in order): video V0, the
  Desktop subscriptions gate fix, **M-desk-routes** (migration **`0053`**), **M-desk-2**, the DBOS
  scheduled-sweep fix, **M-desk-3**, **M-desk-4**, video V1, **M-desk-5**, video V2, **M-desk-6** (the
  Tests check; `team_run.py`'s gate arm changed), an architect docs commit (`69d5a5b9`), **M-desk-7**
  (Grok locked to its job's copy; the runner's git no longer runs anything a job wrote; F1, F2).
- `0053_desktop_routes.py` is additive (two nullable columns, one new table): code v44 still runs on
  it, so an image rollback is safe without touching the database.
- `team_run.py` changed only in `run_graph`'s gate arm (a plain helper); the DBOS application versions
  are unchanged (local `3011d7ac…`, **fly-mode `c7320dd5…` = production's**), so production's queued
  work and scheduled sweeps survive the deploy. Drain live runs anyway (below).
- `frontend/` and `desktop/` changed → Desktop **`0.26.0`** (today `desktop/package.json` = `0.25.0`).
- **Why now, before the film is finished:** M-desk-7 closes two holes in the Desktop people have
  (0.25.0) — a job could plant a git setting that Tvashtr's own git then ran on the user's Mac, and the
  Grok CLI could read the whole home folder. The film's last live checks (6.3's queued-lane and
  estimate wording, 2.7's first second) are not run yet; the operator accepted shipping without them.
- **`lazyxgenius/Tvashtr` is a PUBLIC repository.** Everything pushed is public.

## Rules

1. **Permission mode: auto**, never bypass. Production steps (Neon snapshot, `fly deploy`, the
   `desktop-v*` tag) run only after the operator pastes back the approval line you post (step 6). If
   the classifier blocks a routine step, say in one line what you need and why; don't work around it.
2. **Push only `main` and the tag `desktop-v0.26.0`.** No other branch (`video/v2b-refilm`, `feat/*`,
   `video/*`, `claude/*` all stay local). Never force, never `reset --hard`, never rebase `main`.
3. **The push guard:** the operator unsets it before launch; preflight proves
   `git config --get remote.origin.pushurl` prints nothing. Never change git config yourself.
4. **Fly secrets stay the operator's:** `fly secrets list` only, never `set`/`unset`.
5. **`.env` is fenced:** load it per command with `DATABASE_URL` overridden; never open, copy, print or
   edit it. Never print a connection string, key, token or cookie; never open CLI credential files.
6. **Production data:** read-only apart from the migration. Any query you run on production prints
   counts and run ids only.
7. **One stack:** tests on their own database (`tvashtr_gate`), never next to a running stack, never
   on `tvashtr_film` (it holds the unfinished film's runs — don't touch it).
8. **Three-attempt rule; time box 6 hours** (waiting for the approval doesn't count).
9. **Safe state at any stop:** nothing running, checkout on `main`, clean apart from the operator's
   untracked files; production either on the new release with a passing smoke, or rolled back to v44's
   image with health confirmed.

## Steps (echo each evidence line as it completes)

1. **Preflight.** `git fetch origin`: `origin/main` must still be `e30b8bd9` and `main` `71ca1078`
   (anything else → NEEDS_HUMAN; don't merge `origin/main` in). The push guard is unset. Docker up;
   nothing on :8000/:5173. `fly status -a tvashtr` (release, image). Find the signed-in `neon` CLI (the
   last one used was under `~/.npm/_npx/*/node_modules/.bin/neon`; see
   `prompts/housekeeping-2026-10-01.record.md` for the exact calls) and echo `neon branches list
   --project-id billowing-mud-37479513` with the count — the plan allows 10; at 9 or more stop and ask
   the operator which snapshot to delete (never delete one yourself).
2. **Version.** Branch `ship/desktop-0.26.0` from `main`; bump `desktop/package.json` (and its lock) to
   `0.26.0`; one commit `chore(desktop): 0.26.0`.
3. **Gates on that commit** (echo each command and its decisive line):
   - `make test` on `tvashtr_gate` (create/migrate it if needed; one line proving the database): 0
     failed, ≥ 3550 passed.
   - `cd frontend && npx vitest run` (≥ 2770; the unhandled error in `ComparePage.desktop.test.tsx`
     pre-exists on `69d5a5b9` — say whether it still shows), `npx tsc --noEmit`, `npm run build`;
     `cd desktop && npm test` (≥ 161).
   - `docker build -t tvashtr-ship .`
   - `make lint`: the 38-error baseline, no new errors.
   - Against a real local stack (clear stale runs and PENDING DBOS workflows first): `revamp-shell` and
     every `scripts/*_e2e.sh` spec that touches runs, gates or the Desktop; then `make demo-proof`
     C1–C12 with a real PR (`make seed` first; up to 3 attempts for provider flakes — if every attempt
     fails on a provider's error, not the product's, record the decisive line and carry on; the
     operator decides at the approval).
   - **Invariants across `e30b8bd9..ship/desktop-0.26.0`:** `git diff --stat -- backend/alembic` lists
     only `0053` (new); no assertion weakened (`git diff -- backend/tests frontend/src frontend/e2e
     desktop/scripts | grep -E '^-\s*(assert |expect\()'` — explain every hit); nothing from `design/`
     or `STATE.md` committed (the architect's docs commit `69d5a5b9` is expected — list its paths);
     the DBOS application versions computed for `main` equal `3011d7ac…`/`c7320dd5…`.
   - **`PUSH_SCAN`:** scan every file the push adds or changes (`git diff e30b8bd9 <sha> --name-only`,
     contents and commit messages) for keys, tokens, passwords, connection strings and cookies
     (`sk-…`, `ghp_…`, `xai-…`, `AKIA…`, `postgres://…:…@`, `-----BEGIN`, JWT-shaped strings). Any hit →
     stop NEEDS_HUMAN with the path and line number only (never the value).
4. **Merge and push `main`.** From the main checkout: `git checkout main && git merge --ff-only
   ship/desktop-0.26.0 && git push origin main`. Never force; if anything refuses, stop NEEDS_HUMAN.
5. **Drain check (before asking).** (a) `fly apps list`: no `tv-run-*` app; (b) a read-only count on
   production through the running app (e.g. `fly ssh console -a tvashtr -C "<a short python using the
   app's own settings>"`) of runs whose status is queued or running, and of Desktop jobs queued or
   claimed — counts and run ids only; runs parked at a human gate are listed and may stay (M-desk-6's
   recorded-walk tests prove the gate-arm change replays safely); (c) `fly logs` quiet for 2 minutes.
6. **Ask for the ship approval.** Echo a SHIP REQUEST: the `main` sha, every gate's decisive line, the
   drain result, migration `0053` (additive), "team_run.py changed (gate arm only); app versions
   unchanged", Desktop `0.26.0`, and this line filled in for the operator to paste back:
   `APPROVED desk-bundle ship: take Neon snapshot snap-desk-<YYYYMMDD-HHMM> of production (project billowing-mud-37479513), drain live runs, fly deploy main <sha> to app tvashtr (runs alembic upgrade head: 0053), roll back to the previous image if the smoke fails, then push tag desktop-v0.26.0.`
   Wait. Act only on an approval naming this sha; if `main` moved, post a fresh request.
7. **On approval:** (a) `neon branches create --project-id billowing-mud-37479513 --name
   snap-desk-<…> --parent production --no-compute --no-secrets -o json`; echo the branch list. (b)
   Re-run the drain check; any run queued or running → wait (re-check every 5 minutes) up to 30
   minutes, then ask the operator instead of deploying. (c) `fly deploy -a tvashtr`; confirm the release
   command ran `alembic upgrade head` to `0053`. (d) **Smoke:** `/health` `{"status":"ok","db":"ok"}`
   and `/healthz`; headless Playwright loads the landing and sign-in pages with 0 page errors; the JS
   asset in the live `index.html` equals your local build's; `make deploy-smoke` 0 failed; every API
   route added since `e30b8bd9` (list them from the routers' diff) answers 401 without a session, never
   500; 0 5xx and 0 tracebacks in `fly logs` for 5 minutes; a scheduled DBOS sweep logs normally. Run
   `make demo-proof-prod` only if its saved session is still valid (say which). **If the smoke fails:**
   `fly releases --image -a tvashtr`, `fly deploy --image <v44's image>`, confirm health, write
   NEEDS_HUMAN and stop (the database keeps `0053`, which v44 runs on; restoring the snapshot is the
   operator's call only).
8. **Desktop release:** `git tag desktop-v0.26.0 <main sha> && git push origin desktop-v0.26.0`; wait
   for the "Desktop Mac Release" workflow (poll the public API; up to 30 minutes); download
   `Tvashtr-mac.dmg` from the release, mount it read-only (`hdiutil attach -nobrowse -readonly`),
   confirm the app's version is `0.26.0`, its bundled JS asset equals the live one, and the bundle holds
   `electron/runner/grokLock.cjs`; detach. A workflow not done in 30 minutes → record it as an operator
   check and finish.
9. **Close.** Echo `SHIPPED: main=<sha> fly=v<N> desktop=desktop-v0.26.0 neon=<snapshot>`, then the
   eight-section FINAL REPORT (CLI-RULES §4.7) with a ship table and every evidence line, and the
   line: "Operator: put the push guard back —
   `git config --local remote.origin.pushurl DISABLED-no-push-during-video-work`".

## Evidence lines

`PREFLIGHT: main=<sha> origin=<sha> pushurl=unset fly=<release> neon_branches=<n>` · `BUMP: <sha>` ·
`GATES: make test <n>/<n>, vitest <n>, tsc ok, build ok, desktop <n>, docker ok, lint 38, e2e <list>,
demo-proof <PASS|provider FAIL: line>` · `INVARIANTS: alembic +0053 only, asserts removed <n>
(explained), app versions 3011d7ac/c7320dd5` · `PUSH_SCAN: 0 hits` · `PUSHED: main <old>..<new>` ·
`DRAIN: tv-run apps 0, queued/running <n>, parked at gates <ids>` · `SHIP REQUEST …` ·
`APPROVAL: <received line>` · `NEON: snap-desk-<…> <id>, branches <n>` · `DEPLOY: fly v<N> image
<…> alembic 0053` · `SMOKE: <each check> PASS|FAIL` · `DESKTOP: desktop-v0.26.0 workflow <status>
dmg 0.26.0 asset <match> grokLock present` · `SHIPPED: …`.

## Stop with NEEDS_HUMAN (written to STATE.md and echoed, with the FINAL REPORT) when

- `origin/main` isn't `e30b8bd9`, `main` isn't `71ca1078`, or the push guard is still set;
- a gate fails for a product reason after three attempts, or `PUSH_SCAN` finds anything;
- Neon is at 9 or more branches, or the snapshot fails;
- runs stay queued or running after 30 minutes;
- the smoke fails (after the rollback);
- the classifier blocks a production step the approval named.
