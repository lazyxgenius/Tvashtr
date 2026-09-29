/**
 * Copy for the drawer's ⋯ actions: who an agent's arrows connect it to, and what deleting it does
 * (PANEL-25: "Delete Reviewer? Its arrows to Engineer and Ship are removed too. Past runs keep
 * their results.").
 */
import type { GraphEdge, TeamGraphNode } from "../lib/api";
import { nodeTitle } from "../lib/nodeNames";

/** "B" / "B and C" / "A, B and C". */
export function joinAnd(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The names of the nodes this node's arrows (in or out) connect it to, once each, in arrow order. */
export function arrowNeighbours(
  nodeId: string,
  nodes: TeamGraphNode[],
  edges: GraphEdge[],
): string[] {
  const names: string[] = [];
  for (const e of edges) {
    const other =
      e.source_node_id === nodeId
        ? e.target_node_id
        : e.target_node_id === nodeId
          ? e.source_node_id
          : null;
    if (!other || other === nodeId) continue;
    const n = nodes.find((x) => x.id === other);
    const name = n ? nodeTitle(n) : "";
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The delete confirm's sentence (the arrows go with the node; runs use their own copy of it). */
export function deleteAgentBody(
  nodeId: string,
  nodes: TeamGraphNode[],
  edges: GraphEdge[],
): string {
  const to = arrowNeighbours(nodeId, nodes, edges);
  const past = "Past runs keep their results.";
  return to.length > 0 ? `Its arrows to ${joinAnd(to)} are removed too. ${past}` : past;
}
