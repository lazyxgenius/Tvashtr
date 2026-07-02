import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  Position,
} from "@xyflow/react";
import { Trash2 } from "lucide-react";

import type { WorkEdgeData } from "./WorkEdge";

/**
 * The Reviewer -> Engineer loop-back ("rework") edge: a calm downward dashed arc
 * that bows below the node row — it leaves both nodes from their bottom handles, so
 * it never overlaps the forward PM -> Engineer -> Reviewer edges — with an
 * arrowhead back into the Engineer and a small centered "changes requested" label.
 *
 * Static by design: no marching ants, no animation (the canvas ethos — there is no
 * motion here, so `prefers-reduced-motion` has nothing to suppress). The muted
 * "rework" colour + the dash come from `.rf-edge--rework` on the edge group and the
 * `--rework-stroke` marker colour, both in canvas.css.
 *
 * F1b: it now also carries the shared authoring affordance — a hover-revealed trash at the arc's
 * midpoint (nudged up 30px to clear the "changes requested" label), gated on `editable` + `hovered`
 * (both threaded via `data`, exactly like WorkEdge). The label + the calm dashed styling are
 * unchanged, so the canvas tests that assert `.rf-edge--rework` + the label text keep passing.
 */
export function ReworkEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, data }: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: Position.Bottom,
    targetX,
    targetY,
    targetPosition: Position.Bottom,
    curvature: 0.6, // bow it well below the row, clear of the forward edges
  });
  const d = (data ?? {}) as WorkEdgeData;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      <path
        className="rf-edge__hit"
        d={path}
        fill="none"
        onMouseEnter={d.editable ? () => d.onHover?.(true) : undefined}
        onMouseLeave={d.editable ? () => d.onHover?.(false) : undefined}
      />
      <EdgeLabelRenderer>
        <div
          className="rf-edge-rework__label nodrag nopan"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          changes requested
        </div>
        {d.editable && d.hovered && (
          <button
            type="button"
            className="rf-edge__del nodrag nopan"
            title="Delete connection"
            aria-label="Delete connection"
            onMouseEnter={() => d.onHover?.(true)}
            onMouseLeave={() => d.onHover?.(false)}
            onClick={(e) => {
              e.stopPropagation();
              d.onDelete?.();
            }}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 30}px)`,
            }}
          >
            <Trash2 size={12} strokeWidth={1.8} />
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
