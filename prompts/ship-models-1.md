# Brief — Ship Google Cloud 1 + Models 1 to production (Fly + one migration)

Architect: Tvashtr Sidechat-28, 2026-11-01. Path: `/Users/adimac/Desktop/Tvashtr/prompts/ship-models-1.md`.
Model: **Sonnet 5.5, effort high**, Code tab, auto mode. The operator is on the **Claude Pro plan**.
`prompts/`, `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md` and `design/` belong to the architect: never stage or commit them.
Where this brief and `prompts/CLI-RULES.md` differ, this brief wins. Template: `prompts/ship-landing-1.md` (the last ship) and
`prompts/ship-desk-bundle.md` (the last ship with a migration and a Neon snapshot). **This session builds nothing.** It gates,
takes a snapshot, pushes `main` and deploys — the production steps only on the operator's approval.

## What ships (checked by the architect on disk, 2026-11-01)

- Production today: `origin/main` = **`8cf90334`** → Fly **v47** (image `deployment-01M69AGBH5GE81KC66970B4GM4` — the
  rollback target), alembic **`0053`**, Desktop `desktop-v0.27.0`.
- Local `main` = **`db8ab37f`** plus, by launch, **exactly one docs commit** on top (the operator's Sidechat-28 closeout:
  `HANDOVER.md`, `PROJECTPLAN.md` and files under `prompts/` only — prove it with `git show --stat`). In the range
  `8cf90334..main`: two older docs commits (`ebba75ef`, `52986900`), **Google Cloud 1** (8 commits, `5aa05280`…`97aadec0`: a
  `vertex_ai` provider shown as "Google Cloud" — Gemini on Vertex AI with a Google Cloud API key) and **Models 1** (11 commits,
  `64570b37`…`db8ab37f`: the Models area — model tests, versioned test sets, cost-first runs, results and compare).
- **One migration: `0054_model_tests`** (five new tables, additive; `downgrade()` works). `git diff 8cf90334 main --name-status
  -- backend/alembic` must show only `A backend/alembic/versions/0054_model_tests.py`. v47's code runs fine on a database at
  `0054` (it never reads the new tables) — so a rollback is v47's image alone; the database stays at `0054`.
- **A new durable workflow** (`run_model_test_workflow` + 2 steps; `@DBOS.` 75 → 78) → the DBOS application versions change:
  local `3011d7ac…` → **`cf35c932f42fb455e93de9523e6751a0`**, fly `c7320dd5…` → **`8e9305b749ba94f5ea5d846c46b1febf`**
  (Models 1's report). Recompute both on `main` and confirm. **Drain live runs before the deploy** — a run started on v47 can't be
  recovered by the new version. `team_run.py` unchanged (blob `9a22d313d5c9`).
- **Neon snapshot first** (a migration ships): project `billowing-mud-37479513`, branch name `snap-models1-<YYYYMMDD-HHMM>`.
- **No Desktop release** (architect's call): the Models pages reach the Mac app with its next release; the Desktop 0.27.0 in
  users' hands keeps working (every change is additive). No `desktop-v*` tag; `desktop/package.json` stays `0.27.0`.
- **No new Fly secrets**: Google Cloud keys are per account (Engines), like every BYOK key.
- **`lazyxgenius/Tvashtr` is PUBLIC.** New binaries in the range are exactly the seven design pictures
  `prompts/models-1-design/{Main,MainFirstTime,NewModel,Tests,EditTest,RunTests,Results}.png` (mock-ups with made-up sample
  data). Any other binary → stop.

## Rules

1. **Auto mode**, never bypass. The Neon snapshot, `git push` and `fly deploy` run only after the operator pastes back the
   approval line you post (step 5). If the classifier blocks a routine step, say in one line what you need and why.
2. **Push only `main`.** No other branch, no tag. Never force, `reset --hard`, rebase or amend.
3. **The push guard:** the operator unsets it before launch; preflight proves `git config --get remote.origin.pushurl` prints
   nothing. Never change git config yourself.
4. **Fly:** the operator signs in before launch (`fly auth whoami`). Secrets: `fly secrets list` only.
5. **Neon:** find the signed-in `neon` CLI the way `prompts/ship-desk-bundle.md` step 1 says. Never delete a branch.
6. **`.env` is fenced:** load it per command with `DATABASE_URL` overridden; never open, copy, print or edit it. Never print a
   connection string, key, token or cookie; never open CLI credential files.
7. **Production data:** read-only; any query prints counts and run ids only.
8. **One stack:** tests on their own database (`tvashtr_gate`), never next to a running stack, never on `tvashtr_film`.
9. **Three-attempt rule.** Time box 6 hours (waiting for the approval doesn't count). Pro plan: no subagents or workflows;
   update `STATE.md` after each step.
10. **Safe state at any stop:** nothing running, checkout on `main`, clean apart from the operator's files; production either on
   the new release with a passing smoke, or rolled back to v47's image with health confirmed.

## Steps (echo each evidence line as it completes)

1. **Preflight.** `git fetch origin`: `origin/main` = `8cf90334`; `main` = `db8ab37f` + one docs-only commit (show its
   `--stat`). Push guard unset. `fly auth whoami` answers; `fly status -a tvashtr` (v47, the image above). Docker up; nothing on
   :8000/:5173/:8024/:5197. `neon branches list --project-id billowing-mud-37479513` with the count — at 9 or more stop and ask
   which snapshot to delete. `.env` has `GOOGLE_CLOUD_API_KEY` and `DEEPSEEK_API_KEY` (present/absent only).
2. **Gates on `main`** (echo each command and its decisive line):
   - `make test` on `tvashtr_gate` (one line proving the database): 0 failed, ≥ 3746 passed. Known random failure:
     `test_skill_repo::test_scan_reads_a_private_repo_through_the_owners_app_installation` (fixture id collision) — if it fails,
     re-run that file alone and say so.
   - `cd frontend && npx vitest run` (≥ 2815; the one unhandled error at `CompareView.tsx:96` is known, nothing else may show),
     `npx tsc --noEmit`, `npm run build`; `cd desktop && npm test` (161).
   - `docker build -t tvashtr-ship .` — the image's JS asset equals your local build's.
   - `make lint`: no new finding — ruff's 38-error set identical to `8cf90334`'s; the exit code may stay non-zero; frontend clean.
   - Against one real local stack (`TVASHTR_HOSTED_MODE=false`; clear stale runs and PENDING DBOS workflows first):
     `website.spec.ts`, `auth.spec.ts`, `revamp-shell.spec.ts`, `domains.spec.ts`, `google-cloud-key.spec.ts`; then
     `make model-tests-e2e` (real Google Cloud + DeepSeek calls); `make live-run-e2e TVASHTR_E2E_PROVIDER=vertex_ai
     TVASHTR_E2E_MODEL=vertex_ai/gemini-3-flash-preview`; then `make seed` and `make demo-proof` C1–C12 with a real PR (up to 3
     attempts for provider flakes; if every attempt fails on a provider's error, record the decisive line and carry on — the
     operator decides at the approval).
   - **Invariants across `8cf90334..main`:** alembic = only `0054` added; `team_run.py` blob `9a22d313d5c9`; `@DBOS.` 78; the
     two DBOS app versions computed for `main` = the values above; no package or lock file changed (prove the diff is
     empty); the binaries list above is exact.
   - **`PUSH_SCAN`:** every text file the push adds or changes and every commit message in the range, for keys, tokens,
     passwords, connection strings, cookies and session ids (`sk-…`, `gsk_…`, `ghp_…`, `gho_…`, `github_pat_…`, `xai-…`,
     `AKIA…`, `AIza…`, `AQ.…` 30+ chars, `postgres://…:…@`, `-----BEGIN`, JWT-shaped strings, `Set-Cookie`/`Cookie:` values).
     Known false positives — list each by path:line only and carry on: the scan's own pattern lists in `prompts/ship-*.md`;
     `frontend/src/pages/desktop/setup/EnginesStep.sheets.test.tsx:56`; made-up test keys in `backend/tests/test_model_tests.py`,
     `backend/tests/test_google_cloud.py` and `frontend/e2e/google-cloud-key.spec.ts`; the pattern line itself in
     `backend/tvashtr/control_plane/guardrails.py`. Any other hit → NEEDS_HUMAN with path:line only (never the value).
3. **Drain check.** (a) `fly apps list`: no `tv-run-*` app; (b) a read-only count on production through the running app
   (`fly ssh console -a tvashtr -C "<a short python using the app's own settings>"`) of runs queued or running, Desktop jobs
   queued or claimed, and DBOS workflows PENDING/ENQUEUED — counts and ids only; runs parked at a human gate are listed (a
   parked run's workflow can't resume on the new version: name them in the request); (c) `fly logs` quiet for 2 minutes.
4. **Token-count timing** (Models 1's open question — the estimate's token counter may fetch a tokenizer from the internet).
   The helpers are new, so v47 can't answer: run the timing inside your local `tvashtr-ship` image instead (`docker run --rm
   tvashtr-ship python -c …`, network on, no database): `gateway.count_tokens` and `gateway.price_per_token` for
   `deepseek/deepseek-chat`, `vertex_ai/gemini-3-flash-preview` and `groq/openai/gpt-oss-120b` — first call and second call per
   slug in seconds, and whether any call reached the network. Report; a slow first call is not a stop.
5. **Ask for the ship approval.** Echo a SHIP REQUEST: the `main` sha, every gate's decisive line, the drain result (with any
   parked runs named), "migration 0054 (additive), DBOS app versions change (drained), team_run.py unchanged, Neon snapshot
   first, no Desktop release", and this line for the operator to paste back:
   `APPROVED models-1 ship: take Neon snapshot snap-models1-<YYYYMMDD-HHMM> of production (project billowing-mud-37479513), drain live runs, push main <sha>, fly deploy main <sha> to app tvashtr (runs alembic upgrade head: 0054), roll back to v47's image if the smoke fails.`
   Wait. Act only on an approval naming this sha; if `main` moved, post a fresh request.
6. **On approval:** (a) `neon branches create --project-id billowing-mud-37479513 --name snap-models1-<…> --parent production
   --no-compute --no-secrets -o json`; echo the branch list. (b) Re-run the drain check; anything queued or running → wait
   (re-check every 5 minutes) up to 30 minutes, then ask the operator instead of deploying. (c) `git push origin main`
   (`8cf90334..<sha>`; anything refused → NEEDS_HUMAN). (d) `fly deploy -a tvashtr`; confirm the release command ran `alembic
   upgrade head` to `0054`.
7. **Smoke** (each PASS/FAIL with its line):
   - `/health` `{"status":"ok","db":"ok"}` and `/healthz`; `make deploy-smoke` 0 failed; 0 5xx and 0 tracebacks in `fly logs`
     for 5 minutes; a scheduled DBOS sweep logs normally on the new fly version `8e9305b7…`.
   - Every API route added since `8cf90334` (list them from the routers' diff: the `/api/models…` family) answers **401** without
     a session, never 500.
   - The live `index.html`'s JS asset equals your local build's; headless Playwright loads `#/welcome` and `#/signin` with 0 page
     errors; with no session, `#/models` lands on sign-in, never a blank page or a page error.
   - `make demo-proof-prod` only if its saved session is still valid (say which).
   **If a health, 5xx, 401-route or page-error smoke fails:** `fly deploy --image deployment-01M69AGBH5GE81KC66970B4GM4 -a
   tvashtr`, confirm health, write NEEDS_HUMAN and stop (the database keeps `0054`, which v47 runs on; restoring the snapshot is
   the operator's call only).
8. **Close.** Echo `SHIPPED: main=<sha> fly=v<N> alembic=0054 neon=<snapshot>`, then the eight-section FINAL REPORT (CLI-RULES
   §4.7) with a ship table and every evidence line, and in section 7: (a) "Operator: put the push guard back — `git config
   --local remote.origin.pushurl DISABLED-no-push-during-video-work`"; (b) the operator's first look on production as a
   numbered click-by-click with PASS/FAIL per step, using the labels you saw locally: on `https://tvashtr.fly.dev` → Engines →
   Add a key → `vertex_ai` → paste the Google Cloud key → Save key; then Models → New model (a "Pick from a list" model with
   three choices) → add two tests → Run tests (Gemini 3 Flash on Google Cloud ticked, the estimate shows) → Run → the Results
   card fills with a score and a cost.

## Stop with NEEDS_HUMAN (written to STATE.md and echoed, with the FINAL REPORT) when

- `origin/main` isn't `8cf90334`, `main` isn't `db8ab37f` + one docs-only commit, the push guard is still set, Fly or Neon is
  signed out, or Neon has 9+ branches;
- a gate fails for a product reason after three attempts, `PUSH_SCAN` finds anything outside the known list, or the range holds
  a binary not listed above;
- runs stay queued or running after 30 minutes;
- the smoke fails (after the rollback);
- the classifier blocks a production step the approval named.
