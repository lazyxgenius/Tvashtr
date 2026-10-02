import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../lib/backendStatus";
import { CanvasToolbar } from "./CanvasToolbar";

// M8 (Ver-Draft): the toolbar's right group gains a ghost "Compare" right before "Team file". Every
// control the toolbar had before stays (brief §2.2, kept-teamcanvas.txt).

const full = (compare?: { onOpen: () => void }) => (
  <CanvasToolbar
    onBack={vi.fn()}
    run={{ disabled: false, onRun: vi.fn() }}
    teamName="Indicator sprint team"
    spend="$0.84"
    docs={{ count: 2, open: false, onToggle: vi.fn() }}
    file={{ open: false, onToggle: vi.fn() }}
    compare={compare}
    version={
      <button type="button" aria-label="Version history">
        v7
      </button>
    }
  />
);

beforeEach(() => {
  __resetBackendStatusForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: "ok", db: "ok" })))),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("CanvasToolbar — M8 Compare", () => {
  it("keeps every existing control", async () => {
    render(full({ onOpen: vi.fn() }));
    const bar = screen.getByRole("toolbar", { name: "Team" });
    for (const name of ["Back to teams", "Run this team", "Version history", "Team file"])
      expect(within(bar).getByRole("button", { name })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: /^Documents/ })).toBeInTheDocument();
    expect(within(bar).getByText("Indicator sprint team")).toBeInTheDocument();
    expect(within(bar).getByText("$0.84")).toBeInTheDocument();
    expect(await within(bar).findByText("Connected")).toHaveAttribute("role", "status");
  });

  it("Compare sits right before Team file and opens the compare page", async () => {
    const onOpen = vi.fn();
    render(full({ onOpen }));
    const compare = screen.getByRole("button", { name: "Compare" });
    const file = screen.getByRole("button", { name: "Team file" });
    expect(compare.nextElementSibling).toBe(file);
    expect(compare).toHaveClass("ds-btn--ghost");
    fireEvent.click(compare);
    expect(onOpen).toHaveBeenCalledOnce();
    await screen.findByText("Connected");
  });

  it("no compare prop: no Compare button", async () => {
    render(full());
    expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();
    expect(screen.getByRole("button", { name: "Team file" })).toBeInTheDocument();
    await screen.findByText("Connected");
  });
});
