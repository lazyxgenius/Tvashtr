import type { GraphData, NodePosition } from "../lib/api";
import type { TeamGroup } from "../lib/api/canvas";
import { nodeTitle } from "../lib/nodeNames";

// M11 (R14): groups are labels — a frame around some agents, renamed inline, folded into one box.
// They never change the walk. Pure helpers; the canvas draws them (CanvasGroups.tsx).

/** How big a node draws before React Flow has measured it (canvas.css). */
export function defaultSize(kind: string): { width: number; height: number } {
  if (kind === "gate") return { width: 140, height: 36 };
  if (kind === "terminal") return { width: 60, height: 50 };
  if (kind === "groupFold") return { width: 300, height: 56 };
  return { width: 164, height: 110 };
}

/** "Engineer ⇄ Reviewer · up to 3 rounds" when a loop runs inside the group (Cnv-Group). */
export function loopSummary(group: TeamGroup, graph: GraphData): string | null {
  const ids = new Set(group.node_ids);
  const loop = graph.edges.find(
    (e) =>
      e.conditions?.loop_limit != null && ids.has(e.source_node_id) && ids.has(e.target_node_id),
  );
  if (!loop) return null;
  const name = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n ? nodeTitle(n) : id;
  };
  return `${name(loop.target_node_id)} ⇄ ${name(loop.source_node_id)} · up to ${loop.conditions?.loop_limit} rounds`;
}

/** A folded group's line (Cnv-GroupFolded): "2 agents · Engineer ⇄ Reviewer · up to 3 rounds". */
export function foldedLine(count: number, summary: string | null): string {
  const agents = `${count} agent${count === 1 ? "" : "s"}`;
  return summary ? `${agents} · ${summary}` : agents;
}

/** A new group takes its nodes out of any other group (a node is in one group at most); a group
 *  left empty goes. */
export function addGroup(groups: TeamGroup[], group: TeamGroup): TeamGroup[] {
  const taken = new Set(group.node_ids);
  return [
    ...groups
      .map((g) => ({ ...g, node_ids: g.node_ids.filter((id) => !taken.has(id)) }))
      .filter((g) => g.node_ids.length > 0),
    group,
  ];
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The frame around a group's nodes (Cnv-Group: 22px each side, 42 above for the label). A loop
 *  inside bows below the cards, so its frame reaches further down. */
export function frameBox(members: Box[], hasLoop: boolean): Box | null {
  if (members.length === 0) return null;
  const left = Math.min(...members.map((m) => m.x)) - 22;
  const top = Math.min(...members.map((m) => m.y)) - 42;
  const right = Math.max(...members.map((m) => m.x + m.width)) + 22;
  // ponytail: a fixed allowance for the loop's arc, not its real path; measure the arc if it clips.
  const bottom = Math.max(...members.map((m) => m.y + m.height)) + 22 + (hasLoop ? 80 : 0);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Where a folded group's box sits: at its leftmost node, on that node's centre line. */
export function foldAnchor(members: Box[]): NodePosition | null {
  const first = [...members].sort((a, b) => a.x - b.x || a.y - b.y)[0];
  if (!first) return null;
  return {
    x: first.x,
    y: Math.round(first.y + first.height / 2 - defaultSize("groupFold").height / 2),
  };
}
