import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  ClipboardCheck,
  type LucideIcon,
  OctagonX,
  PackageCheck,
  PenLine,
  ShieldCheck,
  Terminal,
} from "lucide-react";

import { StatusPill } from "../components/StatusPill";
import type { GateConfig, NodeConfig, TerminalConfig } from "../lib/api";
import type { GateState, NodeStatus, TerminalState } from "../lib/status";

// A `type` (not interface) so it satisfies React Flow's `Node<T>` data constraint
// (`T extends Record<string, unknown>`) — interfaces lack the implicit index signature.
export type AgentNodeData = {
  role_name: string;
  kind: string; // completion | agent | gate | terminal
  model: string;
  engine: string | null;
  status: NodeStatus;
  iteration: number;
  config: NodeConfig | null;
  gateState?: GateState; // set by the canvas for kind === "gate"
  terminalState?: TerminalState; // set by the canvas for kind === "terminal"
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

/** One handle scheme for EVERY node kind: a source + a target on all four sides, so the
 *  canvas can route any branch by geometry (`pickHandles`). Left + right stay visible (the
 *  primary flow axis, one dot a side — today's look); top + bottom are hidden anchors (the
 *  arc/arrowhead carries the meaning). The loop-back arc uses the bottom pair. */
function NodeHandles() {
  return (
    <>
      <Handle type="source" position={Position.Left} id="s-left" />
      <Handle type="target" position={Position.Left} id="t-left" />
      <Handle type="source" position={Position.Right} id="s-right" />
      <Handle type="target" position={Position.Right} id="t-right" />
      <Handle type="source" position={Position.Top} id="s-top" className="rf-node__hidden-handle" />
      <Handle type="target" position={Position.Top} id="t-top" className="rf-node__hidden-handle" />
      <Handle
        type="source"
        position={Position.Bottom}
        id="s-bottom"
        className="rf-node__hidden-handle"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="t-bottom"
        className="rf-node__hidden-handle"
      />
    </>
  );
}

/** The agent/completion team-node: a DS paper card with role, model/engine caption, an ink
 *  glyph, and a calm status indicator. A "round N" badge appears once a node has looped. */
function AgentCard({ data: d }: { data: AgentNodeData }) {
  const Icon = ROLE_ICON[d.role_name] ?? Terminal;
  const title = ROLE_TITLE[d.role_name] ?? d.role_name;
  const blurb = ROLE_BLURB[d.role_name] ?? d.kind;
  const meta = d.engine ? `${blurb} · ${prettyEngine(d.engine)}` : blurb;

  return (
    <div className={`rf-node rf-node--${d.status}`}>
      <NodeHandles />
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

// Short, canvas-legible gate label from gate_kind (the full config.title is a sentence —
// that belongs on the drawer card, not the node).
function gateLabel(gateKind: string): string {
  if (gateKind === "prd_approval") return "PRD approval";
  if (gateKind === "review_escalation") return "Escalation";
  return gateKind;
}
const GATE_STATE_LINE: Record<GateState, string> = {
  idle: "Gate",
  awaiting: "Awaiting approval",
  approved: "Approved",
  stopped: "Stopped",
};

/** A checkpoint node — visually distinct from the agent cards: compact, a shield glyph, a
 *  short gate label, and a state line. The state (idle/awaiting/approved/stopped) drives the
 *  color; "awaiting" is calm coral with NO pulse (the design is explicitly static here). */
function GateCard({ data: d }: { data: AgentNodeData }) {
  const cfg = (d.config ?? {}) as GateConfig;
  const state = d.gateState ?? "idle";
  const label = gateLabel(cfg.gate_kind ?? d.role_name);
  return (
    <div className={`rf-gate rf-gate--${state}`} title={cfg.title || label}>
      <NodeHandles />
      <span className="rf-gate__glyph">
        <ShieldCheck size={16} strokeWidth={1.7} />
      </span>
      <div className="rf-gate__text">
        <div className="rf-gate__label">{label}</div>
        <div className="rf-gate__state">{GATE_STATE_LINE[state]}</div>
      </div>
    </div>
  );
}

/** An endpoint node — distinct from both the agent cards and the gates: compact, a glyph by
 *  terminal_kind (ship → package, stop → octagon), a one-line label. Reads faint until the
 *  walk reaches it, then sage "Shipped" (ship) / muted "Stopped" (stop). */
function TerminalCard({ data: d }: { data: AgentNodeData }) {
  const cfg = (d.config ?? {}) as TerminalConfig;
  const kind = cfg.terminal_kind === "ship" ? "ship" : "stop";
  const state = d.terminalState ?? "idle";
  const reached = state !== "idle";
  const Icon = kind === "ship" ? PackageCheck : OctagonX;
  const label = kind === "ship" ? (reached ? "Shipped" : "Ship") : reached ? "Stopped" : "Stop";
  return (
    <div className={`rf-terminal rf-terminal--${kind} rf-terminal--${state}`}>
      <NodeHandles />
      <span className="rf-terminal__glyph">
        <Icon size={16} strokeWidth={1.7} />
      </span>
      <div className="rf-terminal__label">{label}</div>
    </div>
  );
}

/** The custom team-node, dispatched by `kind`: gate → checkpoint, terminal → endpoint, and
 *  agent/completion → the paper role card. Every variant carries the same 8-handle scheme. */
export function AgentNodeCard({ data }: NodeProps) {
  const d = data as unknown as AgentNodeData;
  if (d.kind === "gate") return <GateCard data={d} />;
  if (d.kind === "terminal") return <TerminalCard data={d} />;
  return <AgentCard data={d} />;
}
