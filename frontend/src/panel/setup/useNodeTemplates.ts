/**
 * The four built-in agent templates (GET /api/node-templates) for the Templates menu and the new
 * agent's template chooser. They're code-resident on the server, so one fetch serves the session;
 * a failed fetch is retried the next time a drawer asks.
 */
import { useEffect, useState } from "react";

import { getNodeTemplates, type NodeTemplate } from "../../lib/api/nodes";

let cached: Promise<NodeTemplate[]> | null = null;

function loadTemplates(): Promise<NodeTemplate[]> {
  if (!cached) {
    cached = getNodeTemplates().catch((err: unknown) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

/** Tests: forget the session's templates. */
export function resetNodeTemplates(): void {
  cached = null;
}

export type NodeTemplatesState =
  | { status: "loading"; templates: NodeTemplate[] }
  | { status: "ready"; templates: NodeTemplate[] }
  | { status: "error"; templates: NodeTemplate[] };

export function useNodeTemplates(): NodeTemplatesState {
  const [state, setState] = useState<NodeTemplatesState>({ status: "loading", templates: [] });
  useEffect(() => {
    let live = true;
    loadTemplates().then(
      (templates) => live && setState({ status: "ready", templates }),
      () => live && setState({ status: "error", templates: [] }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
