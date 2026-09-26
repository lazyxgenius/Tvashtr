/**
 * Toolkit › Tools › one tool (Toolkit-ToolDetail, TkF-Detail-1..5, TOOL-52..60): the breadcrumb,
 * header, Connection card (Name, URL, read-only headers, raw JSON), Save / Discard / the leave
 * confirm, Duplicate, Remove, and Used by.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolItem } from "../../lib/api/tools";
import { refreshBadges } from "../../lib/workspaceStatus";
import { ToolDetailPage } from "./ToolDetailPage";
import { GITHUB, mockApi, renderWithProviders, resetToolkitStores, tool } from "./toolsTestUtils";
import { setToolsQuery, setToolsStatus, useToolsView } from "./toolsState";

vi.mock("../../lib/workspaceStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/workspaceStatus")>()),
  refreshBadges: vi.fn(async () => {}),
}));

const HERE = "#/toolkit/tools/t-github";

beforeEach(() => {
  resetToolkitStores();
  window.location.hash = HERE;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(refreshBadges).mockClear();
  delete document.documentElement.dataset.tvashtrDesktop;
  Reflect.deleteProperty(window, "tvashtrDesktop");
  resetToolkitStores();
});

const usage = (role_name: string, team_id: string, team_name: string) => ({
  node_id: `n-${role_name}`,
  role_name,
  title: null,
  team_id,
  team_name,
});
const AGENTS = [
  usage("engineer", "team-ind", "Indicator sprint team"),
  usage("reviewer", "team-ind", "Indicator sprint team"),
  usage("writer", "team-docs", "Docs team"),
];
const SECRETS = {
  secrets: [
    {
      name: "GITHUB_TOKEN",
      created_at: "2026-09-20T10:00:00+00:00",
      updated_at: "2026-09-20T10:00:00+00:00",
      used_by_tools: [{ id: "t-github", name: "github" }],
    },
  ],
  missing: [],
};
const GITHUB_ITEM: ToolItem = {
  ...GITHUB,
  server_config: {
    url: "https://api.githubcopilot.com/mcp",
    headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
  },
};

const lastSegment = (url: URL) => decodeURIComponent(url.pathname.split("/")[3] ?? "");

/** A fake server for one tool: GET follows PATCHes; DELETE and duplicate answer like the API. */
function serve(
  initial: ToolItem = GITHUB_ITEM,
  agents = AGENTS,
  overrides: Record<string, unknown> = {},
) {
  let item = structuredClone(initial);
  return mockApi({
    "GET /api/secrets": SECRETS,
    [`GET /api/tool-library/${initial.id}`]: () => ({ ...item, used_by_agents: agents }),
    [`PATCH /api/tool-library/${initial.id}`]: (_u: URL, body: Record<string, unknown>) => {
      item = { ...item, ...body };
      return item;
    },
    [`DELETE /api/tool-library/${initial.id}`]: { removed_from_agents: agents.length },
    "POST /api/tool-library/:id/duplicate": (url: URL) =>
      new Response(
        JSON.stringify({ ...item, id: `${lastSegment(url)}-copy`, name: `${item.name}-copy` }),
        { status: 201 },
      ),
    ...overrides,
  });
}

async function open(id = "t-github") {
  renderWithProviders(<ToolDetailPage toolId={id} />);
  await screen.findByRole("heading", { level: 1 });
}
const card = (name: string | RegExp) => screen.getByRole("region", { name });
const urlBox = () => screen.getByLabelText<HTMLInputElement>("URL");

describe("ToolDetailPage", () => {
  it("shows the tool: breadcrumb, header, connection, remove and who uses it", async () => {
    serve();
    await open();

    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Tools" })).toHaveAttribute(
      "href",
      "#/toolkit/tools",
    );
    expect(within(crumbs).getByText("github")).toHaveAttribute("aria-current", "page");

    expect(screen.getByRole("heading", { level: 1, name: "github" })).toBeInTheDocument();
    expect(screen.getByText("Remote")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();

    const conn = card("Connection");
    expect(within(conn).getByLabelText<HTMLInputElement>("Name").value).toBe("github");
    expect(urlBox().value).toBe("https://api.githubcopilot.com/mcp");
    expect(within(conn).getByText("Headers")).toBeInTheDocument();
    expect(within(conn).getByText(/Authorization: Bearer/)).toBeInTheDocument();
    expect(await within(conn).findByText("· set")).toBeInTheDocument();
    // Headers are read-only here: no header inputs, no "Where it runs", no hint.
    expect(within(conn).queryByRole("group", { name: "Where it runs" })).not.toBeInTheDocument();
    expect(within(conn).queryByText(/to pick a secret/)).not.toBeInTheDocument();

    expect(
      within(card("Remove from Toolkit")).getByText(
        "The 3 agents above lose it on their next run.",
      ),
    ).toBeInTheDocument();

    const used = card("Used by 3 agents in 2 teams");
    const rows = within(used).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Engineer")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Indicator sprint team")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Writer")).toBeInTheDocument();
    expect(within(rows[2]).getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "#/teams/team-docs?node=n-writer&tab=skills",
    );
    expect(
      within(used).getByText("Edits here reach every agent above on its next run."),
    ).toBeInTheDocument();
  });

  it("keeps the list's search and filter when you go back to Tools, and forgets them elsewhere", async () => {
    serve();
    setToolsQuery("git");
    setToolsStatus("ready");
    const seen: string[] = [];
    function Probe() {
      const view = useToolsView();
      seen.push(`${view.query}/${view.status}`);
      return null;
    }
    const { unmount } = renderWithProviders(
      <>
        <ToolDetailPage toolId="t-github" />
        <Probe />
      </>,
    );
    await screen.findByRole("heading", { level: 1 });
    window.location.hash = "#/toolkit/tools";
    unmount();
    const { unmount: unmount2 } = renderWithProviders(<Probe />);
    expect(seen.at(-1)).toBe("git/ready");
    unmount2();

    window.location.hash = HERE;
    renderWithProviders(<ToolDetailPage toolId="t-github" />);
    await screen.findByRole("heading", { level: 1 });
    window.location.hash = "#/home";
    cleanup();
    renderWithProviders(<Probe />);
    expect(seen.at(-1)).toBe("/all");
  });

  it("an edit shows Unsaved and Discard; Discard puts the saved settings back", async () => {
    serve();
    await open();
    fireEvent.change(urlBox(), { target: { value: "https://api.githubcopilot.com/mcp/v2" } });

    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(urlBox().value).toBe("https://api.githubcopilot.com/mcp");
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("editing back to the saved value is clean again", async () => {
    serve();
    await open();
    fireEvent.change(urlBox(), { target: { value: "https://x.example/mcp" } });
    fireEvent.change(urlBox(), { target: { value: "https://api.githubcopilot.com/mcp" } });
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
  });

  it("the raw JSON shows short objects on one line and edits the form", async () => {
    serve();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Advanced (raw JSON)" }));
    const raw = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Advanced (raw JSON)" });
    expect(raw.value).toBe(
      [
        "{",
        '  "url": "https://api.githubcopilot.com/mcp",',
        '  "headers": { "Authorization": "Bearer ${GITHUB_TOKEN}" }',
        "}",
      ].join("\n"),
    );
    // No sync note under it on this page.
    expect(screen.queryByText(/stay in sync/)).not.toBeInTheDocument();

    fireEvent.change(raw, {
      target: {
        value: '{ "url": "https://api.githubcopilot.com/mcp/v2", "headers": { "X-Team": "docs" } }',
      },
    });
    expect(urlBox().value).toBe("https://api.githubcopilot.com/mcp/v2");
    expect(screen.getByText(/X-Team: docs/)).toBeInTheDocument();
    expect(screen.getByText("Unsaved")).toBeInTheDocument();

    fireEvent.change(raw, { target: { value: "{ nope" } });
    expect(screen.getByRole("alert")).toHaveTextContent("This isn’t valid JSON yet.");
  });

  it("Save sends only what changed and toasts how many agents pick it up", async () => {
    const calls = serve();
    await open();
    fireEvent.change(urlBox(), { target: { value: "https://api.githubcopilot.com/mcp/v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("Saved. 3 agents use the new settings on their next run."),
    ).toBeInTheDocument();
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.path).toBe("/api/tool-library/t-github");
    expect(patch?.body).toEqual({
      server_config: {
        url: "https://api.githubcopilot.com/mcp/v2",
        headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
      },
    });
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(urlBox().value).toBe("https://api.githubcopilot.com/mcp/v2");
    expect(refreshBadges).toHaveBeenCalled();
  });

  it("Enter in a field saves", async () => {
    const calls = serve();
    await open();
    fireEvent.change(urlBox(), { target: { value: "https://api.githubcopilot.com/mcp/v2" } });
    fireEvent.submit(urlBox());
    await screen.findByText(/^Saved\./);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("a tool no agent uses says just Saved., and offers to turn it on", async () => {
    const unused = { ...GITHUB_ITEM, used_by: { agent_count: 0, team_count: 0 } };
    serve(unused, []);
    await open();
    const used = card("Not used yet");
    expect(
      within(used).getByText("Turn it on for an agent in its Skills & tools tab."),
    ).toBeInTheDocument();
    expect(within(card("Remove from Toolkit")).getByText("No agents use it.")).toBeInTheDocument();

    fireEvent.change(urlBox(), { target: { value: "https://api.githubcopilot.com/mcp/v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("Turn on for agents… from an unused tool fills in Used by", async () => {
    const unused = { ...GITHUB_ITEM, used_by: { agent_count: 0, team_count: 0 } };
    let agents: typeof AGENTS = [];
    const calls = serve(unused, agents, {
      "GET /api/tool-library/t-github": () => ({ ...unused, used_by_agents: agents }),
      "GET /api/agents": {
        teams: [
          {
            team_id: "team-docs",
            team_name: "Docs team",
            agents: [
              {
                node_id: "n-writer",
                role_name: "writer",
                title: null,
                kind: "agent",
                edits_allowed: true,
                enabled: false,
                overridden: false,
              },
            ],
          },
        ],
      },
      "PUT /api/tool-library/t-github/agents": () => {
        agents = [usage("writer", "team-docs", "Docs team")];
        return {
          agents: [
            {
              node_id: "n-writer",
              role_name: "writer",
              team_id: "team-docs",
              team_name: "Docs team",
            },
          ],
          agent_count: 1,
          team_count: 1,
          skipped: [],
        };
      },
    });
    await open();
    fireEvent.click(
      within(card("Not used yet")).getByRole("button", { name: "Turn on for agents…" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Turn on for agents" });
    fireEvent.click(await within(dialog).findByLabelText("Writer"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn on for 1 agent" }));

    expect(await screen.findByText("github is on for 1 agent.")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ node_ids: ["n-writer"] });
    const used = await screen.findByRole("region", { name: "Used by 1 agent in 1 team" });
    expect(within(used).getByText("Writer")).toBeInTheDocument();
  });

  it("renames through the Name field; the rule and a clash show under it", async () => {
    const calls = serve(GITHUB_ITEM, AGENTS, {
      "PATCH /api/tool-library/t-github": (_u: URL, body: { name?: string }) =>
        body.name === "linear"
          ? new Response(JSON.stringify({ detail: "You already have a tool named linear." }), {
              status: 409,
            })
          : { ...GITHUB_ITEM, ...body },
    });
    await open();
    const name = screen.getByLabelText<HTMLInputElement>("Name");

    fireEvent.change(name, { target: { value: "Git Hub" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("Use lowercase letters, numbers, - and _, like my-server."),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);

    fireEvent.change(name, { target: { value: "linear" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("You already have a tool named linear.")).toBeInTheDocument();

    fireEvent.change(name, { target: { value: "gh" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("heading", { level: 1, name: "gh" });
    expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ name: "gh" });
  });

  it("a URL that can't connect is caught before saving", async () => {
    const calls = serve();
    await open();
    fireEvent.change(urlBox(), { target: { value: "api.githubcopilot.com/mcp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Use an http:// or https:// URL.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("a failed save keeps the edit and says so", async () => {
    serve(GITHUB_ITEM, AGENTS, {
      "PATCH /api/tool-library/t-github": () =>
        new Response(JSON.stringify({ detail: "boom" }), { status: 500 }),
    });
    await open();
    fireEvent.change(urlBox(), { target: { value: "https://api.githubcopilot.com/mcp/v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Couldn’t save github. Try again.")).toBeInTheDocument();
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
  });

  it("Remove asks naming the agents, then goes back to the list with a toast", async () => {
    const calls = serve();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Remove github?" });
    expect(dialog).toHaveTextContent(
      "Engineer, Reviewer and Writer lose it on their next run. You can add it again later.",
    );
    // It already knows the agents: no second look-up.
    expect(calls.filter((c) => c.path === "/api/tool-library/t-github")).toHaveLength(1);

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove tool" }));
    expect(await screen.findByText("github removed from Toolkit.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    expect(window.location.hash).toBe("#/toolkit/tools");
    expect(refreshBadges).toHaveBeenCalled();
  });

  it("Remove while editing doesn't ask about leaving", async () => {
    serve();
    await open();
    fireEvent.change(urlBox(), { target: { value: "https://api.githubcopilot.com/mcp/v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Remove github?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove tool" }));
    await screen.findByText("github removed from Toolkit.");
    expect(window.location.hash).toBe("#/toolkit/tools");
    expect(screen.queryByRole("alertdialog", { name: "Leave without saving?" })).toBeNull();
  });

  it("Duplicate copies it and offers to open the copy", async () => {
    const calls = serve();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    const toast = (await screen.findByText("Copied as github-copy. Rename it in its settings."))
      .parentElement as HTMLElement;
    expect(calls.some((c) => c.path === "/api/tool-library/t-github/duplicate")).toBe(true);
    fireEvent.click(within(toast).getByRole("button", { name: "Open" }));
    expect(window.location.hash).toBe("#/toolkit/tools/t-github-copy");
  });

  it("leaving with unsaved edits asks first: Keep editing stays, Leave goes", async () => {
    serve();
    await open();
    fireEvent.change(urlBox(), { target: { value: "https://api.githubcopilot.com/mcp/v2" } });

    act(() => {
      window.location.hash = "#/home";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    const ask = await screen.findByRole("alertdialog", { name: "Leave without saving?" });
    expect(window.location.hash).toBe(HERE);
    fireEvent.click(within(ask).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog", { name: "Leave without saving?" })).toBeNull();
    expect(urlBox().value).toBe("https://api.githubcopilot.com/mcp/v2");

    act(() => {
      window.location.hash = "#/home";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    const again = await screen.findByRole("alertdialog", { name: "Leave without saving?" });
    fireEvent.click(within(again).getByRole("button", { name: "Leave without saving" }));
    expect(window.location.hash).toBe("#/home");
  });

  it("closing the tab while editing asks (beforeunload); a clean page doesn't", async () => {
    serve();
    await open();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.change(urlBox(), { target: { value: "https://api.githubcopilot.com/mcp/v2" } });
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it("Desktop: tells the app about unsaved edits so closing the window asks", async () => {
    const setUnsavedChanges = vi.fn();
    Object.defineProperty(window, "tvashtrDesktop", {
      value: { app: { setUnsavedChanges } },
      configurable: true,
    });
    document.documentElement.dataset.tvashtrDesktop = "true";
    serve();
    await open();
    fireEvent.change(urlBox(), { target: { value: "https://api.githubcopilot.com/mcp/v2" } });
    expect(setUnsavedChanges).toHaveBeenLastCalledWith({ dirty: true, agentName: "github" });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(setUnsavedChanges).toHaveBeenLastCalledWith({ dirty: false });
  });

  it("a local tool shows its command, arguments and environment with secret chips", async () => {
    const sqlite = tool(
      "t-sqlite",
      "sqlite",
      {
        command: "uvx",
        args: ["mcp-server-sqlite", "--db", "data.db"],
        env: { API_KEY: "${SQLITE_KEY}" },
      },
      {
        secret_refs: ["SQLITE_KEY"],
        missing_secrets: ["SQLITE_KEY"],
        status: "needs_attention",
      },
    );
    serve(sqlite, []);
    await open("t-sqlite");
    expect(screen.getByText("Local")).toHaveAttribute("title", "Runs in the agent’s sandbox");
    expect(screen.getByText("Needs SQLITE_KEY")).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLInputElement>("Command").value).toBe("uvx");
    expect(screen.getByLabelText<HTMLInputElement>(/Arguments/).value).toBe(
      "mcp-server-sqlite --db data.db",
    );
    const conn = card("Connection");
    expect(within(conn).getByText("Environment")).toBeInTheDocument();
    expect(within(conn).getByText(/API_KEY=/)).toBeInTheDocument();
    expect(await within(conn).findByText("· not set")).toBeInTheDocument();
  });

  it("a tool that isn't yours (404) offers the way back", async () => {
    mockApi({
      "GET /api/secrets": SECRETS,
      "GET /api/tool-library/t-gone": () =>
        new Response(JSON.stringify({ detail: "tool not found in your library" }), {
          status: 404,
        }),
    });
    renderWithProviders(<ToolDetailPage toolId="t-gone" />);
    expect(
      await screen.findByText("This tool isn’t in your Toolkit any more."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to tools" }));
    await waitFor(() => expect(window.location.hash).toBe("#/toolkit/tools"));
  });

  it("a load failure offers Retry", async () => {
    let fail = true;
    mockApi({
      "GET /api/secrets": SECRETS,
      "GET /api/tool-library/t-github": () =>
        fail
          ? new Response(JSON.stringify({ detail: "boom" }), { status: 500 })
          : { ...GITHUB_ITEM, used_by_agents: AGENTS },
    });
    renderWithProviders(<ToolDetailPage toolId="t-github" />);
    expect(await screen.findByText("Couldn’t load this tool.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { level: 1, name: "github" })).toBeInTheDocument();
  });
});
