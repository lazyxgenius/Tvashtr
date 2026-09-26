# Handover — frontend revamp (round 1: 2026-09-25 · round 2: the revamp-e2e session, 2026-09-26)

Design: the Claude Design artifact https://claude.ai/artifact/V6THVh3i7RFjMUtuS2dskK ("Tvashtr
Agent Panel Redesign"). Round 2 works from the on-disk export `design/revamp-export/project` (486
artboards, git-excluded), per the brief `prompts/revamp-e2e.md`.

## Round 2 — revamp-e2e session (start here to resume)

**Next:** ship F4 Toolkit › Skills + Memory (built, 46/46 at 0 drift) → F5 agent panel + canvas
(building) → F6 Focus + Docs (branches from F5) → Domains (building; carries the session's one
migration `0042`, so its deploy waits for the operator's Neon snapshot) → Desktop app screens
(building) → website → Phase 3 close-out.

### NEEDS_HUMAN (2026-09-26 ~14:55 IST) — RESOLVED 15:04 IST (new key in `.env`, `make seed`)
The OpenAI key in `.env` (`OPENAI_API_KEY`, ends `…IgoA`, also the operator account's saved openai
credential) now returns 401 `invalid_api_key` (it worked at ~12:50 for demo-proof PR #15; `.env`
unchanged since Jul 22, so it was revoked upstream; no key in today's pushes or PRs). The operator's PM
and worker seats resolve to OpenAI first, so every ship's `make demo-proof` gate fails until it is
replaced. Remedy: new key on the `OPENAI_API_KEY` line of `.env` → `make seed` → tell the session "go".

### Ship log (Ship Protocol in the brief; one row per ship)

| Ship | Branch | main sha | Fly release | Desktop tag |
|---|---|---|---|---|
| Phase 0 — Desktop catch-up | — (tag only) | `ec9202b` | (no deploy) | `desktop-v0.3.0` — latest release; DMG's `dist-fe/assets/index-X7f-3U3l.js` = the local build = the live site |
| Phase 1 — the core loop completes | `fix/entry-report` | `007019d` | v20 | `desktop-v0.4.0` — latest release; DMG app 0.4.0 bundles `index-DZBnS0zK.js` = the live site |
| F2 — Engines | `feat/revamp-f2-engines` | `6acc726` | v21 | `desktop-v0.5.0` — latest release; DMG app 0.5.0 bundles `index-CGZUXJb0.js` = the live site |
| F3 — Toolkit › Tools + Secrets | `feat/revamp-f3-tools-secrets` | recorded at the next ship | recorded at the next ship | `desktop-v0.6.0` |

### Production ship fix, deployed with F3 (`fix/ship-identity`)
- **Production could never open a PR for a hosted GitHub run.** The prod demo-proof after the F2
  deploy (run 2177a044) got through the PM fallback, the spec gate, three review rounds and the
  escalation gate, then Ship's `git commit` exited 128: the per-run clone has no repo-local git
  identity and the server container has no global one (Linux git can't guess an email). Local proofs
  always passed because the Mac has a global identity. `shipping.idempotent_ship` now commits as
  "Tvashtr Agent <agent@tvashtr.local>" only for the identity keys git doesn't already have.
  Reproduced first (no global config + `user.useConfigOnly`, i.e. the container: exit 128).
- The same prod run also showed the Engineer reporting ~270 "changed" files (incl. `.pytest_cache`)
  and the Reviewer unable to run the repo's tests in the sandbox (missing dependencies). Not fixed
  here; see the ship report's risks.

### F3 Toolkit › Tools + Secrets — what shipped (`feat/revamp-f3-tools-secrets`)
- Toolkit › Tools on the new design: the list (tabs, search and filters, empty states, row ⋯ menus,
  Turn on for agents), Browse (the catalog, the GitHub App round trip), the Add tool wizard (remote,
  local command, paste mcp.json, secrets in headers/env), and the tool page (settings, used by, the
  missing-secret fixes). Toolkit › Secrets: the page, add / replace / delete with impact, the ⋯ menu,
  the fix-a-missing-secret flows. `ToolsShelf.tsx` and `SecretsShelf.tsx` are gone; pages in
  `frontend/src/pages/tools/` and `frontend/src/pages/secrets/`, client `frontend/src/lib/api/tools.ts`,
  and the Toolkit nav badge (counts, "N missing") from `GET /api/toolkit/summary`. No backend change.
- Parity (`docs/superpowers/parity/toolkit-tools.txt`): all 57 screen artboards at 0 size/type drift
  on the website AND Desktop, no waivers. Not screens: `Toolkit-BeforeAfter`, `TkF-Index`.
- Deviations: copy the design doesn't draw, each backed by the backend — the Start-from button reads
  "Open the catalog" / "Paste mcp.json" when chosen by keyboard; "Discard this tool?" confirm; the
  empty filter states; the lower-case secret-name message; "Clear choice". `lib/api.ts` had eslint and
  prettier errors on main (domains types); they were fixed because the file entered the diff.
- Not done: lower-case `${name}` refs are blocked only in the wizard's Connection step (the paste sheet
  and the tool page still accept them; the secret dialog explains the rule). "Open <Role>" into the
  team drawer waits for F5.

### F2 Engines — what shipped (`feat/revamp-f2-engines`)
- The whole Engines area on the new design: Overview (can your teams run, per website and Desktop,
  "N to fix" nav badge), Subscriptions (Claude / Grok / Codex cards and every connect, refresh,
  disconnect and API-key flow; the website's "Open in Desktop" deep link), API keys (Replace, Remove
  with its impact, "See where it's used"), the Add key sheet (provider picker, "Other" prefixes,
  save errors, toasts, embeddings keys) and first-time. `EnginesShelf.tsx` is gone. Pages in
  `frontend/src/pages/engines/`, client `frontend/src/lib/api/engines.ts`, `tvashtr://` deep links
  wired in `lib/desktopDeepLinks.ts`. No backend change was needed (round 1 built it).
- Parity (`docs/superpowers/parity/engines.txt`): 52 of the 56 screen artboards at 0 size/type drift
  on the website AND Desktop. `Eng-Flow-Key-1…4` carry a LEAD WAIVER: the design draws a stale
  "anthropic" banner beside the anthropic key that was just saved, contradicting its own banner text
  and ENG-58 (honest copy wins); only those stale-banner items drift. Not screens: `EnF-Index`,
  `Eng-BeforeAfter`, `Eng-CardStates` (a state catalogue; all six states are built and tested).
  `Eng-Flow-Blocked-1` (the canvas banner) moved to F5.
- Deviations (design doesn't cover them): NIM reads "No agent uses NVIDIA NIM right now." and never
  counts toward a team being ready; the Mac Get-Desktop dialog adds the unsigned-app fix
  `xattr -dr com.apple.quarantine /Applications/Tvashtr.app`; off a Mac it says "Tvashtr Desktop is
  Mac-only for now." with a releases link; an agent with no model makes a team not ready ("give
  <Role> a model").
- Also in this ship: `fix/ship-sidecars` — Ship leaves Tvashtr's own untracked `REPORT.md`,
  `REVIEW_VERDICT.json` and `SPEC.md` out of the user's repo (live PR lazyxgenius/trade_mcp#14 had
  shipped the PM's REPORT.md). Reproduced first.
- Operator follow-ups from this stretch: the prod account's Gemini key is quota-limited (429), so
  `make demo-proof-prod` fails at its Engineer — give that account a paid key or another worker
  provider; the saved prod session expires ~2026-09-27 13:12 IST (`make demo-proof-login`).

### Phase 1 — what shipped (`fix/entry-report`)
- **The PM's closing message becomes the spec when it didn't write `REPORT.md`.** Live runs
  e62d9995 … 99539c30 failed "entry node produced no REPORT.md": OpenAI PMs put the PRD in their
  `finish` message or a plain reply. `openhands_adapter._payload_of` now keeps the agent's closing
  words whole in `run_events` (`payload.message` for `finish`, `payload.content` for an agent reply;
  capped at 100k chars; the 2,000-char feed previews are unchanged). A NEW DBOS step
  `team_run.entry_closing_message_step` reads the newest closing event of THIS invocation (or a
  Desktop-routed entry's final text on its job row) and records the run warning "The PM didn't save
  REPORT.md, so its final message was used"; the workflow calls it only when the entry wrote no
  REPORT.md and then versions the text exactly as REPORT.md would be. No REPORT.md and nothing usable
  still fails as before. `agent_run_step`'s return shape is unchanged. Reproduced first:
  `backend/tests/test_entry_closing_message.py` failed on the old code with the live error.
- The run view's warning banner lists run notes in their own words (it used to head every warning
  "N tools/skills didn't load").
- **Privacy fix found by the Phase 1 review:** `GET /api/spike/run-events/{run_id}` returned any
  run's events (agent thoughts, actions, terminal output) to any signed-in account. Now 404 unless
  the run is yours. Reproduced first.
- **Ship takes an agent's own commits.** The OpenHands system prompt tells agents to commit; in live
  run 42e08600 the Engineer did (`git add docs/DEMO_PROOF.md && git commit`), Ship found nothing
  staged, raised "nothing to ship", and the run never ended. `shipping.idempotent_ship` now ships the
  commits the run's branch gained since it was created (its reflog's first entry). Reproduced first.
- Live proofs: `make demo-proof` #1 C1–C12 PASS, real PR https://github.com/lazyxgenius/trade_mcp/pull/14
  (run 0d4bb37d; the PM wrote REPORT.md itself). #2 (run 42e08600): the PM did NOT write REPORT.md,
  the fallback fired live (warning recorded, its reply became spec v1, the spec gate showed it), then
  Ship hit the self-commit bug above. The final proof on the shipped HEAD is in the ship report.
- Known limits (review, verified real, deliberately not changed — both only fall back to today's
  failure): (1) a backend crash while the PM's step runs → DBOS re-runs it, and the re-run's events
  can collide with the crashed attempt's rows on `(run_id, invocation_id, seq)`, so the fallback may
  miss (run fails as before) or use the crashed attempt's closing message (same PM, same round);
  fixing it means changing how `agent_run_step` records events. (2) If the remote adapters' WebSocket
  drops before the final event, the event never reaches `run_events` (the SDK's reconcile invokes no
  callbacks), so the fallback can't fire.
- Deploys that change `team_run.py` change the DBOS application version: runs in flight across such a
  deploy are not resumed by the new code.

### Round-2 working setup (for a session that resumes)
- Builders run as Workflow scripts, one per area, each in its own worktree + database + ports, at most
  3 at once: `.claude/worktrees/f2-engines` (`feat/revamp-f2-engines`, db `tvashtr_f2`, backend 8011,
  e2e Vite 5181, parity Vite 5191), `f3-tools-secrets` (`feat/revamp-f3-tools-secrets`, `tvashtr_f3`,
  8012/5182/5192), `f4-skills-memory` (`feat/revamp-f4-skills-memory`, `tvashtr_f4`, 8013/5183/5193).
  Each worktree's untracked `.env` points at its own database and ports, and sets
  `COMPOSE_FILE`/`COMPOSE_PROJECT_NAME` so the e2e scripts' `docker compose up -d` is a no-op on the
  shared containers. Never run a builder against the default `tvashtr` database.
- The whole design is rendered once: `design/revamp-export/render/png/<Name>.png|json` (PNG + parity
  measurements), `render/outlines/<Name>.txt`, `render/areas.json` (every artboard assigned to
  exactly one area: F2 60, F3 57 (+2 commentary boards), F4 46, F5 64, F6 17, Domains 86, Desktop
  app 40, website 25; Home was round 1), `render/notes/<area>.md` (each area's builder notes).
- Parity lines per area land in `docs/superpowers/parity/<area>.txt` (two lines per artboard: web and
  Desktop).

## Round 1 — where things stood at its end

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
