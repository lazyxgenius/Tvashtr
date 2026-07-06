# Tvashtr — Autonomous Execution State

## Current Milestone
**M-tools C7.B — Skills** (the Skills half of the C7.A‖C7.B parallel batch). Branch
`feat/m-tools-c7b-skills` off `main` @ `ce14b96`. Brief: `prompts/M-tools-C7.B-skills.md`.

## OUTCOME — C7.B SHIPPED (READY_TO_MERGE)
A node's inline `skills` now work end-to-end through ONE capability-agnostic resolver: inline SKILL.md
(always / trigger / agent modes), a GitHub-repo clone at a pinned ref (+ filter), and adopt-this-repo's
own-rules (incl. the modern `.cursor/rules/*.mdc` the SDK misses). A WORKER gets them via
`AgentContext`; a THINKER gets the SAME resolved skills rendered into its prompt (the thin bridge). A
source that fails to resolve is SKIPPED with a warning emitted through C7.A's recorder via a lazy,
import-guarded shim. A NULL-`skills` node is byte-for-byte inert.

## Last Completed Step
M-tools C7.B — skills resolver + thinker bridge + real SkillsSection + skills-e2e — 2026-07-06 —
branch: feat/m-tools-c7b-skills — commit: (tip; exact sha in the FINAL REPORT).

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/m-tools-c7b-skills, sha=<tip>, tests=411 backend + 226 vitest passing

## The change (files — all within the C7.B ownership list)
- **`backend/tvashtr/control_plane/node_skills.py`** — the real `build_skills` + `inject_skills_into_prompt`
  (signatures UNCHANGED) over ONE private `_resolve_skills`; `_resolve_inline` (3 modes → exact SDK
  `Skill` fields), `_resolve_repo` (`load_public_skills` at the pinned ref + `fnmatch` filter),
  `_resolve_project_rules` (`load_project_skills` + the `.cursor/rules/*.mdc` glue `_load_cursor_rules`/
  `_parse_mdc`), the thinker-bridge render, and the `_emit_skill_warning` shim (lazy import-guarded per
  SHARED CONTRACT S1). Every `openhands.*` import is FUNCTION-LOCAL (INVARIANT 1 held).
- **`backend/tests/test_node_skills.py`** (NEW, 19 tests) — inline 3-modes / repo via a LOCAL git
  fixture (no network) / filter / project_rules incl. the `.mdc` glue proven load-bearing / thinker
  bridge / skip+warn / inertness / the no-module-level-openhands AST check.
- **`frontend/src/lib/api.ts`** — APPENDED only the `SkillSource` union (Inline/Repo/ProjectRules) in its
  own fenced region; `updateTeamNode` / `GraphData` untouched.
- **`frontend/src/panel/SkillsSection.tsx`** — the real editor (new-inline + mode segmented control +
  add-from-repo + use-repo-rules toggle + badged rows + clear→`onChange(null)`), drop-in for the C7.0
  props so `TeamNodePanel.tsx` stays untouched.
- **`frontend/src/lib/api.test.ts`** (+2) and **`frontend/src/panel/SkillsSection.test.tsx`** (rewritten
  3→7) — real-component + type-check coverage.
- **`frontend/src/panel/TeamNodePanel.test.tsx`** — ONE re-pointed assertion (the removed stub label
  `"Skills JSON"` → the real `"Skill name"` control); DOM legitimately changed. NOT the component.
- **`Makefile`** + **`scripts/skills_e2e.py`** (NEW) — the `make skills-e2e` live target.

## Acceptance evidence (this session)
- `make test` → **411 passed** (baseline 392 → 411; +19 new backend tests). Isolated DB `tvashtr_c7b`
  (`DATABASE_URL` override; the `.env` pins the shared `tvashtr`, so `make ... DATABASE_URL=$DATABASE_URL`).
- `make lint` → ruff check "All checks passed!" + ruff format clean + eslint (`--max-warnings 0`) clean +
  prettier clean **for every C7.B file**. The only prettier warnings are `EventFeed.test.tsx` +
  `SidePanel.test.tsx` — PRE-EXISTING debt on `main` (`git diff --name-only main` shows I never touched
  them; HANDOVER §7 / §15), NOT introduced here.
- `cd frontend && npx tsc --noEmit` clean; `npm run build` green (`built in 1.26s`); `npx vitest run` →
  **226 passed (30 files)** (baseline 220 → 226; +6).
- Resolver decisive tests green: inline always/trigger/agent map to `(trigger, is_agentskills_format)`;
  repo loads from a local git fixture at a pinned sha + filter narrows; project_rules reads BOTH
  `CLAUDE.md` (SDK) AND `.cursor/rules/*.mdc` (glue) — with a companion test proving the SDK alone MISSES
  the `.mdc`; the thinker bridge prepends an `always` skill's content and gates a `trigger` skill on a
  match; skip+warn calls `_emit_skill_warning` for an unreachable repo (patched).
- **`make skills-e2e`** (live docker+NIM): the inline `always` skill RESOLVED into a real `Skill` and
  reached the docker `AgentTask` — log line `resolved = 1 skill(s): [('Skill', 'file-marker')]`; the
  container came up and the agent conversation ran (`GET /api/conversations/... 200`). The end-to-end
  marker verdict is **NEEDS_HUMAN (live infra only)**: after the resolver→AgentTask step succeeded, the
  SDK's `RemoteConversation` polling of the agent-server hung on repeated `timed out` warnings for ~12 min
  with no progress (the container answered conversation GETs 200 but the SDK poll timed out — the
  NVCF-serverless/SDK polling wall of CLI-RULES §4.6, an EXTERNAL block, not a C7.B wiring bug). Re-run
  `make skills-e2e` on a healthy NIM window to capture the marker; the 19-test offline resolver suite is
  the standing proof.

## Playwright self-sign-off
Attempted on my Vite `:5174` (operator login 200; `browser_evaluate`-driven per the canvas-hang rail).
The Vite dev proxy hardcodes `/api → :8000`, which the PARALLEL C7.A backend occupies (its `tvashtr_c7a`
DB), and `vite.config.ts` is outside C7.B ownership (can't repoint) — so an isolated live canvas capture
was constrained. The SkillsSection→TeamNodePanel integration for BOTH kinds is proven GREEN by vitest:
`TeamNodePanel.test.tsx` "renders both a Skills and a Tools section … for a worker node" (asserts the
real `Skill name` control) + "… Skills still present" for a thinker. Operator can screenshot trivially:
this branch, Vite 5174, a backend on 8000.

## Invariants held (proof)
- `git diff --name-only main` = ONLY owned files (Makefile, node_skills.py, api.ts, SkillsSection.tsx,
  the tests) + untracked `test_node_skills.py` / `skills_e2e.py`. NO team_run.py / node_tools.py /
  routers.py / ToolsSection.tsx / TeamNodePanel.tsx / adapter / migration.
- `git diff main -- backend/tvashtr/control_plane/team_run.py` = EMPTY.
- `node_skills.py` has NO module-level `openhands` import; every `openhands.*` import is function-local
  (lines 122/153/175/187).
- `build_skills` / `inject_skills_into_prompt` signatures unchanged.
- `resolution_warnings.py` NOT created; NO `run_warnings` table; NO migration (alembic head stays `0021`).
- Existing tests unmodified except the ONE unavoidable `TeamNodePanel.test.tsx` re-point (listed above).

## Deviations from the brief
- **`TeamNodePanel.test.tsx` re-point** (1 assertion): the stub label `"Skills JSON"` no longer exists;
  re-pointed to the real `"Skill name"` control. This is the brief-sanctioned "RE-POINT the tests the
  DOM legitimately changes"; the file is a TEST, not the forbidden component.
- **Test robustness**: resolver tests assert `type(x).__name__` not `isinstance` — parts of the suite
  clear `openhands` from `sys.modules` (registry/review-cap tests), so the class OBJECT differs across
  that reload boundary; the field values are the real assertion. Production has a single import path.
- **`make test` DB override**: `DATABASE_URL=$DATABASE_URL` on the make line (the `.env` include pins the
  shared `tvashtr`; the override keeps me on the isolated `tvashtr_c7b`).

## Test Count
**411 backend pytest** (392 → 411) + **226 vitest** (220 → 226) — 2026-07-06.

## Blocked
NEEDS_HUMAN (the live gate ONLY): `make skills-e2e` — the agent-server `RemoteConversation` poll hung on
repeated `timed out` warnings (~12 min, no progress) — an external NIM/SDK infra wall (CLI-RULES §4.6),
NOT a C7.B bug. The resolver→AgentTask path WAS proven live (`resolved = 1 skill(s): [('Skill',
'file-marker')]`); the 19-test offline resolver suite + the FE suite are the standing proof. Re-run on a
healthy NIM window to capture the end-to-end marker. Everything else — offline + FE — is green.
