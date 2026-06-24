# Tvashtr — Autonomous Execution State

## Current Milestone
P1.7b — **live PRD steering, the FRONTEND half** (the human-usable surface for the P1.7a J3 seam).
In the PM panel, while a run is in-flight, the LATEST PRD version renders in a **TipTap
(ProseMirror) markdown editor**; a human edit, saved explicitly, POSTs the full markdown to the
existing `POST /api/documents/{id}/versions` (a new `created_by:"human"` version) — the running
agents re-source it on their next node entry (J3, already wired in P1.7a). Editing is gated on the
run being in-flight (`isPrdEditable`); a terminal run / any older version is read-only. Proven by a
LIVE Playwright E2E that edits the PRD at the gate through the real editor and asserts the shipped
deliverable reflects the human's edit. FRONTEND-ONLY, NO migration (head stays 0011). — **DONE,
all gates green incl. the live J3 E2E, READY_TO_MERGE.**

## Last Completed Step
P1.7b (live PRD steering editor) — 2026-06-24 — branch: feat/p1ring-editor — sha ebe1d69 —
FE build clean, vitest 76 (was 67: +4 round-trip-stability, +5 isPrdEditable), make test 177
(backend untouched), make lint clean, alembic head 0011 (NO migration), AND `make steering-e2e`
GREEN: the live J3 chain edits the PRD at the gate through the real TipTap editor and ships the
human's SENTINEL line. READY_TO_MERGE.

## In Progress
None — P1.7b is implemented and all gates are green including the live J3 E2E. Awaiting operator
FF-merge of feat/p1ring-editor. (P1.7a feat/p1.7a-steering-backend is also still awaiting its
FF-merge; P1.7b was built on `main`, which already has P1.7a merged @ 4f5cf04.) NEXT: the FE-infra
step (ESLint + Prettier + RTL, a whole-codebase sweep as its own /goal), and/or P1.8 Supervisor.

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
177 offline backend tests passing — 2026-06-24 (unchanged in P1.7b — the backend was not touched).
ruff clean. **Frontend vitest: 76 passing** (was 67: +4 prdEditor round-trip-stability, +5
isPrdEditable). FE `npm run build` (tsc strict + vite) clean; no new `eslint-disable`, no `any`-escape.

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
