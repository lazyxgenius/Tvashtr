# Frontend revamp — design spec

Date: 2026-09-25
Status: approved for build (the operator asked to go straight from analysis to plan to build)
Source design: the "Tvashtr Agent Panel Redesign" canvas (claude.ai artifact `V6THVh3i7RFjMUtuS2dskK`),
10 pages, 332 artboards + 3 index boards. Surfaces: the website (tvashtr.fly.dev) **and** Tvashtr Desktop.

Per-area gap analyses (the evidence behind every decision below — screens, numbered requirements, a
backend gap table with EXISTS / PARTIAL / MISSING rows, Desktop bridge gaps, frontend mapping, open
questions) live in [`2026-09-25-revamp-analysis/`](2026-09-25-revamp-analysis/):

| Area | File | Requirement prefix |
|---|---|---|
| Agent panel (drawer) + its click flows | `panel.md` | `PANEL-` |
| Focus view + Documents | `focus-docs.md` | `FOCUS-`, `DOCS-` |
| Home: start a run, Needs you, Running now | `home-run.md` | `HOME-` |
| Home: teams, ⌘K, account, first time | `home-teams.md` | `TEAMS-` |
| Engines | `engines.md` | `ENG-` |
| Toolkit: Tools + Secrets | `toolkit-tools.md` | `TOOL-`, `SECRET-` |
| Toolkit: Skills + Memory | `toolkit-skills-memory.md` | `SKILL-`, `MEM-` |

## 1. Goal

Rebuild the product's screens to match the redesign exactly — on the website and in Tvashtr Desktop —
and first build every backend capability the screens assume but the product does not have yet.

Order of work (operator's rule): **analyse → plan → build the missing features → build the frontend.**

## 2. Principles

1. **Pixel parity, measured.** The previous revamp looked right in the design file but shipped with
   larger fonts and buttons. This time every rebuilt screen is checked against the design at the
   artboard size (1440×900, and 1024×768 where designed) by a measuring harness (§9) that matches
   every text and control by its label and compares font size, weight, family, and control
   height/width. Exact pixel values from the design win over "nearest token".
2. **One frontend, two surfaces.** The same React build runs on the website and inside Desktop. The
   differences are data-driven (`document.documentElement.dataset.tvashtrDesktop`,
   `window.tvashtrDesktop`, `window.tvashtrDesktopInfo.platform`), never a fork of a screen.
3. **Honest copy.** Where the design says something the backend can't do (e.g. "above your
   instructions", "runs on this computer" on the website), we fix the copy or build the capability —
   never ship a false sentence. Each case is decided below.
4. **Backend first.** No screen is built on a capability that doesn't exist. Screens that need new
   data wait for their backend slice.
5. **Additive APIs.** Existing response keys stay; new keys are added. Existing DBOS step return
   shapes never change (in-flight workflows replay recorded outputs).

## 3. Foundations (shared by every area)

### 3.1 Design-system components — DONE in Phase 0

`frontend/src/design-system/components/` is a React port of the design system bundle
(`DesignSystem_dbaa69`: Button, IconButton, Logo, Avatar, Badge, Card, Checkbox, Field/Input/TextArea,
Select, Switch, Tabs) with identical geometry, plus the shared overlays every page uses: `Menu` (⋯,
240px), `Popover` (anchored pickers), `ConfirmDialog` (the "see the impact" alertdialog, 500px),
`Dialog`, `Sheet` (right side, 520/540px), `ToastProvider`/`useToast` (dark, bottom-centre, optional
Undo). Classes carry a `ds-` prefix because older screens already own `.tv-btn`, `.tv-field`,
`.tv-card`, `.tv-avatar`, `.tv-switch` with different geometry; old screens keep working until they
are rebuilt, then their `tv-*` rules are deleted.

### 3.2 Navigation with addresses

Today all navigation is React state in `AuthGate`/`Dashboard` — no page has an address, so flows like
"Open Reviewer" (land on a team's canvas with one agent's drawer open on its Skills & tools tab) and
the Desktop deep link can't be expressed. We add a small hash router (`frontend/src/lib/nav.ts`,
`useNav()`), hash-based so it works identically on fly.dev, the Desktop loopback server and Vite
without server changes:

| Address | Screen |
|---|---|
| `#/home` | Home |
| `#/domains`… | Domains (unchanged pages) |
| `#/engines`, `#/engines/subscriptions`, `#/engines/keys` | Engines |
| `#/toolkit/tools`, `#/toolkit/tools/browse`, `#/toolkit/tools/<id>` | Toolkit › Tools |
| `#/toolkit/skills`, `#/toolkit/skills/presets`, `#/toolkit/skills/new`, `#/toolkit/skills/<id>` | Toolkit › Skills |
| `#/toolkit/memory/inbox`, `…/active`, `…/archive` | Toolkit › Memory |
| `#/toolkit/secrets` | Toolkit › Secrets |
| `#/teams/<teamId>?node=<id>&tab=<setup\|skills\|memory\|runs\|docs>&focus=1` | Team canvas + agent drawer / focus view |
| `#/teams/<teamId>/runs/<runId>` | A run on the canvas |
| `#/teams/<teamId>/docs/<documentId>?v=<n>&compare=<m>` | Document viewer |

Back/forward work; refresh keeps the place. The Desktop `tvashtr://` deep link (§6) maps onto these.

### 3.3 Shell

The dashboard shell is rebuilt to the design: 60px top bar (logo, ⌘K search button 420×36, backend
status "Connected", avatar), 224px left nav with count/warn badges, nested groups (Engines ›
Overview / Subscriptions / API keys; Toolkit › Tools / Skills / Memory / Secrets), and a shortcuts
card. Badge data comes from one `useWorkspaceStatus()` provider (Home = Needs-you count; Engines =
"N to fix"; Toolkit = counts + "N missing"), refreshed after every mutation that can change them.

On Desktop for macOS the window hides the system title bar and the app draws the design's 30px ink
title strip (traffic lights inside) — DONE in Phase 0 (`desktop/electron/windowOptions.cjs`,
`components/DesktopTitleBar.tsx`). The first paint is paper cream instead of the old dark splash.

### 3.4 Backend layout

New endpoints go in new router modules under `backend/tvashtr/routes/` (one per area:
`engines.py`, `toolkit.py`, `home.py`, `teams_extra.py`, `nodes.py`, `documents.py`, `memory_extra.py`,
`account.py`), each an `APIRouter` included in `main.py` behind `get_current_user`. Logic goes in
`control_plane/` modules. Existing endpoints in `routers.py` are changed in place only where the fix
is to that endpoint (create-only POSTs, validation, extra fields). This keeps parallel slices from
colliding in the 3,650-line `routers.py`.

### 3.5 One schema migration

All schema changes for the revamp land first, in one migration `0041_revamp_schema` (listed in the
plan, Phase 1a), so parallel backend slices never create competing Alembic heads. The migration hook's
freeze regex is bumped to cover `0032`–`0040` as the last step, per CLI-RULES §3.

### 3.6 Security fix found during analysis

`GET /api/documents`, `GET /api/documents/{id}` and `POST /api/documents/{id}/versions` have **no
owner check** — any signed-in user can list, read and append versions to any document. Fixed in the
Documents slice (404 for non-owners; the list becomes owner-scoped).

## 4. Area decisions

Open questions are answered here; the numbers refer to each analysis file's §6.

### 4.1 Engines (`engines.md`)
- New `GET /api/engines/usage` (which teams/agents/domains use each provider) drives Overview, "Can
  your teams run?", the suggested-keys banner, "See where it's used", and every impact dialog.
- `/api/config` gains `provider_directory` (labels, monograms, example models, subscription and
  embeddings flags; anthropic, xai, huggingface included) and `embedding_presets`.
- `GET /api/engines/subscriptions` gains `runner: {fresh, last_seen_at}`; subscription `state` is
  validated against the known vocabulary.
- `POST /api/providers` returns `created_at/updated_at/replaced`, validates "Other" prefixes
  (`[a-z0-9][a-z0-9_.-]{0,63}`); list returns `updated_at`.
- OQ-1 "N to fix" = (team × surface) pairs not ready. OQ-2 web "Connect" → "Open in Desktop" (deep
  link). OQ-3 web Desktop verdict uses mirror `connected` with "(on Desktop)". OQ-4 Save stays enabled
  and validates on click. OQ-5 picking a saved provider replaces with a hint. OQ-7 the embeddings
  section is data-driven from the user's domains. OQ-8 Codex installed = Ready. OQ-9 Disconnect
  survives relaunch. OQ-10 "Grok subscription · via Grok CLI". OQ-11 "Not checked yet" badge. OQ-12
  multi-team strings "+N more". OQ-13 fallback models listed as "(fallback)", excluded from verdicts.
  OQ-14 danger confirm for Remove. OQ-15 web shows "open on your computer" when the runner is fresh.
  OQ-18 non-Mac Download shows "Mac only for now". OQ-19 embeddings subtitle fixed. OQ-20 "plan"
  wording. OQ-21 in-flight run warning in the Remove dialog.

### 4.2 Toolkit › Tools and Secrets (`toolkit-tools.md`)
- Tool usage (`used_by`), `GET /api/tool-library/{id}` with `used_by_agents`, `GET /api/agents`,
  `PUT /api/tool-library/{id}/agents` (turn on/off for chosen agents across teams), duplicate, bulk
  import, create-only POSTs with name rules, delete strips references, rename carries each agent's
  on/off switch. `GET /api/toolkit/summary` feeds the nav badges. `GET /api/github/status` replaces
  listing every repo for a badge.
- Secrets: create-only `POST` with the `^[A-Z_][A-Z0-9_]*$` rule, `PUT /api/secrets/{name}` to replace,
  list returns `updated_at`, `used_by_tools` and a separate `missing[]`.
- Q1 create-only everywhere; clashes surface as "Replaces your <name>" (unchecked). Q2 a deleted but
  still-referenced secret reappears as a "No value" row. Q3 "Needs 2 secrets". Q4 unchecking an agent
  removes the reference. Q5 library tools only. Q6 Name field on the detail page. Q8 the catalog's
  GitHub entry becomes the remote GitHub MCP. Q9 install URL per LaunchPanel; the callback tolerates a
  missing `code`. Q10 Desktop note: tools don't reach Desktop subscription agents (plus a run
  warning). Q11 `${` autocomplete only in headers/env. Q13 paste flags literal secrets and offers
  "Move to Secrets". Q16 state-based sub-views are replaced by the §3.2 addresses.
- Desktop: the GitHub App install round trip returns to Toolkit › Tools › Browse via a remembered
  return address (no new bridge needed).

### 4.3 Toolkit › Skills and Memory (`toolkit-skills-memory.md`)
- Skill usage, `GET /api/skill-library/{id}`, `GET/PUT /api/skill-library/{id}/agents`, duplicate,
  create-only with name rules, delete strips references, repo sources get `mode/triggers/resolved_sha`
  and comma filters, `POST /api/skill-library/scan` + `/import` for "Add from GitHub" (private repos
  via the App installation token).
- Memory: `repo_key` is the GitHub `owner/name` (bug fix + data fix — today each hosted run gets a
  unique clone-path key so repo memories never carry over); provenance (`agent`, `source` with run
  title/status/round) and `edited_at`; `requeue` (Undo Keep / Undo Discard); scope change; `GET
  /api/memory/repos`; pinned facts survive an embedding failure.
- Q1 both repo models (bundle row + one row per imported skill). Q2 pin `resolved_sha`. Q3 409 name
  clashes. Q4 per-agent mode override on `{type:"library", id, mode?, triggers?}`. Q7 Save doesn't
  Keep. Q9 repo filter includes account-scoped. Q12 fix retrieval; learning without an OpenAI key uses
  the operator key for distillation (as manual memories already do). Q14 "<Role> · <Team>" everywhere.
  Q16 trigger mode needs ≥1 word.
- Desktop subscription agents get skills folded into their instruction (v1), because the Desktop job
  carries only the instruction today.

### 4.4 Focus view and Documents (`focus-docs.md`)
- `GET /api/node-templates` (the four agent templates, moved out of `routers.py`),
  `POST /api/teams/{team}/nodes/{node}/context-preview` (what the agent sees, no LLM calls),
  `GET /api/teams/{team}/nodes/{node}/runs` (rounds across runs: given/produced/cost/billing route),
  `cloned_from_node_id` + `invocation_id` on the run graph, run documents with latest version, writer,
  readers and shared-spec flag, version author + note, stale-version 409 on live edits, run-finished
  409, owner checks (§3.6), `documents.updated_at` actually updates, versions read are recorded in the
  manifest via new DBOS steps.
- Node PATCH: `display_name`, `description`, `reads_from: null` = default vs `[]` = none, empty prompt
  rejected, a validity warning for `writes_to` on a verdict-emitting agent.
- OQ-1 copy says "Added at run time, after your instructions". OQ-3 website model line says "Uses your
  xAI API key". OQ-4 "N unsaved changes" opens Review changes. OQ-5 templates replace instructions only.
  OQ-7/8 Edit only the shared spec, only while the run is live. OQ-9 409 on stale base. OQ-12 readers
  include the entry agent. OQ-14 Writes disabled on verdict agents. OQ-20 Documents drawer and node
  drawer are mutually exclusive. OQ-22 deterministic version notes.
- `useModalDialog` gets a dialog stack so nested dialogs don't both close on Escape.

### 4.5 Home — teams, ⌘K, account, first time (`home-teams.md`)
- Team summary gains `run_count`, active/awaiting counts, `last_active_at`, `last_run.{idea,
  updated_at, pr_url}`, `template_key/name`, `duplicated_from`, `shape` (pipeline strip). Honest
  spend (failed/cancelled/in-flight runs counted). `POST /api/teams/{id}/duplicate`.
  `GET /api/runs` gains team, PR, status groups, `q`, paging (`runs.library_team_id` + backfill).
  `GET /api/spend`. `GET/PATCH /api/account/preferences` (hide the get-started checklist). `UserOut`
  gains `github_login`. Stop auto-seeding "My team". Delete also removes Desktop job rows.
- Health polling drops from 5s to 30s while visible, plus offline-on-failed-fetch.

### 4.6 Home — start a run, Needs you, Running now (`home-run.md`)
- Launching moves to Home's "Start a run" composer (team, idea, repo on the website / folder on
  Desktop, Options: base branch, scope, budget). The canvas's "Run this team" jumps to the composer
  with the team picked (Q18) — one launch surface.
- `GET /api/inbox` (approvals, failed runs with a readable reason, per-team setup gaps, memories to
  review) + `POST/DELETE /api/inbox/dismissals` (dismiss, snooze, undo; approvals can only be
  snoozed). Structured run failure (`failure_code/message/failed_node_id`, humanised; fallback for old
  rows). `retry_of_run_id` links a retry and hides the failed item.
- `GET /api/runs` (shared with 4.5) also returns target, `spent_usd` (live), `budget_cap_usd`,
  `awaiting`, `failure` and per-node `progress` (`include=progress`) for Running now.
- Hosted GitHub runs honour the chosen base branch and scope: `GET /api/github/repos/{o}/{r}/branches`
  and `/subpaths`; `create_run` stops overwriting `base_ref` and dropping `subpath`.
- `default_run_budget_usd` in `/api/config`; `budget_cap_usd` validated (> 0, ≤ operator max).
- **Local-folder runs from Desktop (P10) are built**, because the design shows them and today they
  can't work against the hosted server: Desktop makes a `git bundle` of the chosen base branch and
  uploads it (`POST /api/desktop/repo-snapshots`); the run clones from it; Ship produces a result
  bundle of `tvashtr/<run_id>` (`GET /api/runs/{id}/ship-bundle`) which Desktop fetches into the
  user's folder as a new branch — the working tree is never touched. Bridge: `repos.pickFolder`,
  `inspect`, `recent.*`, `prepareRun`, `bringBackBranch`.
- `GET /api/costs` becomes owner-scoped (it returns every account's rows today).
- Q2 budget copy: "The run pauses and asks you before spending more." Q3 browser time zone, weeks
  start Monday. Q4 panel = this month, card = all time. Q6 a run that ends while Home is open stays as
  a muted card for 60s. Q8 setup gaps only for teams active in 30 days, the rest folded. Q9 add a
  "can't run on this computer" gap on Desktop. Q10 retry uses the current team + old target. Q12
  "Start again" prefills and appends the reject note. Q13/14 first-time mode when the account has no
  runs and the checklist isn't hidden. Q16 Desktop popover has "Recent folders" and "GitHub App repos".
  Q17 stack Recent runs/Spend under Teams below 1200px. Q21 folder runs show "Branch tvashtr/…".
  Q24 "Remind me tomorrow" = 09:00 local next day.

### 4.7 Agent panel (`panel.md`)
- Agent name and tagline live in `config.title` / `config.description` (settable on every node kind;
  `role_name` stays stable because memory and trajectories key on it). Rename is inline in the drawer
  header and goes through the same Save.
- The node PATCH applies `prompt`/`model` only when sent (so the Remember switch can save alone),
  rejects an empty prompt, refuses edits on the entry agent (409), and takes `reads_default`
  (`false` = reads nothing; resolves both analysts' "Remove spec" gap).
- Validity gains `no_model` (error), `no_instructions` and `writes_on_emitting_node` (warnings). New
  blank agents may start with an empty model ("Needs a model").
- The provider catalogue gains `anthropic` and `xai`, display labels, model labels and a
  `subscription` flag (built in the Engines slice; the panel's model picker consumes it).
- Executor honesty: Images (`multimodal`) is threaded into runs; the output-format schema is checked
  for every agent kind; Desktop subscription agents get their skills folded into the instruction and a
  run warning when they have tools (the drawer says so: "tools aren't used there yet").
- One history endpoint serves both the drawer's Runs/Docs tabs and the focus view's rounds rail:
  `GET /api/teams/{team}/nodes/{node}/runs?run_id=`. One preview endpoint:
  `POST /api/teams/{team}/nodes/{node}/context-preview`.
- Library and repo skill references on a node accept a per-agent `mode`/`triggers` override.
- Desktop: an unsaved-changes guard on window close / quit (`will-prevent-unload` +
  `app.setUnsavedChanges`).
- Q1 tab count = skills + tool servers. Q2 five tabs. Q3 Writes disabled on verdict agents with the
  hint "Its verdict goes to Runs." Q5 entry agent: Reads = "The idea you type when you press Run",
  Writes = "spec (default)". Q6 the edit-access confirm only for verdict agents. Q7 templates set
  instructions + default File access. Q9 "Needs a model" when blank or uncovered. Q11 Undo "Kept" uses
  the memory `requeue` endpoint. Q13 Edit for custom skills only; library/preset → "Open in Toolkit".
  Q14 add Headers/Env rows to the add-server form. Q15 Web fetch is added inline. Q18 rename inline.
  Q20 the run view reuses the new drawer shell with Runs as the default tab. Q22 singular copy.

## 5. Out of scope (stated, not silently dropped)

- MCP tools for Desktop subscription (Claude/Grok CLI) agents: they get none today. v1 states this in
  the UI and records a run warning; running tools locally is its own feature.
- LLM-written change notes for document versions (deterministic notes instead).
- Account-saved agent templates (four built-in templates in v1).
- "Add skills from a folder" on Desktop.

## 6. Desktop bridge additions

- `tvashtr://` protocol + single-instance handling; `navigation.onNavigate` / `consumePending`.
- `engines.cancelConnect(provider)`; sticky user disconnect; `refresh` records an Error state instead
  of rejecting.
- `dialog.pickFolder()` for "pick a folder" in the Start-a-run composer (home-run).
- `tvashtrDesktopInfo` v4 with `platform` — DONE in Phase 0.

## 7. Verification

Every slice lands with tests (pytest for backend, vitest for frontend, `node --test` for Desktop).
Every rebuilt screen passes the parity gate (§9) on both surfaces. The existing suites never lose a
passing test.

## 9. The parity gate

`design-parity` harness (kept in `frontend/scripts/design-parity/`):
1. Render the design artboard at its native size with the real fonts (the design runtime + DS bundle).
2. Render the app screen at the same viewport with fixture API data that mirrors the design's sample
   data, once in website mode and once in Desktop mode.
3. Measure every visible text and control (font size, weight, family, box size, position) and match
   them by label. The gate: **no size or type drift** on matched items; layout moves > 12px and design
   items missing from the app are listed for review.
