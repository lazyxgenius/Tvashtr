import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../lib/backendStatus";
import {
  __resetWorkspaceStatusForTests,
  publishBadges,
  registerBadgeLoader,
} from "../lib/workspaceStatus";
import { Workspace } from "./Workspace";

vi.mock("../App", () => ({
  default: ({
    teamId,
    initialRunId,
    onBackToDashboard,
    doc,
    onDocRoute,
  }: {
    teamId: string;
    initialRunId: string | null;
    onBackToDashboard: (view: string) => void;
    doc?: { id: string };
    onDocRoute: (next: { id: string; version?: number } | null, opts: { push: boolean }) => void;
  }) => (
    <div>
      CANVAS {teamId} {initialRunId ?? "-"} {doc ? `DOC ${doc.id}` : ""}
      <button type="button" onClick={() => onBackToDashboard("engines")}>
        Open Engines
      </button>
      <button type="button" onClick={() => onDocRoute({ id: "d1" }, { push: true })}>
        Open doc
      </button>
      <button type="button" onClick={() => onDocRoute({ id: "d1", version: 2 }, { push: false })}>
        Show v2
      </button>
      <button type="button" onClick={() => onDocRoute(null, { push: false })}>
        Close doc
      </button>
    </div>
  ),
}));
vi.mock("./home/HomePage", () => ({ HomePage: () => <div>HOME BODY</div> }));
vi.mock("./compare/ComparePage", () => ({
  ComparePage: ({
    teamId,
    compareId,
    tab,
  }: {
    teamId: string;
    compareId?: string;
    tab?: string;
  }) => (
    <div>
      COMPARE {teamId} {compareId ?? "-"} {tab ?? "compare"}
    </div>
  ),
}));
vi.mock("./engines/EnginesPage", () => ({
  EnginesPage: ({
    tab,
    connect,
    embeddings,
  }: {
    tab: string;
    connect?: string;
    embeddings?: boolean;
  }) => (
    <div data-tab={tab} data-connect={connect} data-embeddings={String(Boolean(embeddings))}>
      ENGINES BODY
    </div>
  ),
}));

vi.mock("./connectors/ConnectorsPage", () => ({
  ConnectorsPage: ({ view }: { view: string }) => <div data-view={view}>CONNECTORS BODY</div>,
}));
vi.mock("./connectors/ConnectorDetailPage", async () => {
  const { useState } = await import("react");
  return {
    ConnectorDetailPage: ({ connectorId }: { connectorId: string }) => {
      // The id this instance was mounted for: another connector must be another instance.
      const [mountedFor] = useState(connectorId);
      return (
        <div data-id={connectorId} data-mounted-for={mountedFor}>
          CONNECTOR BODY
        </div>
      );
    },
  };
});

const user = { id: "u1", email: "lazyx@tvashtr.dev", display_name: "Lazyx" };

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<Workspace user={user} config={null} onLogout={vi.fn()} />);
}

beforeEach(() => {
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
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
  window.location.hash = "";
});

describe("Workspace", () => {
  it("Domains' Open Engines lands on API keys at the Domains embeddings section (ENG-6)", async () => {
    // The Domains list with no domain and no reading-model key: its hint's Check Engines.
    renderAt("#/domains");
    await userEvent.click(await screen.findByRole("link", { name: "Check Engines" }));
    const engines = await screen.findByText("ENGINES BODY");
    expect(window.location.hash).toBe("#/engines/keys?embeddings=1");
    expect(engines).toHaveAttribute("data-tab", "keys");
    expect(engines).toHaveAttribute("data-embeddings", "true");
  });

  it("Tvashtr Desktop: a tvashtr:// link moves the page (connect only highlights a card)", async () => {
    let deliver: (t: TvashtrDeepLinkTarget) => void = () => undefined;
    window.tvashtrDesktop = {
      navigation: {
        onNavigate: (cb: (t: TvashtrDeepLinkTarget) => void) => {
          deliver = cb;
          return () => undefined;
        },
        consumePending: () => Promise.resolve(null),
      },
    } as unknown as TvashtrDesktopBridge;
    renderAt("#/home");
    act(() => deliver({ path: "/engines/subscriptions", params: { connect: "grok" } }));
    const engines = await screen.findByText("ENGINES BODY");
    expect(engines).toHaveAttribute("data-tab", "subscriptions");
    expect(engines).toHaveAttribute("data-connect", "grok");
  });

  it("shows the page for the address inside the shell", () => {
    renderAt("#/engines");
    expect(screen.getByText("ENGINES BODY")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("shows Toolkit › Connectors, which a bare #/toolkit opens too", () => {
    const { unmount } = renderAt("#/toolkit/connectors/browse");
    expect(screen.getByText("CONNECTORS BODY")).toHaveAttribute("data-view", "browse");
    expect(screen.getByRole("button", { name: "Connectors" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    unmount();
    renderAt("#/toolkit");
    expect(screen.getByText("CONNECTORS BODY")).toHaveAttribute("data-view", "connected");
  });

  it("shows one connector’s page, a fresh one per connector", async () => {
    renderAt("#/toolkit/connectors/c1");
    expect(screen.getByText("CONNECTOR BODY")).toHaveAttribute("data-id", "c1");
    act(() => {
      window.location.hash = "#/toolkit/connectors/c2";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() =>
      expect(screen.getByText("CONNECTOR BODY")).toHaveAttribute("data-id", "c2"),
    );
    expect(screen.getByText("CONNECTOR BODY")).toHaveAttribute("data-mounted-for", "c2");
  });

  it("opens a team's canvas full-window, with the run from the address", () => {
    renderAt("#/teams/t1/runs/r9");
    expect(screen.getByText("CANVAS t1 r9")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Dashboard" })).toBeNull();
  });

  it("opens a team's compare page full-window, with the compare and tab from the address (M8)", () => {
    renderAt("#/teams/t1/compare/c9?tab=versions");
    expect(screen.getByText("COMPARE t1 c9 versions")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Dashboard" })).toBeNull();
  });

  it("the canvas's Open Engines lands on Overview with the rows to fix highlighted", () => {
    renderAt("#/teams/t1");
    act(() => screen.getByRole("button", { name: "Open Engines" }).click());
    expect(window.location.hash).toBe("#/engines?fix=1");
  });

  it("closing a document the canvas opened leaves no dead Back step", async () => {
    renderAt("#/engines");
    act(() => {
      window.location.hash = "#/teams/t1";
    });
    await screen.findByText(/CANVAS t1/);
    act(() => screen.getByRole("button", { name: "Open doc" }).click());
    await screen.findByText(/DOC d1/);
    // Moving inside the viewer is no step of its own.
    act(() => screen.getByRole("button", { name: "Show v2" }).click());
    act(() => screen.getByRole("button", { name: "Close doc" }).click());
    await waitFor(() => expect(window.location.hash).toBe("#/teams/t1"));
    expect(screen.queryByText(/DOC d1/)).toBeNull();
    // One Back leaves the team, as it would have before the document was opened.
    act(() => window.history.back());
    await waitFor(() => expect(window.location.hash).toBe("#/engines"));
  });

  it("closing a document opened from the address stays on the team", async () => {
    renderAt("#/engines");
    act(() => {
      window.location.hash = "#/teams/t1/docs/d1";
    });
    await screen.findByText(/DOC d1/);
    act(() => screen.getByRole("button", { name: "Close doc" }).click());
    await waitFor(() => expect(window.location.hash).toBe("#/teams/t1"));
  });

  it("follows the address when it changes", async () => {
    renderAt("#/");
    expect(screen.getByText("HOME BODY")).toBeInTheDocument();
    act(() => {
      window.location.hash = "#/engines";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(screen.getByText("ENGINES BODY")).toBeInTheDocument());
  });

  it("loads the nav badges from every registered area", async () => {
    registerBadgeLoader("home", () => Promise.resolve({ home: 4 }));
    registerBadgeLoader("toolkit", () => Promise.resolve({ secretsMissing: 1 }));
    renderAt("#/");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Toolkit 1 missing/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Home 4/ })).toBeInTheDocument();
    act(() => publishBadges({ home: 2 }));
    expect(screen.getByRole("button", { name: /Home 2/ })).toBeInTheDocument();
  });

  it("re-counts the nav badges when the canvas is left", async () => {
    // Drawer changes (keep a memory, add a tool, change a model) move other areas' counts.
    let loads = 0;
    registerBadgeLoader("home", () => Promise.resolve({ home: ++loads }));
    const go = (hash: string) =>
      act(() => {
        window.location.hash = hash;
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
    renderAt("#/home");
    await waitFor(() => expect(loads).toBe(1));
    go("#/teams/t1");
    go("#/home");
    await waitFor(() => expect(loads).toBe(2));
  });

  it("? shows the keyboard shortcuts, and Done closes them", async () => {
    renderAt("#/");
    await userEvent.keyboard("?");
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveTextContent("Search and actions⌘K");
    expect(dialog).toHaveTextContent("Close a menu or sheetEsc");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores single-key shortcuts while typing or with a modifier held", async () => {
    renderAt("#/");
    await userEvent.keyboard("{Control>}?{/Control}");
    expect(screen.queryByRole("dialog")).toBeNull();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    await userEvent.keyboard("?");
    expect(screen.queryByRole("dialog")).toBeNull();
    input.remove();
  });

  it("T on another page opens Home for the new-team action", async () => {
    renderAt("#/engines");
    await userEvent.keyboard("t");
    await waitFor(() => expect(screen.getByText("HOME BODY")).toBeInTheDocument());
  });
});
