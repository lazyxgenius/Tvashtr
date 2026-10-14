# Brief — M-desk-6: a "Tests pass" check Tvashtr runs itself, honest Desktop agents, and V2's small fixes

Architect: Tvashtr Sidechat-22, 2026-10-12. Path: `/Users/adimac/Desktop/Tvashtr/prompts/m-desk-6.md`.
`prompts/` is untracked: never commit it. Where this brief and `prompts/CLI-RULES.md` differ, this
brief wins (CLI-RULES' numbers and milestone list are out of date).

## Why (evidence from V2, run on 2026-10-11)

Every Desktop run went three rounds and parked at the Escalation gate (~35 min): the Part A proof
(PR #52), the hero "Add a Hull moving average indicator" (#53), TRIX (#54), DEMA (#55). The
Reviewer's notes, round after round: "this review has no pytest output. Run python -…". Cause: by
design the Desktop runs its CLIs with file tools only (`desktop/electron/runner/cliCommand.cjs`:
Claude `--restricted`; Grok `--tools read_file,search_replace,write,list_dir,grep,todo_write`), so
no Desktop agent can ever run a command — yet the Reviewer's instructions tell it to run the tests.
The operator ruled (2026-10-12, "proceed"): **Tvashtr runs the tests itself, in its own sandbox —
never the agents, never on the user's Mac** — and Desktop agents are told the truth about what
they can do.

## Where things are (checked by the architect on disk, 2026-10-12)

- `main` = **`dac9afc4`** (M-desk-5 `6b63af86` + video V2 merged). `origin/main` still `e30b8bd9`;
  push guard ON. Alembic head `0053`; the freeze hook covers `0001`–`0053`. `team_run.py` blob
  `94eda1bb9fbb`; `desktop/electron/runner/runner.cjs` `15e977ad71f2`; DBOS application version
  locally `3011d7ac…`, production's fly-mode set `c7320dd5…`.
- **Checks today.** A guardrail gate is a `kind="gate"` node whose `config.gate_kind` is in
  `guardrails.GUARDRAIL_GATE_KINDS` (`secret_leak_scan`, `diff_touches_forbidden_paths`,
  `output_schema_check`); `team_run`'s gate arm calls the recorded step
  `guardrails.guardrail_gate_step(run_id, node_id, gate_kind, workspace, config)` and routes
  `approved`/`rejected` through `next_node`. Its `reasons` go only to the gate's
  `outcome_detail` — **the next agent never sees them** (`reviewer_feedback` is set only from an
  agent node's result, `team_run.py` ~line 3093).
- **Running a command in Tvashtr's sandbox already exists:** M9's hidden checks
  (`control_plane/hidden_checks.py`: `_execute` → Fly `run_check` (the run's own microVM, created
  if the run has none — works for a run whose agents all ran on a Desktop) / docker `run_check` /
  LOCAL dev; 10-minute cap; last 12 lines kept; `mask_secrets`; never on the hosted control plane
  itself — `NOT_HERE`). Desktop task sets already run their hidden checks this way.
- **The Gate type picker:** `frontend/src/panel/legacy/GateBody.tsx` (Human approval · Secret leak
  scan · Forbidden paths · Output schema), `legacyCopy.ts` (`GUARDRAIL_GATE_KINDS`, subtitles).
- V2's other findings (§15 "Sidechat-22 register" in `PROJECTPLAN.md`; screenshots in
  `video/takes/v2/3.1/shots/done.png`, `…/reviewer-verdict.png`).

## Rulings (final; each with what the user sees)

**T1 — A "Tests pass" check (new guardrail kind `tests_pass`).**
- Config: `{"command": "<shell command>"}` on the gate node (≤ 1,000 characters, required). It runs
  through the hidden-check runner (`hidden_checks._execute` or a shared helper beside it — reuse,
  don't copy) against the run's workspace as it stands after the step before the check
  (brownfield/greenfield as the run is), from the repo's root, 10-minute cap, secrets masked.
- Outcomes: exit 0 → `approved`, summary = the last line of output. Non-zero or timed out →
  `rejected`, reasons = the last 12 lines (or "The tests didn't finish in 10 minutes."). The sandbox
  can't run it (a sandbox error, or the hosted control plane with no sandbox) → `approved` with the
  note "Couldn't run the tests: <short reason>" — never a false pass, never a loop the Engineer
  can't fix; the run view shows it as a warning.
- **The result reaches the next agent.** A rejected check's lines become the next agent's rework
  feedback exactly as a Reviewer's reasons do (the Engineer reworks with the failing lines). A
  passed or couldn't-run check's one line is in the next agent's context ("Tests (run by Tvashtr
  in its sandbox): passed — 42 passed in 6.1s"). This applies to every guardrail kind's reasons
  (a secret-scan rejection routed to an agent now tells it what was found — names, never values).
- `team_run.py` may change **only in its gate arm and only for this hand-off** (a few lines). If it
  changes: the recorded-walk and crash/recovery suites stay green, you report the new DBOS
  application versions (local and fly-mode), and the FINAL REPORT says plainly that the ship must
  drain live runs before the deploy. If a cleaner path exists that leaves `team_run.py` unchanged,
  take it.
- *User sees:* in the gate drawer's **Gate type**, a fifth option **"Tests pass"** with a
  **Command** field and the hint "Tvashtr runs this in its own sandbox from the repo's root, after
  the step before it. Include any install step, e.g. `pip install -r requirements.txt && pytest
  -q`. Agents never run it on your computer." On the canvas the card reads "Tests pass" (not the
  raw kind). In the run view: "Running the tests…", then "Tests passed · <last line>" or "Tests
  failed — back to <agent> with the last 12 lines", or the warning "Couldn't run the tests —
  passed on without a result"; the lines open under the Activity row. Website and Desktop alike.

**T2 — Desktop agents are told what they can do.** Every Desktop job's instruction gets one line
(server-side, e.g. in `DesktopRunnerAdapter`, never on the website): "On this computer you have
file tools only — you can't run commands, so don't ask for command or test output. If the team has
a Tests check, Tvashtr runs the tests in its own sandbox and passes you the result." Plus the T1
context line when there is a result.
*User sees:* a Desktop Reviewer judges by reading (and by the Tests result when there is one); no
more three-round escalations over output nobody can produce.

**S1 — The run view at 1440×900** (the Desktop's default window): the run card no longer overlaps
the toolbar, and the Done summary no longer clips "total time". Nothing removed or moved off
screen (additive rule); fix the layout, not the content.

**S2 — The Done line keeps its time.** "Done in 37m 16s" became "37m 36s" after the post-ship
memory save. The time is the run's own finish (Ship), fixed once written. Diagnose first.

**S3 — A GitHub run that never pushed.** A finished GitHub run with no pushed branch (failed or
cancelled before Ship) doesn't ask GitHub; its Changes tab says **"This run stopped before it
pushed its changes, so there's nothing to show here."** (M-desk-5's "Couldn't load the changes
from GitHub." stays for real GitHub failures.)

**S4 — The Grok CLI reads only its job's copy.** V2 saw Grok read Tvashtr's source,
`~/Desktop/trade_mcp` and `~/.grok/sessions` (its `--sandbox workspace` confines writes, not reads).
Find what Grok Build documents for confining reads (its permissions/sandbox docs, `grok --help`)
and use it, without breaking its sign-in. Claude's `--restricted` already confines file tools to
the job dir — confirm it. If Grok documents no way, change nothing there and report what you found
with a proposal (NEEDS_HUMAN only at the end, with everything else done).

**Claude Design first.** Before code, draw on the canvas where each screen was designed (find it
with your Artifact tool; never the main canvas): the Gate type picker with "Tests pass" + Command;
the Tests check's canvas card; the run view's Tests states (running, passed, failed, couldn't run)
on the Desktop and the website; S3's state beside M-desk-5's Live-ChangesGitHub boards; S1's Done
screen at 1440×900. Publish, then build from the boards. List every board added or changed.

## Out of scope

Templates keep their nodes (a user adds a Tests check; no template change). Hidden checks keep
their behaviour and results. No migration (the command lives in the gate's `config` JSONB). No
ship. The Desktop runner keeps file tools only — no command tools for agents.

## Invariants (prove each as evidence)

1. No migration (`backend/alembic` diff empty; head `0053`).
2. `team_run.py`: unchanged, or changed only in the gate arm per T1 (show the diff); DBOS app
   versions reported either way (local and fly-mode).
3. `runner.cjs` blob `15e977ad71f2` (S4 may change `cliCommand.cjs` only); the one-job-per-provider
   rule untouched (`claim_next` unchanged).
4. Hidden checks unchanged in behaviour (their tests green, untouched assertions).
5. No assertion or `expect` line removed (grep the diff against `dac9afc4`).
6. Website renders at 0 px against `dac9afc4` except the screens the boards above change — list
   each with before/after.
7. A Tests check's output never shows a secret (a test with a planted key in the output).

## Proof

- **Reproduce-first for the bugs** (failing on `dac9afc4`, then passing): T2 (a Desktop job's
  instruction lacks the line), S2 (the Done time moves after a later write), S3 (a never-pushed
  GitHub run asks GitHub / says "Couldn't load"). Tests-first for T1: approved / rejected /
  timed-out / couldn't-run; the rejected lines reach the next agent's feedback; the passed line
  reaches the next agent's context; masking; idempotent on a recovered walk (the recorded step
  replays, the command doesn't run twice).
- **Gates:** `make test` on its own database (never next to a running stack, never on
  `tvashtr_film`), vitest, the frontend build, `make lint` with no new errors (38 pre-existing),
  the owner sweep, desktop tests if `desktop/` changed, the design-parity harness (new and changed
  boards at 0 drift; website as invariant 6).
- **Live proof** on a throwaway database `tvashtr_desk6` (drop it after), the real dev Desktop,
  the stack in the **docker** sandbox mode (Docker Desktop is up; production uses Fly — say which
  mode ran): team PM (Claude) → Engineer (Claude) → **Tests pass** (the trade_mcp test command,
  with its install step — read the repo to choose it) → Reviewer (Grok) → Ship; task "Add a TEMA
  indicator" on `lazyxgenius/trade_mcp` `main`, scope `core/`. Expect: the Tests check runs in the
  sandbox and its result shows in the run view; the Reviewer's verdict uses it; **no Escalation**;
  a PR. Screenshots you open: the drawer with "Tests pass", the run view while the tests run, the
  passed (or failed → rework) states, the Reviewer's verdict, the Done screen at 1440×900 (S1), the
  Done line after the memory save (S2). At most **3 real runs**. List every PR opened.

## Rules

1. Branch `feat/m-desk-6` from `main` (`dac9afc4`), in the main checkout (worktree off): the live
   proof needs `.env`, the installs and the one Desktop. Conventional commits, your own paths by
   name (never `-A`); never commit `prompts/`, `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md`,
   `design/`, `video/`.
2. No push (`remote.origin.pushurl` = `DISABLED-no-push-during-video-work`; a dry-run push fails),
   never force, never `reset --hard`, never merge into `main`.
3. `.env` fenced: load per command with `DATABASE_URL` overridden; never open, copy, print or edit.
4. Secrets: never print, log, screenshot or record a key, token, password or CLI credential file;
   never open the `claude`/`grok` credential files (S4: read the CLIs' docs and `--help`, not their
   credential stores). Scan what you stage before each commit.
5. Subscriptions: Engines shows Claude and Grok "Connected" before the first real run; the run log
   shows Claude `apiKeySource: none`. Expired sign-in or a usage cap → NEEDS_HUMAN.
6. One stack and one Desktop; check :8000/:5173 and running Electron first (another session →
   `STACK_WAITING`, re-check every 5 min, NEEDS_HUMAN after 3 h). The Mac: `caffeinate -dimsu`;
   pause/stop only processes you launched, by PID.
7. Three-attempt rule; time box 10 hours of work.
8. Safe state at any stop: nothing running, the branch committed, checkout on `main`.
9. After a compaction: re-read this brief and the end of `STATE.md`.

## Evidence lines (echo each as it completes)

`NO_PUSH_GUARD: ON` · `PREFLIGHT: main=<sha> branch=feat/m-desk-6` · `BOARDS: <canvas> <board> v<n>`
(each) · `T1_TESTS: <names> green` · `T2_RED/T2_GREEN`, `S2_RED/S2_GREEN`, `S3_RED/S3_GREEN` ·
`CAUSE: S2 <what moved the time>` · `S4: <what Grok documents; what changed or why not>` ·
`TEAM_RUN: unchanged | <diff stat> + app versions <local>/<fly>` · `GATES: make test <n>/<n>,
vitest <n>, build ok, lint +0, sweep <n>, desktop <n|unchanged>, parity <boards> 0 drift, website
<n>/<n>` · `INVARIANTS: …` · `LIVE: run=<id> sandbox=<mode> tests=<passed|failed→rework> rounds=<n>
escalation=<no> PR=<url> <screenshots>` · `RUNS_USED: <n>/3` · `DIFF: <git diff --stat
main...feat/m-desk-6 | tail -1>` · `READY_TO_MERGE feat/m-desk-6 <sha>`, then the eight-section
FINAL REPORT (CLI-RULES §4.7): per item the cause, the files, the red/green tests by name, the
board, the live screenshot; every deviation and why; what's still open.

## Stop with NEEDS_HUMAN (written to STATE.md and echoed, with the FINAL REPORT) when

- the push guard is off; a CLI sign-in expired or a usage cap is hit; macOS asks for a permission;
- a board can't be published;
- T1's hand-off needs `team_run.py` changes beyond the gate arm, or a migration;
- a second, unknown problem needs a broad or unproven change.

A contained, code-proven, regression-guarded fix inside this scope may proceed. S4 with no
documented way is reported at the end, not a stop.
