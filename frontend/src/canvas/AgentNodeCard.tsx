import { useContext } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Check,
  ClipboardCheck,
  Cpu,
  DraftingCompass,
  type LucideIcon,
  OctagonX,
  Package,
  PenLine,
  Plus,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
  Zap,
} from "lucide-react";

import { StatusPill } from "../components/StatusPill";
import { AuthoringContext } from "./authoringContext";
import type { GateConfig, NodeConfig, TerminalConfig } from "../lib/api";
import type { GateState, NodeStatus, TerminalState } from "../lib/status";

// A `type` (not interface) so it satisfies React Flow's `Node<T>` data constraint
// (`T extends Record<string, unknown>`) — interfaces lack the implicit index signature.
export type AgentNodeData = {
  role_name: string;
  kind: string; // completion | agent | gate | terminal
  // M-unify U3: the ONE capability distinction — true ⇒ writes files ("Edits on"), false ⇒
  // report-only ("Edits off"). Optional so run/fixture nodes predating the field fall back to `kind`.
  edits_allowed?: boolean;
  model: string;
  engine: string | null;
  status: NodeStatus;
  iteration: number;
  config: NodeConfig | null;
  gateState?: GateState; // set by the canvas for kind === "gate"
  terminalState?: TerminalState; // set by the canvas for kind === "terminal"
  // P1.8d authoring flags: a blocking validity issue on this node (red ring + tooltip), or an
  // orphan warning (the walk never reaches it — dimmed, but still runnable).
  errorMessage?: string;
  isOrphan?: boolean;
  // F1a: computed by the canvas (not the backend) — true for the graph's entry node(s), i.e. no
  // forward edge targets it. Renders the coral start-bar + "Start · entry" eyebrow. VISUAL only.
  isEntry?: boolean;
  // F-canvas-fidelity-2 Part 1: true when this node is the hover-graced one (author mode) — drives the
  // +/trash affordance render from state (not CSS :hover), so they linger through the grace. VISUAL only.
  hovered?: boolean;
};

/** The authoring overlay classes for a node (P1.8d): a red ring for a blocking issue, a dim for an
 *  orphan warning. Empty in the run view (no flags set). */
function flagClasses(d: AgentNodeData): string {
  return `${d.errorMessage ? " tv-node--invalid" : ""}${d.isOrphan ? " tv-node--orphan" : ""}`;
}

const ROLE_TITLE: Record<string, string> = {
  pm: "Product manager",
  architect: "Architect",
  engineer: "Engineer",
  reviewer: "Reviewer",
};
const ROLE_BLURB: Record<string, string> = {
  pm: "Drafts the spec",
  architect: "Adds the technical design",
  engineer: "Writes & ships it",
  reviewer: "Checks against the spec",
};
const ROLE_ICON: Record<string, LucideIcon> = {
  pm: PenLine,
  architect: DraftingCompass,
  engineer: Terminal,
  reviewer: ClipboardCheck,
};

function prettyEngine(engine: string): string {
  return engine === "openhands" ? "OpenHands" : engine;
}

// M-unify U3: a node's capability is now the edits distinction — `edits_allowed` true ⇒ it writes
// files ("Edits on"), false ⇒ report-only ("Edits off"). Falls back to the kind-mapped default
// (agent ⇒ on) for a run/fixture node predating the field. Shown on the card so an Edits flip
// RE-LABELS it.
function editsAllowedOf(d: AgentNodeData): boolean {
  return d.edits_allowed ?? d.kind === "agent";
}
function capabilityLabel(d: AgentNodeData): string {
  return editsAllowedOf(d) ? "Edits on" : "Edits off";
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

/** F1b: the inline hover affordances rendered inside every EDITABLE node — a coral "+" (opens the
 *  downstream kind picker, anchored at the button's on-screen rect) and a trash (deletes the node).
 *  Nothing renders in the run view (`editable` false), so F1a's card is byte-identical there. `.nodrag`
 *  stops React Flow starting a node drag from the button; `stopPropagation` keeps the click off the
 *  node-select handler.
 *  F-canvas-fidelity-2: reveal is driven by `hovered` (the canvas hover state + a 450ms leave grace),
 *  NOT CSS `:hover` — so the buttons stay clickable while you cross the gap to reach them (Part 1). The
 *  "+" now shows on EVERY node kind (Part 3), not just thinker/worker. */
function NodeAffordances({ nodeId, hovered }: { nodeId: string; hovered?: boolean }) {
  const ctx = useContext(AuthoringContext);
  if (!ctx.editable || !hovered) return null;
  return (
    <>
      <button
        type="button"
        className="rf-node__add nodrag nopan"
        title="Add a downstream node"
        aria-label="Add a downstream node"
        onClick={(e) => {
          e.stopPropagation();
          ctx.requestAdd?.(nodeId, e.currentTarget.getBoundingClientRect());
        }}
      >
        <Plus size={14} strokeWidth={2.2} />
      </button>
      <button
        type="button"
        className="rf-node__del nodrag nopan"
        title="Delete node"
        aria-label="Delete node"
        onClick={(e) => {
          e.stopPropagation();
          ctx.requestDelete?.(nodeId);
        }}
      >
        <Trash2 size={12} strokeWidth={1.8} />
      </button>
    </>
  );
}

/** F1c: the card's model footer. In AUTHOR mode (context `editable` + an `onOpenModel` handler) it
 *  is the express lane to the drawer's Model field — clicking it selects the node AND opens the
 *  config drawer scrolled to + flashing the Model section (`.nodrag .nopan` + `stopPropagation` keep
 *  the click off React Flow's drag/pan + the node-select handler). In the RUN view it stays the F1a
 *  inert label (no handler) — byte-identical DOM. `.rf-node__model` (incl. `cursor:pointer`) is
 *  F1a's canvas.css recipe, untouched. */
function ModelChip({ nodeId, model }: { nodeId: string; model: string }) {
  const ctx = useContext(AuthoringContext);
  const clickable = ctx.editable && !!ctx.onOpenModel;
  return (
    <button
      type="button"
      className={`rf-node__model${clickable ? " nodrag nopan" : ""}`}
      title={clickable ? "Set this node’s model" : model}
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation();
              ctx.onOpenModel?.(nodeId);
            }
          : undefined
      }
    >
      <Cpu size={13} strokeWidth={1.6} />
      <span className="rf-node__model-text">{model}</span>
    </button>
  );
}

/** The agent/completion team-node: a warm paper card — glyph + title + role caption + optional
 *  "round N" badge in the head, a capability + engine + status-pill row, and a clickable model
 *  footer. The entry node adds a coral left-bar + "Start · entry" eyebrow. Running breathes coral;
 *  done/failed stamp a sage-check / red-× corner badge (all driven by canvas.css). */
function AgentCard({ nodeId, data: d }: { nodeId: string; data: AgentNodeData }) {
  // The entry node reads as the "spark" (the design's start glyph) regardless of role; every
  // other node keeps its role glyph.
  const roleIcon = ROLE_ICON[d.role_name] ?? Terminal;
  const Icon = d.isEntry ? Zap : roleIcon;
  const title = ROLE_TITLE[d.role_name] ?? d.role_name;
  const caption = ROLE_BLURB[d.role_name] ?? d.kind;
  // M-unify U3: the capability tag reads the edits distinction (not kind). Edits-off keeps the DS
  // "rare secondary" muted/blue tag the old thinker used; edits-on is the coral (writes-files) tag.
  // An Edits flip re-labels it here (the `--thinker` class is now the edits-off style token).
  const isReadOnly = !editsAllowedOf(d);

  return (
    <div
      className={`rf-node rf-node--${d.status}${d.isEntry ? " rf-node--entry" : ""}${flagClasses(d)}`}
      title={d.errorMessage}
    >
      <NodeHandles />
      <NodeAffordances nodeId={nodeId} hovered={d.hovered} />
      {d.isEntry && <span className="rf-node__bar" aria-hidden />}
      <div className="rf-node__head">
        <span className="rf-node__glyph">
          <Icon size={17} strokeWidth={1.6} />
        </span>
        <div className="rf-node__titles">
          {d.isEntry && <div className="rf-node__eyebrow">Start · entry</div>}
          <div className="rf-node__role">{title}</div>
          <div className="rf-node__caption">{caption}</div>
        </div>
        {d.iteration >= 2 && <span className="rf-node__round">round {d.iteration}</span>}
      </div>
      <div className="rf-node__meta">
        <span className={`rf-node__cap${isReadOnly ? " rf-node__cap--thinker" : ""}`}>
          {capabilityLabel(d)}
        </span>
        {d.engine && <span className="rf-node__engine">{prettyEngine(d.engine)}</span>}
        <StatusPill status={d.status} />
      </div>
      {/* F1c: the model footer opens the drawer's Model field in author mode; inert in the run view. */}
      <ModelChip nodeId={nodeId} model={d.model} />
      {d.status === "done" && (
        <span className="rf-node__badge rf-node__badge--done" aria-hidden>
          <Check size={12} strokeWidth={3} />
        </span>
      )}
      {d.status === "failed" && (
        <span className="rf-node__badge rf-node__badge--failed" aria-hidden>
          <X size={11} strokeWidth={3} />
        </span>
      )}
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
function GateCard({ nodeId, data: d }: { nodeId: string; data: AgentNodeData }) {
  const cfg = (d.config ?? {}) as GateConfig;
  const state = d.gateState ?? "idle";
  const label = gateLabel(cfg.gate_kind ?? d.role_name);
  return (
    <div
      className={`rf-gate rf-gate--${state}${flagClasses(d)}`}
      title={d.errorMessage || cfg.title || label}
    >
      <NodeHandles />
      <NodeAffordances nodeId={nodeId} hovered={d.hovered} />
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
function TerminalCard({ nodeId, data: d }: { nodeId: string; data: AgentNodeData }) {
  const cfg = (d.config ?? {}) as TerminalConfig;
  const kind = cfg.terminal_kind === "ship" ? "ship" : "stop";
  const state = d.terminalState ?? "idle";
  const reached = state !== "idle";
  const Icon = kind === "ship" ? Package : OctagonX;
  const label = kind === "ship" ? (reached ? "Shipped" : "Ship") : reached ? "Stopped" : "Stop";
  return (
    <div
      className={`rf-terminal rf-terminal--${kind} rf-terminal--${state}${flagClasses(d)}`}
      title={d.errorMessage}
    >
      <NodeHandles />
      <NodeAffordances nodeId={nodeId} hovered={d.hovered} />
      <span className="rf-terminal__glyph">
        <Icon size={16} strokeWidth={1.7} />
      </span>
      <div className="rf-terminal__label">{label}</div>
    </div>
  );
}

/** The custom team-node, dispatched by `kind`: gate → checkpoint, terminal → endpoint, and
 *  agent/completion → the paper role card. Every variant carries the same 8-handle scheme. */
export function AgentNodeCard({ id, data }: NodeProps) {
  const d = data as unknown as AgentNodeData;
  if (d.kind === "gate") return <GateCard nodeId={id} data={d} />;
  if (d.kind === "terminal") return <TerminalCard nodeId={id} data={d} />;
  return <AgentCard nodeId={id} data={d} />;
}
