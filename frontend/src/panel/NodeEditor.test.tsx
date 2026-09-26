import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type GraphEdge, setProviderCatalogue, type TeamGraphNode } from "../lib/api";
import { __resetBackendStatusForTests } from "../lib/backendStatus";
import { NodeEditor, type NodeEditorProps } from "./NodeEditor";

// The agent drawer (G1): the shell, header badges, tab counts, the Setup read view and the save
// footer, driven through the real API client with `fetch` stubbed.

const PROMPT = [
  'Write REVIEW_VERDICT.json: {"verdict": "approved" | "changes_requested"}',
  ...Array.from({ length: 37 }, (_, i) => `Line ${i + 2}`),
].join("\n");

function reviewer(over: Partial<TeamGraphNode> = {}): TeamGraphNode {
  return {
    id: "n-rev",
    role_name: "reviewer",
    kind: "agent",
    model: "xai/grok-4.7",
    engine: "openhands",
    prompt: PROMPT,
    position: { x: 0, y: 0 },
    edits_allowed: false,
    config: { title: "Reviewer", description: "Checks against the spec" },
    skills: [
      { type: "inline", name: "house-style", content: "x", mode: "always" },
      { type: "project_rules" },
    ],
    tool_config: { mcpServers: { fetch: { command: "uvx" }, github: { url: "https://x" } } },
    last_run: {
      outcome: "changes_requested",
      outcome_detail: null,
      run_id: "r1",
      iteration: 3,
      started_at: new Date(Date.now() - 33 * 60_000).toISOString(),
      status: "done",
      ended_at: new Date(Date.now() - 31 * 60_000).toISOString(),
    },
    ...over,
  };
}

const pm: TeamGraphNode = {
  ...reviewer(),
  id: "n-pm",
  role_name: "pm",
  kind: "completion",
  prompt: "Write the spec.",
  config: { title: "Product manager", description: "Drafts the spec" },
  skills: null,
  tool_config: null,
  last_run: null,
};
const engineer: TeamGraphNode = { ...pm, id: "n-eng", role_name: "engineer", config: null };
const ship: TeamGraphNode = {
  ...pm,
  id: "n-ship",
  role_name: "ship",
  kind: "terminal",
  model: null,
  prompt: null,
  config: { terminal_kind: "ship" },
};
const edges: GraphEdge[] = [
  {
    id: "e1",
    source_node_id: "n-pm",
    target_node_id: "n-eng",
    edge_type: "default",
    conditions: null,
  },
  {
    id: "e2",
    source_node_id: "n-eng",
    target_node_id: "n-rev",
    edge_type: "default",
    conditions: null,
  },
  {
    id: "e3",
    source_node_id: "n-rev",
    target_node_id: "n-ship",
    edge_type: "default",
    conditions: { when: "approved" },
  },
  {
    id: "e4",
    source_node_id: "n-rev",
    target_node_id: "n-eng",
    edge_type: "default",
    conditions: { loop_limit: 3 },
  },
];

let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const patchBody = () => {
  const call = fetchMock.mock.calls.find(
    (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
  );
  return call ? (JSON.parse((call[1] as RequestInit).body as string) as unknown) : undefined;
};

beforeEach(() => {
  setProviderCatalogue([
    {
      provider: "xai",
      thinker_default: "xai/grok-4.7",
      worker_default: "xai/grok-4.7",
      thinker_presets: ["xai/grok-4.7"],
      worker_presets: ["xai/grok-4.7"],
      label: "xAI",
      model_labels: { "xai/grok-4.7": "Grok 4.7" },
    },
  ]);
  fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (input.startsWith("/api/memories")) {
      const pending = input.includes("status=pending_review");
      return json({ memories: pending ? [{ id: "m3" }] : [{ id: "m1" }, { id: "m2" }] });
    }
    if (method === "PATCH") return json(reviewer());
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setProviderCatalogue([]);
  __resetBackendStatusForTests();
});

function renderEditor(over: Partial<NodeEditorProps> = {}) {
  const props: NodeEditorProps = {
    teamId: "t1",
    node: reviewer(),
    nodes: [pm, engineer, reviewer(), ship],
    edges,
    isEntry: false,
    cover: { byok: new Set(["xai"]), subs: {} },
    tab: "setup",
    onTabChange: vi.fn(),
    focus: false,
    onFocusChange: vi.fn(),
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...over,
  };
  render(<NodeEditor {...props} />);
  return { props, drawer: screen.getByRole("complementary", { name: /settings$/ }) };
}

describe("NodeEditor — header, badges, tabs", () => {
  it("names the agent and shows how its last run went, its access and its model", async () => {
    const { props, drawer } = renderEditor();
    expect(within(drawer).getByRole("heading", { name: "Reviewer" })).toBeInTheDocument();
    expect(within(drawer).getByText("Checks against the spec")).toBeInTheDocument();
    const head = drawer.querySelector(".nd-head") as HTMLElement;
    expect(within(head).getByText("Read-only")).toBeInTheDocument();
    expect(within(head).getByText("Grok 4.7")).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: "Changes requested · 31m ago" }));
    expect(props.onTabChange).toHaveBeenCalledWith("runs");

    // Skills & tools = 1 skill + 2 servers (the rules-files switch doesn't count); Memory = 2 + 1.
    expect(within(drawer).getByRole("tab", { name: /^Skills & tools\s*3$/ })).toBeInTheDocument();
    expect(await within(drawer).findByRole("tab", { name: /^Memory\s*3$/ })).toBeInTheDocument();
    expect(within(drawer).getByRole("tab", { name: "Runs" })).toBeInTheDocument();
  });

  it("says 'Needs a model' and 'Not run yet' for a blank agent", () => {
    const { drawer } = renderEditor({ node: reviewer({ model: "", last_run: null }) });
    expect(within(drawer).getByText("Needs a model")).toBeInTheDocument();
    expect(within(drawer).getByText("Not run yet")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Choose a model" })).toBeInTheDocument();
    expect(
      within(drawer).getByText("This agent needs a model before the team can run."),
    ).toBeInTheDocument();
  });
});

describe("NodeEditor — Setup read view", () => {
  it("shows the run-time banner, the collapsed editor with Show all, and the routing line", () => {
    const { drawer } = renderEditor();
    expect(
      within(drawer).getByText("Added at run time: the idea + the latest spec"),
    ).toBeInTheDocument();
    const more = within(drawer).getByRole("button", { name: "Show all 38 lines" });
    fireEvent.click(more);
    expect(within(drawer).getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const routing = within(drawer)
      .getByText(/Anything else →/)
      .closest(".nd-routing") as HTMLElement;
    expect(routing).toHaveTextContent("Says “approved” → Ship. Anything else → back to Engineer.");
    expect(within(routing).getByText("Instructions match your arrows")).toBeInTheDocument();
    expect(within(drawer).getByText("Uses your xAI API key")).toBeInTheDocument();
  });

  it("warns when the instructions no longer write the verdict the arrows route on", () => {
    const { drawer } = renderEditor({ node: reviewer({ prompt: "Review it." }) });
    expect(
      within(drawer).getByText("Instructions no longer match your arrows"),
    ).toBeInTheDocument();
  });

  it("locks the entry agent read-only: it starts from the idea and writes the spec", () => {
    const { drawer } = renderEditor({
      node: pm,
      isEntry: true,
    });
    const access = within(drawer).getByRole("group", { name: "File access" });
    for (const b of within(access).getAllByRole("button")) expect(b).toBeDisabled();
    expect(
      within(drawer).getByText(
        "The first agent writes the shared spec the team reads, so it stays read-only.",
      ),
    ).toBeInTheDocument();
    expect(within(drawer).getByText("Added at run time: the idea")).toBeInTheDocument();
    expect(within(drawer).getByText("The idea you type when you press Run")).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Choose" })).toBeNull();
    expect(within(drawer).getByText("Then →", { exact: false })).toHaveTextContent(
      "Then → Engineer.",
    );
  });

  it("opens Advanced with the backup model and output format", () => {
    const { drawer } = renderEditor();
    const adv = within(drawer).getByRole("button", { name: /^Advanced/ });
    expect(adv).toHaveAttribute("aria-expanded", "false");
    expect(adv).toHaveTextContent("Backup model: none · Output format: none");
    fireEvent.click(adv);
    expect(adv).toHaveAttribute("aria-expanded", "true");
    expect(within(drawer).getByRole("button", { name: "None" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Add JSON schema" })).toBeInTheDocument();
    expect(
      within(drawer).getByText("Used once if the main model fails (bad key, provider down)."),
    ).toBeInTheDocument();
  });
});

describe("NodeEditor — the save footer", () => {
  it("clean → 1 unsaved change → Save PATCHes only that part → Saved", async () => {
    const { props, drawer } = renderEditor();
    expect(within(drawer).getByText("All changes saved")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.click(within(drawer).getByRole("switch", { name: "Images" }));
    expect(within(drawer).getByText("1 unsaved change")).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));

    await within(drawer).findByText("Saved. This drives the next run you launch.");
    expect(patchBody()).toEqual({ multimodal: true });
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
  });

  it("removing the default spec chip saves reads_default: false; Discard puts it back", async () => {
    const { drawer } = renderEditor();
    fireEvent.click(within(drawer).getByRole("button", { name: "Remove spec" }));
    // Reads and Writes both read "Nothing" now.
    expect(within(drawer).getAllByText("Nothing")).toHaveLength(2);
    fireEvent.click(within(drawer).getByRole("button", { name: "Discard" }));
    expect(within(drawer).getByRole("button", { name: "Remove spec" })).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: "Remove spec" }));
    fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
    await within(drawer).findByText("Saved. This drives the next run you launch.");
    expect(patchBody()).toEqual({ reads_default: false });
  });

  it("a refused save shows the server's words with Try again", async () => {
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (init?.method === "PATCH")
        return json(
          {
            detail: "The first agent writes the shared spec the team reads, so it stays read-only.",
          },
          409,
        );
      if (input.startsWith("/api/memories")) return json({ memories: [] });
      return json({});
    });
    const { drawer } = renderEditor();
    fireEvent.click(within(drawer).getByRole("button", { name: "Can edit files" }));
    fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
    expect(await within(drawer).findByRole("alert")).toHaveTextContent(/stays read-only/);
    expect(within(drawer).getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("reads 'Memory changes save right away' on the Memory tab", () => {
    const { drawer } = renderEditor({ tab: "memory" });
    expect(within(drawer).getByText("Memory changes save right away")).toBeInTheDocument();
  });
});

describe("NodeEditor — gates and endpoints", () => {
  it("keeps the gate's own body in the shell, with no tabs and no save footer", () => {
    render(
      <NodeEditor
        teamId="t1"
        node={{
          ...ship,
          id: "n-gate",
          role_name: "prd_gate",
          kind: "gate",
          config: { gate_kind: "prd_approval", title: "Approve the PRD", description: "" },
        }}
        nodes={[]}
        edges={[]}
        isEntry={false}
        cover={null}
        tab="setup"
        onTabChange={vi.fn()}
        focus={false}
        onFocusChange={vi.fn()}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    const drawer = screen.getByRole("complementary", { name: "Approve the PRD settings" });
    expect(within(drawer).getByText("A human checkpoint")).toBeInTheDocument();
    expect(within(drawer).queryByRole("tab")).toBeNull();
    expect(within(drawer).queryByText("All changes saved")).toBeNull();
    expect(within(drawer).getByRole("group", { name: "Gate type" })).toBeInTheDocument();
  });
});
