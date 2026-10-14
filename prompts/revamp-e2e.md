# Brief — finish the revamp: ship the Desktop app, the website, F6 and Domains, then close out

Architect: Tvashtr Sidechat-16, 2026-09-27. This replaces the 2026-09-26 brief (kept as
`prompts/revamp-e2e.v1.md` for the record). Read this whole file before doing anything.

## Where things are (2026-09-27 ~09:30 IST, audited on disk by Sidechat-16)

- `main` = `origin/main` = `b33c630` (F5). LIVE on https://tvashtr.fly.dev: Fly release v24,
  `/health` ok, live asset `index-DUzUTMWb.js`. Latest Desktop release `desktop-v0.8.0` → `b33c630`.
  Shipped so far: Phase 0, Phase 1, F2, F3, F4, F5. The ship table lives in
  `docs/superpowers/HANDOVER-2026-09-25-revamp.md`; its F5 row still says "recorded at the next
  ship" — fill it (`b33c630` / v24 / `desktop-v0.8.0`) in the first ship's step 2.
- Four branches are built and pushed but NOT shipped. Each is checked out in its own worktree under
  `.claude/worktrees/<area>` with its own untracked `.env` (own database and ports). Run an area's
  gates inside its worktree; do the fast-forward merge from the main checkout (`git merge --ff-only
  <branch>` works while the branch is checked out in a worktree).

| Branch (worktree) | Tip | State |
|---|---|---|
| `feat/revamp-desktop-app` (`desktop-app`) | `fae2116` | `main` merged in (0 behind). 39 Desktop boards at 0 drift (web lines n/a: Desktop-only screens). Verified at `fae2116`: tsc, vitest 1620, build, desktop 131, lint. **Not run:** `make test`, docker build, the lead parity re-render, e2e, demo-proof, the independent review. Backend: `auth.py` (+67), new `routes/desktop_app.py`, `desktop_auth.py`, `desktop_release.py`, `teams.py` (+258), `desktop_jobs.py` — the review must cover sign-in safety and owner scoping. |
| `feat/revamp-website` (`website`) | `0d13940` | Built ON TOP of the Desktop app branch (holds 45 of its 46 commits) plus 23 website commits; 54 behind `main`. 23 of 24 boards at 0 drift; `WbF-Err-1` has 1 size drift by decision (the OQ-15 help-line copy is longer, so the link wraps) — **accepted**. Nothing re-verified by the lead. Must merge `main` AFTER the Desktop app ships. |
| `feat/revamp-f6-focus-docs` (`f6-focus-docs`) | `5c7fb9b` | 0 behind `main`. The full parity sweep IS committed (`docs/superpowers/parity/focus-docs.txt`: 17 boards, web + Desktop, 0 drift). The finisher's independent review and the gates never ran (it died on the usage limit). Backend: `node_history.py`, `node_templates.py` + `tests/test_focus_docs_api.py`. |
| `feat/revamp-domains` (`domains`) | `00ba5b6` | 0 behind `main`. Migration `0042_domain_message_meta` (one nullable JSONB column, no backfill) and the freeze hook at `0001`–`0041`. `team_run.py` audited as additive: legacy `domain_query_step` byte-identical to `main`; new steps `domain_query_step_v2` and `append_domain_answer_to_spec_step`; a v2 branch in the walk; `open_invocation_step`'s return is now kept. 67 boards at 0 drift, 9 web-only lead waivers (Desktop 0), 8 canvas boards blocked → rulings 1 and 2. |

- The design upstream is still version `1790346485-eb38` (checked 2026-09-27) = the on-disk export
  `design/revamp-export/project` (`DESIGN_DIR=$PWD/design/revamp-export/project`). Never commit
  `design/`. The whole design is already rendered under `design/revamp-export/render/`.
- The previous session's lead parity script (`verify_parity.sh` in its scratchpad) is gone. Rebuild
  the same loop from `scripts/design-parity/README.md` (shoot each artboard of the area on web and
  Desktop, run `parity.py`, compare with the committed lines).
- Prod: the operator had runs in flight at 09:16 (`c99bfdb2`, `6ecb87b5`). The prod account's Gemini
  key is quota-limited (429) and failover skips 429 — known (PROJECTPLAN §15), not this session's job.
  The saved prod demo-proof session (`.playwright/prod-session.json`) expires ~2026-09-27 13:12 IST.
- Read before starting: `docs/superpowers/HANDOVER-2026-09-25-revamp.md`, the WRAP-UP block at the
  end of `STATE.md`, the plan `docs/superpowers/plans/2026-09-25-frontend-revamp.md`, the spec
  `docs/superpowers/specs/2026-09-25-frontend-revamp-design.md`, the area analyses
  (`docs/superpowers/specs/2026-09-25-revamp-analysis/` incl. `domains.md`, `desktop-app.md`,
  `website.md` on their branches), both briefs in `docs/superpowers/briefs/` (including "Lessons"),
  the API contracts in `docs/superpowers/plans/api/`, `prompts/CLI-RULES.md`, `HANDOVER.md`, and the
  "Frontend revamp round-1 follow-ons" block in `PROJECTPLAN.md` §15.

## Operator authority for THIS session

The operator authorizes this session to: merge into `main` (fast-forward only), push `main` and your
own branches, push `desktop-v*` tags, and run `fly deploy` — ONLY through the Ship Protocol below.
This overrides the "agent never pushes" rule in `prompts/CLI-RULES.md` §3 for this session only.

## Architect rulings (apply them; don't ask again)

1. **Domains canvas boards** (`DmF-Canvas-1…4`, `DmF-Step-4`, `DmF-Step-5`, `Dm-QueryNode`,
   `Dm-AgentAccess`): F5's boards govern the canvas chrome every canvas shares — the toolbar's Run
   button, the drawer's header name, the drawer tabs, the save bar, the endpoint card. On those 8
   boards waive exactly those chrome items: one `# waiver` line per item in
   `docs/superpowers/parity/domains.txt`, naming the F5 board that governs it (`Main`, `Web-Setup`,
   `Desktop-Editing`, `Web-Skills`). `DmF-Canvas-2`'s `QUERY DOMAIN` eyebrow is a matcher artifact:
   measure the eyebrow's computed style directly (it must be 9px / 600) and write the measurement in
   its waiver line. Every Domains-specific part — the Query domain card, its drawer body, Last run,
   the domain list, the Domains checklist and callout — stays at 0 drift with no waiver.
2. **The "+ Add to canvas" menu follows `DmF-Canvas-1`, the only board that draws it:** Agent · Gate ·
   Ship · Stop · Query domain, with no Presets row. It is the same list the inline node "+" picker
   uses (`frontend/src/canvas/paletteItems.ts`), so both change. "Agent" adds a blank agent of the
   worker kind (every agent runs the agent loop since M-unify, and the worker seat's defaults are the
   models proven in that loop). Role starting points (PM, Architect, Engineer, Reviewer) come from
   the drawer's Templates — confirm all four are offered there. The API keeps accepting
   `node_kind: "thinker"` and `preset` (APIs only add). Existing teams don't change. After the
   change, `DmF-Canvas-1`'s menu items must be at 0 drift (no waiver for the menu). If any F5 board
   draws the palette or the inline "+" picker and would drift, stop this change and write
   NEEDS_HUMAN. Update every e2e spec that picks a Thinker, Worker or preset chip. Build it on the
   Domains branch.
3. **Privacy page** (`docs/what-tvashtr-stores.md`, the Desktop app's "Privacy" link) is approved as
   the page, with two edits on the Desktop app branch: (a) replace the operator-facing "Interim page
   … The operator's privacy statement replaces it." with the user-facing line "A plain list of what
   Tvashtr keeps and who else handles it. It is not a legal privacy policy."; (b) add a section
   "Who else handles your data", written only from the code and config: the model providers you add
   keys or plans for (they receive your prompts and the code agents work on), where Tvashtr is hosted
   and where its database runs, GitHub (sign-in, repos, pull requests), and the embeddings provider
   for Domains and memory. The independent review checks every sentence of the page against the code.
4. **Licence:** until the operator picks one, the website says "source on GitHub" (as built). Not a
   blocker.
5. **The "Spec only" template stays hidden** (making it work needs a `team_run.py` walk change the
   rules forbid). Say so in the report.
6. **`make test` never runs against a database the e2e specs use.** It left hundreds of unfinished
   fixture runs that made live e2e return 429. Create `tvashtr_gate` once in the compose Postgres,
   `alembic upgrade head` against it, and run `make test` with `DATABASE_URL` pointing at it. Echo
   one line proving the suite used `tvashtr_gate`. If the settings don't honour `DATABASE_URL` from
   the environment, fall back to clearing stale runs + PENDING DBOS workflows after `make test`, and
   say so.

## Work order

1. **Desktop app** — resume Ship Protocol step 1 in the `desktop-app` worktree at `fae2116`, with
   ruling 3's edits.
2. **Website** — merge `main` into `feat/revamp-website` (it picks up the shipped Desktop app work),
   then the Ship Protocol.
3. **F6 Focus + Docs** — merge `main` in, run the independent review, fix what it finds (bugs
   test-first), re-run the F6 sweep, then the Ship Protocol.
4. **Domains** — merge `main` in, apply rulings 1 and 2, then the Ship Protocol with the step-6 pause.
5. **Phase 3** — close out (below).

Each ship bumps `desktop/package.json` one minor version: 0.9.0, 0.10.0, 0.11.0, 0.12.0.

Special rules that still hold: every Download button uses the stable link in
`frontend/src/lib/desktopDownload.ts` (`…/releases/latest/download/Tvashtr-mac.dmg`), never one
version; wherever Mac install steps appear, keep the one-line fix
`xattr -dr com.apple.quarantine /Applications/Tvashtr.app`.

## Ship Protocol (after every area)

1. **Gates** (all must pass; echo each result):
   - `make test` 0 failed, on `tvashtr_gate` (ruling 6).
   - `cd frontend && npx vitest run`, `npx tsc --noEmit`, `npm run build`.
   - `cd desktop && npm test`.
   - `docker build -t tvashtr-ship .`
   - eslint `--max-warnings 0` + prettier on changed frontend files; ruff check + format-check on
     changed backend files.
   - **Lead parity re-render:** re-shoot every artboard of the area on web and Desktop and confirm
     each committed line in `docs/superpowers/parity/<area>.txt` reproduces: 0 size/type drift, or a
     `# waiver` line the rulings allow. Read the `MISSING` lines too: any "not found in app" item that
     is a real control or text (not window chrome, an annotation or sample data) gets built, or a
     `# note` saying why not.
   - **Independent review** by a helper that did not build the area: correctness, every new or
     changed route owner-scoped (another account gets 404, one test per route), auth changes, and
     this brief's hard rules. Fix what it finds (bugs test-first) before merging. Echo its findings
     and what you did about each.
   - Every e2e spec that touches the area, plus `revamp-shell`, against the real stack. Clear stale
     runs + PENDING DBOS workflows first.
   - `make demo-proof` C1–C12 with a real PR (`make seed` first; clear stale runs + PENDING DBOS
     workflows; up to 3 attempts for provider flakes).
2. Update `docs/superpowers/HANDOVER-2026-09-25-revamp.md` (what shipped, what's next) and commit it.
3. Set `desktop/package.json` to the next minor version and commit it.
4. `git fetch origin`. If `origin/main` moved, merge it into the branch (no rebase) and re-run step 1.
5. From the main checkout: `git checkout main && git pull --ff-only origin main && git merge
   --ff-only <branch> && git push origin main`. Never force. If the fast-forward fails, go back to
   step 4.
6. **If this ship adds a migration or changes `team_run.py` (Domains does both): STOP before
   deploying.** Write NEEDS_HUMAN asking the operator for two things: (a) a Neon snapshot of
   production (Neon console → Branches → New branch from main, "now"); (b) to open Home › Running now
   on https://tvashtr.fly.dev and stop or wait out any running run, because runs in flight across this
   deploy won't resume. Wait for "go".
7. `fly deploy`. Confirm the release command ran. Smoke: `curl https://tvashtr.fly.dev/health` is ok;
   headless Playwright loads the landing and sign-in pages with no page errors; the JS asset name in
   the live `index.html` equals your local production build's; for the area you shipped, check an
   unauthenticated page or text if it has one. Run `make demo-proof-prod` only if its saved session is
   still valid; if stale, say so and move on — don't wait for a login.
   If the smoke fails: roll back to the previous image (`fly releases --image`, then `fly deploy
   --image <previous>`), confirm health, write NEEDS_HUMAN, stop.
8. Desktop release: `git tag desktop-v<version> <main sha> && git push origin desktop-v<version>`.
   Wait for the "Desktop Mac Release" workflow (poll the public GitHub API or the redirect of
   `https://github.com/lazyxgenius/Tvashtr/releases/latest/download/Tvashtr-mac.dmg` until it names
   the new tag; give up after 30 minutes with NEEDS_HUMAN). Download the DMG, mount it read-only
   (`hdiutil attach -nobrowse -readonly`), confirm the app's version and that its bundled frontend
   matches this ship's build (same JS asset name). Detach it.
9. Record in the revamp handover file: area, main sha, Fly release number, DMG tag.

## Phase 3 — close out

- **Full e2e table:** every spec in `frontend/e2e`, against the real stack, one at a time; echo a
  table (spec · pass/fail · why). Fix real failures test-first; a provider flake gets up to 3 tries.
- A final ship only if Phase 3 changed code.
- The revamp handover file: round 2 marked done, the ship table complete, everything left over listed
  with where it is recorded.
- Local cleanup: remove this session's worktrees under `.claude/worktrees/` whose branches are
  shipped, and drop their databases (`tvashtr_f2` … `tvashtr_gate`). Local only — never delete a
  remote branch or tag.
- The final report.

## Hard rules

- Fast-forward only into `main`. Never force-push, never rewrite or delete remote history, never push
  to `main` without step 1 green.
- Never touch production data or infrastructure beyond `fly deploy`: no SQL against prod, no Fly
  secrets/scale/region/machine changes, never raise the run ceilings.
- Migrations: never edit `0001`–`0041`. `0042_domain_message_meta` (on the Domains branch) is the only
  new migration this session may ship; add no other.
- APIs only add fields. Every new read and write is owner-scoped (another account gets 404).
- `team_run.py`: new DBOS steps only; never change an existing step's return shape; no module-level
  OpenHands import.
- Bugs: reproduce first with a failing test; never weaken an assertion.
- Commit your own paths by name; never `git add -A` / `git add .`; never commit `design/`,
  `HANDOVER.md`, `PROJECTPLAN.md` or anything in `prompts/`.
- At most 2 helper agents at a time, each in its own worktree with its own database and ports. Check
  their commits every 20 minutes; restart a stalled one from its last commit with the same brief; log
  every restart.
- Keep the "Next" line in `STATE.md` and the revamp handover file current before every long step, so a
  session stopped by a usage limit can resume exactly there.
- Stop only for NEEDS_HUMAN: a missing key, a provider down after 3 attempts, a design question the
  files can't answer, the step-6 pause, a failed prod smoke. **To stop:** write the NEEDS_HUMAN block
  in `STATE.md` (and the revamp handover file), echo the same block in the chat, and end your turn.
  Don't keep working after it, and don't restate it if you are re-prompted.

## Report (after every ship, and a full one at the end)

Branch and commits; per file what and why; every command with its result; parity lines per artboard
(web + Desktop) and every waiver; the independent review's findings; e2e results; demo-proof C1–C12
and the PR URL; main sha, Fly release, DMG tag and the DMG check; deviations and why; anything outside
scope; what was not done; risks.
