# Brief — M-desk-routes: on the Desktop, every agent runs on your subscription

Architect: Tvashtr Sidechat-19, 2026-10-03. Path: `/Users/adimac/Desktop/Tvashtr/prompts/m-desk-routes.md`.
`prompts/` is untracked: never commit it. Where this brief and `prompts/CLI-RULES.md` differ, this
brief wins (CLI-RULES' numbers and milestone list are out of date; read it at
`/Users/adimac/Desktop/Tvashtr/prompts/CLI-RULES.md`). **This session runs in parallel with video
step V0**, which owns the main checkout, ports :8000/:5173, the local `tvashtr` database and the
Desktop app. You work in your own git worktree, and your live proof waits until V0 has finished
(see "Parallel rules").

## Why (operator-approved, 2026-10-03)

Tvashtr is going desktop-first. In Tvashtr Desktop, a run's Claude and Grok nodes already run on the
owner's own CLI sign-ins (the Desktop runner, M-subs-desktop). But five features still call API keys
even when started in the Desktop app. Verified in code by the architect:

| Feature | Today on a Desktop launch | Where |
| --- | --- | --- |
| Main runs, Resume, Start the next run | Desktop-routed (subscription) | `routers.py` POST /api/runs, `resume.py`, `start_from.py` |
| **Compare** (and **task sets**, which launch through it) | API keys | `compare._check_runnable` → `_launch_preflight(owner, snapshot, False)`; its `Run(...)` rows carry no `desktop_target` |
| **Agent tests** (and **Test this agent**, which opens the Tests tab) | API keys | `agent_test_runner._model_and_key` → `resolve_owner_api_key` |
| **Ask** | API keys | `routers.ask_node`: the node's model + the owner's BYOK key |

**What the user gets:** in the Desktop app, Compare, task sets, agent tests, Test this agent and Ask
run on their Claude and Grok sign-ins, with no API key for those models. On the website they keep
using API keys, exactly as today.

## Where things are

- Your branch `feat/m-desk-routes` starts from `main` = `e30b8bd9` (create it in your worktree with
  `git switch -c feat/m-desk-routes main` and confirm the sha; V0's commits must not be in it). V0
  only adds `video/**` and is merged first; never rebase onto it, the architect merges both. Alembic
  head `0052`; the freeze hook covers `0001`–`0052`. Floors (STATE.md, M11): `make test` 3445 passed /
  1 xfailed on `tvashtr_gate`; vitest 258 files / 2669; desktop 143/0.
- The push guard lives in the repo's shared git config (V0 sets it first): `git config --get
  remote.origin.pushurl` must print `DISABLED-no-push-during-video-work`. If it doesn't, set it with
  `git config --local remote.origin.pushurl DISABLED-no-push-during-video-work` and prove
  `git push --dry-run origin HEAD` fails. Never unset it.
- Desktop routing today: the FE sends `desktop_target: true` when `isDesktopApp()` (e.g.
  `pages/home/Composer.tsx`); the server routes a model to the Desktop with
  `credential_gate.desktop_routed_subscriptions(models, fresh_subscriptions=desktop_jobs.fresh_subscription_ids(owner), desktop_target=True)`
  and stores `runs.desktop_target` + `runs.desktop_subscriptions`; `team_run._desktop_route` reads them
  and hands the node to `engines/desktop_runner_adapter.py`, which queues a `DesktopNodeJob` keyed on
  `(run_id, node_id, iteration)`.
- The Desktop runner (`desktop/electron/runner/runner.cjs`): claim → GET the job's workspace snapshot →
  run the owner's own CLI in a temp copy → post events → post ONLY the final text + a git patch. **At
  most one job per provider at a time** — a compliance rule from M-subs-desktop ("keep usage
  ordinary, individual"); further jobs queue and the node log says "Waiting for your Claude
  subscription — one job at a time". Do not change this rule.
- Live gate: `desktop/scripts/live-subscription-gate.mjs` drives the real Desktop app with Playwright
  against the LOCAL stack and asserts the account holds NO anthropic/xai API key. V0 is running it on
  this Mac right now; `desktop/README.md` and the gate's header say how to start the stack.

## Rulings (final)

- **D1 — Who counts as "from the Desktop".** The FE sends `desktop_target: true` (when `isDesktopApp()`)
  on: compare start (POST /api/teams/{team_id}/compare, incl. a task-set compare), agent tests Run
  (POST …/tests/run), and Ask (POST /api/runs/{run_id}/nodes/{node_id}/ask). The server routes each
  model exactly as runs do (the call above). Models that aren't subscription models, or a Desktop that
  isn't fresh, keep today's API-key path and its existing refusals and wording.
- **D2 — Compare and task sets.** Store the flag on the compare (it can launch later from the queue).
  Each Run it launches carries `desktop_target` + `desktop_subscriptions` computed at that launch, and
  the pre-flight gets `desktop_target`. No executor change: `team_run.py` already routes from the Run row.
- **D3 — Compare timing on the Desktop (operator-approved 2026-10-03).** Lanes that share a subscription take turns (the one-job rule).
  So a Desktop compare's time is each lane's **work time**: the sum of its agent steps' working time,
  excluding time queued for the Desktop. The results label it "Work time" and add one line: "On your
  Desktop, both versions share your subscription and take turns, so this counts working time only."
  While a lane waits, its current step shows the existing waiting line. Website compares are unchanged.
- **D4 — Agent tests.** A replay whose agent's model is Desktop-routed runs as a Desktop job on the
  replay's rebuilt workspace, with no API key. Its 10-minute cap (R12) counts from when the Desktop
  starts the job, not while it waits in the queue (the result row shows the waiting line meanwhile).
  AI checks stay on Tvashtr's own key (R7), unchanged.
- **D5 — Ask.** When started from the Desktop and the node's model is Desktop-routed, Ask runs as a
  Desktop job: the instruction is the existing system prompt (`run_explain.build_system_prompt`) plus
  the conversation, told to answer from that record only and not to use tools or edit files; an empty
  workspace; the answer is the job's final text; no patch applied; no events written into the asked
  run; not metered (subscription). The POST answers 202 with `{ask_id, status}`; a new owner-scoped
  GET …/asks/{ask_id} returns its status, answer or error; the FE polls it every 2 s and keeps showing
  the existing "Thinking…" (no new UI). An ask job is claimable even though the asked run has ended;
  it expires with the existing offline wording if no Desktop picks it up. Website Ask is unchanged.
- **D6 — Desktop jobs get a purpose.** `run_node` (today's), `test_replay`, `ask`. Every existing
  behaviour of `run_node` jobs stays exactly the same: liveness, events into `run_events`, patch
  application, recovery keys, Fly workspace routing. One additive migration (`0053`: new nullable
  columns and/or a new table), then bump the freeze hook to cover `0053` as the last commit before
  READY. Prefer no `desktop/` change: the runner's contract (claim → snapshot → events → result) should
  serve all three purposes as is. If a runner change is truly needed, keep it minimal and say why.
- **D7 — Out of scope.** Memory notes, AI checks and Domains stay on keys. No ship in this step: no
  push, no Fly deploy, no Neon, no Desktop tag. Shipping is the next step, after the operator merges.

## Rules

1. **Additive only.** No existing screen element, route, field, test or behaviour is removed, moved,
   relabelled or weakened. APIs only add fields. The website path of all five features stays exactly as
   it is (its existing tests pass unmodified).
2. **Claude Design first.** Any new visible element or copy (D3's "Work time" label and line) is drawn
   on a board first: the Quality canvas (https://claude.ai/artifact/SnnUUrHn3oPKgn11YJfcmz), page
   "Compare two versions", a new board `Cmp-ResultsDesktop` built from `Cmp-Results`, title
   "M-desk · Compare results on the Desktop". Read the canvas with your Artifact tool first and follow
   the Design type's instructions; publish the board, then implement from it. Never the main canvas.
3. **Invariants (prove each):** `git diff main -- backend/tvashtr/control_plane/team_run.py` is empty and
   the DBOS application version is the same before and after; `EngineAdapter.run()`'s signature is
   unchanged (`engines/base.py` may only gain fields with defaults); `build_two_node_team` untouched;
   migrations `0001`–`0052` untouched; the one-job-per-provider rule unchanged (the desktop runner tests
   pass unmodified); no assertion weakened
   (`git diff main -- backend/tests frontend/src frontend/e2e desktop/scripts | grep -E '^-\s*(assert |expect\()'`,
   every hit explained).
4. **Security:** every new route is owner-scoped (another account gets 404, one test each) and listed in
   `test_owner_scope_guard.py`. Never log, print or store a secret; never read CLI credential files.
5. **Reproduce-first:** each gap gets a failing test shown failing on the current code before the fix.
6. **Tests:** `make test` runs on your database `tvashtr_gate_desk` (echo one line proving it). Clear
   stale runs and PENDING DBOS workflows in `tvashtr_desk` before the live proof. After it, delete
   untracked strays agents left (`REPORT.md`, `DEMO_PROOF.md`) only after `git ls-files --error-unmatch`
   proves them untracked.
7. **No push** (the guard stays on), never force, never `reset --hard`; `.env` fenced (inline env vars);
   no Fly secrets, no production data.
8. **Commits:** branch `feat/m-desk-routes` from `main`; conventional, atomic, own paths by name (never
   `-A`); never commit `prompts/`, `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md`, `design/`, `video/out/`.
9. **Helpers:** at most 2, each in its own worktree with its own database and no server on :8000 or
   :5173 while V0 runs. Check on them regularly.
10. **Time box:** 7 hours of work (waiting on a subscription reset doesn't count). Three-attempt rule.
11. **Where this session runs:** the Claude desktop app's Code tab, in its own worktree (the parallel
    rules below). Don't use the Code tab's preview server. After a compaction, read this brief whenever
    the hook points you at CLI-RULES §3/§7.
12. **Safe state at any stop:** nothing running from your worktree; your branch committed; the worktree
    left in place (the operator merges `feat/m-desk-routes` from the main checkout).

## Parallel rules (V0 is running in the main checkout)

- **Hands off V0.** Work only inside your worktree. Never edit, run or stop anything in
  `/Users/adimac/Desktop/Tvashtr` itself: you may only read this brief and CLI-RULES there, and load
  its `.env` as below. Never touch V0's processes, ports :8000 and :5173, its `tvashtr` database or its
  Desktop app.
- **Setup.** Your worktree has no `.env` and no `node_modules`. Install what you need (`uv sync --extra
  dev` for the backend; `npm ci` in `frontend/` and `desktop/`). When a command needs settings from
  `.env`, load them into that command's environment only:
  `set -a; . /Users/adimac/Desktop/Tvashtr/.env; set +a; <command>`. Never copy, print or edit `.env`.
  **`.env`'s `DATABASE_URL` points at V0's `tvashtr` database:** don't load `.env` for `make test` at
  all (give it only `DATABASE_URL` for `tvashtr_gate_desk`), and for your live stack load `.env` and
  then set `DATABASE_URL` to `tvashtr_desk` in the same command. Echo the database name each command
  used (never the full URL).
- **Databases.** Use the Postgres server the main checkout already runs (the host, port and user in
  `.env`'s `DATABASE_URL`), with your own database names: `tvashtr_gate_desk` for `make test` (create
  it once and run `alembic upgrade head` against it) and `tvashtr_desk` for your live stack. Never run
  `make db-up` from the worktree (its compose project would fight the running Postgres for port 5432).
  Never use the `tvashtr` database.
- **Why your tests are safe beside V0:** the workspace reaper only sweeps your worktree's own
  `.tvashtr_workspaces`. Still, never start a backend on :8000 or Vite on :5173 while V0 runs.
- **The live proof waits for V0.** Only one Tvashtr Desktop app can run at a time, and both would use
  the operator's subscriptions. When everything except the live proof is green, check V0 is finished:
  nothing listening on :8000 or :5173 (`lsof -iTCP:8000 -sTCP:LISTEN`, the same for 5173) and no
  Electron running from `/Users/adimac/Desktop/Tvashtr/desktop` (`pgrep -fl Electron`). While any of
  these is present, echo `LIVE_PROOF_WAITING (V0 still running)` once and re-check every 5 minutes
  (waiting doesn't count against your time box). If V0 is still running after 6 hours, stop with
  NEEDS_HUMAN. Then run the live proof from your worktree on the default ports with `tvashtr_desk`
  (seed it; if the seed imports an anthropic or xai key, remove those credential rows from
  `tvashtr_desk` only, since the proof needs none), and stop your stack afterwards.
- **Your ledger.** Write your progress and any NEEDS_HUMAN to `STATE.md` in YOUR worktree (untracked;
  never commit it), and echo them in chat. The project's SessionStart hooks print the main checkout's
  STATE.md: that is V0's ledger; ignore it.

## Acceptance (echo each as it completes)

1. **Reproduce-first tests**, shown failing on the current code, then passing:
   (a) a Desktop compare for an account holding no anthropic/xai key launches Runs with `desktop_target`
   and `desktop_subscriptions` (today: refused or website-routed); (b) a Desktop agent-test run queues a
   `test_replay` job and resolves no API key (today: no-credential error); (c) a Desktop Ask answers 202
   and queues an `ask` job (today: 422, no key), and its GET returns the answer after a runner result
   posted through the real runner routes; (d) an `ask` job's events write no `run_events` rows; (e) an
   `ask` job is claimable for a run that has ended; (f) a Desktop compare's work time excludes queued
   time (a fixture with a queued gap).
2. **Website unchanged:** the existing compare, agent-test and Ask tests pass unmodified; a test proves
   each of the three still uses the key path without `desktop_target`.
3. **Gates:** `make test` on `tvashtr_gate_desk` ≥ 3445 passed / 1 xfailed; vitest ≥ 258 files / 2669; `tsc -b`;
   the frontend build; desktop tests 143/0 (or more); `make lint`; the owner sweep; `alembic upgrade head`
   and `downgrade -1` and back for `0053`; the freeze hook bumped to `0053`.
4. **Live proof** (only after V0 has finished; see "Parallel rules") on your local stack with the real
   Desktop app, the account holding NO anthropic/xai key (extend `live-subscription-gate.mjs` with new phases, or a sibling script under
   `desktop/scripts/`), one screenshot per check: (a) **Ask** the Engineer of a finished Desktop run
   "Why did you change README.md?" → the answer arrives through the Desktop (evidence: the owner's CLI
   ran, no API key used); (b) **make a test** from that Engineer's round and **run it** → its result
   comes back through a Desktop job; (c) **compare** two versions of a 2-node team on a tiny task →
   both lanes finish through the Desktop, one lane shows the waiting line while the other works, and
   the results show "Work time" with D3's line. Budget: at most one setup run, one ask, one replay and
   one compare (two runs).
5. **Invariants:** each item of rule 3 with its proof.
6. Then: `DIFF:` `git diff --stat main...feat/m-desk-routes`; `READY_TO_MERGE feat/m-desk-routes <sha>`;
   the eight-section FINAL REPORT (CLI-RULES §4.7), listing every board added and every PR opened on
   `trade_mcp`.

## Stop with NEEDS_HUMAN (in STATE.md and echoed in chat, with the FINAL REPORT) when

- a fix would need `team_run.py` changed, or the one-job-per-provider rule relaxed (the architect
  decides; don't do it);
- Claude or Grok isn't "Connected" on the Engines page, or a subscription usage cap is hit;
- V0 is still running 6 hours after you reached the live proof;
- the Claude Design board can't be published;
- a second, unknown problem needs a broad or unproven change.

A contained, proven fix with a regression test may proceed.
