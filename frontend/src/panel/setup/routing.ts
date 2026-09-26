/**
 * The routing line under the instructions (PANEL-34/35/38): where this agent's work goes, read from
 * its out-arrows, and whether its instructions still tell it to write the verdicts those arrows
 * route on.
 */
import type { GraphEdge, TeamGraphNode } from "../../lib/api";
import { nodeTitle } from "../../lib/nodeNames";

export interface VerdictBranch {
  label: string;
  target: string;
}

export type Routing =
  /** No arrow out of this agent yet. */
  | { kind: "none" }
  /** Plain forward arrows: "Then → <target>." (no sync check). */
  | { kind: "then"; targets: string[] }
  /** Verdict branches: "Says “approved” → Ship. Anything else → back to Engineer." */
  | {
      kind: "verdict";
      branches: VerdictBranch[];
      /** Where any other verdict goes, and whether that arrow loops back. */
      otherwise: { target: string; back: boolean } | null;
      labels: string[];
      inSync: boolean;
    };

/** Every verdict label the arrows route on appears, quoted, in the instructions. */
export function contractInSync(prompt: string, labels: string[]): boolean {
  return labels.every((l) => prompt.includes(`"${l}"`));
}

export function routingOf(
  nodeId: string,
  prompt: string,
  nodes: TeamGraphNode[],
  edges: GraphEdge[],
): Routing {
  const nameOf = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n ? nodeTitle(n) : "";
  };
  const out = edges.filter((e) => e.source_node_id === nodeId && e.edge_type !== "escalation");
  if (out.length === 0) return { kind: "none" };
  const branches = out
    .filter((e) => e.conditions?.when)
    .map((e) => ({ label: e.conditions!.when as string, target: nameOf(e.target_node_id) }));
  const loop = out.find((e) => !e.conditions?.when && e.conditions?.loop_limit != null);
  const plain = out.filter((e) => !e.conditions?.when && e.conditions?.loop_limit == null);
  if (branches.length === 0) {
    const targets = [...plain, ...(loop ? [loop] : [])].map((e) => nameOf(e.target_node_id));
    return { kind: "then", targets };
  }
  const labels = [...new Set(branches.map((b) => b.label))];
  const otherwise = loop
    ? { target: nameOf(loop.target_node_id), back: true }
    : plain[0]
      ? { target: nameOf(plain[0].target_node_id), back: false }
      : null;
  return {
    kind: "verdict",
    branches,
    otherwise,
    labels,
    inSync: contractInSync(prompt, labels),
  };
}
