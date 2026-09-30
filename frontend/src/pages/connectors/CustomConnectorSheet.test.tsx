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

  it("opens nothing when the sign-in has moved since the check, and asks again with the new site", async () => {
    // The server names another sign-in server the second time it is asked (`oauth/start` runs
    // discovery again). The window only ever opens at a site the sheet has shown.
    const checked = { ...PENDING, signin_host: "mcp.acme.dev", signin_host_differs: false };
    const moved = { ...checked, signin_host: "login.elsewhere.io", signin_host_differs: true };
    const ELSEWHERE = "https://login.elsewhere.io/authorize?state=s1";
    const calls = serve({
      "POST /api/connectors": checked,
      "POST /api/connectors/c1/oauth/start": {
        authorize_url: ELSEWHERE,
        signin_host: "login.elsewhere.io",
        expires_in: 600,
      },
    });
    show();
    fill();
    click("Check the server");
    expect(await screen.findByText(/You’ll sign in at/)).toHaveTextContent(
      "You’ll sign in at mcp.acme.dev.",
    );
    row = moved;
    click("Continue to mcp.acme.dev");

    expect(await screen.findByText(/a different site from mcp\.acme\.dev/)).toHaveTextContent(
      "You’ll sign in at login.elsewhere.io, a different site from mcp.acme.dev. Only continue if you know it.",
    );
    expect(popup?.location.href).toBe("about:blank");
    expect(popup?.close).toHaveBeenCalled();
    expect(screen.queryByText(/Waiting for you to finish/)).toBeNull();
    expect(calls.filter((c) => c.path.endsWith("/oauth/start"))).toHaveLength(1);

    // Shown now: the next click opens it.
    popup = fakePopup();
    click("Continue to login.elsewhere.io");
    await screen.findByText("Waiting for you to finish in the acme-metrics window");
    expect(popup.location.href).toBe(ELSEWHERE);
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
    // Nobody reviewed this server: the page it opens could be another service's.
    expect(sheet).toHaveTextContent(
      "The sign-in page that opens should be acme-metrics’s own. If it asks for access to a different service, close it.",
    );
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

  it("says so when it is connected but couldn’t be switched to read & write", async () => {
    serve({
      "PATCH /api/connectors/c1": refuse(502, "unreachable", "We couldn’t reach mcp.acme.dev."),
    });
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
    expect(onDone.mock.calls[0][0]).toMatchObject({ status: "connected", access: "read" });
    expect(
      screen.getByText(
        "acme-metrics is connected read only. Tvashtr couldn’t switch it to read & write: change that on its page.",
      ),
    ).toBeInTheDocument();
  });

  it("takes a name changed after the check, without checking the server again", async () => {
    const calls = serve();
    const { onDone } = show();
    fill();
    click("Check the server");
    await screen.findByText(/You’ll sign in at/);

    type("Name", "Acme Metrics");
    // The name isn't the server: what was checked still stands.
    expect(screen.getByText(/You’ll sign in at/)).toBeInTheDocument();
    click("Continue to auth.acme.dev");
    await screen.findByText("Waiting for you to finish in the Acme Metrics window");
    await waitFor(() => expect(popup?.location.href).toBe(AUTHORIZE));
    // The name goes in while the connection is still pending, before the sign-in starts: until
    // it is connected the server takes its slug (its tools' prefix) from the name it has.
    const sent = calls.map((c) => `${c.method} ${c.path}`);
    const renamed = sent.indexOf("PATCH /api/connectors/c1");
    expect(calls[renamed]).toEqual({
      method: "PATCH",
      path: "/api/connectors/c1",
      body: { name: "Acme Metrics" },
    });
    expect(renamed).toBeLessThan(sent.indexOf("POST /api/connectors/c1/oauth/start"));

    row = { ...PENDING, name: "Acme Metrics", status: "connected" };
    await poll();
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(calls.filter((c) => c.path === "/api/connectors")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(onDone.mock.calls[0][0]).toMatchObject({ name: "Acme Metrics" });
  });

  it("sends the name again after the sign-in when it couldn’t be saved before it", async () => {
    let refusals = 1;
    const calls = serve({
      "PATCH /api/connectors/c1": (_u: URL, body: Partial<Connection>) =>
        refusals-- > 0 ? new Response("oops", { status: 500 }) : { ...row, ...body },
    });
    const { onDone } = show();
    fill();
    click("Check the server");
    await screen.findByText(/You’ll sign in at/);
    type("Name", "Acme Metrics");
    click("Continue to auth.acme.dev");
    // A name that couldn't be saved doesn't stop the sign-in.
    await waitFor(() => expect(popup?.location.href).toBe(AUTHORIZE));
    row = { ...PENDING, status: "connected" };
    await poll();
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2);
    expect(onDone.mock.calls[0][0]).toMatchObject({ name: "Acme Metrics" });
  });

  it("keeps the name it was checked with when the new one is refused", async () => {
    serve({
      "PATCH /api/connectors/c1": refuse(422, "invalid_name", "A name is 1 to 60 characters."),
    });
    const { onDone } = show();
    fill();
    click("Check the server");
    await screen.findByText(/You’ll sign in at/);
    type("Name", "\u202e");
    click("Continue to auth.acme.dev");
    await waitFor(() => expect(popup?.location.href).toBe(AUTHORIZE));
    row = { ...PENDING, status: "connected" };
    await poll();
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(onDone.mock.calls[0][0]).toMatchObject({ name: "acme-metrics", status: "connected" });
  });

  it("doesn’t continue without a name", async () => {
    serve();
    show();
    fill();
    click("Check the server");
    await screen.findByText(/You’ll sign in at/);
    type("Name", " ");
    expect(screen.getByRole("button", { name: "Continue to auth.acme.dev" })).toBeDisabled();
  });

  it.each([
    ["a check", {}],
    [
      "a server it can’t connect",
      { "POST /api/connectors": refuse(422, "cannot_register", "Acme needs an app registered.") },
    ],
  ])("keeps the field you are typing in after %s", async (_what, routes) => {
    serve(routes);
    show();
    fill();
    click("Check the server");
    await screen.findByText(/You’ll sign in at|needs an app registered/);
    const field = screen.getByLabelText("Server address");
    field.focus();
    type("Server address", "https://mcp.acme.dev/v2");
    // The same input, still focused: not a new one the next keystroke misses.
    expect(field).toBeInTheDocument();
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole("button", { name: "Check the server" })).toBeEnabled();
  });

  it("says to try again when too many connector requests are going, and checks on the next try", async () => {
    const message = "Too many connector requests at once. Try again in a moment.";
    let busy = true;
    serve({ "POST /api/connectors": () => (busy ? refuse(429, "busy", message) : PENDING) });
    show();
    fill();
    click("Check the server");
    expect(await screen.findByText(message)).toBeInTheDocument();
    busy = false;
    click("Check the server");
    expect(await screen.findByText(/You’ll sign in at/)).toBeInTheDocument();
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

  it("doesn’t close while the server is being checked", async () => {
    let answer: (row: Connection) => void = () => {};
    serve({
      "POST /api/connectors": () => new Promise<Connection>((resolve) => (answer = resolve)),
    });
    const { onClose } = show();
    fill();
    click("Check the server");
    click("Close");
    expect(onClose).not.toHaveBeenCalled();
    // Nor can the address change under the check: its answer is about what was sent.
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Server address")).toBeDisabled();
    await act(async () => {
      answer(PENDING);
      await Promise.resolve();
    });
    expect(await screen.findByText(/You’ll sign in at/)).toBeInTheDocument();
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
