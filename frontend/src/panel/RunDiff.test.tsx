import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RunDiffFile } from "../lib/api";
import { RunDiff } from "./RunDiff";

// Mirror EventFeed.test.tsx: stub global fetch (getRunDiff -> getJSON -> fetch) with a RunDiff body.
function stubDiff(files: RunDiffFile[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            run_id: "r1",
            base_ref: "main",
            ship_branch: "tvashtr/r1",
            files,
            total: files.length,
          }),
      } as unknown as Response),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RunDiff — the run-view Changes tab (M-changes)", () => {
  it("renders a row per changed file with its path, status, and ±counts", async () => {
    stubDiff([
      { path: "calculator.py", status: "modified", additions: 2, deletions: 1, patch: "@@ x @@" },
      { path: "newmod.py", status: "added", additions: 1, deletions: 0, patch: "@@ y @@" },
    ]);
    const { container } = render(<RunDiff runId="r1" />);

    expect(await screen.findByText("calculator.py")).toBeInTheDocument();
    expect(screen.getByText("newmod.py")).toBeInTheDocument();
    expect(container.querySelectorAll(".tv-diff__file")).toHaveLength(2);
    // per-file ±count badge (calculator = +2 / -1; newmod = +1)
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
    // the git status class surfaces
    expect(screen.getByText("added")).toBeInTheDocument();
    expect(screen.getByText("modified")).toBeInTheDocument();
  });

  it("expands a file's patch on click, then collapses it", async () => {
    stubDiff([
      {
        path: "greeting.txt",
        status: "added",
        additions: 2,
        deletions: 0,
        patch: "@@ -0,0 +1,2 @@\n+hello\n+world",
      },
    ]);
    render(<RunDiff runId="r1" />);
    const row = await screen.findByRole("button", { name: /greeting\.txt/ });

    // the patch is hidden until the row is expanded
    expect(screen.queryByText("+hello")).toBeNull();
    fireEvent.click(row);
    expect(screen.getByText("+hello")).toBeInTheDocument();
    expect(screen.getByText("+world")).toBeInTheDocument();
    // clicking again collapses it
    fireEvent.click(row);
    expect(screen.queryByText("+hello")).toBeNull();
  });

  it("shows the empty state when the run changed nothing", async () => {
    stubDiff([]);
    render(<RunDiff runId="r1" />);
    expect(await screen.findByText(/No file changes/i)).toBeInTheDocument();
  });
});
