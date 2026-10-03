import type { GraphEdge, NodePosition } from "../lib/api";

/** A node as Tidy sees it: where it is now and how big it draws. */
export interface TidyNode {
  id: string;
  kind: string;
  position: NodePosition;
  width: number;
  height: number;
}

const GAP_X = 80;
const ROW_PITCH = 170;

/** Rows keep the order they had: top to bottom, then left to right, then by id. */
const byPlace = (a: TidyNode, b: TidyNode) =>
  a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id);

/**
 * M11 Tidy (R14, Cnv-Tidy): left to right in flow order. A node's layer is the longest forward path
 * to it from the entry; loop-backs and failure paths don't order anything (a node reached only by a
 * failure path follows its agent). A layer that holds gates and other nodes gives the gates their own
 * column, first. Rows within a layer keep their top-to-bottom order; every row shares one centre
 * line. The entry stays where it is. Pure: the same nodes and edges always give the same positions.
 */
export function tidyLayout(nodes: TidyNode[], edges: GraphEdge[]): Record<string, NodePosition> {
  const ids = new Set(nodes.map((n) => n.id));
  const forward = edges.filter(
    (e) =>
      ids.has(e.source_node_id) &&
      ids.has(e.target_node_id) &&
      e.edge_type !== "failure" &&
      e.conditions?.loop_limit == null,
  );
  const failure = edges.filter(
    (e) => e.edge_type === "failure" && ids.has(e.source_node_id) && ids.has(e.target_node_id),
  );
  const targets = new Set([...forward, ...failure].map((e) => e.target_node_id));
  const sorted = [...nodes].sort(byPlace);
  const layer = new Map<string, number>();
  for (const n of sorted) if (!targets.has(n.id)) layer.set(n.id, 0);
  // Longest path by relaxation; a pass count of N bounds it even if a cycle slipped through. Nodes
  // in `frozen` never move.
  const relax = (order: GraphEdge[], frozen: Set<string>) => {
    for (let pass = 0; pass < nodes.length; pass++) {
      let moved = false;
      for (const e of order) {
        const from = layer.get(e.source_node_id);
        if (from === undefined || frozen.has(e.target_node_id)) continue;
        if ((layer.get(e.target_node_id) ?? -1) < from + 1 && from + 1 < nodes.length) {
          layer.set(e.target_node_id, from + 1);
          moved = true;
        }
      }
      if (!moved) break;
    }
  };
  // The main path from forward edges alone; then what only a failure path reaches follows its agent,
  // the main path held still (a failure path that loops back can't push it right).
  relax(forward, new Set());
  relax([...failure, ...forward], new Set(layer.keys()));

  // Columns: each layer's gates, then the rest. Rows: the node's place within its layer.
  const layers = new Map<number, TidyNode[]>();
  for (const n of sorted) {
    const l = layer.get(n.id) ?? 0;
    layers.set(l, [...(layers.get(l) ?? []), n]);
  }
  const entry = sorted.find((n) => layer.get(n.id) === 0) ?? sorted[0];
  if (!entry) return {};
  const centreY = entry.position.y + entry.height / 2;
  const out: Record<string, NodePosition> = {};
  let x = entry.position.x;
  for (const l of [...layers.keys()].sort((a, b) => a - b)) {
    const inLayer = layers.get(l) ?? [];
    const gates = inLayer.filter((n) => n.kind === "gate");
    const rest = inLayer.filter((n) => n.kind !== "gate");
    for (const column of gates.length && rest.length ? [gates, rest] : [inLayer]) {
      for (const n of column) {
        const row = inLayer.indexOf(n);
        out[n.id] = { x, y: Math.round(centreY + row * ROW_PITCH - n.height / 2) };
      }
      x += Math.max(...column.map((n) => n.width)) + GAP_X;
    }
  }
  return out;
}
