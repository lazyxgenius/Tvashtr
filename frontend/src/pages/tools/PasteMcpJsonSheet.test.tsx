/**
 * Paste mcp.json (TkF-Paste-1..3, TOOL-61..66): the line-numbered mistake keeps "Add N servers"
 * disabled; the checklist (Local / Remote, "Replaces your <name>" unticked, reasons it can't be
 * added); VS Code normalisation and literal secrets moving to Secrets reach the import body; the
 * import's conflict rule; the toast and its "Add secret"; the server's 409 / 422.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  resetToolkitStores();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const SECRETS = {
  secrets: [
    { name: "GITHUB_TOKEN", created_at: null, updated_at: null, used_by_tools: [] },
    { name: "GITHUB_PERSONAL_ACCESS_TOKEN", created_at: null, updated_at: null, used_by_tools: [] },
  ],
  missing: [],
};

const refsOf = (cfg: Record<string, unknown>) => [
  ...new Set(
    Object.values({
      ...(cfg.headers as Record<string, string> | undefined),
      ...(cfg.env as Record<string, string> | undefined),
    }).flatMap((v) => [...String(v).matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map((m) => m[1])),
  ),
];

/** A fake server: the import adds (or, with "replace", overwrites) and 409s on a clash. */
function serve(initial: ToolItem[] = [FETCH, GITHUB], overrides: Record<string, unknown> = {}) {
  let tools = initial;
  const withStatus = (t: ToolItem): ToolItem => {
    const refs = refsOf(t.server_config);
    const missing = refs.filter((n) => !SECRETS.secrets.some((s) => s.name === n));
    return {
      ...t,
      secret_refs: refs,
      missing_secrets: missing,
      status: missing.length ? "needs_attention" : "ready",
    };
  };
  const calls = mockApi({
    "GET /api/tool-library": () => ({ tools }),
    "GET /api/secrets": SECRETS,
    "POST /api/secrets": (_u: URL, body: { name: string }) =>
      json(201, { name: body.name, created_at: null, updated_at: null }),
    "POST /api/tool-library/import": (
      _u: URL,
      body: { servers: Record<string, Record<string, unknown>>; on_conflict: string },
    ) => {
      const names = Object.keys(body.servers);
      const conflicts = names.filter((n) => tools.some((t) => t.name === n));
      if (conflicts.length && body.on_conflict !== "replace") {
        return json(409, {
          detail: {
            code: "name_taken",
            message: `You already have a tool named ${conflicts[0]}.`,
            conflicts,
          },
        });
      }
      const added = names.map((name) => {
        const had = tools.find((t) => t.name === name);
        const next = withStatus(
          had
            ? { ...had, server_config: body.servers[name] }
            : tool(`t-${name}`, name, body.servers[name]),
        );
        tools = had ? tools.map((t) => (t.name === name ? next : t)) : [...tools, next];
        return next;
      });
      return { added, conflicts };
    },
    ...overrides,
  });
  renderWithProviders(<ToolsPage view="installed" />);
  return calls;
}

const DESIGN = `{
  "mcpServers": {
    "linear": { "url": "https://mcp.linear.app/sse" }
    "sqlite": { "command": "uvx", "args": ["mcp-server-sqlite"] }
  }
}`;
const FIXED = DESIGN.replace('sse" }\n', 'sse" },\n');
/** linear with its Authorization header, so it needs LINEAR_TOKEN once added. */
const WITH_REF = JSON.stringify({
  mcpServers: {
    linear: {
      url: "https://mcp.linear.app/sse",
      headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
    },
    sqlite: { command: "uvx", args: ["mcp-server-sqlite"] },
  },
});

const sheet = () => screen.getByRole("dialog", { name: "Paste mcp.json" });
const box = () => within(sheet()).getByRole("textbox", { name: "mcp.json" });
const openPaste = async () => {
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "Paste mcp.json" }));
  // Let the sheet's own read of your secret names land.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return sheet();
};
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const addButton = () => within(sheet()).getByRole("button", { name: /^Add (\d+ )?servers?$/ });
const importCall = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.find((c) => c.method === "POST" && c.path === "/api/tool-library/import");

describe("Paste mcp.json · reading it", () => {
  it("opens as a 540px sheet with the box focused; nothing to add yet", async () => {
    serve();
    const dialog = await openPaste();
    expect(within(dialog).getByText("From Claude, Cursor or VS Code")).toBeInTheDocument();
    expect(dialog).toHaveStyle({ width: "540px" });
    expect(box()).toHaveFocus();
    expect(addButton()).toHaveTextContent("Add servers");
    expect(addButton()).toBeDisabled();
  });

  it("says which line needs a comma and keeps Add disabled; fixed, it lists the servers", async () => {
    serve();
    await openPaste();
    type(DESIGN);
    expect(within(sheet()).getByText("Line 3: add a comma after the linear entry.")).toBeTruthy();
    expect(box()).toHaveAttribute("aria-invalid", "true");
    expect(addButton()).toHaveTextContent("Add 2 servers");
    expect(addButton()).toBeDisabled();
    expect(within(sheet()).queryByText("2 servers found")).toBeNull();

    type(FIXED);
    const found = within(sheet()).getByRole("group", { name: "2 servers found" });
    const linear = within(found).getByRole("checkbox", { name: /^linear/ });
    const sqlite = within(found).getByRole("checkbox", { name: /^sqlite/ });
    expect(linear).toBeChecked();
    expect(sqlite).toBeChecked();
    expect(within(linear.closest("label")!).getByText("Remote")).toBeInTheDocument();
    expect(within(sqlite.closest("label")!).getByText("Local")).toBeInTheDocument();
    expect(addButton()).toHaveTextContent("Add 2 servers");
    expect(addButton()).toBeEnabled();

    fireEvent.click(sqlite);
    expect(addButton()).toHaveTextContent("Add 1 server");
  });

  it("leaves a server you already have unticked: “Replaces your linear”", async () => {
    const calls = serve([FETCH, GITHUB, LINEAR]);
    await openPaste();
    type(FIXED);
    const found = within(sheet()).getByRole("group", { name: "2 servers found" });
    const linear = within(found).getByRole("checkbox", { name: /^linear/ });
    expect(linear).not.toBeChecked();
    expect(within(found).getByText("Replaces your linear")).toBeInTheDocument();
    expect(addButton()).toHaveTextContent("Add 1 server");

    // Ticked, the add replaces it (on_conflict "replace").
    fireEvent.click(linear);
    fireEvent.click(addButton());
    await waitFor(() => expect(importCall(calls)).toBeTruthy());
    expect(importCall(calls)?.body).toEqual({
      servers: {
        linear: { url: "https://mcp.linear.app/sse" },
        sqlite: { command: "uvx", args: ["mcp-server-sqlite"] },
      },
      on_conflict: "replace",
    });
  });

  it("can't tick a server that can't connect, and says why", async () => {
    serve();
    await openPaste();
    type('{"mcpServers": {"broken": {"args": ["x"]}, "My Server": {"command": "uvx"}}}');
    const found = within(sheet()).getByRole("group", { name: "2 servers found" });
    const broken = within(found).getByRole("checkbox", { name: /^broken/ });
    expect(broken).toBeDisabled();
    expect(broken).not.toBeChecked();
    expect(within(found).getByText("Add a command or a URL.")).toBeInTheDocument();
    // A name that breaks the rule is added under one that fits it.
    expect(within(found).getByRole("checkbox", { name: /^my-server/ })).toBeChecked();
    expect(within(found).getByText("Pasted as “My Server”")).toBeInTheDocument();
    expect(addButton()).toHaveTextContent("Add 1 server");
  });

  it("says when it finds no servers", async () => {
    serve();
    await openPaste();
    type('{"theme": "dark"}');
    expect(within(sheet()).getByText(/Couldn’t find any servers/)).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
  });
});

describe("Paste mcp.json · adding", () => {
  it("imports, closes, puts the new rows on top and toasts; Add secret opens Add <NAME>", async () => {
    const calls = serve();
    await openPaste();
    type(WITH_REF);
    fireEvent.click(addButton());

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Paste mcp.json" })).toBeNull(),
    );
    expect(importCall(calls)?.body).toMatchObject({ on_conflict: "error" });
    const toast = await screen.findByText("2 servers added. linear needs a secret.");
    expect(refreshBadges).toHaveBeenCalled();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("link")[0].textContent)).toEqual([
      "sqlite",
      "linear",
      "fetch",
      "github",
    ]);
    expect(within(rows[0]).getByText("Not used yet")).toBeInTheDocument();

    fireEvent.click(
      within(toast.closest("[role=status]")!).getByRole("button", { name: "Add secret" }),
    );
    expect(await screen.findByRole("dialog", { name: "Add LINEAR_TOKEN" })).toBeInTheDocument();
  });

  it("normalises VS Code: servers, ${input:x} → ${X}, no type stdio", async () => {
    const calls = serve();
    await openPaste();
    type(
      JSON.stringify({
        inputs: [{ id: "api-key", type: "promptString", password: true }],
        servers: {
          search: {
            type: "stdio",
            command: "npx",
            args: ["-y", "search-mcp"],
            env: { API_KEY: "${input:api-key}" },
          },
        },
      }),
    );
    fireEvent.click(addButton());
    await waitFor(() => expect(importCall(calls)).toBeTruthy());
    expect(importCall(calls)?.body).toEqual({
      servers: {
        search: { command: "npx", args: ["-y", "search-mcp"], env: { API_KEY: "${API_KEY}" } },
      },
      on_conflict: "error",
    });
    expect(await screen.findByText("1 server added. search needs a secret.")).toBeInTheDocument();
  });

  it("moves a value that looks like a secret to Secrets first (spec Q13)", async () => {
    const calls = serve();
    await openPaste();
    const config = {
      mcpServers: {
        gh: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_abcdef1234567890" },
        },
      },
    };
    type(JSON.stringify(config));
    // GITHUB_PERSONAL_ACCESS_TOKEN is taken in Secrets, so it goes in as …_2.
    const move = await within(sheet()).findByRole("checkbox", {
      name: /Move GITHUB_PERSONAL_ACCESS_TOKEN to Secrets as GITHUB_PERSONAL_ACCESS_TOKEN_2/,
    });
    expect(move).toBeChecked();
    fireEvent.click(addButton());
    await waitFor(() => expect(importCall(calls)).toBeTruthy());
    const posts = calls.filter((c) => c.method === "POST" && c.path === "/api/secrets");
    expect(posts.map((c) => c.body)).toEqual([
      { name: "GITHUB_PERSONAL_ACCESS_TOKEN_2", value: "ghp_abcdef1234567890" },
    ]);
    expect(calls.indexOf(posts[0])).toBeLessThan(calls.indexOf(importCall(calls)!));
    expect(importCall(calls)?.body).toMatchObject({
      servers: {
        gh: { env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN_2}" } },
      },
    });
  });

  it("keeps the value as pasted when you untick the move", async () => {
    const calls = serve();
    await openPaste();
    type(
      '{"mcpServers": {"x": {"url": "https://x.dev/mcp", "headers": {"Authorization": "Bearer abcdefgh123"}}}}',
    );
    const move = await within(sheet()).findByRole("checkbox", {
      name: /Move Authorization to Secrets as X_TOKEN/,
    });
    fireEvent.click(move);
    fireEvent.click(addButton());
    await waitFor(() => expect(importCall(calls)).toBeTruthy());
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/secrets")).toBe(false);
    expect(importCall(calls)?.body).toMatchObject({
      servers: { x: { headers: { Authorization: "Bearer abcdefgh123" } } },
    });
  });

  it("a clash the list didn't know of: the server's words, and the row turns to Replaces", async () => {
    let listed = [FETCH, GITHUB];
    serve(listed, {
      "GET /api/tool-library": () => ({ tools: listed }),
      "POST /api/tool-library/import": () => {
        listed = [FETCH, GITHUB, LINEAR];
        return json(409, {
          detail: {
            code: "name_taken",
            message: "You already have a tool named linear.",
            conflicts: ["linear"],
          },
        });
      },
    });
    await openPaste();
    type(FIXED);
    fireEvent.click(addButton());
    expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
      "You already have a tool named linear.",
    );
    const found = within(sheet()).getByRole("group", { name: "2 servers found" });
    await waitFor(() =>
      expect(within(found).getByRole("checkbox", { name: /^linear/ })).not.toBeChecked(),
    );
    expect(within(found).getByText("Replaces your linear")).toBeInTheDocument();
    expect(addButton()).toHaveTextContent("Add 1 server");
  });

  it("names the server a 422 is about", async () => {
    serve(undefined, {
      "POST /api/tool-library/import": () =>
        json(422, {
          detail: { code: "invalid_server", server: "sqlite", message: "Add a command or a URL." },
        }),
    });
    await openPaste();
    type(FIXED);
    fireEvent.click(addButton());
    expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
      "sqlite: Add a command or a URL.",
    );
    expect(sheet()).toBeInTheDocument();
  });

  it("opens from the Add tool wizard's “An mcp.json”", async () => {
    serve();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
    const wizard = screen.getByRole("dialog", { name: "Add a tool" });
    fireEvent.click(within(wizard).getByRole("radio", { name: /An mcp.json/ }));
    expect(screen.queryByRole("dialog", { name: "Add a tool" })).toBeNull();
    expect(sheet()).toBeInTheDocument();
  });
});
