import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";
import { Trash2 } from "lucide-react";

// F1b: the custom edge for every NON-rework edge (forward / branch / reject / escalation). It draws
// the same bezier path + arrowhead the default edge did (the visual variant still rides the group
// `className` — `.rf-edge--flow/--done/--reject/--escalation` — set in TeamCanvas, so the canvas
// tests that assert those class names keep passing), and ADDS the n8n authoring affordances: an
// optional midpoint label pill (a branch's `when`) and a hover-revealed trash at the path midpoint,
// nudged up ~30px when the edge carries a label so it clears it (the operator's placement tweak).
//
// Hover is tracked by a transparent wide hit-path INSIDE the edge SVG (mirroring the design's
// `pointer-events:stroke` overlay), whose own mouse handlers keep the trash alive across the gap to
// the portaled button — `EdgeLabelRenderer` portals the button out of the edge group, so a plain
// CSS `:hover` on the group can't reach it.
export interface WorkEdgeData {
  editable?: boolean;
  hovered?: boolean;
  label?: string;
  onHover?: (hovered: boolean) => void;
  onDelete?: () => void;
}

export function WorkEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const d = (data ?? {}) as WorkEdgeData;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      {/* the transparent wide hit area — hovering it reveals the midpoint trash (editable only) */}
      <path
        className="rf-edge__hit"
        d={path}
        fill="none"
        onMouseEnter={d.editable ? () => d.onHover?.(true) : undefined}
        onMouseLeave={d.editable ? () => d.onHover?.(false) : undefined}
      />
      <EdgeLabelRenderer>
        {d.label && (
          <div
            className="rf-edge__label nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {d.label}
          </div>
        )}
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
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - (d.label ? 30 : 0)}px)`,
            }}
          >
            <Trash2 size={12} strokeWidth={1.8} />
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
