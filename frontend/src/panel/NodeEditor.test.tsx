import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type GraphEdge,
  type ProviderCatalogueEntry,
  setProviderCatalogue,
  type TeamGraphNode,
} from "../lib/api";
import { __resetBackendStatusForTests } from "../lib/backendStatus";
import { NodeEditor, type NodeEditorProps } from "./NodeEditor";
import { resetNodeTemplates } from "./setup/useNodeTemplates";
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

// GET /api/node-templates (the built-in four; short prompts stand in for the real ones).
const template = (key: string, title: string, prompt: string, edits_allowed = false) => ({
  key,
  title,
  description: "",
  role_name: key,
  node_kind: key === "pm" || key === "architect" ? "thinker" : "worker",
  edits_allowed,
  writes_to: null,
  verdict_labels: key === "reviewer" ? ["approved", "changes_requested"] : [],
  prompt,
});
const TEMPLATES = [
  template("pm", "Product manager", "You are the PM. Write the spec."),
  template("architect", "Architect", "You are the architect."),
  template("engineer", "Engineer", "You are the engineer. Build it.", true),
  template(
    "reviewer",
    "Reviewer",
    'You are the Reviewer.\n{"verdict": "approved" | "changes_requested"}',
  ),
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
      const note = (id: string) => ({ id, content: id, polarity: "context", status: "active" });
      return json({ memories: pending ? [note("m3")] : [note("m1"), note("m2")] });
    }
    if (method === "PATCH") return json(reviewer());
    if (input === "/api/node-templates") return json({ templates: TEMPLATES });
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNodeTemplates();
  window.localStorage.clear();
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
  const view = render(<NodeEditor {...props} />);
  return { props, view, drawer: screen.getByRole("complementary", { name: /settings$/ }) };
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
    expect(
      within(drawer).getByRole("button", { name: "Model Choose a model" }),
    ).toBeInTheDocument();
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
    expect(within(drawer).getByRole("button", { name: "Backup model None" })).toBeInTheDocument();
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
    // The Reviewer routes on a verdict, so it asks first (Q6).
    fireEvent.click(within(drawer).getByRole("button", { name: "Allow edits" }));
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
    fireEvent.click(
      within(within(drawer).getByRole("alertdialog")).getByRole("button", { name: "Add lines" }),
    );
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
    const stay = vi.fn();
    act(() => guardRef.current?.(proceed, stay));
    const dialog = within(drawer).getByRole("alertdialog", { name: "Unsaved changes" });
    expect(dialog).toHaveTextContent("Save your changes to Reviewer?");
    expect(dialog).toHaveTextContent("You changed the instructions and images.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(within(drawer).queryByRole("alertdialog")).toBeNull();
    expect(proceed).not.toHaveBeenCalled();
    // The page hears that it stayed (the canvas rings this agent's card again).
    expect(stay).toHaveBeenCalledTimes(1);
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
      expect(setUnsavedChanges).toHaveBeenLastCalledWith({ dirty: false });

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

describe("NodeEditor — templates, routing sync, new agent (G3)", () => {
  const instructions = (drawer: HTMLElement) =>
    within(drawer).getByRole<HTMLTextAreaElement>("textbox", { name: /^Instructions/ });
  // The drawer's toast host (a live region above the footer; the footer has its own status line).
  const toastOf = (drawer: HTMLElement) => {
    const host = drawer.querySelector(".nd-toast-host") as HTMLElement;
    expect(host).toHaveAttribute("role", "status");
    return host;
  };
  const openTemplates = async (drawer: HTMLElement) => {
    fireEvent.click(within(drawer).getByRole("button", { name: "Templates" }));
    const menu = within(drawer).getByRole("menu", { name: "Templates" });
    await within(menu).findByRole("menuitem", { name: "Reviewer" });
    return menu;
  };
  const newAgent = (over: Partial<TeamGraphNode> = {}) =>
    reviewer({
      id: "n-new",
      role_name: "worker",
      prompt: "",
      model: "",
      config: null,
      skills: null,
      tool_config: null,
      last_run: null,
      ...over,
    });

  it("lists the four templates and 'Compare templates in focus view'", async () => {
    const { props, drawer, view } = renderEditor();
    const menu = await openTemplates(drawer);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual([
      "Product manager",
      "Architect",
      "Engineer",
      "Reviewer",
      "Compare templates in focus view",
    ]);
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Compare templates in focus view" }),
    );
    expect(props.onFocusChange).toHaveBeenCalledWith(true);
    // The page switches to focus: the Templates dialog is already open over it.
    view.rerender(<NodeEditor {...props} focus />);
    const dialog = await screen.findByRole("dialog", { name: "Choose a template" });
    expect(within(dialog).getByRole("button", { name: /^Reviewer/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("asks before replacing text; Cancel keeps it, Replace applies it with an Undo toast", async () => {
    const { drawer } = renderEditor();
    fireEvent.click(
      within(await openTemplates(drawer)).getByRole("menuitem", { name: "Reviewer" }),
    );
    const confirm = within(drawer).getByRole("alertdialog", { name: "Replace the instructions?" });
    expect(confirm).toHaveTextContent(
      "The Reviewer template replaces what’s in the editor now. Nothing is saved until you press Save, so Discard brings your text back.",
    );
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(within(drawer).queryByRole("alertdialog")).toBeNull();
    expect(instructions(drawer).value).toBe(PROMPT);

    fireEvent.click(
      within(await openTemplates(drawer)).getByRole("menuitem", { name: "Reviewer" }),
    );
    fireEvent.click(
      within(within(drawer).getByRole("alertdialog")).getByRole("button", { name: "Replace" }),
    );
    expect(instructions(drawer).value).toBe(TEMPLATES[3].prompt);
    expect(within(drawer).getByText("1 unsaved change")).toBeInTheDocument();
    const toast = toastOf(drawer);
    expect(toast).toHaveTextContent("Reviewer template applied");

    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(instructions(drawer).value).toBe(PROMPT);
    expect(within(drawer).getByText("All changes saved")).toBeInTheDocument();
    expect(toastOf(drawer)).toBeEmptyDOMElement();
  });

  it("a template brings its default File access, and the confirm says so (Q7)", async () => {
    const { drawer } = renderEditor();
    fireEvent.click(
      within(await openTemplates(drawer)).getByRole("menuitem", { name: "Engineer" }),
    );
    const confirm = within(drawer).getByRole("alertdialog", { name: "Replace the instructions?" });
    expect(confirm).toHaveTextContent(
      "The Engineer template replaces what’s in the editor now and lets this agent edit files.",
    );
    fireEvent.click(within(confirm).getByRole("button", { name: "Replace" }));
    const head = drawer.querySelector(".nd-head") as HTMLElement;
    expect(within(head).getByText("Can edit files")).toBeInTheDocument();
    expect(within(drawer).getByText("2 unsaved changes")).toBeInTheDocument();
  });

  it("a thinker that isn't the entry agent also takes the template's File access (Q7)", async () => {
    const thinker = reviewer({ kind: "completion", role_name: "thinker" });
    const { drawer } = renderEditor({ node: thinker });
    fireEvent.click(
      within(await openTemplates(drawer)).getByRole("menuitem", { name: "Engineer" }),
    );
    const confirm = within(drawer).getByRole("alertdialog", { name: "Replace the instructions?" });
    expect(confirm).toHaveTextContent("and lets this agent edit files.");
    fireEvent.click(within(confirm).getByRole("button", { name: "Replace" }));
    const head = drawer.querySelector(".nd-head") as HTMLElement;
    expect(within(head).getByText("Can edit files")).toBeInTheDocument();
  });

  it("the entry agent keeps its File access when a template is applied", async () => {
    const { drawer } = renderEditor({ node: { ...pm, id: "n-rev" }, isEntry: true });
    fireEvent.click(
      within(await openTemplates(drawer)).getByRole("menuitem", { name: "Engineer" }),
    );
    const confirm = within(drawer).getByRole("alertdialog", { name: "Replace the instructions?" });
    expect(confirm).not.toHaveTextContent("edit files");
    fireEvent.click(within(confirm).getByRole("button", { name: "Replace" }));
    expect(within(drawer).getByText("1 unsaved change")).toBeInTheDocument();
  });

  it("Update instructions previews the + lines, then Add lines syncs them with an Undo toast", () => {
    const { drawer } = renderEditor({ node: reviewer({ prompt: "Review it." }) });
    fireEvent.click(within(drawer).getByRole("button", { name: "Update instructions" }));
    const dialog = within(drawer).getByRole("alertdialog", { name: "Update the instructions?" });
    expect(dialog).toHaveTextContent("This adds the verdict-file lines your arrows need:");
    const lines = Array.from(dialog.querySelectorAll(".nd-diff__line")).map((l) => l.textContent);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l?.startsWith("+ "))).toBe(true);
    expect(lines.join("\n")).toContain('"approved"');

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(instructions(drawer).value).toBe("Review it.");

    fireEvent.click(within(drawer).getByRole("button", { name: "Update instructions" }));
    fireEvent.click(
      within(within(drawer).getByRole("alertdialog")).getByRole("button", { name: "Add lines" }),
    );
    expect(within(drawer).getByText("Instructions match your arrows")).toBeInTheDocument();
    const toast = toastOf(drawer);
    expect(toast).toHaveTextContent("Instructions updated to match your arrows");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(instructions(drawer).value).toBe("Review it.");
    expect(
      within(drawer).getByText("Instructions no longer match your arrows"),
    ).toBeInTheDocument();
  });

  it("a new agent: placeholders, two badges, the checklist and the template chooser", async () => {
    const { drawer } = renderEditor({ node: newAgent(), nodes: [pm, newAgent()], edges: [] });
    expect(within(drawer).getByRole("heading", { name: "New agent" })).toBeInTheDocument();
    expect(within(drawer).getByText("Add a short description")).toBeInTheDocument();
    const head = drawer.querySelector(".nd-head") as HTMLElement;
    expect(within(head).getByText("Not run yet")).toBeInTheDocument();
    expect(within(head).getByText("Needs a model")).toBeInTheDocument();
    expect(within(head).queryByText("Read-only")).toBeNull();

    const ready = within(drawer).getByRole("region", { name: "Get this agent ready" });
    expect(ready).toHaveTextContent("1 of 3");
    expect(ready).toHaveTextContent("Choose documents· reads the spec by default");
    expect(within(drawer).getByText("Choose a model")).toBeInTheDocument();
    expect(
      within(drawer).getByText(
        "Connect an arrow out of this agent on the canvas to set where its work goes.",
      ),
    ).toBeInTheDocument();

    // No editor until a template (or "Start from scratch") is picked; an empty editor takes one at once.
    expect(within(drawer).queryByRole("textbox", { name: /^Instructions/ })).toBeNull();
    const chooser = within(drawer).getByRole("group", { name: "Start from a template" });
    const pmButton = await within(chooser).findByRole("button", { name: "Product manager" });
    await waitFor(() => expect(pmButton).toBeEnabled());
    fireEvent.click(pmButton);
    expect(within(drawer).queryByRole("alertdialog")).toBeNull();
    expect(instructions(drawer).value).toBe(TEMPLATES[0].prompt);
    expect(ready).toHaveTextContent("2 of 3");
    expect(toastOf(drawer)).toHaveTextContent("Product manager template applied");
  });

  it("a new agent saves its other settings before it has instructions", async () => {
    const { drawer } = renderEditor({ node: newAgent(), nodes: [newAgent()], edges: [] });
    fireEvent.click(within(drawer).getByRole("switch", { name: "Images" }));
    const save = within(drawer).getByRole("button", { name: /^Save/ });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await within(drawer).findByText("Saved. This drives the next run you launch.");
    expect(patchBody()).toEqual({ multimodal: true });
  });

  it("says why it can't save when the instructions were emptied", () => {
    const { drawer } = renderEditor();
    fireEvent.change(instructions(drawer), { target: { value: "  " } });
    const foot = drawer.querySelector(".nd-foot") as HTMLElement;
    expect(foot).toHaveTextContent("Instructions can’t be empty.");
    expect(within(foot).getByRole("button", { name: /^Save/ })).toBeDisabled();
  });

  it("Start from scratch opens an empty editor with the caret in it", () => {
    const { drawer } = renderEditor({ node: newAgent(), nodes: [newAgent()], edges: [] });
    fireEvent.click(within(drawer).getByRole("button", { name: "Start from scratch" }));
    const box = instructions(drawer);
    expect(box.value).toBe("");
    expect(box).toHaveFocus();
  });

  it("Hide this hides the checklist for this agent, and remembers it", () => {
    const first = renderEditor({ node: newAgent(), nodes: [newAgent()], edges: [] });
    fireEvent.click(within(first.drawer).getByRole("button", { name: "Hide this" }));
    expect(within(first.drawer).queryByRole("region", { name: "Get this agent ready" })).toBeNull();
    cleanup();

    const again = renderEditor({ node: newAgent(), nodes: [newAgent()], edges: [] });
    expect(within(again.drawer).queryByRole("region", { name: "Get this agent ready" })).toBeNull();
  });

  it("a never-run agent whose chosen model has no key isn't new: its access badge, no checklist", () => {
    const { drawer } = renderEditor({
      node: reviewer({ last_run: null }),
      cover: { byok: new Set(), subs: {} },
    });
    const head = drawer.querySelector(".nd-head") as HTMLElement;
    expect(within(head).getByText("Read-only")).toBeInTheDocument();
    expect(within(head).getByText("Needs a model")).toBeInTheDocument();
    expect(within(drawer).queryByRole("region", { name: "Get this agent ready" })).toBeNull();
  });

  it("an agent with saved instructions and a covered model shows no checklist", () => {
    const { drawer } = renderEditor({ node: reviewer({ last_run: null }) });
    expect(within(drawer).queryByRole("region", { name: "Get this agent ready" })).toBeNull();
    expect(within(drawer).getByRole("textbox", { name: /^Instructions/ })).toBeInTheDocument();
  });
});

describe("NodeEditor — the model picker and the model warnings (G4)", () => {
  const CATALOGUE: ProviderCatalogueEntry[] = [
    {
      provider: "nvidia_nim",
      thinker_default: null,
      worker_default: null,
      thinker_presets: [],
      worker_presets: [],
      label: "NVIDIA NIM",
      byok_probed: true,
    },
    {
      provider: "xai",
      thinker_default: "xai/grok-4.7",
      worker_default: "xai/grok-4.7",
      thinker_presets: ["xai/grok-4.7"],
      worker_presets: ["xai/grok-4.7"],
      label: "xAI",
      model_labels: { "xai/grok-4.7": "Grok 4.7" },
      subscription: "grok",
      byok_probed: false,
    },
    {
      provider: "gemini",
      thinker_default: null,
      worker_default: "gemini/gemini-2.5-flash",
      thinker_presets: [],
      worker_presets: ["gemini/gemini-2.5-flash"],
      label: "Gemini",
      model_labels: { "gemini/gemini-2.5-flash": "Gemini 2.5 Flash" },
      byok_probed: true,
    },
  ];
  const toastOf = (drawer: HTMLElement) => drawer.querySelector(".nd-toast-host") as HTMLElement;
  const model = (drawer: HTMLElement) => within(drawer).getByRole("region", { name: "Model" });

  afterEach(() => window.sessionStorage.clear());

  it("adds a missing key from the picker, lands on its model and says where it went (Flow-Model)", async () => {
    const onOpenEngines = vi.fn();
    const onProviderAdded = vi.fn();
    const { drawer } = renderEditor({
      catalogue: CATALOGUE,
      cover: { byok: new Set(["xai", "nvidia_nim"]), subs: {} },
      onOpenEngines,
      onProviderAdded,
    });
    fireEvent.click(within(model(drawer)).getByRole("button", { name: "Model grok-4.7" }));
    const list = within(drawer).getByRole("dialog", { name: "Choose a model" });
    // The worker seat's providers only: NIM (no seat) is never offered.
    expect(within(list).queryByText("nvidia_nim")).toBeNull();
    fireEvent.change(within(list).getByLabelText("Paste your Gemini API key"), {
      target: { value: "AIza-secret" },
    });
    fireEvent.click(within(list).getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(within(drawer).queryByRole("dialog", { name: "Choose a model" })).toBeNull(),
    );
    expect(onProviderAdded).toHaveBeenCalledWith("gemini");
    expect(
      within(model(drawer)).getByRole("button", { name: "Model gemini-2.5-flash" }),
    ).toBeTruthy();
    expect(model(drawer).querySelector(".nd-hint")).toHaveTextContent(
      "Uses your Gemini API key (saved in Engines)",
    );
    expect(within(model(drawer)).getByRole("img", { name: "Changed" })).toBeTruthy();
    expect(within(drawer).getByText("1 unsaved change")).toBeInTheDocument();
    const toast = toastOf(drawer);
    expect(toast).toHaveTextContent("Gemini key saved to Engines");
    fireEvent.click(within(toast).getByRole("button", { name: "Open Engines" }));
    expect(onOpenEngines).toHaveBeenCalledWith("keys");
  });

  it("'Add a provider' opens Engines › API keys", () => {
    const onOpenEngines = vi.fn();
    const { drawer } = renderEditor({ catalogue: CATALOGUE, onOpenEngines });
    fireEvent.click(within(model(drawer)).getByRole("button", { name: "Model grok-4.7" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Add a provider" }));
    expect(onOpenEngines).toHaveBeenCalledWith("keys");
  });

  it("a verdict agent sharing its model with the agent it checks gets the advisory, until dismissed", () => {
    const { drawer } = renderEditor({ catalogue: CATALOGUE });
    const advisory = within(model(drawer))
      .getByText(/both run/)
      .closest("[role=status]");
    expect(advisory).toHaveTextContent(
      "Reviewer and Engineer both run xai/grok-4.7. Reviews are stronger when the reviewer runs a more capable model than the one it checks.",
    );
    fireEvent.click(within(advisory as HTMLElement).getByRole("button", { name: "Dismiss" }));
    expect(within(model(drawer)).queryByText(/both run/)).toBeNull();
    // Dismissed for this session: it stays away when the drawer opens again.
    cleanup();
    const again = renderEditor({ catalogue: CATALOGUE });
    expect(within(model(again.drawer)).queryByText(/both run/)).toBeNull();
  });

  it("an agent that doesn't route on a verdict gets no advisory", () => {
    const { drawer } = renderEditor({
      catalogue: CATALOGUE,
      node: engineer,
      nodes: [pm, engineer, reviewer(), ship],
    });
    expect(within(model(drawer)).queryByText(/both run/)).toBeNull();
  });

  it("warns about a backup model no provider matches; Save still sends it (Panel-Warnings)", async () => {
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return json({ detail: "boom" }, 500);
      if (input.startsWith("/api/memories")) return json({ memories: [] });
      return json({});
    });
    const { drawer } = renderEditor({ catalogue: CATALOGUE });
    fireEvent.click(within(drawer).getByRole("button", { name: /^Advanced/ }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Backup model None" }));
    const list = within(drawer).getByRole("dialog", { name: "Choose a backup model" });
    fireEvent.click(within(list).getByRole("button", { name: "Use a custom model ID" }));
    fireEvent.change(within(list).getByRole("textbox", { name: "Custom model ID" }), {
      target: { value: "openai/gpt-4o-mni" },
    });
    fireEvent.click(within(list).getByRole("button", { name: "Use this model" }));

    // The button shows the whole slug (no provider tile) and the soft warning sits under it.
    expect(
      within(drawer).getByRole("button", { name: "Backup model openai/gpt-4o-mni" }),
    ).toBeTruthy();
    const warning = within(drawer)
      .getByText(/^No provider matches/)
      .closest("[role=status]");
    expect(warning).toHaveTextContent(
      "No provider matches openai/gpt-4o-mni. It will fail at run time if the name is wrong or the key isn’t set.",
    );
    expect(within(drawer).getByText("1 unsaved change")).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
    expect(await within(drawer).findByText("Couldn’t save. Try again.")).toBeInTheDocument();
    expect(patchBody()).toEqual({ fallback_model: "openai/gpt-4o-mni" });
    expect(within(drawer).getByRole("button", { name: "Try again" })).toBeTruthy();

    fireEvent.click(within(warning as HTMLElement).getByRole("button", { name: "Dismiss" }));
    expect(within(drawer).queryByText(/^No provider matches/)).toBeNull();
  });

  it("warns about an unknown main model too, and picking a listed one clears it", () => {
    const { drawer } = renderEditor({
      catalogue: CATALOGUE,
      node: reviewer({ model: "xai/grok-9" }),
    });
    expect(within(model(drawer)).getByText(/^No provider matches/)).toHaveTextContent(
      "No provider matches xai/grok-9.",
    );
    fireEvent.click(within(model(drawer)).getByRole("button", { name: "Model xai/grok-9" }));
    fireEvent.click(within(drawer).getByRole("option", { name: "grok-4.7" }));
    expect(within(model(drawer)).queryByText(/^No provider matches/)).toBeNull();
  });
});

describe("NodeEditor — Access & documents (G5)", () => {
  it("Allow edits flips the header badge to 'Can edit files'; Save sends edits_allowed", async () => {
    const { drawer } = renderEditor();
    const head = drawer.querySelector(".nd-head") as HTMLElement;
    fireEvent.click(within(drawer).getByRole("button", { name: "Can edit files" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Allow edits" }));
    expect(within(head).getByText("Can edit files")).toBeInTheDocument();
    expect(within(head).queryByText("Read-only")).toBeNull();
    expect(within(drawer).getByText("1 unsaved change")).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
    await within(drawer).findByText("Saved. This drives the next run you launch.");
    expect(patchBody()).toEqual({ edits_allowed: true });
  });

  it("a new Writes name says so in the drawer's toast, and Save sends it", async () => {
    // A Reviewer that doesn't branch (its verdict agent twin can't write a document).
    const plain = edges.map((e) => (e.id === "e3" ? { ...e, conditions: null } : e));
    const { drawer } = renderEditor({ edges: plain });
    fireEvent.click(within(drawer).getByRole("button", { name: "Choose" }));
    const dialog = within(drawer).getByRole("dialog", { name: "The one document it writes" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "New document name" }), {
      target: { value: "review-notes" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Use review-notes" }));
    const toasts = drawer.querySelector(".nd-toast-host") as HTMLElement;
    expect(
      within(toasts).getByText("New document. Other agents can add it to their Reads."),
    ).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
    await within(drawer).findByText("Saved. This drives the next run you launch.");
    expect(patchBody()).toEqual({ writes_to: "review-notes" });
  });

  it("Reads picks save the ordered names", async () => {
    const withNotes = [pm, { ...engineer, config: { writes_to: "build-notes" } }, reviewer(), ship];
    const { drawer } = renderEditor({ nodes: withNotes });
    fireEvent.click(within(drawer).getByRole("button", { name: "Add" }));
    const dialog = within(drawer).getByRole("dialog", { name: "Documents it reads, in order" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /build-notes/ }));
    expect(
      within(drawer).getByText("Added at run time: the idea + the latest spec + build-notes"),
    ).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
    await within(drawer).findByText("Saved. This drives the next run you launch.");
    expect(patchBody()).toEqual({ reads_from: ["spec", "build-notes"] });
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
