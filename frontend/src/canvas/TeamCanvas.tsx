import { useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
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
  GraphData,
  GraphNode,
  HumanTask,
  NodePosition,
  RunRow,
  TerminalConfig,
} from "../lib/api";
import { deriveGateState, deriveNodeStatus, deriveTerminalState } from "../lib/status";
import { AgentNodeCard, type AgentNodeData } from "./AgentNodeCard";
import { CanvasEmpty } from "./CanvasEmpty";
import { ReworkEdge } from "./ReworkEdge";

const nodeTypes = { agentNode: AgentNodeCard };
const edgeTypes = { rework: ReworkEdge };

/** Raw backend status per node id (idle|running|done|failed|stopped) — the source for the
 *  forward-edge styling (the class derives from a pair of adjacent raw statuses). */
function rawStatusById(graph: GraphData): Record<string, string> {
  const m: Record<string, string> = {};
  for (const n of graph.nodes) m[n.id] = n.status;
  return m;
}

/** Pick the source/target handles for an edge by geometry, so any branch routes cleanly:
 *  horizontal backbone → right→left (today's look); a downward branch → bottom→top; a
 *  leftward branch → left→right. Pure; generalizes to any future Supervisor graph. */
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

/** The canvas node `data` for one graph node: the thin agent/completion status overlay, plus
 *  the gate's task-derived state and the terminal's reached-state, threaded for the card to
 *  render by `kind`. (`config` carries the gate/terminal metadata.) */
function nodeData(
  n: GraphNode,
  run: RunRow | null,
  workflowStatus: string | null,
  tasks: HumanTask[],
  runId: string,
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
  };
}

/** Gently fit the view (bounded, no loop) on a new graph or a panel open/close, so all nodes
 *  stay visible as the canvas resizes beside the side panel. */
function FitView({ trigger }: { trigger: string | null }) {
  const rf = useReactFlow();
  useEffect(() => {
    if (!trigger) return;
    // ~80ms lets the flex layout (and React Flow's resize observer) settle first.
    const t = setTimeout(() => void rf.fitView({ padding: 0.5, duration: 320 }), 80);
    return () => clearTimeout(t);
  }, [trigger, rf]);
  return null;
}

/** Frame a single node when the drawer links a blocker card to its paused gate node. The
 *  selection ring is set in the parent (controlled nodes); this only does the camera move. */
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
}: {
  graph: GraphData | null;
  run: RunRow | null;
  workflowStatus: string | null;
  tasks?: HumanTask[];
  focusNodeId?: string | null;
  panelOpen?: boolean;
  onSelectNode?: (role: string | null) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentNodeData>>([]);

  // (Re)build nodes only when the TOPOLOGY changes (a new run) — keyed on run_id so the
  // per-poll graph refetch doesn't rebuild (which would reset dragged positions).
  useEffect(() => {
    if (!graph) {
      setNodes([]);
      return;
    }
    setNodes(
      graph.nodes.map((n) => ({
        id: n.id,
        type: "agentNode",
        position: n.position,
        data: nodeData(n, run, workflowStatus, tasks, graph.run_id),
      })),
    );
    // Status/state are refreshed in place by the effect below; rebuild only on a new topology.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reason: rebuild ONLY when the topology (graph.run_id) changes; run/workflowStatus/tasks are intentionally omitted so the per-poll graph refetch doesn't rebuild the nodes and reset dragged positions — the effect just below refreshes their state in place.
  }, [graph?.run_id, setNodes]);

  // Refresh each node's state on every poll, preserving dragged positions + selection —
  // match graph.nodes by id and replace `data` in place. `tasks` is a dep so a gate flips
  // state (awaiting → approved/stopped) the moment its task changes.
  useEffect(() => {
    if (!graph) return;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    setNodes((nds) =>
      nds.map((nd) => {
        const n = byId.get(nd.id);
        return n ? { ...nd, data: nodeData(n, run, workflowStatus, tasks, graph.run_id) } : nd;
      }),
    );
  }, [graph, run, workflowStatus, tasks, setNodes]);

  // Card → node link: draw the selection ring on the focused gate node (controlled nodes,
  // so selection is set here; the camera move lives in <FocusNode>). Keyed on focusNodeId
  // only, so it doesn't fight a user's canvas click-selection on every poll.
  useEffect(() => {
    if (!focusNodeId) return;
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === focusNodeId })));
  }, [focusNodeId, setNodes]);

  const edges: Edge[] = useMemo(() => {
    if (!graph) return [];
    const raw = rawStatusById(graph);
    const posById: Record<string, NodePosition> = {};
    for (const n of graph.nodes) posById[n.id] = n.position;

    return graph.edges.map((e) => {
      // 1. The Reviewer -> Engineer loop-back → the calm dashed arc, off the bottom handles.
      //    This is the ONLY edge that uses ReworkEdge. P1.8a retopologized the loop-back to
      //    the no-`when` catch-all `{loop_limit: N}`, so we identify it by that key — the same
      //    unique signal the backend's `loop_limit_for` reads — NOT the stale
      //    `when === "changes_requested"`, which now matches no seeded edge.
      if (e.conditions?.loop_limit != null) {
        return {
          id: e.id,
          source: e.source_node_id,
          target: e.target_node_id,
          sourceHandle: "s-bottom",
          targetHandle: "t-bottom",
          type: "rework",
          className: "rf-edge--rework",
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "var(--rework-stroke)",
            width: 16,
            height: 16,
          },
        };
      }

      // 2. Every other edge routes by geometry; the class is by category.
      const { sourceHandle, targetHandle } = pickHandles(
        posById[e.source_node_id],
        posById[e.target_node_id],
      );
      let className: string; // assigned in every branch below
      let markerEnd;
      if (e.conditions?.when === "rejected") {
        // a muted, calm branch to a stop terminal
        className = "rf-edge--reject";
        markerEnd = {
          type: MarkerType.ArrowClosed,
          color: "var(--branch-stroke)",
          width: 14,
          height: 14,
        };
      } else if (e.edge_type === "escalation") {
        // the cap-exhaustion route to the escalation gate
        className = "rf-edge--escalation";
        markerEnd = {
          type: MarkerType.ArrowClosed,
          color: "var(--branch-stroke)",
          width: 14,
          height: 14,
        };
      } else {
        // forward (unconditional, or the `approved` branch) — styled from adjacent statuses
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
        type: "default",
        className,
        markerEnd,
        animated: false,
      };
    });
  }, [graph]);

  return (
    <div className="relative h-full w-full">
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
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_event, node) => {
          // Only inspectable roles open the side panel; gate/terminal nodes have no role
          // panel (the React Flow selection ring still works for any node). `node.data` is
          // already typed `AgentNodeData` (the nodes are `Node<AgentNodeData>`), so no cast.
          const data = node.data;
          if (data.kind === "agent" || data.kind === "completion") onSelectNode?.(data.role_name);
        }}
        onPaneClick={() => onSelectNode?.(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
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
      {!graph && <CanvasEmpty />}
    </div>
  );
}
