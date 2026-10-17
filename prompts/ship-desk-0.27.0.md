# Brief — Ship M-desk-8 (Desktop 0.27.0 + a Fly deploy) to production

Architect: Tvashtr Sidechat-24, 2026-10-16. Path: `/Users/adimac/Desktop/Tvashtr/prompts/ship-desk-0.27.0.md`.
`prompts/`, `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md` and `design/` belong to the architect: never stage
or commit them. Where this brief and `prompts/CLI-RULES.md` differ, this brief wins. The ship steps
follow the Ship Protocol of `prompts/m1-m11.md` §6 (read it), adapted below; the previous ship's brief
`prompts/ship-desk-bundle.md` is the template. **This session builds nothing:** it bumps the Desktop
version, gates, pushes, and ships on the operator's approval.

## What ships (checked by the architect on disk, 2026-10-16)

- Production today: `origin/main` = **`938dbde6`** → Fly **v45** (image
  `deployment-01M4ZKH1935RAKWJS8QDF7ZY1Z` — the rollback target), Desktop **`desktop-v0.26.0`**,
  alembic head **`0053`**.
- Local `main` = **`c90e2e96`**, a fast-forward of `origin/main` carrying: **M-desk-8** (`0b001b88`,
  10 commits: P1–P6, the on-screen wording fixes — gate cards read their titles, a Tests check's loop
  arc reads "tests failed", an approval's verdict line shows its reasons, a subscription round's cost
  row names its plan, Ask answers render markdown, the resume confirm never says "when you approve"
  for a check) and **video V2b** (both sittings; only `video/**`).
- Backend changed in three files only — `control_plane/activity.py`, `control_plane/resume.py`,
  `routers.py` (one additive field, `plan`, on `GET /api/runs/{run_id}/graph`). **No new route. No
  migration** (head stays `0053`). **`team_run.py` unchanged** (blob `9a22d313d5c9`) → the DBOS
  application versions are unchanged (local `3011d7ac…`, fly-mode `c7320dd5…` = production's), so
  queued work and scheduled sweeps survive the deploy. Drain live runs anyway.
- **No Neon snapshot this time:** no migration and no executor change, so a rollback is the v45 image
  alone. (Neon had 4 branches on 10-15; don't add one.)
- `frontend/` changed (the Desktop bundles it) → Desktop **`0.27.0`** (today `desktop/package.json` =
  `0.26.0`). `desktop/` source itself is unchanged.
- **S4b is NOT in this release** (deferred by the operator 10-16); `desktop/electron/runner/grokLock.cjs`
  is byte-identical to 0.26.0's (blob `18fd231559de`).
- **`lazyxgenius/Tvashtr` is a PUBLIC repository.** Everything pushed is public — including
  `video/fixtures/live-base.json` (recorded app responses): PUSH_SCAN must cover it line by line.

## Rules

1. **Permission mode: auto**, never bypass. Production steps (`fly deploy`, the `desktop-v*` tag) run
   only after the operator pastes back the approval line you post (step 6). If the classifier blocks a
   routine step, say in one line what you need and why; don't work around it.
2. **Push only `main` and the tag `desktop-v0.27.0`.** No other branch (`feat/*`, `video/*`,
   `ship/*`, `claude/*` all stay local). Never force, never `reset --hard`, never rebase `main`.
3. **The push guard:** the operator unsets it before launch; preflight proves
   `git config --get remote.origin.pushurl` prints nothing. Never change git config yourself.
4. **Fly:** the operator signs in before launch (`fly auth whoami` in preflight). Secrets stay the
   operator's: `fly secrets list` only, never `set`/`unset`.
5. **`.env` is fenced:** load it per command with `DATABASE_URL` overridden; never open, copy, print or
   edit it. Never print a connection string, key, token or cookie; never open CLI credential files.
6. **Production data:** read-only. Any query you run on production prints counts and run ids only.
7. **One stack:** tests on their own database (`tvashtr_gate`), never next to a running stack, never
   on `tvashtr_film` (it holds the film's runs — don't touch it).
8. **Three-attempt rule; time box 6 hours** (waiting for the approval doesn't count).
9. **Safe state at any stop:** nothing running, checkout on `main`, clean apart from the operator's
   files; production either on the new release with a passing smoke, or rolled back to v45's image with
   health confirmed.

## Steps (echo each evidence line as it completes)

1. **Preflight.** `git fetch origin`: `origin/main` must still be `938dbde6` and `main` `c90e2e96`
   (anything else → NEEDS_HUMAN; don't merge `origin/main` in). The push guard is unset. `fly auth
   whoami` answers (signed out → NEEDS_HUMAN at once, before any gate). Docker up; nothing on
   :8000/:5173. `fly status -a tvashtr` (release v45, image as above).
2. **Version.** Branch `ship/desktop-0.27.0` from `main`; bump `desktop/package.json` (and its lock) to
   `0.27.0`; one commit `chore(desktop): 0.27.0`.
3. **Gates on that commit** (echo each command and its decisive line):
   - `make test` on `tvashtr_gate` (one line proving the database): 0 failed, ≥ 3555 passed.
   - `cd frontend && npx vitest run` (≥ 2776; the unhandled error from `CompareView.tsx:95` pre-exists
     on `938dbde6` — say whether it still shows), `npx tsc --noEmit`, `npm run build`;
     `cd desktop && npm test` (≥ 161).
   - `docker build -t tvashtr-ship .`
   - `make lint`: the 38-error baseline, no new errors.
   - Against a real local stack (clear stale runs and PENDING DBOS workflows first): `revamp-shell` and
     every `scripts/*_e2e.sh` spec that touches runs, gates, resume, Ask or the Desktop; then `make
     demo-proof` C1–C12 with a real PR (`make seed` first; up to 3 attempts for provider flakes — if
     every attempt fails on a provider's error, not the product's, record the decisive line and carry
     on; the operator decides at the approval). Three specs are known to fail on production's code
     too (`work_brief`, `steering` at 1280×720, `thinker_chain`): if one fails, run it on `938dbde6`;
     the same failure there = pre-existing (say so), a new failure = a product failure.
   - **Invariants across `938dbde6..ship/desktop-0.27.0`:** `git diff --stat -- backend/alembic` empty;
     `team_run.py` blob `9a22d313d5c9`; `grokLock.cjs` blob `18fd231559de`; no assertion weakened
     (`git diff -- backend/tests frontend/src frontend/e2e desktop/scripts | grep -E
     '^-\s*(assert |expect\()'` — explain every hit); nothing from `design/`, `prompts/`, `STATE.md`,
     `HANDOVER.md` or `PROJECTPLAN.md` in the range; the DBOS application versions computed for `main`
     equal `3011d7ac…`/`c7320dd5…`.
   - **`PUSH_SCAN`:** scan every file the push adds or changes (`git diff 938dbde6 <sha> --name-only`,
     contents and commit messages; `video/fixtures/live-base.json` line by line) for keys, tokens,
     passwords, connection strings, cookies and session ids (`sk-…`, `ghp_…`, `gho_…`, `xai-…`, `AKIA…`,
     `postgres://…:…@`, `-----BEGIN`, JWT-shaped strings, `Set-Cookie`/`Cookie:` values). Any hit →
     stop NEEDS_HUMAN with the path and line number only (never the value).
4. **Merge and push `main`.** From the main checkout: `git checkout main && git merge --ff-only
   ship/desktop-0.27.0 && git push origin main`. Never force; if anything refuses, stop NEEDS_HUMAN.
5. **Drain check (before asking).** (a) `fly apps list`: no `tv-run-*` app; (b) a read-only count on
   production through the running app (`fly ssh console -a tvashtr -C "<a short python using the app's
   own settings>"`) of runs queued or running and of Desktop jobs queued or claimed — counts and run
   ids only; runs parked at a human gate are listed and may stay (`team_run.py` is unchanged); (c)
   `fly logs` quiet for 2 minutes.
6. **Ask for the ship approval.** Echo a SHIP REQUEST: the `main` sha, every gate's decisive line, the
   drain result, "no migration (0053), team_run.py unchanged, app versions unchanged, no Neon
   snapshot", Desktop `0.27.0`, and this line filled in for the operator to paste back:
   `APPROVED desk-8 ship: no Neon snapshot (no migration, team_run.py unchanged), drain live runs, fly deploy main <sha> to app tvashtr (alembic stays at 0053), roll back to v45's image if the smoke fails, then push tag desktop-v0.27.0.`
   Wait. Act only on an approval naming this sha; if `main` moved, post a fresh request.
7. **On approval:** (a) re-run the drain check; any run queued or running → wait (re-check every 5
   minutes) up to 30 minutes, then ask the operator instead of deploying. (b) `fly deploy -a tvashtr`;
   confirm the release command's `alembic upgrade head` was a no-op at `0053`. (c) **Smoke:** `/health`
   `{"status":"ok","db":"ok"}` and `/healthz`; headless Playwright loads the landing and sign-in pages
   with 0 page errors; the JS asset in the live `index.html` equals your local build's; `make
   deploy-smoke` 0 failed; `GET /api/runs/<any id>/graph` answers 401 without a session, never 500; 0
   5xx and 0 tracebacks in `fly logs` for 5 minutes; a scheduled DBOS sweep logs normally on
   `c7320dd5…`. Run `make demo-proof-prod` only if its saved session is still valid (say which).
   **If the smoke fails:** `fly deploy --image deployment-01M4ZKH1935RAKWJS8QDF7ZY1Z -a tvashtr`,
   confirm health, write NEEDS_HUMAN and stop.
8. **Desktop release:** `git tag desktop-v0.27.0 <main sha> && git push origin desktop-v0.27.0`; wait
   for the "Desktop Mac Release" workflow (poll the public API; up to 30 minutes); download
   `Tvashtr-mac.dmg` from the release, mount it read-only (`hdiutil attach -nobrowse -readonly`),
   confirm the app's version is `0.27.0`, its bundled JS asset equals the live one, and the bundle still
   holds `electron/runner/grokLock.cjs`; detach. A workflow not done in 30 minutes → record it as an
   operator check and finish.
9. **Close.** Echo `SHIPPED: main=<sha> fly=v<N> desktop=desktop-v0.27.0`, then the eight-section FINAL
   REPORT (CLI-RULES §4.7) with a ship table and every evidence line, and the line: "Operator: put the
   push guard back — `git config --local remote.origin.pushurl DISABLED-no-push-during-video-work`".

## Evidence lines

`PREFLIGHT: main=<sha> origin=<sha> pushurl=unset fly_auth=<ok> fly=<release>` · `BUMP: <sha>` ·
`GATES: make test <n>/<n>, vitest <n>, tsc ok, build ok, desktop <n>, docker ok, lint 38, e2e <list>,
demo-proof <PASS|provider FAIL: line>` · `INVARIANTS: alembic none, team_run 9a22d313d5c9, grokLock
18fd231559de, asserts removed <n> (explained), app versions 3011d7ac/c7320dd5` · `PUSH_SCAN: 0 hits` ·
`PUSHED: main <old>..<new>` · `DRAIN: tv-run apps 0, queued/running <n>, parked at gates <ids>` ·
`SHIP REQUEST …` · `APPROVAL: <received line>` · `DEPLOY: fly v<N> image <…> alembic 0053 (no-op)` ·
`SMOKE: <each check> PASS|FAIL` · `DESKTOP: desktop-v0.27.0 workflow <status> dmg 0.27.0 asset <match>
grokLock present` · `SHIPPED: …`.

## Stop with NEEDS_HUMAN (written to STATE.md and echoed, with the FINAL REPORT) when

- `origin/main` isn't `938dbde6`, `main` isn't `c90e2e96`, the push guard is still set, or Fly is
  signed out;
- a gate fails for a product reason after three attempts, or `PUSH_SCAN` finds anything;
- runs stay queued or running after 30 minutes;
- the smoke fails (after the rollback);
- the classifier blocks a production step the approval named.
