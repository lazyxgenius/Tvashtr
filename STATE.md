# STATE — M-rails C8 (first guardrail gate: `secret_leak_scan`)

Branch: `feat/m-rails-c8-secret-gate`, REBASED onto `main` @ `226c4b5` (the parallel M-unify **U3**
edits-surface, FF-merged). Linear history; U3 + C8 coexist green (re-verified below).
Zero migration (rides the existing `agent_nodes.config` JSONB). Alembic head unchanged at `0024`.

## Current Milestone
M-rails — first guardrail gate-nodes (C8), first slice: the `secret_leak_scan` guardrail.

## What shipped (this slice)
1. **Guardrail execution (backend).** New `backend/tvashtr/control_plane/guardrails.py` — a pure
   `secret_leak_scan(workspace) -> (outcome, reasons)` (curated high-signal patterns: private-key /
   AWS / OpenAI `sk-` / GitHub / Slack / Google / Bearer / a placeholder-filtered generic labelled
   secret; redacts to file+pattern, never the value) + `GUARDRAIL_GATE_KINDS` + a recorded
   `@DBOS.step guardrail_gate_step` (replays on crash-resume). Imports neither litellm nor openhands.
   `run_graph`'s GATE ARM (`elif kind == "gate"`) now branches on `cfg.gate_kind`: a guardrail kind
   runs the deterministic step + routes via the existing `next_node`; absent/`gate_approval` keeps
   the human `wait_at_gate` path (byte-identical, moved into the `else`).
2. **Configurable gate (backend + FE).** `routers.py` `update_team_node` lifts the guard FOR GATES
   (gate config `gate_kind`/`title`/`description` PATCHable, merged into a fresh dict; terminal still
   409; agent needs prompt/model → 422). `api.ts` adds a NEW `updateGateNode` fn (updateTeamNode
   UNCHANGED). `TeamNodePanel.tsx` gate branch → editable: a "Gate type" picker (Human approval |
   Secret leak scan) + title/description + a dirty-aware Save (preserves the human sub-kind).
   Closes the §15 "gate panel won't open / gate copy not editable" deferral.
3. **Credential invariant (backend + tests).** `test_credential_invariant.py` locks per-owner
   request-time key resolution (`_owner_api_key` + `resolve_owner_api_key`): the key resolves for a
   run, a keyless owner is refused (no `.env`/cross-account), and the key never appears in a node row
   nor the compiled instruction (`compile_context`). The C7 MCP-secret ${NAME}-broker posture is
   locked too (also covered in full by `test_mcp_tools.py`).

## Files
- NEW: `backend/tvashtr/control_plane/guardrails.py`, `backend/tests/test_guardrails.py`,
  `backend/tests/test_credential_invariant.py`, `frontend/e2e/secret-gate.spec.ts`,
  `scripts/secret_gate_e2e.sh`.
- EDIT: `backend/tvashtr/control_plane/team_run.py` (import + gate arm only),
  `backend/tvashtr/routers.py` (`UpdateTeamNodeRequest` + `update_team_node`),
  `frontend/src/lib/api.ts` (+`updateGateNode`), `frontend/src/panel/TeamNodePanel.tsx` (gate branch),
  `Makefile` (+`secret-gate-e2e`), and re-pointed tests
  (`test_team_library.py`, `test_topology_crud.py`, `TeamNodePanel.test.tsx`, `App.test.tsx`).

## Rebase reconciliation (onto U3 @ 226c4b5)
- U3 independently made the Vite proxy target env-driven — with `TVASHTR_API_PROXY_TARGET`. Per the
  operator, I DROPPED my `TVASHTR_BACKEND_ORIGIN` and adopted U3's var: `vite.config.ts` is now
  byte-identical to main, and `scripts/secret_gate_e2e.sh` exports `TVASHTR_API_PROXY_TARGET` (→ :8001).
- `TeamNodePanel.tsx` / `api.ts` / `TeamNodePanel.test.tsx` auto-merged cleanly: U3's agent-branch
  Edits toggle + `updateTeamNode(editsAllowed)` + `edits_allowed` type, AND my editable gate branch +
  `updateGateNode`, coexist. `Makefile` `.PHONY` merged to keep BOTH `edits-toggle-e2e` (U3, :8002/:5175)
  and `secret-gate-e2e` (C8, :8001/:5174).

## Evidence (re-verified on the rebased tree)
- `make test` → **471 passed, 1 warning in 22.60s** (floor 454; = U3's 455 + the C8 guardrail/credential tests).
- `make test-frontend` (vitest) → **280 passed (280)** (floor 275).
- `make build-frontend` → clean (`✓ built`, tsc-strict + vite).
- `make lint` → clean (`All checks passed!` ruff + `All matched files use Prettier code style!`).
- Routing proven offline (`tests/test_guardrails.py`): a `secret_leak_scan` gate → `rejected` over a
  planted-secret workspace (stop terminal, `wait_at_gate` NOT called) and → `approved` over a clean
  one (ship terminal). Reproduce-first: neutralizing the guardrail branch turns the routing test RED.
- e2e `make secret-gate-e2e` (backend :8001 + Vite :5174) → **SECRET-GATE E2E PASSED** — CHECK 1/2/3
  (gate renders → drawer editable → flipped to secret_leak_scan + persisted). Screenshots:
  `/tmp/tvashtr_secret_gate_shots/check{1,2,3}-*.png`.

## Invariants held
- Zero migration: `uv run alembic heads` = single `0024_agent_node_edits_allowed (head)`; no new
  versions file (git status on `backend/alembic/versions/` empty).
- Executor: change confined to `run_graph`'s gate arm + one import; agent arm / `agent_run_step` /
  `engines/*` untouched; `team_run` + `guardrails` openhands-free at import.
- `updateTeamNode` unchanged (only `updateGateNode` added); `TeamNodePanel` change confined to the
  gate branch; the human gate path byte-identical for absent/`gate_approval`; crash-resume
  determinism holds (verdict is a recorded step).

## Test Count
471 backend pytest + 280 vitest — 2026-07-10 (rebased onto U3 @ 226c4b5).

READY_TO_MERGE: branch=feat/m-rails-c8-secret-gate, rebased base=226c4b5 (main, U3), tests=471 backend / 280 vitest, lint clean, build clean, e2e PASSED, alembic head 0024 (no migration). Operator FF-merges the branch tip.
