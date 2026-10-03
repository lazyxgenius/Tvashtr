# M11 — Canvas extras: API contract

Brief: `prompts/m1-m11.md` §4 M11 + rulings R13 (failure path), R14 (Tidy and groups); addendum `prompts/m8-m11.md`
("M11: Test this agent opens the Tests tab"). Boards: Team Setup › `Cnv-FailPath`, `Cnv-Tidy`, `Cnv-Group`,
`Cnv-TestAgent`, `Cnv-EditApprove` and the M11 boards drawn for the undrawn states: `Cnv-FailPathOne` (one failure path
per agent), `Cnv-TimeLimit` (an agent's time limit), `Cnv-FailPathRun` (a run that took a failure path),
`Cnv-GroupFolded` (a folded group), `Cnv-EditApproved` (the run after Approve with my edits).

Every new route is owner-scoped (another account → 404), listed in `test_owner_scope_guard.py`.

## Failure path (R13)

- An edge with `edge_type = "failure"` (conditions NULL) out of an AGENT node: the walk follows it when that agent fails
  — an engine error, the R1 stall ceiling, or its own time limit — instead of failing the run. It is never used for
  ordinary routing (`team_run.next_node` skips it, as it skips `escalation`). One per agent. Loop limits still apply.
- Authoring: `POST /api/teams/{id}/edges` accepts `role: "failure"` (additive); `PATCH /api/teams/{id}/edges/{edge_id}`
  `{role, label?, loop_limit?}` changes an edge's use ("Use this path…": Always = forward, When the agent says… = branch,
  If it fails or times out = failure) — 409 "The <agent> already has a failure path" for a second one; 422 from a gate,
  Ship, Stop or Query domain.
- The agent's time limit: `agent_nodes.config.time_limit_s` (PATCH the node, additive key), choices 5 / 10 / 20 / 30 /
  60 minutes, default 20 minutes (R1's ceiling). Running longer, the step ends like a stalled one.
- Validity (`graph_validity.validate_graph`, additive rules): a failure edge only out of an agent; at most one per agent;
  its target must reach a terminal (it counts as a route for the "can reach a terminal" rule).
- The walk (`run_graph`, a plain function — no new DBOS step or workflow): in the agent-failure branch, when the node has
  a failure edge, close the invocation `failed` (its reason kept), and continue at the edge's target. The stall sweep and
  the time limit: for a node with a failure edge, end the step by releasing its sandbox (the step returns failed) WITHOUT
  marking the run failed or cancelling its workflow; without one, exactly today's behaviour (the run fails).
- Activity: after the failed line, `"The Engineer failed, so the run takes its failure path to <target>"` (kind
  `failure_path`). The run ends as its path ends (Stop → stopped, Ship → shipped).

## Tidy (R14)

Frontend only: left to right in flow order (layers by the longest forward path from the entry agent, loop-backs and
failure edges ignored), gates on their own layer between agents, rows in a stable order; one Undo restores the previous
positions. Positions save through the existing `POST /api/teams/{id}/positions`. Never a version (R3, R14).

## Groups (R14) — migration **0052**

- `team_graphs.layout` (JSONB, nullable): `{"groups": [{"id", "label", "node_ids": [...], "folded": false}]}`.
- `GET /api/teams/{id}/graph` gains `"layout": {"groups": [...]}` (additive); `PUT /api/teams/{id}/layout`
  `{"groups": [...]}` → the stored layout (node ids not in the team dropped; a node in one group at most; labels
  1–60 characters). Never a version, never read by the walk (R14).

## Test this agent

Frontend only: the node's ⋯ menu gains "Test this agent" with its test count; it opens the drawer on the Tests tab.

## Approve with my edits

- `POST /api/runs/{id}/tasks/{task_id}/resolve` accepts `{"decision": "approve", "edited_spec": "<the full text>"}`
  (additive): the spec is saved as the next version (author: the person) and the gate approved, in one call. 422 for an
  edited spec on a reject or a gate with no spec. Migration 0052 also adds `human_tasks.edited_version` (int, nullable).
- Activity: the gate's line reads `"Approved with your edits · spec v3"`. The Engineer starts from that version (the walk
  re-reads the live spec at the next agent, as P1.7 steering does).

## As built (backend, `m11-be`)

Shapes for the frontend:

- `POST /api/teams/{id}/edges` — `role` also `"failure"` → `{id, source_node_id, target_node_id, edge_type:
  "failure", conditions: null}`. 409 `{"detail": "The <agent> already has a failure path"}`; 422 `{"detail": "Only an
  agent can have a failure path."}` out of a gate, Ship, Stop or Query domain (agents = thinker and worker kinds).
- `PATCH /api/teams/{id}/edges/{edge_id}` `{role, label?, loop_limit?}` (role: forward / branch / loop_back /
  escalation / failure, mapped exactly as POST maps them; 400 for a branch with no label) → the edge (same shape as
  POST). 409 / 422 as above for `failure` (the edge itself never counts as "another" failure path). 400 malformed id,
  404 not this team's edge. Owner-scoped, in the sweep.
- `PATCH /api/teams/{id}/nodes/{node_id}` `{time_limit_s: 300|600|1200|1800|3600|null}` → `config.time_limit_s`
  (null removes it; any other number is a 422). Absent = 20 minutes (`TVASHTR_STALL_FAIL_AFTER_S`, R1's ceiling).
- `GET /api/teams/{id}/graph` → `layout: {"groups": [...]}` (`{"groups": []}` when none).
- `PUT /api/teams/{id}/layout` `{"groups": [{"id": "1–64 chars", "label": "1–60 chars after trim", "node_ids": [...],
  "folded": false}]}` (at most 100 groups) → the stored `{"groups": [...]}`: node ids not in the team dropped (and a
  repeat within one group), labels trimmed. 422: a node in two groups, two groups with one id, a label outside 1–60.
  Not copied into a run's snapshot or a duplicated team; never part of a version (`versions.capture` doesn't read it).
- `POST /api/runs/{id}/tasks/{task_id}/resolve` `{"decision": "approve", "edited_spec": "<full text>"}` → the reply
  gains `edited_version` (the new spec version number; `null` without edits). The spec is saved through
  `document_views.add_human_version` (author `human`, note "Approved with your edits"), `human_tasks.edited_version`
  is set, then the approval is signalled. 422: `edited_spec` with `reject`, a blank one, or a run with no spec yet
  (`runs.pm_document_id` null); 409 `run_finished` as the documents route. `GET /api/runs/{id}/tasks` items gain
  `edited_version`.
- Activity (`GET /api/runs/{id}/activity`):
  - the step that took its failure path keeps its `Failed: …` line (kind `error`; a stalled step keeps its own
    `stalled` line instead), followed by `{id: "inv:<invocation>:failure_path", node_id: null (label "Run"),
    iteration: null, kind: "failure_path", tone: "warn", text: "The <agent> failed, so the run takes its failure path
    to <target>", refs: {node_id, target_node_id}}` — `<target>` named as the canvas shows it: the node's own title when
    it has one (a gate's "Ask me what to do", Cnv-FailPathRun), else its usual label (`node_label`);
  - the gate's decided line: `{id: "task:<id>:done", kind: "gate_approved", text: "Approved with your edits · spec
    v3", refs: {task_id, title, edited_version: 3}}`; the gate's agent row `activity` reads the same; the spec version
    the approval saved gets no separate "You edited the spec (v3)" line.
- The invocation that took the path: `status "failed"`, `outcome "failure_path"`, `outcome_detail` = its reason (the
  engine's error, or the sweep's message when the sweep ended it). The sweep's own outcomes: `stalled` (R1) and
  `timed_out` ("The Engineer ran longer than its time limit of 10 minutes").

What differs from the contract above, and why:

1. **The time limit applies to an agent with a failure path only.** It is set on that path's menu (Cnv-TimeLimit);
   without a failure path an agent is ended only by R1's stall ceiling, exactly as before M11 (a long but busy agent
   is never cut by a time limit nobody can see). With one, a step running past `time_limit_s` (default R1's 20
   minutes) is closed `timed_out` and its sandbox released, busy or not.
2. **Loop limits:** the walk takes a failure path while the agent's round is within its loop limit (the loop-back's
   `loop_limit`, else `max_review_iterations`); the round past it fails the run as before. So a failure path that
   retries the agent (directly or through a gate) is bounded, and validity treats a failure edge like a loop-back in
   its unbounded-loop check.
3. **Which failures:** the agent-failure branch of the walk — an engine error, an over-context breach, a step the
   sweep ended (stall ceiling or time limit). Not over budget (that stops the run as before) and not an entry agent
   that wrote no REPORT.md (fails as before).
4. **Only where the sweep can stop the agent** (review B): the sweep ends a step along its failure path only when this
   process holds the run's docker / Fly sandbox (`sandbox_cache.holds_run`), whose release stops the agent at once.
   Otherwise — a LOCAL (in-process) agent, a run on Fly's other machine, a Desktop runner — the stalled or timed-out
   step ends as before M11 (the run fails, its workflow cancelled) rather than being left running. An engine error is
   unaffected: the walk takes the path wherever the agent runs.
6. **Review fixes:** each visit to a gate on a failure path asks again (its own task and signal topic, `gate:<run>:<node>:
   <visit>` from the second visit); a failed round's spend is metered before the path is taken; a round past its loop
   limit that the sweep ended fails the run with the sweep's reason (`stalled`). Frontend: "When the agent says…" on a
   path with no outcome word asks for the word first (the existing "Routing label" editor); Tidy lays the main path out
   from forward edges alone, then places what only a failure path reaches after its agent with the main path held
   still; the agent drawer's routing line leaves failure paths out (as escalation arrows).
7. **"The run ends as its path ends"** means as any run does at that ending: at a Stop the run's status is `rejected`
   and its Stop step `stopped` (P1.1's Stop, unchanged); at Ship it ships.
5. Validity codes (errors): `failure_not_agent`, `failure_twice`, `failure_dead_end`. Failure edges are also left out
   of the pipeline strip / the run's progress strip (like escalation edges) and of a Query domain step's "slot".
   A team file accepts and exports `type: failure`; a version's change rows say "… · if it fails" for one.
