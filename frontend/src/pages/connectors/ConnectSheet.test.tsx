/**
 * The connect sheet (CnF-Sign-2..4, CnF-Key-2..3, CnF-Desk-1, CnF-Prob-1..2): choose access →
 * wait for the provider's window → pick a project; the API-key form; and each way it can go wrong.
 * Also opened for an existing connection: Sign in again, Replace key, Change project.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection } from "../../lib/api/connectors";
import { mockApi, renderWithProviders, resetToolkitStores } from "../tools/toolsTestUtils";
import { type ConnectTarget, ConnectSheet } from "./ConnectSheet";
import { connection, entry } from "./connectorsTestUtils";

const AUTHORIZE = "https://api.supabase.com/v1/oauth/authorize?response_type=code&state=s1";
const START = { authorize_url: AUTHORIZE, signin_host: "api.supabase.com", expires_in: 600 };
const PENDING = connection({
  status: "pending",
  scope: null,
  tools: null,
  connected_at: null,
  used_by: { agent_count: 0, team_count: 0 },
});
const CONNECTED = { ...PENDING, status: "connected" as const };
const OPTIONS = {
  param: "project_ref",
  label: "Project",
  manual: false,
  options: [
    { value: "abcd1234", label: "trade-mcp-prod", detail: "ap-southeast-1" },
    { value: "efgh5678", label: "trade-mcp-staging", detail: "ap-southeast-1" },
    { value: "ijkl9012", label: "landing-page", detail: null },
  ],
};
const NOTION = entry({
  key: "notion",
  name: "Notion",
  publisher: "Notion",
  category: "docs",
  description: "Search and read pages and databases.",
  host: "mcp.notion.com",
  read_only_by: "annotations",
  scope_picker: null,
});
const APIFY = entry({
  key: "com.apify/apify-mcp-server",
  name: "Apify",
  publisher: null,
  featured: false,
  reviewed: false,
  category: null,
  description: "Run web scrapers and read their results.",
  website: null,
  host: "mcp.apify.com",
  auth: "api_key",
  key_fields: [
    {
      id: "Authorization",
      label: "API key",
      hint: "Apify API token",
      secret: true,
      required: true,
    },
  ],
  read_only_by: "annotations",
  scope_picker: null,
});
const APIFY_ROW = connection({
  id: "c9",
  connector_key: APIFY.key,
  name: "Apify",
  slug: "apify",
  publisher: null,
  featured: false,
  reviewed: false,
  category: null,
  host: "mcp.apify.com",
  auth_kind: "api_key",
  key_fields: APIFY.key_fields,
  signin_host: null,
  read_only_by: "annotations",
  scope: null,
  scope_picker: null,
});

function fakePopup() {
  return { location: { href: "about:blank" }, opener: window as unknown, close: vi.fn() };
}
let popup: ReturnType<typeof fakePopup> | null;
let open: ReturnType<typeof vi.fn>;
/** What `GET /api/connectors/c1` answers: the tests move it on as the sign-in goes. */
let row: Connection;

const refuse = (status: number, detail: unknown) =>
  new Response(JSON.stringify({ detail }), { status });

function serve(routes: Record<string, unknown> = {}) {
  row = { ...PENDING, signin_pending: true };
  return mockApi({
    "POST /api/connectors": PENDING,
    "POST /api/connectors/c1/oauth/start": START,
    "GET /api/connectors/c1": () => ({
      ...row,
      used_by_agents: [],
      recent_use: [],
      revoke_hint: null,
    }),
    "GET /api/connectors/c1/scope-options": OPTIONS,
    "PATCH /api/connectors/c1": (_u: URL, body: Partial<Connection>) => ({ ...row, ...body }),
    ...routes,
  });
}

function show(target: ConnectTarget) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  const { unmount } = renderWithProviders(
    <ConnectSheet target={target} onClose={onClose} onDone={onDone} />,
  );
  return { onClose, onDone, unmount };
}

/** Let the sheet's two-second poll come round. */
const poll = (ms = 2000) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
/** The footer's button (the sheet's own ✕ is also called "Close"). */
const footerClick = (name: string) => {
  const footer = screen.getByRole("dialog").querySelector("footer") as HTMLElement;
  fireEvent.click(within(footer).getByRole("button", { name }));
};
const polls = (calls: { method: string; path: string }[]) =>
  calls.filter((c) => c.method === "GET" && c.path === "/api/connectors/c1").length;

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
  delete document.documentElement.dataset.tvashtrDesktop;
  resetToolkitStores();
});

describe("signing in to a catalog connector", () => {
  it("asks what agents may do before it sends you to the provider", () => {
    serve();
    show({ entry: entry() });
    const sheet = screen.getByRole("dialog", { name: "Connect Supabase" });
    expect(sheet).toHaveTextContent("By Supabase · signs in with your Supabase account");
    expect(sheet).toHaveTextContent(
      "Read tables, run read-only SQL and check logs in one project.",
    );
    const seg = within(sheet).getByRole("group", { name: "What agents may do" });
    expect(within(seg).getByRole("button", { name: "Read only" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(seg).getByRole("button", { name: "Read & write" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(sheet).toHaveTextContent(
      "Read only runs SQL as a read-only database user, so a query can’t change data.",
    );
    expect(sheet).toHaveTextContent(
      "Your sign-in stays on Tvashtr’s servers, encrypted. Agents never get it: their calls go through Tvashtr, which adds the sign-in and enforces read only.",
    );
    expect(within(sheet).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Continue to Supabase" })).toBeEnabled();
    // A connector that isn't Tvashtr-reviewed says so; a Featured one doesn't.
    expect(sheet).not.toHaveTextContent("hasn’t reviewed");
  });

  it("opens the window, waits, asks for the project and finishes", async () => {
    const calls = serve();
    const { onDone } = show({ entry: entry() });

    click("Continue to Supabase");
    // The popup is opened in the click, blank, and pointed at the provider once it is known.
    expect(open).toHaveBeenCalledExactlyOnceWith("", "tv-connect", "popup,width=520,height=720");
    expect(
      await screen.findByText("Waiting for you to finish in the Supabase window"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Sign in there and allow access for Tvashtr. This sheet moves on by itself.",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("Step 2 of 3");
    expect(calls.slice(0, 2)).toEqual([
      { method: "POST", path: "/api/connectors", body: { key: "supabase", access: "read" } },
      { method: "POST", path: "/api/connectors/c1/oauth/start", body: undefined },
    ]);
    expect(popup?.location.href).toBe(AUTHORIZE);

    // Still signing in: the sheet keeps waiting.
    await poll();
    expect(polls(calls)).toBe(1);
    expect(screen.getByText("Waiting for you to finish in the Supabase window")).toBeVisible();

    expect(popup?.close).not.toHaveBeenCalled();
    row = CONNECTED;
    await poll();
    const sheet = screen.getByRole("dialog", { name: "Connect Supabase" });
    expect(sheet).toHaveTextContent("Step 3 of 3 · pick a project");
    // The sign-in is over: a window the callback page left open is closed.
    expect(popup?.close).toHaveBeenCalledOnce();
    expect(sheet).toHaveTextContent("Signed in to Supabase.");
    expect(sheet).toHaveTextContent("Which project can agents use?");
    expect(sheet).toHaveTextContent("Agents only see this one project. You can change it later.");
    const options = await within(sheet).findAllByRole("radio");
    expect(options.map((o) => o.closest("label")?.textContent)).toEqual([
      "trade-mcp-prodap-southeast-1",
      "trade-mcp-stagingap-southeast-1",
      "landing-page",
    ]);
    expect(options[0]).toBeChecked();
    // The sign-in is over: nothing polls any more.
    const before = polls(calls);
    await poll(6000);
    expect(polls(calls)).toBe(before);

    fireEvent.click(options[1]);
    click("Finish");
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(calls.at(-2)).toEqual({
      method: "PATCH",
      path: "/api/connectors/c1",
      body: { scope: { value: "efgh5678", label: "trade-mcp-staging · ap-southeast-1" } },
    });
    // Then the tools are listed again: what the provider lists depends on the project.
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/api/connectors/c1/check" });
    expect(onDone.mock.calls[0][0]).toMatchObject({
      id: "c1",
      scope: { value: "efgh5678", label: "trade-mcp-staging · ap-southeast-1" },
    });
    expect(onDone.mock.calls[0][1]).toBe("connected");
  });

  it("connects read & write when you choose it, on the first step or the last", async () => {
    const calls = serve();
    const { onDone } = show({ entry: entry() });
    click("Read & write");
    click("Continue to Supabase");
    await screen.findByText("Waiting for you to finish in the Supabase window");
    expect(calls[0].body).toEqual({ key: "supabase", access: "write" });

    row = { ...CONNECTED, access: "write" };
    await poll();
    const seg = await screen.findByRole("group", { name: "What agents may do" });
    expect(within(seg).getByRole("button", { name: "Read & write" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Narrowed again on the last step: Finish sends the access with the project.
    fireEvent.click(within(seg).getByRole("button", { name: "Read only" }));
    await screen.findAllByRole("radio");
    click("Finish");
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(calls.at(-2)?.body).toEqual({
      scope: { value: "abcd1234", label: "trade-mcp-prod · ap-southeast-1" },
      access: "read",
    });
  });

  it("goes Back from the project to the access step without signing in again", async () => {
    const calls = serve();
    show({ entry: entry() });
    click("Continue to Supabase");
    await screen.findByText("Waiting for you to finish in the Supabase window");
    row = CONNECTED;
    await poll();
    await screen.findAllByRole("radio");

    click("Back");
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Read tables, run read-only SQL and check logs in one project.",
    );
    click("Continue");
    expect(await screen.findAllByRole("radio")).toHaveLength(3);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
  });

  it.each([
    ["the sheet’s ✕", () => click("Close")],
    [
      "Back, then Cancel",
      () => {
        click("Back");
        footerClick("Cancel");
      },
    ],
  ])("is connected, to the whole account, when it is left with %s", async (_how, leave) => {
    serve();
    const { onDone, onClose } = show({ entry: entry() });
    click("Continue to Supabase");
    await screen.findByText("Waiting for you to finish in the Supabase window");
    row = CONNECTED;
    await poll();
    await screen.findAllByRole("radio");

    leave();
    // The sign-in went through: the page hears of a connection, not of a sheet that was closed.
    expect(onClose).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
    expect(onDone.mock.calls[0][0]).toMatchObject({ id: "c1", status: "connected", scope: null });
    expect(onDone.mock.calls[0][1]).toBe("connected");
  });

  it("asks for the project id when the provider’s list can’t be read", async () => {
    const calls = serve({
      "GET /api/connectors/c1/scope-options": { ...OPTIONS, manual: true, options: [] },
    });
    const { onDone } = show({ entry: entry() });
    click("Continue to Supabase");
    await screen.findByText("Waiting for you to finish in the Supabase window");
    row = CONNECTED;
    await poll();

    const field = await screen.findByRole("textbox", { name: "Project id" });
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
    fireEvent.change(field, { target: { value: " abcd1234 " } });
    click("Finish");
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(calls.at(-2)?.body).toEqual({ scope: { value: "abcd1234", label: "abcd1234" } });
  });

  it("says why a project id was refused", async () => {
    serve({
      "GET /api/connectors/c1/scope-options": { ...OPTIONS, manual: true, options: [] },
      "PATCH /api/connectors/c1": refuse(422, {
        code: "invalid_scope",
        message: "That doesn’t look like a project id.",
      }),
    });
    const { onDone } = show({ entry: entry() });
    click("Continue to Supabase");
    await screen.findByText("Waiting for you to finish in the Supabase window");
    row = CONNECTED;
    await poll();
    fireEvent.change(await screen.findByRole("textbox", { name: "Project id" }), {
      target: { value: "a b" },
    });
    click("Finish");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That doesn’t look like a project id.",
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it("is done after the sign-in when the connector has no project to pick", async () => {
    const pending = { ...PENDING, connector_key: "notion", name: "Notion", scope_picker: null };
    serve({ "POST /api/connectors": pending });
    const { onDone } = show({ entry: NOTION });
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Read only lets agents call only the tools this server marks as read-only. A tool it doesn’t mark counts as a write.",
    );
    click("Continue to Notion");
    await screen.findByText("Waiting for you to finish in the Notion window");
    expect(screen.getByRole("dialog")).toHaveTextContent("Step 2 of 2");

    row = { ...pending, status: "connected" };
    await poll();
    expect(onDone).toHaveBeenCalledOnce();
    expect(onDone.mock.calls[0][0]).toMatchObject({ id: "c1", status: "connected" });
    expect(onDone.mock.calls[0][1]).toBe("connected");
  });

  it("connects a server that needs no sign-in without opening a window", async () => {
    const calls = serve({
      "POST /api/connectors": { ...CONNECTED, auth_kind: "none", scope_picker: null },
    });
    const { onDone } = show({ entry: { ...NOTION, auth: "none" } });
    click("Continue to Notion");
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(onDone.mock.calls[0][1]).toBe("connected");
    expect(open).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it("offers no Read & write on a connector that can only read", () => {
    serve();
    show({ entry: entry({ ...NOTION, name: "Google Drive", access_modes: ["read"] }) });
    expect(screen.queryByRole("group", { name: "What agents may do" })).toBeNull();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Google Drive can only be connected read only.",
    );
  });

  it("checks again when you come back to the window", async () => {
    const calls = serve();
    show({ entry: NOTION });
    click("Continue to Notion");
    // The window is open (the button is live): from here the sheet is listening.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open the window again" })).toBeEnabled(),
    );
    await act(async () => {}); // …once its effects have run
    expect(polls(calls)).toBe(0);
    act(() => void window.dispatchEvent(new Event("focus")));
    // At once, not at the next two-second poll.
    await waitFor(() => expect(polls(calls)).toBe(1), { timeout: 500 });
  });
});

describe("when the sign-in goes wrong", () => {
  it("says the browser blocked the window, and opens it again", async () => {
    serve();
    popup = null;
    show({ entry: entry() });
    click("Continue to Supabase");
    expect(await screen.findByText("Your browser blocked the sign-in window")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Allow pop-ups for Tvashtr, or open the window yourself. This sheet moves on when you finish there.",
    );

    popup = fakePopup();
    click("Open the window again");
    expect(popup.location.href).toBe(AUTHORIZE);
    expect(screen.getByText("Waiting for you to finish in the Supabase window")).toBeVisible();

    // It still moves on by itself.
    row = CONNECTED;
    await poll();
    expect(await screen.findByText("Which project can agents use?")).toBeInTheDocument();
  });

  it("stops and says nothing was connected when you cancel", async () => {
    const calls = serve();
    const { onClose } = show({ entry: entry() });
    click("Continue to Supabase");
    await screen.findByText("Waiting for you to finish in the Supabase window");

    click("Cancel");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign-in cancelled. Nothing was connected.",
    );
    expect(screen.getByRole("button", { name: "Continue to Supabase" })).toBeEnabled();
    expect(popup?.close).toHaveBeenCalledOnce();
    await poll(6000);
    expect(polls(calls)).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
    // Cancel on the first step closes the sheet.
    click("Cancel");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("gives up after ten minutes", async () => {
    const calls = serve();
    show({ entry: entry() });
    click("Continue to Supabase");
    await screen.findByText("Waiting for you to finish in the Supabase window");

    await poll(9 * 60_000);
    expect(screen.getByText("Waiting for you to finish in the Supabase window")).toBeVisible();
    await poll(60_000);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The sign-in wasn’t finished in time. Try again.",
    );
    const after = polls(calls);
    await poll(6000);
    expect(polls(calls)).toBe(after);
  });

  it("shows the provider’s refusal and lets you try again", async () => {
    const calls = serve();
    const { onDone } = show({ entry: entry() });
    click("Continue to Supabase");
    await screen.findByText("Waiting for you to finish in the Supabase window");

    row = { ...PENDING, last_error: "You didn’t allow access on Supabase." };
    await poll();
    const sheet = screen.getByRole("dialog", { name: "Connect Supabase" });
    expect(within(sheet).getByRole("alert")).toHaveTextContent(
      "You didn’t allow access on SupabaseNothing was connected. Try again when you’re ready; you can pick a different Supabase account in the window.",
    );
    expect(sheet.querySelector("footer")).toHaveTextContent("Close");
    expect(onDone).not.toHaveBeenCalled();

    row = { ...PENDING, signin_pending: true };
    click("Try again");
    await screen.findByText("Waiting for you to finish in the Supabase window");
    expect(open).toHaveBeenCalledTimes(2);
    expect(calls.filter((c) => c.path.endsWith("/oauth/start"))).toHaveLength(2);
  });

  it("opens the address the server says to open, which leads to the provider", async () => {
    // Tvashtr's own address: the browser that opens it is the one the sign-in is finished in.
    const open_url = "https://tvashtr.test/api/connectors/oauth/go?state=s1";
    serve({ "POST /api/connectors/c1/oauth/start": { ...START, open_url } });
    show({ entry: entry() });
    click("Continue to Supabase");
    await screen.findByText("Waiting for you to finish in the Supabase window");
    expect(popup?.location.href).toBe(open_url);
  });

  it("never opens a sign-in address that isn’t http(s)", async () => {
    serve({
      "POST /api/connectors/c1/oauth/start": {
        ...START,
        authorize_url: "javascript:alert(document.cookie)",
      },
    });
    show({ entry: entry() });
    click("Continue to Supabase");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tvashtr couldn’t open the sign-in page. Try again.",
    );
    expect(popup?.location.href).toBe("about:blank");
    expect(popup?.close).toHaveBeenCalled();
  });

  it.each([
    [409, "already_connected", "Supabase is already connected."],
    [409, "coming_soon", "Supabase isn’t available yet."],
    [422, "invalid_access", "Supabase can only be connected read only."],
    [502, "unreachable", "We couldn’t reach mcp.supabase.com. Try again."],
  ])("says what the server said for %i %s", async (status, code, message) => {
    serve({ "POST /api/connectors": refuse(status, { code, message }) });
    const { onDone } = show({ entry: entry() });
    click("Continue to Supabase");
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Continue to Supabase" })).toBeEnabled();
    expect(popup?.close).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("falls back to its own words when the server gave none", async () => {
    serve({ "POST /api/connectors": new Response("oops", { status: 500 }) });
    show({ entry: entry() });
    click("Continue to Supabase");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t connect Supabase. Try again.",
    );
  });

  it.each(["POST /api/connectors", "POST /api/connectors/c1/oauth/start"])(
    "explains a connector Tvashtr can’t register with (%s)",
    async (route) => {
      serve({
        [route]: refuse(422, {
          code: "cannot_register",
          message: "Supabase needs an app registered with it before Tvashtr can sign in.",
        }),
      });
      const { onClose } = show({ entry: entry() });
      click("Continue to Supabase");
      const panel = await screen.findByRole("alert");
      expect(panel).toHaveTextContent(
        "Tvashtr can’t sign in to Supabase yetSupabase needs an app registered with it before Tvashtr can sign in.",
      );
      expect(screen.queryByRole("button", { name: "Add it in Tools" })).toBeNull();
      expect(popup?.close).toHaveBeenCalled();
      footerClick("Close");
      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it.each(["POST /api/connectors", "POST /api/connectors/c1/oauth/start"])(
    "says to try again when too many connector requests are going, and the next try goes on (%s)",
    async (route) => {
      const message = "Too many connector requests at once. Try again in a moment.";
      let busy = true;
      const answer = route.endsWith("/start") ? START : PENDING;
      serve({ [route]: () => (busy ? refuse(429, { code: "busy", message }) : answer) });
      show({ entry: entry() });
      click("Continue to Supabase");
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(popup?.close).toHaveBeenCalled();

      busy = false;
      click("Continue to Supabase");
      await screen.findByText("Waiting for you to finish in the Supabase window");
      await waitFor(() => expect(popup?.location.href).toBe(AUTHORIZE));
    },
  );

  it("sends a server with no sign-in to Tools", async () => {
    window.location.hash = "#/toolkit/connectors/browse";
    serve({
      "POST /api/connectors": refuse(422, {
        code: "no_signin",
        message:
          "This server didn’t offer an OAuth sign-in. If it takes a key, add it in Tools and keep the key as a secret.",
      }),
    });
    const { onClose } = show({ entry: { ...APIFY, auth: "unknown", key_fields: [] } });
    click("Continue to Apify");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This server didn’t offer an OAuth sign-in. If it takes a key, add it in Tools and keep the key as a secret.",
    );
    click("Add it in Tools");
    expect(window.location.hash).toBe("#/toolkit/tools");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("says whose sign-in page to expect, for a server Tvashtr hasn’t reviewed", () => {
    const OWN =
      "The sign-in page that opens should be Apify’s own. If it asks for access to a different service, close it.";
    serve();
    show({ entry: { ...APIFY, auth: "unknown", key_fields: [] } });
    expect(screen.getByRole("dialog")).toHaveTextContent(OWN);
    cleanup();
    // A key opens no sign-in page, and a Featured connector's sign-in is one Tvashtr checked.
    show({ entry: APIFY });
    expect(screen.getByRole("dialog")).not.toHaveTextContent("should be Apify’s own");
    cleanup();
    show({ entry: entry() });
    expect(screen.getByRole("dialog")).not.toHaveTextContent("should be Supabase’s own");
  });

  it("shows where you’ll sign in when it is a different site, before it opens anything", async () => {
    const pending = {
      ...PENDING,
      connector_key: APIFY.key,
      name: "Apify",
      host: "mcp.apify.com",
      signin_host: "auth.example.net",
      signin_host_differs: true,
      scope_picker: null,
    };
    const calls = serve({
      "POST /api/connectors": pending,
      "POST /api/connectors/c1/oauth/start": {
        ...START,
        authorize_url: "https://auth.example.net/authorize?state=s1",
        signin_host: "auth.example.net",
      },
    });
    show({ entry: { ...APIFY, auth: "unknown", key_fields: [] } });
    // Not reviewed by Tvashtr: the sheet says whose address this is.
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "From the MCP Registry, listed by its maker. Tvashtr hasn’t reviewed this server: check that mcp.apify.com is the address you expect.",
    );
    click("Continue to Apify");
    expect(await screen.findByText(/a different site from mcp\.apify\.com/)).toHaveTextContent(
      "You’ll sign in at auth.example.net, a different site from mcp.apify.com. Only continue if you know it.",
    );
    expect(popup?.close).toHaveBeenCalledOnce();
    expect(calls.some((c) => c.path.endsWith("/oauth/start"))).toBe(false);

    click("Continue to auth.example.net");
    await screen.findByText("Waiting for you to finish in the Apify window");
    expect(popup?.location.href).toBe("https://auth.example.net/authorize?state=s1");
  });
});

describe("while the server is answering", () => {
  /** `POST /api/connectors` that answers when the test says so. */
  function held() {
    let answer: (row: Connection) => void = () => {};
    const calls = serve({
      "POST /api/connectors": () => new Promise<Connection>((resolve) => (answer = resolve)),
    });
    return {
      calls,
      answer: (row: Connection) =>
        act(async () => {
          answer(row);
          await Promise.resolve();
        }),
    };
  }
  const started = (calls: { path: string }[]) =>
    calls.filter((c) => c.path.endsWith("/oauth/start")).length;

  it("doesn’t close: what it started would go on behind it", async () => {
    const { calls, answer } = held();
    const { onClose } = show({ entry: entry() });
    click("Continue to Supabase");
    await waitFor(() => expect(calls).toHaveLength(1));
    click("Close"); // the sheet's own ✕ (Escape and the scrim call the same thing)
    expect(onClose).not.toHaveBeenCalled();

    await answer(PENDING);
    expect(
      await screen.findByText("Waiting for you to finish in the Supabase window"),
    ).toBeInTheDocument();
    expect(popup?.location.href).toBe(AUTHORIZE);
  });

  it("opens no sign-in once the sheet is gone", async () => {
    const { calls, answer } = held();
    const { onDone, unmount } = show({ entry: entry() });
    click("Continue to Supabase");
    await waitFor(() => expect(calls).toHaveLength(1));
    unmount(); // the page under it went away
    await answer(PENDING);
    await poll();
    expect(started(calls)).toBe(0);
    expect(popup?.location.href).toBe("about:blank");
    expect(popup?.close).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("reports no connection to a page that is gone", async () => {
    const { calls, answer } = held();
    const { onDone, unmount } = show({ entry: APIFY });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "apify_api_x" } });
    click("Check and connect");
    await waitFor(() => expect(calls).toHaveLength(1));
    unmount();
    await answer(APIFY_ROW);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("on Tvashtr Desktop", () => {
  it("sends you to the system browser and waits there", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    serve({ "POST /api/connectors": { ...PENDING, connector_key: "neon", name: "Neon" } });
    show({ entry: entry({ key: "neon", name: "Neon", publisher: "Neon" }) });
    click("Continue to Neon");
    expect(
      await screen.findByText("Finish signing in to Neon in your browser"),
    ).toBeInTheDocument();
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveTextContent(
      "We opened Neon in your default browser. When you allow access there, this window moves on by itself.",
    );
    expect(sheet).toHaveTextContent("Your sign-in stays on Tvashtr’s servers, encrypted.");
    expect(open).toHaveBeenCalledExactlyOnceWith(AUTHORIZE, "tv-external", "noopener");

    click("Open the browser again");
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith(AUTHORIZE, "tv-external", "noopener");
  });
});

describe("connecting with an API key", () => {
  const field = () => screen.getByLabelText<HTMLInputElement>("API key");

  it("checks the key and connects", async () => {
    const calls = serve({ "POST /api/connectors": { ...APIFY_ROW, access: "write" } });
    const { onDone } = show({ entry: APIFY });
    const sheet = screen.getByRole("dialog", { name: "Connect Apify" });
    expect(sheet).toHaveTextContent("com.apify/apify-mcp-server · connects with an API key");
    expect(sheet).toHaveTextContent(
      "From the MCP Registry, listed by its maker. Tvashtr hasn’t reviewed this server: check that mcp.apify.com is the address you expect.",
    );
    expect(sheet).toHaveTextContent(
      "Apify API token. Sent to mcp.apify.com as its Authorization header.",
    );
    expect(sheet).toHaveTextContent(
      "Read only lets agents call only the tools this server marks as read-only. A tool it doesn’t mark counts as a write.",
    );
    expect(sheet).toHaveTextContent(
      "The key stays on Tvashtr’s servers, encrypted with this connector. Replace it from the connector’s page; it doesn’t show in Secrets.",
    );
    expect(field()).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Check and connect" })).toBeDisabled();

    fireEvent.change(field(), { target: { value: "apify_api_123" } });
    click("Read & write");
    click("Check and connect");
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/connectors",
        body: {
          key: "com.apify/apify-mcp-server",
          access: "write",
          credentials: { Authorization: "apify_api_123" },
        },
      },
    ]);
    expect(onDone.mock.calls[0][0]).toMatchObject({ id: "c9", name: "Apify" });
    expect(onDone.mock.calls[0][1]).toBe("connected");
    // A key needs no window.
    expect(open).not.toHaveBeenCalled();
  });

  it("asks for every key the server takes and needs only the required ones", async () => {
    // A server that takes one of two kinds of key marks neither as required (27 registry
    // entries). Both used to be demanded, and whatever was typed into the spare was sent.
    const either = {
      ...APIFY,
      key_fields: [
        {
          id: "X-Agent-Key",
          label: "X-Agent-Key",
          hint: "Optional",
          secret: true,
          required: false,
        },
        { id: "X-Api-Key", label: "API key", hint: "Optional", secret: true, required: false },
      ],
    };
    const calls = serve({ "POST /api/connectors": APIFY_ROW });
    const { onDone, unmount } = show({ entry: either });
    const button = () => screen.getByRole("button", { name: "Check and connect" });
    expect(button()).toBeDisabled(); // a server that takes a key needs at least one
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: " k2 " } });
    expect(button()).toBeEnabled();
    click("Check and connect");
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    // Only what was filled in is sent.
    expect(calls[0].body).toMatchObject({ credentials: { "X-Api-Key": "k2" } });
    expect(Object.keys((calls[0].body as { credentials: object }).credentials)).toEqual([
      "X-Api-Key",
    ]);
    unmount();

    // One required, one optional: the required one is needed, the other can stay empty.
    const mixed = {
      ...APIFY,
      key_fields: [
        { id: "X-App-Id", label: "X-App-Id", hint: "", secret: false, required: true },
        { id: "X-Token", label: "X-Token", hint: "", secret: true, required: false },
      ],
    };
    show({ entry: mixed });
    fireEvent.change(screen.getByLabelText("X-Token"), { target: { value: "t" } });
    expect(button()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("X-App-Id"), { target: { value: "app" } });
    fireEvent.change(screen.getByLabelText("X-Token"), { target: { value: "" } });
    expect(button()).toBeEnabled();
  });

  it.each([
    ["key_rejected", "Apify didn’t accept the key."],
    ["invalid_key", "That isn’t a key Apify takes. Check it and try again."],
  ])("shows %s on the field", async (code, message) => {
    serve({ "POST /api/connectors": refuse(422, { code, message }) });
    const { onDone } = show({ entry: APIFY });
    fireEvent.change(field(), { target: { value: "nope" } });
    click("Check and connect");
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(field()).toBeInvalid();
    expect(onDone).not.toHaveBeenCalled();
    // Typing again clears it.
    fireEvent.change(field(), { target: { value: "nope2" } });
    expect(field()).toBeValid();
  });

  it("asks for the key when the server says it needs one", async () => {
    const fields = [
      { id: "X-Api-Key", label: "API key", hint: "Acme key", secret: true, required: true },
    ];
    let first = true;
    const calls = serve({
      "POST /api/connectors": () => {
        if (!first) return { ...APIFY_ROW };
        first = false;
        return refuse(422, { code: "key_required", message: "Apify needs a key.", fields });
      },
    });
    const { onDone } = show({ entry: { ...APIFY, auth: "unknown", key_fields: [] } });
    click("Continue to Apify");
    const input = await screen.findByLabelText("API key");
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Acme key. Sent to mcp.apify.com as its X-Api-Key header.",
    );
    expect(popup?.close).toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "k1" } });
    click("Check and connect");
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(calls.at(-1)?.body).toEqual({
      key: APIFY.key,
      access: "read",
      credentials: { "X-Api-Key": "k1" },
    });
  });
});

describe("for a connection you already have", () => {
  it("signs in again at once, in the window the click opened", async () => {
    const expired = connection({ status: "needs_signin", last_error: "Its sign-in expired." });
    const calls = serve();
    const prepared = fakePopup();
    const { onDone } = show({
      connection: expired,
      mode: "signin",
      prepared: prepared as unknown as Window,
    });
    expect(
      await screen.findByText("Waiting for you to finish in the Supabase window"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Sign in to Supabase" })).toBeInTheDocument();
    expect(calls).toEqual([
      { method: "POST", path: "/api/connectors/c1/oauth/start", body: undefined },
    ]);
    expect(prepared.location.href).toBe(AUTHORIZE);
    expect(open).not.toHaveBeenCalled();

    // Not finished: the row still says why it needed a sign-in. That is not a new failure.
    row = { ...expired, signin_pending: true };
    await poll();
    expect(screen.getByText("Waiting for you to finish in the Supabase window")).toBeVisible();

    row = connection();
    await poll();
    expect(onDone).toHaveBeenCalledOnce();
    expect(onDone.mock.calls[0][1]).toBe("signed_in");
  });

  it("still signs in under StrictMode, which mounts the sheet twice", async () => {
    const calls = serve();
    const prepared = fakePopup();
    renderWithProviders(
      <StrictMode>
        <ConnectSheet
          target={{
            connection: connection(),
            mode: "signin",
            prepared: prepared as unknown as Window,
          }}
          onClose={vi.fn()}
          onDone={vi.fn()}
        />
      </StrictMode>,
    );
    await screen.findByText("Waiting for you to finish in the Supabase window");
    expect(calls.filter((c) => c.path.endsWith("/oauth/start"))).toHaveLength(1);
    expect(prepared.location.href).toBe(AUTHORIZE);
    expect(prepared.close).not.toHaveBeenCalled();
  });

  it("keeps the old sign-in’s words apart from a new failure", async () => {
    const expired = connection({ status: "needs_signin", last_error: "Its sign-in expired." });
    serve();
    show({ connection: expired, mode: "signin", prepared: null });
    await screen.findByText("Waiting for you to finish in the Supabase window");
    row = { ...expired, last_error: "Supabase didn’t finish the sign-in. Try again." };
    await poll();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Supabase didn’t finish the sign-inNothing changed. Try again when you’re ready; you can pick a different Supabase account in the window.",
    );
  });

  it("says why when the sign-in fails the same way twice", async () => {
    // Denied once already: the row carries those words, and starting again doesn't clear them.
    const denied = connection({ last_error: "You didn’t allow access on Supabase." });
    serve();
    show({ connection: denied, mode: "signin", prepared: null });
    await screen.findByText("Waiting for you to finish in the Supabase window");
    row = denied;
    await poll();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You didn’t allow access on SupabaseNothing changed. Try again when you’re ready; you can pick a different Supabase account in the window.",
    );
  });

  it("reads the server’s own ten minutes as time that ran out, not as a failure", async () => {
    const expired = connection({ status: "needs_signin", last_error: "Its sign-in expired." });
    serve();
    show({ connection: expired, mode: "signin", prepared: null });
    await screen.findByText("Waiting for you to finish in the Supabase window");
    row = { ...expired, signin_pending: true };
    await poll(10 * 60_000 - 4000);
    expect(screen.getByText("Waiting for you to finish in the Supabase window")).toBeVisible();
    // The server counts from a moment before the app does.
    row = expired;
    await poll();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The sign-in wasn’t finished in time. Try again.",
    );
  });

  it("stops waiting when the connection was disconnected meanwhile", async () => {
    const calls = serve({
      "GET /api/connectors/c1": refuse(404, "Connector not found."),
    });
    show({ connection: connection(), mode: "signin", prepared: null });
    await screen.findByText("Waiting for you to finish in the Supabase window");
    await poll();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Supabase was disconnected before the sign-in finished.",
    );
    const after = polls(calls);
    await poll(6000);
    expect(polls(calls)).toBe(after);
  });

  it("replaces a key", async () => {
    const calls = mockApi({ "PATCH /api/connectors/c9": APIFY_ROW });
    const { onDone } = show({
      connection: { ...APIFY_ROW, status: "needs_signin" },
      mode: "signin",
      prepared: null,
    });
    const sheet = screen.getByRole("dialog", { name: "Replace Apify’s key" });
    // The connection says which key it takes: nothing is looked up.
    const input = within(sheet).getByLabelText("API key");
    expect(sheet).toHaveTextContent("Apify API token. Sent to mcp.apify.com as its Authorization");
    // The access was chosen when it was connected; this only swaps the key.
    expect(within(sheet).queryByRole("group", { name: "What agents may do" })).toBeNull();
    fireEvent.change(input, { target: { value: "apify_api_new" } });
    click("Check and replace");
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(calls).toEqual([
      {
        method: "PATCH",
        path: "/api/connectors/c9",
        body: { credentials: { Authorization: "apify_api_new" } },
      },
    ]);
    expect(onDone.mock.calls[0][1]).toBe("signed_in");
  });

  it("replaces the key of a connector the catalog search doesn’t show on its first page", () => {
    // 138 registry servers share mcp.apify.com and the catalog answers 48 at a time, so a search
    // by host can't find most of them; one the snapshot dropped is on no page at all.
    const calls = mockApi({
      "GET /api/connectors/catalog": {
        items: [APIFY],
        total: 138,
        next_offset: 48,
        categories: [],
      },
    });
    const row = {
      ...APIFY_ROW,
      connector_key: "io.github.lintlab/pdf-to-markdown",
      name: "lintlab PDF To Markdown",
      status: "needs_signin" as const,
      key_fields: [
        { id: "Authorization", label: "API key", hint: "", secret: true, required: true },
        { id: "X-Team", label: "X-Team", hint: "", secret: true, required: true },
      ],
    };
    show({ connection: row, mode: "signin", prepared: null });
    const sheet = screen.getByRole("dialog", { name: "Replace lintlab PDF To Markdown’s key" });
    expect(within(sheet).getByLabelText("API key")).toBeInTheDocument();
    expect(within(sheet).getByLabelText("X-Team")).toBeInTheDocument();
    expect(within(sheet).queryByRole("alert")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("asks for the usual header when the connection names no field", () => {
    mockApi({});
    show({
      connection: { ...APIFY_ROW, status: "needs_signin", key_fields: [] },
      mode: "signin",
      prepared: null,
    });
    expect(screen.getByLabelText("API key")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Sent to mcp.apify.com as its Authorization header.",
    );
  });

  it("changes the project", async () => {
    const calls = serve();
    row = connection();
    const { onDone, onClose } = show({ connection: connection(), mode: "project" });
    const sheet = screen.getByRole("dialog", { name: "Change project" });
    expect(sheet).toHaveTextContent("Supabase · pick a project");
    const options = await within(sheet).findAllByRole("radio");
    // The project it uses now is the one ticked.
    expect(options[0]).toBeChecked();
    expect(within(sheet).queryByRole("group", { name: "What agents may do" })).toBeNull();
    expect(within(sheet).queryByText("Signed in to Supabase.")).toBeNull();

    fireEvent.click(options[2]);
    click("Save");
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(calls.at(-2)?.body).toEqual({ scope: { value: "ijkl9012", label: "landing-page" } });
    expect(onDone.mock.calls[0][1]).toBe("project");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reports the tools the provider lists for the new project", async () => {
    const tools = [{ name: "list_branches", title: null, write: false, on: true }];
    serve({
      "POST /api/connectors/c1/check": () => ({
        ...connection(),
        scope: { value: "ijkl9012", label: "landing-page" },
        tools,
      }),
    });
    row = connection();
    const { onDone } = show({ connection: connection(), mode: "project" });
    fireEvent.click((await screen.findAllByRole("radio"))[2]);
    click("Save");
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(onDone.mock.calls[0][0]).toMatchObject({ scope: { value: "ijkl9012" }, tools });
  });

  it("falls back to the id field when the project list can’t be loaded", async () => {
    serve({
      "GET /api/connectors/c1/scope-options": refuse(502, {
        code: "unreachable",
        message: "We couldn’t reach mcp.supabase.com. Try again.",
      }),
    });
    show({ connection: connection(), mode: "project" });
    const field = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project id" });
    expect(field.value).toBe("abcd1234");
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "We couldn’t list your projects. Enter the project’s id from Supabase.",
    );
  });
});
