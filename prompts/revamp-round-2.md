Continue the Tvashtr frontend revamp (round 2). Round 1 is now merged into `main` and live. Start from `main`: first check that it contains round 1 (`git merge-base --is-ancestor 9c40a13 origin/main` must succeed) and that `backend/.venv` is not tracked (`git ls-files backend/.venv` prints nothing). If either check fails, stop and tell me.

Read these first:
- docs/superpowers/HANDOVER-2026-09-25-revamp.md (current state, what's left, how to get the design files)
- docs/superpowers/plans/2026-09-25-frontend-revamp.md and docs/superpowers/specs/2026-09-25-frontend-revamp-design.md
- docs/superpowers/briefs/backend-slice-brief.md and docs/superpowers/briefs/frontend-slice-brief.md (including "Lessons")
- the API contracts in docs/superpowers/plans/api/

The design is my Claude Design artifact: https://claude.ai/artifact/V6THVh3i7RFjMUtuS2dskK
It is too big to open in a browser. Download it file by file with the Artifact tool and render it, as the handover describes. It has 486 screens. If you cannot use the Artifact tool or cannot get the files, stop and tell me. Do not build from memory or guesses.

Work in this order:
1. The screens from the original design that are not built yet: F2 Engines, F3 Toolkit Tools + Secrets, F4 Toolkit Skills + Memory, then F5 Agent panel and F6 Focus + Docs (F6 builds on F5).
2. Then the screens added to the design later: Domains (Dm-*, DmF-*), the Tvashtr Desktop app screens (DT-*, DtF-*), and the website pages (Web-Landing, Web-SignIn, Web-Download*, Web-Mobile, WbF-*). For each new area: analyse the screens (same format as the round-1 analysis files), find any backend features that are missing and build those first, then build the screens. Domains already has a working backend and page (built Sep 15–22): reuse its API and only add what is missing.
3. Keep every browser test in frontend/e2e green. They were rewritten for round 1; update any that your screens change and add tests for new flows. `demo-proof.spec.ts` must keep working with your changes. It needs internet and real keys, so it cannot run here: say so in the report and it will be run on my Mac before merging.

The Desktop download:
- Every Download button on the website (Web-Landing, Web-Download*, WbF-*) must use the stable link in frontend/src/lib/desktopDownload.ts (`https://github.com/lazyxgenius/Tvashtr/releases/latest/download/Tvashtr-mac.dmg`), never a link to one version, so the site always offers the newest DMG. Keep the DMG file name `Tvashtr-mac.dmg`.
- Any Desktop screen that shows the app version or an update prompt (DT-Update, DtF-Upd-*) must use the real version from desktop/package.json.
- At the end of the round, set desktop/package.json's version to 0.4.0 so the next DMG release is a new version.

Rules:
- Every screen must match the design's sizes exactly. It must pass the parity gate (0 size/type drift) on the website and in Tvashtr Desktop. Save each area's parity summary (one line per artboard, website and Desktop) to docs/superpowers/parity/<area>.txt and commit it.
- Use at most 3 helper agents at a time. Check their commits every 20 minutes, and restart any that stop (from their last commit, with the same brief). Note every restart in the report.
- Database: never edit migrations 0001–0041. If a new area truly needs schema, add at most ONE new migration for the whole round (0042), and extend .claude/hooks/protect-migrations.sh to freeze 0041.
- Keep the round-1 rules from the plan: APIs only add fields, never remove them; every new read and write is owner-scoped (another account gets 404); in team_run.py only add new DBOS steps, never change an existing step's return shape; don't change the EngineAdapter interface.
- Commit only the files you changed, by path. Never use `git add -A` or `git add .`.
- New and changed files must pass eslint (--max-warnings 0), prettier and ruff. Don't fix old lint in files you don't touch.
- After each finished area: run the backend, frontend and Desktop tests, update docs/superpowers/HANDOVER-2026-09-25-revamp.md with where things stand, then push your branch. If you run out of usage mid-area, the next session must be able to pick up from that file.
- Before each push, fetch origin/main. If it has new commits, merge it in (no rebase) and re-run the tests.
- Push only your own branch. Never push to main, never force-push, never merge anything into main, never deploy, never create tags or releases. If you cannot push, make a git bundle of your branch and tell me where it is.
- If something needs a big change to existing behaviour that the design doesn't clearly ask for, or you are blocked by something outside the code (keys, internet, design files), don't guess: write it as NEEDS_HUMAN in the handover file, push, and carry on with the next area.

Finish with a detailed report:
- the branch name, the final commit, and every commit in order
- for each area: every file changed and why; every command run and its result; the parity line for every artboard (website and Desktop); any deviation from the design or the plan, and why
- test results: backend, frontend, Desktop, type check, build, and each browser test
- anything you touched outside the areas above
- what is not done, what could not be run here, any helper that stopped, and any risks you see
