/**
 * Toolkit › Tools row actions (TkF-FixSecret-*, TkF-ToolMenu-*, TOOL-47..51, 67..68): the row's
 * Add secret, and the ⋯ menu's Edit connection, Duplicate, Turn on for agents… and Remove.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolItem } from "../../lib/api/tools";
import { refreshBadges } from "../../lib/workspaceStatus";
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

vi.mock("../../lib/workspaceStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/workspaceStatus")>()),
  refreshBadges: vi.fn(async () => {}),
}));

beforeEach(() => resetToolkitStores());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(refreshBadges).mockClear();
  delete document.documentElement.dataset.tvashtrDesktop;
  resetToolkitStores();
});

const usage = (role_name: string, team_id: string, team_name: string) => ({
  node_id: `n-${role_name}`,
  role_name,
  title: null,
  team_id,
  team_name,
});
const GITHUB_AGENTS = [
  usage("engineer", "team-ind", "Indicator sprint team"),
  usage("reviewer", "team-ind", "Indicator sprint team"),
  usage("writer", "team-docs", "Docs team"),
];
const choice = (node_id: string, role_name: string, extra = {}) => ({
  node_id,
  role_name,
  title: null,
  kind: "agent",
  edits_allowed: true,
  enabled: false,
  overridden: false,
  ...extra,
});
const AGENT_TEAMS = {
  teams: [
    {
      team_id: "team-ind",
      team_name: "Indicator sprint team",
      agents: [
        choice("n-pm", "pm", { edits_allowed: false }),
        choice("n-eng", "engineer"),
        choice("n-rev", "reviewer", { enabled: true }),
      ],
    },
    { team_id: "team-docs", team_name: "Docs team", agents: [choice("n-wri", "writer")] },
  ],
};

const lastSegment = (url: URL, i = 3) => decodeURIComponent(url.pathname.split("/")[i] ?? "");

/** A fake server whose tool list follows the saves, removals and copies. */
function serve(
  initial: ToolItem[] = [FETCH, GITHUB, LINEAR],
  overrides: Record<string, unknown> = {},
) {
  let tools = structuredClone(initial);
  const calls = mockApi({
    "GET /api/tool-library": () => ({ tools }),
    "GET /api/tool-library/:id": (url: URL) => {
      const t = tools.find((x) => x.id === lastSegment(url));
      return t
        ? { ...t, used_by_agents: t.id === GITHUB.id ? GITHUB_AGENTS : [] }
        : new Response(JSON.stringify({ detail: "tool not found in your library" }), {
            status: 404,
          });
    },
    "POST /api/secrets": (_url: URL, body: { name: string }) => {
      tools = tools.map((t) => {
        const missing = t.missing_secrets.filter((n) => n !== body.name);
        return { ...t, missing_secrets: missing, status: missing.length ? t.status : "ready" };
      });
      return { name: body.name, created_at: "2026-09-26T10:00:00Z", updated_at: null };
    },
    "DELETE /api/tool-library/:id": (url: URL) => {
      const gone = tools.find((t) => t.id === lastSegment(url));
      tools = tools.filter((t) => t.id !== lastSegment(url));
      return { removed_from_agents: gone?.used_by.agent_count ?? 0 };
    },
    "POST /api/tool-library/:id/duplicate": (url: URL) => {
      const src = tools.find((t) => t.id === lastSegment(url));
      if (!src) return new Response(JSON.stringify({ detail: "no" }), { status: 404 });
      const copy = {
        ...src,
        id: `${src.id}-copy`,
        name: `${src.name}-copy`,
        used_by: { agent_count: 0, team_count: 0 },
      };
      tools = [...tools, copy];
      return new Response(JSON.stringify(copy), { status: 201 });
    },
    "GET /api/agents": AGENT_TEAMS,
    "PUT /api/tool-library/:id/agents": (_url: URL, body: { node_ids: string[] }) => ({
      agents: body.node_ids.map((id) => ({ ...usage(id, "team-ind", "Indicator sprint team") })),
      agent_count: body.node_ids.length,
      team_count: body.node_ids.length ? 1 : 0,
      skipped: [],
    }),
    ...overrides,
  });
  renderWithProviders(<ToolsPage view="installed" />);
  return calls;
}

const rowOf = (name: string) =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .find((r) => within(r).queryByRole("link", { name }))!;
const rowNames = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getByRole("link").textContent);
const openMenu = async (name: string) => {
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: `More actions for ${name}` }));
  return screen.getByRole("menu", { name: `More actions for ${name}` });
};
const choose = async (name: string, item: string) => {
  const menu = await openMenu(name);
  fireEvent.click(within(menu).getByRole("menuitem", { name: item }));
};
const toastSays = (text: string | RegExp) => screen.findByText(text);

describe("Tools · Add secret on a row", () => {
  it("opens Add <NAME> with the name fixed; saving turns the row Ready in place", async () => {
    const calls = serve();
    await screen.findByRole("table");
    fireEvent.click(within(rowOf("linear")).getByRole("button", { name: "Add secret" }));

    const dialog = screen.getByRole("dialog", { name: "Add LINEAR_TOKEN" });
    expect(within(dialog).getByLabelText<HTMLInputElement>("Name").value).toBe("LINEAR_TOKEN");
    expect(within(dialog).getByLabelText("Name")).toBeDisabled();
    expect(within(dialog).getByText("Stored encrypted. We never show a value again.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Value"), { target: { value: "lin_api_1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save secret" }));

    expect(await toastSays("LINEAR_TOKEN saved. linear is ready.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "LINEAR_TOKEN",
      value: "lin_api_1",
    });
    expect(within(rowOf("linear")).getByText("Ready")).toBeInTheDocument();
    expect(within(rowOf("linear")).queryByRole("button", { name: "Add secret" })).toBeNull();
    expect(rowNames()).toEqual(["fetch", "github", "linear"]);
    expect(refreshBadges).toHaveBeenCalled();
  });

  it("asks for each missing name when a tool needs 2 secrets", async () => {
    const jira = tool(
      "t-jira",
      "jira",
      { url: "https://jira.example/mcp", headers: { A: "${A_TOKEN}", B: "${B_TOKEN}" } },
      { missing_secrets: ["A_TOKEN", "B_TOKEN"], status: "needs_attention" },
    );
    const calls = serve([jira]);
    await screen.findByRole("table");
    expect(within(rowOf("jira")).getByText("Needs 2 secrets")).toBeInTheDocument();
    fireEvent.click(within(rowOf("jira")).getByRole("button", { name: "Add secret" }));

    const dialog = screen.getByRole("dialog", { name: "Add 2 secrets for jira" });
    expect(
      within(dialog).getByText(
        "jira uses A_TOKEN and B_TOKEN. It won’t connect until each has a value.",
      ),
    ).toBeInTheDocument();
    const save = within(dialog).getByRole("button", { name: "Save secrets" });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("A_TOKEN"), { target: { value: "a" } });
    fireEvent.change(within(dialog).getByLabelText("B_TOKEN"), { target: { value: "b" } });
    fireEvent.click(save);

    expect(await toastSays("A_TOKEN and B_TOKEN saved. jira is ready.")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([
      { name: "A_TOKEN", value: "a" },
      { name: "B_TOKEN", value: "b" },
    ]);
    expect(within(rowOf("jira")).getByText("Ready")).toBeInTheDocument();
  });

  it("saves only the filled names and says what the tool still needs", async () => {
    const jira = tool(
      "t-jira",
      "jira",
      { url: "https://jira.example/mcp" },
      { missing_secrets: ["A_TOKEN", "B_TOKEN"], status: "needs_attention" },
    );
    serve([jira]);
    await screen.findByRole("table");
    fireEvent.click(within(rowOf("jira")).getByRole("button", { name: "Add secret" }));
    const dialog = screen.getByRole("dialog", { name: "Add 2 secrets for jira" });
    fireEvent.change(within(dialog).getByLabelText("A_TOKEN"), { target: { value: "a" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save secrets" }));

    expect(await toastSays("A_TOKEN saved. jira still needs B_TOKEN.")).toBeInTheDocument();
    expect(within(rowOf("jira")).getByText("Needs B_TOKEN")).toBeInTheDocument();
  });

  it("keeps a name that failed in the form and reports the ones saved on Cancel", async () => {
    const jira = tool(
      "t-jira",
      "jira",
      { url: "https://jira.example/mcp" },
      { missing_secrets: ["A_TOKEN", "B_TOKEN"], status: "needs_attention" },
    );
    serve([jira], {
      "POST /api/secrets": (_url: URL, body: { name: string }) =>
        body.name === "B_TOKEN"
          ? new Response(JSON.stringify({ detail: "B_TOKEN already exists." }), { status: 409 })
          : { name: body.name, created_at: null, updated_at: null },
    });
    await screen.findByRole("table");
    fireEvent.click(within(rowOf("jira")).getByRole("button", { name: "Add secret" }));
    const dialog = screen.getByRole("dialog", { name: "Add 2 secrets for jira" });
    fireEvent.change(within(dialog).getByLabelText("A_TOKEN"), { target: { value: "a" } });
    fireEvent.change(within(dialog).getByLabelText("B_TOKEN"), { target: { value: "b" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save secrets" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("B_TOKEN already exists.");
    expect(within(dialog).queryByLabelText("A_TOKEN")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await toastSays(/^A_TOKEN saved\./)).toBeInTheDocument();
    expect(refreshBadges).toHaveBeenCalled();
  });

  it("Cancel closes the dialog without saving", async () => {
    const calls = serve();
    await screen.findByRole("table");
    fireEvent.click(within(rowOf("linear")).getByRole("button", { name: "Add secret" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("Tools · row ⋯ menu", () => {
  it("offers Edit connection, Duplicate, Turn on for agents… and Remove from Toolkit", async () => {
    serve();
    const menu = await openMenu("github");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Edit connection", "Duplicate", "Turn on for agents…", "Remove from Toolkit"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Edit connection" }));
    expect(window.location.hash).toBe("#/toolkit/tools/t-github");
  });

  it("Remove names the agents by team, then removes the row", async () => {
    const calls = serve();
    await choose("github", "Remove from Toolkit");

    const dialog = await screen.findByRole("alertdialog", { name: "Remove github from Toolkit?" });
    expect(dialog).toHaveTextContent(
      "3 agents in 2 teams use it: Engineer and Reviewer in Indicator sprint team, Writer in Docs team. They lose it on their next run.",
    );
    expect(within(dialog).getByRole("button", { name: "Remove tool" })).toHaveClass(
      "ds-btn--secondary",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove tool" }));

    expect(await toastSays("github removed from Toolkit.")).toBeInTheDocument();
    expect(
      calls.some((c) => c.method === "DELETE" && c.path === "/api/tool-library/t-github"),
    ).toBe(true);
    expect(rowNames()).toEqual(["fetch", "linear"]);
    expect(screen.getByRole("tab", { name: "Installed 2" })).toBeInTheDocument();
    expect(refreshBadges).toHaveBeenCalled();
  });

  it("Remove falls back to the counts when the agents can't load", async () => {
    serve(undefined, {
      "GET /api/tool-library/:id": new Response("{}", { status: 500 }),
    });
    await choose("github", "Remove from Toolkit");
    const dialog = await screen.findByRole("alertdialog", { name: "Remove github from Toolkit?" });
    expect(dialog).toHaveTextContent("3 agents in 2 teams use it. They lose it on their next run.");
  });

  it("Remove says no agents use an unused tool; Cancel keeps it", async () => {
    const calls = serve([tool("t-x", "sqlite", { command: "uvx" })]);
    await choose("sqlite", "Remove from Toolkit");
    const dialog = screen.getByRole("alertdialog", { name: "Remove sqlite from Toolkit?" });
    expect(dialog).toHaveTextContent("No agents use it.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(screen.getByRole("button", { name: "More actions for sqlite" })).toHaveFocus();
  });

  it("Duplicate puts the copy first, unused, and its toast opens it", async () => {
    serve();
    await choose("github", "Duplicate");

    expect(
      await toastSays("Copied as github-copy. Rename it in its settings."),
    ).toBeInTheDocument();
    await waitFor(() => expect(rowNames()).toEqual(["github-copy", "fetch", "github", "linear"]));
    expect(within(rowOf("github-copy")).getByText("Not used yet")).toBeInTheDocument();
    expect(refreshBadges).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(window.location.hash).toBe("#/toolkit/tools/t-github-copy");
  });

  it("Duplicate says so when the copy fails", async () => {
    serve(undefined, {
      "POST /api/tool-library/:id/duplicate": new Response("{}", { status: 500 }),
    });
    await choose("github", "Duplicate");
    expect(await screen.findByText("Couldn’t copy github. Try again.")).toBeInTheDocument();
    expect(rowNames()).toEqual(["fetch", "github", "linear"]);
  });
});

describe("Turn on for agents", () => {
  it("groups agents by team, tags thinkers, pre-checks users and counts live", async () => {
    const calls = serve();
    await choose("linear", "Turn on for agents…");

    const dialog = screen.getByRole("dialog", { name: "Turn on for agents" });
    expect(within(dialog).getByText("Turn linear on for…")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Each agent can still switch it off in its Skills & tools tab."),
    ).toBeInTheDocument();
    const ind = await within(dialog).findByRole("group", { name: "Indicator sprint team" });
    const docs = within(dialog).getByRole("group", { name: "Docs team" });
    expect(
      within(ind)
        .getAllByRole("checkbox")
        .map((c) => c.closest("label")?.textContent),
    ).toEqual(["Product managerthinker", "Engineer", "Reviewer"]);
    expect(within(ind).getByLabelText("Reviewer")).toBeChecked();
    expect(within(ind).getByLabelText(/Product manager/)).not.toBeChecked();
    expect(calls.some((c) => c.path === "/api/agents?tool_id=t-linear")).toBe(true);
    expect(within(dialog).queryByText(/Claude or Grok subscription/)).toBeNull();

    const confirm = within(dialog).getByRole("button", { name: "Turn on for 1 agent" });
    fireEvent.click(within(docs).getByLabelText("Writer"));
    expect(confirm).toHaveTextContent("Turn on for 2 agents");
    fireEvent.click(confirm);

    expect(await toastSays("linear is on for 2 agents.")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PUT")).toEqual({
      method: "PUT",
      path: "/api/tool-library/t-linear/agents",
      body: { node_ids: ["n-rev", "n-wri"] },
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("unchecking everyone turns it off for all agents; Skip changes nothing", async () => {
    const calls = serve();
    await choose("linear", "Turn on for agents…");
    const dialog = screen.getByRole("dialog", { name: "Turn on for agents" });
    fireEvent.click(await within(dialog).findByLabelText("Reviewer"));
    expect(within(dialog).getByRole("button", { name: "Turn off for all agents" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("keeps the dialog open with the error when saving fails", async () => {
    serve(undefined, {
      "PUT /api/tool-library/:id/agents": new Response(
        JSON.stringify({ detail: "Agent not found." }),
        { status: 404 },
      ),
    });
    await choose("linear", "Turn on for agents…");
    const dialog = screen.getByRole("dialog", { name: "Turn on for agents" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Turn on for 1 agent" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Agent not found.");
  });

  it("says on Desktop that tools don't reach subscription agents on this computer", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    serve();
    await choose("linear", "Turn on for agents…");
    const dialog = screen.getByRole("dialog", { name: "Turn on for agents" });
    expect(
      within(dialog).getByText(
        "Tools don’t reach agents that run on this computer with a Claude or Grok subscription.",
      ),
    ).toBeInTheDocument();
    expect(await within(dialog).findByLabelText("Reviewer")).toBeChecked();
  });

  it("says it couldn't load the agents, and retries", async () => {
    let fail = true;
    serve(undefined, {
      "GET /api/agents": () =>
        fail ? new Response("{}", { status: 500 }) : { teams: AGENT_TEAMS.teams },
    });
    await choose("linear", "Turn on for agents…");
    const dialog = screen.getByRole("dialog", { name: "Turn on for agents" });
    expect(await within(dialog).findByText("Couldn’t load your agents.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    expect(await within(dialog).findByLabelText("Reviewer")).toBeChecked();
  });
});
