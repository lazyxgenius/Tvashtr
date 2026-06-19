# HANDOVER — Tvashtr-16 → Tvashtr-17

> Session-continuity snapshot. Durable project context lives in `PROJECTPLAN.md` (§1–§9 vision/arch/data-model, §15 deferred register, §16 milestones, §17 decision log, §18 glossary) and in Claude's memory. This file is the **delta + immediate next step + warm-start pointers**.

---

## 1. Where we are

**P1.5c sub-step 1 (docker-mode loop seeding) is COMPLETE — built, disk-audited, all three live targets green, and merged to `main`.** `main` is at **`4f4fa48`** (advanced `6efa22f` → `e29527e` [the seeding work, FF] → `4f4fa48` [a tiny chore commit untracking stray screenshots + gitignoring root PNGs]). Phase 1 status: **P1.1–P1.4 ✅, P1.5a ✅, P1.5b ✅, P1.5c sub-step 1 ✅.** Migration head **`0009`** (seeding added **NO migration**). **135 backend offline tests** (133 + 2 new `enumerate_push_files`); **39 FE vitest** (unchanged — this was a backend-only step); lint clean; startup openhands-free.

**What this session (Tvashtr-16) did:**
1. **Opened P1.5c and locked its scope + sequence** (the operator delegated the call — "I am very patient; choose what's best; decide on the Tvashtr-1 vision" — so the architect decided directly from §1/§2/§4/§5). The sequence (§2 below): **(1) docker-loop-seeding [done this session] → (2) the real multi-file feature + canonical-idea persistence [NEXT, the M1 capstone] → (3) the reviewer per-round verdict view → (4) canvas polish to the n8n bar + the two 5b taste calls → (5) the never-reached-node-status FE fix [folds into 4]**.
2. **Built + shipped the docker-loop-seeding sub-step.** Before the Engineer runs in docker mode, the adapter now **seeds the host workspace INTO the fresh per-iteration container** (`_push_workspace`, the symmetric mirror of the existing `_pull_workspace`), so a cyclic loop on the **default docker substrate** carries iteration N−1's deliverable into iteration N and the Reviewer's feedback can actually be applied. Before this, the loop only reworked-in-place in pinned-`local` mode; on docker, iteration-2's container started empty.

**As-built (all behind the §5 adapter seam — the elegant property: NO contract/`team_run.py`/migration/FE change; the local adapter + `_pull_workspace` are byte-untouched):**
- `enumerate_push_files(host_dir)` in `backend/tvashtr/engines/docker_runtime.py` (**openhands-free → offline-testable**) — the `os.walk` mirror of the pull's container-side `find … -not -path '*/.*'`: top-level-only scaffolding drop (`if dirpath == root`), any-depth hidden pruning, sorted. **Iteration-1's host is freshly git-init'd (only `.git`) → enumerates to `[]` → a no-op, so there is NO iteration-number plumbing** — the host's contents drive it.
- `_push_workspace(workspace, host_dir)` in `backend/tvashtr/engines/openhands_docker_adapter.py` — the faithful mirror of `_pull_workspace`: `file_upload(host_src, container_dest)`, nested `mkdir -p` first, `.success`/`.error`, empty→no-op. Called in `run()` **after the container-ready log, before `Conversation(...)`**; reads `task.workspace_dir` (the run-keyed host dir the pull writes each iteration).
- `scripts/seeding_smoke.py` + `make seeding-smoke`; `make loop-run-docker` (reuses `loop_run.py` with `TVASHTR_AGENT_SANDBOX=docker`).

**Verification done:** architect disk-audited all **5** changed files against the brief (zero blocking) — re-read `base.py` (the `EngineAdapter` contract — byte-identical), `team_run.py` (imports/docstring byte-identical, no stray hook), `_pull_workspace` (untouched); + one independent CC review. **Verify-don't-assume confirmed** (CC read the installed SDK; the smoke reconfirmed at runtime): `DockerWorkspace.file_upload(source_path, destination_path) -> FileOperationResult` — same `(host, container)` positional order as `file_download` but mirrored roles, same `.success`/`.error` type. Offline: 135 tests, ruff clean, `import tvashtr.main` openhands-free, `test_registry` green.

**Live (operator-run, all green, all exited cleanly):**
- `make seeding-smoke` — the **rigorous non-vacuous mechanism proof**: push a sentinel flat+nested into a fresh container, read it back in-container, **revise the seeded file**, pull, and the revision-of-seeded-content survives the host→container→revise→host round-trip (impossible unless the seed landed); `OK = True`, no orphan.
- `make loop-run-docker` — the cyclic loop **ships once on the docker substrate** (Engineer×2 with the forced revision, Reviewer `[changes_requested, approved]`, one loop-back, one ship tag, `completed`, **run `6788522f`**), iteration 2 genuinely seeded from the host.
- `make loop-run` — local regression green (**run `ddfc4a44`**), the local path untouched.

**Honest scope (held, NOT over-engineered):** on the trivial `greeting.txt` deliverable, `loop-run-docker` cannot by itself *isolate* seeding (iter-2 would re-create the file regardless) — `seeding-smoke` carries the rigorous mechanism proof, and **the loop-LEVEL non-vacuous seeding proof arrives inherently with 5c step 2's real multi-file feature** (where iter-2 *must* build on iter-1's files).

`PROJECTPLAN.md` is updated by the architect this session: header → Tvashtr-16 lead, the §15 seeding register item flipped to ✅ DONE, and two new §17 entries (the 5c design-lock + the seeding as-built). All committed in `e29527e`.

---

## 2. Immediate next step — DESIGN P1.5c step 2: the real multi-file feature + canonical-idea persistence (the M1 capstone)

The 5c **sequence is decided** (§1); step 1 (seeding) is done. **Step 2 is the heart of 5c and what actually proves M1** ("a real, non-trivial feature shipped from an idea"). Framing that matters: M1's human gate (PRD) + a resolved blocker are **already mechanically in hand** (over-budget fired+resolved in 5b; review-escalation is cap-tested) — so step 2 is on the hook for **the painkiller itself: a genuinely multi-file feature shipped through the loop with the *REAL* Reviewer judging it against the idea.** Every loop run to date used the trivial `greeting.txt` + the `TVASHTR_FORCE_REVISIONS` harness *faking* the cycle; step 2 is the **first time the real Reviewer (no harness) genuinely decides `approved` vs `changes_requested`**, and the first time the loop-level seeding proof (step 1) becomes inherent.

It runs on the **docker-default substrate** (now that step 1 landed). **Two design calls to make WITH the operator, one vision-grounded question at a time, deciding directly (NOT a menu to ratify):**

1. **WHICH feature?** Goldilocks: genuinely **multi-file** so the real Reviewer has something real to judge AND a first pass *plausibly falls short* (so the review loop earns its keep non-vacuously — the project's recurring "a vacuous proof is a real failure" lesson), yet **bounded enough to ship reliably** on the cheap agent model (the Engineer is `gpt-4o-mini` today). Think a small self-contained app/module the Engineer builds in a couple of files and the Reviewer can judge against a short idea spec.
2. **HOW is the canonical idea persisted?** **Simply** — per the §15 sequencing principle, the Supervisor MCQ intake is **P1.8**, so 5c uses a hardcoded / simply-seeded canonical idea (not the real funnel). Decide the minimal persistence: today `run_team` feeds the PM an idea string; confirm on disk what carries it now (the `Run`/graph schema + how `POST /api/runs` gets the idea to the PM step) and choose the smallest durable seat for the canonical idea the Reviewer aligns against.

Step 2 is likely **one prompt** (possibly two if the feature + a thin idea-persistence schema split cleanly). Built via the loop; the operator's **visual + a real end-to-end docker run is the acceptance gate** (the Reviewer genuinely looping, then shipping a multi-file deliverable).

**Then (after step 2):** (3) the reviewer per-round verdict view (surface `AgentInvocation.outcome` + reasons per iteration — the `outcome`-in-graph add; touches the graph endpoint + canvas/inspect FE — makes the capstone *legible*, a §1 product requirement, so it rides tight behind step 2); (4) canvas polish to the n8n bar + the two deferred 5b taste calls (per-branch edge labels "reject"/"cap reached"; the nudge bar's tone, neutral vs info-blue/warning-amber); (5) the never-reached-node-status FE fix (a 2-line `deriveNodeStatus` refinement — folds into 4).

---

## 3. Read these surfaces FIRST when step-2 work begins (verify-don't-assume — anchors must be exact)

Confirm paths via `list_directory`/`directory_tree` first (these are from prior reads and may have moved). For **step 2 (the real feature + idea persistence)**:

- `backend/tvashtr/control_plane/team_run.py` — the uniform walk (`load_graph_step → run_graph`, the four node-kind handlers) + the steps: `pm_step` (writes the PRD `Document`), `reviewer_decide_step` (the **real** Reviewer path vs the `TVASHTR_FORCE_REVISIONS` harness — step 2 exercises the REAL path), `engineer_run_step` (the build; carries the Reviewer feedback on rework). This is where the idea string is fed to the PM/Reviewer.
- `backend/tvashtr/control_plane/teams.py` — the hardcoded builders (`build_two_node_team`, `build_review_loop_team`); where a richer team and/or the canonical-idea seed would live.
- `backend/tvashtr/models.py` — the `Run`/`TeamGraph`/`AgentNode`/`Edge`/`Document` schema; confirm what currently carries the "idea" (note: §9.2 names `Project.original_idea`/`Run.idea_snapshot`, but **no Project entity exists yet** — check what `run_team` actually feeds as the idea today).
- `backend/tvashtr/routers.py` — `POST /api/runs` (the `team_shape` param + how the idea reaches the workflow).
- **The seeding adapter (step 1, now on `main`, for context if a docker behavior needs confirming):** `backend/tvashtr/engines/openhands_docker_adapter.py` (`_push_workspace` + `_pull_workspace`), `backend/tvashtr/engines/docker_runtime.py` (`enumerate_push_files`).
- **For steps 3–5 (later):** under `frontend/src/` — `lib/status.ts` (`deriveNodeStatus` for the never-reached fix; `deriveGateState`/`deriveTerminalState` already there), `lib/api.ts` (graph types — add the reviewer-verdict field when step 3 surfaces `outcome`), `canvas/TeamCanvas.tsx` (the `pickHandles` router + edge styling for labels), `canvas/AgentNodeCard.tsx`, `components/TasksDrawer.tsx` (the nudge tone), `canvas.css`/`index.css`.
- **Always:** re-read the `PROJECTPLAN.md` **§17 P1.5 design entries** (Q1–Q4 + the two Tvashtr-16 entries) + the **§15 deferred register** (the 5c-relevant items) + §1/§2 vision before designing.

---

## 4. Backend + FE contracts as of now (all live on `main` @ `4f4fa48`)

*(Unchanged from the 5b/seeding work — seeding was purely adapter-internal, no contract change.)*

- `GET /api/runs/{run_id}/graph` → `{run_id, team_graph_id, nodes:[{id, role_name, kind, model, engine, position, config, status, iteration}], edges:[{id, source_node_id, target_node_id, edge_type, conditions}]}`. `kind ∈ completion|agent|gate|terminal`; `config` null for completion/agent (gate carries `{gate_kind,title,description}`, terminal `{terminal_kind}`); `status` from the latest `AgentInvocation` (default `"idle"`), `∈ running|done|failed|stopped`.
- `GET /api/runs/{run_id}/tasks` → `{run_id, tasks:[{id, run_id, kind, priority, blocking, topic, title, description, status, resolution, resolution_note, created_at, resolved_at}]}`, oldest first. `priority ∈ high_blocker|low_nudge`. The only non-gate task is the `budget_threshold` `low_nudge` (`blocking=false`, `topic=null`).
- `POST .../tasks/{id}/resolve` `{decision:"approve"|"reject", note?}` — gate tasks only (signals via `DBOS.send`; 409 if no `topic`).
- `POST .../tasks/{id}/acknowledge` (no body) — topic-less nudge only; marks `resolved`/`acknowledged`, no `DBOS.send`; 409 if `blocking` or has a `topic`.
- `POST .../cancel` — kill switch.
- Gate `kind`s: `prd_approval`, `review_escalation`, `budget_approval`. Terminal `terminal_kind`s: `ship`, `stop`. `Run.status`: `pending|running|awaiting_human|completed|failed|rejected|cancelled|over_budget`.
- **Budget caps:** per-run `Run.budget_cap_usd`, seeded from `POST /api/runs` body else config `default_run_budget_usd` (env `DEFAULT_RUN_BUDGET_USD`, bare name, no prefix; default `$5.00`). The 80% **nudge** fires only in the **80–100%-of-cap band**; over 100% → the `budget_approval` blocker.
- **Sandbox / seeding:** `agent_sandbox_mode` default is **`docker`** (env `TVASHTR_AGENT_SANDBOX`); the docker adapter now pushes the host workspace into the fresh per-iteration container before the agent runs (step-1 seeding). The fast dev/test targets pin `local`; `loop-run-docker` pins `docker`.

---

## 5. Design state — what's LOCKED vs OPEN for 5c

**Locked + shipped (do NOT re-litigate):** the uniform graph walk; gates/terminals as first-class nodes; budget-as-cross-cutting-policy (not a node); the drawer (High/blockers above Low/nudges, actionable inbox); the paused-state-on-gate-node visual; **the canvas is a VIEW in P1.5 — user placing/moving gates (J2) is Phase-2 authoring**, not 5c; **docker-mode loop seeding (step 1) — DONE this session.**

**The 5c scope + sequence is now LOCKED (Tvashtr-16, §2)** — no longer open. (1) seeding ✅ → (2) real feature + idea persistence → (3) reviewer-verdict view → (4) canvas polish + 2 taste calls → (5) never-reached-node fix.

**Already-recorded decisions that bear on the rest of 5c** (honor them): the **reviewer stays a `completion` node** until the deliverable is big enough to need an *exploring* agent — **step 2's real multi-file feature is the likely trigger to evaluate `completion`→`agent`** (behind the same `EngineAdapter`); loop live-targets prove the *cycle/durability*, skeleton targets prove *exact content* (the harness-relaxation precedent — `loop-run`/`loop-crash` assert the shipped file *contains* the required line, since a forced round tidies it).

**OPEN — to decide in Tvashtr-17 (step 2):** *WHICH* the real non-trivial multi-file feature is; *HOW* the canonical idea is persisted (simply). Then, later: the reviewer-verdict view's exact surface; the canvas-polish taste calls.

---

## 6. Working method — the non-negotiables

- **Architect = design/audit/doc ONLY.** ALL implementation goes through a Claude Code prompt — product code, throwaway/diagnostic scripts, AND build/Makefile changes alike. **No architect-direct code edits** (there is NO "diagnostics are architect-direct" carve-out). The ONLY architect-direct edits: the two living docs, prompt `.md` files in `prompts/`, and trivial doc/comment/typo fixes.
- **Verify, don't trust.** After a CC report, read the changed files on disk and check them against the brief — audit every changed file before a go-ahead; do not take "done" at face value. (This session: re-read `base.py`/`team_run.py`/`_pull_workspace` to confirm they were byte-untouched, and confirmed `file_upload`'s real signature against the installed SDK.)
- **Loop:** architect writes one detailed, self-contained prompt (Objective / Context with exact paths+snippets / Constraints + an explicit do-NOT-touch list / ordered Tasks with anchors+exact names / Acceptance with tests+edge-cases / Report-back: files changed, commands run WITH full output incl. `make test`+lint, deviations, open questions, next step) → save to `prompts/` (`P{phase}.{step}{letter}-{slug}.md`), delivered as a clean single block OR (preferred) the runnable path → operator runs in Claude Code → pastes the report → architect audits disk vs report → operator smoke-tests (**visual eyeball / a real end-to-end run = the real acceptance gate, n8n bar or better**) → operator merges (branch-per-step, always FF). Architect makes vision-grounded calls **directly, one question at a time, deciding — not menus**. Two tools stay available: the `/tvashtr-loop` skill (mechanical steps) and Playwright MCP (CC can drive UI/E2E inside a prompt — complements, doesn't replace, the operator's manual smoke-test).
- **Operator profile:** solo dev; this session found terminal scrolling / Ctrl-C / git incantations difficult — give **dead-simple, exact, copy-paste commands** with a one-line "what this does" + "what success looks like", and for procedures one step at a time (operator completes + reports each before the next). Terse approvals ("done"/"proceed") = proceed. "By the way" = short answer wanted. Analogies help. Items the operator flags "don't forget" → capture in §15/§17 immediately.
- **Doc discipline:** `PROJECTPLAN.md` structural edits via `edit_file` with `dryRun:true` first; anchor on **unique multi-line strings** (long single-line anchors risk silent no-ops — the *apply* diff is the reliable verifier, a clean dry-run is not proof). §17 is **append-only** — insert before the `---` preceding `## 18. Glossary`. Bump the header **"Last updated"** every close. `HANDOVER.md` uses **full-rewrite** (`write_file`), not surgical edits. The architect prepares the living-doc closeout; the operator runs the git command (this session: `git add -A` swept in stray screenshots → a follow-up `git rm --cached` + a `/*.png` gitignore fixed it; consider whether `git add -A` is the right stage command next time, or stage explicit paths).
- **Filesystem MCP** is the exclusive mechanism for project file reads/writes (deferred tools — load via `tool_search`; they can time out / evict mid-session — retry/restart recovers). The architect's own bash/str_replace/create_file operate on Claude's container, NOT the operator's machine. `read_text_file` honors `head`/`tail`; a `view_range` mid-file read may return "too large" and **store the result to a file on Claude's container** — then `grep`/`python` that stored JSON (it's authoritative as long as the live file is unchanged), or use `head`/`tail`.

---

## 7. Gotchas

- **`main` is at `4f4fa48`** (seeding `e29527e` + the screenshot-cleanup chore on top). Older docs/memory may lag at `6efa22f`/`8bf59fe`. Phase 1 is through **P1.5c sub-step 1**.
- **⚠️ STALE-PARKED-RUNS HANG (the big operational lesson this session).** Leftover **PENDING** runs from earlier sessions — parked at gates, never cancelled — **resurrect on EVERY in-process backend boot** (DBOS recovery) and hold **non-daemon `recv` threads**. So an in-process demo script (`loop_run.py`, and thus `make loop-run` / `make loop-run-docker` / `skeleton-run`-family, which use a `TestClient(app)` that triggers DBOS launch+recovery) **finishes its run + prints `ALL LOOP-RAN ASSERTIONS PASSED` and then HANGS at interpreter shutdown** on `t.join()` of those parked threads (the visible symptom is the script "running forever" with a flood of `dbos.notifications` polling logs). **This is NOT a bug in whatever feature is under test** (auto-approve means the *current* run never parks — the parked threads are all old non-auto-approve runs). **Fix = a dev-DB reset** (the run history is throwaway greeting tests — safe to wipe): `docker compose down -v` → `make db-up` → `make migrate`. After the reset, both loop targets ran clean AND exited (`DBOS successfully shut down`). **If a fresh session's first loop/skeleton run hangs at exit, this is why — reset the dev DB.** §15 now flags a `clear-parked-runs` utility and/or a daemon/preemptible gate `recv` as the real fix.
- **`_PUSH_SCAFFOLDING_DIRS` (`docker_runtime.py`) deliberately SHADOWS the adapter's `_SERVER_SCAFFOLDING_DIRS`** — they list the same server-scaffolding store names from two angles (the push enumeration + the pull exclusion). **If a future SDK/tool adds another server store, extend BOTH sets together** or the loop will round-trip scaffolding. (Folded into the §15 "separate the Agent Server's event stores" item.)
- **KNOWN ISSUE — never-reached nodes read "Failed" on a failed run** (logged §15; it's 5c step 5). When a run fails at the PM (a transient live-LLM/key error, NOT a Tvashtr bug), `deriveNodeStatus`'s `if (failed) return "failed"` paints "Failed" onto the never-reached Engineer/Reviewer too. The fix is FE-only + tiny (an `idle` node on a failed/terminal run must read idle/stopped, not failed). Pre-existing (P1.5a logic).
- **A PM reading "Done" after a cancel-at-gate is CORRECT, not a bug** — the gate only appears *because* the PM step closed `done`; done is sticky; the card reflects step-completion, not PRD quality or run success. (Don't "fix" it.)
- **The budget nudge band is narrow** (fires only 80–100% of the cap; the PM is much cheaper than the Engineer, and small dollar figures round to `$0.0000` on screen). For any future UI nudge demo, binary-search `DEFAULT_RUN_BUDGET_USD` against the drawer's High (over-budget blocker, cap too low) vs Low (the nudge) vs no-budget-item (cap too high) signal. `~0.0015` hit it.
- **`make *-demo` / the loop targets are HEADLESS CLI** — they don't surface anything in the UI drawer. UI behavior must be exercised by an actual UI run (`make backend` + the dev frontend).
- **Pre-existing lint nit (noted, not fixed):** `scripts/loop_run.py` carries ~3 ruff errors invisible to `make lint` (it scopes to `backend/`; the scripts live in `scripts/`). The §15 "fold `scripts/` into the lint gate" item covers it.
- **Stray screenshots — RESOLVED this session:** the `p15b-*.png` Playwright artifacts at the repo root were accidentally committed by a greedy `git add -A`, then untracked via `git rm --cached` + a `/*.png` `.gitignore` rule (`4f4fa48`). The files remain on disk (untracked); future `git add -A` won't re-add them.
- **Branch hygiene (non-blocking):** the merged `feat/p1.5c-docker-loop-seeding`, `feat/p1.5b-*`, and older `feat/p1.5a-*` branches can be pruned.
- **The forced-revision harness** (`TVASHTR_FORCE_REVISIONS`) + `TVASHTR_AUTO_APPROVE_GATES` are read **inside recorded steps** so verdicts/gate-resolutions replay post-crash — don't move that logic to the workflow body. **Step 2 runs the REAL Reviewer (no `FORCE_REVISIONS`)** for the first time.
- **Docker-default multi-iteration loop now WORKS** (step-1 seeding landed) — the old "docker-default loop only works for a single-iteration feature" caveat is **retired**. A multi-file feature needing >1 iteration now reworks in place on docker.

---

## 8. Deferred register (§15) — for awareness, NOT necessarily this step

*(docker-mode loop seeding is now DONE — removed from this list.)* Newly sharpened: a **`clear-parked-runs` utility and/or a daemon/preemptible gate `recv`** (the stale-parked-runs exit-hang, §7). Still open: **Never-reached node status read "Failed"** (5c step 5); per-node + per-project budgets; **canvas authoring** (J2, Phase-2); parallel branches / true per-branch pause; the **reviewer per-round verdict view** (`AgentInvocation.outcome`-in-graph — 5c step 3); **cyclic-canvas polish to the n8n bar** + the two taste calls (5c step 4); the real non-trivial feature + canonical-idea persistence (5c step 2); the **reviewer `completion`→`agent`** upgrade (trigger likely step 2); **frontend lint/format + RTL component tests** (the FE gate is `tsc`+`vitest` only); the `scripts/` lint-scope cleanup; agent-native resume (with the empty-deliverable edge case); exact spend-accounting across crashes; short-circuit the proxy budget-429 retry-backoff; pin the agent-server image to a digest; relocate the Agent Server's event stores out of the deliverable workspace; per-run sandbox-mode observability + per-run container targeting; WebSocket upgrade for live updates (currently ~2s polling); model catalog/picker UI; CRDT for concurrent doc editing.

---

## 9. First action for Tvashtr-17

Read `HANDOVER.md` + `PROJECTPLAN.md` (esp. the §17 P1.5 design entries + the two Tvashtr-16 entries + the §15 deferred register), then **open the design of P1.5c step 2 — the real non-trivial multi-file feature + canonical-idea persistence (the M1 capstone)** — surfacing the two design calls (§2: *WHICH* feature; *HOW* the idea is persisted) one vision-grounded question at a time and deciding directly, after confirming on disk what carries the "idea" today (`team_run.py` / `teams.py` / `models.py` / the `POST /api/runs` path). This is the first run of the **REAL Reviewer** (no `FORCE_REVISIONS`) and where the loop-level seeding proof becomes inherent; it runs on the docker-default substrate. Once designed, write its self-contained Claude Code prompt to `prompts/`, the operator runs it, the architect audits disk + the operator's real end-to-end docker run is acceptance, then merge — and update the living docs at the close.

**Heads-up if anything hangs:** if the first `make loop-run` / `loop-run-docker` / `skeleton-*` of the session floods `dbos.notifications` logs and won't exit, it's the stale-parked-runs hang (§7) — `docker compose down -v` → `make db-up` → `make migrate` clears it.
