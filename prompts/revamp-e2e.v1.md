# Brief — finish the revamp end to end: fix the core loop, build round 2, ship after every area

Architect: Tvashtr Sidechat-15, 2026-09-26. Read this whole file before doing anything.

## Where things are (2026-09-26)

- `main` @ `ec9202b` is LIVE on https://tvashtr.fly.dev (deployed 2026-09-26). It has round 1 of the
  revamp: the new header/sidebar and Home. Every other area (Engines, Toolkit, agent panel, Focus/Docs,
  Domains, landing and sign-in pages) still shows its OLD body inside the new frame.
- The newest Desktop DMG on GitHub is `desktop-v0.2.0`, built BEFORE round 1. Desktop bundles its own
  copy of the frontend (`desktop/dist-fe`), so the Desktop app shows the old UI until a new DMG is
  published. `desktop/package.json` on main already says `0.3.0`.
- **The core loop does not complete, live.** The entry node (PM) must write `REPORT.md`; on OpenAI
  models it puts the PRD in its closing message instead (5/5 runs: e62d9995, 69752d58, 185c6848,
  ae026ff5, 99539c30). `team_run.py` then fails the run: "entry node produced no REPORT.md".
- The design (486 screens) is already on disk: `design/revamp-export/project/` (Claude Design version
  `1790346485-eb38`). Use `DESIGN_DIR=$PWD/design/revamp-export/project`. It is excluded from git via
  `.git/info/exclude` — never commit it. This session cannot reach the design itself: if a screen is
  missing or the design looks newer than this export, stop with NEEDS_HUMAN.
- Read before starting: `docs/superpowers/HANDOVER-2026-09-25-revamp.md`, the plan
  `docs/superpowers/plans/2026-09-25-frontend-revamp.md`, the spec
  `docs/superpowers/specs/2026-09-25-frontend-revamp-design.md`, the analyses in
  `docs/superpowers/specs/2026-09-25-revamp-analysis/`, both briefs in `docs/superpowers/briefs/`
  (including "Lessons"), the API contracts in `docs/superpowers/plans/api/`, `prompts/CLI-RULES.md`,
  `HANDOVER.md`, and the "Frontend revamp round-1 follow-ons" block in `PROJECTPLAN.md` §15.

## Operator authority for THIS session

The operator authorizes this session to: merge into `main` (fast-forward only), push `main` and your
own branches, push `desktop-v*` tags, and run `fly deploy` — ONLY through the Ship Protocol below.
This overrides the "agent never pushes" rule in `prompts/CLI-RULES.md` §3 for this session only.

## Work order

### Phase 0 — Desktop catch-up (do first; small)
Publish the round-1 Desktop app: from `main` @ `ec9202b`, push tag `desktop-v0.3.0`, then run
Ship Protocol step 8 (wait for the workflow, verify the release, verify the DMG carries the current
frontend). No code change.

### Phase 1 — Make the core loop complete (before any screen work)
Branch `fix/entry-report`. Reproduce first: a backend test (fake adapter, `tests/conftest.py`
patterns) where the entry node ends with a non-empty closing message and no `REPORT.md` — confirm it
FAILS on the current code the same way the live runs fail. Then fix: when a report-only entry node
finishes without `REPORT.md` but with a non-empty closing message, the executor uses that message as
the report (it becomes the spec version exactly as `REPORT.md` would), and records a run warning the
run view shows ("The PM didn't save REPORT.md, so its final message was used"). No closing message
and no `REPORT.md` still fails as today. Rules: `team_run.py` changes are ADDITIVE — add a new DBOS
step, never change an existing step's return shape; the PRD gate still shows the spec to a human
before anything else runs. A clearer entry-node instruction in the prompt builder is allowed only
with a test that pins the new text. Then a LIVE `make demo-proof` must open a real PR (C1–C12).
Ship it (Ship Protocol, with a Desktop release).

### Phase 2 — Round 2, one area at a time, each on its own branch and shipped
In this order: F2 Engines → F3 Toolkit Tools + Secrets → F4 Toolkit Skills + Memory → F5 Agent panel
+ canvas chrome → F6 Focus + Docs (builds on F5) → Domains (`Dm-*`, `DmF-*`) → Tvashtr Desktop app
screens (`DT-*`, `DtF-*`) → website (`Web-Landing`, `Web-SignIn`, `Web-Download*`, `Web-Mobile`,
`WbF-*`). F2–F6 are already analysed (round-1 analysis files). For Domains, Desktop app and website:
first write an analysis file in the same format (`docs/superpowers/specs/2026-09-25-revamp-analysis/
<area>.md`), list the backend gaps, build the backend first with an API contract in
`docs/superpowers/plans/api/<area>.md`, then the screens. Domains already has a working backend
(PolyRAG, Sep 15–22): reuse it and add only what is missing.
Per area: every artboard of the area passes the parity gate with 0 size/type drift on the website AND
in Tvashtr Desktop; save the per-artboard parity lines to `docs/superpowers/parity/<area>.txt`.
Special rules:
- Every Download button (landing, `Web-Download*`, `WbF-*`) uses the stable link in
  `frontend/src/lib/desktopDownload.ts` (`…/releases/latest/download/Tvashtr-mac.dmg`) — never one
  version. Keep the file name `Tvashtr-mac.dmg`.
- The Mac app is unsigned, so current macOS says "Tvashtr is damaged" and right-click → Open does NOT
  get past it. Wherever the design shows Mac install steps, keep the design and make the steps work:
  add the one-line fix `xattr -dr com.apple.quarantine /Applications/Tvashtr.app` in the design's
  instruction area. Report it as a deviation.
- Desktop update screens (`DT-Update`, `DtF-Upd-*`) compare the running app's version
  (`desktop/package.json`) with the latest GitHub release and offer the download.
- Engines: NIM serves no seat right now (it is in the catalogue with both seats `None`). Show that
  plainly instead of inviting a key that powers nothing.

### Phase 3 — Close out
Full e2e table (every spec in `frontend/e2e`, against the real stack, one at a time), final ship,
and the revamp handover file updated to "done" with everything left over listed.

## Ship Protocol (after Phase 1 and after every Phase 2 area)
1. **Gates on the branch** (all must pass; echo each): `make test` 0 failed · `cd frontend && npx vitest
   run`, `npx tsc --noEmit`, `npm run build` · `cd desktop && npm test` · `docker build -t tvashtr-ship .`
   · eslint `--max-warnings 0` + prettier on changed frontend files, ruff check + format-check on
   changed backend files · the parity lines for the area (0 drift, web + Desktop) · every e2e spec that
   touches the area plus `revamp-shell` · `make demo-proof` with a real PR (from Phase 1 on; `make seed`
   and clear stale runs + PENDING DBOS workflows first; up to 3 attempts for provider flakes).
2. Update `docs/superpowers/HANDOVER-2026-09-25-revamp.md` (what shipped, what is next) and commit it.
3. Set `desktop/package.json` to the next minor version (0.4.0, 0.5.0, …) and commit it.
4. `git fetch origin`. If `origin/main` moved, merge it into the branch (no rebase) and re-run step 1.
5. `git checkout main && git pull --ff-only origin main && git merge --ff-only <branch> && git push
   origin main`. Never force. If the fast-forward fails, go back to step 4.
6. If this ship adds a migration: STOP before deploying. Write NEEDS_HUMAN asking the operator to take
   a Neon snapshot (Neon console → Branches → New branch from main, "now") and wait for "go".
7. `fly deploy`. Confirm the release command ran. Smoke the live site: `curl
   https://tvashtr.fly.dev/health` is ok; headless Playwright loads the landing and sign-in pages; the
   JS asset name in the live `index.html` equals your local production build's; for the area you
   shipped, check an unauthenticated page or text if it has one. Run `make demo-proof-prod` only if
   its saved session is valid; if stale, say so and move on.
   If the smoke fails: roll back to the previous image (`fly releases --image`, then `fly deploy
   --image <previous>`), confirm health, write NEEDS_HUMAN, stop.
8. Desktop release: `git tag desktop-v<version> <main sha> && git push origin desktop-v<version>`.
   Wait for the "Desktop Mac Release" workflow (poll the public GitHub API or the redirect of
   `https://github.com/lazyxgenius/Tvashtr/releases/latest/download/Tvashtr-mac.dmg` until it names
   the new tag; give up after 30 minutes with NEEDS_HUMAN). Download the DMG, mount it read-only
   (`hdiutil attach -nobrowse -readonly`), and confirm the app's bundled frontend matches this ship's
   build (same JS asset name). Detach it.
9. Record in the revamp handover file: area, main sha, Fly release number, DMG tag.

## Hard rules
- Fast-forward only into `main`. Never force-push, never rewrite or delete remote history, never push
  to `main` without step 1 green.
- Never touch production data or infrastructure beyond `fly deploy`: no SQL against prod, no Fly
  secrets/scale/region/machine changes, never raise the run ceilings.
- Migrations: never edit `0001`–`0041`; at most ONE new migration (`0042`) in this whole session, and
  extend `.claude/hooks/protect-migrations.sh` to freeze `0041` when you add it.
- APIs only add fields. Every new read and write is owner-scoped (another account gets 404).
- `team_run.py`: new DBOS steps only; never change an existing step's return shape; no module-level
  OpenHands import. Deploys that change it can fail runs that are in flight — say so in the report.
- Bugs: reproduce first with a failing test; never weaken an assertion.
- Commit your own paths by name; never `git add -A` / `git add .`; never commit `design/`,
  `HANDOVER.md`, `PROJECTPLAN.md` or anything in `prompts/`.
- At most 3 helper agents at a time, each in its own git worktree with its own database and Vite
  port. Check their commits every 20 minutes; restart a stalled one from its last commit with the same
  brief; log every restart.
- Stop only for NEEDS_HUMAN (write it in `STATE.md` and the revamp handover file): a missing key, a
  provider down after 3 attempts, a design question the files cannot answer, the migration snapshot, a
  failed prod smoke. Otherwise keep going to the next area.
- This job is long. The revamp handover file must always say what is next, so a new session can pick
  up exactly there.

## Report (after every ship, and a full one at the end)
Branch and commits; per file what and why; every command with its result; parity lines per artboard
(web + Desktop); e2e results; demo-proof C1–C12 and the PR URL; main sha, Fly release, DMG tag and the
DMG check; deviations and why; anything outside scope; what was not done; risks.
