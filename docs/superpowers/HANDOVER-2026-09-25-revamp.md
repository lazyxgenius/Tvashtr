# Handover — frontend revamp, round 1 (2026-09-25)

Branch: `claude/tender-maxwell-0wxvan`. Design: the Claude Design artifact
https://claude.ai/artifact/V6THVh3i7RFjMUtuS2dskK ("Tvashtr Agent Panel Redesign").

## Where things stand

| Part | State |
|---|---|
| Analysis of the first 335 design screens | Done — `docs/superpowers/specs/2026-09-25-revamp-analysis/` |
| Spec + phased plan | Done — `docs/superpowers/specs/2026-09-25-frontend-revamp-design.md`, `docs/superpowers/plans/2026-09-25-frontend-revamp.md` |
| Design-system components in React (`ds-` classes) | Done — `frontend/src/design-system/components/` |
| One schema migration for the revamp | Done — `backend/alembic/versions/0041_revamp_schema.py` |
| Backend slices: ENGINES, TEAMS, RUNS, TOOLKIT, MEMORY, DOCS, NODES, LOCAL | Done, merged, tested — contracts in `docs/superpowers/plans/api/*.md` |
| Desktop bridge v5 (deep links, repos/folder runs, sticky disconnect, unsaved changes) | Done — contract `docs/superpowers/plans/api/desktop-bridge.md` |
| Page addresses (hash router), new Shell (header, nav, badges, offline banner), shortcuts, toasts | Done — `frontend/src/lib/nav.ts`, `frontend/src/pages/shell/`, `frontend/src/pages/Workspace.tsx` |
| **Home** (F1: composer, Needs you, Running now, Teams, Recent runs, Spend, New team, ⌘K, first time, account) | **Done — 0 size/type drift on every Home artboard, website and Desktop** |
| F2 Engines screens | **Not started** (still the old `components/EnginesShelf.tsx` inside the new shell) |
| F3 Toolkit › Tools + Secrets | **Not started** (old `ToolsShelf.tsx`, `SecretsShelf.tsx`) |
| F4 Toolkit › Skills + Memory | **Not started** (old `SkillsShelf.tsx`, `MemoryShelf.tsx`, `MemoryFact.tsx`) |
| F5 Agent panel + canvas chrome (`Main`, `Desktop-*`, `Web-*`, `Panel-*`, `Flow-*`) | **Not started** |
| F6 Focus view + Documents (`Focus-*`, `Docs-*`) | **Not started** (F6 builds on F5's `useAgentDraft`) |
| Screens added to the design after round 1 (151) | **Not analysed** — see below |

Engines, Toolkit and Domains pages still show their old bodies inside the new shell; their nav
items work and every page has its own address.

## Screens added to the design after round 1 started

The design file grew from 335 to 486 screens during round 1. None of the new ones are analysed or
built:

| Prefix | Count | Area |
|---|---|---|
| `Dm-*`, `DmF-*` | 11 + 75 | Domains: list, sources, ask, quality, settings, use in teams, query node, and their flows |
| `DT-*`, `DtF-*` | 11 + 29 | Tvashtr Desktop app screens: welcome/sign-in, splash, project, ready, team, waiting, offline, expired, handoff, update, engines, and their flows |
| `Web-Landing`, `Web-SignIn`, `Web-Download*`, `Web-Mobile`, `WbF-*` | 6 + 19 | Website: landing, sign-in, download for Mac/Windows, mobile, FAQ, and their flows |

The 335 round-1 screens were unchanged when checked (byte-identical sizes on a sample from every
area).

## Design files — how to get them (do this first in a new session)

The design canvas is too big for a browser to open, so read it file by file:

1. With the Artifact tool: `action: "list", scope: "files", url: <design URL>` lists every file.
2. `action: "read", url, paths: [...]` (≤ 256 paths per call, `out_dir` = a scratch folder, e.g.
   `<scratch>/design`) downloads them. You need: `project/*.dc.html`, `project/canvas.json`,
   `project/tvashtr-tokens.css`, `project/ds/designsystem_dbaa69/components/bundle.css`,
   `project/ds/designsystem_dbaa69/components/bundle.js`,
   `project/ds/designsystem_dbaa69/tokens.json`, and `artifact-type/dc-runtime.js`.
3. Save `artifact-type/dc-runtime.js` as `project/support.js` (every screen loads
   `./support.js`).
4. Render + measure each screen (PNG + JSON), and write readable outlines:
   ```bash
   export DESIGN_DIR=<scratch>/design/project FONT_CACHE_DIR=<scratch>/font-cache
   node scripts/design-parity/shoot-design.mjs <scratch>/design-png Dm-List DT-Welcome …
   python3 scripts/design-parity/outline.py "$DESIGN_DIR" <scratch>/outlines   # one .txt per screen
   ```
   Fonts are fetched through `curl` and cached (a fallback font makes everything look bigger).

## How to build a slice (the process that worked)

- Briefs: `docs/superpowers/briefs/backend-slice-brief.md` and
  `docs/superpowers/briefs/frontend-slice-brief.md` (read the "Lessons" section).
- Backend first: analyse the screens → list the backend gaps → one migration for the round →
  backend slices, each with its API contract in `docs/superpowers/plans/api/<slice>.md`.
- Frontend slices then build against those contracts, one folder per area under
  `frontend/src/pages/<area>/`, and must pass the **parity gate**: 0 items "with size/type drift"
  from `scripts/design-parity/parity.py` for every artboard, website and Desktop
  (`scripts/design-parity/README.md`). Scenario fixtures live in
  `scripts/design-parity/scenarios/` (`home-fixtures.mjs` is the model to copy).
- Each area registers its nav-badge loader in `frontend/src/pages/badgeLoaders.ts` and its page in
  `frontend/src/pages/Workspace.tsx`.
- Check on parallel helpers regularly (their commits and file times): in round 1 three helpers
  died silently on a usage limit and were only noticed ~85 minutes later.

## Verification at the end of round 1

- Backend: 1,811 passed, 2 skipped, 0 failed (full suite on a fresh database).
- Frontend: 607/607 unit tests, `tsc` clean, production build OK.
- Desktop: 88/88.
- Live: `frontend/e2e/revamp-shell.spec.ts` passes against a real backend + Vite (sign up, every
  section by address, refresh/back, shortcuts, ⌘K, New team → canvas, log out/in).
- Live API checks: every new endpoint answered correctly, including owner scoping (a second
  account can't see or use the first's teams, tools, skills, secrets, agents or folders).

## Known issues and follow-ups

- **Old e2e specs are stale.** The landing page changed on Sep 22 (before round 1), and several
  specs still drive the old dashboard ("Open <team>", a seeded "My team"). Updated so far:
  `revamp-shell`, and partly `team-library`, `edits-toggle`, `node-ask`, `run-diff`,
  `scope-picker`, `steering`, `team-edit`, `model-picker`, `fix1_signoff` (via
  `e2e/_myTeam.ts`). Still to rewrite for the new UI: `accounts`, `auth`, `demo-proof`,
  `capability-edit`, `endpoint-edit`, and re-verify the rest.
- Lint baseline (unchanged by round 1): 69 eslint errors and ~29 prettier-unformatted files in
  older frontend files; ~38 ruff errors in older backend files.
- Adding a memory needs the OpenAI embedding service (it can't be exercised offline); its unit
  tests pass with a stubbed embedder.
- A run recovered onto another Fly machine after a deploy that changed `team_run.py` step names
  can fail with `DBOSUnexpectedStepError` (B-DOCS note; would need DBOS patching).
- Desktop folder runs: a snapshot starts one run only; "Start again" must upload a fresh bundle.
- `.claude/hooks/protect-no-push.sh` is no longer referenced by settings and can be deleted;
  `prompts/CLI-RULES.md` §3 still says "the agent never pushes".
