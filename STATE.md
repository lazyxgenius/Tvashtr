# Tvashtr — Autonomous Execution State

## Current Milestone
FE-infra — **a frontend quality gate to match the backend bar**: ESLint (type-checked) +
Prettier wired + enforced, the whole `frontend/` reformatted, a genuinely-protective RTL suite,
all folded into `make` targets — **and** `scripts/` folded into the ruff gate. Architect brief:
`prompts/fe-infra-eslint-prettier-rtl.md` (SUPERSEDES CLI-RULES §7 for this run). FE + Makefile +
scripts/ ONLY; NO backend change; NO migration (head stays 0011). Fully offline-verifiable. —
**DONE, all gates green, READY_TO_MERGE.**

## Last Completed Step
FE-infra (eslint type-checked + prettier + RTL + scripts→ruff) — 2026-06-24 — branch:
feat/fe-infra-eslint-prettier-rtl — sha 0a102cb — backend `make test` 177 (untouched), `make lint`
clean (backend+scripts ruff + FE eslint `--max-warnings 0` + prettier `--check`), frontend vitest
**85** (was 76: +9 RTL), `make build-frontend` clean (tsc strict + vite), alembic head 0011 (NO
migration), keystone RTL non-vacuity DEMONSTRATED (mutation RED → restore GREEN). READY_TO_MERGE.

## In Progress
None — FE-infra is implemented and all gates are green. Awaiting operator FF-merge of
feat/fe-infra-eslint-prettier-rtl. (The P1.7a/P1.7b branches also still await their FF-merges;
this branch was cut from `main`.) NEXT: **P1.8 — Supervisor-first onboarding** (PROJECTPLAN §16).

## FE-infra — eslint + prettier + RTL + scripts→ruff (2026-06-24) — shipped, all gates green

### Lint/format stack (as-built)
- `frontend/eslint.config.js` — flat config: `@eslint/js` recommended + typescript-eslint
  **recommendedTypeChecked** (`projectService` over `src/**` + `e2e/**`) + react-hooks
  (rules-of-hooks + exhaustive-deps = **error**) + react-refresh (only-export-components = warn)
  + `eslint-config-prettier` **last** + `linterOptions.reportUnusedDisableDirectives = error`.
  Root `*.config.{ts,js}` drop to the non-type-checked tier (`disableTypeChecked` + `tseslint.parser`
  + `no-undef: off` for the node-context configs). Installed: ESLint 10, typescript-eslint 8,
  eslint-plugin-react-hooks **7** (only the 2 brief-mandated rules enabled — NOT v7's new
  compiler-era rules) — react-refresh 0.5, eslint-config-prettier 10, prettier 3.
- `frontend/prettier.config.js` — Prettier-3 defaults + `printWidth: 100`; `.prettierignore`
  (dist, node_modules, package-lock.json, coverage, test-results, playwright-report).
- npm scripts: `lint` (`eslint . --max-warnings 0`), `lint:fix`, `format` (`prettier --write .`),
  `format:check`. `tsconfig.json` now `include: ["src","e2e"]` + a `@types/node` devDep, so the
  type-checked tier AND build-tsc both cover the Playwright spec. Separate runners (NO
  eslint-plugin-prettier): ESLint owns correctness, Prettier owns formatting.

### ESLint findings fixed (8 — all real, FIXED in code, never silenced)
The new type-checked tier surfaced 8 genuine async-safety / dead-code issues:
1–4. `@typescript-eslint/no-misused-promises` — wrapped async fns passed where a void return is
   expected in `() => void f()`: TeamCanvas `FitView`/`FocusNode` `setTimeout(rf.fitView)`,
   BackendDot's `setInterval(check)` health poll, PrdView's `onSave={handleSave}` prop.
5. `no-useless-assignment` (TeamCanvas) — dropped the dead `let className = ""` initializer
   (every branch assigns) → `let className: string;`.
6. `@typescript-eslint/no-unnecessary-type-assertion` (TeamCanvas onNodeClick) — `node.data` is
   already `AgentNodeData` (the nodes are `Node<AgentNodeData>`); removed `as unknown as AgentNodeData`.
7. `@typescript-eslint/no-base-to-string` (events.ts `asString`) — only stringifies primitives
   now (number/boolean/bigint); objects never occur in the persisted scalar payloads, so it stays
   total + never-throwing without Object's base toString.
8. `no-undef` (`process` in playwright.config.ts) — disabled core `no-undef` for the TS config
   tier (TS handles unknown identifiers; mirrors typescript-eslint's eslint-recommended).
All behavior-preserving. (1 self-introduced finding in the new test/setup code — `require-await`,
`await-thenable`, `no-base-to-string`, 2× `no-unnecessary-type-assertion` — was also fixed, not
silenced, before commit.)

### Disposition of EVERY pre-existing `eslint-disable` (there is exactly ONE)
- `frontend/src/canvas/TeamCanvas.tsx` — `react-hooks/exhaustive-deps` on the topology-rebuild
  effect. **KEPT, narrowed + reasoned.** It suppresses a LIVE finding: the effect deliberately
  deps only on `graph.run_id`, omitting run/workflowStatus/tasks so the per-poll graph refetch
  doesn't rebuild nodes and reset dragged positions (the very next effect refreshes their state in
  place). Single-rule, single-line, now carries a `-- reason:` description. With
  `reportUnusedDisableDirectives = error` it is proven still-live (ESLint clean ⇒ it suppresses a
  real finding). NO blanket / file-level / multi-rule disables anywhere; NONE removed-as-dead
  (only one disable existed in the whole frontend, and it is live).

### scripts/ into the ruff gate (ruff SAFE-autofix + format ONLY — NO logic edits)
`make lint` now runs `ruff check . ../scripts` + `ruff format --check . ../scripts`. The 5
pre-existing findings, fixed behavior-preservingly (control flow untouched on these live drivers):
- `smoke_agent.py` — removed unused `import sys` (F401, ruff safe-fix; verified `sys` not
  referenced anywhere in the file).
- `loop_run.py` — sorted the function-local sqlalchemy/fastapi/tvashtr imports (I001, ruff
  safe-fix) + ruff-format reflow (collapsed previously-narrower-wrapped lines to width 100).
- `check_skeleton_crash.py`, `seeding_smoke.py`, `skeleton_run.py` — three `E501` long lines, all
  resolved by **`ruff format` wrapping** the `print()` / comprehension across lines; the
  strings/expressions are **byte-identical** (no edit to message text or logic).
- `check_loop_crash.py`, `proxy_smoke.py` — ruff-format whitespace reflow only.
After: `ruff check ../scripts` = "All checks passed!", `ruff format --check ../scripts` = clean.

### Make wiring
`make lint` (backend+scripts ruff check+format-check, then FE `npm run lint` + `npm run
format:check`), `make fmt` (the autofix twin), NEW `make test-frontend` (vitest, no DB — kept
separate from `make test` which needs Postgres), NEW `make build-frontend` (tsc --noEmit + vite).
`.PHONY` updated; the stale `loop-feature-docker` `##` help fixed (Gemini → NIM
`nvidia_nim/meta/llama-3.3-70b-instruct`).

### RTL suite (vitest 76 → 85, +9; jsdom env + `src/test/setup.ts`)
`vite.config.ts` test block: `environment:"jsdom"`, `globals:true`, `setupFiles:["src/test/setup.ts"]`
(jest-dom matchers + the React Flow jsdom shims: ResizeObserver / DOMMatrixReadOnly / box metrics).
RTL via `user-event` where interaction is the subject:
- **KEYSTONE** `App.test.tsx` — real `<App/>` under `<StrictMode>`, stubbed control-plane fetch,
  fake-timer poll: proves (a) the polled graph/run reaches the canvas (banner "Shipped" + a "Done"
  node) and (b) polling **STOPS** at terminal (no further `GET /api/runs/{id}`). **Non-vacuity
  DEMONSTRATED**: reverting the App mount-effect `mountedRef.current = true` → keystone RED ("Unable
  to find … Shipped"); restored → GREEN; App.tsx byte-identical to HEAD.
- `App.test.tsx` A/B toggle — single-run ↔ A/B mounts the comparison surface and restores the
  single-run tree losslessly (state-only).
- `TeamCanvas.test.tsx` — derived node/gate/terminal status reaches the DOM; **exactly one** rework
  arc (`.rf-edge--rework`), the `rejected` edge stays its own category (guards the P1.5b "any
  conditional edge → rework" bug).
- `TasksDrawer.test.tsx` — empty inbox → renders null; High (Needs your approval) above Low (Heads
  up); Approve/Reject → `onResolve(id, decision)`, Dismiss → `onAcknowledge(id)`, gate body →
  `onFocusNode`.
- `SidePanel.test.tsx` — Reviewer per-round verdicts in iteration order; reasons under
  `changes_requested` only, never under `approved`.

### Acceptance evidence (all green — 2026-06-24)
- `make test` → **177 passed, 1 warning in 7.25s** (backend untouched).
- `make lint` → exit 0: backend+scripts ruff "All checks passed!" + "87 files already formatted";
  FE eslint `--max-warnings 0` (no findings); FE prettier "All matched files use Prettier code style!".
- `make test-frontend` → **85 passed** (8 files; was 76 → +9 RTL).
- `make build-frontend` → exit 0 (tsc --noEmit strict + vite build).
- Keystone non-vacuity: mutation → keystone **RED**, restore → keystone **GREEN** (App.tsx back to
  byte-identical with HEAD).
- `git diff main HEAD --stat` → 41 files, ALL under `frontend/**`, `Makefile`, `scripts/**`;
  `git diff main HEAD --name-only` over `backend/tvashtr/**` + `backend/alembic/**` is **EMPTY**.
  (`prompts/CLI-RULES.md` appears only in the working-tree `git diff main` — it is the operator's
  pre-existing UNCOMMITTED edit, never staged/committed by this step.)
- `alembic heads` → **0011_invocation_outcome_detail (head)** — NO migration.

### Deviations / decisions (two-way-door, logged)
- **Keystone start-click uses `fireEvent`, not `user-event`** — `user-event` deadlocks against
  vitest fake timers (probed + confirmed: it hangs to test-timeout), and the keystone must drive
  virtual time for the 1800ms poll. `user-event` IS used everywhere interaction is the subject
  (A/B toggle, TasksDrawer). The keystone's click is an incidental trigger.
- **`e2e/` folded into `tsconfig.json` `include` + `@types/node` devDep** — required so the
  type-checked tier (`projectService`) lints the Playwright spec at the no-floating-promises tier
  per the brief. Consequence: build-tsc also type-checks e2e (a hardening; build stays green).
- **Prettier CSS reflow lowercases hex** (`#FDFCFA`→`#fdfcfa`) in the tracked design-system tokens —
  render-identical (CSS hex is case-insensitive); part of the render-neutral reformat.
- **`frontend/src/design-system/` IS tracked frontend CSS** (NOT the operator's untracked root
  "Design System/" folder) → in Prettier scope, reformatted.
- Pre-existing, NOT changed by this step: `make help` displays "Makefile" as the target name
  because `include .env` adds a 2nd entry to `MAKEFILE_LIST` (grep prefixes the filename) — out of
  scope; the help recipe was left untouched. New targets carry `## ` help + are in `.PHONY`.

### READY_TO_MERGE
READY_TO_MERGE: branch=feat/fe-infra-eslint-prettier-rtl, sha=0a102cb, backend_tests=177,
frontend_tests=85 (was 76, +9 RTL). FE-infra: ESLint (type-checked) + Prettier + a protective RTL
suite + `scripts/` into the ruff gate. Gates: `make test` 177 passed; `make lint` clean
(backend+scripts ruff + FE eslint `--max-warnings 0` + prettier `--check`); `make test-frontend` 85
passed; `make build-frontend` clean (tsc strict + vite); keystone mutation RED → restore GREEN;
`git diff main HEAD` only under `frontend/**`, `Makefile`, `scripts/**` (nothing under
`backend/tvashtr/**` or `backend/alembic/**`); alembic head 0011 (NO migration). Fully
offline-verifiable — no operator visual smoke required. (Branch ref verified via `git rev-parse
--abbrev-ref HEAD` = `feat/fe-infra-eslint-prettier-rtl`; the /goal text's "fea-infra-…" was a typo.)

## P1.7b — live PRD steering editor (FRONTEND) — shipped + live-green (2026-06-24)
- **As-built (FE-only, additive):**
  - `frontend/src/lib/prdEditor.ts` — the ONE TipTap config (`PRD_EDITOR_EXTENSIONS`: StarterKit +
    tiptap-markdown, `bulletListMarker:"-"`, `html:false`, `link:false`) shared by the editor AND
    the round-trip test, so the test guards exactly what users type. `getMarkdown(editor)` +
    `roundTripMarkdown(md)` helpers. tiptap-markdown@0.9.0 ships no types → a local
    `declare module "@tiptap/core" { interface Storage { markdown … } }` augmentation (no `any`).
  - `frontend/src/lib/api.ts` — `addDocumentVersion(documentId, content)` (POST a new version,
    mirrors the existing fetch helpers); `AddedDocumentVersion` partial-response type.
  - `frontend/src/lib/status.ts` — `isPrdEditable(runStatus, workflowStatus)`: editable iff the run
    is present AND non-terminal, reusing `RUN_TERMINAL`/`WORKFLOW_TERMINAL` (one source of truth
    with the poll-stop). `awaiting_human` is deliberately editable (the gate is the moment to steer).
  - `frontend/src/panel/PrdView.tsx` — `editable` mode: the latest version in a TipTap editor with a
    **dirty-aware, explicit (no-autosave) Save** → `addDocumentVersion` → `getDocument` refetch →
    select the new latest → "Saved v{N} — the agents read it on their next round." A "live" tag marks
    the latest version; older versions / terminal runs stay the read-only plain-text render.
  - `frontend/src/panel/SidePanel.tsx` — derives `editable` from the run/workflow status it already
    holds (NO App.tsx change). Token-only additive CSS in `panel.css`.
- **Deps (React-19-compatible):** `@tiptap/react@3.27.1`, `@tiptap/starter-kit`, `@tiptap/pm`,
  `tiptap-markdown@0.9.0`; dev: `@playwright/test@1.61.1`, `jsdom@25` (round-trip test env).
- **Tests:** vitest 67 → **76**. New `prdEditor.test.ts` (jsdom): a representative PRD (`#` heading
  + `-` bullets + a fenced ```text block carrying the deliverable line) is **byte-stable** through a
  no-op load→save, the fence + exact line survive verbatim (non-vacuous), and it's a fixed point.
  New `isPrdEditable` block in `status.test.ts` (in-flight→true, every terminal/null→false).
  `vite.config.ts` scopes vitest to `src/` so the Playwright `e2e/*.spec.ts` isn't run as a unit test.
- **`make steering-e2e` PROOF (live J3, real NIM agent, real PRD gate):** run_id=113568cf-…;
  paused at the PRD gate → the TipTap editor rendered the PM PRD → typed a SENTINEL PRD → Saved (a
  new `human` version) → approved the PRD gate AND the review-escalation gate → run completed,
  ship_tag=ship-113568cf-…; 3 EngineerRunAttempt rows (the real Reviewer cycled, then ship-as-is on
  escalation). **Shipped `greeting.txt` = `Steered by a human mid-run via Tvashtr 1782304575897`
  (the SENTINEL), NOT DEFAULT_IDEA's `Shipped by the Tvashtr PM->Engineer team`.** "1 passed (7.1m)".
- **Two root-causes found + fixed while debugging the E2E to green (neither a P1.7b code bug):**
  1. **Empty editor → the PM produced a 0-length PRD.** The PM/gateway model was `DEFAULT_MODEL=
     openrouter/openai/gpt-oss-20b:free` — a **reasoning** model that intermittently spends its
     entire `max_tokens=400` budget on hidden reasoning and returns empty `content` (the gateway
     returns empty as success, no error/fallback). The editor was correctly rendering empty content.
     **Remediation (config-only, gitignored `.env`, mirrors the P1.7a agent-model swap; NO code):**
     `DEFAULT_MODEL=openai/gpt-4o-mini` (non-reasoning, reliable, `OPENAI_API_KEY` present, gateway
     routes it via litellm's env convention). Probed: gpt-oss-20b empties intermittently on the PM
     prompt; gpt-4o-mini returns a clean PRD every time.
  2. **UI "Approve" never resolved the gate (E2E only).** `getByRole("button",{name:"Approve"})`
     matched TWO buttons — the action button AND the blocker CARD (itself a `<button>` whose
     accessible name contains the description "…Approve to let the Engineer build…"); `.first()`
     clicked the card (which only frames the node), never resolving. Fixed in the spec with
     `{ name:"Approve", exact:true }`. (A pure test-harness fix; the product Approve button is fine.)
- **OPERATOR NOTE:** the working PM/completion model is now `DEFAULT_MODEL=openai/gpt-4o-mini` in
  `.env` (gitignored). `openrouter/openai/gpt-oss-20b:free` is left unused for the PM because, as a
  reasoning model with a 400-token cap, it intermittently returns empty content → an empty PRD. The
  agent model is unchanged (`TVASHTR_AGENT_MODEL=nvidia_nim/meta/llama-3.3-70b-instruct`).

## Live composition gate (P1.7a) — root-caused + GREEN (2026-06-24)
- **Symptom:** `make loop-run` / `make loop-crash` died with the Engineer's agent run `status=failed`
  (0 cost rows for the failed iteration). Decoded DBOS errors / the live run surfaced two distinct
  things, only ONE of which was the live blocker:
  1. A batch of stale boot-recovered `run_team` rows erroring `read_latest_prd_step: run <id> has no
     pm_document_id` — these are PENDING partial runs (killed before `pm_step` committed) that DBOS
     resurrected on boot; terminal ERROR now, harmless. NOT the live blocker. (No PENDING/ENQUEUED
     remained at diagnosis time — the §4.5 stale-parked-runs snag was already clear.)
  2. **The real blocker:** the Engineer's OpenHands agent run intermittently crashed with
     `ConversationRunError: Object of type TextContent is not JSON serializable`.
- **Root cause (NOT a P1.7a bug, NOT an auth/quota block):** the agent LLM was
  `nvidia_nim/qwen/qwen3-next-80b-a3b-instruct`. The NIM endpoint is HEALTHY (GET /v1/models → HTTP
  200, key valid, model present) but (a) brutally slow on chat completions (~13–26s for a 2-token
  reply; NVCF serverless cold-start) and (b) qwen3's response shape intermittently (~40% on real
  Engineer prompts) trips an OpenHands/litellm `TextContent` json-serialization flake. Proof it is
  NOT P1.7a and NOT generic: `make agent-smoke` — which touches ZERO P1.7a code — fails identically,
  and the agent path was historically GREEN with OpenRouter (P1.5a loop-run) and Gemini (capstone).
  The litellm `nvidia_nim` chat transform is trivial param-mapping, so the trigger is the qwen3 model
  itself, not the provider. (The constant `Cost calculation failed: This model isn't mapped yet …
  nvidia_nim` warning — cost=$0 — is the unmapped-price model, also harmless, and explains part of the
  "0 cost rows" signature; the missing rows on a FAILED iteration are because the agent errored before
  usage was read.)
- **Remediation (config-only, reversible, honors the operator's NIM provider; changes NO P1.7a
  behavior, NO loop assertion, NO harness):** switched `TVASHTR_AGENT_MODEL` in `.env` (gitignored)
  from `nvidia_nim/qwen/qwen3-next-80b-a3b-instruct` →
  **`nvidia_nim/meta/llama-3.3-70b-instruct`** — same NIM provider/key, a standard non-reasoning
  tool-use model (NIM latency ~1.4s/call) that litellm's nvidia_nim path supports cleanly. No code
  touched: `team_run.py` / `routers.py` / `documents/service.py` are byte-identical to 5c19828;
  `config.agent_llm_routing` already resolves `nvidia_nim/` → `NVIDIA_BUILD_API_KEY`.
- **OPERATOR NOTE:** the working agent model is now `nvidia_nim/meta/llama-3.3-70b-instruct` in `.env`.
  qwen3-next-80b is left UNUSED because it intermittently breaks the OpenHands agent run (above). If
  you want qwen3 specifically, it needs a different route (e.g. the OpenAI-compatible `openai/` provider
  + NIM base_url) or an SDK/litellm fix — not a key change. Groq/Cerebras/OpenAI keys are also present
  as faster alternatives if desired.
- **loop-run PROOF (ship once):** run_id=2f080e81-…; workflow=SUCCESS, run.status=completed,
  ship_tag=ship-2f080e81-…; Engineer invocations [1,2]; Reviewer [1,2] = [changes_requested, approved]
  (one loop-back); 2 EngineerRunAttempt rows; 2 per-iteration agent-cost CostRecords; one ship tag;
  committed greeting.txt contains the required line; pm_document_id=8047ef7a-… (the live re-source
  resolved). → "ALL LOOP-RAN ASSERTIONS PASSED". (1 re-roll: the prior qwen3 attempt failed at the
  Engineer agent run — the model swap fixed it.)
- **loop-crash PROOF (ship once, 0 re-rolls):** run_id=5912a671-…; DBOS recovered to SUCCESS;
  Reviewer [1,2,3] = [changes_requested, changes_requested, approved] (two loop-backs then ship);
  3 per-iteration agent-cost CostRecords; one pm-llm CostRecord; one ship tag + one ship commit;
  mid-loop re-execution: 4 EngineerRunAttempt rows span pid 31712 (pre-crash) → 32033 (restarted) —
  the in-flight iteration re-ran while completed iterations replayed (exactly-once-per-iteration),
  so the loop resumed mid-cycle and kept cycling to a single ship. → "ALL LOOP CRASH-RESUME
  ASSERTIONS PASSED / LOOP MID-CYCLE CRASH-RESUME PASSED". Passed on the FIRST attempt.
- **Re-green after the live gate:** `make test` → 177 passed (8.08s); `make lint` → clean (75 files);
  alembic head still `0011_invocation_outcome_detail` (NO migration); P1.7a code byte-identical to
  5c19828; git tree shows only the architect-owned PROJECTPLAN.md / HANDOVER.md modified (the `.env`
  model change is gitignored).

## Completed Steps (append-only, newest last)
- [x] FE-infra — frontend quality gate: ESLint flat config (type-checked tier, projectService
  over src+e2e) + react-hooks/react-refresh + eslint-config-prettier; Prettier-3 @ printWidth 100
  (whole-`frontend/` render-neutral reformat); 8 real eslint findings fixed in code (async-safety
  / dead-code), the lone pre-existing exhaustive-deps disable narrowed+reasoned; RTL suite +9
  (vitest 76→85) with the App StrictMode poll-lifecycle keystone (mutation-proven); `scripts/`
  folded into the ruff gate (safe-autofix + format, no logic edits); `make lint`/`fmt` extended +
  NEW `make test-frontend`/`build-frontend`; loop-feature-docker help Gemini→NIM. FE + Makefile +
  scripts/ ONLY, NO backend, NO migration (head 0011). — feat/fe-infra-eslint-prettier-rtl @
  0a102cb — 2026-06-24
- [x] P1.7a — live-document steering (backend seam): documents/service.py `get_latest_version`;
  routers.py `POST /api/documents/{id}/versions` (body {content}; 400 bad uuid / 404 missing;
  fresh idempotency key per request -> each save is a NEW version; returns {document_id,
  version_no, content, created_at}); team_run.py NEW `@DBOS.step read_latest_prd_step(run_id)`
  re-reading the LATEST DocumentVersion, wired at EACH agent-node entry (Engineer AND Reviewer,
  every iteration) in run_graph, replacing the removed workflow-local `prd_text` snapshot (idea
  stays the snapshot). Tests: NEW tests/test_live_prd_steering.py (endpoint x3, read-step,
  keystone mid-run steering, structural is-a-DBOS-step); shared `seed_pm_prd` conftest helper +
  3 existing stub sites updated (the live re-read now needs a real persisted PRD). NO migration /
  NO frontend / NO executor-contract change — pm_step, engines/*, docker_runtime.py, shipping.py,
  registry.py, teams.py, migrations 0001-0011 untouched. — feat/p1.7a-steering-backend @ 5c19828 —
  2026-06-24
- [x] P1.5c §14.3 — A/B comparison view: routers.py read endpoint + FE side-by-side + reviewer
  reasons. — feat/p1.5c-ab-comparison @ b420da8 — 2026-06-24
- [x] P1.5c §14.2 — A/B pair + launch (migration 0010). — feat/p1.5c-ab-pair @ 48e50d3 — 2026-06-23
- [x] P1.5c — verdict-reasons persistence (migration 0011). — main @ 7bf5e14 — 2026-06-23

## Blocked
None.

## Acceptance evidence (P1.7a)
- `git diff --stat main -- backend/`: 7 files — `tvashtr/routers.py` (+endpoint), `tvashtr/
  documents/service.py` (+get_latest_version), `tvashtr/control_plane/team_run.py` (+read step,
  +wiring, -dead prd_text), `tests/conftest.py` (+seed_pm_prd), `tests/test_review_cap.py` /
  `test_review_loop.py` / `test_reviewer_agent.py` (stub sites use seed_pm_prd). New untracked
  `tests/test_live_prd_steering.py`. DO-NOT-TOUCH list (alembic/versions/, frontend/, engines/*,
  docker_runtime.py, shipping.py, registry.py, teams.py, migrations 0001-0011) — `git diff
  --name-only main` over them is EMPTY. pm_step body byte-identical.
- `make test` → **177 passed** (+6 over the 171 baseline; +6 test_live_prd_steering.py, and the
  3 existing run_team suites updated for the live re-read). `make lint` → clean (75 files).
- Alembic head still `0011_invocation_outcome_detail` — NO migration.
- `import tvashtr.main` is openhands-free (`openhands` not in sys.modules); `test_registry` green.
- Endpoint payload sample (POST /api/documents/{id}/versions over a v1 doc):
  `{"document_id": "...", "version_no": 2, "content": "human-edited PRD body (steered)",
  "created_at": "2026-06-24T07:50:24.684659+00:00"}` (HTTP 200).
- Keystone `test_mid_run_prd_edit_reaches_the_revision_engineer` PASSES; the mutation-revert
  (flip `get_latest_version` to ascending order, so the re-read returns v1 not the latest) makes
  it FAIL at `assert engineer_prds[1][1] == _STEERED_PRD` (the round-2 Engineer would get the PM's
  original, not the human edit) — non-vacuity proven, then restored.
- No new pip dep (pyproject.toml not in the diff). No frontend.
- Adversarial 2-agent review (correctness+determinism / invariants+test-rigor): **0 blocking /
  0 major**; NITs all withdrawn-on-verification or accepted per-brief. Both independently re-ran
  the mutation-revert. Gates re-green after they restored the working tree (177 passed, lint clean).

## Deviations / decisions (two-way-door, logged)
- **read_latest_prd_step returns `str` (the content), not `{version_no, content}`** — the brief
  permitted either; bare content keeps the agent-step signatures byte-identical (`prd_text: str`)
  and the determinism guarantee is unaffected (the step's recorded return replays regardless of
  shape).
- **Removed the workflow-local `prd_text`** (init + the PM-node assignment) — it became unused
  after the live re-source (would be a ruff F841). pm_step still RETURNS `prd_text` (byte-identical);
  the walk just no longer threads the snapshot. Updated the two run_graph/module docstrings that
  listed `prd_text` as recomputed workflow-local state.
- **Shared `seed_pm_prd` conftest helper** — the live re-read makes the executor genuinely read
  the run's PRD document, so the offline run_team tests' fake `pm_step` (which returned a random
  uuid and never persisted a doc) had to persist a real v1 + set `Run.pm_document_id`. Factored
  the shared stand-in into conftest rather than duplicating it across the 5 stub sites; the
  existing assertions (cap termination, per-iteration metering, invocation sequences) are unchanged.
- **Endpoint mirrors GET /api/documents/{id}**: 400 on a malformed uuid (the brief named only the
  404; mirroring the sibling GET's 400 is the consistent contract). Fresh idempotency key per POST.

## Open Questions
- None blocking. (The document soft-lock is a deliberate deferral — see the brief / §15: in this
  loop only the PM writes the PRD; the Engineer/Reviewer only read it, so a human edit never
  collides with an agent write. The lock lands when an agent re-writes a doc the human also edits.)

## Test Count
177 offline backend tests passing — 2026-06-24 (unchanged in FE-infra — the backend was not
touched). `make lint` clean (backend+scripts ruff + FE eslint `--max-warnings 0` + prettier
`--check`). **Frontend vitest: 85 passing** (was 76: +9 RTL — keystone App poll-lifecycle, A/B
toggle, TeamCanvas status+rework-edge, TasksDrawer, SidePanel reviewer). FE `make build-frontend`
(tsc strict + vite) clean. Exactly ONE `eslint-disable` in the frontend (TeamCanvas exhaustive-deps,
narrowed + reasoned, live). alembic head 0011 (NO migration).

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/p1ring-editor, sha=ebe1d69, backend tests=177 passing, frontend
  vitest=76 passing (was 67). P1.7b live PRD steering editor (FRONTEND-ONLY). Gates all green:
  `make test` 177 passed; `make lint` clean (75 files); FE `npm run build` clean (tsc strict + vite,
  no new eslint-disable / no any-escape); FE `npm test` 76 passed incl. the round-trip-stability test
  (byte-stable no-op load→save; fence + deliverable line verbatim) AND the isPrdEditable test;
  `make steering-e2e` GREEN — the live J3 chain (run 113568cf-…) edits the PRD at the gate through
  the real TipTap editor, Saves a `human` version, approves the PRD + escalation gates, ships, and
  the committed greeting.txt == the human's SENTINEL (`Steered by a human mid-run via Tvashtr …`),
  NOT DEFAULT_IDEA's line. INVARIANTS: `git diff --name-only main` over control_plane/, models.py,
  engines/, gateway/, documents/, routers.py's existing endpoints, alembic/versions/ is EMPTY;
  alembic head still 0011 (NO migration). Two debugging remediations were config/test-only (no
  product code): `.env` `DEFAULT_MODEL=openai/gpt-4o-mini` (the prior reasoning model emptied the
  PRD) and the E2E spec's `Approve`-button exact-match. Deviation: `vite.config.ts` now scopes
  vitest to `src/` so the Playwright spec isn't collected as a unit test.

## READY_TO_MERGE (prior — P1.7a, still awaiting its own FF-merge)
READY_TO_MERGE: branch=feat/p1.7a-steering-backend, sha=5c19828, tests=177 passing
  (make test 177 GREEN [171 baseline + 6 new test_live_prd_steering.py]; make lint clean; alembic
  head 0011 — NO migration, nothing under alembic/versions/; git diff --name-only main over the
  do-not-touch list [engines/*, docker_runtime.py, shipping.py, registry.py, teams.py, migrations
  0001-0011, frontend/] is EMPTY; pm_step byte-identical; import tvashtr.main openhands-free;
  test_registry green; the keystone steering test passes AND its mutation-revert FAILs [non-vacuity];
  endpoint payload sample echoed; no new dep; no frontend). LIVE composition gate now GREEN
  (2026-06-24): `make loop-run` ships exactly once (run_id 2f080e81-…) + `make loop-crash` resumes
  mid-cycle and ships exactly once (run_id 5912a671-…, passed first attempt) — see the "Live
  composition gate (P1.7a)" section above for the full per-assertion proof and the
  qwen3→`nvidia_nim/meta/llama-3.3-70b-instruct` agent-model remediation in `.env` (config-only,
  gitignored, no code/assertion/harness change). make test 177 passing + make lint clean re-confirmed
  AFTER the live gate; alembic head still 0011; P1.7a code byte-identical to 5c19828.
