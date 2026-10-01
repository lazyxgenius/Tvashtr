import { agoShort, duration } from "../panel/run/live/liveFormat";
import { useContext } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import {
  Check,
  ClipboardCheck,
  DraftingCompass,
  FileText,
  type LucideIcon,
  OctagonX,
  Package,
  PenLine,
  Pin,
  Plus,
  ShieldCheck,
  Sparkle,
  Terminal,
  Trash2,
  X,
  Zap,
} from "lucide-react";

import { AgentDomainsLine, QueryDomainCardBody } from "../pages/domains/QueryDomainCardBody";
import { AuthoringContext } from "./authoringContext";
import { docLabel } from "../panel/docs/agentDocs";
import type { GateConfig, NodeConfig, TerminalConfig } from "../lib/api";
import { nodeDescription, nodeTitle } from "../lib/nodeNames";
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
  // Revamp Domains (DM-99): the first blocking validity code, the last round's outcome and the
  // agent's tools (for "Can search <domain>"). VISUAL only.
  errorCode?: string;
  lastOutcome?: string | null;
  toolConfig?: Record<string, unknown> | null;
  // M2 (run view): what the step is doing now — its live state, activity line and when it last
  // moved. Absent in authoring and for a step that is not running.
  live?: {
    state: string;
    activity: string | null;
    at: string | null;
    retry?: { attempt: number; of: number } | null;
  };
};

/** The authoring overlay classes for a node (P1.8d): a red ring for a blocking issue, a dim for an
 *  orphan warning. Empty in the run view (no flags set). */
// M2: the run view's new R1 states, drawn beside the card's unchanged status chip, and the ring
// a silent or retrying step wears (Runs › Live-Command / Live-Retrying / Live-Quiet, Prob-Stalled).
const LIVE_CHIP: Record<string, [string, "live" | "warn" | "danger"]> = {
  running_command: ["Running a command", "live"],
  retrying: ["Retrying", "warn"],
  quiet: ["Quiet", "warn"],
  stalled: ["Stalled", "danger"],
};
const LIVE_RING = new Set(["retrying", "quiet", "stalled"]);

/** The live chip's words: "Retrying 2 of 3", "Quiet · 1m 32s", "Stalled · 5m 10s". */
function liveChipText(live: NonNullable<AgentNodeData["live"]>): string {
  const word = LIVE_CHIP[live.state][0];
  if (live.state === "retrying" && live.retry)
    return `${word} ${live.retry.attempt} of ${live.retry.of}`;
  if ((live.state === "quiet" || live.state === "stalled") && live.at) {
    return `${word} · ${duration((Date.now() - Date.parse(live.at)) / 1000)}`;
  }
  return word;
}

function flagClasses(d: AgentNodeData): string {
  return `${d.errorMessage ? " tv-node--invalid" : ""}${d.isOrphan ? " tv-node--orphan" : ""}`;
}

const ROLE_ICON: Record<string, LucideIcon> = {
  pm: PenLine,
  architect: DraftingCompass,
  engineer: Terminal,
  reviewer: ClipboardCheck,
  // A blank agent (the palette's Thinker / Worker) until a template gives it a role.
  thinker: Sparkle,
  worker: Sparkle,
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
      <span className="rf-node__model-text">{model}</span>
    </button>
  );
}

/** DOCS-11: the documents this agent wrote, as chips straddling the card's lower-left edge ("Shared
 *  spec v3" coral, "build-notes v2" neutral); a click opens the document. A `NodeToolbar`, so the
 *  chips keep their size at any zoom. */
function DocChips({ nodeId }: { nodeId: string }) {
  const { docChips, onOpenDoc } = useContext(AuthoringContext);
  const docs = docChips?.get(nodeId);
  if (!docs?.length) return null;
  return (
    <NodeToolbar
      isVisible
      position={Position.Bottom}
      align="start"
      offset={-12}
      className="cv-doc-chips nodrag nopan"
    >
      {docs.map((doc) => (
        <button
          key={doc.id}
          type="button"
          className={`cv-doc-chip${doc.is_shared_spec ? " cv-doc-chip--shared" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenDoc?.(doc);
          }}
        >
          {doc.is_shared_spec ? (
            <Pin size={11} strokeWidth={1.6} aria-hidden />
          ) : (
            <FileText size={11} strokeWidth={1.6} aria-hidden />
          )}
          {docLabel(doc)} v{doc.latest_version?.version_no}
        </button>
      ))}
    </NodeToolbar>
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
  // The agent's own name and tagline (`config.title` / `config.description`), else its role's.
  const title = nodeTitle(d);
  const caption = nodeDescription(d) || d.kind;
  // M-unify U3: the capability tag reads the edits distinction (not kind). Edits-off keeps the DS
  // "rare secondary" muted/blue tag the old thinker used; edits-on is the coral (writes-files) tag.
  // An Edits flip re-labels it here (the `--thinker` class is now the edits-off style token).
  const isReadOnly = !editsAllowedOf(d);

  return (
    <div
      className={`rf-node rf-node--${d.status}${d.isEntry ? " rf-node--entry" : ""}${flagClasses(d)}${d.live && LIVE_RING.has(d.live.state) ? ` rf-node--live-${d.live.state}` : ""}`}
      title={d.errorMessage}
    >
      <NodeHandles />
      <NodeAffordances nodeId={nodeId} hovered={d.hovered} />
      {d.isEntry && <span className="rf-node__bar" aria-hidden />}
      <div className="rf-node__head">
        <span className="rf-node__glyph">
          <Icon size={13} strokeWidth={1.7} />
        </span>
        <div className="rf-node__titles">
          {d.isEntry && <div className="rf-node__eyebrow">Start · entry</div>}
          <div className="rf-node__role">{title}</div>
          <div className="rf-node__caption">{caption}</div>
        </div>
        {d.iteration >= 2 && <span className="rf-node__round">round {d.iteration}</span>}
      </div>
      <AgentDomainsLine toolConfig={d.toolConfig} />
      <div className="rf-node__meta">
        <span className={`rf-node__cap${isReadOnly ? " rf-node__cap--thinker" : ""}`}>
          {capabilityLabel(d)}
        </span>
        {d.engine && <span className="rf-node__engine">{prettyEngine(d.engine)}</span>}
        <CardStatus status={d.status} />
        {d.live && LIVE_CHIP[d.live.state] && (
          <span className={`rf-node__livechip rf-node__livechip--${LIVE_CHIP[d.live.state][1]}`}>
            ● {liveChipText(d.live)}
          </span>
        )}
      </div>
      {d.live?.activity && (
        <div className="rf-node__live">
          <span>{d.live.activity}</span>
          <span className="rf-node__live-ago">{agoShort(d.live.at)}</span>
        </div>
      )}
      {/* F1c: the model footer opens the drawer's Model field in author mode; inert in the run view. */}
      <ModelChip nodeId={nodeId} model={d.model} />
      <DocChips nodeId={nodeId} />
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
  const label = nodeTitle(d);
  return (
    <div
      className={`rf-gate rf-gate--${state}${flagClasses(d)}`}
      title={d.errorMessage || cfg.title || label}
    >
      <NodeHandles />
      <NodeAffordances nodeId={nodeId} hovered={d.hovered} />
      <span className="rf-gate__glyph">
        <ShieldCheck size={13} strokeWidth={1.7} />
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
        <Icon size={14} strokeWidth={1.7} />
      </span>
      <div className="rf-terminal__label">{label}</div>
    </div>
  );
}

/** Phase 4a: compact Query-domain card — eyebrow + title + domain-selected blurb. */
function DomainQueryCard({ nodeId, data: d }: { nodeId: string; data: AgentNodeData }) {
  return (
    <div className={`rf-node rf-node--domain-query${flagClasses(d)}`} title={d.errorMessage}>
      <NodeHandles />
      <NodeAffordances nodeId={nodeId} hovered={d.hovered} />
      <QueryDomainCardBody
        config={d.config}
        errorCode={d.errorCode}
        lastOutcome={d.lastOutcome}
        failed={d.status === "failed"}
      />
      <CardStatus status={d.status} />
    </div>
  );
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: "Waiting",
  running: "Working…",
  done: "Done",
  stopped: "Stopped",
  failed: "Failed",
};

/** The card's status chip, as the canvas design draws it: "● Waiting" (✓ once done). */
function CardStatus({ status }: { status: NodeStatus }) {
  return (
    <span className={`rf-node__status rf-node__status--${status}`}>
      {status === "done" ? "✓" : "●"} {STATUS_LABEL[status]}
    </span>
  );
}

/** The custom team-node, dispatched by `kind`: gate → checkpoint, terminal → endpoint,
 *  domain_query → Query domain card, and agent/completion → the paper role card. */
export function AgentNodeCard({ id, data }: NodeProps) {
  const d = data as unknown as AgentNodeData;
  if (d.kind === "gate") return <GateCard nodeId={id} data={d} />;
  if (d.kind === "terminal") return <TerminalCard nodeId={id} data={d} />;
  if (d.kind === "domain_query") return <DomainQueryCard nodeId={id} data={d} />;
  return <AgentCard nodeId={id} data={d} />;
}
