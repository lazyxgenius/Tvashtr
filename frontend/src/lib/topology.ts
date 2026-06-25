// Pure helpers for canvas topology authoring (P1.8d) — the logic the editable canvas + the node
// panel wire up: which edge roles a source may emit, whether a new edge closes a loop, the
// validity-flag lookups, the branch-worker emit-contract, and the auto-layout fallback. Pure +
// framework-free so they unit-test directly (no React, no React Flow).

import type { EdgeRole, GraphEdge, GraphValidity, NodePosition, TeamGraphNode } from "./api";

// ---- Edge-role authoring: offer only what the SOURCE node supports (§6) -------------------------

export interface EdgeRoleOption {
  key: string; // stable option key (unique within an option set)
  role: EdgeRole;
  display: string; // plain language — never raw {when}/loop_limit/escalation
  presetLabel?: string; // a gate's fixed approved/rejected label
  needsLabel?: boolean; // a worker branch — the user types/picks the routing label
  isLoop?: boolean; // a rework loop — needs a bound + an escalation exit
}

/** The edge roles offered when the user draws an edge OUT OF a node of `sourceKind`. Thinkers only
 *  go forward; gates branch on approved/rejected; workers go forward or branch on a verdict label;
 *  an edge that closes a loop (the target is already upstream of the source) is offered ONLY as a
 *  bounded "Rework loop" (the §3 termination guarantee). Terminals have no outgoing step. */
export function edgeRoleOptions(sourceKind: string, closesLoop: boolean): EdgeRoleOption[] {
  if (sourceKind === "terminal") return [];
  if (closesLoop) {
    return [
      {
        key: "rework",
        role: "loop_back",
        display: "Rework loop (bounded — sets a retry limit)",
        isLoop: true,
      },
    ];
  }
  if (sourceKind === "completion") {
    return [{ key: "then", role: "forward", display: "Then →" }];
  }
  if (sourceKind === "gate") {
    return [
      { key: "approved", role: "branch", presetLabel: "approved", display: "If approved →" },
      { key: "rejected", role: "branch", presetLabel: "rejected", display: "If rejected →" },
    ];
  }
  // worker (agent)
  return [
    { key: "then", role: "forward", display: "Then →" },
    { key: "branch", role: "branch", needsLabel: true, display: "When it outputs … →" },
  ];
}

/** Forward-reachable node-id set from `from`, following every edge as a directed transition. */
export function reachableFrom(edges: GraphEdge[], from: string): Set<string> {
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.source_node_id) ?? [];
    list.push(e.target_node_id);
    out.set(e.source_node_id, list);
  }
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const nxt of out.get(cur) ?? []) {
      if (!seen.has(nxt)) {
        seen.add(nxt);
        stack.push(nxt);
      }
    }
  }
  return seen;
}

/** Does adding `source → target` close a loop? Iff `target` can already reach `source` (so `target`
 *  is upstream of `source`), making the new edge a back-edge. */
export function closesLoop(edges: GraphEdge[], source: string, target: string): boolean {
  if (source === target) return true;
  return reachableFrom(edges, target).has(source);
}

/** The `when` labels already used on a worker's branch out-edges — seeds the branch-label combobox
 *  so a second branch reuses the same word (no PASS/Pass drift). */
export function branchLabelsOf(edges: GraphEdge[], sourceId: string): string[] {
  const labels = new Set<string>();
  for (const e of edges) {
    if (e.source_node_id === sourceId && e.conditions?.when) labels.add(e.conditions.when);
  }
  return [...labels];
}

/** The gate/terminal nodes a rework loop may escalate to (its exhaustion exit must be a checkpoint
 *  or an ending — §6). */
export function escalationTargets(nodes: TeamGraphNode[]): TeamGraphNode[] {
  return nodes.filter((n) => n.kind === "gate" || n.kind === "terminal");
}

// ---- Validity flags: node/edge-id → the first issue on it, for canvas red-flagging --------------

export interface ValidityFlags {
  nodeErrors: Map<string, string>; // node_id → message (a blocking issue)
  edgeErrors: Map<string, string>; // edge_id → message
  orphans: Set<string>; // node_id → a warning (dimmed, still runnable)
}

export function validityFlags(validity: GraphValidity | null): ValidityFlags {
  const nodeErrors = new Map<string, string>();
  const edgeErrors = new Map<string, string>();
  const orphans = new Set<string>();
  if (!validity) return { nodeErrors, edgeErrors, orphans };
  for (const issue of validity.errors ?? []) {
    if (issue.edge_id) edgeErrors.set(issue.edge_id, issue.message);
    if (issue.node_id && !nodeErrors.has(issue.node_id))
      nodeErrors.set(issue.node_id, issue.message);
  }
  for (const issue of validity.warnings ?? []) {
    if (issue.code === "orphan" && issue.node_id) orphans.add(issue.node_id);
  }
  return { nodeErrors, edgeErrors, orphans };
}

// ---- The branch-worker emit-contract (anti-drift — the Tvashtr-26 vanished-loop-back bug class) --

export interface EmitContract {
  labels: string[]; // the routing labels the worker must output (its branch out-edges' `when`)
  summary: string; // human one-liner shown in the panel
  promptBlock: string; // the standardized verdict-file instruction "write this into the prompt"
}

/** The emit-contract derived LIVE from a worker's out-edges: the labels it must output to route the
 *  team, plus a standardized prompt block (mirroring REVIEWER_PROMPT's verdict-file contract) the
 *  user can write into the prompt with one click. Single source of truth = the edge labels. Returns
 *  null for a node with no branch out-edge (an unconditional worker has no contract to keep). */
export function emitContract(nodeId: string, edges: GraphEdge[]): EmitContract | null {
  const labels = branchLabelsOf(edges, nodeId);
  if (labels.length === 0) return null;
  const quoted = labels.map((l) => `"${l}"`).join(" or ");
  const summary = `Must output ${quoted} to route the team; anything else loops back for rework.`;
  const promptBlock = [
    "",
    "When you finish, write a file named EXACTLY REVIEW_VERDICT.json in your current working " +
      "directory, containing EXACTLY this JSON and nothing else:",
    `    {"verdict": ${quoted}, "reasons": "<1-3 short, specific sentences>"}`,
    `Use one of these exact verdict values — ${labels.join(", ")} — and nothing else; any other ` +
      "output loops back for rework.",
  ].join("\n");
  return { labels, summary, promptBlock };
}

// A stable marker so re-writing the contract REPLACES the prior block instead of stacking copies.
const CONTRACT_MARKER = "write a file named EXACTLY REVIEW_VERDICT.json";

/** Write (or refresh) the emit-contract block into a prompt: replace from an existing contract
 *  marker if present, else append. Keeps the prompt honest to the edge labels without stacking. */
export function applyEmitContract(prompt: string, block: string): string {
  const idx = prompt.indexOf(CONTRACT_MARKER);
  if (idx >= 0) {
    // Trim back to the start of the line that begins the prior block, then replace to end.
    const lineStart = prompt.lastIndexOf("\n", idx);
    const head = lineStart >= 0 ? prompt.slice(0, lineStart) : "";
    return (head + block).trimEnd() + "\n";
  }
  return prompt.trimEnd() + "\n" + block + "\n";
}

// ---- Auto-layout fallback + drop placement ------------------------------------------------------

function hasPosition(p: NodePosition | undefined | null): boolean {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.x !== 0 || p.y !== 0);
}

/** Fill in positions for nodes that carry none (an empty `{}` — pre-0012 rows, or a node created
 *  without a drop point): a deterministic left-to-right layering from the root, so nothing stacks at
 *  (0,0). Nodes that already have a real position are left exactly as authored/dragged. */
export function withLayout(
  nodes: TeamGraphNode[],
  edges: GraphEdge[],
): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {};
  const needs = nodes.filter((n) => !hasPosition(n.position));
  for (const n of nodes) if (hasPosition(n.position)) positions[n.id] = n.position;
  if (needs.length === 0) return positions;

  // Depth = longest distance from a root (a node no edge targets); fall back to insertion order.
  const targets = new Set(edges.map((e) => e.target_node_id));
  const roots = nodes.filter((n) => !targets.has(n.id)).map((n) => n.id);
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.source_node_id) ?? [];
    list.push(e.target_node_id);
    out.set(e.source_node_id, list);
  }
  const depth = new Map<string, number>();
  const queue = roots.map((id) => [id, 0] as [string, number]);
  for (const r of roots) depth.set(r, 0);
  while (queue.length) {
    const [id, d] = queue.shift()!;
    for (const nxt of out.get(id) ?? []) {
      if (!depth.has(nxt) || depth.get(nxt)! < d + 1) {
        depth.set(nxt, d + 1);
        queue.push([nxt, d + 1]);
      }
    }
  }
  const rowByCol = new Map<number, number>();
  for (const n of needs) {
    const col = depth.get(n.id) ?? nodes.indexOf(n);
    const row = rowByCol.get(col) ?? 0;
    rowByCol.set(col, row + 1);
    positions[n.id] = { x: col * 260, y: row * 150 };
  }
  return positions;
}

/** A free drop point for a newly-added node: to the right of the rightmost node, on the baseline. */
export function nextDropPosition(nodes: TeamGraphNode[]): NodePosition {
  let maxX = 0;
  for (const n of nodes) if (hasPosition(n.position) && n.position.x > maxX) maxX = n.position.x;
  return { x: maxX + 260, y: 0 };
}
