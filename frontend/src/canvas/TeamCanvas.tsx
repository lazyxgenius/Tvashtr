import { useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  ReactFlow,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";

import type { GraphData, RunRow } from "../lib/api";
import { deriveNodeStatus, type NodeStatus } from "../lib/status";
import { AgentNodeCard, type AgentNodeData } from "./AgentNodeCard";
import { CanvasEmpty } from "./CanvasEmpty";

const nodeTypes = { agentNode: AgentNodeCard };

/** Gently fit the view once whenever a new team graph loads (bounded, no loop). */
function FitView({ trigger }: { trigger: string | null }) {
  const rf = useReactFlow();
  useEffect(() => {
    if (!trigger) return;
    const t = setTimeout(() => rf.fitView({ padding: 0.5, duration: 320 }), 60);
    return () => clearTimeout(t);
  }, [trigger, rf]);
  return null;
}

export function TeamCanvas({
  graph,
  run,
  workflowStatus,
}: {
  graph: GraphData | null;
  run: RunRow | null;
  workflowStatus: string | null;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);

  // (Re)build nodes when the team graph changes — i.e. a new run.
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
        data: {
          role_name: n.role_name,
          kind: n.kind,
          model: n.model,
          engine: n.engine,
          status: deriveNodeStatus(n.role_name, run, workflowStatus),
        },
      })),
    );
    // Status is refreshed by the effect below; rebuild only on graph change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, setNodes]);

  // Refresh per-node status on every poll, preserving any dragged positions.
  useEffect(() => {
    setNodes((nds) =>
      nds.map((nd) => {
        const data = nd.data as unknown as AgentNodeData;
        return { ...nd, data: { ...data, status: deriveNodeStatus(data.role_name, run, workflowStatus) } };
      }),
    );
  }, [run, workflowStatus, setNodes]);

  const edges: Edge[] = useMemo(() => {
    if (!graph) return [];
    const st: Record<string, NodeStatus> = {};
    for (const n of graph.nodes) {
      st[n.role_name] = deriveNodeStatus(n.role_name, run, workflowStatus);
    }
    const cls =
      st["engineer"] === "done"
        ? "rf-edge--done"
        : st["pm"] === "done" && st["engineer"] === "running"
          ? "rf-edge--flow"
          : "";
    return graph.edges.map((e) => ({
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      type: "default",
      className: cls,
      animated: false,
    }));
  }, [graph, run, workflowStatus]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.5 }}
        minZoom={0.4}
        maxZoom={1.75}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
        <FitView trigger={graph?.run_id ?? null} />
        {graph && <Controls showInteractive={false} />}
        {graph && (
          <MiniMap pannable zoomable nodeStrokeWidth={0} nodeColor={() => "var(--stone-400)"} />
        )}
      </ReactFlow>
      {!graph && <CanvasEmpty />}
    </div>
  );
}
