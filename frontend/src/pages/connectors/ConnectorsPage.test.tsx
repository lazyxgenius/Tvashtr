/**
 * Toolkit › Connectors (Page-Connected-tab, Page-Browse-tab-*, Page-First-time-lands-on-Browse,
 * CnF-Expired-1): the tabs and their counts, the Connected table, the "sign-in expired" banner,
 * and Browse (Featured, From the MCP Registry, search, categories, Show more, Coming soon, Custom).
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogEntry, Connection } from "../../lib/api/connectors";
import { refreshBadges } from "../../lib/workspaceStatus";
import { mockApi, renderWithProviders, resetToolkitStores } from "../tools/toolsTestUtils";
import { ConnectorsPage } from "./ConnectorsPage";
import { connection, entry } from "./connectorsTestUtils";

vi.mock("../../lib/workspaceStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/workspaceStatus")>()),
  refreshBadges: vi.fn(async () => {}),
}));

function fakePopup() {
  return { location: { href: "about:blank" }, opener: window as unknown, close: vi.fn() };
}
let popup: ReturnType<typeof fakePopup>;

beforeEach(() => {
  resetToolkitStores();
  window.location.hash = "#/toolkit/connectors";
  popup = fakePopup();
  vi.stubGlobal(
    "open",
    vi.fn(() => popup),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete document.documentElement.dataset.tvashtrDesktop;
  vi.unstubAllGlobals();
  vi.mocked(refreshBadges).mockClear();
  resetToolkitStores();
});

const plain = { scope: null, scope_picker: null, read_only_by: "annotations" as const };
const SUPABASE = connection();
const NOTION = connection({
  ...plain,
  id: "c2",
  connector_key: "notion",
  name: "Notion",
  slug: "notion",
  publisher: "Notion",
  host: "mcp.notion.com",
  used_by: { agent_count: 1, team_count: 1 },
});
const LINEAR = connection({
  ...plain,
  id: "c3",
  connector_key: "linear",
  name: "Linear",
  slug: "linear",
  publisher: "Linear",
  host: "mcp.linear.app",
  access: "write",
  used_by: { agent_count: 1, team_count: 1 },
});
const POSTHOG = connection({
  ...plain,
  id: "c4",
  connector_key: "posthog",
  name: "PostHog",
  slug: "posthog",
  publisher: "PostHog",
  host: "mcp.posthog.com",
  used_by: { agent_count: 0, team_count: 0 },
});
const SENTRY = connection({
  ...plain,
  id: "c5",
  connector_key: "sentry",
  name: "Sentry",
  slug: "sentry",
  publisher: "Sentry",
  host: "mcp.sentry.dev",
  status: "needs_signin",
  last_error: "Its sign-in expired.",
  used_by: { agent_count: 1, team_count: 1 },
  used_by_agents: [
    {
      node_id: "n-rev",
      role_name: "reviewer",
      title: null,
      team_id: "t1",
      team_name: "Indicator sprint team",
      access: "read",
    },
  ],
});

const FEATURED: CatalogEntry[] = [
  entry({ connection_id: "c1", connection_status: "connected" }),
  entry({
    key: "neon",
    name: "Neon",
    publisher: "Neon",
    description: "Read schemas and run queries on one Neon project.",
    host: "mcp.neon.tech",
  }),
  entry({
    key: "google-drive",
    name: "Google Drive",
    publisher: "Google",
    category: "docs",
    description: "Search and read files in your Drive.",
    host: "drivemcp.googleapis.com",
    scope_picker: null,
    available: false,
    unavailable_reason: "coming_soon",
  }),
];
const registry = (key: string, name: string, host: string, over: Partial<CatalogEntry> = {}) =>
  entry({
    key,
    name,
    publisher: null,
    featured: false,
    reviewed: false,
    category: null,
    description: `${name} tools.`,
    website: null,
    host,
    auth: "unknown",
    read_only_by: "annotations",
    scope_picker: null,
    ...over,
  });
const APIFY = registry("com.apify/apify-mcp-server", "Apify", "mcp.apify.com", {
  auth: "api_key",
  description: "Run web scrapers and read their results.",
  key_fields: [{ id: "Authorization", label: "API key", hint: "Apify API token", secret: true }],
});
const STRIPE = registry("com.stripe/mcp", "Stripe", "mcp.stripe.com");
const ZAPIER = registry("com.zapier/mcp", "Zapier", "mcp.zapier.com");
const CATEGORIES = ["databases", "docs", "analytics", "crm", "work"];

/** A fake catalog: the first page, a second page at offset 48, and a search for "apify". */
function catalog(url: URL) {
  const q = url.searchParams.get("q");
  const category = url.searchParams.get("category");
  if (q === "apify") {
    return { items: [APIFY], total: 1, next_offset: null, categories: CATEGORIES };
  }
  if (category === "docs") {
    return { items: [FEATURED[2]], total: 1, next_offset: null, categories: CATEGORIES };
  }
  if (url.searchParams.get("offset") === "48") {
    return { items: [ZAPIER], total: 15039, next_offset: null, categories: CATEGORIES };
  }
  return {
    items: [...FEATURED, APIFY, STRIPE],
    total: 15039,
    next_offset: 48,
    categories: CATEGORIES,
  };
}

/** `connections` as the page shows them, newest first: the API answers oldest first. */
function serve(connections: Connection[]) {
  return mockApi({
    "GET /api/connectors": { connections: [...connections].reverse() },
    "GET /api/connectors/catalog": catalog,
  });
}

const catalogCalls = (calls: { path: string }[]) =>
  calls.map((c) => c.path).filter((p) => p.startsWith("/api/connectors/catalog"));

describe("Connected", () => {
  it("lists the connections with their access, status and who uses them", async () => {
    serve([SUPABASE, NOTION, LINEAR, POSTHOG]);
    renderWithProviders(<ConnectorsPage view="connected" />);

    expect(screen.getByRole("heading", { level: 1, name: "Connectors" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Custom connector" })).toBeInTheDocument();
    const rows = await screen.findAllByRole("row");
    expect(rows[0]).toHaveTextContent("ConnectorAccessStatusUsed byActions");
    expect(rows.slice(1).map((r) => r.textContent)).toEqual([
      "SbSupabaseProject trade-mcp-prodRead onlyReady2 agents · 1 team",
      "NoNotionBy NotionRead onlyReady1 agent · 1 team",
      "LiLinearBy LinearRead & writeReady1 agent · 1 team",
      "PhPostHogBy PostHogRead onlyReadyNot used yet · Give an agent access",
    ]);
    expect(screen.getByRole("tab", { name: "Connected 4" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Browse" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Supabase" })).toHaveAttribute(
      "href",
      "#/toolkit/connectors/c1",
    );
    expect(
      screen.getByText(/Connecting doesn’t give any agent access\. You turn a connector on/),
    ).toHaveTextContent(
      "Connecting doesn’t give any agent access. You turn a connector on per agent in its Skills & tools tab, and it starts read-only. Agents never hold your sign-in: their calls go through Tvashtr, which adds it.",
    );
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Browse" }));
    expect(window.location.hash).toBe("#/toolkit/connectors/browse");
  });

  it("puts the newest connection first", async () => {
    mockApi({ "GET /api/connectors": { connections: [POSTHOG, NOTION, SUPABASE] } });
    renderWithProviders(<ConnectorsPage view="connected" />);
    const rows = await screen.findAllByRole("row");
    expect(rows.slice(1).map((r) => within(r).getByRole("link").textContent)).toEqual([
      "Supabase",
      "Notion",
      "PostHog",
    ]);
  });

  it("marks a connection Tvashtr hasn’t reviewed, and shows its address", async () => {
    serve([
      connection({
        ...plain,
        id: "c9",
        connector_key: APIFY.key,
        name: "Apify",
        slug: "apify",
        publisher: "Apify",
        featured: false,
        reviewed: false,
        host: "mcp.apify.com",
        auth_kind: "api_key",
        used_by: { agent_count: 0, team_count: 0 },
      }),
      SUPABASE,
    ]);
    renderWithProviders(<ConnectorsPage view="connected" />);
    const rows = await screen.findAllByRole("row");
    expect(rows[1]).toHaveTextContent(
      "ApApifyNot reviewedmcp.apify.comRead onlyReadyNot used yet · Give an agent access",
    );
    expect(rows[2]).not.toHaveTextContent("Not reviewed");
  });

  it("says a connector with projects covers the whole account until one is picked", async () => {
    serve([connection({ scope: null })]);
    renderWithProviders(<ConnectorsPage view="connected" />);
    const rows = await screen.findAllByRole("row");
    expect(rows[1]).toHaveTextContent("SbSupabaseThe whole accountRead onlyReady");
  });

  it("says whose sign-in expired and which agents run without it", async () => {
    serve([SENTRY, SUPABASE]);
    renderWithProviders(<ConnectorsPage view="connected" />);

    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent(
      "Sentry’s sign-in expired. Reviewer runs without it until you sign in again.",
    );
    expect(within(banner).getByRole("button", { name: "Sign in to Sentry" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Sentry/ });
    expect(row).toHaveTextContent("Sign in again");
    expect(within(row).getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Supabase/ })).toHaveTextContent("Ready");
  });

  it("filters the table by the search words and the Status select", async () => {
    serve([SENTRY, SUPABASE, NOTION]);
    renderWithProviders(<ConnectorsPage view="connected" />);
    await screen.findByRole("row", { name: /Notion/ });

    fireEvent.change(screen.getByRole("textbox", { name: "Search connectors" }), {
      target: { value: "supa" },
    });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("row", { name: /Supabase/ })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search connectors" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No connectors match “zzz”")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search connectors" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(screen.getByRole("option", { name: "Needs attention" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("row", { name: /Sentry/ })).toBeInTheDocument();
  });

  it("offers Open, Change project and Disconnect in a row’s menu", async () => {
    serve([SUPABASE, NOTION]);
    renderWithProviders(<ConnectorsPage view="connected" />);

    fireEvent.click(await screen.findByRole("button", { name: "More actions for Supabase" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Open",
      "Change project",
      "Disconnect",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    expect(window.location.hash).toBe("#/toolkit/connectors/c1");

    // No project to pick on a connector without a scope picker.
    fireEvent.click(screen.getByRole("button", { name: "More actions for Notion" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Open",
      "Disconnect",
    ]);
  });

  it("says the list couldn’t load, and retries", async () => {
    let fail = true;
    mockApi({
      "GET /api/connectors": () =>
        fail
          ? new Response(JSON.stringify({ detail: "boom" }), { status: 500 })
          : { connections: [SUPABASE] },
      "GET /api/connectors/catalog": catalog,
    });
    renderWithProviders(<ConnectorsPage view="connected" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load your connectors.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("row", { name: /Supabase/ })).toBeInTheDocument();
  });
});

describe("the first visit", () => {
  it("lands on Browse when nothing is connected", async () => {
    serve([]);
    renderWithProviders(<ConnectorsPage view="connected" />);
    await waitFor(() => expect(window.location.hash).toBe("#/toolkit/connectors/browse"));
  });

  it("stays on Connected when something is", async () => {
    serve([SUPABASE]);
    renderWithProviders(<ConnectorsPage view="connected" />);
    await screen.findByRole("row", { name: /Supabase/ });
    expect(window.location.hash).toBe("#/toolkit/connectors");
  });

  it("explains connectors on Browse until the first one is connected", async () => {
    serve([]);
    renderWithProviders(<ConnectorsPage view="browse" />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Connect the apps your agents should read. Nothing is shared with an agent until you turn a connector on for it, and every connector starts read-only.",
    );
    // No count on an empty Connected tab.
    expect(screen.getByRole("tab", { name: "Connected" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Browse" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Browse", () => {
  it("shows Featured cards, the Custom card and the registry list", async () => {
    serve([SUPABASE]);
    renderWithProviders(<ConnectorsPage view="browse" />);

    const featured = await screen.findByRole("region", { name: "Featured" });
    expect(featured).toHaveTextContent("FeaturedChecked by Tvashtr");
    const cards = within(featured).getAllByRole("article");
    expect(cards.map((c) => c.textContent)).toEqual([
      "SbSupabaseBy SupabaseSign inRead tables, run read-only SQL and check logs in one project.ConnectedOpen",
      "NeNeonBy NeonSign inRead schemas and run queries on one Neon project.Connect",
      "DrGoogle DriveBy GoogleSearch and read files in your Drive.Coming soon",
      "Custom connectorAny server that signs inPaste the address of any remote MCP server that signs in with OAuth.Add custom",
    ]);
    // A "Coming soon" card can't be connected.
    expect(within(cards[2]).queryByRole("button")).toBeNull();
    expect(within(cards[1]).getByRole("button", { name: "Connect" })).toBeInTheDocument();
    fireEvent.click(within(cards[0]).getByRole("button", { name: "Open" }));
    expect(window.location.hash).toBe("#/toolkit/connectors/c1");

    const reg = screen.getByRole("region", { name: "From the MCP Registry" });
    expect(reg).toHaveTextContent(
      "From the MCP Registry15,036 servers · listed by their makers · not reviewed by Tvashtr",
    );
    expect(
      within(reg)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "ApApifycom.apify/apify-mcp-serverRun web scrapers and read their results. · mcp.apify.comAPI keyConnect",
      "StStripecom.stripe/mcpStripe tools. · mcp.stripe.comConnect",
    ]);
    expect(screen.getByRole("textbox", { name: "Search connectors" })).toHaveAttribute(
      "placeholder",
      "Search 15,000+ connectors",
    );
    // Somebody with a connection doesn't get the first-time explainer.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("searches the whole catalog with q=", async () => {
    const calls = serve([SUPABASE]);
    renderWithProviders(<ConnectorsPage view="browse" />);
    await screen.findByRole("region", { name: "Featured" });

    fireEvent.change(screen.getByRole("textbox", { name: "Search connectors" }), {
      target: { value: " apify " },
    });
    await waitFor(() =>
      expect(catalogCalls(calls)).toEqual([
        "/api/connectors/catalog",
        "/api/connectors/catalog?q=apify",
      ]),
    );
    expect(await screen.findByText("No featured connector matches “apify”.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Featured" })).toBeNull();
    const reg = screen.getByRole("region", { name: "From the MCP Registry" });
    expect(reg).toHaveTextContent("1 result · listed by their makers · not reviewed by Tvashtr");
    expect(within(reg).getAllByRole("listitem")).toHaveLength(1);
  });

  it("filters Featured by category", async () => {
    const calls = serve([SUPABASE]);
    renderWithProviders(<ConnectorsPage view="browse" />);
    await screen.findByRole("region", { name: "Featured" });

    const chips = within(screen.getByRole("group", { name: "Category" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual([
      "All",
      "Databases",
      "Docs & files",
      "Analytics",
      "CRM & support",
      "Work tracking",
    ]);
    expect(chips[0]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chips[2]);
    await waitFor(() =>
      expect(catalogCalls(calls)).toEqual([
        "/api/connectors/catalog",
        "/api/connectors/catalog?category=docs",
      ]),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Featured" })).getAllByRole("article"),
      ).toHaveLength(2),
    );
    expect(screen.getByRole("button", { name: "Docs & files" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Registry servers have no category.
    expect(screen.queryByRole("region", { name: "From the MCP Registry" })).toBeNull();
  });

  it("loads the next page from next_offset with Show more", async () => {
    const calls = serve([SUPABASE]);
    renderWithProviders(<ConnectorsPage view="browse" />);
    const reg = await screen.findByRole("region", { name: "From the MCP Registry" });
    expect(within(reg).getAllByRole("listitem")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(within(reg).getAllByRole("listitem")).toHaveLength(3));
    expect(catalogCalls(calls)).toEqual([
      "/api/connectors/catalog",
      "/api/connectors/catalog?offset=48",
    ]);
    expect(within(reg).getAllByRole("listitem")[2]).toHaveTextContent("Zapier");
    // The last page: nothing more to show.
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("says the catalog couldn’t load, and retries", async () => {
    let fail = true;
    mockApi({
      "GET /api/connectors": { connections: [SUPABASE] },
      "GET /api/connectors/catalog": (url: URL) =>
        fail ? new Response(JSON.stringify({ detail: "boom" }), { status: 500 }) : catalog(url),
    });
    renderWithProviders(<ConnectorsPage view="browse" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load the catalog.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("region", { name: "Featured" })).toBeInTheDocument();
  });
});

describe("connecting", () => {
  const APIFY_ROW = connection({
    ...plain,
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
    signin_host: null,
    used_by: { agent_count: 0, team_count: 0 },
  });

  /** Connect Apify with a key from Browse; the list then holds it. */
  async function connectApify() {
    let connections = [SUPABASE];
    const calls = mockApi({
      "GET /api/connectors": () => ({ connections }),
      "GET /api/connectors/catalog": catalog,
      "POST /api/connectors": () => {
        connections = [SUPABASE, APIFY_ROW];
        return APIFY_ROW;
      },
    });
    const view = renderWithProviders(<ConnectorsPage view="browse" />);
    const reg = await screen.findByRole("region", { name: "From the MCP Registry" });
    const row = within(reg).getAllByRole("listitem")[0];
    fireEvent.click(within(row).getByRole("button", { name: "Connect" }));
    const sheet = screen.getByRole("dialog", { name: "Connect Apify" });
    fireEvent.change(within(sheet).getByLabelText("API key"), { target: { value: "k" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Check and connect" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    return { calls, view, row };
  }

  it("connects from Browse, lands on Connected and says no agent has it yet", async () => {
    const { view, row } = await connectApify();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Apify is connected. No agent can use it until you turn it on.Give an agent access",
    );
    expect(window.location.hash).toBe("#/toolkit/connectors");
    expect(refreshBadges).toHaveBeenCalled();
    // Browse shows it as connected without asking the catalog again.
    await waitFor(() => expect(row).toHaveTextContent("ConnectedOpen"));

    view.rerender(<ConnectorsPage view="connected" />);
    expect(screen.getByRole("tab", { name: "Connected 2" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Apify/ })).toHaveTextContent("ReadyNew");
    expect(screen.getByRole("row", { name: /Supabase/ })).not.toHaveTextContent("New");
  });

  it("says on Desktop that the connection works from both", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    await connectApify();
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(
      "Apify is connected. It works for runs from the website and from Desktop.",
    );
    expect(within(toast).queryByRole("button")).toBeNull();
  });

  it("opens the custom sheet from the header and from the Custom card", async () => {
    serve([SUPABASE]);
    renderWithProviders(<ConnectorsPage view="browse" />);
    fireEvent.click(screen.getByRole("button", { name: "Custom connector" }));
    const sheet = screen.getByRole("dialog", { name: "Custom connector" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Add custom" }));
    expect(screen.getByRole("dialog", { name: "Custom connector" })).toBeInTheDocument();
  });

  it("signs in again from the banner: the window opens with the click", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let connections = [SENTRY, SUPABASE];
    let signedIn = false;
    const calls = mockApi({
      "GET /api/connectors": () => ({ connections }),
      "GET /api/connectors/catalog": catalog,
      "POST /api/connectors/c5/oauth/start": {
        authorize_url: "https://sentry.io/oauth/authorize?state=s",
        signin_host: "sentry.io",
        expires_in: 600,
      },
      "GET /api/connectors/c5": () => ({
        ...(signedIn ? { ...SENTRY, status: "connected", last_error: null } : SENTRY),
        signin_pending: !signedIn,
        used_by_agents: [],
        recent_use: [],
        revoke_hint: null,
      }),
    });
    renderWithProviders(<ConnectorsPage view="connected" />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in to Sentry" }));
    expect(window.open).toHaveBeenCalledExactlyOnceWith(
      "",
      "tv-connect",
      "popup,width=520,height=720",
    );
    expect(screen.getByRole("dialog", { name: "Sign in to Sentry" })).toBeInTheDocument();
    await screen.findByText("Waiting for you to finish in the Sentry window");
    expect(popup.location.href).toBe("https://sentry.io/oauth/authorize?state=s");

    signedIn = true;
    connections = [{ ...SENTRY, status: "connected", last_error: null }, SUPABASE];
    await act(async () => void (await vi.advanceTimersByTimeAsync(2000)));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Sentry is ready again.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("row", { name: /Sentry/ })).toHaveTextContent("Ready"),
    );
    expect(screen.queryByRole("button", { name: "Sign in to Sentry" })).toBeNull();
    expect(refreshBadges).toHaveBeenCalled();
    expect(calls.filter((c) => c.path === "/api/connectors")).toHaveLength(2);
  });

  it("changes the project from a row’s menu", async () => {
    const STAGING = { value: "efgh5678", label: "trade-mcp-staging · ap-southeast-1" };
    let connections = [SUPABASE];
    mockApi({
      "GET /api/connectors": () => ({ connections }),
      "GET /api/connectors/c1/scope-options": {
        param: "project_ref",
        label: "Project",
        manual: false,
        options: [
          { value: "abcd1234", label: "trade-mcp-prod", detail: "ap-southeast-1" },
          { value: "efgh5678", label: "trade-mcp-staging", detail: "ap-southeast-1" },
        ],
      },
      "PATCH /api/connectors/c1": () => {
        connections = [{ ...SUPABASE, scope: STAGING }];
        return connections[0];
      },
    });
    renderWithProviders(<ConnectorsPage view="connected" />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for Supabase" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Change project" }));
    const sheet = screen.getByRole("dialog", { name: "Change project" });
    fireEvent.click((await within(sheet).findAllByRole("radio"))[1]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Supabase now uses trade-mcp-staging.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("row", { name: /Supabase/ })).toHaveTextContent(
        "Project trade-mcp-staging",
      ),
    );
  });

  it("reads the list again when a sheet is closed (a sign-in may have finished)", async () => {
    const calls = serve([SUPABASE]);
    renderWithProviders(<ConnectorsPage view="connected" />);
    await screen.findByRole("row", { name: /Supabase/ });
    fireEvent.click(screen.getByRole("button", { name: "Custom connector" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/connectors")).toHaveLength(2));
  });
});

describe("agents and disconnecting", () => {
  const TEAMS = {
    teams: [
      {
        team_id: "t1",
        team_name: "Indicator sprint team",
        agents: [
          {
            node_id: "n-eng",
            role_name: "engineer",
            title: null,
            kind: "agent",
            edits_allowed: true,
            enabled: false,
            access: null,
            subscription: null,
          },
        ],
      },
    ],
  };
  const SAVED = {
    agents: [
      {
        node_id: "n-eng",
        role_name: "engineer",
        title: null,
        team_id: "t1",
        team_name: "Indicator sprint team",
        access: "read",
      },
    ],
    agent_count: 1,
    team_count: 1,
  };

  it("gives an agent access from a row nobody uses yet", async () => {
    let connections = [SUPABASE, POSTHOG];
    const calls = mockApi({
      "GET /api/connectors": () => ({ connections }),
      "GET /api/connectors/c4/agents": TEAMS,
      "PUT /api/connectors/c4/agents": () => {
        connections = [SUPABASE, { ...POSTHOG, used_by: { agent_count: 1, team_count: 1 } }];
        return SAVED;
      },
    });
    renderWithProviders(<ConnectorsPage view="connected" />);
    const row = await screen.findByRole("row", { name: /PostHog/ });
    fireEvent.click(within(row).getByRole("button", { name: "Give an agent access" }));
    const dialog = screen.getByRole("dialog", { name: "Give agents access to PostHog" });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "Engineer" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Engineer can now use PostHog (read only)."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("row", { name: /PostHog/ })).toHaveTextContent("1 agent · 1 team"),
    );
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ node_ids: ["n-eng"] });
    expect(refreshBadges).toHaveBeenCalled();
  });

  it("disconnects from a row’s menu, naming who loses access", async () => {
    let connections = [SUPABASE, NOTION];
    const calls = mockApi({
      "GET /api/connectors": () => ({ connections }),
      "GET /api/connectors/c1": {
        ...SUPABASE,
        used_by_agents: [{ ...SAVED.agents[0] }],
        recent_use: [],
        revoke_hint: "To remove Tvashtr on Supabase’s side too, revoke it in Supabase’s settings.",
      },
      "DELETE /api/connectors/c1": () => {
        connections = [NOTION];
        return { removed_from_agents: 1, revoked: true };
      },
    });
    renderWithProviders(<ConnectorsPage view="connected" />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for Supabase" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Disconnect Supabase?" });
    expect(dialog).toHaveTextContent(
      "Engineer in Indicator sprint team uses it. It loses access now, and a run that’s going finishes without it. Tvashtr deletes its copy of your sign-in. To remove Tvashtr on Supabase’s side too, revoke it in Supabase’s settings.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    expect(
      await screen.findByText("Supabase is disconnected. It’s back in Browse if you need it."),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("row", { name: /Supabase/ })).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("tab", { name: "Connected 1" })).toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    expect(refreshBadges).toHaveBeenCalled();
  });

  it("opens Give access from the toast of a fresh connection", async () => {
    const KEYED = connection({
      ...plain,
      id: "c9",
      connector_key: APIFY.key,
      name: "Apify",
      auth_kind: "api_key",
      used_by: { agent_count: 0, team_count: 0 },
    });
    let connections = [SUPABASE];
    mockApi({
      "GET /api/connectors": () => ({ connections }),
      "GET /api/connectors/catalog": catalog,
      "GET /api/connectors/c9/agents": TEAMS,
      "POST /api/connectors": () => {
        connections = [SUPABASE, KEYED];
        return KEYED;
      },
    });
    renderWithProviders(<ConnectorsPage view="browse" />);
    const reg = await screen.findByRole("region", { name: "From the MCP Registry" });
    fireEvent.click(
      within(within(reg).getAllByRole("listitem")[0]).getByRole("button", { name: "Connect" }),
    );
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "k" } });
    fireEvent.click(screen.getByRole("button", { name: "Check and connect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Give an agent access" }));
    expect(screen.getByRole("dialog", { name: "Give agents access to Apify" })).toBeInTheDocument();
  });
});
