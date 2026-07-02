import { createContext } from "react";

// F1b: the inline authoring affordances (the hover "+" and the hover trash) live INSIDE the custom
// node component (`AgentNodeCard`), which React Flow renders deep in its own subtree. Threading
// per-node callbacks through node `data` would rebuild the node set (the topoKey memo) on every
// canvas re-render; a small context provided just above `<ReactFlow>` reaches the node components
// without touching their data. `editable` gates whether the affordances render at all (run view =
// false → nothing extra in the DOM, so F1a's non-editable card is byte-identical).
export interface CanvasAuthoring {
  editable: boolean;
  // The node's "+" was clicked — open the kind picker anchored at the button's on-screen rect.
  requestAdd?: (nodeId: string, anchor: DOMRect) => void;
  // The node's trash was clicked — delete this node (wired to the existing onDeleteNodes handler).
  requestDelete?: (nodeId: string) => void;
}

export const AuthoringContext = createContext<CanvasAuthoring>({ editable: false });
