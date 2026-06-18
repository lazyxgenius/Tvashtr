import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath, Position } from "@xyflow/react";

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
 */
export function ReworkEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd }: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: Position.Bottom,
    targetX,
    targetY,
    targetPosition: Position.Bottom,
    curvature: 0.6, // bow it well below the row, clear of the forward edges
  });

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          className="rf-edge-rework__label nodrag nopan"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          changes requested
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
