# Tvashtr loop state

- **Brief:** `prompts/P1.2-cost-caps-budget-enforcement.md`
- **Branch:** `feat/p1.2-cost-caps`
- **Escalation mode:** `halt`
- **Live targets in-loop:** NOT authorized (offline gates only)
- **Last checkpoint:** 2026-06-16 (all gates green; review fixed 1 blocking demo-script bug; docs drafted; committing)

## Units

| # | Unit | State |
|---|------|-------|
| 1 | Branch + loop-state + Postgres up | done |
| 2 | Backend: config (`default_run_budget_usd`, `default_max_tokens_per_call`) | done |
| 3 | Backend: `Run` model fields + status docstring (`over_budget`) | done |
| 4 | Backend: migration `0007` (budget_cap_usd, budget_overridden) | done |
| 5 | Backend: `metering.running_cost` + lift `finalize_run_step` query | done |
| 6 | Backend: `control_plane/budget.py` (check + override steps) | done |
| 7 | Backend: `team_run` enforce-budget checkpoints + over_budget finalize | done |
| 8 | Backend: gateway `default_max_tokens_per_call` | done |
| 9 | Backend: routers `POST /api/runs` cap + terminal set | done |
| 10 | Backend tests: `test_budget.py` + gateway max_tokens test | done |
| 11 | Demo: `scripts/budget_demo.sh` + `make budget-demo` (BUILD only) | done |
| 12 | Offline gate: `make test` (41 pass) + `make lint` clean | done |
| 13 | Frontend: `status.ts` + `api.ts` | done |
| 14 | Frontend tests: `status.test.ts` over_budget cases | done |
| 15 | Frontend gate: `npm run build` + `npm test` (37 pass) green | done |
| 16 | Migration `0007` round-trip (upgrade / autogen-empty / downgrade) | done |
| 17 | Browser functional gate (over_budget banner + Stopped node, mocked) | done |
| 18 | Independent review pass → zero blocking (1 demo-script bug fixed) | done |
| 19 | Deferred items + doc drafts (§15/§17) | done |
| 20 | Commit on branch (un-merged) | in-progress |

## Notes
- Design is locked (DP-A–D). No one-way-door deviations expected; halt if any arise.
- `default_run_budget_usd` defaults to `None` (opt-in) — preserves existing live targets (skeleton-run/hitl-demo post no cap).
- Browser over_budget view uses route-mocking (zero spend, no agent); aesthetic sign-off is the operator's.
