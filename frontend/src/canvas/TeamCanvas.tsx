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

import type { GraphData, GraphNode, RunRow } from "../lib/api";
import { deriveNodeStatus } from "../lib/status";
import { AgentNodeCard, type AgentNodeData } from "./AgentNodeCard";
import { CanvasEmpty } from "./CanvasEmpty";
import { ReworkEdge } from "./ReworkEdge";

const nodeTypes = { agentNode: AgentNodeCard };
const edgeTypes = { rework: ReworkEdge };

/** Raw backend status per node id (idle|running|done|failed|stopped) — the source
 *  for both the predecessor-done overlay and the forward-edge styling. */
function rawStatusById(graph: GraphData): Record<string, string> {
  const m: Record<string, string> = {};
  for (const n of graph.nodes) m[n.id] = n.status;
  return m;
}

/** A node has a done predecessor iff some edge targets it from a node whose raw
 *  backend status is "done" (drives the at-the-gate `paused` overlay: PM done →
 *  Engineer paused at the PRD gate; Reviewer's predecessor still idle → idle). */
function hasDonePredecessor(
  graph: GraphData,
  nodeId: string,
  raw: Record<string, string>,
): boolean {
  return graph.edges.some((e) => e.target_node_id === nodeId && raw[e.source_node_id] === "done");
}

/** The canvas node `data` for one graph node — backend status threaded through the
 *  thin `deriveNodeStatus` overlay, plus the raw iteration for the round badge. */
function nodeData(
  graph: GraphData,
  n: GraphNode,
  run: RunRow | null,
  workflowStatus: string | null,
  raw: Record<string, string>,
): AgentNodeData {
  return {
    role_name: n.role_name,
    kind: n.kind,
    model: n.model,
    engine: n.engine,
    status: deriveNodeStatus(n.status, run, workflowStatus, hasDonePredecessor(graph, n.id, raw)),
    iteration: n.iteration,
  };
}

/** Gently fit the view (bounded, no loop) on a new graph or a panel open/close,
 *  so all nodes stay visible as the canvas resizes beside the side panel. */
function FitView({ trigger }: { trigger: string | null }) {
  const rf = useReactFlow();
  useEffect(() => {
    if (!trigger) return;
    // ~80ms lets the flex layout (and React Flow's resize observer) settle first.
    const t = setTimeout(() => rf.fitView({ padding: 0.5, duration: 320 }), 80);
    return () => clearTimeout(t);
  }, [trigger, rf]);
  return null;
}

export function TeamCanvas({
  graph,
  run,
  workflowStatus,
  panelOpen = false,
  onSelectNode,
}: {
  graph: GraphData | null;
  run: RunRow | null;
  workflowStatus: string | null;
  panelOpen?: boolean;
  onSelectNode?: (role: string | null) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentNodeData>>([]);

  // (Re)build nodes only when the TOPOLOGY changes (a new run) — keyed on run_id so
  // the per-poll graph refetch doesn't rebuild (which would reset dragged positions).
  useEffect(() => {
    if (!graph) {
      setNodes([]);
      return;
    }
    const raw = rawStatusById(graph);
    setNodes(
      graph.nodes.map((n) => ({
        id: n.id,
        type: "agentNode",
        position: n.position,
        data: nodeData(graph, n, run, workflowStatus, raw),
      })),
    );
    // Status/iteration are refreshed in place by the effect below; rebuild only on a
    // new topology (run/workflowStatus intentionally excluded from the deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph?.run_id, setNodes]);

  // Refresh each node's status + iteration on every poll, preserving dragged
  // positions — match graph.nodes by id and replace `data` in place.
  useEffect(() => {
    if (!graph) return;
    const raw = rawStatusById(graph);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    setNodes((nds) =>
      nds.map((nd) => {
        const n = byId.get(nd.id);
        return n ? { ...nd, data: nodeData(graph, n, run, workflowStatus, raw) } : nd;
      }),
    );
  }, [graph, run, workflowStatus, setNodes]);

  const edges: Edge[] = useMemo(() => {
    if (!graph) return [];
    const raw = rawStatusById(graph);
    return graph.edges.map((e) => {
      // The loop-back (conditional) edge → the calm downward "rework" arc, off the
      // bottom handles so it never overlaps the forward edges.
      if (e.conditions) {
        return {
          id: e.id,
          source: e.source_node_id,
          target: e.target_node_id,
          sourceHandle: "loop-out",
          targetHandle: "loop-in",
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
      // Forward edges keep the left→right handles; the class derives per-edge from
      // the adjacent backend statuses (target running → flow; both done → done).
      const s = raw[e.source_node_id];
      const t = raw[e.target_node_id];
      const cls =
        t === "running" ? "rf-edge--flow" : s === "done" && t === "done" ? "rf-edge--done" : "";
      return {
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        sourceHandle: "out",
        targetHandle: "in",
        type: "default",
        className: cls,
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
        onNodeClick={(_event, node) =>
          onSelectNode?.((node.data as unknown as AgentNodeData).role_name)
        }
        onPaneClick={() => onSelectNode?.(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
        <FitView trigger={graph ? `${graph.run_id}:${panelOpen ? "p" : "f"}` : null} />
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
