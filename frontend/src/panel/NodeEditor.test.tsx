import { createRef } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type GraphEdge, setProviderCatalogue, type TeamGraphNode } from "../lib/api";
import { __resetBackendStatusForTests } from "../lib/backendStatus";
import { NodeEditor, type NodeEditorProps } from "./NodeEditor";
import type { LeaveGuard } from "./useUnsavedGuard";

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

describe("NodeEditor — editing (G2)", () => {
  const instructions = (drawer: HTMLElement) =>
    within(drawer).getByRole<HTMLTextAreaElement>("textbox", { name: /^Instructions/ });
  const rowOf = (drawer: HTMLElement, label: string) =>
    within(drawer)
      .getByText(label, { selector: ".nd-row__label" })
      .closest(".nd-row") as HTMLElement;

  it("tints the edited line, dots the changed rows, and Discard clears both", () => {
    const { drawer } = renderEditor();
    const lines = PROMPT.split("\n");
    lines[2] = "Line 3 — now stricter";
    fireEvent.change(instructions(drawer), { target: { value: lines.join("\n") } });
    fireEvent.click(within(drawer).getByRole("switch", { name: "Images" }));

    const marked = drawer.querySelectorAll(".nd-mark--on");
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent("Line 3 — now stricter");
    expect(within(rowOf(drawer, "Images")).getByRole("img", { name: "Changed" })).toBeVisible();
    expect(within(rowOf(drawer, "Model")).queryByRole("img", { name: "Changed" })).toBeNull();
    expect(within(drawer).getByText("2 unsaved changes")).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: "Discard" }));
    expect(drawer.querySelectorAll(".nd-mark--on")).toHaveLength(0);
    expect(within(drawer).queryByRole("img", { name: "Changed" })).toBeNull();
    expect(instructions(drawer).value).toBe(PROMPT);
    expect(within(drawer).getByText("All changes saved")).toBeInTheDocument();
  });

  it("marks the title when an edit only removed lines", () => {
    const { drawer } = renderEditor();
    fireEvent.change(instructions(drawer), {
      target: { value: PROMPT.split("\n").slice(0, -1).join("\n") },
    });
    const title = within(drawer).getByRole("heading", { name: /^Instructions/ });
    expect(within(title).getByRole("img", { name: "Changed" })).toBeInTheDocument();
  });

  it("Update instructions writes the verdict the arrows route on into the draft", () => {
    const { drawer } = renderEditor({ node: reviewer({ prompt: "Review it." }) });
    fireEvent.click(within(drawer).getByRole("button", { name: "Update instructions" }));
    expect(instructions(drawer).value).toContain('"approved"');
    expect(within(drawer).getByText("Instructions match your arrows")).toBeInTheDocument();
    expect(within(drawer).getByText("1 unsaved change")).toBeInTheDocument();
  });

  it("⌘S and Ctrl+S save a dirty draft; with nothing to save they only stop the browser's Save", async () => {
    const { drawer } = renderEditor();
    const clean = new KeyboardEvent("keydown", { key: "s", metaKey: true, cancelable: true });
    document.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(true);
    expect(patchBody()).toBeUndefined();

    fireEvent.click(within(drawer).getByRole("switch", { name: "Images" }));
    fireEvent.keyDown(document, { key: "s", metaKey: true });
    await within(drawer).findByText("Saved. This drives the next run you launch.");
    expect(patchBody()).toEqual({ multimodal: true });

    fetchMock.mockClear();
    fireEvent.click(within(drawer).getByRole("switch", { name: "Images" }));
    fireEvent.keyDown(document, { key: "S", ctrlKey: true });
    await waitFor(() => expect(patchBody()).toEqual({ multimodal: false }));
  });
});

describe("NodeEditor — leaving with unsaved changes (PANEL-21)", () => {
  function dirtyEditor(over: Partial<NodeEditorProps> = {}) {
    const guardRef = createRef<LeaveGuard>() as { current: LeaveGuard | null };
    const view = renderEditor({ guardRef, ...over });
    const lines = PROMPT.split("\n");
    lines[1] = "Line 2, edited";
    fireEvent.change(within(view.drawer).getByRole("textbox", { name: /^Instructions/ }), {
      target: { value: lines.join("\n") },
    });
    fireEvent.click(within(view.drawer).getByRole("switch", { name: "Images" }));
    const proceed = vi.fn();
    return { ...view, guardRef, proceed };
  }

  it("a clean drawer lets the page go at once", () => {
    const guardRef = createRef<LeaveGuard>() as { current: LeaveGuard | null };
    renderEditor({ guardRef });
    const proceed = vi.fn();
    act(() => guardRef.current?.(proceed));
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks 'Save your changes to <Name>?' naming what changed; Keep editing stays", () => {
    const { drawer, guardRef, proceed } = dirtyEditor();
    act(() => guardRef.current?.(proceed));
    const dialog = within(drawer).getByRole("alertdialog", { name: "Unsaved changes" });
    expect(dialog).toHaveTextContent("Save your changes to Reviewer?");
    expect(dialog).toHaveTextContent("You changed the instructions and images.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(within(drawer).queryByRole("alertdialog")).toBeNull();
    expect(proceed).not.toHaveBeenCalled();
    expect(within(drawer).getByText("2 unsaved changes")).toBeInTheDocument();
  });

  it("Escape is Keep editing too", () => {
    const { drawer, guardRef, proceed } = dirtyEditor();
    act(() => guardRef.current?.(proceed));
    expect(within(drawer).getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(drawer).queryByRole("alertdialog")).toBeNull();
    expect(proceed).not.toHaveBeenCalled();
  });

  it("Discard drops the draft and goes", () => {
    const { drawer, guardRef, proceed } = dirtyEditor();
    act(() => guardRef.current?.(proceed));
    const dialog = within(drawer).getByRole("alertdialog", { name: "Unsaved changes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(patchBody()).toBeUndefined();
    expect(within(drawer).getByText("All changes saved")).toBeInTheDocument();
  });

  it("Save saves the changed parts, then goes", async () => {
    const { drawer, guardRef, proceed } = dirtyEditor();
    act(() => guardRef.current?.(proceed));
    const dialog = within(drawer).getByRole("alertdialog", { name: "Unsaved changes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(proceed).toHaveBeenCalledTimes(1));
    const body = patchBody() as { multimodal?: boolean; prompt?: string };
    expect(body.multimodal).toBe(true);
    expect(body.prompt).toContain("Line 2, edited");
  });

  it("a failed Save keeps the drawer open with the error footer", async () => {
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return json({ detail: "boom" }, 500);
      if (input.startsWith("/api/memories")) return json({ memories: [] });
      return json({});
    });
    const { drawer, guardRef, proceed } = dirtyEditor();
    act(() => guardRef.current?.(proceed));
    const dialog = within(drawer).getByRole("alertdialog", { name: "Unsaved changes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(drawer).findByText("Couldn’t save. Try again.")).toBeInTheDocument();
    expect(within(drawer).queryByRole("alertdialog")).toBeNull();
    expect(proceed).not.toHaveBeenCalled();
  });

  it("asks the browser before a reload and tells Tvashtr Desktop while dirty", () => {
    const setUnsavedChanges = vi.fn();
    window.tvashtrDesktop = {
      app: { setUnsavedChanges },
    } as unknown as typeof window.tvashtrDesktop;
    try {
      const { drawer } = renderEditor();
      const clean = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(clean);
      expect(clean.defaultPrevented).toBe(false);
      expect(setUnsavedChanges).toHaveBeenLastCalledWith({ dirty: false, agentName: "Reviewer" });

      fireEvent.click(within(drawer).getByRole("switch", { name: "Images" }));
      const dirty = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(dirty);
      expect(dirty.defaultPrevented).toBe(true);
      expect(setUnsavedChanges).toHaveBeenLastCalledWith({ dirty: true, agentName: "Reviewer" });
    } finally {
      delete (window as { tvashtrDesktop?: unknown }).tvashtrDesktop;
    }
  });
});

describe("NodeEditor — the ⋯ menu (PANEL-23..26)", () => {
  const openMore = (drawer: HTMLElement) => {
    fireEvent.click(within(drawer).getByRole("button", { name: "More actions" }));
    return within(drawer).getByRole("menu", { name: "More actions" });
  };

  it("lists the four actions; focus view and documents go where they say", () => {
    const { props, drawer } = renderEditor();
    const menu = openMore(drawer);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual([
      "Open in focus view",
      "Rename",
      "Open its documents",
      "Delete agentIts arrows are removed too",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open in focus view" }));
    expect(props.onFocusChange).toHaveBeenCalledWith(true);
    fireEvent.click(within(openMore(drawer)).getByRole("menuitem", { name: "Open its documents" }));
    expect(props.onTabChange).toHaveBeenCalledWith("docs");
  });

  it("Rename edits the name and description in the header; Enter keeps it for Save", async () => {
    const { drawer } = renderEditor();
    fireEvent.click(within(openMore(drawer)).getByRole("menuitem", { name: "Rename" }));
    const name = within(drawer).getByRole<HTMLInputElement>("textbox", { name: "Agent name" });
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: "  Spec checker " } });
    fireEvent.change(within(drawer).getByRole("textbox", { name: "Short description" }), {
      target: { value: "Reads the build against the PRD" },
    });
    fireEvent.keyDown(name, { key: "Enter" });

    expect(within(drawer).getByRole("heading", { name: "Spec checker" })).toBeInTheDocument();
    expect(within(drawer).getByText("Reads the build against the PRD")).toBeInTheDocument();
    expect(drawer).toHaveAccessibleName("Spec checker settings");
    expect(within(drawer).getByText("1 unsaved change")).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
    await within(drawer).findByText("Saved. This drives the next run you launch.");
    expect(patchBody()).toEqual({
      title: "Spec checker",
      description: "Reads the build against the PRD",
    });
  });

  it("Escape cancels a rename; a blank name is refused", () => {
    const { drawer } = renderEditor();
    fireEvent.click(within(openMore(drawer)).getByRole("menuitem", { name: "Rename" }));
    let name = within(drawer).getByRole("textbox", { name: "Agent name" });
    fireEvent.change(name, { target: { value: "Other" } });
    fireEvent.keyDown(name, { key: "Escape" });
    expect(within(drawer).getByRole("heading", { name: "Reviewer" })).toBeInTheDocument();
    expect(within(drawer).getByText("All changes saved")).toBeInTheDocument();

    fireEvent.click(within(openMore(drawer)).getByRole("menuitem", { name: "Rename" }));
    name = within(drawer).getByRole("textbox", { name: "Agent name" });
    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(within(drawer).getByRole("alert")).toHaveTextContent("An agent name is required.");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(within(drawer).getByText("All changes saved")).toBeInTheDocument();
  });

  it("Delete agent names the arrows that go with it, then deletes", async () => {
    const onDelete = vi.fn(() => Promise.resolve());
    const { drawer } = renderEditor({ onDelete });
    fireEvent.click(within(openMore(drawer)).getByRole("menuitem", { name: /^Delete agent/ }));
    const dialog = within(drawer).getByRole("alertdialog", { name: "Delete Reviewer?" });
    expect(dialog).toHaveTextContent(
      "Its arrows to Engineer and Ship are removed too. Past runs keep their results.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(drawer).queryByRole("alertdialog")).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(within(openMore(drawer)).getByRole("menuitem", { name: /^Delete agent/ }));
    fireEvent.click(
      within(within(drawer).getByRole("alertdialog")).getByRole("button", { name: "Delete agent" }),
    );
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
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
