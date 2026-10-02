import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../lib/api";
import { __resetBackendStatusForTests } from "../lib/backendStatus";
import type { SavedAgent } from "../lib/api/myAgents";
import { NodeEditor, type NodeEditorProps } from "./NodeEditor";
import { resetNodeTemplates } from "./setup/useNodeTemplates";

// M6 in the agent drawer: the Templates menu's "My agents" (Agents-Menu), using one at once with
// Undo (R4, Agents-Use), the based-on badge and banner with Detach, and More › Save as my agent
// (Agents-More → Agents-Save). Every existing element stays.

const reviewer = (over: Partial<TeamGraphNode> = {}): TeamGraphNode => ({
  id: "n-rev",
  role_name: "reviewer",
  kind: "agent",
  model: "xai/grok-4.7",
  engine: "openhands",
  prompt: "You are the Reviewer.",
  position: { x: 0, y: 0 },
  edits_allowed: false,
  config: { title: "Reviewer", description: "Checks against the spec" },
  skills: [{ type: "inline", name: "house-style", content: "x", mode: "always" }],
  tool_config: { mcpServers: { fetch: { command: "uvx" } } },
  last_run: {
    outcome: "changes_requested",
    outcome_detail: null,
    run_id: "r1",
    iteration: 2,
    started_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    status: "done",
    ended_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
  ...over,
});
const based = reviewer({
  config: {
    title: "Reviewer",
    description: "Checks against the spec",
    based_on: { id: "a1", name: "Strict reviewer", version: 2 },
  },
});

const agent = (over: Partial<SavedAgent>): SavedAgent => ({
  id: "a1",
  name: "Strict reviewer",
  purpose: "Reviews Python changes against the spec.",
  latest: 2,
  updated_at: "2026-10-01T10:00:00Z",
  built_on: "Reviewer",
  model: "xai/grok-4.7",
  skills: 2,
  tools: 1,
  file_access: "read-only",
  versions: [],
  used_in: [
    { team_id: "t1", team_name: "Indicator sprint team", version: 2 },
    { team_id: "t2", team_name: "Bugfix squad", version: 1 },
  ],
  behind: [],
  ...over,
});
const AGENTS = [agent({}), agent({ id: "a2", name: "Spec writer", latest: 1, used_in: [] })];
const TEMPLATES = [
  "pm:Product manager",
  "architect:Architect",
  "engineer:Engineer",
  "reviewer:Reviewer",
].map((s) => {
  const [key, title] = s.split(":");
  return { key, title, description: "", role_name: key, node_kind: "worker", prompt: `${title}.` };
});
const BEFORE = { prompt: "You are the Reviewer.", based_on: null };

let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const calls = (method: string, url: string) =>
  fetchMock.mock.calls.filter(
    (c) => c[0] === url && ((c[1] as RequestInit | undefined)?.method ?? "GET") === method,
  );
const bodyOf = (method: string, url: string) => {
  const c = calls(method, url).at(-1);
  return c && (JSON.parse((c[1] as RequestInit).body as string) as unknown);
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
      const pending = input.includes("pending_review");
      const note = (id: string) => ({ id, content: id, polarity: "context", status: "active" });
      return json({ memories: pending ? [] : [note("m1"), note("m2"), note("m3")] });
    }
    if (input === "/api/node-templates") return json({ templates: TEMPLATES });
    if (input === "/api/my-agents" && method === "GET") return json({ agents: AGENTS });
    if (input === "/api/my-agents" && method === "POST")
      return json({ agent: agent({ latest: 3 }), version: 3, created: false }, 201);
    if (input.endsWith("/use-agent"))
      return json({
        node: based,
        before: BEFORE,
        text: "Reviewer now uses Strict reviewer v2",
      });
    if (input.endsWith("/undo-agent") || input.endsWith("/detach-agent")) return json(reviewer());
    if (method === "PATCH") return json(reviewer());
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNodeTemplates();
  setProviderCatalogue([]);
  __resetBackendStatusForTests();
});

function renderEditor(over: Partial<NodeEditorProps> = {}) {
  const props: NodeEditorProps = {
    teamId: "t1",
    node: reviewer(),
    nodes: [reviewer()],
    edges: [],
    isEntry: false,
    cover: { byok: new Set(["xai"]), subs: {} },
    tab: "setup",
    onTabChange: vi.fn(),
    focus: false,
    onFocusChange: vi.fn(),
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onOpenToolkit: vi.fn(),
    teamVersion: 7,
    ...over,
  };
  const view = render(<NodeEditor {...props} />);
  return { props, view, drawer: screen.getByRole("complementary", { name: /settings$/ }) };
}
const openTemplates = async (drawer: HTMLElement) => {
  fireEvent.click(within(drawer).getByRole("button", { name: "Templates" }));
  const menu = within(drawer).getByRole("menu", { name: "Templates" });
  await within(menu).findByRole("menuitem", { name: "Strict reviewer" });
  return menu;
};
const toastOf = (drawer: HTMLElement) => drawer.querySelector(".nd-toast-host") as HTMLElement;
const instructions = (drawer: HTMLElement) =>
  within(drawer).getByRole("region", { name: "Instructions" });

describe("NodeEditor — M6 Templates › My agents (Agents-Menu)", () => {
  it("Built-in (Reviewer in use), My agents with their meta, Manage my agents, Compare kept", async () => {
    const { drawer, props } = renderEditor();
    // Loaded when the menu opens, not before.
    expect(calls("GET", "/api/my-agents")).toHaveLength(0);
    const menu = await openTemplates(drawer);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual([
      "Product manager",
      "Architect",
      "Engineer",
      "Reviewerin use",
      "Strict reviewerv2 · 2 teams",
      "Spec writerv1",
      "Manage my agentsToolkit",
      "Compare templates in focus view",
    ]);
    expect([...menu.querySelectorAll(".ds-menu__heading")].map((h) => h.textContent)).toEqual([
      "Built-in",
      "My agents",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Manage my agents" }));
    expect(props.onOpenToolkit).toHaveBeenCalledWith({ page: "agents" });
  });

  it("no saved agents: no My agents section; the built-ins and Compare stay", async () => {
    fetchMock.mockImplementation((input: string) =>
      input === "/api/node-templates"
        ? json({ templates: TEMPLATES })
        : input.startsWith("/api/memories")
          ? json({ memories: [] })
          : json({}),
    );
    const { drawer } = renderEditor();
    fireEvent.click(within(drawer).getByRole("button", { name: "Templates" }));
    const menu = within(drawer).getByRole("menu", { name: "Templates" });
    await within(menu).findByRole("menuitem", { name: "Reviewer" });
    await waitFor(() => expect(calls("GET", "/api/my-agents")).toHaveLength(1));
    expect(within(menu).queryByText("My agents")).toBeNull();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual([
      "Product manager",
      "Architect",
      "Engineer",
      "Reviewerin use",
      "Manage my agentsToolkit",
      "Compare templates in focus view",
    ]);
  });
});

describe("NodeEditor — M6 using a saved agent (R4, Agents-Use)", () => {
  it("applies at once (no confirm), reloads, and Undo puts back what it replaced", async () => {
    const { drawer, props } = renderEditor();
    fireEvent.click(
      within(await openTemplates(drawer)).getByRole("menuitem", { name: "Strict reviewer" }),
    );
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(bodyOf("POST", "/api/teams/t1/nodes/n-rev/use-agent")).toEqual({ agent_id: "a1" });
    const toast = toastOf(drawer);
    expect(toast).toHaveTextContent("Reviewer now uses Strict reviewer v2");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(2));
    expect(bodyOf("POST", "/api/teams/t1/nodes/n-rev/undo-agent")).toEqual({ before: BEFORE });
  });

  it("a dirty draft is saved first through the drawer's guard", async () => {
    const { drawer } = renderEditor();
    const text = within(instructions(drawer)).getByRole("textbox", { name: /^Instructions/ });
    fireEvent.change(text, { target: { value: "Edited." } });
    fireEvent.click(
      within(await openTemplates(drawer)).getByRole("menuitem", { name: "Strict reviewer" }),
    );
    const ask = within(drawer).getByRole("alertdialog", { name: "Unsaved changes" });
    expect(calls("POST", "/api/teams/t1/nodes/n-rev/use-agent")).toHaveLength(0);
    fireEvent.click(within(ask).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls("POST", "/api/teams/t1/nodes/n-rev/use-agent")).toHaveLength(1),
    );
    const order = fetchMock.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method);
    expect(order.indexOf("PATCH")).toBeLessThan(order.lastIndexOf("POST"));
  });

  it("a based-on agent: the blue badge beside the kept badges, the banner, the note, Detach", async () => {
    const { drawer, props } = renderEditor({ node: based, nodes: [based] });
    const header = drawer.querySelector(".nd-badges") as HTMLElement;
    const badge = within(header).getByText("Strict reviewer v2");
    expect(badge.closest(".ds-badge")).toHaveClass("ds-badge--info");
    // The status badge, Read-only and the model stay.
    expect(within(drawer).getByRole("button", { name: /Changes requested/ })).toBeInTheDocument();
    expect(within(header).getByText("Read-only")).toBeInTheDocument();
    expect(within(header).getByText("Grok 4.7")).toBeInTheDocument();
    const card = instructions(drawer);
    const banner = within(card)
      .getByText(/^Based on/)
      .closest(".nd-based") as HTMLElement;
    expect(banner).toHaveTextContent("Based on Strict reviewer v2 · from My agents");
    expect(within(card).getByText("Its memory and routes stay with this team")).toBeVisible();
    // Above the run-time banner, which stays.
    const runtime = card.querySelector(".nd-runtime:not(.nd-runtime--note)") as HTMLElement;
    expect(runtime).toBeInTheDocument();
    expect(banner.compareDocumentPosition(runtime) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(banner).getByRole("button", { name: "Detach" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(calls("POST", "/api/teams/t1/nodes/n-rev/detach-agent")).toHaveLength(1);
  });

  it("a plain agent has no based-on badge or banner", () => {
    const { drawer } = renderEditor();
    expect(within(drawer).queryByText(/^Based on/)).toBeNull();
    expect(within(drawer).queryByText("Its memory and routes stay with this team")).toBeNull();
  });
});

describe("NodeEditor — M6 More › Save as my agent (Agents-More, Agents-Save)", () => {
  const openMore = (drawer: HTMLElement) => {
    fireEvent.click(within(drawer).getByRole("button", { name: "More actions" }));
    return within(drawer).getByRole("menu", { name: "More actions" });
  };

  it("adds Save as my agent before the separator; every existing item stays", () => {
    const { drawer } = renderEditor();
    expect(
      within(openMore(drawer))
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual([
      "Open in focus view",
      "Rename",
      "Open its documents",
      "Save as my agent",
      "Delete agentIts arrows are removed too",
    ]);
  });

  it("opens the dialog prefilled from the based-on agent; saving says so and reloads", async () => {
    const { drawer, props } = renderEditor({ node: based, nodes: [based] });
    fireEvent.click(within(openMore(drawer)).getByRole("menuitem", { name: "Save as my agent" }));
    const dialog = await screen.findByRole("dialog", { name: "Save Reviewer as my agent" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Strict reviewer");
    expect(within(dialog).getByLabelText("What it’s for")).toHaveValue(
      "Reviews Python changes against the spec.",
    );
    expect(within(dialog).getByText("The current text (v7)")).toBeInTheDocument();
    expect(within(dialog).getByText("Memories (3)")).toBeInTheDocument();
    expect(within(dialog).getByText("Saved as version 3")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save to My agents" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toastOf(drawer)).toHaveTextContent("Saved as Strict reviewer v3");
    expect(props.onSaved).toHaveBeenCalled();
  });

  it("a plain agent's dialog starts from its name and description", async () => {
    const { drawer } = renderEditor();
    fireEvent.click(within(openMore(drawer)).getByRole("menuitem", { name: "Save as my agent" }));
    const dialog = await screen.findByRole("dialog", { name: "Save Reviewer as my agent" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Reviewer");
    expect(within(dialog).getByLabelText("What it’s for")).toHaveValue("Checks against the spec");
    expect(within(dialog).getByText("Saved as version 1")).toBeInTheDocument();
  });
});

// The review's fixes (M6).
describe("NodeEditor — M6 review fixes", () => {
  const openMore = (drawer: HTMLElement) => {
    fireEvent.click(within(drawer).getByRole("button", { name: "More actions" }));
    return within(drawer).getByRole("menu", { name: "More actions" });
  };
  const memoryReads = () =>
    fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/memories")).length;
  /** Answer `url` (by method) with `reply`, everything else as before. */
  const answer = (method: string, url: string, reply: () => Promise<Response>) => {
    const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => unknown;
    fetchMock.mockImplementation((input: string, init?: RequestInit) =>
      input === url && (init?.method ?? "GET") === method ? reply() : base(input, init),
    );
  };

  it("Save as my agent starts from the saved agent's CURRENT name (it was renamed)", async () => {
    answer("GET", "/api/my-agents", () =>
      json({ agents: [{ ...AGENTS[0], name: "Careful reviewer" }, AGENTS[1]] }),
    );
    const { drawer } = renderEditor({ node: based, nodes: [based] });
    fireEvent.click(within(openMore(drawer)).getByRole("menuitem", { name: "Save as my agent" }));
    const dialog = await screen.findByRole("dialog", { name: "Save Reviewer as my agent" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Careful reviewer");
    expect(within(dialog).getByText("Saved as version 3")).toBeInTheDocument();
  });

  it("a server failure (5xx) says the plain words, not the server's", async () => {
    answer("POST", "/api/teams/t1/nodes/n-rev/use-agent", () =>
      json({ detail: "Traceback: boom" }, 500),
    );
    const { drawer } = renderEditor();
    fireEvent.click(
      within(await openTemplates(drawer)).getByRole("menuitem", { name: "Strict reviewer" }),
    );
    await waitFor(() =>
      expect(toastOf(drawer)).toHaveTextContent("Couldn’t use Strict reviewer. Try again."),
    );
    expect(toastOf(drawer)).not.toHaveTextContent("boom");
  });

  it("reads the agent's memories again after a use and after its Undo", async () => {
    const { drawer, props } = renderEditor();
    await waitFor(() => expect(memoryReads()).toBe(2));
    fireEvent.click(
      within(await openTemplates(drawer)).getByRole("menuitem", { name: "Strict reviewer" }),
    );
    await waitFor(() => expect(memoryReads()).toBe(4));
    fireEvent.click(within(toastOf(drawer)).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(memoryReads()).toBe(6));
  });
});
