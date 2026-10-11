/**
 * M-desk-5 L3 — a finished GitHub run's Changes tab reads its branch from GitHub; when GitHub can't
 * answer, the tab says so and links the pull request (Runs › Live-ChangesGitHub, website and
 * Desktop), in the tab's existing empty-state style.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunDiff } from "./RunDiff";

const PR = "https://github.com/lazyxgenius/trade_mcp/pull/42";

function stubAnswer(extra: Record<string, unknown>) {
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
            files: [],
            total: 0,
            ...extra,
          }),
      } as unknown as Response),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("L3 — the Changes tab when GitHub can't answer", () => {
  it("says it couldn't load them from GitHub and links the pull request", async () => {
    stubAnswer({ github_error: true, pr_url: PR });
    render(<RunDiff runId="r1" />);
    expect(await screen.findByText("Couldn't load the changes from GitHub.")).toHaveClass(
      "tv-panel-note",
    );
    const link = screen.getByRole("link", { name: "Open the pull request →" });
    expect(link).toHaveAttribute("href", PR);
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.queryByText(/No file changes/)).not.toBeInTheDocument();
  });

  it("has no link when the run opened no pull request", async () => {
    stubAnswer({ github_error: true, pr_url: null });
    render(<RunDiff runId="r1" />);
    expect(await screen.findByText("Couldn't load the changes from GitHub.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("an empty answer without the GitHub flag keeps today's words", async () => {
    stubAnswer({});
    render(<RunDiff runId="r1" />);
    expect(
      await screen.findByText("No file changes — this run didn't modify any files."),
    ).toBeInTheDocument();
  });
});
