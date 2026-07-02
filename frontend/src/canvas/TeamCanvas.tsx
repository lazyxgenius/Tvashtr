import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type Node,
  ReactFlow,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";

import type {
  CreateNodeBody,
  GraphData,
  GraphNode,
  GraphValidity,
  HumanTask,
  NodePosition,
  RunRow,
  TeamGraphNode,
  TerminalConfig,
} from "../lib/api";
import { deriveGateState, deriveNodeStatus, deriveTerminalState } from "../lib/status";
import { closesLoop, type ValidityFlags, validityFlags } from "../lib/topology";
import { AgentNodeCard, type AgentNodeData } from "./AgentNodeCard";
import { AuthoringContext } from "./authoringContext";
import { CanvasEmpty } from "./CanvasEmpty";
import { type EdgeConfirm, EdgeRoleEditor, type PendingConnect } from "./EdgeRoleEditor";
import { NodePalette } from "./NodePalette";
import { NodePicker } from "./NodePicker";
import { ReworkEdge } from "./ReworkEdge";
import { WorkEdge } from "./WorkEdge";

const nodeTypes = { agentNode: AgentNodeCard };
const edgeTypes = { rework: ReworkEdge, work: WorkEdge };

const EMPTY_FLAGS: ValidityFlags = {
  nodeErrors: new Map(),
  edgeErrors: new Map(),
  orphans: new Set(),
};

/** Raw backend status per node id (idle|running|done|failed|stopped) — the source for the
 *  forward-edge styling (the class derives from a pair of adjacent raw statuses). */
function rawStatusById(graph: GraphData): Record<string, string> {
  const m: Record<string, string> = {};
  for (const n of graph.nodes) m[n.id] = n.status;
  return m;
}

/** Pick the source/target handles for an edge by geometry, so any branch routes cleanly:
 *  horizontal backbone → right→left (today's look); a downward branch → bottom→top; a
 *  leftward branch → left→right. Pure; generalizes to any authored graph. */
function pickHandles(
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

/** The entry set: a node is an ENTRY iff no FORWARD edge targets it. A forward edge is any edge
 *  that is NOT a bounded loop-back — the loop-back / rework edge carries `conditions.loop_limit`
 *  (P1.8a's no-`when` catch-all), so it must NOT disqualify its target (the Engineer stays the
 *  entry even though the Reviewer loops back to it). Pure FE over the existing graph — no backend
 *  field, no new payload — feeding `AgentNodeData.isEntry` (the coral start-bar + eyebrow). */
function entryNodeIds(graph: GraphData): Set<string> {
  const forwardTargets = new Set<string>();
  for (const e of graph.edges) {
    if (e.conditions?.loop_limit == null) forwardTargets.add(e.target_node_id);
  }
  return new Set(graph.nodes.filter((n) => !forwardTargets.has(n.id)).map((n) => n.id));
}

/** The canvas node `data` for one graph node: the thin agent/completion status overlay, plus
 *  the gate's task-derived state and the terminal's reached-state, threaded for the card to
 *  render by `kind`, plus (P1.8d) any validity flag on the node and (F1a) the entry flag. */
function nodeData(
  n: GraphNode,
  run: RunRow | null,
  workflowStatus: string | null,
  tasks: HumanTask[],
  runId: string,
  flags: ValidityFlags,
  isEntry: boolean,
): AgentNodeData {
  return {
    role_name: n.role_name,
    kind: n.kind,
    model: n.model,
    engine: n.engine,
    config: n.config,
    iteration: n.iteration,
    status: deriveNodeStatus(n.status, run, workflowStatus),
    gateState:
      n.kind === "gate" ? deriveGateState(n.id, runId, tasks, run, workflowStatus) : undefined,
    terminalState:
      n.kind === "terminal"
        ? deriveTerminalState((n.config as TerminalConfig)?.terminal_kind ?? "stop", n.status)
        : undefined,
    errorMessage: flags.nodeErrors.get(n.id),
    isOrphan: flags.orphans.has(n.id),
    isEntry,
  };
}

/** Gently fit the view (bounded, no loop) on a new graph or a panel open/close, so all nodes
 *  stay visible as the canvas resizes beside the side panel. */
function FitView({ trigger }: { trigger: string | null }) {
  const rf = useReactFlow();
  useEffect(() => {
    if (!trigger) return;
    const t = setTimeout(() => void rf.fitView({ padding: 0.5, duration: 320 }), 80);
    return () => clearTimeout(t);
  }, [trigger, rf]);
  return null;
}

/** Frame a single node when the drawer links a blocker card to its paused gate node. */
function FocusNode({ focusNodeId }: { focusNodeId?: string | null }) {
  const rf = useReactFlow();
  useEffect(() => {
    if (!focusNodeId) return;
    const t = setTimeout(
      () => void rf.fitView({ nodes: [{ id: focusNodeId }], duration: 400, maxZoom: 1.2 }),
      60,
    );
    return () => clearTimeout(t);
  }, [focusNodeId, rf]);
  return null;
}

export function TeamCanvas({
  graph,
  run,
  workflowStatus,
  tasks = [],
  focusNodeId = null,
  panelOpen = false,
  onSelectNode,
  // P1.8d topology editing — supplied only in the authoring view.
  editable = false,
  teamNodes = [],
  validity = null,
  onAddNode,
  onAddDownstream,
  onCreateEdge,
  onDeleteNodes,
  onDeleteEdges,
  onMoveNode,
  onSelectNodeId,
  busy = false,
}: {
  graph: GraphData | null;
  run: RunRow | null;
  workflowStatus: string | null;
  tasks?: HumanTask[];
  focusNodeId?: string | null;
  panelOpen?: boolean;
  onSelectNode?: (nodeId: string | null) => void;
  editable?: boolean;
  teamNodes?: TeamGraphNode[];
  validity?: GraphValidity | null;
  busy?: boolean;
  onAddNode?: (body: CreateNodeBody) => void;
  onAddDownstream?: (fromId: string, body: CreateNodeBody) => void;
  onCreateEdge?: (c: EdgeConfirm, source: string, target: string) => void;
  onDeleteNodes?: (ids: string[]) => void;
  onDeleteEdges?: (ids: string[]) => void;
  onMoveNode?: (id: string, position: NodePosition) => void;
  onSelectNodeId?: (id: string | null) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentNodeData>>([]);
  const [pending, setPending] = useState<PendingConnect | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [addPicker, setAddPicker] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const flags = useMemo(
    () => (editable ? validityFlags(validity) : EMPTY_FLAGS),
    [editable, validity],
  );

  // (Re)build nodes when the TOPOLOGY changes. In the run view that's keyed on run_id (so the
  // per-poll graph refetch doesn't reset dragged positions); in the authoring view it's keyed on
  // the node-id SET (so an add/delete rebuilds, while a drag — which doesn't change the set — keeps
  // its position until persisted).
  const topoKey = graph
    ? editable
      ? `${graph.team_graph_id}:${graph.nodes
          .map((n) => n.id)
          .sort()
          .join(",")}`
      : graph.run_id
    : null;
  useEffect(() => {
    if (!graph) {
      setNodes([]);
      return;
    }
    const entry = entryNodeIds(graph);
    setNodes(
      graph.nodes.map((n) => ({
        id: n.id,
        type: "agentNode",
        position: n.position,
        data: nodeData(n, run, workflowStatus, tasks, graph.run_id, flags, entry.has(n.id)),
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reason: rebuild ONLY when the topology (topoKey) changes; run/workflowStatus/tasks/flags refresh in place below so the per-poll refetch + a drag don't rebuild and reset positions.
  }, [topoKey, setNodes]);

  // Refresh each node's state (+ validity flags) on every poll/edit, preserving dragged positions.
  useEffect(() => {
    if (!graph) return;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const entry = entryNodeIds(graph);
    setNodes((nds) =>
      nds.map((nd) => {
        const n = byId.get(nd.id);
        return n
          ? {
              ...nd,
              data: nodeData(n, run, workflowStatus, tasks, graph.run_id, flags, entry.has(n.id)),
            }
          : nd;
      }),
    );
  }, [graph, run, workflowStatus, tasks, flags, setNodes]);

  useEffect(() => {
    if (!focusNodeId) return;
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === focusNodeId })));
  }, [focusNodeId, setNodes]);

  const handleConnect = useCallback(
    (c: Connection) => {
      if (!editable || !graph || !c.source || !c.target) return;
      if (c.source === c.target) return;
      const src = graph.nodes.find((n) => n.id === c.source);
      const tgt = graph.nodes.find((n) => n.id === c.target);
      if (!src || !tgt) return;
      setPending({
        source: c.source,
        target: c.target,
        sourceKind: src.kind,
        sourceLabel: src.role_name,
        targetLabel: tgt.role_name,
        closesLoop: closesLoop(graph.edges, c.source, c.target),
      });
    },
    [editable, graph],
  );

  const edges: Edge[] = useMemo(() => {
    if (!graph) return [];
    const raw = rawStatusById(graph);
    const posById: Record<string, NodePosition> = {};
    for (const n of graph.nodes) posById[n.id] = n.position;

    return graph.edges.map((e) => {
      const invalid = flags.edgeErrors.has(e.id) ? " rf-edge--invalid" : "";
      // F1b: the shared authoring affordance data — the hover-revealed midpoint trash. `editable`
      // gates it off in the run view; `hovered` is driven by the edge's own transparent hit-path.
      const authoring = {
        editable,
        hovered: hoveredEdgeId === e.id,
        onHover: (h: boolean) => setHoveredEdgeId(h ? e.id : null),
        onDelete: () => onDeleteEdges?.([e.id]),
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
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "var(--rework-stroke)",
            width: 16,
            height: 16,
          },
          data: authoring,
        };
      }

      // 2. Every other edge routes by geometry; the class is by category, rendered through the
      //    custom WorkEdge (so it carries the midpoint trash + an optional branch label).
      const { sourceHandle, targetHandle } = pickHandles(
        posById[e.source_node_id],
        posById[e.target_node_id],
      );
      let className: string;
      let markerEnd;
      if (e.conditions?.when === "rejected") {
        className = "rf-edge--reject";
        markerEnd = {
          type: MarkerType.ArrowClosed,
          color: "var(--branch-stroke)",
          width: 14,
          height: 14,
        };
      } else if (e.edge_type === "escalation") {
        className = "rf-edge--escalation";
        markerEnd = {
          type: MarkerType.ArrowClosed,
          color: "var(--branch-stroke)",
          width: 14,
          height: 14,
        };
      } else {
        const s = raw[e.source_node_id];
        const t = raw[e.target_node_id];
        className =
          t === "running" ? "rf-edge--flow" : s === "done" && t === "done" ? "rf-edge--done" : "";
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
  }, [graph, flags, editable, hoveredEdgeId, onDeleteEdges]);

  // F1b: provided just above <ReactFlow> so the custom node cards (rendered deep in React Flow's
  // subtree) reach the inline affordance callbacks without threading them through node data (which
  // would rebuild the node set on every render). `editable` gates the affordances entirely.
  const authoringValue = useMemo(
    () => ({
      editable,
      requestAdd: (nodeId: string, anchor: DOMRect) => {
        const rect = containerRef.current?.getBoundingClientRect();
        setAddPicker({
          nodeId,
          x: (rect ? anchor.right - rect.left : anchor.right) + 8,
          y: rect ? anchor.top - rect.top : anchor.top,
        });
      },
      requestDelete: (nodeId: string) => onDeleteNodes?.([nodeId]),
    }),
    [editable, onDeleteNodes],
  );

  return (
    <AuthoringContext.Provider value={authoringValue}>
      <div className="relative h-full w-full" ref={containerRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.5 }}
          minZoom={0.4}
          maxZoom={1.75}
          connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 2, strokeDasharray: "5 5" }}
          nodesConnectable={editable}
          nodesDraggable={editable || undefined}
          elementsSelectable
          deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
          onConnect={editable ? handleConnect : undefined}
          onNodesDelete={
            editable && onDeleteNodes
              ? (deleted) => onDeleteNodes(deleted.map((n) => n.id))
              : undefined
          }
          onEdgesDelete={
            editable && onDeleteEdges
              ? (deleted) => onDeleteEdges(deleted.map((e) => e.id))
              : undefined
          }
          onNodeDragStop={
            editable && onMoveNode ? (_e, node) => onMoveNode(node.id, node.position) : undefined
          }
          onNodeClick={(_event, node) => {
            const data = node.data;
            if (data.kind === "agent" || data.kind === "completion") {
              if (editable) onSelectNodeId?.(node.id);
              else onSelectNode?.(node.id);
            }
          }}
          onPaneClick={() => {
            if (editable) onSelectNodeId?.(null);
            else onSelectNode?.(null);
            setPending(null);
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={26} size={1.1} />
          <FitView trigger={graph ? `${graph.run_id}:${panelOpen ? "p" : "f"}` : null} />
          <FocusNode focusNodeId={focusNodeId} />
          {graph && <Controls showInteractive={false} />}
          {graph && (
            <MiniMap
              pannable
              zoomable
              nodeStrokeWidth={0}
              nodeBorderRadius={3}
              nodeColor={() => "var(--stone-400)"}
            />
          )}
        </ReactFlow>
        {editable && onAddNode && <NodePalette onAdd={onAddNode} disabled={busy} />}
        {editable && pending && onCreateEdge && (
          <EdgeRoleEditor
            pending={pending}
            nodes={teamNodes}
            edges={graph?.edges ?? []}
            onConfirm={(c) => {
              onCreateEdge(c, pending.source, pending.target);
              setPending(null);
            }}
            onCancel={() => setPending(null)}
          />
        )}
        {!graph && <CanvasEmpty />}
        {editable && addPicker && onAddDownstream && (
          <NodePicker
            x={addPicker.x}
            y={addPicker.y}
            onPick={(body) => {
              onAddDownstream(addPicker.nodeId, body);
              setAddPicker(null);
            }}
            onCancel={() => setAddPicker(null)}
          />
        )}
      </div>
    </AuthoringContext.Provider>
  );
}
