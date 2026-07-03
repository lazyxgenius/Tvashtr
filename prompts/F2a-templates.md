# F2a — Enrich the starter-team catalog (backend-only, ahead of F2)

**Milestone.** Grow the New-team template catalog from a thin set into a clear ladder of richer
starting teams, so the F2 dashboard picker (built later) offers real depth. **Backend only. NO
migration. NO frontend change.** The picker reads the catalog live from `GET /api/templates`, so
this ships and is verifiable on its own, ahead of F2.

**Why this shape (read once).** `build_thinker_chain_team` is the vehicle for a load-bearing
executor regression (`backend/tests/test_thinker_chain.py` — it drives the REAL `run_team` to prove
the P1.8c generic non-start-thinker dispatch; reverting that executor change turns it RED). So we do
**NOT** mutate `thinker_chain`. Instead we ADD two new templates that reuse only executor paths
already proven by `build_review_loop_team` + `build_thinker_chain_team`, and we drop the thin
`thinker_chain` from the *picker catalog* while keeping its builder byte-intact for that test.

---

## 1. The final catalog

`_TEMPLATE_CATALOG` (in `backend/tvashtr/control_plane/teams.py`) ends as EXACTLY these four, in this
order (simple → rich):

| key | name | description |
|:----|:-----|:------------|
| `two_node` | `PM → Engineer` | *(UNCHANGED)* A PM writes the spec; an Engineer builds and ships it. No review step. |
| `review_loop` | `PM → Engineer ↔ Reviewer` | *(UNCHANGED)* Adds a Reviewer that runs the tests and loops back for fixes until it passes (or the cap trips). |
| `plan_review` | `PM → Architect → Engineer ↔ Reviewer` | **(NEW)** Two thinkers plan it — a PM drafts the spec, an Architect adds the technical design — then a build-and-review loop ships it once the tests pass (or the cap trips). |
| `full_squad` | `Full feature squad` | **(NEW)** The works — a PM and Architect plan the feature, you approve the plan, an Engineer and Reviewer build and test in a loop, then you approve the ship. Two thinkers, two workers, two human checkpoints. |

- **Remove** the `thinker_chain` ENTRY from `_TEMPLATE_CATALOG`. `_TEMPLATES_BY_KEY` derives from the
  catalog, so `create_team_from_template("thinker_chain", …)` then correctly raises `KeyError` → 400.
  This is intended: `thinker_chain` is no longer offered in the picker.
- **KEEP** the `build_thinker_chain_team` FUNCTION exactly as-is (its only caller is the executor
  keystone test, which invokes the builder directly).
- The FE will prepend a `blank` card itself later (`POST /api/teams` already treats `"blank"`
  specially) — do **not** add a `blank` catalog entry here.

---

## 2. The two new builders

Both are constructed by **mirroring `build_review_loop_team`** — same node fields, same gate config
constants, same `Edge(...)` construction. Reuse the existing prompt constants (`PM_PROMPT`,
`ARCHITECT_PROMPT`, `ENGINEER_PROMPT`, `REVIEWER_PROMPT`), `_PRD_GATE_CONFIG`, `engineer_model()`,
`reviewer_model()`, and the default-model helper for the thinkers. **Invent no new prompts.** For
every edge that has an analogue in `build_review_loop_team`, use the SAME `edge_type` + `conditions`
that builder uses for it (read it and copy — e.g. the reviewer→engineer loop-back is
`edge_type="review", conditions={"loop_limit": get_settings().max_review_iterations}`; the
engineer→escalation_gate edge is `edge_type="escalation"`). Node positions: lay them out left-to-right
mirroring `build_review_loop_team`'s spacing — exact coords are your choice (`withLayout` normalizes).

### 2a. `build_plan_review_team` — key `plan_review`
`review_loop` **plus an Architect thinker inserted between the PM and the PRD gate.**

**Nodes (8):** `pm` (completion, PM_PROMPT) · `architect` (completion, ARCHITECT_PROMPT) · `prd_gate`
(gate, `_PRD_GATE_CONFIG`) · `engineer` (agent/openhands, ENGINEER_PROMPT, `config={"agent_kind":"engineer"}`) ·
`reviewer` (agent/openhands, REVIEWER_PROMPT, `config={"agent_kind":"reviewer"}`) · `escalation_gate`
(gate, the SAME `review_escalation` config `build_review_loop_team` uses) · `ship` (terminal
`{"terminal_kind":"ship"}`) · `stop` (terminal `{"terminal_kind":"stop"}`).

**Edges (10):**
1. `pm → architect` — forward
2. `architect → prd_gate` — forward
3. `prd_gate → engineer` — `{"when":"approved"}`
4. `prd_gate → stop` — `{"when":"rejected"}`
5. `engineer → reviewer` — forward
6. `reviewer → engineer` — loop-back (`edge_type="review"`, `{"loop_limit": cap}`)
7. `reviewer → ship` — `{"when":"approved"}`
8. `engineer → escalation_gate` — escalation edge
9. `escalation_gate → ship` — `{"when":"approved"}`
10. `escalation_gate → stop` — `{"when":"rejected"}`

*(This is exactly `build_review_loop_team` with `pm → prd_gate` replaced by `pm → architect → prd_gate`.)*

### 2b. `build_full_squad_team` — key `full_squad`
`plan_review` **plus a ship-approval gate** in front of `ship`, so BOTH ship-bound approvals route
through a second human checkpoint.

**Nodes (9):** the 8 from `plan_review`, **plus** `ship_gate` (kind `gate`,
`config={"gate_kind":"ship_approval", "title":"Approve the ship?", "description":"Approve to ship the reviewed change; reject to stop without shipping."}`).

**Edges (12):** edges 1–6, 8, 10 from `plan_review` unchanged, PLUS:
- `reviewer → ship_gate` — `{"when":"approved"}` *(replaces reviewer → ship)*
- `escalation_gate → ship_gate` — `{"when":"approved"}` *(replaces escalation_gate → ship)*
- `ship_gate → ship` — `{"when":"approved"}`
- `ship_gate → stop` — `{"when":"rejected"}`

Gates are handled generically by the executor (`wait_at_gate`: pause → human approved/rejected →
route on the matching out-edge; no `gate_kind` branch), so `ship_approval` needs zero executor work.

---

## 3. Invariants / do-not-touch (verify on disk)

- **NO migration.** Alembic head stays `0018`. Nothing under `backend/alembic/`.
- **NO frontend change.** Nothing under `frontend/`. `api.ts` already exposes `getTemplates()` —
  untouched.
- **The three existing builders' BODIES are byte-unchanged.** The `teams.py` diff vs `main` is
  confined to: the two new builder functions, the `_TEMPLATE_CATALOG` tuple, and (if you add one) a
  `_SHIP_GATE_CONFIG` constant. `build_two_node_team` / `build_review_loop_team` /
  `build_thinker_chain_team` bodies are unchanged — show this by reading the diff.
- **The executor + validity are untouched:** `git diff main -- backend/tvashtr/control_plane/team_run.py backend/tvashtr/control_plane/graph_validity.py` is EMPTY.
- **The behavioral keystones stay byte-intact + green UNCHANGED:** `git diff main -- backend/tests/test_teams.py backend/tests/test_thinker_chain.py backend/tests/test_review_loop.py` is EMPTY. (They test the three unchanged builders + the unchanged executor — they must pass without edits. If any goes red, STOP — that means a builder body or the executor changed; do not "fix" the test.)

---

## 4. Tests to add / re-point

- **Re-point the catalog-contract assertions** in `backend/tests/test_team_library.py` — the two
  places asserting the template-key list (from `list_templates()` and from `GET /api/templates`) —
  to `["two_node", "review_loop", "plan_review", "full_squad"]`, and update the stale
  `thinker_chain` comment there. This file legitimately tracks the catalog, so this is a real
  re-point (not a keystone).
- **Add a shape test per new builder** (a new test file, or extend `test_team_library.py`), mirroring
  `test_teams.py`'s style: build the team, assert the exact node roles + kinds + configs, and assert
  the EXACT edge set (source/target/edge_type/conditions) for every edge above. Assert gates carry
  the right `gate_kind` and terminals the right `terminal_kind`.
- **Add a runnable check per new template:** create each via `create_team_from_template(key, …)` and
  assert its graph validity is `runnable == true` with zero errors (via `get_team_validity` /
  `graph_validity`) — proving the topology is launchable, not just well-shaped.
- **Re-point the `thinker_chain`-KEY callers in `backend/tests/test_capability_edit.py`** — its 5
  `create_team_from_template("thinker_chain", …)` calls (the capability-flip fixtures at ~L49, L78,
  L95, L110, L129) → **`"plan_review"`**. This is VERIFIED SAFE + ARCHITECT-APPROVED: `plan_review`
  has the same `pm` (root thinker), `architect` (non-root thinker), and `engineer` (worker) roles the
  tests look up BY ROLE NAME, with identical kinds; no test asserts a node count or the absence of
  other roles, so `plan_review`'s extra nodes don't interfere, and the root-lock 409 still fires (the
  PM is still the root). Update the docstrings that name "thinker_chain team" → "plan_review team".
  The tests re-read each row already — they must still pass for real.
- **Grep the whole suite** for `create_team_from_template("thinker_chain"` to confirm the ONLY
  create-callers are those 5 in `test_capability_edit.py` (re-pointed above); the catalog assertions
  in `test_team_library.py` don't use the key to CREATE. If the grep finds a `thinker_chain`-KEY
  create-caller ANYWHERE ELSE, STOP and report it.

---

## 5. Acceptance / evidence (run it all yourself; echo each into the chat)

1. `make test` (backend) — ALL pass, including the three byte-intact keystones. Report the new
   pass count (was 328; it rises by the new template tests).
2. `make lint` — clean.
3. **Runnable proof** — for `two_node`, `review_loop`, `plan_review`, `full_squad`, AND `blank`
   (`POST /api/teams` with `template:"blank"`): create the team and echo one line per template
   showing `runnable = true` (5 lines).
4. `GET /api/templates` — echo the payload; its keys are exactly
   `["two_node", "review_loop", "plan_review", "full_squad"]`, each with a name + description.
5. **Byte-intact proof** — echo the (empty) diffs for `team_run.py`, `graph_validity.py`,
   `test_teams.py`, `test_thinker_chain.py`, `test_review_loop.py`; and echo the SCOPED `teams.py`
   diff, confirming the three existing builder bodies are untouched.
6. Branch `feat/f2a-templates`; end with a `READY_TO_MERGE` line.

## 6. Stop conditions
- A contained, regression-guarded change that stays inside this brief → proceed to green.
- Any need for a BROAD or UNKNOWN change (an executor edit to make a new template run; a keystone
  going red; a builder body needing changes; a `thinker_chain`-KEY create-caller ANYWHERE BEYOND the
  5 in `test_capability_edit.py` re-pointed in §4) → write `NEEDS_HUMAN` to `STATE.md` with the
  specifics and STOP.
- Hard cap: 30 turns. On the cap, write the blocking reason to `STATE.md` and stop.
