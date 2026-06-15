# HANDOVER — Tvashtr-4 → Tvashtr-5

> Structured snapshot to start the next chat. **Read this, then read `PROJECTPLAN.md` in full** (it's the source of truth; this file only adds emphasis + what's not already there).
> **Written:** 2026-06-15 by Tvashtr-4.

---

## 1. Where we are
**Phase 0 is COMPLETE & CLOSED. Milestone M0 is fully achieved.** The walking skeleton runs end-to-end and is now both **visible** and **inspectable**:
- **The spine (P0.1–P0.4):** idea → a 2-node team (**PM** = direct metered gateway completion writing a versioned mini-PRD → **Engineer** = OpenHands adapter that reads it and ships `greeting.txt` as a single idempotent `ship-{run_id}` tagged commit), all in **one durable DBOS workflow**, and it **resumes across a `kill -9` mid-agent-run and ships exactly once** (`make skeleton-crash`).
- **The UI (P0.5):** a React Flow **canvas** renders the 2 nodes with **live per-node status** (derived from `Run` fields, polled ~1.8s), and a node-select **side panel** shows the **PM's PRD + version history** and the **Engineer's run-event feed** — all on the operator's **Design System** (warm cream paper, one coral accent, Newsreader/Inter/IBM Plex Mono). `docs/M0-walkthrough.md` documents Phase-0 closure.

**The next chat (Tvashtr-5) begins Phase 1 — "the painkiller": Supervisor MCQ scoping + a real default team that actually builds non-trivial features.** This is a large phase; the first job is to **plan and decompose it** with the operator (as Phase 0 was decomposed into P0.1–P0.5) before writing any Claude Code prompt.

## 2. What P0.5 delivered (the visualization/inspection layer — all verified)
- **P0.5a — the living canvas (verified, code + operator visual sign-off).** New read-only endpoint `GET /api/runs/{run_id}/graph` (nodes+edges; no migration; deterministic PM-first order by `position.x`). Frontend re-skinned to the Design System (the P0.1 dark stub theme is gone): the token CSS is vendored under `frontend/src/design-system/`, mapped into Tailwind v4 via `@theme inline`, with `.tv-*` primitives ported from the DS components. `@xyflow/react` 12.11.0 canvas with a custom DS node card, status-driven edge, re-skinned Background/Controls/MiniMap; **read-only** (`nodesConnectable=false`; drag for layout only, not persisted); **motion-compliant** (one-shot bounded pulse on "running", edges `animated:false` — no marching dashes). Start-run + ~1.8s poll of `GET /api/runs/{id}` + a quiet run banner. **Per-node status is DERIVED** (one source of truth: `lib/status.ts::deriveNodeStatus`), incl. a *necessary* fold of workflow `ERROR/CANCELLED` → `failed` (because `run.status` only flips to `failed` on the engineer path — a PM-step failure would otherwise spin forever).
- **P0.5b — inspect the work (verified, code + live walkthrough).** **Frontend-only + one docs file — zero backend change, no migration** (consumes the existing `/api/documents/{id}` + `/api/spike/run-events/{id}`). Clicking a node opens a right-hand **side panel** (push/split layout — the canvas shrinks and **re-fits** so the clicked node stays reachable): **PM → PRD** (latest version + a version list, plain `pre-wrap` render at a reading measure, **no markdown lib**), **Engineer → run-event feed** (concise one-line summaries via `lib/events.ts::summarizeEvent`, **not** raw JSON; **scoped** ~2s polling that stops on terminal/close/unmount). The feed even renders the agent's action/observation stream legibly enough that the **unsandboxed write-escape** is now *visible* in it.

## 3. What's in flight
**Nothing mid-edit — clean phase boundary.** Phase 1 is not started; its plan/decomposition is Tvashtr-5's first task (with the operator).
**⚠️ Likely uncommitted:** P0.5a + P0.5b (Claude Code) and the architect's direct edits (the `color-mix` pill fix + rounded minimap in P0.5a; all the `PROJECTPLAN.md` / `HANDOVER.md` / `prompts/` writes) are probably **uncommitted on `main`**. Claude Code offered a commit grouping but didn't commit (this is `main`, no remote). **Recommend committing before real Phase-1 work begins** so the tree is clean. Suggested grouping: `feat(frontend): node-select side panel — PRD view + run-event feed` and `docs: M0 walkthrough + Phase-0 closeout`.

## 4. Immediate next steps (Tvashtr-5) — in order
1. **Read both docs** (`HANDOVER.md` + `PROJECTPLAN.md`), call `Filesystem:list_allowed_directories` to confirm the path (`/Users/adimac/Desktop/Tvashtr`, capital T).
2. **Skim the now-substantial codebase** so Phase-1 prompts are grounded:
   - Backend control plane: `backend/tvashtr/control_plane/{team_run.py,teams.py,shipping.py}` (the workflow + the 2-node team builder + idempotent ship), `engines/{base.py,openhands_adapter.py,registry.py,run_event_sink.py}` (the adapter contract + the one openhands import + event payload shapes in `_payload_of`), `gateway/` (the litellm chokepoint), `documents/service.py` (`create_document_with_initial_version`), `metering.py`, `routers.py` (the full HTTP surface), `models.py` (the schema).
   - Frontend (the Phase-1 UI grows from here): `frontend/src/{App.tsx,lib/*,canvas/*,panel/*,components/*,index.css,canvas.css,panel.css}` + `frontend/src/design-system/` (the vendored DS tokens).
   - `docs/M0-walkthrough.md` (the closeout) and the operator-provided `Design System/` (brand source of truth for all UI).
3. **Confirm the commit state** with the operator (is the P0.5 work committed? — see §3) before building on top.
4. **Plan & decompose Phase 1 with the operator** — this is the real first job. Phase 1 is much bigger than one feature; resolve the open design questions (§5 below) and break it into a sequence of tightly-scoped sub-steps (a "P1.x" decomposition, the way Phase 0 became P0.1–P0.5), recording the plan in `PROJECTPLAN.md`. **Do not write a Claude Code prompt until the Phase-1 plan + the first sub-step's design points are settled with the operator.**

## 5. Phase 1 — what it is, and the design questions to resolve first
**Goal (PROJECTPLAN §15):** Tvashtr actually builds real things with a sensible **default team**, on the real substrate.
**Scope:** Supervisor scoping (MCQ) + team drafting; the **full document layer** (versioned, **live-editable** — TipTap lands here) with the side panel becoming the **read/edit** surface; the autonomous **sprint loop** (PM→Tech Lead→FE/BE→review) — a real **cyclic** graph with enforced termination; the **per-loop alignment check** vs. the original idea; **human gates + Tasks-for-Human** (blockers) on DBOS `recv`/`send` signals; **GitHub** greenfield + commit/PR; **one** output surface; **cost caps + kill switch**.
**Exit criteria (M1):** a real, **non-trivial** feature shipped from an idea with **at least one human gate and one resolved blocker**.

**Likely decomposition (to refine with the operator — not locked):**
- **The Supervisor Agent** — guided **MCQ scoping** → a persisted canonical "original idea" → a **drafted team graph**. (This is the first net-new agent; it's *one of the agents the Control Plane runs*, per D2 — not the plumbing.)
- **The full document layer + TipTap** — versioned, **live human-editable** docs; **soft section locks** v1 (CRDT/Yjs = named upgrade); the side panel evolves from read-only render to a **TipTap editor**.
- **The multi-node default team + the sprint loop** — more than 2 nodes; a **cyclic** work/review graph with **loop caps + gate conditions** for termination (D4); the **per-loop alignment check**.
- **Human gates + Tasks-for-Human** — gates that **block indefinitely on a DBOS signal** (`recv`/`set_event`), High/blockers vs Low/nudges; the run pauses and resumes cleanly.
- **GitHub integration** — greenfield repo + commit/PR (a real output surface, replacing the local `.tvashtr_workspaces` repo).
- **Cost caps + kill switch** — layered caps enforced in the Control Plane with the **Model Gateway** as the dollar chokepoint; the **"cancel run"** affordance folds in here (the kill-switch path).

**Genuine open questions to settle (early, with the operator):**
- **Does the Docker sandbox land in Phase 1?** It's deferred, but the **write-escape is demonstrated** (P0.4b), and Phase 1 runs *real* (less trivial, less controllable) code — so unsandboxed execution gets riskier. Decide whether the OpenHands Agent Server Docker sandbox becomes a Phase-1 prerequisite or stays deferred with the band-aid. (Strongest open safety item.)
- **When does the WebSocket transport replace polling?** It's the named Phase-1 upgrade and is genuinely needed for **live doc co-editing** + a **high-frequency run monitor** + **blocker alerts**. Sequence it.
- **When does the LiteLLM proxy land?** Named Phase-1, for **budget enforcement / virtual keys** once cost caps become MVP-critical.
- **Model catalog/picker** — deferred from P0.2 ("needs the canvas to consume it"). Does the Supervisor pick per-node models in Phase 1, or does that wait for Phase-2 authoring? (Graph *authoring* itself is Phase 2.)
- **Frontend test runner** — there's **no JS test runner** in the repo today (P0.5 logic was verified via strict typecheck + live mirrors). As the frontend grows (TipTap, more components), **stand up vitest** early in Phase 1 so pure logic like `summarizeEvent`/`deriveNodeStatus` is unit-tested.

## 6. Standing conventions (unchanged — still load-bearing)
- **Boundary discipline:** only `gateway/gateway.py` imports `litellm`; only `engines/openhands_adapter.py` imports `openhands.*`; anything constructing the adapter imports it **lazily** (app startup + the offline test suite stay openhands-free — there's an actual test enforcing this). The engine-neutral contract in `engines/base.py` is the durable asset.
- **At-least-once-safe writes:** every side-effecting write inside a `@DBOS.step` is idempotent on a key derived from `DBOS.workflow_id` (e.g. `{run_id}:pm-prd-v1`, `{run_id}:agent-cost`, the `ship-{run_id}` git tag, `(run_id, seq)` for run events).
- **Single `OPENROUTER_API_KEY`** for both the gateway and the agent's internal LiteLLM (exported from `.env` by the Makefile). `.env` is gitignored; no key has ever reached a commit; repo has no remote.
- **Verify fast-moving SDKs against the installed package**; **verify Claude Code's reports against the actual files** before writing the next prompt (the reports can also arrive scrollback-garbled — read the disk).
- **New in P0.5 (frontend conventions):** consume the **Design System from the token CSS** (no `_ds_bundle.js` global), **no ad-hoc hex** (tokens or `color-mix` of tokens only), **polling** (~1.8–2s) is the current transport (WebSocket is the named upgrade), the **canvas is read-only** (authoring is Phase 2), per-node **status is derived** from `Run` fields (one function), and the **side panel** is the inspect surface (→ becomes read/edit in Phase 1). `npm run build` (strict `tsc --noEmit` + `vite build`) is the frontend gate (no separate lint/test step yet).

## 7. Open risks & carried items (see `PROJECTPLAN.md` §13 + the §15 Deferred register)
- **⚠️ Unsandboxed write-escape is DEMONSTRATED (P0.4b), not theoretical** — the agent wrote outside its workspace when the PM emitted an absolute path; the prompt-level fix is a band-aid. **Only the deferred Docker sandbox truly contains it**, and Phase 1's real-code builds make this more pressing (see §5). Strongest open safety item.
- **`run_events` is a "Frankenstein" log after a crash** (first/abandoned attempt's events for colliding `(run_id, seq)` + the winner's tail). The feed now notes this in-UI; a clean winning-attempt view is a possible later refinement.
- **No "cancel run"** — a killed-and-abandoned `run_team` is *resumed* by DBOS on the next backend boot (the M0 property). Registered in §15; folds into the kill-switch work.
- **Verbose run-event payloads** — `_payload_of` stores `str(repr)` of OpenHands objects, so action rows without a model `thought` read as `command='create' path=…`. A cleaner extraction is a Phase-1 backend refinement.
- **No frontend test runner** (stand up vitest in Phase 1). **Workspaces accumulate** under `backend/.tvashtr_workspaces/<run_id>/` with no GC.
- **Named upgrades parked in the §15 register (do NOT drop, operator-flagged):** Option B **agent-native resume**; **exact spend-accounting across crashes**; in-process unified metering; the **LiteLLM proxy** (Phase 1); **CRDT/Yjs**; the **Docker sandbox**; **WebSocket transport**; **cancel run**; workspace GC.

## 8. Tech stack (all LOCKED — §8 of PROJECTPLAN.md for rationale)
DBOS Transact 2.23.0 · LiteLLM 1.89.0 · **React Flow `@xyflow/react` 12.11.0** (now in use) · OpenHands SDK 1.28.1 (`openhands-sdk` + `openhands-tools`; **local-dir workspace** now, Docker later) · Postgres 16 · FastAPI · SQLAlchemy 2 + Alembic · Python 3.12 / uv · Vite 7 / React 19 / Tailwind v4 · `lucide-react` 1.18.0 (icons) · the operator's **Design System** (vendored tokens). **Coming in Phase 1:** **TipTap** (live doc editor) · **WebSockets via FastAPI** (push transport) · the **LiteLLM proxy** (budget chokepoint). Doc-concurrency v1 = soft section locks (Yjs = named upgrade).

## 9. Repo state & how to drive it
- **Project root:** `/Users/adimac/Desktop/Tvashtr` (where Claude Code runs; the architect chat edits the living docs here directly via Filesystem MCP).
- **Make targets:** `setup`, `db-up`, `db-down`, `migrate`, `backend`, `frontend`, `test`, `lint`, `fmt`, `smoke` (live gateway), `agent-smoke` (live agent), **`skeleton-run`** (live 2-node happy path), **`skeleton-crash`** (the M0 crash-resume proof), `crash-demo` (P0.1). The live targets skip cleanly without `OPENROUTER_API_KEY` and take minutes. **P0.5 added no new target** — the UI is just `make backend` + `make frontend` → open `http://localhost:5173` (Vite proxies `/health` + `/api` → `:8000`, so no CORS config).
- **Migrations:** `0001`–`0005` (P0.5 added none). `0005_engineer_run_attempts` is newest.
- **Prompts archived in `prompts/`:** `P0.1`…`P0.4b`, `P0.5a-canvas-live-status.md`, `P0.5b-doc-view-and-feed.md`. Add `P1.x-*` there.
- **HTTP surface (all in `routers.py`):** `POST /api/runs` → `{run_id}`; `GET /api/runs/{run_id}` (workflow status + run row + costs — the live-status source); **`GET /api/runs/{run_id}/graph`** (nodes+edges — the canvas); `GET /api/documents/{id}` (PRD + versions); `GET /api/spike/run-events/{run_id}` (the feed; a "spike"-named route that works — promoting it to `/api/runs/{id}/events` is a trivial future cleanup); plus the P0.2 spike endpoints.
- **Frontend layout:** `lib/` (api client, status derivation, event summarizer), `canvas/` (TeamCanvas + node card + empty state), `panel/` (SidePanel + PrdView + EventFeed), `components/` (StatusPill, RunBanner, BackendDot), `design-system/` (vendored DS tokens), `index.css`/`canvas.css`/`panel.css` (token-driven, the DS re-skin).
- **Commit state:** see §3 — likely uncommitted; commit before Phase-1 work.

## 10. Operator working style (apply throughout)
- **Analogies help** when explaining concepts.
- A message starting with **"By the way"** = give a **short** answer.
- **Procedures one step at a time** — deliver step 1, wait for the operator's reported result, then step 2 (governs hands-on bits: commands, installs, smokes).
- **One Claude Code prompt per step**; prefer several tightly-scoped prompts over one sprawling one (Phase 0 split P0.4→a/b and P0.5→a/b; Phase 1's sub-areas will each be one or more prompts).
- **Decision log over silent revision** — when the operator pushes back, record the reasoning in `PROJECTPLAN.md` §17.
- **Operator flags things he doesn't want forgotten** — capture them in the §15 register / decision log immediately.
- **NEW (P0.5): UI/UX quality matters — "n8n-level (or better)."** The operator cares about polish. **Visual acceptance is a three-way loop:** Claude Code builds + reports how DS tokens map → architect reads the frontend files against the Design System + the bar → **operator eyeballs the live dev server**. Don't declare UI "done" on a green build alone.
- **Chat naming:** open by stating your name ("This is Tvashtr-5"); the number comes from the first message of the chat.

## 11. Pointers
- Source of truth: `PROJECTPLAN.md` — esp. §6 architecture, §7 decisions (D1–D10), §8 stack (locked), §9 data model, §13 risks, §15 roadmap + the **Deferred refinements register**, §16 milestones (**M0 ✅, Phase 0 closed**), §17 decision log (every P0.x decision + verification).
- Working loop, prompt structure, review discipline: the project instructions.
- The verified code to build Phase 1 on: the backend control plane + engines + gateway + documents, and the whole `frontend/` (canvas + side panel) — all listed in §4/§9.
- The Phase-0 closeout narrative: `docs/M0-walkthrough.md`.
