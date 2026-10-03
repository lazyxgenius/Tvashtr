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
