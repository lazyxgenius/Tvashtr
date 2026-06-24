# Brief — FE-infra sweep: ESLint + Prettier + RTL (+ scripts into the ruff gate)

> Milestone: **FE-infra** (the standing §15 debt: "Frontend lint/format + component (RTL) tests").
> Architect: Tvashtr-24. This brief is the authoritative spec; the `/goal` points at it.
> **This SUPERSEDES the CLI-RULES §7 milestone sequence for this run** (that section still
> describes the finished P1.5c session). Follow this brief.

---

## 0. Ground truth (verify on disk; do not trust stale docs)

- **Root:** `/Users/adimac/Desktop/Tvashtr`.
- **Backend:** Python 3.12, `uv`, pytest. `make test` = **177 passing** right now. alembic head **`0011`**.
- **Frontend:** React **19**, Vite **7**, TypeScript **5.6**, vitest **3**, npm. `npm run build` =
  `tsc --noEmit && vite build`. `npm test` = `vitest run` = **76 passing** right now.
- **No ESLint, no Prettier** anywhere (no config, no binary). `jsdom@^25` IS already a devDep; the
  `@testing-library/*` packages are NOT. `frontend/vite.config.ts`'s `test` block has only
  `include: ["src/**/*.{test,spec}.{ts,tsx}"]` — **no `environment`, no `setupFiles`, no `globals`.**
- **FE test convention is co-located** `*.test.ts(x)` next to the module (e.g. `src/lib/status.test.ts`),
  NOT a `__tests__/` dir. Put new RTL tests co-located next to the component they cover.
- **FE source inventory** (the ESLint + reformat scope):
  - `src/App.tsx`, `src/main.tsx`
  - `src/lib/`: `api.ts`, `status.ts`, `events.ts`, `abCompare.ts`, `prdEditor.ts` (+ their `.test.ts`)
  - `src/canvas/`: `AgentNodeCard.tsx`, `CanvasEmpty.tsx`, `ReworkEdge.tsx`, `TeamCanvas.tsx`
  - `src/components/`: `ABCompare.tsx`, `BackendDot.tsx`, `CancelRunButton.tsx`, `RunBanner.tsx`, `StatusPill.tsx`, `TasksDrawer.tsx`
  - `src/panel/`: `EventFeed.tsx`, `PrdView.tsx`, `SidePanel.tsx`
  - CSS: `index.css`, `canvas.css`, `panel.css`, `abcompare.css`
  - config: `vite.config.ts`, `tsconfig.json`, `playwright.config.ts`, `package.json`
  - `e2e/`: the steering E2E `*.spec.ts` (Playwright — run by `make steering-e2e`, NOT vitest;
    `vite.config.ts` scopes the unit glob to `src/`).
- **Makefile:** `make lint` = `cd backend && uv run ruff check . && uv run ruff format --check .`;
  `make fmt` = the autofix twin; `make test` = `cd backend && uv run pytest` (needs `make db-up`
  + `make migrate` first). **There is NO FE target in the Makefile.** The `loop-feature-docker`
  `##` help text still says "Uses the Gemini agent model from .env" — STALE (the proven model is
  NIM via `.env`); fix that help line.
- **`scripts/` is outside the ruff gate** (`make lint` scopes ruff to `backend/`). `scripts/loop_run.py`
  is known to carry ruff errors (~3, noted Tvashtr-14) that the current gate never sees.

---

## 1. Outcome (the one thing this milestone delivers)

A frontend quality gate that **matches the backend bar** — ESLint (type-checked) + Prettier wired
and enforced, the whole `frontend/` reformatted, a **genuinely protective** React Testing Library
suite over the surfaces where FE bugs have actually hidden from `tsc` + the pure-unit tests, all
folded into `make` targets — **and** `scripts/` brought under the ruff gate (closing the other half
of "make lint covers the whole repo"). Born now, on the smallest-the-FE-will-ever-be codebase, so
P1.8's heavy FE lands under the gate instead of on top of un-linted code.

---

## 2. Locked design decisions (implement THESE — they are the architect's calls, not yours to re-open)

### 2.1 Scope & boundary
- **IN:** ESLint flat config + Prettier + the whole-codebase `frontend/` reformat + the RTL stand-up
  (deps + jsdom env + the suite in §2.3) + the FE `make` targets + **folding `scripts/` into the ruff
  gate** (and fixing the resulting findings to green) + the one stale `loop-feature-docker` Makefile
  help line (Gemini → NIM-via-`.env`).
- **OUT:** nothing else. No backend product change. No Prettier reach beyond `frontend/` (do NOT
  reformat repo markdown / `PROJECTPLAN.md` / `prompts/`).

### 2.2 The lint/format stack
- **ESLint** — flat config (`frontend/eslint.config.js`, ESM): `@eslint/js` recommended +
  **`typescript-eslint` TYPE-CHECKED** (the `projectService` form, so it picks up `tsconfig.json`
  automatically) + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` + `eslint-config-prettier`
  **last** (turns off every formatting rule so ESLint and Prettier never fight). The point of the
  type-checked tier is `no-floating-promises` / `no-misused-promises` — they catch real async bugs
  in the polling code and the Playwright awaits; do NOT downgrade to the plain non-type-checked tier.
  - Lint `src/**` and `e2e/**` at the type-checked tier; the root `*.config.{ts,js}` files drop to the
    non-type-checked tier (`tseslint.configs.disableTypeChecked` for that glob) so they don't need to
    be in a TS project. Ignore `dist/`, `node_modules/`, `coverage/`, `test-results/`, `playwright-report/`.
  - **`react-hooks`: rules-of-hooks = error, exhaustive-deps = error.** This is the rule that would
    have caught the missing-dep class behind the StrictMode freeze.
  - **`react-refresh/only-export-components`: warn**, BUT the gate runs `eslint . --max-warnings 0`
    so warnings cannot linger silently. Resolve co-export warnings by splitting the constant into its
    own module, or a scoped disable where the co-export is intentional.
  - **`reportUnusedDisableDirectives: error`** (in the flat config's `linterOptions`). Every existing
    `eslint-disable` is then either suppressing a real finding or suppressing nothing — see §2.4.
- **Prettier** — `frontend/prettier.config.js` (or `.prettierrc.json`), Prettier-3 defaults
  (double quotes, semicolons, 2-space, `trailingComma: "all"`) with **`printWidth: 100`**. Scope =
  `frontend/**` (ts/tsx/css/html/json/md within frontend if any). Add a `.prettierignore`
  (`dist`, `node_modules`, `package-lock.json`, `test-results`, `playwright-report`, `coverage`).
- **Integration** — separate runners + `eslint-config-prettier`. Do **NOT** use `eslint-plugin-prettier`
  (running Prettier as a lint rule is slower/noisier). ESLint owns correctness; Prettier owns formatting.
- **npm scripts** (in `frontend/package.json`): `"lint": "eslint . --max-warnings 0"`,
  `"lint:fix": "eslint . --fix"`, `"format": "prettier --write ."`, `"format:check": "prettier --check ."`.
- **The reformat is the deliverable and is expected to be a LARGE diff** — that's fine: it is
  render-neutral (Prettier reflows whitespace/quotes/wrapping, never semantics) and is audited as its
  own clean seam. Do not try to shrink it by hand.

### 2.3 RTL — a protective suite, not a token keystone (this is the part to NOT under-scope)
- **Deps:** add `@testing-library/react` + `@testing-library/jest-dom` + `@testing-library/user-event`
  (jsdom is already present). **Verify the installed `@testing-library/react` line supports React 19**
  (v16+); if peer-dep friction, resolve it — that's a known-solvable thing, NOT a `NEEDS_HUMAN`.
- **vitest config** (`frontend/vite.config.ts`): add `environment: "jsdom"` (global — the pure-fn tests
  don't touch the DOM, so a global jsdom env is harmless for them and avoids per-file docblocks),
  `globals: true` (so jest-dom matchers + RTL's auto-cleanup register without per-file boilerplate; the
  existing explicit `from "vitest"` imports keep working — `globals` is additive), and
  `setupFiles: ["src/test/setup.ts"]` where `setup.ts` imports `@testing-library/jest-dom/vitest`.
- **Interactions go through `user-event`** (the realistic event sequence), not `fireEvent`.
- **Required coverage** — RTL across every surface where a real bug has hidden from `tsc` + pure-unit.
  Read each target component on disk first and wire exact selectors/mocks to it (verify-don't-assume).
  You may merge/split test files sensibly, but ALL of these bug-classes must be covered, and EACH test
  must be **non-vacuous (provable by mutation — see the bar below)**:
  1. **KEYSTONE — `App.tsx` poll-lifecycle under `<React.StrictMode>`.** Render the real `<App/>` inside
     `<StrictMode>`; stub `fetch` (`vi.stubGlobal`) to return a valid sequence (read `App.tsx` +
     `lib/api.ts` for the exact URLs/shapes: the `POST /api/runs` → run id, `GET /api/runs/{id}/graph`
     → nodes+edges, `GET /api/runs/{id}` → `running` then a terminal status, `GET /api/runs/{id}/tasks`
     → `[]`); drive the poll (~1800ms — read the exact interval) with `vi.useFakeTimers()` wired to
     user-event's `advanceTimers`. Assert (a) the canvas renders the **polled** graph nodes, NOT frozen
     on the empty/`CanvasEmpty` state (the P1.1b `mountedRef`-freeze class — passed tsc+vitest+headless,
     only the live eyeball caught it); (b) polling **stops** once the run reaches a terminal status (no
     further fetches). This single test pays for the whole RTL stand-up.
  2. **Canvas status pipeline → DOM.** Render the canvas/node surface with backend-shaped graph payloads
     exercising `deriveNodeStatus` / `deriveGateState` / `deriveTerminalState`, asserting the derived
     state actually reaches the rendered node/gate/terminal — AND that **only** `when==="changes_requested"`
     edges render as the `ReworkEdge` (the latent "any conditional edge → rework arc" bug fixed in P1.5b;
     guard it). Read `TeamCanvas.tsx` to target the edge-styling/`pickHandles` decision precisely.
  3. **`TasksDrawer`.** (a) empty → renders nothing (`return null`); (b) blockers + nudges → High section
     above Low, Approve/Reject on blockers, Dismiss on nudges; clicking each calls the right handler
     (resolve / acknowledge) — spy props + `user-event`.
  4. **`SidePanel` / ReviewerView.** Render the Reviewer panel with an invocations list (rounds carrying
     `outcome` + `outcome_detail`) → the per-round verdict labels render in iteration order, the reasons
     show under `changes_requested` rounds and NOT under `approved` (guards the §14.1/§14.3 verdict render).
  5. **Single-run ↔ A/B mode toggle** (`App.tsx`, state-only). Toggle to "A/B compare" → the `ABCompare`
     surface mounts and the single-run tree is replaced; toggling back restores it losslessly.
- **The bar (anti-gold-plating, made checkable):** every RTL test must be **non-vacuous — provable by
  mutation**: reverting the relevant logic (the mountedRef guard, the rework-edge predicate, the
  drawer's empty-null/High-Low split, the terminal-set poll-stop) must make the corresponding test go
  RED. **No snapshot tests. Do NOT test static-prop render that `tsc` already guarantees** (that's the
  freeze-list trap). Cover the bug-classes above and nothing gratuitous.

### 2.4 Existing `eslint-disable` comments + the findings wave
- These are currently editor-only/unenforced; once ESLint runs they become live.
- **Resolve every ESLint finding by FIXING the code, not by silencing it.** A `disable` is allowed only
  **narrowly** — single-rule, single-line or single-block, with a `// reason:` comment — where the rule
  genuinely does not apply (e.g. a poll effect that intentionally omits a dep). Blanket file-level or
  multi-rule disables are NOT acceptable.
- With `reportUnusedDisableDirectives: error`, any pre-existing disable that suppresses nothing must be
  **removed**. Report the disposition of every pre-existing disable (narrowed+reasoned vs removed-as-dead).

### 2.5 `scripts/` into the ruff gate
- Extend the backend ruff invocation to also cover `scripts/` (e.g. `ruff check . ../scripts` from
  `backend/`, and the same for `ruff format`). Fix the resulting findings to green.
- **`scripts/` changes are ruff SAFE-autofix + format ONLY** — they are live drivers (`loop_run.py` is
  used by `loop-run`/`loop-crash`/`loop-feature-docker`), so **no logic edits.** If ruff flags something
  not safely auto-fixable, make the minimal behavior-preserving edit (remove a genuinely-unused import;
  a scoped `# noqa: <code> — reason` only if removal isn't safe) and **report exactly what changed in
  each script** so the architect can confirm neutrality. Do NOT alter script control flow to satisfy a lint.

### 2.6 Make wiring
- **`make lint`** → backend ruff-check **incl. `scripts/`** + `cd frontend && npm run lint` +
  `cd frontend && npm run format:check`. (No DB needed — this is the single repo-wide lint gate;
  any sub-check failing must make the target exit non-zero.)
- **`make fmt`** → the autofix twin: backend ruff format+fix incl. `scripts/` + `npm run lint:fix` +
  `npm run format`.
- **`make test-frontend`** (NEW) → `cd frontend && npm test` (no DB; kept separate from `make test`,
  which needs Postgres — folding FE vitest behind the DB would be wrong).
- **`make build-frontend`** (NEW) → `cd frontend && npm run build` (the tsc-strict + vite gate).
- Update `.PHONY` + the `help`-grep targets; fix the `loop-feature-docker` `##` help (Gemini → NIM).

---

## 3. Invariants / do-not-touch (checkable evidence)

- **FE + `Makefile` + `scripts/` only.** `git diff main --stat` must show changes ONLY under
  `frontend/**`, `Makefile`, and `scripts/**`. **NOTHING under `backend/tvashtr/**` or
  `backend/alembic/**`.** Echo the diff-stat as the proof.
- **No migration.** alembic head stays **`0011`** (`cd backend && uv run alembic heads` confirms).
- **Backend `make test` stays 177** (unchanged count is itself the no-backend-regression proof).
- **Do NOT touch** `PROJECTPLAN.md`, `HANDOVER.md`, `CLI-RULES.md` (the architect owns these). You
  DO maintain `STATE.md` (your running log) per the normal protocol.
- **The Prettier reformat must be render-neutral** — no visible UI change. (It reflows formatting, not
  semantics; if any rendered output would change, that's a bug to investigate, not accept.)
- **No live target.** There is NO LLM / Docker / agent gate for this milestone — do **NOT** run
  `loop-*`, `skeleton-*`, `agent-smoke`, `steering-e2e`, or any live target (the backend is untouched
  by construction; re-running them burns NIM credits for zero risk-reduction). The offline backend
  `make test` is the sufficient backend-untouched proof.

---

## 4. Acceptance / evidence (RUN every check yourself, debug to green, echo the decisive line — the operator runs NOTHING)

Per the standing rule: the `/goal` evaluator reads only the transcript, so echo each decisive line.

1. `make test` → backend **177 passing, unchanged**. (Run `make db-up` + `make migrate` first.)
   Echo the `=== N passed in Xs ===` line.
2. `make lint` → whole-repo clean: backend ruff incl. `scripts/` (the known `scripts/loop_run.py`
   errors FIXED to green), FE ESLint at `--max-warnings 0`, FE Prettier `--check` reporting **zero**
   files needing formatting (the reformat is complete + idempotent). Echo the final result line.
3. `make test-frontend` → vitest: the existing **76 + the new RTL tests**, all green. Echo the new total.
4. `make build-frontend` → `tsc --noEmit` + `vite build` clean (the reformat/config broke neither types
   nor the build). Echo the success.
5. **Keystone non-vacuity — DEMONSTRATE it:** reintroduce the StrictMode freeze (revert the App
   mount-effect's `mountedRef.current = true`) → the keystone RTL test goes **RED** → restore → green.
   Echo both the red and the restored-green result. (Do the same mutation check mentally/locally for
   the other RTL tests; you need only demonstrate the keystone's red-on-mutation in the transcript.)
6. **Do-not-touch evidence:** echo `git diff main --stat` (only `frontend/**`, `Makefile`, `scripts/**`;
   nothing under `backend/tvashtr/**` or `backend/alembic/**`) and `cd backend && uv run alembic heads`
   (still `0011`).
7. **Findings report** (in `STATE.md` + echoed): the count/nature of ESLint findings fixed; the
   disposition of EVERY pre-existing `eslint-disable` (narrowed+reasoned vs removed-as-dead); exactly
   what changed in each touched `scripts/` file (ruff safe-autofix vs any minimal manual edit) and a
   one-line confirmation it is behavior-preserving.
8. **Branch `feat/fe-infra-eslint-prettier-rtl`** — verify the ref name matches exactly (the P1.7b
   branch-name-mangling lesson: `git rev-parse --abbrev-ref HEAD`). Commit per logical unit
   (conventional commits). Write a `READY_TO_MERGE: branch=feat/fe-infra-eslint-prettier-rtl,
   sha=<sha>, backend_tests=177, frontend_tests=<N>` line to `STATE.md` and echo it.

**No operator visual smoke is required** — this `/goal` is fully offline-verifiable (dev-only tooling +
a render-neutral reformat). State that in your final report.

---

## 5. Stop conditions
- `NEEDS_HUMAN: <reason>` to `STATE.md` + stop on a genuine external blocker (e.g. an RTL test that
  cannot be made to pass against React 19 / vitest 3 after ≥3 genuinely-distinct strategies — escalate,
  do NOT thrash, and do NOT delete/weaken the test to make it pass; a weakened test is worse than none).
- A hard turn cap (per the loop's circuit breaker).
- Do NOT silence ESLint findings with blanket disables or make RTL tests vacuous to reach green — that
  defeats the entire milestone.

---

## 6. Report-back (what the architect audits on disk against this brief)
- Every file changed (the `git diff main --stat`), grouped: the ESLint/Prettier config + the reformat;
  the RTL deps + vitest config + setup + the test files; the Makefile + npm scripts; the `scripts/` ruff fixes.
- Each acceptance command WITH its decisive output line (§4).
- The findings report (§4.7).
- Any deviation from this brief, with rationale.
- Suggested next step (expected: P1.8 — Supervisor-first onboarding).
