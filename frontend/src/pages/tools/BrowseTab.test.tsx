/**
 * Toolkit › Tools › Browse (Toolkit-ToolsBrowse, TkF-Catalog-1..4, TOOL-21..29, TOOL-69): the
 * catalog cards, Add from the catalog and its "Choose agents" toast, and the GitHub App card with
 * its install dialog and the return detection (website: focus; Desktop: after the reload).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ServerConfig } from "../../lib/api/tools";
import { refreshBadges } from "../../lib/workspaceStatus";
import { BrowseTab } from "./BrowseTab";
import { ToolsPage } from "./ToolsPage";
import { BEFORE_KEY, RETURN_KEY, useGithubReturn } from "./githubReturn";
import {
  FETCH,
  GITHUB,
  LINEAR,
  mockApi,
  renderWithProviders,
  resetToolkitStores,
} from "./toolsTestUtils";

vi.mock("../../lib/workspaceStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/workspaceStatus")>()),
  refreshBadges: vi.fn(async () => {}),
}));

const INSTALL_URL = "https://github.com/login/oauth/authorize?client_id=abc";
const MANAGE_URL = "https://github.com/apps/tvashtr/installations/new";

const entry = (key: string, extra: Record<string, unknown>) => ({
  key,
  name: key,
  title: key,
  description: "",
  access: "free",
  secret_names: [],
  badge: "",
  attachable: true,
  server_config: {},
  ...extra,
});
const WEB_FETCH = entry("fetch", {
  title: "Web fetch",
  description: "Fetch web pages over HTTP. Runs locally with uvx mcp-server-fetch.",
  badge: "Free · no login",
  server_config: { command: "uvx", args: ["mcp-server-fetch"] },
});
const REMOTE_GITHUB = entry("github", {
  title: "GitHub",
  description: "GitHub's remote MCP server: issues, pull requests and code.",
  access: "needs_secret",
  badge: "Needs GITHUB_TOKEN",
  secret_names: ["GITHUB_TOKEN"],
});
const GITHUB_APP = entry("github-app", {
  title: "GitHub App repos",
  description:
    "Hosted runs use your Tvashtr GitHub App installation. Install the App, then launch against an App repo.",
  access: "needs_github_app",
  badge: "Needs GitHub App",
  attachable: false,
});

const status = (installed: boolean, repo_count = 0, hosted = true) => ({
  hosted,
  installed,
  installation_count: installed ? 1 : 0,
  repo_count,
});

/** A fake server: the tool list follows POST /api/tool-library; the GitHub status is switchable. */
function serve({
  tools = [FETCH, GITHUB, LINEAR],
  catalog = [WEB_FETCH, REMOTE_GITHUB, GITHUB_APP],
  github = status(false),
  overrides = {},
}: {
  tools?: (typeof FETCH)[];
  catalog?: unknown[];
  github?: ReturnType<typeof status>;
  overrides?: Record<string, unknown>;
} = {}) {
  let list = [...tools];
  const gh = { now: github };
  const calls = mockApi({
    "GET /api/tool-library": () => ({ tools: list }),
    "GET /api/tool-catalog": { tools: catalog },
    "GET /api/github/status": () => gh.now,
    "GET /api/config": {
      hosted_mode: true,
      github_install_url: INSTALL_URL,
      github_manage_url: MANAGE_URL,
    },
    "GET /api/agents": { teams: [] },
    "POST /api/tool-library": (_u: URL, body: unknown) => {
      const { name, server_config } = body as { name: string; server_config: ServerConfig };
      const created = { ...FETCH, id: `tool-${name}-new`, name, server_config };
      list = [...list, created];
      return created;
    },
    ...overrides,
  });
  return { calls, gh };
}

const card = (title: string) => screen.getByRole("article", { name: title });
/** Each card's title, in page order (the article is labelled by it). */
const cardTitles = () =>
  screen
    .getAllByRole("article")
    .map((a) => document.getElementById(a.getAttribute("aria-labelledby") ?? "")?.textContent);

beforeEach(() => resetToolkitStores());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(refreshBadges).mockClear();
  delete document.documentElement.dataset.tvashtrDesktop;
  sessionStorage.clear();
  resetToolkitStores();
});

describe("Browse catalog", () => {
  it("shows the catalog in API order, then Custom server and Paste mcp.json", async () => {
    serve();
    renderWithProviders(<ToolsPage view="browse" />);
    await screen.findByRole("article", { name: "GitHub App repos" });
    expect(cardTitles()).toEqual([
      "Web fetch",
      "GitHub",
      "GitHub App repos",
      "Custom server",
      "Paste mcp.json",
    ]);

    expect(within(card("Web fetch")).getByText("Free · no login")).toHaveClass("ds-badge--success");
    expect(within(card("GitHub")).getByText("Needs GITHUB_TOKEN")).toHaveClass("ds-badge--neutral");
    expect(within(card("Custom server")).getByText("Any MCP server")).toBeInTheDocument();
    expect(
      within(card("Custom server")).getByText(
        "Connect any server: a local command (like uvx or npx) or a remote URL, with secrets as ${NAME}.",
      ),
    ).toBeInTheDocument();
    expect(within(card("Paste mcp.json")).getByText("Bulk")).toBeInTheDocument();
    expect(
      within(card("Paste mcp.json")).getByText(
        "Bring servers over from Claude, Cursor or VS Code. We check it and list what we found before adding.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a disabled “In your tools” when a tool of that name exists, else Add", async () => {
    serve({ tools: [FETCH] });
    renderWithProviders(<ToolsPage view="browse" />);
    await screen.findByRole("article", { name: "Web fetch" });
    await waitFor(() =>
      expect(
        within(card("Web fetch")).getByRole("button", { name: "In your tools" }),
      ).toBeDisabled(),
    );
    expect(within(card("GitHub")).getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("adds Web fetch, stays on Browse, and the toast's Choose agents opens the Turn-on dialog", async () => {
    const { calls } = serve({ tools: [GITHUB, LINEAR] });
    window.location.hash = "#/toolkit/tools/browse";
    renderWithProviders(<ToolsPage view="browse" />);
    await screen.findByRole("article", { name: "Web fetch" });
    const add = await waitFor(() => {
      const b = within(card("Web fetch")).getByRole("button", { name: "Add" });
      expect(b).toBeEnabled();
      return b;
    });
    fireEvent.click(add);

    const toast = await screen.findByText(
      "Web fetch added. Turn it on for an agent in its Skills & tools tab.",
    );
    expect(calls).toContainEqual({
      method: "POST",
      path: "/api/tool-library",
      body: { name: "fetch", server_config: { command: "uvx", args: ["mcp-server-fetch"] } },
    });
    expect(within(card("Web fetch")).getByRole("button", { name: "In your tools" })).toBeDisabled();
    expect(refreshBadges).toHaveBeenCalled();
    expect(window.location.hash).toBe("#/toolkit/tools/browse");

    fireEvent.click(
      within(toast.closest("[role=status]") as HTMLElement).getByRole("button", {
        name: "Choose agents",
      }),
    );
    await screen.findByRole("dialog", { name: "Turn on for agents" });
    await waitFor(() =>
      expect(calls.some((c) => c.path === "/api/agents?tool_id=tool-fetch-new")).toBe(true),
    );
  });

  it("a name clash reloads the list (the card turns to In your tools) and toasts the server's words", async () => {
    let tools = [GITHUB, LINEAR];
    serve({
      overrides: {
        "GET /api/tool-library": () => ({ tools }),
        "POST /api/tool-library": () => {
          tools = [FETCH, GITHUB, LINEAR];
          return new Response(JSON.stringify({ detail: "You already have a tool named fetch." }), {
            status: 409,
          });
        },
      },
    });
    renderWithProviders(<ToolsPage view="browse" />);
    await screen.findByRole("article", { name: "Web fetch" });
    const add = await waitFor(() => {
      const b = within(card("Web fetch")).getByRole("button", { name: "Add" });
      expect(b).toBeEnabled();
      return b;
    });
    fireEvent.click(add);
    expect(await screen.findByText("You already have a tool named fetch.")).toBeInTheDocument();
    expect(within(card("Web fetch")).getByRole("button", { name: "In your tools" })).toBeDisabled();
  });

  it("Set up and Paste hand over to the page's sheets", async () => {
    serve();
    const actions = { onAdd: vi.fn(async () => {}), onSetUp: vi.fn(), onPaste: vi.fn() };
    renderWithProviders(<BrowseTab tools={[]} actions={actions} />);
    fireEvent.click(
      within(await screen.findByRole("article", { name: "Custom server" })).getByRole("button", {
        name: "Set up",
      }),
    );
    fireEvent.click(within(card("Paste mcp.json")).getByRole("button", { name: "Paste" }));
    expect(actions.onSetUp).toHaveBeenCalledTimes(1);
    expect(actions.onPaste).toHaveBeenCalledTimes(1);
  });

  it("says so when the catalog can't be read, and still offers your own servers", async () => {
    serve({
      overrides: {
        "GET /api/tool-catalog": new Response(JSON.stringify({ detail: "boom" }), { status: 500 }),
      },
    });
    renderWithProviders(<ToolsPage view="browse" />);
    expect(await screen.findByText("Couldn’t load the catalog.")).toBeInTheDocument();
    expect(card("Custom server")).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Web fetch" })).not.toBeInTheDocument();
  });
});

describe("GitHub App card", () => {
  it("is hidden on a self-hosted backend", async () => {
    serve({ github: status(false, 0, false) });
    renderWithProviders(<ToolsPage view="browse" />);
    await screen.findByRole("article", { name: "Web fetch" });
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(4));
    expect(screen.queryByRole("article", { name: "GitHub App repos" })).not.toBeInTheDocument();
  });

  it("installs on the website: the dialog, Open GitHub in a new window, back on focus → toast", async () => {
    const open = vi.fn(() => null);
    vi.stubGlobal("open", open);
    const { gh } = serve();
    renderWithProviders(<ToolsPage view="browse" />);
    const app = await screen.findByRole("article", { name: "GitHub App repos" });
    expect(within(app).getByText("Needs GitHub App")).toHaveClass("ds-badge--warning");
    fireEvent.click(within(app).getByRole("button", { name: "Install GitHub App" }));

    const dialog = screen.getByRole("alertdialog", { name: "Install the Tvashtr GitHub App" });
    expect(
      within(dialog).getByText(
        "GitHub opens in a new window. Pick the repos Tvashtr can use, then come back here. Hosted runs can only open pull requests on those repos.",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Open GitHub" })).toBeEnabled(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Open GitHub" }));
    expect(open).toHaveBeenCalledWith(INSTALL_URL, "_blank", "noopener");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // The website keeps this page: nothing to restore on a later boot.
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();

    gh.now = status(true, 2);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText("GitHub App installed on 2 repos.")).toBeInTheDocument();
    const after = card("GitHub App repos");
    expect(within(after).getByText("App installed")).toHaveClass("ds-badge--success");
    expect(within(after).getByRole("button", { name: "Choose repos" })).toBeInTheDocument();
  });

  it("doesn't re-read on focus before the user went to GitHub, nor toast without a change", async () => {
    const { calls, gh } = serve();
    renderWithProviders(<ToolsPage view="browse" />);
    await screen.findByRole("article", { name: "GitHub App repos" });
    const reads = () => calls.filter((c) => c.path === "/api/github/status").length;
    const before = reads();
    gh.now = status(true, 2);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(reads()).toBe(before);

    vi.stubGlobal("open", vi.fn());
    gh.now = status(false);
    fireEvent.click(
      within(card("GitHub App repos")).getByRole("button", { name: "Install GitHub App" }),
    );
    const dialog = screen.getByRole("alertdialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Open GitHub" })).toBeEnabled(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Open GitHub" }));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(reads()).toBe(before + 1));
    expect(screen.queryByText(/GitHub App installed on/)).not.toBeInTheDocument();
  });

  it("Choose repos opens the add-repositories page; a changed repo count toasts (1 repo)", async () => {
    const open = vi.fn(() => null);
    vi.stubGlobal("open", open);
    const { gh } = serve({ github: status(true, 2) });
    renderWithProviders(<ToolsPage view="browse" />);
    const app = await screen.findByRole("article", { name: "GitHub App repos" });
    const choose = within(app).getByRole("button", { name: "Choose repos" });
    await waitFor(() => expect(choose).toBeEnabled());
    fireEvent.click(choose);
    expect(open).toHaveBeenCalledWith(MANAGE_URL, "_blank", "noopener");

    gh.now = status(true, 1);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByText("GitHub App installed on 1 repo.")).toBeInTheDocument();
  });

  it("on Desktop, doesn't promise a new window and remembers where to come back to", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    const open = vi.fn(() => null);
    vi.stubGlobal("open", open);
    serve();
    renderWithProviders(<ToolsPage view="browse" />);
    const app = await screen.findByRole("article", { name: "GitHub App repos" });
    fireEvent.click(within(app).getByRole("button", { name: "Install GitHub App" }));
    const dialog = screen.getByRole("alertdialog", { name: "Install the Tvashtr GitHub App" });
    expect(dialog).not.toHaveTextContent("new window");
    expect(dialog).toHaveTextContent(
      "GitHub opens in this window. Pick the repos Tvashtr can use, and you’ll come back to this page.",
    );
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Open GitHub" })).toBeEnabled(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Open GitHub" }));
    expect(open).toHaveBeenCalledWith(INSTALL_URL, "_blank", "noopener");
    expect(sessionStorage.getItem(RETURN_KEY)).toBe("#/toolkit/tools/browse");
    expect(JSON.parse(sessionStorage.getItem(BEFORE_KEY) ?? "null")).toEqual({
      installed: false,
      repo_count: 0,
    });
  });

  it("on Desktop, back after the reload: returns to Browse and toasts from what it saw before", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    sessionStorage.setItem(RETURN_KEY, "#/toolkit/tools/browse");
    sessionStorage.setItem(BEFORE_KEY, JSON.stringify({ installed: false, repo_count: 0 }));
    serve({ github: status(true, 2) });
    window.location.hash = "";

    function Boot() {
      useGithubReturn();
      return null;
    }
    render(<Boot />);
    expect(window.location.hash).toBe("#/toolkit/tools/browse");
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();

    renderWithProviders(<ToolsPage view="browse" />);
    expect(await screen.findByText("GitHub App installed on 2 repos.")).toBeInTheDocument();
    expect(sessionStorage.getItem(BEFORE_KEY)).toBeNull();
  });
});
