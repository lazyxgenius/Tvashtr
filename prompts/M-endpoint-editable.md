# M-endpoint-editable — the Ship↔Stop endpoint becomes editable after it's dropped

> Architect brief for ONE bounded milestone. The `/goal` points here; this file is the detail.
> Read this FULLY before writing any code. Written for Tvashtr-64. Base: `main` @ `f824ce3`,
> alembic head `0027`, floors **645 backend / 363 vitest**.

---

## 1. Outcome (the one thing this milestone delivers)

**A terminal (endpoint) node dropped on the team canvas can be flipped between Ship and Stop
after the fact, without deleting it — and the flip persists, re-renders, keeps its wired edges,
and changes what the next run actually does.**

Today the terminal is the LAST thing on the canvas that is not editable. The config drawer shows a
DISABLED Ship/Stop indicator and this apology:

> "Changing ship ↔ stop is a planned backend follow-on — to switch it, delete this endpoint and
> drop the other from the palette."

Deleting the endpoint silently destroys every edge wired into it. That is an authoring dead-end in
exactly the place the product's differentiator lives (`PROJECTPLAN.md` §1 — *"the team is mine"*;
the Tvashtr-25 pivot — *identity follows the editable field, not a hardcoded role*). This milestone
closes it. It is the second half of the §15 register item **"Gate/terminal post-drop config
editing"** — the GATE half already shipped as M-rails C8; the TERMINAL half is this.

**This is a NIM/DeepSeek-free, provider-key-free, ZERO-migration milestone.** If you find yourself
needing a migration or an LLM key, you have misread the scope — stop and re-read this file.

---

## 2. The ground truth on disk (read these before deciding anything)

| Seam | File | What's there today |
|---|---|---|
| The 409 wall | `backend/tvashtr/routers.py` → `update_team_node` | `if node.kind == "terminal": raise HTTPException(409, "terminal nodes are control primitives — no config to edit here")` |
| The pattern to follow | `backend/tvashtr/routers.py` → the `if node.kind == "gate":` branch (immediately below the 409) | Merges provided fields into a **FRESH** `cfg = dict(node.config or {})` then `node.config = cfg` |
| The request model | `backend/tvashtr/routers.py` → `UpdateTeamNodeRequest` | Carries `gate_kind` / `title` / `description` / `forbidden_paths` / `output_file` / `output_schema` / `memory_remember_enabled` |
| Where a terminal is BORN | `backend/tvashtr/routers.py` → `create_team_node`, the terminal arm | `role_name=body.terminal_kind, kind="terminal", config={"terminal_kind": body.terminal_kind}` |
| Who READS terminal_kind | `backend/tvashtr/control_plane/team_run.py` → the `elif kind == "terminal":` arm | `if cfg.get("terminal_kind") == "ship":` → ship + finalize `completed`; else finalize `rejected` + "stopped" |
| Who reads terminal `role_name` | `backend/tvashtr/routers.py` → the trajectory/ledger join (`select(AgentInvocation, AgentNode.role_name, AgentNode.kind)`) | Reports the node's `role_name` per invocation row |
| Graph validity | `backend/tvashtr/control_plane/graph_validity.py` | Only cares about `kind == "terminal"`. **Ship vs stop is irrelevant to validity.** Do not touch this file. |
| The FE drawer | `frontend/src/panel/TeamNodePanel.tsx` → the `if (node.kind === "terminal")` branch | READ-ONLY: `<button disabled>` ×2 + a `tv-readonly-note`. The GATE branch above it is the working template (dirty check → `handleGateSave` → `updateGateNode`). |
| The FE api | `frontend/src/lib/api.ts` → `updateGateNode` | The exact shape to mirror. `TerminalConfig` = `{ terminal_kind: "ship" \| "stop" }` already exists. |
| The canvas card | `frontend/src/canvas/AgentNodeCard.tsx` → `TerminalCard` | Already reads `cfg.terminal_kind` (`ship` → `Package` glyph + "Ship"; else `OctagonX` + "Stop"). It should need NO change — **verify that, don't assume it**. |
| The live-gate template | `scripts/secret_gate_e2e.sh` + `frontend/e2e/secret-gate.spec.ts` + the `secret-gate-e2e` Makefile target | The near-identical GATE version of this milestone's e2e. Mirror its orchestration (isolated ports backend `:8001`, Vite `:5174` via `TVASHTR_API_PROXY_TARGET`; register a fresh account; screenshot per check). |

---

## 3. The design decision (RATIFIED by the architect — implement it, do not re-litigate it)

**`config["terminal_kind"]` is the SINGLE source of truth, and `role_name` is SYNCED to it on every
flip**, so a flipped endpoint is byte-identical to a freshly-dropped one of the same kind.

**Why (this is the trap — read it twice).** Gates were easy: a gate's `role_name` is the constant
`"gate"`, so the gate branch never had to think about it. **A terminal's `role_name` IS its kind** —
`create_team_node` sets `role_name=body.terminal_kind`. If you copy the gate branch and flip only
the config, you leave `role_name="ship"` on a node whose `config.terminal_kind` is now `"stop"`. The
canvas will LOOK right (the card reads config), your tests will pass — and the **trajectory ledger
will name that endpoint "ship" forever**, because it joins on `role_name`. That is a silent lie in
the per-node legibility surface, which is the product's headline differentiator. Sync it.

**Out of scope — do NOT build these** (they are deliberate exclusions, not oversights):
- No gate-style `title`/`description` fields on a terminal.
- No "this team has no Ship endpoint" warning or any new graph-validity rule.
- No change to `create_team_node`, to the executor's terminal arm, or to `graph_validity.py`.
- No migration. No new column. `terminal_kind` already lives in the existing `agent_nodes.config` JSONB.

---

## 4. The UX consequence (what the user sees — build to THIS)

The user drops a **Ship** endpoint and wires the Reviewer's "approved" edge into it. Later they
decide this team should stop for a human instead of shipping.

1. They click the endpoint card on the canvas. The config drawer opens, titled **Ship**.
2. The **Endpoint** control is now **LIVE** (today both buttons are `disabled`). The apologetic
   `tv-readonly-note` about deleting and re-dropping is **GONE**.
3. They click **Stop**. The **Save** button enables and **"Unsaved changes"** appears — exactly like
   the gate branch and the agent branch.
4. They hit **Save** → **"Saved — this drives the next run you launch."**
5. The drawer header flips **Ship → Stop**. The hint line under the control flips to the Stop copy.
6. On the canvas the card's `Package` glyph becomes the `OctagonX` and its label "Ship" becomes
   "Stop" — **with every edge they wired into it still attached.**
7. Reload the page: it is still Stop.
8. The next run that walks into that endpoint finalizes `rejected`/stopped instead of shipping.

Keep the drawer's existing look, classes, and copy conventions (`tv-seg`, `tv-seg__btn--active`,
`tv-field__hint`, `tv-prd__editbar`, `tv-prd__dirty`, `tv-prd__saved`, `tv-prd__saveerr`). This is
an ENABLE of an existing disabled control, not a redesign.

---

## 5. Shape of the work (you self-decompose; this is the expected surface)

- `backend/tvashtr/routers.py` — `UpdateTeamNodeRequest` gains `terminal_kind: Literal["ship","stop"] | None = None`; the `node.kind == "terminal"` **409 is replaced by a terminal branch** that (a) merges `terminal_kind` into a **FRESH** `cfg = dict(node.config or {})` (a new object, so SQLAlchemy flags the JSONB column dirty — an in-place mutation does NOT persist), (b) syncs `node.role_name`, (c) is guarded by `model_fields_set` so an omitted field leaves config byte-unchanged, (d) `session.flush()` + `return _node_base_dict(node)`. A terminal PATCH that sends no `terminal_kind` should not silently fall through into the agent branch — decide the honest status code and test it.
- `frontend/src/lib/api.ts` — an `updateTerminalNode(teamId, nodeId, terminalKind)` mirroring `updateGateNode` (same endpoint, same error-throw shape, returns `TeamGraphNode`).
- `frontend/src/panel/TeamNodePanel.tsx` — the terminal branch gets local state seeded from `node.config`, a dirty check, an enabled `tv-seg`, and a Save bar. Drop the `tv-readonly-note`. The `key={selectedNodeId}` remount is still the reset — don't add your own.
- Tests — `backend/tests/` (pytest) + `frontend/src/panel/TeamNodePanel.test.tsx` + `frontend/src/lib/api.test.ts` (vitest).
- `frontend/e2e/endpoint-edit.spec.ts` + `scripts/endpoint_edit_e2e.sh` + a `endpoint-edit-e2e` Makefile target — mirroring the `secret-gate-e2e` trio. **Edit the Makefile SURGICALLY** (recipes are TAB-indented; never rewrite the file) and add the target name to the existing `.PHONY` line.

---

## 6. Tests must BITE (mutation-real — this is audited)

A test that passes on the pre-change code is worthless to me. Specifically:

- **Persistence is proven by RE-READING the persisted `AgentNode.config` row from the DB** — not the
  PATCH response echo. (The response echo passes even when the JSONB was mutated in place and never
  saved. That is the exact bug this rule exists to catch.)
- At least one test **FAILS on the current `main`** — e.g. the PATCH returning 409 today.
- **`role_name` coherence is asserted**: after a ship→stop flip, `node.role_name == "stop"` AND
  `node.config["terminal_kind"] == "stop"` — and the flipped node matches a freshly-dropped Stop node.
- **The behavioural consequence is proven**, not assumed: a test showing the executor's terminal arm
  follows the edited value (a run reaching a flipped-to-stop endpoint finalizes `rejected`, not
  `completed`). Use the existing offline/forced-revisions harness — **no LLM key**. If you genuinely
  cannot reach this offline, say so plainly in the FINAL REPORT rather than faking it.
- **The edges survive** the flip (assert the endpoint's in-edges are unchanged after the PATCH).

---

## 7. Invariants — expressed as evidence you must produce

Each of these must appear in the transcript with its PROOF, not a claim:

1. **No migration.** `cd backend && uv run alembic heads` still prints `0027`. `git diff main --stat -- backend/alembic/` is EMPTY.
2. **The executor is untouched.** `git diff main -- backend/tvashtr/control_plane/team_run.py` is EMPTY.
3. **Graph validity is untouched.** `git diff main -- backend/tvashtr/control_plane/graph_validity.py` is EMPTY.
4. **The agent + gate PATCH paths still behave identically** — the existing pytest + vitest suites covering them pass unchanged, and you did not restructure those branches.
5. **Nothing is pushed. `main` is never committed to, merged, or rebased.** You work on `feat/m-endpoint-editable` only. The operator fast-forward-merges.
6. **You commit ONLY your own changed paths.** NEVER `git add -A`, `git add .`, or `git commit -a`. These untracked paths are the ARCHITECT'S and must stay untracked — sweeping any of them into your commit is a FAILURE of this milestone:
   - `DEEPDIVE-context-and-long-running-agents.md`
   - `Making Small Models Go the Distance.md`
   - `NVIDIA's Long-Running Agent Stack.md`
   - `design/`
   - `prompts/M-memory-S5a-shelf.md`
   - `prompts/M-memory-S5b-views.md`
   - `prompts/M-endpoint-editable.md` (this file)

---

## 8. Acceptance — YOU run every one of these and debug to green

Do NOT hand the operator a list of commands. Run them yourself, fix what fails, re-run, and **echo
the decisive line of each into the chat verbatim**:

- [ ] `make db-up && make migrate` — then `cd backend && uv run alembic heads` → echo it (expect `0027`).
- [ ] `make test` → echo the final `=== N passed in Xs ===` line. **N ≥ 646** (floor 645 + your new tests). Never regresses.
- [ ] `make test-frontend` → echo the vitest summary. **≥ 364** (floor 363 + yours).
- [ ] `make build-frontend` → echo the result (tsc strict + vite build).
- [ ] `make lint` → echo the result line. Clean.
- [ ] `make endpoint-edit-e2e` → echo its final status line + the screenshot paths. Needs NO provider key. Every §4 step above is a check with its own screenshot.
- [ ] The four §7 git/diff proofs, echoed verbatim.
- [ ] `STATE.md` updated + a `READY_TO_MERGE: branch=feat/m-endpoint-editable, sha=<sha>, tests=<N>` line, echoed.
- [ ] The `=== FINAL REPORT ===` block per `prompts/CLI-RULES.md` §4.7 — all eight sections.

---

## 9. Stop conditions

- Write `NEEDS_HUMAN: <exact reason>` to `STATE.md` and stop on: a genuinely missing secret; a
  confirmed third-party outage; ≥3 distinct fix strategies exhausted on the SAME failure with no
  progress; **or a second/unknown problem that would need a broad or unproven change** to fix.
- A **code-proven, contained, regression-guarded** fix to a SINGLE identified cause may proceed.
- Hard cap: **60 turns**. If you hit it, stop and write the FINAL REPORT with what's done.
- A recorded `NEEDS_HUMAN` **with** the FINAL REPORT is a complete, valid terminal — not a failure
  to grind against. Do not re-emit the report if re-prompted after it.
