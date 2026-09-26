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
  }: {
    teamId: string;
    initialRunId: string | null;
    onBackToDashboard: (view: string) => void;
  }) => (
    <div>
      CANVAS {teamId} {initialRunId ?? "-"}
      <button type="button" onClick={() => onBackToDashboard("engines")}>
        Open Engines
      </button>
    </div>
  ),
}));
vi.mock("./home/HomePage", () => ({ HomePage: () => <div>HOME BODY</div> }));
vi.mock("./engines/EnginesPage", () => ({ EnginesPage: () => <div>ENGINES BODY</div> }));

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
  window.location.hash = "";
});

describe("Workspace", () => {
  it("shows the page for the address inside the shell", () => {
    renderAt("#/engines");
    expect(screen.getByText("ENGINES BODY")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("opens a team's canvas full-window, with the run from the address", () => {
    renderAt("#/teams/t1/runs/r9");
    expect(screen.getByText("CANVAS t1 r9")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Dashboard" })).toBeNull();
  });

  it("the canvas's Open Engines lands on Overview with the rows to fix highlighted", () => {
    renderAt("#/teams/t1");
    act(() => screen.getByRole("button", { name: "Open Engines" }).click());
    expect(window.location.hash).toBe("#/engines?fix=1");
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
