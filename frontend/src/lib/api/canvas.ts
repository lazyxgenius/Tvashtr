/**
 * M11 — canvas extras (`docs/superpowers/plans/api/canvas-extras.md`): an edge's use ("Use this
 * path…"), the team's groups (stored with its layout, never a version, never read by the walk).
 */
import { apiRequest } from "./runs";
import type { GraphEdge } from "../api";

/** "Use this path…": Always = forward, When the agent says… = branch, If it fails or times out =
 *  failure. */
export type EdgeUse = "forward" | "branch" | "failure";

/** PATCH /api/teams/{id}/edges/{edge_id}: 409 "The <agent> already has a failure path", 422 from a
 *  gate, Ship, Stop or Query domain — both thrown as `ApiDetailError` with the server's words. */
export const patchTeamEdge = (
  teamId: string,
  edgeId: string,
  body: { role: EdgeUse; label?: string },
): Promise<GraphEdge> =>
  apiRequest<GraphEdge>(
    "PATCH",
    `/api/teams/${encodeURIComponent(teamId)}/edges/${encodeURIComponent(edgeId)}`,
    body,
  );

/** One labelled frame around agents (R14). */
export interface TeamGroup {
  id: string;
  label: string;
  node_ids: string[];
  folded: boolean;
}

export interface TeamLayout {
  groups: TeamGroup[];
}

/** PUT /api/teams/{id}/layout → the stored layout (ids not in the team dropped, a node in one group
 *  at most). */
export const saveTeamLayout = (teamId: string, layout: TeamLayout): Promise<TeamLayout> =>
  apiRequest<TeamLayout>("PUT", `/api/teams/${encodeURIComponent(teamId)}/layout`, layout);

/** Approve with my edits: one POST to the gate's resolve route saves the full edited spec as its
 *  next version (author: the person) and approves. 422 for a gate with no spec. */
export const approveWithEdits = (runId: string, taskId: number, editedSpec: string) =>
  apiRequest<unknown>("POST", `/api/runs/${encodeURIComponent(runId)}/tasks/${taskId}/resolve`, {
    decision: "approve",
    edited_spec: editedSpec,
  });
