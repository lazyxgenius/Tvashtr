# HANDOVER → Tvashtr-26

> Structured snapshot for the next architect chat. Read this, then **PROJECTPLAN.md §1 + §13–§18**.
> The §17 log + this doc are the source of truth re-fed each session.

---

## 1. Where we are — the PIVOT is recorded + the plan made consistent; P1.8a (the backend core) SHIPPED

`main` @ the **docs(tvashtr-25) pivot-audit closeout** — the **P1.8a merge `dc5a984`** + two docs-only closeout commits (`5a6daf7` the P1.8a as-built closeout, then the pivot-consistency-audit commit). alembic head **`0012`** (new this session). **181 offline tests, 85 vitest, ruff clean.** No branch in flight (P1.8a's `feat/p1.8a-prompt-driven-executor` was FF-merged).

**THE ARCHITECTURAL PIVOT (this session) — recorded + propagated.** The operator paused the about-to-open P1.8 (Supervisor-first onboarding) to realign to the founding vision: **NO hardcoded fixed-function role nodes. A fully PROMPT-DRIVEN node model — every agent node is a *blank* AI agent whose entire identity/behavior follows its editable `prompt`; identity always follows the prompt.** Ratified decisions live in the **§17 Tvashtr-25 DECISION entry** (the canonical statement — Q1 node model / Q2 routing / teams-as-templates / the strategic reframe). The **whole PROJECTPLAN was then audited for consistency** with it (§2 Goal 5, §4 J1, §6 banner + layers 3–4 + §6.4, §7 D2, §9 AgentNode + Message, §13 the Supervisor risk + S2, §14 MVP line, §15 Phase-1 amendment + P1.8 bullet, §18 glossary). **One known gap:** the §6.1 component diagram + §6.3 run-loop sequence (mermaid) were **annotated, not redrawn** — the §6 banner declares them historical/superseded; a clean diagram redraw is an optional follow-up.

**P1.8a SHIPPED (the prompt-driven executor core — first slice of the rebuild).** The executor is **de-roled**: `config.agent_kind` no longer appears in any executor path; `run_graph`'s agent branch is ONE generic path — `emits = node_emits_outcome(edges, current)` → `agent_run_step(run_id, node["prompt"], node["model"], n, idea, live_prd, workspace, vkey, reviewer_feedback, emits)` → route `next_node(edges, current, label)`. Migration **`0012`** adds `agent_nodes.prompt` (Text, nullable, additive). The merged `agent_run_step` (`@DBOS.step`) replaces `engineer_run_step` + `reviewer_agent_run_step`; the reviewer loop-back is retopologized to a no-`when` **catch-all** (`approved`→ship, everything else→loop-back — safe-default-to-more-review via topology, not a magic label). `teams.py` seeds PM/ENGINEER/REVIEWER prompts (REVIEWER_PROMPT keeps `python -B -m unittest` + `REVIEW_VERDICT.json` + the `approved`/`changes_requested` labels verbatim). Architect disk-audit zero-blocking; the four live smokes green with NIM. Full as-built = the **Tvashtr-25 §17 AS-BUILT entry**.

**No first action required** — the docs are finalized this session. Confirm state on disk and pick up **P1.8b** (§2).

---

## 2. The next milestone — P1.8b (the FE half of the prompt-driven node-model rebuild)

> **P1.8 is REDEFINED (Tvashtr-25 pivot) → the prompt-driven node-model rebuild, NOT "Supervisor-first onboarding."** That old framing is superseded throughout the plan; the Supervisor survives only as an *optional generator that seeds prompt-driven node templates*, never a runtime node. P1.8a (the backend core) shipped this session; **P1.8b is the frontend/onboarding half.** Likely itself multi-milestone — scope the first `/goal` to ONE bounded, transcript-verifiable slice.

**What P1.8b is:** make the prompt-driven model **usable on the canvas**:
- **Editable node prompts on the canvas** — each agent node's `prompt` (its whole identity/behavior) is viewable + editable in the node panel; per-node **model picker** on the same surface (resolves the long-open **Q5** — per-node model selection / the deferred model catalog-picker).
- **Mid-loop prompt edit** — "the prompt can be altered after one loop." This **reuses P1.7's live-steering pattern**: the executor would re-read the node's `prompt` at each node entry, exactly as `read_latest_prd_step` already re-reads the PRD. (If this needs a backend re-read seam, isolate it — but much of the groundwork is the P1.7a pattern.)
- **Templates drop-and-edit library** — `teams.py`'s PM/Engineer/Reviewer builders are now an **editable template library** (presets of `{prompt, capability, model}` the user drops onto the canvas and edits freely). Surface them as drop-and-edit presets.

**Backend-seam check (do this first):** decide whether P1.8b's first slice is pure FE over the existing `agent_nodes.prompt` (head `0012`) + the existing graph endpoint, or needs a small re-read seam / endpoint. If there's a migration+executor seam, **isolate it** (`protect-migrations.sh` now freezes `0001`–`0012`; a new migration is a deliberate, audited act).

**FE landing zone:** P1.8b's heavier FE lands under the FE-infra gate stood up Tvashtr-24 (ESLint type-checked + Prettier + the protective RTL suite). Mind the two FE-testing gotchas (§5).

**The standing value gate (unchanged):** the Wizard-of-Oz demand probe (≥1 non-founder user, Mv) remains the real test of whether any of this matters — n=1 (the founder) is still the only validation. The prompt-driven model + templates make the product *demoable to a non-founder*, arguably the enabler for that probe.

---

## 3. What's done (the spine, condensed — full history in §17)

Phase 0 closed. **Phase 1:** P1.1 HitL + P1.2 cost caps + P1.3 Docker sandbox (default `docker`, two-layer containment) + P1.4 LiteLLM-proxy spend chokepoint + **P1.5 the cyclic review loop** (5a executor + crash-resume, 5b gates/terminals-as-nodes + the Tasks-for-Human drawer, 5c the real agent-Reviewer capstone — **M1 proven**) + **§14 the team A/B attributability instrument** (14.1 → 14.2 + migrations `0010`/`0011` → 14.3) + **P1.7 live-document steering** (J3, backend + FE) + **the FE-infra sweep** (Tvashtr-24) + **P1.8a the prompt-driven executor core** (Tvashtr-25, migration `0012`, the de-role). Execution is the **Claude Code CLI `/goal` loop under bypass**, guarded by `.claude/` hooks (no-push + migration-freeze survive bypass).

**Still ahead in Phase 1:** **P1.8b (the FE half of the prompt-driven rebuild — next)**, P1.6 (WebSocket transport, deferrable), P1.9 (GitHub greenfield + PR). Phase 2 = the composability vitamin — note the pivot **pulled the Phase-2 composability primitive (blank prompt-driven nodes) down to the foundation**, so Phase-2 is partly already underway.

---

## 4. The execution contract (unchanged — how every milestone runs)

- **You are ARCHITECT/PLANNER ONLY.** Design; write ONE lean `/goal` per milestone (or point it at a detailed `prompts/<name>.md` brief — an allowed architect-direct edit; `prompts/p1.8a-prompt-driven-executor-core.md` + `prompts/p1.7b-steering-editor.md` are templates); audit the result **on disk**; maintain the two living docs. **ALL implementation — product code, diagnostic scripts, AND build/Makefile changes — goes through Claude Code.** The ONLY architect-direct edits: the two living docs, `prompts/*.md` briefs, trivial doc/comment/typo fixes. There is NO "diagnostics are architect-direct" carve-out.
- **STANDING RULE (emphatic):** every `/goal`'s acceptance MUST have **Claude Code RUN every check itself** — `make test` + `make lint` + the FE gates (`make test-frontend`/`build-frontend`) + **any live targets** (smokes) — and debug to green BEFORE `READY_TO_MERGE`. Do NOT hand the operator a command list; do NOT defer a live target to a "human gate to run later." The operator runs Claude Code (bypass) + FF-merges; he runs **no** verification commands.
- **You audit on disk (the real control point) — never trust the agent's self-report.** Read the changed files. The `git merge --ff-only` diff-stat is the **authoritative file-set gate** (FF only succeeds on a clean descendant; the output names every file). The `copy_file_user_to_claude` → bash `grep`/`sed`/`diff` of high-risk files vs a pre-branch baseline is the byte-level pattern. Read tests for **genuine non-vacuity** (don't trust "N passed"; confirm the assertion depends on the behavior — mutation-revert is the proof). Confirm FF-ability from `.git/refs/heads/*` + `.git/logs/HEAD`. **You can't run git on the operator's machine** (Filesystem MCP is file-only) — so doc commits + merges are operator steps you hand over.
- **FF-merge only:** operator fast-forward merges; the agent never pushes to main. Branch-per-step.
- **Bypass mode** (`--dangerously-skip-permissions`): skips the permission *layer*, so allow/deny rules (incl. the `git push` deny) stop working — **only PreToolUse hooks survive**. The no-push guard is already a PreToolUse hook (`protect-no-push.sh`) and the migration freeze (`protect-migrations.sh`) is too. **Update the freeze list: `0001`–`0012` are now the frozen set** (a new migration past `0012` is a deliberate, audited act). Ideally run bypass inside a container/devcontainer (it's a host MacBook Air).

---

## 5. Gotchas / environment (read before debugging anything live)

- **zsh does NOT strip inline `#` comments** in the operator's interactive shell (INTERACTIVE_COMMENTS off). **ALL git command blocks you hand the operator must be COMMENT-FREE** — an inline `# comment` after a command is fed to git/zsh as garbage (`command not found`, `ambiguous argument '#'`, `unknown file attribute`). This bit hard this session. Put any explanation in prose around the block, never inside it.
- **TWO model knobs in `.env` (gitignored), each with its own SILENT-failure mode:**
  - **`DEFAULT_MODEL`** = the PM/completion model. **Set `openai/gpt-4o-mini`.** A *reasoning* model here intermittently spends its whole token budget on hidden reasoning and returns EMPTY content — and the gateway returns empty-as-success → a 0-length PRD. Use a non-reasoning *instruct* model.
  - **`TVASHTR_AGENT_MODEL`** = the OpenHands agent (the prompt-driven worker nodes). **Set `nvidia_nim/meta/llama-3.3-70b-instruct`** (proven; ~1.4s/call). **`nvidia_nim/qwen/qwen3-next-80b-a3b-instruct` is PARKED** — ~40% of runs crash the OpenHands loop with `TextContent is not JSON serializable` (a slow NVCF-serverless serialization flake; needs an SDK fix, not a key change).
- **NIM agent occasionally emits empty output on a forced-revision round** (e.g. an empty `greeting.txt` on `loop-run`) — a known real-agent flake, the same class as the qwen3 / empty-PRD gotchas, **NOT a regression**; passes on retry.
- **Two FE-testing gotchas (Tvashtr-24, for P1.8b's heavier FE):** (1) **`@testing-library/user-event` ⊥ vitest fake timers — they DEADLOCK**; when a test must drive virtual time, use **`fireEvent`** for the interaction. (2) **React Flow renders ZERO nodes under jsdom unless shimmed** — `frontend/src/test/setup.ts` provides the shims (`ResizeObserver`/`DOMMatrixReadOnly`/box-metrics/`getBBox`); any new canvas RTL test relies on it.
- **DBOS stale-PENDING hang:** leftover PENDING runs from prior sessions (parked at gates, never cancelled) resurrect on every in-process backend boot and hold non-daemon `recv` threads → a run can finish but hang at interpreter shutdown. Cleared by a dev-DB reset (`docker compose down -v` → `make db-up` → `make migrate`; run history is throwaway). Or cancel the specific PENDING workflows surgically.
- **Docker Desktop holds a torn-down container's host port ~30s** — ephemeral host ports are the mitigation (already in place).
- **Branch-naming watch:** a couple of branches have come out mangled (`feat/p1ring-editor`). Cosmetic — FF-merges fine — but name the branch explicitly in the `/goal` and verify the ref before merge.
- **MCP can time out (~4 min) on large writes** — retry or restart Claude Desktop recovers without data loss.

---

## 6. Key context for P1.8b + the pivot's as-built facts

**The pivot (the frame for everything):** identity follows the `prompt`. The executor stops branching on `role_name`/`config.agent_kind`; routing is the authored topology (a generic outcome-label any node emits, matched by `Edge.conditions {when:<label>}` via the pure `next_node`); the loop-back catch-all is a no-`when` edge. `teams.py` builders are an editable template library. The canonical record is the **§17 Tvashtr-25 DECISION + AS-BUILT entries**.

**On-disk facts for P1.8b (post-P1.8a):**
- `team_run.py`: `load_graph_step` (node dict now includes `prompt`); pure helpers `next_node`/`escalation_target`/`loop_limit_for`/`node_emits_outcome`; `pm_step(run_id, idea, pm_model, pm_prompt)` `@DBOS.step`; `agent_run_step(run_id, node_prompt, model, iteration, idea, prd_text, workspace, vkey, reviewer_feedback, emits_outcome)` `@DBOS.step` (the merged step); `_forced_review_outcome(iteration)`; `_harvest_verdict` (reads/removes `REVIEW_VERDICT.json`). Env: `TVASHTR_FORCE_REVISIONS`, `TVASHTR_AUTO_APPROVE_GATES`, `TVASHTR_AGENT_SANDBOX` (docker default).
- The smoke scripts look up nodes by `role_name` (so role_name MUST stay pm/engineer/reviewer on the templates), read `AgentInvocation.outcome` (reviewer labels stay approved/changes_requested), and count `CostRecord.idempotency_key LIKE '{run_id}:agent-cost:%'` (the per-node `:{node_id}:{iteration}` suffix keeps the prefix-count passing). loop_crash triggers when `engineer_run_attempts` reaches 2.
- The graph endpoint exposes node `config` + per-node `prompt` (via `load_graph_step`); the canvas already reads the graph. P1.7's `read_latest_prd_step` is the model for mid-loop re-reads.

**Deferred cosmetic cleanup (P1.8b or later):** drop the now-unread `config.agent_kind` (the executor stops reading it; the FE may still); rename `REVIEW_VERDICT.json` → a generic `OUTCOME.json` (it's role-neutral now).

**Other tracked deferrals (§15 register, unchanged):** the §14.3 visual smoke (skipped for velocity); the A/B view has no in-UI cancel for in-flight pairs; `run_event_sink` `seq` collision (observability-only); never-reached nodes read "Failed" on a failed run (`deriveNodeStatus` quirk); agent-server image digest pinning; agent-native resume; the agentic-memory upgrade path (Postgres-now → pgvector-next, Phase-3 brownfield trigger). `prompts/CLI-RULES.md` §7 (the milestone sequence) still describes the finished P1.5c/FE-infra position — flagged for a refresh, NOT silently rewritten (each `/goal`'s brief supersedes §7 for its run).

**MCP / disk patterns:** Filesystem MCP is file-only (no git). For large files (`PROJECTPLAN.md` is ~300KB+): `copy_file_user_to_claude` → `/mnt/user-data/uploads/<basename>` → bash `grep -nE '^#{1,} '` for the header index → `sed -n 'X,Yp'` for sections. `edit_file` always `dryRun: true` first, anchored on unique multi-line strings (the `## 18. Glossary` heading + the preceding `---` is the reliable anchor for §17 appends). `write_file` for full HANDOVER rewrites. Git state without a git tool: read `.git/refs/heads/<branch>` for the SHA, `.git/logs/HEAD` (tail) for FF-ability, `backend/alembic/versions/` to confirm no new migration.

---

## 7. First-message for Tvashtr-26

> You are Tvashtr-26. Read HANDOVER.md, then PROJECTPLAN.md §1 + §13–§18, at the project root first (Filesystem MCP; `list_allowed_directories` first). Confirm state on disk: `main` @ the docs(tvashtr-25) pivot-audit closeout (= the P1.8a merge `dc5a984` + two docs-only closeout commits), alembic head **`0012`**, **181 offline / 85 vitest**, ruff clean, no branch in flight. **The ARCHITECTURAL PIVOT to a fully prompt-driven node model is recorded (the §17 Tvashtr-25 entries) and the whole PROJECTPLAN was audited for consistency with it; P1.8a (the backend executor core — migration `0012` + the de-role + generic topology routing) is SHIPPED.** The next milestone is **P1.8b — the FE half of the prompt-driven rebuild:** editable node prompts on the canvas + a per-node model picker (resolving Q5) + mid-loop prompt edit (reuse P1.7's `read_latest_prd_step` read-latest-before-each-use pattern, applied to the node's `prompt`) + the templates drop-and-edit library (`teams.py`'s builders are now editable presets). It is likely multi-milestone — scope the FIRST `/goal` to ONE bounded, transcript-verifiable slice, and do the backend-seam check first (pure FE over `agent_nodes.prompt` at head `0012`, or a small re-read seam to isolate — `protect-migrations.sh` now freezes `0001`–`0012`). Scope it with me **one design question at a time** (you decide each call directly from the §1 vision; not a menu to ratify). New FE lands under the FE-infra gate; mind the two FE-testing gotchas (HANDOVER §5: user-event ⊥ fake timers → `fireEvent`; React Flow needs the `src/test/setup.ts` jsdom shims) and the zsh-no-inline-comments rule for any git block. Per the standing rule, every `/goal`'s acceptance must have Claude Code RUN `make test` + `make lint` + the FE gates + any live target itself and debug to green before `READY_TO_MERGE`. Don't start work until you've read both docs.
