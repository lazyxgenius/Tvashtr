import { Handle, Position, type NodeProps } from "@xyflow/react";
import { PenLine, Terminal } from "lucide-react";

import { StatusPill } from "../components/StatusPill";
import type { NodeStatus } from "../lib/status";

export interface AgentNodeData {
  role_name: string;
  kind: string;
  model: string;
  engine: string | null;
  status: NodeStatus;
}

const ROLE_TITLE: Record<string, string> = {
  pm: "Product manager",
  engineer: "Engineer",
};
const ROLE_BLURB: Record<string, string> = {
  pm: "Drafts the spec",
  engineer: "Writes & ships it",
};

function prettyEngine(engine: string): string {
  return engine === "openhands" ? "OpenHands" : engine;
}

/** The custom team-node: a DS paper card with role, model/engine caption,
 *  an ink glyph, and a calm status indicator. */
export function AgentNodeCard({ data }: NodeProps) {
  const d = data as unknown as AgentNodeData;
  const Icon = d.role_name === "pm" ? PenLine : Terminal;
  const title = ROLE_TITLE[d.role_name] ?? d.role_name;
  const blurb = ROLE_BLURB[d.role_name] ?? d.kind;
  const meta = d.engine ? `${blurb} · ${prettyEngine(d.engine)}` : blurb;

  return (
    <div className={`rf-node rf-node--${d.status}`}>
      <Handle type="target" position={Position.Left} />
      <div className="rf-node__head">
        <span className="rf-node__glyph">
          <Icon size={17} strokeWidth={1.6} />
        </span>
        <div>
          <div className="rf-node__role">{title}</div>
          <div className="rf-node__kind">{meta}</div>
        </div>
      </div>
      <div className="rf-node__model" title={d.model}>
        {d.model}
      </div>
      <div className="rf-node__foot">
        <StatusPill status={d.status} />
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
