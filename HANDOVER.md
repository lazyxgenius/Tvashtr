# HANDOVER → Tvashtr-24

> Structured snapshot for the next architect chat. Read this, then **PROJECTPLAN.md §1 + §13–§17**.
> The §17 log + this doc are the source of truth re-fed each session.

---

## 1. Where we are — P1.7 COMPLETE, clean boundary

`main` @ the **docs(tvashtr-23) closeout** — i.e. P1.7b's merge `3e62c8c` **+ one docs-only commit** (PROJECTPLAN.md + this HANDOVER; no code). alembic head **`0011`** (no migration since `0011`). **177 offline tests, 76 vitest, ruff clean.** No branch in flight (P1.7b's `feat/p1ring-editor` was FF-merged and deleted).

**P1.7 (the living-document steering surface — J3) is shipped end-to-end:** P1.7a (backend, `4f5cf04`) re-sources the latest PRD `DocumentVersion` at every agent-node entry via the recorded `read_latest_prd_step`; P1.7b (FE, `3e62c8c`) makes the in-flight PRD human-editable through a TipTap editor → Save → a new `created_by:"human"` version the agents read on their next round. Proven live through the real UI by `make steering-e2e` (a human rewrites the PRD at the PRD gate; the agent ships the edit, not the PM's original).

**No first action required** — the docs are finalized this session. Just confirm state on disk and pick up the next milestone (§4).

---

## 2. The decision for Tvashtr-24 — which milestone next (settle with the operator first)

Two candidates are teed up (per the §17 P1.7b entry's NEXT). **Make the call with the operator before any `/goal`:**

- **(A) FE-infra sweep — ESLint + Prettier + RTL, its own `/goal`.** The standing §15 debt ("Frontend lint/format + component (RTL) tests"). Deliberately deferred OUT of P1.7b so a whole-codebase Prettier reformat + the wave of ESLint findings wouldn't bury the feature's diff (the verdict-reasons isolation discipline). **Quick, low-risk, and the editor code is fresh** — sensible to do first so P1.7b's code is in the first sweep. NOT user value, just codebase hygiene.
- **(B) P1.8 — Supervisor-first onboarding (R2).** The OTHER half of the §13 "value-proven" path: a real intake ("describe idea → proposed team → adjust") that demotes blank-canvas authoring to a power-user affordance; the Supervisor emits team-graph rows the generic executor already runs. **Higher value** (on the painkiller/value path), bigger scope (likely multi-milestone), and has an open design call (Q5 — per-node model selection / the deferred model catalog-picker).

**My lean:** do **(A) first** — it's a fast, low-risk hygiene pass that sweeps the just-shipped editor code, then go to **(B)** as the next major value milestone. But the operator owns direction; surface both and let them choose.

**The standing value gate (unchanged):** the Wizard-of-Oz demand probe (≥1 non-founder user, Mv) remains the real test of whether any of this matters. Worth re-raising periodically — n=1 (the founder) is still the only validation.

---

## 3. What's done (the spine, condensed — full history in §17)

Phase 0 closed. **Phase 1:** P1.1 HitL + P1.2 cost caps + P1.3 Docker sandbox (default `docker`, two-layer containment) + P1.4 LiteLLM-proxy spend chokepoint + **P1.5 the cyclic PM→Engineer⇄Reviewer review loop** (5a executor + crash-resume, 5b gates/terminals-as-nodes + the Tasks-for-Human drawer, 5c the real agent-Reviewer capstone — **M1 proven**) + **§14 the team A/B attributability instrument** (14.1 verdict view → 14.2 pair/launch + migration `0010`/`0011` → 14.3 comparison view) + **P1.7 live-document steering** (this milestone). Execution is the **Claude Code CLI `/goal` loop under bypass**, guarded by `.claude/` hooks (no-push + migration-freeze survive bypass).

**Still ahead in Phase 1:** P1.6 (WebSocket transport, deferrable), P1.8 (Supervisor-first), P1.9 (GitHub greenfield + PR). Phase 2 = the composability vitamin.

---

## 4. The execution contract (unchanged — how every milestone runs)

- **You write ONE lean `/goal`** per milestone (outcome + hard invariants/do-not-touch expressed as checkable evidence + the acceptance checklist + stop conditions). The agent self-decomposes. For a substantial milestone, point the `/goal` at a detailed `prompts/<name>.md` brief (an allowed architect-direct edit) — see `prompts/p1.7b-steering-editor.md` as the template.
- **STANDING RULE (emphatic, memory + §17):** every `/goal`'s acceptance MUST have **Claude Code RUN every check itself** — `make test` + `make lint` + the FE gates + **the live targets** — and debug to green BEFORE `READY_TO_MERGE`. Do NOT hand the operator a command list; do NOT defer a live target to a "human gate to run later." The operator runs Claude Code (bypass) + FF-merges; he runs **no** verification commands. The ONLY thing left to him is a genuinely un-automatable act (an aesthetic/visual eyeball).
- **You audit on disk** (the main control point): read the changed files; **independently corroborate the FE-only / no-migration invariants** (the `copy_file_user_to_claude` + `diff` of the highest-risk backend files vs a pre-branch baseline is the authoritative pattern — it caught nothing-wrong but is how I proved `routers.py`/`team_run.py` byte-identical in P1.7b); confirm the branch is FF-able from the refs/reflog; check tests are genuinely non-vacuous and assertions real. Then the operator FF-merges.
- You can't run git on the operator's machine (Filesystem MCP is file-only) — so doc commits + merges are operator steps you hand over.

---

## 5. Gotchas / environment (read before debugging anything live)

- **TWO distinct model knobs in `.env` (gitignored), each with its own SILENT-failure mode:**
  - **`DEFAULT_MODEL`** = the PM/completion model. **Set to `openai/gpt-4o-mini`.** **GOTCHA (new, Tvashtr-23):** a *reasoning* model here (it was `openrouter/openai/gpt-oss-20b:free`) intermittently spends its whole token budget on hidden reasoning and returns **EMPTY content** — and the gateway returns **empty-as-success** (no error) → a 0-length PRD, an empty editor, etc. Use a non-reasoning *instruct* model for the PM. (Parallels the qwen3 agent flake below.)
  - **`TVASHTR_AGENT_MODEL`** = the OpenHands agent (Engineer/Reviewer). **Set to `nvidia_nim/meta/llama-3.3-70b-instruct`** (proven; ~1.4s/call). **`nvidia_nim/qwen/qwen3-next-80b-a3b-instruct` is PARKED** — it intermittently (~40%) crashes the OpenHands run with `ConversationRunError: ... TextContent is not JSON serializable` (a slow NVCF-serverless response-shape/serialization flake, NOT auth/quota). Needs an SDK fix, not a key change.
- **The new live target — `make steering-e2e`** (P1.7b): a Playwright E2E driving the REAL stack (LOCAL sandbox, NO auto-approve, real NIM agent, backend+Vite orchestrated by `scripts/steering_e2e.sh`). Needs **`NVIDIA_BUILD_API_KEY`** + Postgres (it skips cleanly without the key; does NOT need Docker — LOCAL sandbox). It installs chromium idempotently. ~7min.
- **Playwright is now a FE dep**; `frontend/vite.config.ts` scopes vitest to `src/**` so the `frontend/e2e/*.spec.ts` Playwright spec isn't collected as a unit test. The `frontend/e2e/` + `scripts/steering_e2e.sh` + `make steering-e2e` are the live-J3 gate's home.
- **Branch-naming:** P1.7b's branch came out as `feat/p1ring-editor` (the agent mangled the intended `feat/p1.7b-steering-editor`). Cosmetic — FF-merges fine, delete after. Watch for this; consider naming the branch explicitly in the `/goal` and verifying the ref.
- **`make` help text drift:** `loop-feature-docker`'s help still says "Gemini agent model" (stale; it's the `.env` model now). Minor; a candidate cleanup for the FE-infra or any docs pass.
- **The PM/Engineer split for the J3 sentinel:** the Engineer instruction is purely PRD-driven (no embedded idea), so a human PRD edit deterministically wins — the basis of the `steering-e2e` sentinel (rewrite the spec → the agent ships the rewrite).

---

## 6. Key decisions + rationale (P1.7, this session)

- **TipTap is locked** (Q2/§8) — not re-opened. The editor edits the **latest** version only; older/terminal are read-only. **Explicit dirty-aware Save, no autosave** (every Save a deliberate version; the source-of-truth thesis wants deliberate steering).
- **The "lock" is steering state, not a lock** — the soft-lock is a registered §15 deferral (only the PM writes the PRD, so a human edit can't collide with an agent write; a lock badge would imply impossible contention). Editing is gated on **run-in-flight** (`isPrdEditable`, reusing the poll-stop's terminal sets — one source of truth); copy is honestly "the agents read it on their next round," never "now."
- **Round-trip fidelity is ENFORCED, not trusted** — a non-vacuous vitest test shares the editor's own extensions and asserts the fenced block + deliverable line + heading + bullets survive verbatim (`linkify`/`html` off close the real hazards). A no-op load-then-save can't silently mutate the spec.
- **The live J3 gate is Claude-Code-run** (the standing rule) — `make steering-e2e` drives the edit through the REAL editor and asserts the **shipped** file == the human's SENTINEL (∧ ≠ the PM's original), reading off the ship tag, with a guard against false-passing on a failed run. The only operator act was the aesthetic eyeball.
- **ESLint/Prettier/RTL deferred** to their own FE-infra `/goal` — a whole-codebase tooling sweep would bury a feature diff (the verdict-reasons isolation discipline). It's option (A) in §2.

---

## 7. First-message for Tvashtr-24

> You are Tvashtr-24. Read HANDOVER.md, then PROJECTPLAN.md §1 + §13–§17, at the project root first (Filesystem MCP; `list_allowed_directories` first). Confirm state on disk: `main` @ the docs(tvashtr-23) closeout (= P1.7b merge `3e62c8c` + one docs-only commit), alembic head `0011`, 177 offline / 76 vitest, ruff clean, no branch in flight. **P1.7 is COMPLETE.** First, settle the next-milestone call with me (HANDOVER §2): **(A)** the FE-infra sweep (ESLint + Prettier + RTL, its own `/goal` — the architect leans this first, it's quick and sweeps the fresh P1.7b code) or **(B)** P1.8 Supervisor-first onboarding (the higher-value R2 milestone). Then scope it, one design question at a time. Per the standing rule, every `/goal`'s acceptance must have Claude Code RUN `make test` + `make lint` + the FE gates + any live target itself and debug to green before `READY_TO_MERGE` — the operator runs no verification commands. Don't start work until you've read both docs.
