# Handover — frontend revamp (round 1: 2026-09-25 · round 2: the revamp-e2e session, 2026-09-26)

Design: the Claude Design artifact https://claude.ai/artifact/V6THVh3i7RFjMUtuS2dskK ("Tvashtr
Agent Panel Redesign"). Round 2 works from the on-disk export `design/revamp-export/project` (486
artboards, git-excluded), per the brief `prompts/revamp-e2e.md`.

## Round 2 — revamp-e2e session (start here to resume)

**Next (revamp-finish session, brief `prompts/revamp-e2e.md` Sidechat-16 version):** Domains
(`feat/revamp-domains`: rulings 1 and 2 are on the branch; its review findings are being fixed; migration
`0042` + `team_run.py`, so the deploy pauses for the operator's Neon snapshot and the in-flight prod
runs) → Phase 3 close-out.

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
| F3 — Toolkit › Tools + Secrets (+ `fix/ship-identity`) | `feat/revamp-f3-tools-secrets` | `c1a0172`, then `f6e1d4e` | v22 | `desktop-v0.6.0` — latest release; DMG app 0.6.0 bundles `index-DlPFWcla.js` = the live site |
| F4 — Toolkit › Skills + Memory | `feat/revamp-f4-skills-memory` | `055671a` | v23 | `desktop-v0.7.0` — latest release; DMG app 0.7.0 bundles `index-CMst77H3.js` = the live site |
| F5 — Agent panel + canvas (+ `fix/integration-review`) | `feat/revamp-f5-panel` | `b33c630` | v24 | `desktop-v0.8.0` — latest release; DMG app 0.8.0 bundles `index-DUzUTMWb.js` = the live site |
| Desktop app screens | `feat/revamp-desktop-app` | `9e2aaa0` | v25 | `desktop-v0.9.0` — latest release; DMG app 0.9.0 bundles `index-O26nkR8a.js` = the live site |
| Website pages | `feat/revamp-website` | `c7848be` | v26 | `desktop-v0.10.0` — latest release; DMG app 0.10.0 bundles `index-gm2lGZ9k.js` = the live site |
| F6 — Focus view + Documents (+ Q20 run drawer) | `feat/revamp-f6-focus-docs` | recorded at the next ship | recorded at the next ship | `desktop-v0.11.0` |

### F6 Focus view + Documents — what shipped (`feat/revamp-f6-focus-docs`)
- Documents: the canvas toolbar's Documents toggle and count, doc chips on the cards, the Documents
  drawer, and the document viewer (versions, compare, live edit with ⌘S, browser Back, Copy of the
  shown version). The focus view's Docs tab.
- Focus view: Setup (numbered agent preview, Review changes, the Templates dialog with a one-sentence
  summary per template), Skills, Memory and Runs in two panes.
- Q20 (operator bug 2026-09-29): the run view's agent drawer is now the Team screen's tabbed drawer,
  opening on Runs (this run's rounds with exact tokens and cost, then Activity · Changes · Ask);
  Setup and Skills & tools show the run's copy read-only with "Edit on the team"; Memory and Docs are
  the run's. The old run inspector is gone from the run canvas.
- "Show all 1 lines" on a wrapped instruction now reads "Show all" (the line count shows only past
  nine lines).
- Backend (additive, owner-scoped, no migration): node history runs carry the run's memory repo key
  and label; node templates carry a one-sentence summary.
- Independent review: 14 findings, 10 real, all fixed test-first — the Templates dialog now opens on
  top of the focus view with the keyboard; docking resets Preview/Review to the editor; a template's
  Undo restores only what it changed; an open viewer and the Documents drawer keep up with a live run
  (an edit in progress keeps its text; Edit starts from the real latest version); "The run is live"
  goes once the run has finished; a save shows the saved version at once; closing a viewer the canvas
  opened leaves no dead Back step; no "Edit on the team" for an agent since deleted from the team;
  an opened earlier round shows one exact cost; the steering e2e opens the Docs tab first. Not
  changed: #3 (already fixed on the branch), #5 (a whole-line delete shows no band in the focus
  editor — the same on `main`, not this branch's; follow-up), #9 (Copy copies the shown stored
  version, as DOCS-19 specifies).
- Gates at ship: `make test` 1924 passed / 1 xfailed on `tvashtr_gate`; vitest 1791; tsc 0;
  build; desktop 135; docker; eslint 88 + prettier 98 + ruff 3 clean (four `require-await` errors in
  `api.test.ts`, there since `main`, fixed); e2e steering, run_diff, node_ask, team_edit,
  authoring_brief, edits_toggle, memory_shelf, tools_c7c, capability_edit, model_picker, work_brief,
  revamp-shell, tools-c7a; `make demo-proof` C1–C12 PR https://github.com/lazyxgenius/trade_mcp/pull/27.
- Parity: `docs/superpowers/parity/focus-docs.txt` 34/34 lines and `panel.txt` 130/130 reproduced at
  0 size/type drift, web and Desktop.

### Website pages — what shipped (`feat/revamp-website`)
- The public site (`frontend/src/pages/site/`): the landing (1440 and phone), sign-in with its
  error and "Signing you in…" screens, the download pages (Mac, Windows/Linux, install steps with the
  `xattr` line and a Copy button, "Open Tvashtr?"), the phone menu and "works best on a computer"
  sheet, the site header (signed in: "Open app") and footer. Public addresses `#/welcome`,
  `#/download[/started]`, `#/signin[/done]`; the empty address is the landing signed out and Home
  signed in; Tvashtr Desktop never renders a public page; a 401 mid-session goes to
  `#/signin?next=`.
- Backend: `GET /api/auth/github/start` with a signed one-attempt `tv_oauth_state` cookie (login
  CSRF fix, `next` validated), the GitHub callback's website branch (every outcome returns to the
  sign-in screens), public `GET /api/public/site` (latest Desktop version, stars; the DMG link is
  always the stable one). No migration.
- Licence (architect ruling 4): the site says "source on GitHub" until a LICENSE is chosen.
- Merge of `main` (the Desktop app): the GitHub callback keeps both branches (Desktop first, then the
  website's state cookie); two dead CSS blocks dropped.
- Found at ship: the image didn't build (`desktopDownload.test.ts` imported `desktop/package.json`,
  outside the image's frontend stage) — fixed, reproduced by `docker build`.
- Independent review (4 dimensions, each finding adversarially verified): 9 findings, 8 real, all
  fixed test-first. Three GitHub sign-in holes that were already live through older paths: a
  query-string `installation_id` could take over another account's or an org's installation (now
  only ids GitHub lists for the signing-in user are recorded); a GitHub code with no state this
  server issued signed any browser in — login CSRF (a signed-out browser is now sent to
  `#/signin?error=expired`, a signed-in one only refreshes its own account; the in-app Connect
  GitHub return and pre-v6 Desktop's loopback flow keep working); linking by email kept a password
  nobody proved (a pre-registered `<login>@users.noreply.github.com` could keep access; linking now
  revokes it). A phone could still reach the DMG via `?os=mac` or `#/download/started`. Honest
  copy: only steps on a Claude/Grok plan run on the Mac, and nothing forces a reviewer before Ship
  ("Every change reviewed" → "Review loops and approval gates before it ships"). One refuted (the
  FAQ's code answer omits detail but claims nothing false).
- Follow-ups (not built): the Engines "Get Tvashtr Desktop" dialog (F2) still says "Runs stop when you
  quit the app" — the same over-claim, left because it's another area's parity record; a
  `tv_oauth_state` cookie from a sign-in abandoned in the last 10 minutes sends a GitHub App
  install return (no code) to "sign-in expired" instead of back to the app.
- Gates at ship: `make test` 1921 passed / 1 xfailed on `tvashtr_gate`; vitest 1724; tsc 0; build;
  desktop 135; docker; eslint 44 + prettier 46 + ruff 9 clean; e2e auth, accounts, memory_shelf,
  website (8), revamp-shell; `make demo-proof` C1–C12 PR https://github.com/lazyxgenius/trade_mcp/pull/26.
- Parity (`docs/superpowers/parity/website.txt`): all 24 web boards at 0 size/type drift except
  `WbF-Err-1`'s accepted one-link wrap (a `# waiver`); the honest-copy strings are noted as "not
  found in app"; Desktop n/a (website-only).

### Desktop app screens — what shipped (`feat/revamp-desktop-app`)
- Tvashtr Desktop's own first-run and launch screens (`frontend/src/pages/desktop/`, bridge v6):
  Welcome / Handoff / Waiting / Sign-in didn't finish / Expired / Splash / Offline / Reconnected,
  setup (Engines with the plan rows, Terminal sign-in, the Claude/Grok "Use your plan" sheets and
  the Add-key sheet; Project with folder + git set-up + GitHub; First team), the ready card on Home
  and the in-app updater card. Signed-out Desktop never shows the website's landing page.
- Backend: browser sign-in with PKCE (`/api/auth/desktop/start`, the GitHub callback's desktop
  branch, `/api/auth/desktop/exchange`), `GET /api/desktop/release`, `POST
  /api/desktop-runner/jobs/{id}/release`, `GET /api/templates?for=desktop` and `POST /api/teams
  {use_plans}` (plan-first models), `provider_directory[].serves_models`. Contract:
  `docs/superpowers/plans/api/desktop-app.md`. No migration.
- Architect rulings applied: the privacy page `docs/what-tvashtr-stores.md` (ruling 3: the
  user-facing header line and "Who else handles your data", every sentence re-checked against the
  code by two independent reviewers); "Spec only" stays hidden (ruling 5: not offered by the setup
  UI nor listed by `?for=desktop`; `POST /api/teams` still builds it, pinned by a strict xfail).
- Independent review (6 dimensions, each finding adversarially verified): 22 findings, 20 real, all
  fixed test-first — a released Desktop job was failed "not connected" instead of re-run; the
  browser sign-in could be replayed into another browser and `account=current` handed out a code
  without asking (now a flow cookie binds the sign-in to its browser, and a consent page names the
  account); "Use a different account" now shows GitHub's account picker; only `access_denied`
  reads as "cancelled"; a stale DMG mount could wedge the updater; "Set up git here" credited an
  email-only account's commit to a stranger's GitHub noreply address; a job claimed mid-quit was
  never released and a CLI spawned after cancel was orphaned; a new account inherited the previous
  one's `#/setup/<step>`; a NIM key turned Continue on; the Add-key sheet reset while typing; nine
  privacy-page corrections. One finding refuted (a local app hijacking `tvashtr://` needs malware
  already on the Mac).
- Gates at ship: `make test` 1892 passed / 1 xfailed on `tvashtr_gate`; vitest 1626; tsc 0; build;
  desktop 135; docker; eslint 66 + prettier 70 + ruff 16 clean; e2e auth, accounts, memory_shelf,
  team-library, revamp-shell; `make demo-proof` C1–C12 PR https://github.com/lazyxgenius/trade_mcp/pull/24
  (C12's cleanup now also works when Home shows its first-time checklist).
- Parity (`docs/superpowers/parity/desktop-app.txt`): all 39 Desktop boards at 0 size/type drift
  (web n/a: Desktop-only screens); every "not found in app" item is a noted deviation (honest copy
  OQ-4/10/11/12, Spec only hidden, the OS Terminal window).
- Follow-ups found on the way (not built): Domain files live on the Fly machine's disk under
  `/tmp` (`TVASHTR_DOMAIN_FILES_DIR` unset, no volume) so uploads are lost on a restart — needs a
  volume (infrastructure, operator's call); fonts load from Google Fonts (self-host to drop that
  data flow); the Codex status hint can carry the email Codex prints; a local app registered for
  `tvashtr://` could still take the auto-returned code after an interactive GitHub step (accepted:
  it needs local malware).

### F5 Agent panel + canvas — what shipped (`feat/revamp-f5-panel`)
- The agent drawer rebuilt on the new design (`frontend/src/panel/`): the header with status and the
  More menu, tabs Setup / Skills & tools / Memory / Runs / Docs, the save bar with unsaved-changes
  guard (Keep editing / Discard; Desktop's quit guard via `setUnsavedChanges`), Templates, the model
  picker (derived from `/api/config`'s provider catalogue; NVIDIA NIM never offered), access and
  documents, routing, output format with the schema checks, the Focus view entry, skill and tool
  sub-views (add from library / preset / GitHub repo, paste mcp.json), the Memory tab (remember
  toggle, notes, Open Memory shelf), Runs (last run, earlier rounds) and Docs (run documents in an
  in-drawer sheet). Canvas chrome: the blocked-run warn callout with Open Engines (Eng-Flow-Blocked-1,
  moved from F2) and the run view keeps `RunWarnings`. `TeamNodePanel`, `SkillsSection`,
  `ToolsSection`, `NodeMemorySection`, `DrawerShell`, `SidePanel` and `StatusPill` are gone. No backend
  change (every endpoint the drawer needs already existed).
- Parity (`docs/superpowers/parity/panel.txt`): all 65 artboards at 0 size/type drift on the website
  AND Desktop. Flow-Docs-1/2 and Flow-Templates-1 each have one "not found in app" item by decision:
  a verdict agent's Writes note no longer offers "Set in Setup" (its Writes control is disabled), and
  the Templates item reads "Open in focus view" (no compare view exists yet; F6 can restore it).
- Deviations: Q20's tabbed run-view drawer (Runs default, read-only Setup) is not built (recorded in
  spec §4.7); the Docs tab opens documents in an in-drawer sheet until F6's viewer exists; the
  Remember hint says captured lessons go to Toolkit › Memory (they are repo-tier, never node-tier).
- Shipped with it, `fix/integration-review` (the cross-area review): nav badges re-count when the
  canvas is left and after a key, subscription or memory change; a pending Home/Engines action is
  cleared when a leave guard keeps you on the page; Toolkit's secret dialog and "Choose agents" toast
  survive navigating away; dead dashboard CSS removed.
- Found at ship time (team-edit e2e): a new account's Home drew the main layout while its
  checklist data loaded, then switched to the first-time layout, remounting the composer and
  dropping a typed idea. Home now picks its layout once that data is in (unreadable preference →
  the main Home, as before); the 88 Home/shell parity renders are byte-identical before and after.
- Left for later: the drawer's paste-mcp.json reader (`panel/tools/pasteMcpJson.ts`) and Toolkit's
  (`pages/tools/mcpJson.ts`) are separate (different copy per screen); merge when one copy is chosen.

### F4 Toolkit › Skills + Memory — what shipped (`feat/revamp-f4-skills-memory`)
- Toolkit › Skills on the new design: the list and presets, the row ⋯ menu (duplicate, turn on for
  agents, delete with its impact), the skill editor (new and existing: SKILL.md, load mode, triggers,
  source), Add from GitHub (scan, pick, import). Toolkit › Memory: Inbox (keep / discard / edit, with
  Undo), Active (filters by agent, repo and kind, pin, edit, scope), Archive, and the Add memory sheet;
  the Memory nav opens the Inbox when memories wait (MEM-4). `SkillsShelf.tsx`, `MemoryShelf.tsx` and
  `MemoryFact.tsx` are gone; pages in `frontend/src/pages/skills/` and `frontend/src/pages/memory/`,
  clients `frontend/src/lib/api/skills.ts` and `memory.ts`. Backend: `control_plane/memory.py` no
  longer flips a memory's superseded reason after a force edit (tested); the memory contract doc was
  updated. The agent drawer's skill and memory hints now point at Toolkit › Skills / Memory.
- Parity (`docs/superpowers/parity/toolkit-skills-memory.txt`): all 46 artboards at 0 size/type drift
  on the website AND Desktop, no waivers.
- An existing skill with a legacy (non-kebab) name now saves; a memory edit the embedding service
  can't take says so and keeps the app online.

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
- revamp-finish (2026-09-29): `make test` runs on its own database `tvashtr_gate` — pass it as a
  make variable (`make test DATABASE_URL=…/tvashtr_gate`); in the environment it is overridden by
  the Makefile's `include .env`. Every active worktree `.env` now says `POSTGRES_DB=tvashtr` (each
  used to name its own database, so an e2e script's `docker compose up -d` from another checkout
  recreated the shared Postgres mid-run).

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
