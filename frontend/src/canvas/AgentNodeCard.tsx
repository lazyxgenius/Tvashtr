import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ClipboardCheck, type LucideIcon, PenLine, Terminal } from "lucide-react";

import { StatusPill } from "../components/StatusPill";
import type { NodeStatus } from "../lib/status";

// A `type` (not interface) so it satisfies React Flow's `Node<T>` data constraint
// (`T extends Record<string, unknown>`) — interfaces lack the implicit index signature.
export type AgentNodeData = {
  role_name: string;
  kind: string;
  model: string;
  engine: string | null;
  status: NodeStatus;
  iteration: number;
};

const ROLE_TITLE: Record<string, string> = {
  pm: "Product manager",
  engineer: "Engineer",
  reviewer: "Reviewer",
};
const ROLE_BLURB: Record<string, string> = {
  pm: "Drafts the spec",
  engineer: "Writes & ships it",
  reviewer: "Checks the work against the spec",
};
const ROLE_ICON: Record<string, LucideIcon> = {
  pm: PenLine,
  engineer: Terminal,
  reviewer: ClipboardCheck,
};

function prettyEngine(engine: string): string {
  return engine === "openhands" ? "OpenHands" : engine;
}

/** The custom team-node: a DS paper card with role, model/engine caption, an ink
 *  glyph, and a calm status indicator. Carries four handles — the left/right pair
 *  for the forward flow and an unobtrusive bottom pair that only the
 *  Reviewer->Engineer loop-back ("rework") edge uses (present on every node so the
 *  executor stays generic). A "round N" badge appears once a node has looped. */
export function AgentNodeCard({ data }: NodeProps) {
  const d = data as unknown as AgentNodeData;
  const Icon = ROLE_ICON[d.role_name] ?? Terminal;
  const title = ROLE_TITLE[d.role_name] ?? d.role_name;
  const blurb = ROLE_BLURB[d.role_name] ?? d.kind;
  const meta = d.engine ? `${blurb} · ${prettyEngine(d.engine)}` : blurb;

  return (
    <div className={`rf-node rf-node--${d.status}`}>
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
      <Handle type="source" position={Position.Bottom} id="loop-out" className="rf-node__loop-handle" />
      <Handle type="target" position={Position.Bottom} id="loop-in" className="rf-node__loop-handle" />

      <div className="rf-node__head">
        <span className="rf-node__glyph">
          <Icon size={17} strokeWidth={1.6} />
        </span>
        <div>
          <div className="rf-node__role">{title}</div>
          <div className="rf-node__kind">{meta}</div>
        </div>
        {d.iteration >= 2 && <span className="rf-node__round">round {d.iteration}</span>}
      </div>
      <div className="rf-node__model" title={d.model}>
        {d.model}
      </div>
      <div className="rf-node__foot">
        <StatusPill status={d.status} />
      </div>
    </div>
  );
}
