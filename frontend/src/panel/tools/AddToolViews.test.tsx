import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import {
  bodyOf,
  CATALOGUE,
  edges,
  engineer,
  json,
  pm,
  reviewer,
  ship,
  stubFetch,
} from "../editorTestKit";
import { NodeEditor, type NodeEditorProps } from "../NodeEditor";
import { resetNodeTemplates } from "../setup/useNodeTemplates";

// The Tools sheets (G9; Panel-AddTool, Flow-PasteJson): add a server (Remote URL + headers, Local
// command + env), paste an mcp.json, pick library tools, or edit an inline server's connection —
// each into the draft, one Save.

const FETCH = { command: "uvx", args: ["mcp-server-fetch"] };
const TOOLS = { mcpServers: { fetch: FETCH }, tvashtr: { library: ["t-gh"] } };
const GITHUB = {
  id: "t-gh",
  name: "github",
  server_config: {
    url: "https://api.githubcopilot.com/mcp",
    headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
  },
  created_at: "",
};
const SENTRY = {
  id: "t-sen",
  name: "sentry",
  server_config: { url: "https://mcp.sentry.dev", headers: { A: "${SENTRY_TOKEN}" } },
  created_at: "",
};
const PASTE = `{
  "mcpServers": {
    "linear": { "url": "https://mcp.linear.app/sse",
                "headers": { "Authorization": "Bearer \${LINEAR_TOKEN}" } },
    "sqlite": { "command": "uvx", "args": ["mcp-server-sqlite"] }
  }
}`;

let fetchMock: ReturnType<typeof vi.fn>;
const node = () => reviewer({ skills: null, tool_config: TOOLS });

beforeEach(() => {
  setProviderCatalogue(CATALOGUE);
  fetchMock = stubFetch(node, (url) => {
    if (url === "/api/skill-library") return json({ skills: [] });
    if (url === "/api/tool-library") return json({ tools: [GITHUB, SENTRY] });
    if (url === "/api/secrets") return json({ secrets: [{ name: "GITHUB_TOKEN" }] });
    return undefined;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNodeTemplates();
  setProviderCatalogue([]);
  __resetBackendStatusForTests();
});

function renderTab(saved: TeamGraphNode = node()) {
  const props: NodeEditorProps = {
    teamId: "t1",
    node: saved,
    nodes: [pm, engineer, saved, ship],
    edges,
    isEntry: false,
    cover: { byok: new Set(["xai"]), subs: {} },
    tab: "skills",
    onTabChange: vi.fn(),
    focus: false,
    onFocusChange: vi.fn(),
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onOpenToolkit: vi.fn(),
  };
  render(<NodeEditor {...props} />);
  return { props, drawer: screen.getByRole("complementary", { name: "Reviewer settings" }) };
}

async function openSheet(item: string) {
  await screen.findByText("github");
  fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(`^${item}`) }));
  return within(screen.getByRole("region", { name: "Add a tool" }));
}

const toolNames = () =>
  within(screen.getByRole("region", { name: /^Tools/ }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector(".nd-tool__name")?.textContent ?? li.textContent);

async function savedTools(drawer: HTMLElement) {
  fireEvent.click(within(drawer).getByRole("button", { name: /^Save/ }));
  await waitFor(() => expect(bodyOf(fetchMock, "PATCH")).toBeTruthy());
  return (bodyOf(fetchMock, "PATCH") as { tool_config: Record<string, unknown> }).tool_config;
}

const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe("Add a server (Panel-AddTool)", () => {
  it("adds a Remote server with a header, then offers Add secret (PANEL-98)", async () => {
    const { drawer, props } = renderTab();
    const sheet = await openSheet("Add a server");
    expect(sheet.getByRole("tab", { name: "Add a server", selected: true })).toBeTruthy();
    expect(sheet.getByText("Adds to this agent. Save to keep it.")).toBeTruthy();
    // The sheet covers the Save footer.
    expect(within(drawer).queryByRole("button", { name: /^Save/ })).toBeNull();
    const add = sheet.getByRole<HTMLButtonElement>("button", { name: "Add server" });
    expect(add.disabled).toBe(true);

    type(sheet.getByRole("textbox", { name: "Server name" }), "linear");
    expect(sheet.getByText("${LINEAR_TOKEN}")).toBeTruthy();
    const url = sheet.getByRole("textbox", { name: "URL" });
    type(url, "mcp.linear.app/sse");
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    expect(sheet.getByText("Use a URL that starts with https:// or http://.")).toBeTruthy();
    type(url, "https://mcp.linear.app/sse?key=${LINEAR_TOKEN}");
    fireEvent.click(add);
    expect(sheet.getByText("Secrets aren’t filled in here. Put them in a header.")).toBeTruthy();
    type(url, "https://mcp.linear.app/sse");
    type(sheet.getByRole("textbox", { name: "Header 1 name" }), "Authorization");
    type(sheet.getByRole("textbox", { name: "Header 1 value" }), "Bearer ${LINEAR_TOKEN}");
    fireEvent.click(add);

    expect(screen.queryByRole("region", { name: "Add a tool" })).toBeNull();
    expect(toolNames()).toEqual(["fetch", "linear", "github"]);
    expect(screen.getByText("1 server added · 1 needs a secret")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add secret" }));
    expect(props.onOpenToolkit).toHaveBeenCalledWith({ page: "secrets" });
    const saved = await savedTools(drawer);
    expect((saved.mcpServers as Record<string, unknown>).linear).toEqual({
      url: "https://mcp.linear.app/sse",
      headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
    });
  });

  it("adds a Local server from a command with env, and blocks a taken name", async () => {
    const { drawer } = renderTab();
    const sheet = await openSheet("Add a server");
    const name = sheet.getByRole("textbox", { name: "Server name" });
    type(name, "github");
    expect(sheet.getByText("This agent already has a tool called github.")).toBeTruthy();
    type(name, "sqlite");
    fireEvent.click(sheet.getByRole("button", { name: "Local" }));
    type(sheet.getByRole("textbox", { name: "Command" }), "uvx mcp-server-sqlite --db x.db");
    type(sheet.getByRole("textbox", { name: "Variable 1 name" }), "DB_KEY");
    type(sheet.getByRole("textbox", { name: "Variable 1 value" }), "${GITHUB_TOKEN}");
    fireEvent.click(sheet.getByRole("button", { name: "Add variable" }));
    expect(sheet.getByRole("textbox", { name: "Variable 2 name" })).toBeTruthy();
    fireEvent.click(sheet.getByRole("button", { name: "Add server" }));
    // Every secret it uses is set: the toast offers Undo instead.
    expect(screen.getByText("1 server added")).toBeTruthy();
    const saved = await savedTools(drawer);
    expect((saved.mcpServers as Record<string, unknown>).sqlite).toEqual({
      command: "uvx",
      args: ["mcp-server-sqlite", "--db", "x.db"],
      env: { DB_KEY: "${GITHUB_TOKEN}" },
    });
  });

  it("edits an inline server's connection in its place", async () => {
    const { drawer } = renderTab();
    await screen.findByText("github");
    fireEvent.click(screen.getByRole("button", { name: "More actions for fetch" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit connection" }));
    const sheet = within(screen.getByRole("region", { name: "Edit connection" }));
    expect(sheet.queryByRole("tablist")).toBeNull();
    expect(sheet.getByRole<HTMLInputElement>("textbox", { name: "Command" }).value).toBe(
      "uvx mcp-server-fetch",
    );
    type(sheet.getByRole("textbox", { name: "Server name" }), "web");
    fireEvent.click(sheet.getByRole("button", { name: "Update server" }));
    expect(toolNames()).toEqual(["web", "github"]);
    expect((await savedTools(drawer)).mcpServers).toEqual({ web: FETCH });
  });

  it("Back leaves the draft as it was and returns to Add tool", async () => {
    const { drawer } = renderTab();
    const sheet = await openSheet("Add a server");
    type(sheet.getByRole("textbox", { name: "Server name" }), "x");
    fireEvent.click(sheet.getByRole("button", { name: "Back to tools" }));
    expect(screen.queryByRole("region", { name: "Add a tool" })).toBeNull();
    expect(within(drawer).getByText("All changes saved")).toBeTruthy();
  });
});

describe("Paste mcp.json (Flow-PasteJson)", () => {
  it("lists the servers found, flags the missing secret, and adds them", async () => {
    const { drawer, props } = renderTab();
    const sheet = await openSheet("Paste mcp.json");
    expect(sheet.getByRole("tab", { name: "Paste mcp.json", selected: true })).toBeTruthy();
    const add = sheet.getByRole<HTMLButtonElement>("button", { name: "Add servers" });
    expect(add.disabled).toBe(true);
    const box = sheet.getByRole("textbox", { name: "mcp.json" });
    type(box, '{ "mcpServers": { "a": {} }');
    expect(sheet.getByText(/^That isn’t valid JSON — Line 1: /)).toBeTruthy();

    type(box, PASTE);
    expect(sheet.getByText("2 servers found")).toBeTruthy();
    expect(sheet.getByText("Remote")).toBeTruthy();
    expect(sheet.getByText("Local")).toBeTruthy();
    expect(
      sheet.getByText(
        "linear uses ${LINEAR_TOKEN}, which isn’t set yet. Add it in Toolkit → Secrets.",
      ),
    ).toBeTruthy();
    fireEvent.click(sheet.getByRole("button", { name: "Add 2 servers" }));

    expect(toolNames()).toEqual(["fetch", "linear", "sqlite", "github"]);
    expect(screen.getByText("2 servers added · 1 needs a secret")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add secret" }));
    expect(props.onOpenToolkit).toHaveBeenCalledWith({ page: "secrets" });
    expect(Object.keys((await savedTools(drawer)).mcpServers as object)).toEqual([
      "fetch",
      "linear",
      "sqlite",
    ]);
  });

  it("leaves out names already on this agent and entries that aren't servers", async () => {
    renderTab();
    const sheet = await openSheet("Paste mcp.json");
    type(
      sheet.getByRole("textbox", { name: "mcp.json" }),
      '{ "fetch": { "command": "uvx" }, "notes": { "x": 1 } }',
    );
    expect(sheet.getByText("1 server found")).toBeTruthy();
    expect(sheet.getByText("fetch is already on this agent, so it’s left out.")).toBeTruthy();
    expect(sheet.getByText("notes has no url or command, so it’s left out.")).toBeTruthy();
    expect(sheet.getByRole<HTMLButtonElement>("button", { name: "Add servers" }).disabled).toBe(
      true,
    );
  });
});

describe("Library tab", () => {
  it("adds library tools; ones already added can't be picked", async () => {
    renderTab();
    const sheet = await openSheet("From your library");
    expect(sheet.getByRole("tab", { name: "Library", selected: true })).toBeTruthy();
    const [github, sentry] = sheet.getAllByRole<HTMLInputElement>("checkbox");
    expect(github.disabled).toBe(true);
    fireEvent.click(sentry);
    fireEvent.click(sheet.getByRole("button", { name: "Add 1 tool" }));
    expect(toolNames()).toEqual(["fetch", "github", "sentry"]);
    expect(screen.getByText("1 server added · 1 needs a secret")).toBeTruthy();
  });

  it("says so when the library can't load, and Try again loads it", async () => {
    let fail = true;
    fetchMock = stubFetch(node, (url) => {
      if (url === "/api/skill-library") return json({ skills: [] });
      if (url === "/api/tool-library")
        return fail ? json({ detail: "boom" }, 500) : json({ tools: [GITHUB, SENTRY] });
      if (url === "/api/secrets") return json({ secrets: [{ name: "GITHUB_TOKEN" }] });
      return undefined;
    });
    renderTab();
    await screen.findByText("fetch");
    fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^From your library/ }));
    const sheet = within(screen.getByRole("region", { name: "Add a tool" }));
    expect(await sheet.findByText("Couldn’t load your library.")).toBeTruthy();
    fail = false;
    fireEvent.click(sheet.getByRole("button", { name: "Try again" }));
    expect(await sheet.findByRole("checkbox", { name: /sentry/ })).toBeTruthy();
  });

  it("switches between the tabs", async () => {
    renderTab();
    // Each tab is its own sheet: find it again after a switch.
    const sheet = () => within(screen.getByRole("region", { name: "Add a tool" }));
    fireEvent.click((await openSheet("Add a server")).getByRole("tab", { name: "Paste mcp.json" }));
    expect(sheet().getByRole("textbox", { name: "mcp.json" })).toBeTruthy();
    fireEvent.click(sheet().getByRole("tab", { name: "Library" }));
    expect(sheet().getByText("sentry")).toBeTruthy();
  });
});
