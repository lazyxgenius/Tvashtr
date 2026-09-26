/**
 * The Add tool wizard (TkF-AddTool-1..7, TOOL-30..46): Basics (start from, name rule), Connection
 * (Remote URL + headers, the `${` secret picker and its chips, raw JSON both ways, Local command),
 * Secrets (values, Choose agents held until Add tool), and the submit order with its failures.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolItem } from "../../lib/api/tools";
import { refreshBadges } from "../../lib/workspaceStatus";
import { ToolsPage } from "./ToolsPage";
import { FETCH, GITHUB, mockApi, renderWithProviders, resetToolkitStores } from "./toolsTestUtils";

vi.mock("../../lib/workspaceStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/workspaceStatus")>()),
  refreshBadges: vi.fn(async () => {}),
}));

beforeEach(() => resetToolkitStores());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(refreshBadges).mockClear();
  resetToolkitStores();
});

const SECRETS = {
  secrets: [
    {
      name: "GITHUB_TOKEN",
      created_at: null,
      updated_at: null,
      used_by_tools: [{ id: GITHUB.id, name: "github" }],
    },
    { name: "SENTRY_TOKEN", created_at: null, updated_at: null, used_by_tools: [] },
  ],
  missing: [],
};
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
const AGENTS = {
  teams: [
    {
      team_id: "team-ind",
      team_name: "Indicator sprint team",
      agents: [
        choice("n-pm", "pm", { edits_allowed: false }),
        choice("n-eng", "engineer"),
        choice("n-rev", "reviewer"),
      ],
    },
    { team_id: "team-docs", team_name: "Docs team", agents: [choice("n-wri", "writer")] },
  ],
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fake server: POST /api/tool-library adds the tool, PUT …/agents turns it on. */
function serve(overrides: Record<string, unknown> = {}) {
  let tools: ToolItem[] = [FETCH, GITHUB];
  const calls = mockApi({
    "GET /api/tool-library": () => ({ tools }),
    "GET /api/secrets": SECRETS,
    "GET /api/agents": AGENTS,
    "POST /api/secrets": (_u: URL, body: { name: string }) =>
      json(201, { name: body.name, created_at: null, updated_at: null }),
    "POST /api/tool-library": (
      _u: URL,
      body: { name: string; server_config: Record<string, unknown> },
    ) => {
      const created = {
        ...FETCH,
        id: `t-${body.name}`,
        name: body.name,
        server_config: body.server_config,
        used_by: { agent_count: 0, team_count: 0 },
      };
      tools = [...tools, created];
      return json(201, created);
    },
    "PUT /api/tool-library/:id/agents": (_u: URL, body: { node_ids: string[] }) => ({
      agents: body.node_ids.map((node_id) => ({
        node_id,
        role_name: "reviewer",
        title: null,
        team_id: "team-ind",
        team_name: "Indicator sprint team",
      })),
      agent_count: body.node_ids.length,
      team_count: body.node_ids.length ? 1 : 0,
      skipped: [],
    }),
    ...overrides,
  });
  renderWithProviders(<ToolsPage view="installed" />);
  return calls;
}

const sheet = () => screen.getByRole("dialog", { name: "Add a tool" });
const openWizard = async () => {
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
  return sheet();
};
const next = (label: string) =>
  fireEvent.click(within(sheet()).getByRole("button", { name: label }));
/** Step 1 named `name`, then Next. */
const toConnection = async (name = "linear") => {
  await openWizard();
  fireEvent.change(within(sheet()).getByLabelText("Name"), { target: { value: name } });
  next("Next: Connection");
};
const valueBox = () => within(sheet()).getByRole("combobox", { name: /value$/ });
/** Step 2: the URL and an Authorization header "Bearer ${LINEAR_TOKEN}" picked with Enter. */
const fillRemote = () => {
  fireEvent.change(within(sheet()).getByLabelText("URL"), {
    target: { value: "https://mcp.linear.app/sse" },
  });
  fireEvent.click(within(sheet()).getByRole("button", { name: "Add header" }));
  fireEvent.change(within(sheet()).getByRole("textbox", { name: "Header name 1" }), {
    target: { value: "Authorization" },
  });
  fireEvent.change(valueBox(), { target: { value: "Bearer ${" } });
  fireEvent.keyDown(valueBox(), { key: "Enter" });
};
const toSecrets = async () => {
  await toConnection();
  fillRemote();
  next("Next: Secrets");
};

describe("Add tool · Basics", () => {
  it("opens on step 1 with A custom server chosen and checks the name on Next", async () => {
    serve();
    const dialog = await openWizard();
    expect(within(dialog).getByText("Step 1 of 3")).toBeInTheDocument();
    const steps = within(dialog).getByRole("list", { name: "Steps" });
    expect(within(steps).getByText("Basics").closest("li")).toHaveAttribute("aria-current", "step");
    expect(within(dialog).getByRole("radio", { name: /A custom server/ })).toBeChecked();

    next("Next: Connection");
    expect(within(dialog).getByText("Give the tool a name.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "My Server" } });
    next("Next: Connection");
    expect(
      within(dialog).getByText("Use lowercase letters, numbers, - and _, like my-server."),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "fetch" } });
    next("Next: Connection");
    expect(within(dialog).getByText("You already have a tool named fetch.")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "linear" } });
    next("Next: Connection");
    expect(within(dialog).getByText("linear · step 2 of 3")).toBeInTheDocument();
    expect(within(steps).getByText("Connection").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(within(steps).getByText(", done")).toBeInTheDocument();
  });

  it("The catalog closes the sheet and shows Browse; An mcp.json swaps to the paste sheet", async () => {
    serve();
    const dialog = await openWizard();
    fireEvent.click(within(dialog).getByRole("radio", { name: /The catalog/ }));
    expect(screen.queryByRole("dialog", { name: "Add a tool" })).toBeNull();
    expect(window.location.hash).toBe("#/toolkit/tools/browse");

    fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
    fireEvent.click(within(sheet()).getByRole("radio", { name: /An mcp.json/ }));
    expect(screen.queryByRole("dialog", { name: "Add a tool" })).toBeNull();
  });

  it("Cancel and Escape close it", async () => {
    serve();
    await openWizard();
    fireEvent.click(within(sheet()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Add a tool" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Add a tool" })).toBeNull();
  });
});

describe("Add tool · Connection", () => {
  it("defaults to Remote URL and needs an http(s) URL", async () => {
    serve();
    await toConnection();
    const where = within(sheet()).getByRole("group", { name: "Where it runs" });
    expect(within(where).getByRole("button", { name: "Remote URL" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    next("Next: Secrets");
    expect(within(sheet()).getByText("Add the server’s URL.")).toBeInTheDocument();
    fireEvent.change(within(sheet()).getByLabelText("URL"), {
      target: { value: "mcp.linear.app" },
    });
    next("Next: Secrets");
    expect(within(sheet()).getByText("Use an http:// or https:// URL.")).toBeInTheDocument();
  });

  it("typing ${ opens the secret picker; arrows move, Enter picks, Escape closes only it", async () => {
    serve();
    await toConnection();
    fireEvent.click(within(sheet()).getByRole("button", { name: "Add header" }));
    const name = within(sheet()).getByRole("textbox", { name: "Header name 1" });
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: "Authorization" } });
    const box = valueBox();
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "Bearer ${" } });

    const list = await within(sheet()).findByRole("listbox", { name: "Secrets" });
    await within(list).findByText("GITHUB_TOKEN");
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "GITHUB_TOKENused by github",
      "SENTRY_TOKENnot used",
      "Create LINEAR_TOKEN",
    ]);
    // The tool's own suggestion is highlighted first.
    expect(options[2]).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", options[2].id);

    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(within(list).getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box).toHaveValue("Bearer ${SENTRY_TOKEN}");
    expect(within(sheet()).queryByRole("listbox")).toBeNull();

    // Escape closes the picker, not the sheet.
    fireEvent.change(box, { target: { value: "Bearer ${SENTRY_TOKEN} ${GIT" } });
    const filtered = within(sheet()).getByRole("listbox", { name: "Secrets" });
    expect(
      within(filtered)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["GITHUB_TOKENused by github", "Create GIT"]);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(within(sheet()).queryByRole("listbox")).toBeNull();
    expect(sheet()).toBeInTheDocument();
  });

  it("shows references as chips marked set / not set once you leave the field", async () => {
    serve();
    await toConnection();
    fillRemote();
    const box = valueBox();
    expect(box).toHaveValue("Bearer ${LINEAR_TOKEN}");
    fireEvent.blur(box);
    const field = box.parentElement!;
    expect(within(field).getByText("${LINEAR_TOKEN}")).toBeInTheDocument();
    expect(await within(field).findByText("· not set")).toBeInTheDocument();

    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "Bearer ${GITHUB_TOKEN}" } });
    fireEvent.blur(box);
    expect(within(field).getByText("· set")).toBeInTheDocument();
  });

  it("keeps the raw JSON and the form in sync both ways; bad JSON leaves the form alone", async () => {
    serve();
    await toConnection();
    fillRemote();
    fireEvent.click(within(sheet()).getByRole("button", { name: "Advanced (raw JSON)" }));
    const raw = within(sheet()).getByRole("textbox", { name: "Advanced (raw JSON)" });
    expect(JSON.parse((raw as HTMLTextAreaElement).value)).toEqual({
      url: "https://mcp.linear.app/sse",
      headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
    });
    expect(
      within(sheet()).getByText("Edits here and in the form above stay in sync."),
    ).toBeTruthy();

    // Form → JSON.
    fireEvent.change(within(sheet()).getByLabelText("URL"), {
      target: { value: "https://mcp.linear.app/mcp" },
    });
    expect((raw as HTMLTextAreaElement).value).toContain('"url": "https://mcp.linear.app/mcp"');

    // JSON → form, keeping keys the form has no field for.
    fireEvent.change(raw, {
      target: { value: '{"url": "https://example.com/sse", "type": "sse", "headers": {}}' },
    });
    expect(within(sheet()).getByLabelText("URL")).toHaveValue("https://example.com/sse");
    expect(within(sheet()).queryByRole("textbox", { name: "Header name 1" })).toBeNull();

    // Invalid JSON: an inline error, the form untouched, Next blocked.
    fireEvent.change(raw, { target: { value: '{"url": "https://broken' } });
    expect(within(sheet()).getByRole("alert")).toHaveTextContent(
      "This isn’t valid JSON yet. The form keeps its last valid version.",
    );
    expect(within(sheet()).getByLabelText("URL")).toHaveValue("https://example.com/sse");
    expect(within(sheet()).getByRole("button", { name: "Next: Secrets" })).toBeDisabled();
  });

  it("Local command asks for a command, arguments and environment variables", async () => {
    serve();
    await toConnection("sqlite");
    fireEvent.click(within(sheet()).getByRole("button", { name: "Local command" }));
    expect(within(sheet()).getByRole("button", { name: "Local command" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(sheet()).queryByText(/to pick a secret/)).toBeNull();
    next("Next: Secrets");
    expect(within(sheet()).getByText("Add the command that starts the server.")).toBeTruthy();
    fireEvent.change(within(sheet()).getByLabelText("Command"), { target: { value: "uvx" } });
    fireEvent.change(within(sheet()).getByLabelText(/Arguments/), {
      target: { value: "mcp-server-sqlite --db-path data.db" },
    });
    fireEvent.click(within(sheet()).getByRole("button", { name: "Add variable" }));
    fireEvent.change(within(sheet()).getByRole("textbox", { name: "Variable name 1" }), {
      target: { value: "API_KEY" },
    });
    fireEvent.change(valueBox(), { target: { value: "${" } });
    expect(
      within(within(sheet()).getByRole("listbox")).getByText("SQLITE_TOKEN"),
    ).toBeInTheDocument();
    next("Next: Secrets");
    expect(within(sheet()).getByText("sqlite · step 3 of 3")).toBeInTheDocument();
  });
});

describe("Add tool · Secrets and submit", () => {
  it("stores the secret, creates the tool, turns it on, then toasts with Open <Role>", async () => {
    const calls = serve();
    await toSecrets();
    const dialog = sheet();
    expect(
      within(dialog).getByText("linear uses one secret. Add its value now or later in Secrets."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Not set")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Stored encrypted for your account. We never show it again."),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("LINEAR_TOKEN"), {
      target: { value: "lin_api_1" },
    });

    // Choose agents: held until Add tool.
    fireEvent.click(within(dialog).getByRole("button", { name: "Choose agents" }));
    const turnOn = await screen.findByRole("dialog", { name: "Turn on for agents" });
    expect(within(turnOn).getByText("Turn linear on for…")).toBeInTheDocument();
    fireEvent.click(await within(turnOn).findByRole("checkbox", { name: "Reviewer" }));
    fireEvent.click(within(turnOn).getByRole("button", { name: "Turn on for 1 agent" }));
    expect(screen.queryByRole("dialog", { name: "Turn on for agents" })).toBeNull();
    expect(within(dialog).getByText("Turns on for Reviewer when you add it.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);

    next("Add tool");
    expect(await screen.findByText("linear added and turned on for Reviewer.")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Add a tool" })).toBeNull();
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/secrets",
      "POST /api/tool-library",
      "PUT /api/tool-library/t-linear/agents",
    ]);
    expect(writes[0].body).toEqual({ name: "LINEAR_TOKEN", value: "lin_api_1" });
    expect(writes[1].body).toEqual({
      name: "linear",
      server_config: {
        url: "https://mcp.linear.app/sse",
        headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
      },
    });
    expect(writes[2].body).toEqual({ node_ids: ["n-rev"] });
    expect(refreshBadges).toHaveBeenCalled();
    // The new row lands on top.
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByRole("link").textContent).toBe("linear");

    fireEvent.click(screen.getByRole("button", { name: "Open Reviewer" }));
    expect(window.location.hash).toBe("#/teams/team-ind?node=n-rev&tab=skills");
  });

  it("with no value and no agents it only creates the tool: “linear added.”", async () => {
    const calls = serve();
    await toSecrets();
    next("Add tool");
    expect(await screen.findByText("linear added.")).toBeTruthy();
    expect(calls.filter((c) => c.method !== "GET").map((c) => c.method)).toEqual(["POST"]);
  });

  it("says which step failed: the tool (the saved secret isn't sent twice)", async () => {
    let attempts = 0;
    const calls = serve({
      "POST /api/tool-library": () => {
        attempts += 1;
        return json(409, { detail: "You already have a tool named linear." });
      },
    });
    await toSecrets();
    fireEvent.change(within(sheet()).getByLabelText("LINEAR_TOKEN"), {
      target: { value: "lin_api_1" },
    });
    next("Add tool");
    expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
      "Couldn’t add linear: You already have a tool named linear. LINEAR_TOKEN is saved.",
    );
    expect(within(sheet()).getByText("Set")).toBeInTheDocument();
    next("Add tool");
    await waitFor(() => expect(attempts).toBe(2));
    expect(calls.filter((c) => c.path === "/api/secrets" && c.method === "POST")).toHaveLength(1);
  });

  it("says which step failed: a secret (the tool isn't created)", async () => {
    const calls = serve({ "POST /api/secrets": () => json(500, { detail: "boom" }) });
    await toSecrets();
    fireEvent.change(within(sheet()).getByLabelText("LINEAR_TOKEN"), {
      target: { value: "lin_api_1" },
    });
    next("Add tool");
    expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
      "Couldn’t save LINEAR_TOKEN. Try again. The tool isn’t added yet.",
    );
    expect(calls.some((c) => c.path === "/api/tool-library" && c.method === "POST")).toBe(false);
  });

  it("says which step failed: turning it on (the tool is added; the sheet closes)", async () => {
    serve({ "PUT /api/tool-library/:id/agents": () => json(500, { detail: "boom" }) });
    await toSecrets();
    fireEvent.click(within(sheet()).getByRole("button", { name: "Choose agents" }));
    const turnOn = await screen.findByRole("dialog", { name: "Turn on for agents" });
    fireEvent.click(await within(turnOn).findByRole("checkbox", { name: "Reviewer" }));
    fireEvent.click(within(turnOn).getByRole("button", { name: "Turn on for 1 agent" }));
    next("Add tool");
    expect(
      await screen.findByText(
        "linear added, but it couldn’t be turned on for your agents. Use Turn on for agents… in its ⋯ menu.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Add a tool" })).toBeNull();
  });
});
