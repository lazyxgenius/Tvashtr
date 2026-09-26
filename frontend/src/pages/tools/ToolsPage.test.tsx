import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToolsPage } from "./ToolsPage";
import {
  FETCH,
  GITHUB,
  LINEAR,
  mockApi,
  renderWithProviders,
  resetToolkitStores,
  tool,
} from "./toolsTestUtils";
import { markToolFresh, setToolsQuery } from "./toolsState";

beforeEach(() => resetToolkitStores());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetToolkitStores();
});

const table = () => screen.getByRole("table");
const rowNames = () =>
  within(table())
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getByRole("link").textContent);

function renderInstalled(tools = [LINEAR, FETCH, GITHUB]) {
  const calls = mockApi({ "GET /api/tool-library": { tools } });
  renderWithProviders(<ToolsPage view="installed" />);
  return calls;
}

describe("Tools · Installed", () => {
  it("lists every tool A→Z with its kind, what it runs, status and usage", async () => {
    renderInstalled();
    await screen.findByRole("table");
    expect(rowNames()).toEqual(["fetch", "github", "linear"]);

    const [, fetchRow, githubRow, linearRow] = within(table()).getAllByRole("row");
    expect(within(fetchRow).getByText("Local")).toHaveAttribute(
      "title",
      "Runs in the agent’s sandbox",
    );
    expect(within(fetchRow).getByText("uvx mcp-server-fetch")).toBeInTheDocument();
    expect(within(fetchRow).getByText("Ready")).toBeInTheDocument();
    expect(within(fetchRow).getByText("2 agents · 1 team")).toBeInTheDocument();

    expect(within(githubRow).getByText("Remote")).toBeInTheDocument();
    expect(within(githubRow).getByText("api.githubcopilot.com/mcp")).toBeInTheDocument();
    expect(within(githubRow).getByText("3 agents · 2 teams")).toBeInTheDocument();

    expect(within(linearRow).getByText("mcp.linear.app/sse")).toBeInTheDocument();
    expect(within(linearRow).getByText("Needs LINEAR_TOKEN")).toBeInTheDocument();
    expect(within(linearRow).getByRole("button", { name: "Add secret" })).toBeInTheDocument();
    expect(within(linearRow).getByText("1 agent · 1 team")).toBeInTheDocument();
    expect(
      within(linearRow).getByRole("button", { name: "More actions for linear" }),
    ).toBeInTheDocument();
  });

  it("shows the header, the Installed count and the Domains footnote", async () => {
    renderInstalled();
    await screen.findByRole("table");
    expect(screen.getByRole("heading", { level: 1, name: "Tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Paste mcp\.json/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add tool/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Installed 3" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText(/is built in\. Turn it on for an agent/)).toBeInTheDocument();
  });

  it("says 'Not used yet' and 'Needs 2 secrets' where the design has no copy", async () => {
    const two = tool(
      "t-x",
      "notion",
      { url: "https://x.dev/mcp", headers: { A: "${A_TOKEN}", B: "${B_TOKEN}" } },
      { missing_secrets: ["A_TOKEN", "B_TOKEN"], status: "needs_attention" },
    );
    renderInstalled([two]);
    const row = within(await screen.findByRole("table")).getAllByRole("row")[1];
    expect(within(row).getByText("Needs 2 secrets")).toBeInTheDocument();
    expect(within(row).getByText("Not used yet")).toBeInTheDocument();
  });

  it("floats tools created during this visit to the top, newest first", async () => {
    const zeta = tool("t-zeta", "zeta", { command: "npx", args: ["zeta"] });
    const alpha = tool("t-alpha", "alpha", { command: "npx", args: ["alpha"] });
    markToolFresh("t-zeta");
    markToolFresh("t-alpha");
    renderInstalled([FETCH, zeta, GITHUB, alpha]);
    await screen.findByRole("table");
    expect(rowNames()).toEqual(["alpha", "zeta", "fetch", "github"]);
  });

  it("filters live by name as you type", async () => {
    renderInstalled();
    await screen.findByRole("table");
    fireEvent.change(screen.getByPlaceholderText("Search tools"), { target: { value: "LIN" } });
    expect(rowNames()).toEqual(["linear"]);
  });

  it("filters by status from the listbox and says what it's showing, with Clear", async () => {
    renderInstalled();
    await screen.findByRole("table");
    const select = screen.getByRole("combobox", { name: "Status" });
    expect(select).toHaveTextContent("All statuses");
    fireEvent.click(select);
    const list = screen.getByRole("listbox", { name: "Status" });
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All statuses", "Ready", "Needs attention"]);
    expect(within(list).getByRole("option", { name: "All statuses" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(within(list).getByRole("option", { name: "Needs attention" }));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(select).toHaveTextContent("Needs attention");
    expect(screen.getByText("Showing tools that need attention · 1")).toBeInTheDocument();
    expect(rowNames()).toEqual(["linear"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(select).toHaveTextContent("All statuses");
    expect(screen.queryByText(/Showing tools/)).not.toBeInTheDocument();
    expect(rowNames()).toEqual(["fetch", "github", "linear"]);
  });

  it("closes the Status listbox on Escape and returns focus to it", async () => {
    renderInstalled();
    await screen.findByRole("table");
    const select = screen.getByRole("combobox", { name: "Status" });
    fireEvent.click(select);
    const selected = screen.getByRole("option", { name: "All statuses" });
    expect(selected).toHaveFocus();
    fireEvent.keyDown(selected, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Ready" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(select).toHaveFocus();
  });

  it("shows 'No tools match' with Clear search when nothing matches", async () => {
    renderInstalled();
    await screen.findByRole("table");
    fireEvent.change(screen.getByPlaceholderText("Search tools"), { target: { value: "slack" } });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No tools match “slack”")).toBeInTheDocument();
    expect(screen.getByText("Try another word, or add it as a custom server.")).toBeInTheDocument();
    expect(screen.queryByText(/is built in/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByPlaceholderText("Search tools")).toHaveValue("");
    expect(rowNames()).toHaveLength(3);
  });

  it("with no search words, an empty filter says so without the search copy", async () => {
    renderInstalled([FETCH, GITHUB]);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(screen.getByRole("option", { name: "Needs attention" }));

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No tools need attention")).toBeInTheDocument();
    expect(screen.getByText("Every tool is ready to use.")).toBeInTheDocument();
    expect(screen.queryByText(/Try another word/)).not.toBeInTheDocument();
    const card = screen.getByText("No tools need attention").closest("section") as HTMLElement;
    expect(
      within(card)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Clear filter"]);
    fireEvent.click(within(card).getByRole("button", { name: "Clear filter" }));
    expect(rowNames()).toEqual(["fetch", "github"]);
  });

  it("an empty Ready filter says every tool needs attention", async () => {
    renderInstalled([LINEAR]);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(screen.getByRole("option", { name: "Ready" }));
    expect(screen.getByText("No tools are ready")).toBeInTheDocument();
    expect(
      screen.getByText("Every tool needs attention. Open one to see what it needs."),
    ).toBeInTheDocument();
  });

  it("keeps the search words while you open a tool and come back", async () => {
    setToolsQuery("git");
    renderInstalled();
    await screen.findByRole("table");
    expect(screen.getByPlaceholderText("Search tools")).toHaveValue("git");
    expect(rowNames()).toEqual(["github"]);
  });

  it("opens a tool's page from its row", async () => {
    renderInstalled();
    await screen.findByRole("table");
    const row = within(table()).getAllByRole("row")[2];
    fireEvent.click(within(row).getByText("3 agents · 2 teams"));
    expect(window.location.hash).toBe("#/toolkit/tools/t-github");
  });

  it("shows the empty state with Browse catalog when there are no tools", async () => {
    renderInstalled([]);
    expect(await screen.findByText("No tools yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Tools are MCP servers your agents can call, like web fetch or GitHub. Start from the catalog, or connect your own.",
      ),
    ).toBeInTheDocument();
    // The Installed tab shows no count at 0 (like the nav badge, TOOL-3).
    expect(screen.getByRole("tab", { name: "Installed" })).toBeInTheDocument();
    const empty = screen.getByText("No tools yet").parentElement as HTMLElement;
    expect(within(empty).getByRole("button", { name: "Paste mcp.json" })).toBeInTheDocument();
    fireEvent.click(within(empty).getByRole("button", { name: "Browse catalog" }));
    expect(window.location.hash).toBe("#/toolkit/tools/browse");
  });

  it("says it couldn't load the tools and retries", async () => {
    let fail = true;
    mockApi({
      "GET /api/tool-library": () =>
        fail
          ? new Response(JSON.stringify({ detail: "boom" }), { status: 500 })
          : { tools: [FETCH] },
    });
    renderWithProviders(<ToolsPage view="installed" />);
    expect(await screen.findByText("Couldn’t load your tools.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(rowNames()).toEqual(["fetch"]));
  });

  it("drops a malformed tool instead of blanking the list", async () => {
    renderInstalled([FETCH, { nope: true } as never]);
    await screen.findByRole("table");
    expect(rowNames()).toEqual(["fetch"]);
  });
});

describe("Tools · tabs", () => {
  it("switches to Browse through the address; Browse has no Paste button or search", async () => {
    mockApi({
      "GET /api/tool-library": { tools: [FETCH] },
      "GET /api/tool-catalog": {
        tools: [{ key: "fetch", title: "Web fetch", description: "", attachable: true }],
      },
    });
    const { rerender } = renderWithProviders(<ToolsPage view="installed" />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("tab", { name: "Browse" }));
    expect(window.location.hash).toBe("#/toolkit/tools/browse");

    rerender(<ToolsPage view="browse" />);
    expect(await screen.findByText("Web fetch")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Browse" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: /Paste mcp\.json/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add tool/ })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search tools")).not.toBeInTheDocument();
    // The Installed count stays (it never depends on filters).
    expect(screen.getByRole("tab", { name: "Installed 1" })).toBeInTheDocument();
  });
});
