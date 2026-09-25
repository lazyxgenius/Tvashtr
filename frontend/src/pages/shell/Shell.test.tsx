import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import type { Route } from "../../lib/nav";
import { __resetGetStartedForTests, setFirstTime } from "../home/getStarted";
import { type NavBadges, Shell } from "./Shell";

function renderShell(
  route: Route,
  badges: NavBadges = {},
  extra: Partial<Parameters<typeof Shell>[0]> = {},
) {
  const onNavigate = vi.fn();
  const onOpenSearch = vi.fn();
  const onShowShortcuts = vi.fn();
  const onLogout = vi.fn();
  render(
    <Shell
      route={route}
      user={{ email: "lazyx@tvashtr.dev", display_name: "Lazyx" }}
      badges={badges}
      onNavigate={onNavigate}
      onOpenSearch={onOpenSearch}
      onShowShortcuts={onShowShortcuts}
      onLogout={onLogout}
      {...extra}
    >
      <p>page body</p>
    </Shell>,
  );
  return { onNavigate, onOpenSearch, onShowShortcuts, onLogout };
}

beforeEach(() => {
  __resetBackendStatusForTests();
  __resetGetStartedForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ status: "ok", db: "ok" }), { status: 200 })),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.tvashtrDesktop;
});

describe("Shell", () => {
  it("shows Home's nav with the Needs-you count and section warnings", async () => {
    renderShell({ page: "home" }, { home: 4, enginesToFix: 2, secretsMissing: 1 });
    const nav = screen.getByRole("navigation", { name: "Dashboard" });
    expect(within(nav).getByRole("button", { name: /Home 4/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("button", { name: /Engines 2 to fix/ })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /Toolkit 1 missing/ })).toBeInTheDocument();
    expect(within(nav).getByText("Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("page body")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Connected"));
  });

  it("expands Engines into its sub-pages while inside it", () => {
    renderShell(
      { page: "engines", tab: "subscriptions" },
      { enginesToFix: 2, subscriptions: { connected: 1, total: 2 }, apiKeys: 3 },
    );
    const nav = screen.getByRole("navigation", { name: "Dashboard" });
    expect(within(nav).getByRole("button", { name: "Engines" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(within(nav).getByRole("button", { name: /Overview 2 to fix/ })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /Subscriptions 1 of 2/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("button", { name: /API keys 3/ })).toBeInTheDocument();
    expect(within(nav).getByText(/are the models your agents run on/)).toBeInTheDocument();
  });

  it("expands Toolkit with its four sub-pages and badges", async () => {
    const { onNavigate } = renderShell(
      { page: "tool", toolId: "t1" },
      { tools: 3, skills: 3, memoryInbox: 2, secretsMissing: 1 },
    );
    const nav = screen.getByRole("navigation", { name: "Dashboard" });
    expect(within(nav).getByRole("button", { name: /Tools 3/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("button", { name: /Memory 2 new/ })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /Secrets 1 missing/ })).toBeInTheDocument();
    await userEvent.click(within(nav).getByRole("button", { name: /Secrets/ }));
    expect(onNavigate).toHaveBeenCalledWith({ page: "secrets" });
  });

  it("opens search and the account menu", async () => {
    const { onOpenSearch, onShowShortcuts, onLogout } = renderShell({ page: "home" });
    await userEvent.click(screen.getByRole("button", { name: "Search teams, runs and actions" }));
    expect(onOpenSearch).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    const menu = screen.getByRole("menu", { name: "Account" });
    expect(menu).toHaveTextContent("lazyx@tvashtr.dev");
    expect(
      within(menu).getByRole("menuitem", { name: /Download Tvashtr Desktop/ }),
    ).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Keyboard shortcuts/ }));
    expect(onShowShortcuts).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Log out/ }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("hides the Desktop download inside Tvashtr Desktop", async () => {
    window.tvashtrDesktop = true;
    renderShell({ page: "home" });
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.queryByRole("menuitem", { name: /Download Tvashtr Desktop/ })).toBeNull();
  });

  it("shows the offline label and banner, and Try again recovers", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError("network")));
    vi.stubGlobal("fetch", fetchMock);
    renderShell({ page: "home" });
    await waitFor(() => expect(screen.getByText("Can’t reach backend")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn’t reach the backend — some sections may be stale.",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ status: "ok", db: "ok" }), { status: 200 })),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("offers to bring back a hidden get-started checklist (TEAMS-56)", async () => {
    const patches: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/account/preferences") {
          if (init?.method === "PATCH") patches.push(JSON.parse(init.body as string));
          const hidden = init?.method !== "PATCH";
          return Promise.resolve(
            new Response(JSON.stringify({ get_started_hidden: hidden }), { status: 200 }),
          );
        }
        return Promise.resolve(new Response(JSON.stringify({ status: "ok", db: "ok" })));
      }),
    );
    window.location.hash = "#/engines";
    renderShell({ page: "engines", tab: "overview" });
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    const item = await screen.findByRole("menuitem", { name: "Show get-started checklist" });
    await userEvent.click(item);
    await waitFor(() => expect(patches).toEqual([{ get_started_hidden: false }]));
    await waitFor(() => expect(window.location.hash).toBe("#/home"));
    window.location.hash = "";
  });

  it("hides the nav badges while Home shows the first-time checklist", () => {
    setFirstTime(true);
    renderShell({ page: "home" }, { home: 4, enginesToFix: 2 });
    const nav = screen.getByRole("navigation", { name: "Dashboard" });
    expect(within(nav).getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(within(nav).queryByText("2 to fix")).toBeNull();
  });
});
