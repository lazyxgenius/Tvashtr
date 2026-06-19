# HANDOVER — Tvashtr-15 → Tvashtr-16

> Session-continuity snapshot. Durable project context lives in `PROJECTPLAN.md` (§1–§9 vision/arch/data-model, §15 deferred register, §16 milestones, §17 decision log, §18 glossary) and in Claude's memory. This file is the **delta + immediate next step + warm-start pointers**.

---

## 1. Where we are

**P1.5b is COMPLETE — both halves merged, live-proven, audited, and documented.** `main` is at **`6efa22f`** (advanced `8bf59fe` [backend] → `a188959` [the Tvashtr-14 backend-as-built doc commit] → `6efa22f` [the frontend, FF]). Phase 1 status: **P1.1–P1.4 ✅, P1.5a ✅, P1.5b ✅ (backend `8bf59fe` + frontend `6efa22f`).** Migration head **`0009`** (the FE merge added no migration). **133 backend offline tests; 39 FE vitest**; lint clean; startup openhands-free.

**What the P1.5b FRONTEND did** (this session, Tvashtr-15): made the backend's gate/terminal/drawer machinery **visible**. Gate (checkpoint) + terminal (ship/stop) nodes now render distinct from the agent cards; the **paused state lives ON the gate node** (`deriveGateState` reads the gate's `gate:{run_id}:{node_id}` task — the graph payload omits the invocation `outcome`, and a resolved gate node's `status` is `"done"` for BOTH approve and reject, so the approve-vs-reject color comes from the task's `resolution`), which **retired the `deriveNodeStatus` paused-onto-Engineer hack** (`predecessorDone` gone; `paused` removed from `NodeStatus`/`StatusPill`; the Engineer reads plain "Waiting" while the PRD gate awaits). A left-docked **Tasks-for-Human drawer** (`TasksDrawer`, 380px) replaced P1.1b's banner strip: **High/blockers** (Approve/Reject → `/resolve` + a card→gate-node "Show on canvas" link) above **Low/nudges** (Dismiss → the new `/acknowledge`); `null` when empty (actionable inbox). One **8-handle scheme** + a `pickHandles` geometry edge-router fixed a **latent "any conditional edge = the rework arc" bug** (5a treated every `conditions != null` edge as the dashed loop-back; gates added `{when:approved|rejected}` edges that would all have wrongly rendered dashed) — now only the real Reviewer→Engineer loop-back is dashed.

**Verification done:** architect disk-audited all **11** changed files against the brief (zero blocking) + one independent CC review (zero blocking); FE offline green (`tsc --noEmit` + `vite build`, `vitest` 39). **Operator live visual sign-off (the real bar) across several runs** proved the full path: the `review_loop` graph renders the PRD + escalation **gates** and ship/stop **terminals** distinct from the agent cards; a run **parked** at the PRD gate (gate calm-coral "Awaiting approval", Engineer plain "Waiting"), the drawer showed the blocker, the card **framed** the gate node; **approve→ship** end-to-end (PM Done → PRD-gate Approved → Engineer Done → Reviewer Done → **Ship terminal lit "Shipped"**, runs `4ef3f914`/`00512ee5`); the over-budget **blocker** (`/resolve`, run `7d2bf97f`) AND the 80% **nudge** (`/acknowledge`, run `00512ee5` — "Approaching budget: $0.0014 of $0.0015 (≥80%)", non-blocking → still shipped) both fired in the drawer's High/Low. `PROJECTPLAN.md` (header → Tvashtr-15, §15 P1.5 status + a new deferred item, §17 as-built entry) is updated by the architect this session.

**IMPORTANT — the FE is FUNCTIONALLY complete, NOT yet beautified.** The operator explicitly **deferred to 5c** the **n8n-bar visual polish** + two taste calls: (a) per-branch edge labels ("reject" / "cap reached"); (b) the nudge bar's tone (neutral vs info-blue / warning-amber). 5b cleared the *functional* acceptance gate; the *visual-polish* gate is 5c's.

---

## 2. Immediate next step — OPEN P1.5c (the real-feature chunk; design it first)

P1.5c is **not yet designed** (no Q1–Q4 lock exists for it — unlike 5b, which entered Tvashtr-15 fully designed). It is also **multi-part**, not one prompt. So the **first architect job in Tvashtr-16 is the SCOPE + SEQUENCE decision** — made *with* the operator, one question at a time, vision-grounded (NOT a menu to ratify; the architect proposes the decomposition + order and decides, the operator weighs in). The pieces that make up 5c's surface, for that conversation:

1. **Docker-mode loop seeding** *(the likely FIRST concrete move — it's prerequisite plumbing)*. 5a/5b's loop is proven in **local** mode; the **docker default breaks incremental rework** (the agent-server container starts empty and is reaped per `run()`, so an iteration-2 container can't see iteration-1's files). The fix: before iterations >1 in docker mode, **push** the host workspace into the container (a `file_upload` loop mirroring the existing `file_download` pull). This is the loop's P1.3 analog and must land **before** 5c ships a real **multi-file** feature through the default-docker path. Contained, well-specified — a clean opening sub-step. (§15, Tvashtr-13.)
2. **The real non-trivial feature + canonical-idea persistence** *(the heart of 5c — proves M1's "real, non-trivial feature")*. Needs design: *what* feature (something genuinely multi-file the loop must iterate on), and *how the canonical idea is persisted* (simply, per the §15 sequencing principle — the Supervisor MCQ intake is P1.8, so 5c uses a hardcoded/simply-persisted idea).
3. **The reviewer per-round verdict view** *(a defined deferred item)* — surface the reviewer's `approved`/`changes_requested` + reasons per loop iteration (the `AgentInvocation.outcome`-in-graph add). Touches the graph endpoint + the canvas/inspect FE.
4. **Canvas polish to the n8n bar + the two taste calls** *(the deferred 5b visual gate)* — the edge labels + nudge tone above, plus general canvas refinement to "n8n-level or better."
5. **The never-reached-node-status FE fix** *(a tiny quick win)* — see §7; a 2-line `deriveNodeStatus` refinement, can ride with the canvas-polish step.

Likely a natural order is **(1) docker-loop-seeding → (2) the feature + idea persistence → (3) reviewer-verdict view → (4) canvas polish + (5) the node-status fix**, but confirm with the operator. Each piece is its own Claude Code prompt (or two), built via the loop.

---

## 3. Read these surfaces FIRST when 5c work begins (verify-don't-assume — anchors must be exact)

Confirm paths via `list_directory`/`directory_tree` first (these are from prior reads and may have moved). Which to read depends on the chosen first piece:

- **For docker-loop-seeding:** `backend/tvashtr/adapters/` — the OpenHands docker adapter (the `file_download` pull-at-end is the mirror for the `file_upload` push); `backend/tvashtr/control_plane/team_run.py` — `run_graph` / the engineer step where iterations >1 are detected.
- **For the feature + idea persistence:** `backend/tvashtr/control_plane/team_run.py` (the uniform walk + the steps) and `backend/tvashtr/.../teams.py` (the hardcoded builders — where a richer team / the canonical idea seed live); the `Run`/graph schema in `models.py`.
- **For the reviewer-verdict view + canvas polish + the node-status fix:** under `frontend/src/` — `lib/status.ts` (`deriveNodeStatus` for the never-reached fix; `deriveGateState`/`deriveTerminalState` already there), `canvas/TeamCanvas.tsx` (the `pickHandles` router + edge styling for labels), `canvas/AgentNodeCard.tsx` (node render), `components/TasksDrawer.tsx` (the nudge tone), `canvas.css`/`index.css` (tokens); `lib/api.ts` (graph types — add the reviewer-verdict field if 5c surfaces `outcome`).
- **Always:** re-read the `PROJECTPLAN.md` **§17 P1.5 design entries** (Q1–Q4, 2026-06-18) + the **§15 deferred register** (the 5c-relevant items) + §1/§2 vision before designing.

---

## 4. Backend + FE contracts as of now (all live on `main`)

- `GET /api/runs/{run_id}/graph` → `{run_id, team_graph_id, nodes:[{id, role_name, kind, model, engine, position, config, status, iteration}], edges:[{id, source_node_id, target_node_id, edge_type, conditions}]}`. `kind ∈ completion|agent|gate|terminal`; `config` null for completion/agent (gate carries `{gate_kind,title,description}`, terminal `{terminal_kind}`); `status` from the latest `AgentInvocation` (default `"idle"`), `∈ running|done|failed|stopped`. **The FE now renders all of this** (gate/terminal nodes + the paused-on-gate visual).
- `GET /api/runs/{run_id}/tasks` → `{run_id, tasks:[{id, run_id, kind, priority, blocking, topic, title, description, status, resolution, resolution_note, created_at, resolved_at}]}`, oldest first. `priority ∈ high_blocker|low_nudge`. The only non-gate task is the `budget_threshold` `low_nudge` (`blocking=false`, `topic=null`). **The FE drawer now splits these High/Low.**
- `POST .../tasks/{id}/resolve` `{decision:"approve"|"reject", note?}` — gate tasks only (signals via `DBOS.send`; 409 if no `topic`). **Wired to the drawer's Approve/Reject.**
- `POST .../tasks/{id}/acknowledge` (no body) — topic-less nudge only; marks `resolved`/`acknowledged`, no `DBOS.send`; 409 if `blocking` or has a `topic`. **Wired to the drawer's Dismiss.**
- `POST .../cancel` — kill switch (unchanged).
- Gate `kind`s: `prd_approval`, `review_escalation`, `budget_approval`. Terminal `terminal_kind`s: `ship`, `stop`. `Run.status`: `pending|running|awaiting_human|completed|failed|rejected|cancelled|over_budget`.
- **Budget caps:** per-run `Run.budget_cap_usd`, seeded from `POST /api/runs` body else from config `default_run_budget_usd` (env `DEFAULT_RUN_BUDGET_USD`, bare name, no prefix; default `$5.00`). The 80% **nudge** fires only in the **80–100%-of-cap band** (`budget_nudge.py`, `_NUDGE_THRESHOLD=0.8`); over 100% → the `budget_approval` blocker instead. To surface the nudge in the UI: lower the cap so the PM-stage spend lands in that band (the PM is far cheaper than the Engineer — binary-search the cap against the drawer's High-vs-Low signal).

---

## 5. Design state — what's LOCKED vs OPEN for 5c

**Locked + shipped (do NOT re-litigate):** the uniform graph walk; gates/terminals as first-class nodes; budget-as-cross-cutting-policy (not a node); the drawer (High/blockers above Low/nudges, actionable inbox); the paused-state-on-gate-node visual; **the canvas is a VIEW in P1.5 — user placing/moving gates (J2) is Phase-2 authoring**, not 5c.

**Already-recorded decisions that bear on 5c** (in §15/§17, honor them): the **reviewer stays a `completion` node** until the deliverable is big enough to need an *exploring* agent (then `completion`→`agent` behind the same `EngineAdapter` — trigger likely in/after 5c's real feature); **docker-mode loop seeding** is the `file_upload`-push mirror of the existing pull; loop live-targets prove the *cycle/durability*, skeleton targets prove *exact content* (the harness-relaxation precedent).

**OPEN — to decide in Tvashtr-16:** the 5c scope + sequence (§2); *what* the real non-trivial feature is; *how* the canonical idea is persisted; the reviewer-verdict view's exact surface; the canvas-polish taste calls (edge labels; nudge tone).

---

## 6. Working method — the non-negotiables

- **Architect = design/audit/doc ONLY.** ALL implementation goes through a Claude Code prompt — product code, throwaway/diagnostic scripts, AND build/Makefile changes alike. **No architect-direct code edits** (there is NO "diagnostics are architect-direct" carve-out). The ONLY architect-direct edits: the two living docs, prompt `.md` files in `prompts/`, and trivial doc/comment/typo fixes.
- **Verify, don't trust.** After a CC report, read the changed files on disk and check them against the brief — audit every changed file before a go-ahead; do not take "done" at face value.
- **Loop:** architect writes one detailed, self-contained prompt (Objective / Context with exact paths+snippets / Constraints + an explicit do-NOT-touch list / ordered Tasks with anchors+exact names / Acceptance with tests+edge-cases / Report-back: files changed, commands run WITH full output incl. `make test`+lint, deviations, open questions, next step) → save to `prompts/` (`P{phase}.{step}{letter}-{slug}.md`), delivered as a clean single block OR (preferred) the runnable path → operator runs in Claude Code → pastes the report → architect audits disk vs report → operator smoke-tests (**visual eyeball = the real UI acceptance gate, n8n bar or better**) → operator merges (branch-per-step, always FF). Architect makes vision-grounded calls **directly, one question at a time, deciding — not menus**. Two tools stay available: the `/tvashtr-loop` skill (mechanical steps) and Playwright MCP (CC can drive UI/E2E inside a prompt — complements, doesn't replace, the operator's manual smoke-test).
- **Comms:** terse approvals ("done"/"proceed") = proceed. "By the way" = short answer wanted. Analogies help. One step at a time for procedures (operator completes + reports each before the next). Items the operator flags "don't forget" → capture in §15/§17 immediately.
- **Doc discipline:** `PROJECTPLAN.md` structural edits via `edit_file` with `dryRun:true` first; anchor on **unique multi-line strings** (long single-line anchors risk silent no-ops — the *apply* diff is the reliable verifier, a clean dry-run is not proof). §17 is **append-only** — insert before the `---` preceding `## 18. Glossary`. Bump the header **"Last updated"** every close. `HANDOVER.md` uses **full-rewrite** (`write_file`), not surgical edits. The architect commits the living-doc closeout (operator runs the git command).
- **Filesystem MCP** is the exclusive mechanism for project file reads/writes (deferred tools — load via `tool_search`; they evict, and the MCP can time out mid-session — retry, it recovers). The architect's own bash/str_replace/create_file operate on Claude's container, NOT the operator's machine. `read_text_file` honors only `head`/`tail` (ignores ranges) — for mid-file reads, cache the file to Claude's `/tmp` and `sed`/`grep` it (it's authoritative as long as the live file is unchanged).

---

## 7. Gotchas

- `main` is at **`6efa22f`**, NOT `8bf59fe` or `5921ac6` (older docs/memory lag; it advanced through the FE merge). Phase 1 is through **P1.5b**.
- **KNOWN ISSUE — never-reached nodes read "Failed" on a failed run** (logged §15). When a run fails at the PM (a transient live-LLM/key error, NOT a Tvashtr bug), `deriveNodeStatus`'s `if (failed) return "failed"` paints "Failed" onto the never-reached Engineer/Reviewer too. The fix is FE-only + tiny (an `idle` node on a failed/terminal run must read idle/stopped, not failed). Pre-existing (P1.5a logic). A 5c quick win.
- **A PM reading "Done" after a cancel-at-gate is CORRECT, not a bug** — the gate only appears *because* the PM step closed `done`; done is sticky; the card reflects step-completion, not PRD quality or run success. (Came up during 5b acceptance; don't "fix" it.)
- **The budget nudge band is narrow** (fires only 80–100% of the cap; the PM is much cheaper than the Engineer, and small dollar figures round to `$0.0000` on screen). For any future UI nudge demo, binary-search `DEFAULT_RUN_BUDGET_USD` against the drawer's High (over-budget blocker, cap too low) vs Low (nudge — that's it) vs no-budget-item (cap too high) signal. `~0.0015` hit it this session.
- **`make budget-demo` / the other `make *-demo` targets are HEADLESS CLI** — they don't surface anything in the UI drawer. UI behavior must be exercised by an actual UI run.
- **Pre-existing lint nit (noted, not fixed):** `scripts/loop_run.py` carries 3 ruff errors invisible to `make lint` (it scopes to `backend/`; the scripts live in `scripts/`). A cleanup-sweep item, not a regression. (§15 has the "fold `scripts/` into the lint gate" item.)
- **Branch hygiene (non-blocking):** the merged `feat/p1.5b-gates-and-drawer-frontend`, `feat/p1.5b-uniform-walk`, and older `feat/p1.5a-*` branches can be pruned. Untracked `p15b-*.png` Playwright screenshots sit in the repo root (operator can `git clean` or they can be `.gitignore`d).
- **The forced-revision harness** (`TVASHTR_FORCE_REVISIONS`) + `TVASHTR_AUTO_APPROVE_GATES` are read **inside recorded steps** so verdicts/gate-resolutions replay post-crash — don't move that logic to the workflow body.
- **Docker-default loop caveat (until §2 item 1 lands):** the docker-default loop only works for a single-iteration (no-rework) feature; a multi-file feature needing >1 iteration requires the loop-seeding push first.

---

## 8. Deferred register (§15) — for awareness, NOT necessarily this step

**Never-reached node status read "Failed"** (the §7 quick fix); **docker-mode loop seeding** (5c opening plumbing); per-node + per-project budgets; **canvas authoring** (J2, Phase-2); parallel branches / true per-branch pause; the **reviewer per-round verdict view** (`AgentInvocation.outcome`-in-graph); **cyclic-canvas polish to the n8n bar** + the two taste calls (edge labels; nudge tone); the real non-trivial feature + canonical-idea persistence; **frontend lint/format + RTL component tests** (the FE gate is `tsc`+`vitest` only — no eslint/prettier, no component tests); the `scripts/` lint-scope cleanup; short-circuit the proxy budget-429 retry-backoff; pin the agent-server image to a digest; relocate the Agent Server's event stores out of the deliverable workspace; per-run sandbox-mode observability; WebSocket upgrade for live updates (currently ~2s polling); model catalog/picker UI; CRDT for concurrent doc editing.

---

## 9. First action for Tvashtr-16

Read `HANDOVER.md` + `PROJECTPLAN.md` (esp. §17 P1.5 design + §15 deferred register), then **open the P1.5c scope/sequence decision with the operator** — one vision-grounded question at a time (§2). The likely first concrete move is **docker-mode loop seeding** (the prerequisite plumbing before any multi-file feature runs on the docker-default path), but confirm the order first. Once a piece is chosen and designed, write its self-contained Claude Code prompt to `prompts/`, the operator runs it, the architect audits disk + the operator's visual sign-off is acceptance, then merge — and update the living docs at the close.
