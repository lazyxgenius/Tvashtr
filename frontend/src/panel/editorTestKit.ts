/**
 * Shared fixtures for the agent editor's flow tests (the Output format editor, focus mode): a small
 * team — Product manager → Engineer → Reviewer, whose "approved" arrow goes to Ship and whose
 * other verdicts loop back to the Engineer — and a `fetch` stub that records every call.
 */
import { vi } from "vitest";

import type { GraphEdge, ProviderCatalogueEntry, TeamGraphNode } from "../lib/api";

export const REVIEWER_PROMPT = [
  "You are the Reviewer.",
  'Write REVIEW_VERDICT.json: {"verdict": "approved" | "changes_requested"}',
  "Run the tests first.",
].join("\n");

export function reviewer(over: Partial<TeamGraphNode> = {}): TeamGraphNode {
  return {
    id: "n-rev",
    role_name: "reviewer",
    kind: "agent",
    model: "xai/grok-4.7",
    engine: "openhands",
    prompt: REVIEWER_PROMPT,
    position: { x: 0, y: 0 },
    edits_allowed: false,
    config: { title: "Reviewer", description: "Checks against the spec" },
    skills: null,
    tool_config: null,
    last_run: null,
    ...over,
  };
}

export const pm: TeamGraphNode = {
  ...reviewer(),
  id: "n-pm",
  role_name: "pm",
  kind: "completion",
  prompt: "Write the spec.",
  config: { title: "Product manager", description: "Drafts the spec" },
};
export const engineer: TeamGraphNode = {
  ...pm,
  id: "n-eng",
  role_name: "engineer",
  kind: "agent",
  config: null,
};
export const ship: TeamGraphNode = {
  ...pm,
  id: "n-ship",
  role_name: "ship",
  kind: "terminal",
  model: null,
  prompt: null,
  config: { terminal_kind: "ship" },
};

const edge = (
  id: string,
  source: string,
  target: string,
  conditions: GraphEdge["conditions"] = null,
): GraphEdge => ({
  id,
  source_node_id: source,
  target_node_id: target,
  edge_type: "default",
  conditions,
});
export const edges: GraphEdge[] = [
  edge("e1", "n-pm", "n-eng"),
  edge("e2", "n-eng", "n-rev"),
  edge("e3", "n-rev", "n-ship", { when: "approved" }),
  edge("e4", "n-rev", "n-eng", { loop_limit: 3 }),
];

export const CATALOGUE: ProviderCatalogueEntry[] = [
  {
    provider: "xai",
    thinker_default: "xai/grok-4.7",
    worker_default: "xai/grok-4.7",
    thinker_presets: ["xai/grok-4.7"],
    worker_presets: ["xai/grok-4.7"],
    label: "xAI",
    model_labels: { "xai/grok-4.7": "Grok 4.7" },
  },
];

export const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

type Handler = (url: string, init?: RequestInit) => Promise<Response> | undefined;

/** Stub `fetch`: `handler` answers first; memories, templates and PATCH have defaults. */
export function stubFetch(saved: () => TeamGraphNode, handler?: Handler) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const own = handler?.(input, init);
    if (own) return own;
    const method = init?.method ?? "GET";
    if (input.startsWith("/api/memories")) return json({ memories: [] });
    if (input === "/api/node-templates") return json({ templates: [] });
    if (method === "PATCH") return json(saved());
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The JSON body of the first call with `method` (and a URL containing `part`, if given). */
export function bodyOf(
  fetchMock: ReturnType<typeof vi.fn>,
  method: string,
  part = "",
): Record<string, unknown> | undefined {
  const call = fetchMock.mock.calls.find(
    (c) => (c[1] as RequestInit | undefined)?.method === method && String(c[0]).includes(part),
  );
  return call
    ? (JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>)
    : undefined;
}
