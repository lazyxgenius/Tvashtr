import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { connection, entry } from "../../pages/connectors/connectorsTestUtils";
import { mockApi } from "../../pages/tools/toolsTestUtils";
import type { ConnectorGrant } from "../tools/nodeTools";
import { ConnectorsChecklist } from "./ConnectorsChecklist";

// Connect a new app from the drawer (CnF-FromAgent-1..3): "Connect an app" in the Connectors
// head → the Featured connectors not connected yet → the connect sheet → ticked for this agent.

const SUPABASE = connection();
const NEON = entry({ key: "neon", name: "Neon", publisher: "Neon", host: "mcp.neon.tech" });
const POSTHOG = entry({
  key: "posthog",
  name: "PostHog",
  publisher: "PostHog",
  category: "analytics",
  host: "mcp.posthog.com",
  auth: "api_key",
  key_fields: [{ id: "Authorization", label: "API key", hint: "", secret: true }],
  access_modes: ["read"],
  scope_picker: null,
});
const CATALOG = {
  items: [
    // Connected already, not available yet, and not Featured: none of them is offered.
    entry({ connection_id: "c1", connection_status: "connected" }),
    NEON,
    POSTHOG,
    entry({ key: "google-drive", name: "Google Drive", available: false }),
    entry({ key: "com.apify/apify", name: "Apify", featured: false, reviewed: false }),
  ],
  total: 5,
  next_offset: null,
  categories: ["databases", "analytics"],
};
const POSTHOG_ROW = connection({
  id: "c9",
  connector_key: "posthog",
  name: "PostHog",
  slug: "posthog",
  host: "mcp.posthog.com",
  auth_kind: "api_key",
  signin_host: null,
  access_modes: ["read"],
  scope: null,
  scope_picker: null,
});
const SAVED: ConnectorGrant[] = [{ id: "c1", access: "read" }];

beforeEach(() => __resetBackendStatusForTests());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const serve = (routes: Record<string, unknown> = {}) =>
  mockApi({
    "GET /api/connectors": { connections: [SUPABASE] },
    "GET /api/connectors/catalog": CATALOG,
    ...routes,
  });
const section = () => screen.getByRole("region", { name: /^Connectors/ });
const callout = () => section().querySelector(".dm-dlist__callout") as HTMLElement;
const connectButton = () => within(section()).getByRole("button", { name: "Connect an app" });
const picker = () => screen.findByRole("dialog", { name: "Connect an app for Reviewer" });

function checklist(
  value: ConnectorGrant[],
  over: Partial<Parameters<typeof ConnectorsChecklist>[0]> = {},
) {
  return (
    <ConnectorsChecklist
      value={value}
      saved={SAVED}
      onChange={() => {}}
      agentName="Reviewer"
      {...over}
    />
  );
}

/** Open the dialog once the agent's connections are listed. */
async function openPicker() {
  await within(section()).findByRole("checkbox", { name: /^Supabase/ });
  fireEvent.click(connectButton());
  return picker();
}

describe("Connect an app, from the agent's Connectors", () => {
  it("offers the Featured connectors that aren't connected yet, with how each connects", async () => {
    serve();
    render(checklist(SAVED));
    // Nothing to offer before the agent's own list is known.
    expect(connectButton()).toBeDisabled();
    const dialog = await openPicker();
    const rows = (await within(dialog).findAllByRole("listitem")).map((li) => li.textContent);
    expect(rows).toEqual(["NeNeonSign inConnect", "PhPostHogAPI keyConnect"]);
    expect(dialog).toHaveTextContent(
      "When you finish connecting, it’s ticked for Reviewer. Save the agent to keep it.",
    );

    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Search connectors" }), {
      target: { value: " post " },
    });
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["PhPostHogAPI keyConnect"]);
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "jira" } });
    expect(within(dialog).queryByRole("listitem")).toBeNull();
    expect(dialog).toHaveTextContent("No featured connector matches “jira”.");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Open Connectors goes to Browse, through the drawer when it gives the way", async () => {
    serve();
    const onBrowse = vi.fn();
    const { rerender } = render(checklist(SAVED));
    let link = within(await openPicker()).getByRole("link", { name: "Open Connectors" });
    expect(link).toHaveAttribute("href", "#/toolkit/connectors/browse");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    rerender(checklist(SAVED, { onBrowse }));
    fireEvent.click(connectButton());
    link = within(await picker()).getByRole("link", { name: "Open Connectors" });
    // Not followed on its own: the drawer asks about an unsaved draft first.
    expect(fireEvent.click(link)).toBe(false);
    expect(onBrowse).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says so when the catalog can't be loaded, and when everything Featured is connected", async () => {
    let reply: unknown = new Response(JSON.stringify({ detail: "boom" }), { status: 500 });
    serve({ "GET /api/connectors/catalog": () => reply });
    render(checklist(SAVED));
    const dialog = await openPicker();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn’t load the catalog.",
    );
    reply = { ...CATALOG, items: CATALOG.items.slice(0, 1) };
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    expect(
      await within(dialog).findByText("Every featured connector is already connected."),
    ).toBeInTheDocument();
  });

  it("picking one opens its connect sheet; once connected it is ticked, listed first as New, and the drawer says to save", async () => {
    const calls = serve({ "POST /api/connectors": POSTHOG_ROW });
    const onChange = vi.fn();
    const { rerender } = render(checklist(SAVED, { onChange }));
    const dialog = await openPicker();
    const row = (await within(dialog).findByText("PostHog")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Connect PostHog" }));

    // The picker hands over to the same sheet Browse opens.
    const sheet = screen.getByRole("dialog", { name: "Connect PostHog" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.change(within(sheet).getByLabelText("API key"), { target: { value: "phx_123" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Check and connect" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(calls.filter((c) => c.method === "POST")).toEqual([
      {
        method: "POST",
        path: "/api/connectors",
        body: { key: "posthog", access: "read", credentials: { Authorization: "phx_123" } },
      },
    ]);
    const ticked: ConnectorGrant[] = [...SAVED, { id: "c9", access: "read" }];
    expect(onChange).toHaveBeenLastCalledWith(ticked);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(checklist(ticked, { onChange }));
    const boxes = within(section()).getAllByRole<HTMLInputElement>("checkbox");
    expect(boxes.map((b) => [b.closest(".nd-conn__row")?.textContent, b.checked])).toEqual([
      ["PostHogRead onlyNew", true],
      ["SupabaseRead only · project trade-mcp-prod · ap-southeast-1", true],
    ]);
    expect(within(section()).getByRole("heading", { name: /^Connectors\s*2/ })).toBeTruthy();
    expect(within(section()).getByRole("status")).toHaveTextContent(
      /^PostHog is connected and ticked for Reviewer\. Save to keep it\.$/,
    );
    expect(callout()).toHaveClass("nd-conn__callout--ok");

    // Saved: it is one of the agent's connectors like any other.
    rerender(checklist(ticked, { onChange, saved: ticked }));
    expect(section()).not.toHaveTextContent("Save to keep it");
    expect(section()).not.toHaveTextContent("New");
    expect(section()).toHaveTextContent(
      "During a run it can call the read tools of what’s ticked.",
    );
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("closing the sheet before it connects changes nothing", async () => {
    serve();
    const onChange = vi.fn();
    render(checklist(SAVED, { onChange }));
    const dialog = await openPicker();
    const row = (await within(dialog).findByText("Neon")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Connect Neon" }));
    const sheet = screen.getByRole("dialog", { name: "Connect Neon" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(section()).toHaveTextContent(
      "During a run it can call the read tools of what’s ticked.",
    );
  });

  it("an agent on a plan, and the run view's read-only copy, can't connect from here", async () => {
    serve();
    const { unmount } = render(checklist(SAVED, { plan: "Claude" }));
    await within(section()).findByRole("checkbox", { name: /^Supabase/ });
    expect(connectButton()).toBeDisabled();
    unmount();
    render(<fieldset disabled>{checklist(SAVED)}</fieldset>);
    await within(section()).findByRole("checkbox", { name: /^Supabase/ });
    expect(connectButton()).toBeDisabled();
  });
});
