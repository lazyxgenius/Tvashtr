# HANDOVER → Tvashtr-25

> Structured snapshot for the next architect chat. Read this, then **PROJECTPLAN.md §1 + §13–§17**.
> The §17 log + this doc are the source of truth re-fed each session.

---

## 1. Where we are — FE-infra SHIPPED, P1.7 COMPLETE, clean boundary

`main` @ the **docs(tvashtr-24) closeout** — the FE-infra merge **`d707e82`** + the docs-only closeout commits (PROJECTPLAN.md + this HANDOVER + the `prompts/CLI-RULES.md` refresh [§4.6 + §7 + invariants/DoD] + the `prompts/fe-infra-eslint-prettier-rtl.md` brief; **no code**). alembic head **`0011`** (no migration since `0011`). **177 offline tests, 85 vitest (was 76 → +9 RTL), ruff clean** (the gate now covers `backend/` **+ `scripts/`** + the FE eslint/prettier). No branch in flight (FE-infra's `feat/fe-infra-eslint-prettier-rtl` was FF-merged and deleted).

**The FE-infra sweep is done (Tvashtr-24):** the frontend quality gate now matches the backend bar — an ESLint **type-checked** flat config + Prettier (`printWidth 100`) + a render-neutral whole-`frontend/` reformat + a **genuinely protective RTL suite (+9)** (the keystone `<App/>`-under-`<StrictMode>` poll-lifecycle test, the `TeamCanvas` rework-edge guard, `TasksDrawer`, `SidePanel`) on a jsdom env, plus `make test-frontend`/`build-frontend` and `make lint`/`fmt` extended to FE + `scripts/`. FE + `Makefile` + `scripts/` only — the FF diff-stat confirmed **zero `backend/tvashtr/**` or `backend/alembic/**`**; fully offline-verifiable (no live target).

**P1.7 (the living-document steering surface — J3) remains shipped end-to-end** (P1.7a backend re-source `4f5cf04` + P1.7b human-editable TipTap editor `3e62c8c`, proven live by `make steering-e2e`).

**No first action required** — the docs are finalized this session. Confirm state on disk and pick up **P1.8** (§2).

---

## 2. The next milestone — P1.8 Supervisor-first onboarding (R2)

The §13 "value-proven" path's remaining half. **This is the clear next major value milestone** (the fork that used to sit here — FE-infra vs P1.8 — is resolved: FE-infra shipped Tvashtr-24). Scope it with the operator, **one design question at a time** (architect decides each call directly from the §1/§2/§4 vision — no menu-to-ratify).

**What P1.8 is (R2, from the §17 Tvashtr-17 strategic re-aim):** a real **intake** — "describe idea → proposed team → adjust" (+ a "decide for me" path + free text) — that becomes the **primary** entry point, **demoting blank-canvas team authoring to a power-user affordance**. The Supervisor scopes the idea and **emits team-graph rows the generic executor already runs** (the cyclic walk from P1.5 is unchanged — P1.8 is about *how the graph gets authored*, not a new execution path). This is the painkiller-adjacent move: most users should not face a blank canvas.

**Open design calls to resolve just-in-time (don't pre-solve):**
- **Q5 — per-node model selection / the deferred model catalog-picker.** When the Supervisor proposes a team, each node needs a model; today that's hardcoded/env. Decide whether P1.8's first slice exposes per-node model choice (and whether to build the deferred model catalog-picker) or defers it.
- **Scope/slicing.** P1.8 is likely **multi-milestone** (intake UI + the Supervisor's graph-emission + the adjust loop). Size the first `/goal` to ONE bounded, transcript-verifiable slice (the same discipline that kept §14 and P1.7 clean) — don't bundle "all of P1.8."
- **Backend seam check.** Does emitting a Supervisor-authored graph need a migration or an executor change, or is it pure graph-construction over the existing `agent_nodes`/`Edge` schema (head `0011`)? If there's a migration+executor seam, **isolate it into its own milestone** (the risk-seam discipline — `protect-migrations.sh` freezes `0001`–`0011`, so a new migration is a deliberate, audited act).

**Forward note:** P1.8's heavier FE now lands **under the gate the FE-infra milestone stood up** — new components should ship with ESLint/Prettier compliance and protective RTL coverage from the start (the keystone + the canvas tests are the templates).

**CLI-RULES refreshed (Tvashtr-24):** `prompts/CLI-RULES.md` §7 (the milestone sequence) was fully refreshed to current state — position = P1.8 next, with P1.5c/§14/P1.7/FE-infra marked done — plus the load-bearing invariants/DoD (migration-freeze `0001`–`0011`, never-regress floors 177 backend / 85 vitest, the co-located FE-test location + the `make test-frontend`/`build-frontend` gate). It's accurate for P1.8 as-is; the per-milestone brief still supersedes §7 for its own run.

**The standing value gate (unchanged):** the Wizard-of-Oz demand probe (≥1 non-founder user, Mv) remains the real test of whether any of this matters. n=1 (the founder) is still the only validation — worth re-raising. P1.8 makes the product *demoable to a non-founder* (no blank canvas), which is arguably the enabler for that probe.

---

## 3. What's done (the spine, condensed — full history in §17)

Phase 0 closed. **Phase 1:** P1.1 HitL + P1.2 cost caps + P1.3 Docker sandbox (default `docker`, two-layer containment) + P1.4 LiteLLM-proxy spend chokepoint + **P1.5 the cyclic PM→Engineer⇄Reviewer review loop** (5a executor + crash-resume, 5b gates/terminals-as-nodes + the Tasks-for-Human drawer, 5c the real agent-Reviewer capstone — **M1 proven**) + **§14 the team A/B attributability instrument** (14.1 verdict view → 14.2 pair/launch + migration `0010`/`0011` → 14.3 comparison view) + **P1.7 live-document steering** (J3, backend + FE) + **the FE-infra sweep** (ESLint/Prettier/RTL/scripts-in-ruff — Tvashtr-24). Execution is the **Claude Code CLI `/goal` loop under bypass**, guarded by `.claude/` hooks (no-push + migration-freeze survive bypass).

**Still ahead in Phase 1:** P1.6 (WebSocket transport, deferrable), **P1.8 (Supervisor-first — next)**, P1.9 (GitHub greenfield + PR). Phase 2 = the composability vitamin.

---

## 4. The execution contract (unchanged — how every milestone runs)

- **You write ONE lean `/goal`** per milestone (outcome + hard invariants/do-not-touch expressed as checkable evidence + the acceptance checklist + stop conditions). The agent self-decomposes. For a substantial milestone, point the `/goal` at a detailed `prompts/<name>.md` brief (an allowed architect-direct edit) — `prompts/fe-infra-eslint-prettier-rtl.md` and `prompts/p1.7b-steering-editor.md` are the templates.
- **STANDING RULE (emphatic, memory + §17):** every `/goal`'s acceptance MUST have **Claude Code RUN every check itself** — `make test` + `make lint` + the FE gates (`make test-frontend`/`build-frontend`) + **any live targets** — and debug to green BEFORE `READY_TO_MERGE`. Do NOT hand the operator a command list; do NOT defer a live target to a "human gate to run later." The operator runs Claude Code (bypass) + FF-merges; he runs **no** verification commands. The ONLY thing left to him is a genuinely un-automatable act (an aesthetic/visual eyeball). (FE-infra was fully offline-verifiable, so it had **no** operator step at all beyond the FF-merge — that's the ideal when a milestone touches no live LLM/docker path.)
- **You audit on disk** (the main control point): read the changed files; **independently corroborate the FE-only / no-migration invariants** — the `git merge --ff-only` diff-stat is the **authoritative file-set gate** (FF only succeeds on a clean descendant; the merge output names every file — for FE-infra it confirmed zero `backend/tvashtr/**`), and the `copy_file_user_to_claude` + `diff` of the highest-risk backend files vs a pre-branch baseline is the byte-level pattern when you need it (it's how `routers.py`/`team_run.py` were proven byte-identical in P1.7b). **For tests, read them for genuine NON-VACUITY** — don't trust "85 passed"; confirm the assertions actually depend on the behavior (e.g. the FE-infra keystone's "Shipped"/"Done" assertions go RED when the `mountedRef` re-arm is reverted — the agent demonstrated the mutation, and the disk-read confirmed the assertions are real, not static-prop theatre). Confirm the branch is FF-able from the refs/reflog (`.git/refs/heads/*` + `.git/logs/HEAD`). Then the operator FF-merges.
- You can't run git on the operator's machine (Filesystem MCP is file-only) — so doc commits + merges are operator steps you hand over.

---

## 5. Gotchas / environment (read before debugging anything live)

- **TWO distinct model knobs in `.env` (gitignored), each with its own SILENT-failure mode:**
  - **`DEFAULT_MODEL`** = the PM/completion model. **Set to `openai/gpt-4o-mini`.** **GOTCHA (Tvashtr-23):** a *reasoning* model here (it was `openrouter/openai/gpt-oss-20b:free`) intermittently spends its whole token budget on hidden reasoning and returns **EMPTY content** — and the gateway returns **empty-as-success** (no error) → a 0-length PRD, an empty editor, etc. Use a non-reasoning *instruct* model for the PM.
  - **`TVASHTR_AGENT_MODEL`** = the OpenHands agent (Engineer/Reviewer). **Set to `nvidia_nim/meta/llama-3.3-70b-instruct`** (proven; ~1.4s/call). **`nvidia_nim/qwen/qwen3-next-80b-a3b-instruct` is PARKED** — it intermittently (~40%) crashes the OpenHands run with `ConversationRunError: ... TextContent is not JSON serializable` (a slow NVCF-serverless response-shape/serialization flake, NOT auth/quota). Needs an SDK fix, not a key change.
- **NEW — two FE-testing gotchas surfaced by FE-infra (Tvashtr-24), important for P1.8's heavier FE:**
  - **`@testing-library/user-event` ⊥ vitest fake timers — they DEADLOCK.** When a test must drive virtual time (e.g. the polling loop in the keystone), use **`fireEvent`** for the click/interaction and reserve `user-event` for tests where interaction *is* the subject and no fake timers are running. The keystone does exactly this (fireEvent for the start-click, fake timers for the poll); the A/B-toggle / TasksDrawer tests use user-event.
  - **React Flow renders ZERO nodes under jsdom unless shimmed.** `frontend/src/test/setup.ts` provides the required shims (`ResizeObserver`, `DOMMatrixReadOnly`, `offsetHeight`/`offsetWidth`, `getBBox`) — React Flow measures the DOM and jsdom implements none of these, so without them the canvas mounts but lays out nothing and a canvas RTL test sees no nodes/edges. **Any new canvas-level RTL test relies on `setup.ts`** (it's the global vitest setup). Extend the shims there if a new React Flow feature measures something else.
- **The FE gate now (post-FE-infra):** `make test-frontend` = vitest (jsdom, **no DB** — kept separate from `make test` which needs Postgres); `make build-frontend` = `tsc --noEmit` (strict) + `vite build`; `make lint`/`fmt` cover backend+scripts ruff **and** FE eslint (`--max-warnings 0`) + prettier. **ESLint runs the type-checked tier** (`recommendedTypeChecked`) so new **async** code is checked for `no-floating-promises`/`no-misused-promises` — a floated promise in the polling/fetch code now fails lint. **`reportUnusedDisableDirectives: error`** — a stale `eslint-disable` (one that no longer suppresses anything) FAILS lint, so disables can't rot; the single live one is in `TeamCanvas.tsx` (exhaustive-deps, narrowed + `-- reason:`'d — the intentional dep omission that preserves dragged node positions). **`tsconfig.json` now includes `e2e/`** so `tsc` type-checks the Playwright spec too (a hardening; `vite build` still bundles only the app).
- **The live target `make steering-e2e`** (P1.7b): a Playwright E2E driving the REAL stack (LOCAL sandbox, NO auto-approve, real NIM agent, backend+Vite orchestrated by `scripts/steering_e2e.sh`). Needs **`NVIDIA_BUILD_API_KEY`** + Postgres (skips cleanly without the key; does NOT need Docker — LOCAL sandbox). Installs chromium idempotently. ~7min. `frontend/vite.config.ts` scopes vitest to `src/**` so the `frontend/e2e/*.spec.ts` spec isn't collected as a unit test.
- **Branch-naming watch:** P1.7b's branch came out mangled (`feat/p1ring-editor` for the intended `feat/p1.7b-steering-editor`); FE-infra's came out correct (`feat/fe-infra-eslint-prettier-rtl`). Cosmetic — FF-merges fine — but **name the branch explicitly in the `/goal` and verify the ref** before merge.
- **The PM/Engineer split for the J3 sentinel:** the Engineer instruction is purely PRD-driven (no embedded idea), so a human PRD edit deterministically wins — the basis of the `steering-e2e` sentinel. (Relevant if P1.8 touches how the idea/PRD seed the team.)

---

## 6. Key decisions + rationale (FE-infra, this session) + a carried flag

- **Type-checked ESLint tier, not plain `recommended`** (the harder, more valuable choice — the whole point is `no-floating-promises`/`no-misused-promises` on the polling code). `projectService` resolves the TS project automatically; root config files drop to `disableTypeChecked` (they don't belong to a TS project).
- **RTL bar = "genuinely protective, NON-VACUOUS," not a token keystone+2** — corrected UP after the operator's "are you deciding on the vision and not shying from work?" steer. Cover the surfaces where FE bugs have actually hidden from `tsc`+pure-unit (the keystone freeze class, the latent P1.5b rework-edge bug, the drawer handlers, the verdict render); **never gold-plate trivial static-prop render**. The keystone is mutation-proven (RED on the `mountedRef` revert).
- **Separate ESLint + Prettier runners** (NOT `eslint-plugin-prettier`) — ESLint owns correctness, Prettier owns formatting, `eslint-config-prettier` applied LAST so they never fight.
- **The whole-`frontend/` reformat is isolated in its own commit** (`0bc3571`) — so the render-neutral diff is auditable in isolation, separate from the logic-bearing ESLint fixes (the same isolation discipline as the verdict-reasons seam).
- **`scripts/` folded INTO the ruff gate** (not deferred) — it was a hole in the *backend* bar itself, closed here (`make lint`/`fmt` now run `ruff check/format . ../scripts`).
- **CLI-RULES fully refreshed (Tvashtr-24):** `prompts/CLI-RULES.md` is now current end-to-end — §4.6 (the NIM-is-proven agent path, corrected mid-session) + §7 (the full milestone-sequence rewrite: position = P1.8 next; P1.5c/§14/P1.7/FE-infra done) + the load-bearing invariants/DoD (migration-freeze `0001`–`0011`, never-regress floors 177 backend / 85 vitest, the co-located FE-test location + the `make test-frontend`/`build-frontend` gate) + §5's model-agnostic hard-stop. Each `/goal`'s brief still supersedes §7 for its own run.

---

## 7. First-message for Tvashtr-25

> You are Tvashtr-25. Read HANDOVER.md, then PROJECTPLAN.md §1 + §13–§17, at the project root first (Filesystem MCP; `list_allowed_directories` first). Confirm state on disk: `main` @ the docs(tvashtr-24) closeout (= the FE-infra merge `d707e82` + one docs-only commit), alembic head `0011`, **177 offline / 85 vitest**, ruff clean (now covering `scripts/` + FE), no branch in flight. **P1.7 is COMPLETE and the FE-infra sweep is DONE** (ESLint type-checked + Prettier + a protective RTL suite + `scripts/`-in-ruff). The next milestone is **P1.8 — Supervisor-first onboarding (R2):** a real "describe idea → proposed team → adjust" intake that demotes blank-canvas authoring to a power-user affordance, the Supervisor emitting team-graph rows the existing executor already runs. Scope it with me **one design question at a time** (you decide each call directly): start by sizing the FIRST bounded slice (P1.8 is likely multi-milestone), resolve the open **Q5** (per-node model selection / the deferred model catalog-picker) just-in-time, and check whether the Supervisor's graph-emission needs a migration+executor seam (if so, isolate it — `protect-migrations.sh` freezes `0001`–`0011`). New FE lands under the gate FE-infra stood up; mind the two new FE-testing gotchas (HANDOVER §5: user-event ⊥ fake timers → use `fireEvent`; React Flow needs the `src/test/setup.ts` jsdom shims). Per the standing rule, every `/goal`'s acceptance must have Claude Code RUN `make test` + `make lint` + the FE gates + any live target itself and debug to green before `READY_TO_MERGE` — the operator runs no verification commands. Don't start work until you've read both docs.
