import { type Edge, MarkerType } from "@xyflow/react";

import type { GraphData, NodePosition } from "../lib/api";
import type { ValidityFlags } from "../lib/topology";

// F-canvas-fidelity-2: the canvas edge builder — extracted from TeamCanvas so the built edge objects
// (esp. each edge's `markerEnd` arrowhead, Part 2) are unit-testable. Pure: same graph + flags + hover
// id → same edges. The interactivity (hover/delete) is injected as callbacks so the builder stays pure.

/** Raw backend status per node id (idle|running|done|failed|stopped) — the source for the
 *  forward-edge styling (the class derives from a pair of adjacent raw statuses). */
export function rawStatusById(graph: GraphData): Record<string, string> {
  const m: Record<string, string> = {};
  for (const n of graph.nodes) m[n.id] = n.status;
  return m;
}

/** Pick the source/target handles for an edge by geometry, so any branch routes cleanly:
 *  horizontal backbone → right→left (today's look); a downward branch → bottom→top; a
 *  leftward branch → left→right. Pure; generalizes to any authored graph. */
export function pickHandles(
  s: NodePosition,
  t: NodePosition,
): { sourceHandle: string; targetHandle: string } {
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: "s-right", targetHandle: "t-left" }
      : { sourceHandle: "s-left", targetHandle: "t-right" };
  }
  return dy >= 0
    ? { sourceHandle: "s-bottom", targetHandle: "t-top" }
    : { sourceHandle: "s-top", targetHandle: "t-bottom" };
}

// F-canvas-fidelity-2 Part 2: EVERY edge ends in a small filled arrowhead (`MarkerType.ArrowClosed`)
// into its target, colored by the edge's state — mirroring the design's ar-neutral/ar-coral/ar-sage/
// ar-branch markers. React Flow resolves a `var()` token in the marker color (proven by the existing
// branch/rework markers). Before this pass a plain forward `work` edge had NO markerEnd → no arrowhead.

/** The forward `work` edge arrowhead, colored by flow state: coral while work flows (`rf-edge--flow`),
 *  sage when done (`rf-edge--done`), neutral (`--border-strong`) otherwise. */
export function forwardMarker(className: string) {
  const color = className.includes("rf-edge--flow")
    ? "var(--coral-500)"
    : className.includes("rf-edge--done")
      ? "var(--sage-500)"
      : "var(--border-strong)";
  return { type: MarkerType.ArrowClosed, color, width: 14, height: 14 };
}

/** The reject/escalation (branch) arrowhead — the muted branch tone (`--branch-stroke`, the design's
 *  ar-branch). */
export function branchMarker() {
  return { type: MarkerType.ArrowClosed, color: "var(--branch-stroke)", width: 14, height: 14 };
}

/** The rework loop-back arrowhead — coral (`--rework-stroke`, the design's ar-coral). */
export function reworkMarker() {
  return { type: MarkerType.ArrowClosed, color: "var(--rework-stroke)", width: 16, height: 16 };
}

/** Build the React Flow edges for a graph. The loop-back (`{loop_limit}`) is the dashed rework arc;
 *  every other edge routes by geometry through the custom `work` edge (a reject/escalation branch, or
 *  a plain forward edge). Each edge carries the shared authoring affordance data (the hover-revealed
 *  midpoint trash) + a state-colored end arrowhead. */
export function buildEdges(
  graph: GraphData,
  flags: ValidityFlags,
  editable: boolean,
  hoveredEdgeId: string | null,
  onHover: (id: string, hovered: boolean) => void,
  onDelete: (id: string) => void,
): Edge[] {
  const raw = rawStatusById(graph);
  const posById: Record<string, NodePosition> = {};
  for (const n of graph.nodes) posById[n.id] = n.position;

  return graph.edges.map((e) => {
    const invalid = flags.edgeErrors.has(e.id) ? " rf-edge--invalid" : "";
    // The shared authoring affordance data — the hover-revealed midpoint trash. `editable` gates it
    // off in the run view; `hovered` is driven by the edge's transparent hit-path (with a leave grace).
    // Inferred (anonymous) so it satisfies React Flow's `Edge.data` (Record<string, unknown>) — a named
    // interface lacks the implicit index signature. WorkEdge/ReworkEdge cast it back to WorkEdgeData.
    const authoring = {
      editable,
      hovered: hoveredEdgeId === e.id,
      onHover: (h: boolean) => onHover(e.id, h),
      onDelete: () => onDelete(e.id),
    };

    // 1. The bounded loop-back (`{loop_limit: N}`, no `when`) → the calm dashed arc.
    if (e.conditions?.loop_limit != null) {
      return {
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        sourceHandle: "s-bottom",
        targetHandle: "t-bottom",
        type: "rework",
        className: `rf-edge--rework${invalid}`,
        markerEnd: reworkMarker(),
        data: authoring,
      };
    }

    // 2. Every other edge routes by geometry through the custom WorkEdge (a reject/escalation branch,
    //    or a plain forward edge). Each gets a state-colored end arrowhead (Part 2).
    const { sourceHandle, targetHandle } = pickHandles(
      posById[e.source_node_id],
      posById[e.target_node_id],
    );
    let className: string;
    let markerEnd;
    if (e.conditions?.when === "rejected") {
      className = "rf-edge--reject";
      markerEnd = branchMarker();
    } else if (e.edge_type === "escalation") {
      className = "rf-edge--escalation";
      markerEnd = branchMarker();
    } else {
      const s = raw[e.source_node_id];
      const t = raw[e.target_node_id];
      className =
        t === "running" ? "rf-edge--flow" : s === "done" && t === "done" ? "rf-edge--done" : "";
      markerEnd = forwardMarker(className);
    }
    return {
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      sourceHandle,
      targetHandle,
      type: "work",
      className: `${className}${invalid}`.trim(),
      markerEnd,
      animated: false,
      data: { ...authoring, label: e.conditions?.when },
    };
  });
}
