/**
 * Toolkit › Connectors › one connector (Page-One-connector-Supabase): the header, the Connection
 * card (project, access, connected date, sign-in), What agents can call, Used by and Recent use,
 * and the states a connector can be in.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectionDetail } from "../../lib/api/connectors";
import { refreshBadges } from "../../lib/workspaceStatus";
import { mockApi, renderWithProviders, resetToolkitStores } from "../tools/toolsTestUtils";
import { ConnectorDetailPage } from "./ConnectorDetailPage";
import { connection } from "./connectorsTestUtils";

vi.mock("../../lib/workspaceStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/workspaceStatus")>()),
  refreshBadges: vi.fn(async () => {}),
}));

const thisYear = new Date().getFullYear();
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const usage = (role_name: string, access: "read" | "write" = "read") => ({
  node_id: `n-${role_name}`,
  role_name,
  title: null,
  team_id: "team-ind",
  team_name: "Indicator sprint team",
  access,
});

const tool = (name: string, write = false, on = !write) => ({ name, title: null, write, on });

function detail(over: Partial<ConnectionDetail> = {}): ConnectionDetail {
  return {
    ...connection({
      connected_at: `${thisYear}-09-28T10:02:11+00:00`,
      tools: [
        tool("list_tables"),
        tool("execute_sql"),
        tool("apply_migration", true),
        tool("create_branch", true),
      ],
    }),
    used_by_agents: [usage("engineer"), usage("reviewer")],
    recent_use: [
      { run_id: "r42", run_number: 42, agent: "Reviewer", reads: 6, writes: 0, at: minutesAgo(12) },
      {
        run_id: "r41",
        run_number: 41,
        agent: "Engineer",
        reads: 3,
        writes: 1,
        at: minutesAgo(130),
      },
    ],
    revoke_hint: "To remove Tvashtr on Supabase’s side too, revoke it in Supabase’s settings.",
    ...over,
  };
}

function fakePopup() {
  return { location: { href: "about:blank" }, opener: window as unknown, close: vi.fn() };
}

/** A fake server for one connection: GET follows PATCH, PUT agents and a check (`checked`). */
function serve(
  initial: ConnectionDetail = detail(),
  routes: Record<string, unknown> = {},
  checked: Partial<ConnectionDetail> = {},
) {
  let row = structuredClone(initial);
  return mockApi({
    "GET /api/connectors/c1": () => row,
    "POST /api/connectors/c1/check": () => {
      row = { ...row, ...checked };
      return row;
    },
    "PATCH /api/connectors/c1": (_u: URL, body: Partial<ConnectionDetail>) => {
      row = { ...row, ...body };
      return row;
    },
    "PUT /api/connectors/c1/agents": (_u: URL, body: { node_ids: string[] }) => {
      row = {
        ...row,
        used_by_agents: row.used_by_agents.filter((a) => body.node_ids.includes(a.node_id)),
      };
      return { agents: row.used_by_agents, agent_count: row.used_by_agents.length, team_count: 1 };
    },
    ...routes,
  });
}

async function open() {
  renderWithProviders(<ConnectorDetailPage connectorId="c1" />);
  await screen.findByRole("heading", { level: 1 });
}
const card = (name: string | RegExp) => screen.getByRole("region", { name });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  resetToolkitStores();
  window.location.hash = "#/toolkit/connectors/c1";
  vi.stubGlobal(
    "open",
    vi.fn(() => fakePopup()),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(refreshBadges).mockClear();
  resetToolkitStores();
});

describe("ConnectorDetailPage", () => {
  it("shows the connector: header, connection, tools, who uses it and recent use", async () => {
    serve();
    await open();

    expect(screen.getByRole("link", { name: "Connectors" })).toHaveAttribute(
      "href",
      "#/toolkit/connectors",
    );
    expect(screen.getByRole("heading", { level: 1, name: "Supabase" })).toBeInTheDocument();
    const head = screen.getByRole("heading", { level: 1 }).parentElement as HTMLElement;
    expect(head).toHaveTextContent("SupabaseReadyRead onlyBy Supabase");
    expect(screen.getByRole("button", { name: "Change access" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions for Supabase" })).toBeInTheDocument();

    const conn = card("Connection");
    const rows = Array.from(conn.querySelectorAll("dt")).map(
      (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`,
    );
    expect(rows).toEqual([
      "Project: trade-mcp-prod · ap-southeast-1",
      "Access: Read only",
      "Connected: Sep 28 by you",
      "Sign-in: Renews by itself",
    ]);
    expect(within(conn).getByRole("button", { name: "Change project" })).toBeInTheDocument();
    expect(within(conn).getByRole("button", { name: "Change what agents may do" })).toBeEnabled();
    expect(within(conn).getByRole("button", { name: "Sign in again" })).toBeInTheDocument();

    const tools = card("What agents can call");
    expect(
      within(tools)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "list_tablesRead",
      "execute_sqlRead",
      "apply_migrationOff · write",
      "create_branchOff · write",
    ]);
    expect(tools).toHaveTextContent(
      "Write tools stay off while access is read only. execute_sql runs as a read-only database user.",
    );

    const used = card("Used by · 2 agents");
    expect(
      within(used)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["EngineerIndicator sprint teamRead only", "ReviewerIndicator sprint teamRead only"]);
    expect(within(used).getByRole("button", { name: "Give an agent access" })).toBeInTheDocument();
    expect(
      within(used).getByRole("button", { name: "Remove access for Engineer" }),
    ).toBeInTheDocument();

    expect(
      within(card("Recent use"))
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Run 42Reviewer · 6 reads12m ago", "Run 41Engineer · 3 reads, 1 write2h ago"]);
  });

  it("says the connector isn’t there any more (404)", async () => {
    mockApi({
      "GET /api/connectors/c1": new Response(JSON.stringify({ detail: "Connector not found." }), {
        status: 404,
      }),
    });
    renderWithProviders(<ConnectorDetailPage connectorId="c1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This connector isn’t connected any more.",
    );
    click("Back to connectors");
    expect(window.location.hash).toBe("#/toolkit/connectors");
  });

  it("says it couldn’t load, and retries", async () => {
    let fail = true;
    mockApi({
      "GET /api/connectors/c1": () =>
        fail ? new Response(JSON.stringify({ detail: "boom" }), { status: 500 }) : detail(),
    });
    renderWithProviders(<ConnectorDetailPage connectorId="c1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load this connector.");
    fail = false;
    click("Retry");
    expect(await screen.findByRole("heading", { level: 1, name: "Supabase" })).toBeInTheDocument();
  });

  it("warns when no tool is marked read-only", async () => {
    serve(
      detail({
        read_only_by: "annotations",
        tools: [tool("create_issue", true), tool("update_issue", true)],
      }),
    );
    await open();
    expect(within(card("What agents can call")).getByRole("alert")).toHaveTextContent(
      "This server doesn’t mark any tool as read-only. Agents can’t call anything until access is Read & write.",
    );
  });

  it("marks the write tools that are on for a read & write connection", async () => {
    serve(
      detail({
        access: "write",
        tools: [tool("list_tables"), tool("apply_migration", true, true)],
      }),
    );
    await open();
    const tools = card("What agents can call");
    expect(
      within(tools)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["list_tablesRead", "apply_migrationWrite"]);
    expect(tools).toHaveTextContent(
      "An agent can call the write tools only when its own access is Read & write too.",
    );
    expect(screen.getByRole("heading", { level: 1 }).parentElement).toHaveTextContent(
      "Read & write",
    );
  });

  it("offers to list the tools again when they were never listed", async () => {
    const calls = serve(detail({ tools: null }), {}, { tools: [tool("list_tables")] });
    await open();
    const tools = card("What agents can call");
    expect(tools).toHaveTextContent("Tvashtr couldn’t list this connector’s tools.");
    fireEvent.click(within(tools).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(within(tools).getAllByRole("listitem")).toHaveLength(1));
    expect(calls.at(-2)).toMatchObject({ method: "POST", path: "/api/connectors/c1/check" });
  });

  it("says what the check found when the provider didn’t answer", async () => {
    serve(detail({ tools: null }), {
      "POST /api/connectors/c1/check": new Response(
        JSON.stringify({
          detail: {
            code: "unreachable",
            message: "We couldn’t reach mcp.supabase.com. Try again.",
          },
        }),
        { status: 502 },
      ),
    });
    await open();
    click("Check again");
    expect(
      await screen.findByText("We couldn’t reach mcp.supabase.com. Try again."),
    ).toBeInTheDocument();
  });

  it("shows an expired sign-in and signs in again in the window the click opened", async () => {
    const calls = serve(detail({ status: "needs_signin", last_error: "Its sign-in expired." }), {
      "POST /api/connectors/c1/oauth/start": {
        authorize_url: "https://api.supabase.com/v1/oauth/authorize?state=s",
        signin_host: "api.supabase.com",
        expires_in: 600,
      },
    });
    await open();
    expect(screen.getByRole("heading", { level: 1 }).parentElement).toHaveTextContent(
      "SupabaseNeeds attention",
    );
    expect(card("Connection")).toHaveTextContent("Sign-inIts sign-in expired.");

    click("Sign in again");
    expect(window.open).toHaveBeenCalledExactlyOnceWith(
      "",
      "tv-connect",
      "popup,width=520,height=720",
    );
    expect(screen.getByRole("dialog", { name: "Sign in to Supabase" })).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.at(-1)).toMatchObject({ path: "/api/connectors/c1/oauth/start" }),
    );
  });

  it("shows a connection whose first sign-in never finished", async () => {
    serve(detail({ status: "pending", connected_at: null, tools: null, used_by_agents: [] }));
    await open();
    expect(screen.getByRole("heading", { level: 1 }).parentElement).toHaveTextContent(
      "SupabaseNot connected yet",
    );
    const conn = card("Connection");
    expect(conn).toHaveTextContent("Connected—");
    expect(conn).toHaveTextContent("Sign-inNot finished yet");
    expect(within(conn).getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    // Nobody can be given a connector that isn't connected.
    expect(screen.getByRole("button", { name: "Give an agent access" })).toBeDisabled();
  });

  it("replaces the key of a key connection", async () => {
    serve(detail({ auth_kind: "api_key", signin_host: null, scope: null, scope_picker: null }), {
      "GET /api/connectors/catalog": { items: [], total: 0, next_offset: null, categories: [] },
    });
    await open();
    const conn = card("Connection");
    expect(conn).toHaveTextContent("KeyKept encrypted with this connector");
    // Nothing to pick on a connector without projects.
    expect(conn).not.toHaveTextContent("Project");
    fireEvent.click(within(conn).getByRole("button", { name: "Replace key" }));
    expect(screen.getByRole("dialog", { name: "Replace Supabase’s key" })).toBeInTheDocument();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("changes the project", async () => {
    serve(detail(), {
      "GET /api/connectors/c1/scope-options": {
        param: "project_ref",
        label: "Project",
        manual: false,
        options: [
          { value: "abcd1234", label: "trade-mcp-prod", detail: "ap-southeast-1" },
          { value: "efgh5678", label: "trade-mcp-staging", detail: "ap-southeast-1" },
        ],
      },
    });
    await open();
    click("Change project");
    const sheet = screen.getByRole("dialog", { name: "Change project" });
    fireEvent.click((await within(sheet).findAllByRole("radio"))[1]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(card("Connection")).toHaveTextContent("trade-mcp-staging · ap-southeast-1"),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("Supabase now uses trade-mcp-staging.")).toBeInTheDocument();
  });

  it("changes what agents may do, from the header or the card", async () => {
    const calls = serve();
    await open();
    click("Change access");
    const dialog = screen.getByRole("dialog", { name: "Change access" });
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(dialog).toHaveTextContent("Read only applies at once, also to a run that is going.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Read & write" }));
    expect(dialog).toHaveTextContent(
      "Each agent stays read only until you choose Read & write for it in its Skills & tools tab.",
    );
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.at(-2)).toEqual({
      method: "PATCH",
      path: "/api/connectors/c1",
      body: { access: "write" },
    });
    expect(await screen.findByText("Supabase is now read & write.")).toBeInTheDocument();
    await waitFor(() => expect(card("Connection")).toHaveTextContent("AccessRead & write"));
    expect(refreshBadges).toHaveBeenCalled();

    // The card's Change opens the same dialog.
    click("Change what agents may do");
    expect(screen.getByRole("dialog", { name: "Change access" })).toBeInTheDocument();
  });

  it("says why an access change was refused", async () => {
    serve(detail(), {
      "PATCH /api/connectors/c1": new Response(
        JSON.stringify({
          detail: {
            code: "invalid_access",
            message: "Supabase can only be connected read only.",
          },
        }),
        { status: 422 },
      ),
    });
    await open();
    click("Change access");
    const dialog = screen.getByRole("dialog", { name: "Change access" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Read & write" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Supabase can only be connected read only.",
    );
  });

  it("has no access to change on a connector that can only read", async () => {
    serve(detail({ access_modes: ["read"] }));
    await open();
    expect(screen.queryByRole("button", { name: "Change access" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change what agents may do" })).toBeNull();
  });

  it("removes one agent’s access", async () => {
    const calls = serve();
    await open();
    click("Remove access for Engineer");
    await waitFor(() => expect(card("Used by · 1 agent")).toBeInTheDocument());
    expect(calls.find((c) => c.method === "PUT")).toEqual({
      method: "PUT",
      path: "/api/connectors/c1/agents",
      body: { node_ids: ["n-reviewer"] },
    });
    expect(await screen.findByText("Engineer can’t use Supabase any more.")).toBeInTheDocument();
    expect(refreshBadges).toHaveBeenCalled();
  });

  it("says nobody uses it yet, and nothing has called it", async () => {
    serve(detail({ used_by_agents: [], recent_use: [] }));
    await open();
    expect(card("Used by")).toHaveTextContent(
      "No agent uses it yet. Give one access here, or tick it in an agent’s Skills & tools tab.",
    );
    expect(card("Recent use")).toHaveTextContent("No agent has called it yet.");
  });

  it("offers Change project and Disconnect in the header menu", async () => {
    serve();
    await open();
    click("More actions for Supabase");
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Change project",
      "Disconnect",
    ]);
  });

  it("gives another agent access", async () => {
    const calls = serve(detail(), {
      "GET /api/connectors/c1/agents": {
        teams: [
          {
            team_id: "team-ind",
            team_name: "Indicator sprint team",
            agents: ["pm", "engineer", "reviewer"].map((role_name) => ({
              node_id: `n-${role_name}`,
              role_name,
              title: null,
              kind: "agent",
              edits_allowed: false,
              enabled: role_name !== "pm",
              access: role_name === "pm" ? null : "read",
              subscription: null,
            })),
          },
        ],
      },
      "PUT /api/connectors/c1/agents": (_u: URL, body: { node_ids: string[] }) => ({
        agents: body.node_ids.map((id) => usage(id.slice(2))),
        agent_count: 3,
        team_count: 1,
      }),
    });
    await open();
    click("Give an agent access");
    const dialog = screen.getByRole("dialog", { name: "Give agents access to Supabase" });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "Product manager" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Product manager can now use Supabase (read only)."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
      node_ids: ["n-pm", "n-engineer", "n-reviewer"],
    });
    // The page reads the connection again.
    expect(calls.at(-1)).toMatchObject({ method: "GET", path: "/api/connectors/c1" });
    expect(refreshBadges).toHaveBeenCalled();
  });

  it("disconnects and goes back to the list", async () => {
    const calls = serve(detail(), {
      "DELETE /api/connectors/c1": { removed_from_agents: 2, revoked: true },
    });
    await open();
    click("More actions for Supabase");
    fireEvent.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    // The page already knows who uses it: the dialog opens at once, with no second read.
    const dialog = screen.getByRole("alertdialog", { name: "Disconnect Supabase?" });
    expect(dialog).toHaveTextContent(
      "Engineer and Reviewer in Indicator sprint team use it. They lose access now",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(window.location.hash).toBe("#/toolkit/connectors"));
    expect(
      await screen.findByText("Supabase is disconnected. It’s back in Browse if you need it."),
    ).toBeInTheDocument();
    expect(calls.map((c) => c.method)).toEqual(["GET", "DELETE"]);
    expect(refreshBadges).toHaveBeenCalled();
  });

  it("labels a server Tvashtr hasn’t reviewed", async () => {
    serve(detail({ featured: false, reviewed: false, publisher: null, host: "mcp.apify.com" }));
    await open();
    expect(screen.getByRole("heading", { level: 1 }).parentElement).toHaveTextContent(
      "mcp.apify.comFrom the MCP Registry · not reviewed by Tvashtr",
    );
  });
});
