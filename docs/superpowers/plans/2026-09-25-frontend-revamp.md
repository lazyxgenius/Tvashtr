# Frontend revamp — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Each slice
> below is one subagent in its own git worktree, branched from the Phase 1a commit. Steps use
> checkbox (`- [ ]`) syntax. Read the spec
> ([`../specs/2026-09-25-frontend-revamp-design.md`](../specs/2026-09-25-frontend-revamp-design.md))
> and your area's analysis file in `../specs/2026-09-25-revamp-analysis/` before starting.

**Goal:** match the redesign on the website and Tvashtr Desktop, building every missing backend
capability first.

**Architecture:** React 19 + Vite frontend (one build, two surfaces) on a FastAPI + DBOS + Postgres
backend, with an Electron shell for Desktop. New endpoints live in new router modules under
`backend/tvashtr/routes/`; new logic in `backend/tvashtr/control_plane/`; new frontend API clients in
`frontend/src/lib/api/<area>.ts` (re-exported from `lib/api.ts`), pages in
`frontend/src/pages/<area>/`.

**Tech stack:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, DBOS, pytest · React 19, TypeScript,
vitest + Testing Library, Playwright · Electron 35, `node --test`.

## Global constraints (every slice)

- Work only in your worktree; commit on your slice branch with conventional commits
  (`feat(backend): …`, `feat(frontend): …`, `feat(desktop): …`, `test: …`). Never push, never merge,
  never `git config`.
- **Never add an Alembic migration.** All schema for the revamp is in `0041_revamp_schema`
  (Phase 1a). If you truly need another column, stop and report it.
- Never edit migrations `0001`–`0040`. Never change the `EngineAdapter` interface,
  `build_two_node_team`, or the return shape of an existing DBOS step (add a new step instead).
  `team_run.py` stays OpenHands-free at import (CLI-RULES §3).
- APIs are additive: existing response keys stay; add new ones.
- Owner scoping on every new read and write (404 for another account's object).
- Tests: every new endpoint/behaviour gets pytest coverage (real Postgres on `localhost:5433`, the
  shared `client` fixture or a fresh registered client as in `tests/test_engines_subscriptions_api.py`).
  Run your new tests plus the existing test files for the modules you touched — not the whole suite
  (several slices share one database; the lead runs the full suite after merging).
  Commands: `cd backend && uv run --extra dev pytest tests/<file> -q -p no:cacheprovider`,
  `cd backend && uv run --extra dev ruff check tvashtr tests && uv run --extra dev ruff format --check tvashtr tests`.
- Frontend: `cd frontend && npx vitest run <paths>`, `npx tsc --noEmit`, `npx eslint <paths> --max-warnings 0`,
  `npx prettier --check <paths>`.
- Copy: use the design's exact strings (quoted in the analysis files). Where the spec decided an
  open question, follow the spec.
- Final report: files changed and why, every command run with its result, deviations, anything left
  undone.

---

## Phase 0 — Foundations (lead; ✅ = done)

- [x] **0.1 Design-system components** — `frontend/src/design-system/components/` (primitives,
      overlays, utils, `ds.css`, 12 tests). Imported from `index.css`.
- [x] **0.2 Desktop title bar** — `desktop/electron/windowOptions.cjs` (+ `window-options.test.cjs`),
      preload `tvashtrDesktopInfo` v4 with `platform`, `components/DesktopTitleBar.tsx` (+ test).
- [x] **0.3 Design-parity harness** in `frontend/scripts/design-parity/`: `shoot-design.mjs`,
      `shoot-app.mjs`, `measure.js`, `fonts-route.mjs`, `parity.py`, `compare.py`, README. Reads the
      design export from `$DESIGN_DIR`. Fixture scenarios per area in `scenarios/`.
- [x] **0.4 Dialog stack** — `useModalDialog` handles Escape/Tab only for the top-most open dialog
      (module-level stack). Test: two nested dialogs, Escape closes only the top one.
- [x] **0.5 Commit** Phase 0 + the spec, analyses and this plan.

## Phase 1a — Schema (lead)

✅ Done. `backend/alembic/versions/0041_revamp_schema.py` (revises `0040_desktop_job_machine`), the
matching `models.py` columns + `InboxDismissal` / `RepoSnapshot`, `tests/test_revamp_schema.py`, the
migration hook now freezes `0001`–`0040`, and an empty router module per area under
`backend/tvashtr/routes/` is already registered in `main.py` (so slices only edit their own module).
Each slice gets its own migrated database (`tvashtr_<slice>`) via `DATABASE_URL`, because DBOS in one
test process would otherwise recover another process's in-flight workflows.

| Table | Change | Used by |
|---|---|---|
| `team_graphs` | `template_key TEXT NULL`, `duplicated_from_id UUID NULL` | B-TEAMS |
| `runs` | `library_team_id UUID NULL` FK `team_graphs` ON DELETE SET NULL + index + backfill from the clone→origin join | B-RUNS, B-TEAMS |
| `runs` | `retry_of_run_id UUID NULL` FK `runs` ON DELETE SET NULL | B-RUNS |
| `runs` | `failure_code TEXT NULL`, `failure_message TEXT NULL`, `failed_node_id UUID NULL` | B-RUNS |
| `runs` | `local_repo_label TEXT NULL`, `local_snapshot_id UUID NULL` | B-LOCAL |
| `users` | `preferences JSONB NOT NULL DEFAULT '{}'` | B-TEAMS |
| `inbox_dismissals` (new) | `id BIGSERIAL PK, owner_id UUID FK users NOT NULL, item_key TEXT NOT NULL, action TEXT CHECK IN ('dismissed','snoozed'), snooze_until TIMESTAMPTZ NULL, fingerprint TEXT NULL, created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(owner_id,item_key)` | B-RUNS |
| `document_versions` | `note TEXT NULL`, `author_node_id UUID NULL` | B-DOCS |
| `node_memories` | `source_node_id UUID NULL`, `edited_at TIMESTAMPTZ NULL`; data fix: `repo_key` clone paths → `runs.github_repo` | B-MEMORY |
| `repo_snapshots` (new) | `id UUID PK, owner_id UUID FK users NOT NULL, kind TEXT CHECK IN ('source','result'), run_id UUID NULL FK runs ON DELETE CASCADE, label TEXT NULL, base_ref TEXT NULL, size_bytes BIGINT NOT NULL, data BYTEA NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), consumed_at TIMESTAMPTZ NULL` + index `(owner_id, created_at)` | B-LOCAL |
| `cost_records` | index on `created_at` | B-RUNS (spend) |

Tests: `tests/test_revamp_schema.py` — upgrade applies (the suite already runs at head), the backfill
maps a run to its library team, the memory data fix rewrites a clone-path key, the CHECK constraints
hold. Commit, then branch every Phase 1b slice from this commit.

## Phase 1b — Backend slices (parallel subagents, one worktree each)

The API contract below is the source of truth for the frontend slices. Shapes not spelled out here
are in the named analysis proposal. Put new routes in `backend/tvashtr/routes/<file>.py` (an
`APIRouter` included in `main.py` with `dependencies=[Depends(get_current_user)]`).

### B-ENGINES — `routes/engines.py`, `control_plane/engine_usage.py`, `control_plane/provider_directory.py` (analysis: `engines.md` §3)
- [ ] `GET /api/engines/usage` → `{teams:[{team_id,name,nodes:[{node_id,role_name,title,kind,model,provider,fallback_model,fallback_provider}]}], domains:[{domain_id,name,embedding_model,embedding_provider,generation_model,generation_provider}], by_provider:{<p>:{teams:[{team_id,name,roles,node_ids}],domains:[{domain_id,name,use}]}}}`.
- [ ] `/api/config` gains `provider_directory[]` (`provider, monogram, label, example_model, subscription, embeddings, hint`), `embedding_presets[]`, `default_run_budget_usd`. `provider_catalogue` gains `anthropic` and `xai` entries plus per-entry `label`, `model_labels`, `subscription`, `byok_probed` (serves the panel's model picker too).
- [ ] `GET /api/engines/subscriptions` gains `runner:{fresh,last_seen_at,providers}`; `PUT` validates `state` ∈ {disconnected, needs_install, needs_login, api_key, connected, error}.
- [ ] Providers: list items gain `updated_at`; `POST` returns `{provider,key_last4,created_at,updated_at,replaced}` and 422s an invalid slug (`[a-z0-9][a-z0-9_.-]{0,63}` after canonicalising) with "Use just the model prefix — the part before the slash, like mistral."
- [ ] Tests: usage owner-scoping and provider mapping (incl. fallback, domains), directory covers every catalogue + embedding provider, runner freshness, state validation, slug validation, replaced flag.

### B-TOOLKIT — `routes/toolkit.py`, `control_plane/toolkit.py`, `control_plane/tool_usage.py`, `control_plane/skill_repo.py`, edits in `node_library.py`, `node_skills.py`, `mcp_secrets.py`, `routers.py` (tool/skill/secret endpoints), `tool_skill_catalog.py`, `auth.py` (analyses: `toolkit-tools.md` §3, `toolkit-skills-memory.md` §3 SKILL rows)
- [ ] `GET /api/toolkit/summary` → `{tools, tools_needing_attention, skills, memory:{inbox,active,archive}, secrets_missing}`.
- [ ] Tools: list items gain `updated_at, secret_refs, missing_secrets, status("ready"|"needs_attention"), used_by:{agent_count,team_count}`; `GET /api/tool-library/{id}` (+ `used_by_agents`); create-only `POST` (422 name rule `^[a-z0-9][a-z0-9_-]{0,63}$`, 409 "You already have a tool named <name>.", config must have exactly one of command/url) returning the full item; `PATCH` partial body, same rules, 409 instead of 500, rename carries each node's `tvashtr.servers[old]` switch, full item back; `DELETE` strips references from nodes → `200 {removed_from_agents}`; `POST /{id}/duplicate`; `POST /api/tool-library/import {servers, on_conflict}`; `PUT /{id}/agents {node_ids}`.
- [ ] `GET /api/agents?tool_id=|skill_id=` → `{teams:[{team_id,team_name,agents:[{node_id,role_name,title,kind,edits_allowed,enabled,overridden}]}]}`.
- [ ] `GET /api/github/status` → `{hosted,installed,installation_count,repo_count}`; `/api/auth/github/callback` tolerates a missing `code` (redirect back to the app).
- [ ] Secrets: `GET` → `{secrets:[{name,created_at,updated_at,used_by_tools}], missing:[{name,used_by_tools}]}`; create-only `POST` (422 `^[A-Z_][A-Z0-9_]{0,127}$` "Use capital letters, numbers and _, like NOTION_TOKEN.", 409 "<NAME> already exists. Use Replace value on it instead."); `PUT /api/secrets/{name} {value}`.
- [ ] Skills: list items gain `updated_at, usage:{agents,teams}`; `GET /{id}` (+ `used_by`); create-only `POST` (name `^[a-z0-9]+(-[a-z0-9]+)*$` ≤64, content non-empty, mode valid, trigger needs ≥1 word; `?on_conflict=replace` kept for presets); `PATCH` 409 on clash; `DELETE` strips references; `POST /{id}/duplicate`; `GET|PUT /{id}/agents`; `POST /api/skill-library/scan {url, ref?}`; `POST /api/skill-library/import {url,ref,sha,skills,mode,on_conflict}`; repo sources accept `mode/triggers/resolved_sha` and comma filters; node refs `{type:"library"|"repo", …, mode?, triggers?}` override the load mode (`node_skills`).
- [ ] Catalog/preset copy per the analyses; the GitHub catalog entry becomes the remote GitHub MCP.
- [ ] Tests for each bullet.

### B-MEMORY — `control_plane/memory*.py`, `routes/memory_extra.py` (analysis: `toolkit-skills-memory.md` MEM rows, `panel.md` PANEL-66/67, `focus-docs.md` FOCUS-55/57/58)
- [ ] `repo_key` = `run.github_repo or run.repo_path` at all write sites; `repo_label`.
- [ ] Memory dict gains `agent{node_id,role_name,title,team_id,team_name}`, `source{kind,run_id,run_title,run_status,run_succeeded,round,agent_role,team_name}`, `source_iteration`, `edited_at`, `superseded_by`; distill writes `source_invocation_id` + `source_node_id`.
- [ ] `POST /api/memories/{id}/requeue` (undo Keep / undo Discard, reversing supersede/merge); `PATCH` accepts `scope` (+ `repo_key`), sets `edited_at` on content/polarity/scope; node-only tier allowed ("Not repo-specific"); `GET /api/memory/repos`; `GET /api/memories/counts`.
- [ ] Retrieval keeps pinned facts when the embedding call fails; distillation falls back to the operator key when the owner has no OpenAI key (as manual memories do).
- [ ] Tests for each bullet.

### B-RUNS — `routes/home.py`, `control_plane/inbox.py`, `control_plane/run_views.py`, `control_plane/run_failure.py`, `control_plane/spend.py`, edits in `routers.py` (`create_run`, `_run_to_dict`, `/api/runs`, `/api/costs`), `team_run.py` (failure fields, cost on fail), `teams.py` (`cancel_run_core` cost), `github_app.py` (analysis: `home-run.md` P1–P9, P11; `home-teams.md` G-2, G-6, G-8, G-9)
- [ ] `GET /api/inbox` (P1) + `POST /api/inbox/dismissals`, `DELETE /api/inbox/dismissals/{key}` (P2).
- [ ] `GET /api/runs?status=&team_id=&q=&limit=&cursor=&include=progress` → `{runs, next_cursor}` with `team, target, pr_url, pr_number, ship_branch, spent_usd, budget_cap_usd, desktop_target, retry_of_run_id, awaiting, failure, status_group, updated_at, progress[]` (P3/G-6). `_run_to_dict` gains the same run-level fields.
- [ ] `GET /api/spend?tz=` (P4/G-8); `GET /api/costs` owner-scoped.
- [ ] Structured failure written at every fail site + humaniser + read-time fallback (P9); failed and cancelled runs get `cost_total_usd` (G-2); live cost for in-flight runs.
- [ ] `POST /api/runs`: `retry_of_run_id`, budget `> 0` and `≤ 500`, `library_team_id` set, GitHub `base_ref` honoured and `subpath` accepted (P6, P8, P11); `GET /api/github/repos/{owner}/{repo}/branches` and `/subpaths`.
- [ ] Tests for each bullet.

### B-TEAMS — `routes/account.py`, `control_plane/preferences.py`, edits in `teams.py` (summary, templates, duplicate, seeding, delete), `graph_validity.py` (`team_shape`), `auth.py` (`UserOut`) (analysis: `home-teams.md` G-1, G-3–G-5, G-7, G-10, G-12–G-14; `home-run.md` P5 readiness, P12, P13)
- [ ] Team summary: `run_count, active_run_count, awaiting_run_count, last_active_at, last_run.{idea,updated_at,pr_url}, template_key, template_name, duplicated_from, shape{nodes,loops}, readiness{website,desktop,subscriptions_connected}`, live spend.
- [ ] `POST /api/teams/{id}/duplicate`; `POST /api/teams` trims + 422 "A team name is required." + stores `template_key`; `GET /api/templates` gains `shape` + design copy; stop auto-seeding "My team"; team delete also removes Desktop job rows; `GET /api/teams/{id}/runs` rows gain `pr_url, updated_at, status_group`, live cost.
- [ ] `GET|PATCH /api/account/preferences` (`get_started_hidden`; 422 unknown keys); `UserOut` gains `github_login`, `display_name`.
- [ ] Tests for each bullet (update fixtures that relied on seeding).

### B-NODES — `routes/nodes.py`, `control_plane/node_templates.py`, `control_plane/context_preview.py`, `control_plane/node_history.py`, edits in `routers.py` (node PATCH/POST, graphs), `graph_validity.py`, `team_run.py` (multimodal, output_schema, reads_default, desktop skills fold + tools warning), `engines/desktop_runner_adapter.py` (analysis: `panel.md` §3, `focus-docs.md` FOCUS rows)
- [ ] Node PATCH (agent/completion): `title`, `description` → `config`; `prompt`/`model` applied only when sent; empty prompt 422; `edits_allowed=true` on the entry agent → 409 "The first agent writes the shared spec the team reads, so it stays read-only."; `reads_default: bool`. `POST …/nodes` accepts `title/description` and an empty model; presets seed title/description.
- [ ] Validity: `no_model` error, `no_instructions` warning, `writes_on_emitting_node` warning.
- [ ] `GET /api/node-templates` (the four templates moved out of `routers._NODE_PRESETS`, with title, description, prompt, node_kind, edits_allowed, verdict_labels).
- [ ] `POST /api/teams/{team}/nodes/{node}/context-preview` (draft overrides; parts with source + tokens; skills; total vs budget; notes; no LLM calls).
- [ ] `GET /api/teams/{team}/nodes/{node}/runs?run_id=&limit=` → `{runs:[{run_id,idea,status,created_at,live,rounds_count,last_outcome}], run:{…, rounds:[{invocation_id,iteration,status,outcome,outcome_detail,started_at,ended_at,cost,model_used,runs_on{via,provider},given{documents,memory,skills},produced}]}}`.
- [ ] Team graph: `name`; `last_run` gains `status`, `ended_at`. Run graph: nodes gain `origin_node_id`, invocations gain `invocation_id`.
- [ ] Executor: `reads_default=false` skips the default spec; output schema checked for every kind (verdict JSON for emitting nodes) with a run warning; `multimodal` threaded into `AgentTask`/LLM config when supported (warning otherwise); Desktop-routed nodes get skills folded into the instruction and a `tools` run warning when they have tools.
- [ ] Tests for each bullet (reuse the fake-adapter patterns in `tests/conftest.py`).

### B-DOCS — `routes/documents.py`, edits in `documents/service.py`, `routers.py` (document endpoints), `team_run.py` (new versioned read steps, version notes/authors) (analysis: `focus-docs.md` DOCS rows, `panel.md` PANEL-76–78)
- [ ] Owner checks on `GET /api/documents`, `GET /api/documents/{id}`, `POST …/versions` (404 for others; the list owner-scoped).
- [ ] `GET /api/runs/{id}/documents` items gain `is_shared_spec, version_count, latest_version{version_no,created_at,author}, written_by[], read_by[]`; response gains `run{run_id,idea,status,created_at,live}`.
- [ ] `GET /api/documents/{id}` gains `run_id, is_shared_spec, editable`; versions gain `author{kind,node_id,role_name,label}` and `note` (stored or derived from `idempotency_key`).
- [ ] `POST …/versions {content, base_version_no?, note?}` → 409 `{code:"stale_version", latest_version_no, latest_author}` / 409 `{code:"run_finished"}`; returns the full version. `documents.updated_at` bumps on every new version.
- [ ] Writers store deterministic notes ("First draft", "Revised in round {n}", "Round {n}", "Edited while the run was live") and `author_node_id`; new DBOS steps record which document versions each agent read, into its context manifest.
- [ ] Tests for each bullet.

### B-LOCAL — `routes/local_repo.py`, `control_plane/local_repo.py`, edits in `routers.py` (`create_run`), `team_run.py` (clone-from-bundle step, ship-to-bundle), `shipping.py` (analysis: `home-run.md` P10)
- [ ] `POST /api/desktop/repo-snapshots` (multipart `bundle` + `label` + `base_ref`; ≤200 MB; verified with `git bundle verify`) → `{snapshot_id, size_bytes}` stored in `repo_snapshots`.
- [ ] `POST /api/runs` accepts `local_repo:{snapshot_id,label,base_ref,subpath}` (only with `desktop_target:true`; exclusive with `github_repo`/`repo_path`), stores `local_repo_label/local_snapshot_id`.
- [ ] A new durable step clones the bundle into the run directory and sets `repo_path` (like `clone_github_repo_step`); Ship for such runs skips the PR and stores a result bundle of `tvashtr/<run_id>` (`kind='result'`); `GET /api/runs/{id}/ship-bundle` streams it (owner-only). Source snapshots are marked consumed and purged after clone.
- [ ] Tests: upload validation (size, not-a-bundle, owner), launch validation, clone step from a real `git bundle`, ship bundle round trip (`git fetch` from it gives the branch).

## Phase 2 — Desktop (one subagent, after B-LOCAL's API is fixed; can start in parallel with 1b)

`desktop/electron/` + `frontend/src/vite-env.d.ts` (analyses: `engines.md` §4, `home-run.md` §4,
`panel.md` §4)
- [ ] `tvashtr://` protocol (electron-builder `protocols`, `setAsDefaultProtocolClient`, `open-url`,
      single-instance lock + `second-instance`), allow-listed targets → `navigation.onNavigate(cb)` /
      `navigation.consumePending()`.
- [ ] `engines.cancelConnect(provider)`; user disconnect is sticky across relaunch; `refresh` records
      an Error status instead of rejecting.
- [ ] `repos.pickFolder()`, `repos.inspect(path)`, `repos.recent.{list,add,remove}`,
      `repos.prepareRun({path,baseRef,label})` (git bundle + upload via the local proxy with the session
      cookie), `repos.bringBackBranch({path,runId})` (download + `git fetch <bundle>
      tvashtr/<id>:tvashtr/<id>`, never checkout).
- [ ] `app.setUnsavedChanges({dirty, agentName})` + `will-prevent-unload` / `before-quit` prompt.
- [ ] `tvashtrDesktopInfo.version` 5; types in `vite-env.d.ts`.
- [ ] Tests (`node --test`): protocol target parser, recent-folders store, inspect on a temp repo,
      bundle create/fetch round trip on temp repos, sticky disconnect store, cancelConnect.

## Phase 3 — Frontend

### F0 — Shell and plumbing (lead, after Phase 1b is merged)
- [ ] `lib/nav.ts` hash router + `useNav()`; `AuthGate`/`Dashboard`/`App` read and write addresses
      (spec §3.2); Desktop deep links map onto them.
- [ ] `lib/api/<area>.ts` clients + types for every Phase 1b endpoint.
- [ ] `WorkspaceStatusProvider` (nav badges) + rebuilt `AppShell` (header, nav groups, badges,
      shortcuts card), `ToastProvider` mounted, `useHotkeys` (⌘K, N, T, ?), backend status polling
      (30s visible + offline on failed fetch).
- [ ] Parity gate on the shell (Home frame) in both modes.

### F1–F6 — Screen slices (parallel subagents after F0; each owns its folder under `src/pages/`)
Each slice: build the screens and flows in its analysis file, reuse `design-system/components`,
delete the old component it replaces (and its `tv-*` CSS) once nothing imports it, rewrite the old
tests, add tests per flow, and pass the parity gate for every artboard of its area in website mode
and in Desktop mode (Desktop artboards where drawn).

| Slice | Screens (artboards) | Replaces |
|---|---|---|
| F1 Home | `Home-*`, `HmF-*` | `Dashboard.tsx` home view, `LaunchPanel.tsx` (canvas Run jumps to the composer), `NewTeamDialog.tsx` |
| F2 Engines | `Eng-*`, `EnF-*` | `EnginesShelf.tsx` |
| F3 Toolkit Tools + Secrets | `Toolkit-Tools*`, `Toolkit-AddTool*`, `Toolkit-ToolDetail`, `Toolkit-Secrets`, `Toolkit-ReplaceSecret`, `TkF-Tool*`, `TkF-AddTool*`, `TkF-FixSecret*`, `TkF-Catalog*`, `TkF-Paste*`, `TkF-Detail*`, `TkF-*Secret*` | `ToolsShelf.tsx`, `SecretsShelf.tsx` |
| F4 Toolkit Skills + Memory | `Toolkit-Skill*`, `Toolkit-Memory*`, `Toolkit-AddMemory`, `TkF-Skill*`, `TkF-NewSkill*`, `TkF-Presets*`, `TkF-FromRepo*`, `TkF-Review*`, `TkF-Inbox*`, `TkF-Filters*`, `TkF-NoteActions*`, `TkF-Archive*`, `TkF-AddMemory*`, `TkF-MemoryEmpty*` | `SkillsShelf.tsx`, `MemoryShelf.tsx`, `MemoryFact.tsx` |
| F5 Agent panel + canvas chrome | `Main`, `Desktop-*`, `Web-*`, `Panel-*`, `Flow-*` | `TeamNodePanel.tsx`, `SkillsSection.tsx`, `ToolsSection.tsx`, `NodeMemorySection.tsx`, `DrawerShell.tsx`, the run-view `SidePanel.tsx` shell |
| F6 Focus view + Documents | `Focus-*`, `Docs-*` | `PrdView.tsx` (split), `SidePanel` documents |

F5 and F6 share `useAgentDraft`; F5 builds it first and F6 branches from F5's branch.

## Phase 4 — Integration and verification (lead)

- [ ] Merge order: 1a → B-ENGINES → B-TEAMS → B-RUNS → B-MEMORY → B-TOOLKIT → B-NODES → B-DOCS →
      B-LOCAL → Desktop → F0 → F1…F6. Full backend suite, frontend suite, lint, typecheck, build,
      Desktop tests after each merge.
- [ ] Parity sweep of every artboard, website and Desktop modes; fix all size/type drift.
- [ ] Update `HANDOVER.md` / `PROJECTPLAN.md` log entries; commit; push the branch.
