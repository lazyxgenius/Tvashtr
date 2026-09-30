/**
 * The custom connector sheet (CnF-Custom-1..3, CnF-Prob-3): an address → "Check the server" → the
 * site you'll sign in at → the provider's window; or why the server can't be connected here.
 */
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection } from "../../lib/api/connectors";
import { mockApi, renderWithProviders, resetToolkitStores } from "../tools/toolsTestUtils";
import { CustomConnectorSheet } from "./CustomConnectorSheet";
import { connection } from "./connectorsTestUtils";

const AUTHORIZE = "https://auth.acme.dev/authorize?response_type=code&state=s1";
const PENDING = connection({
  connector_key: "custom:mcp.acme.dev/mcp",
  name: "acme-metrics",
  slug: "acme-metrics",
  publisher: null,
  featured: false,
  reviewed: false,
  category: null,
  host: "mcp.acme.dev",
  signin_host: "auth.acme.dev",
  signin_host_differs: true,
  read_only_by: "annotations",
  scope: null,
  scope_picker: null,
  status: "pending",
  tools: null,
  connected_at: null,
  used_by: { agent_count: 0, team_count: 0 },
});

function fakePopup() {
  return { location: { href: "about:blank" }, opener: window as unknown, close: vi.fn() };
}
let popup: ReturnType<typeof fakePopup> | null;
let open: ReturnType<typeof vi.fn>;
let row: Connection;

const refuse = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ detail: { code, message } }), { status });

function serve(routes: Record<string, unknown> = {}) {
  row = { ...PENDING, signin_pending: true };
  return mockApi({
    "POST /api/connectors": PENDING,
    "POST /api/connectors/c1/oauth/start": {
      authorize_url: AUTHORIZE,
      signin_host: "auth.acme.dev",
      expires_in: 600,
    },
    "GET /api/connectors/c1": () => ({
      ...row,
      used_by_agents: [],
      recent_use: [],
      revoke_hint: null,
    }),
    "PATCH /api/connectors/c1": (_u: URL, body: Partial<Connection>) => ({ ...row, ...body }),
    ...routes,
  });
}

function show() {
  const onClose = vi.fn();
  const onDone = vi.fn();
  renderWithProviders(<CustomConnectorSheet onClose={onClose} onDone={onDone} />);
  return { onClose, onDone };
}

const poll = (ms = 2000) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const fill = () => {
  type("Name", "acme-metrics");
  type("Server address", "https://mcp.acme.dev/mcp");
};

beforeEach(() => {
  resetToolkitStores();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  popup = fakePopup();
  open = vi.fn(() => popup);
  vi.stubGlobal("open", open);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetToolkitStores();
});

describe("CustomConnectorSheet", () => {
  it("asks for a name and an address, and says what belongs in Tools", () => {
    serve();
    show();
    const sheet = screen.getByRole("dialog", { name: "Custom connector" });
    expect(sheet).toHaveTextContent("Any remote MCP server that signs in");
    expect(sheet).toHaveTextContent(
      "For remote MCP servers that sign in with OAuth, like everything in Browse. A server that takes a key in a header, or runs as a local command, goes in Tools.",
    );
    expect(screen.getByRole("button", { name: "Check the server" })).toBeDisabled();
    fill();
    expect(screen.getByRole("button", { name: "Check the server" })).toBeEnabled();
  });

  it("checks the server, shows where you’ll sign in, and connects", async () => {
    const calls = serve();
    const { onDone } = show();
    fill();
    click("Check the server");
    expect(await screen.findByText(/a different site from mcp\.acme\.dev/)).toHaveTextContent(
      "You’ll sign in at auth.acme.dev, a different site from mcp.acme.dev. Only continue if you know it.",
    );
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/connectors",
        body: { url: "https://mcp.acme.dev/mcp", name: "acme-metrics", access: "read" },
      },
    ]);
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveTextContent(
      "Read only lets agents call only the tools the server marks as read-only. A tool the server doesn’t mark counts as a write.",
    );
    expect(sheet).toHaveTextContent("Your sign-in stays on Tvashtr’s servers, encrypted.");
    // Checking opens nothing: the window opens when you continue.
    expect(open).not.toHaveBeenCalled();

    click("Continue to auth.acme.dev");
    await screen.findByText("Waiting for you to finish in the acme-metrics window");
    expect(popup?.location.href).toBe(AUTHORIZE);

    row = { ...PENDING, status: "connected" };
    await poll();
    expect(onDone).toHaveBeenCalledOnce();
    expect(onDone.mock.calls[0][0]).toMatchObject({ id: "c1", status: "connected" });
    // Read only was kept: nothing to change after the sign-in.
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("names the sign-in site plainly when it is the server’s own", async () => {
    serve({
      "POST /api/connectors": {
        ...PENDING,
        signin_host: "mcp.acme.dev",
        signin_host_differs: false,
      },
    });
    show();
    fill();
    click("Check the server");
    expect(await screen.findByText(/You’ll sign in at/)).toHaveTextContent(
      "You’ll sign in at mcp.acme.dev.",
    );
    expect(screen.getByRole("button", { name: "Continue to mcp.acme.dev" })).toBeEnabled();
  });

  it("turns on read & write once the sign-in is through", async () => {
    const calls = serve();
    const { onDone } = show();
    fill();
    click("Check the server");
    await screen.findByText(/You’ll sign in at/);
    click("Read & write");
    click("Continue to auth.acme.dev");
    await screen.findByText("Waiting for you to finish in the acme-metrics window");
    row = { ...PENDING, status: "connected" };
    await poll();
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(calls.at(-1)).toEqual({
      method: "PATCH",
      path: "/api/connectors/c1",
      body: { access: "write" },
    });
    expect(onDone.mock.calls[0][0]).toMatchObject({ access: "write" });
  });

  it("checks again after the address is edited", async () => {
    serve();
    show();
    fill();
    click("Check the server");
    await screen.findByText(/You’ll sign in at/);
    type("Server address", "https://mcp.acme.dev/v2");
    expect(screen.queryByText(/You’ll sign in at/)).toBeNull();
    expect(screen.getByRole("button", { name: "Check the server" })).toBeEnabled();
  });

  it("goes back to the sign-in site when you cancel the wait", async () => {
    serve();
    const { onClose } = show();
    fill();
    click("Check the server");
    await screen.findByText(/You’ll sign in at/);
    click("Continue to auth.acme.dev");
    await screen.findByText("Waiting for you to finish in the acme-metrics window");
    click("Cancel");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign-in cancelled. Nothing was connected.",
    );
    expect(popup?.close).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Continue to auth.acme.dev" })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sends a server with no sign-in to Tools", async () => {
    window.location.hash = "#/toolkit/connectors";
    serve({
      "POST /api/connectors": refuse(
        422,
        "no_signin",
        "This server didn’t offer an OAuth sign-in. If it takes a key, add it in Tools and keep the key as a secret.",
      ),
    });
    const { onClose } = show();
    fill();
    click("Check the server");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This server didn’t offer an OAuth sign-in. If it takes a key, add it in Tools and keep the key as a secret. Its tools then work the same way.",
    );
    expect(screen.queryByRole("button", { name: "Check the server" })).toBeNull();
    click("Add it in Tools");
    expect(window.location.hash).toBe("#/toolkit/tools");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(["POST /api/connectors", "POST /api/connectors/c1/oauth/start"])(
    "explains a server Tvashtr can’t register with (%s)",
    async (route) => {
      serve({
        [route]: refuse(
          422,
          "cannot_register",
          "acme-metrics needs an app registered with it before Tvashtr can sign in.",
        ),
      });
      show();
      fill();
      click("Check the server");
      if (route.endsWith("start")) {
        await screen.findByText(/You’ll sign in at/);
        click("Continue to auth.acme.dev");
      }
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "acme-metrics needs an app registered with it before Tvashtr can sign in, and it doesn’t let Tvashtr register by itself. Ask its maker, or add it in Tools if it also takes a key.",
      );
      expect(screen.getByRole("button", { name: "Add it in Tools" })).toBeInTheDocument();
    },
  );

  it.each([
    [422, "invalid_url", "Use an https:// address, like https://mcp.example.com/mcp."],
    [409, "already_connected", "acme-metrics is already connected."],
    [502, "unreachable", "We couldn’t reach mcp.acme.dev. Try again."],
  ])("puts %i %s under the address", async (status, code, message) => {
    serve({ "POST /api/connectors": refuse(status, code, message) });
    show();
    fill();
    click("Check the server");
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Server address")).toBeInvalid();
    expect(screen.getByRole("button", { name: "Check the server" })).toBeEnabled();
  });

  it("goes back to checking the server when the connection was removed meanwhile", async () => {
    serve();
    show();
    fill();
    click("Check the server");
    await screen.findByText(/You’ll sign in at/);
    click("Continue to auth.acme.dev");
    await screen.findByText("Waiting for you to finish in the acme-metrics window");
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "Connector not found." }), { status: 404 }),
      ),
    );
    await poll();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "acme-metrics was removed before the sign-in finished. Check the server again.",
    );
    expect(screen.getByRole("button", { name: "Check the server" })).toBeEnabled();
    await poll(6000);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("shows the provider’s refusal with Try again", async () => {
    serve();
    show();
    fill();
    click("Check the server");
    await screen.findByText(/You’ll sign in at/);
    click("Continue to auth.acme.dev");
    await screen.findByText("Waiting for you to finish in the acme-metrics window");
    row = { ...PENDING, last_error: "You didn’t allow access on acme-metrics." };
    await poll();
    expect(screen.getByRole("alert")).toHaveTextContent("You didn’t allow access on acme-metrics");
    click("Try again");
    await screen.findByText("Waiting for you to finish in the acme-metrics window");
    expect(open).toHaveBeenCalledTimes(2);
  });
});
