import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DoneSummary } from "./DoneSummary";

describe("DoneSummary", () => {
  it("says what shipped, with rounds, time, cost, tests and the pull request", () => {
    render(
      <DoneSummary
        idea="Add an RSI indicator"
        summary={{
          pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/42",
          pr_number: 42,
          rounds: 3,
          elapsed_s: 1358,
          cost_usd: 1.12,
          branch: "tvashtr/run-12",
          base_ref: "main",
          tests_passed: 41,
        }}
      />,
    );
    const row = screen.getByRole("region", { name: "Run summary" });
    expect(row).toHaveTextContent("Shipped: pull request #42 is open");
    expect(row).toHaveTextContent("Add an RSI indicator · branch tvashtr/run-12 → main");
    expect(row).toHaveTextContent("3rounds");
    expect(row).toHaveTextContent("22m 38stotal time");
    expect(row).toHaveTextContent("$1.12cost");
    expect(row).toHaveTextContent("41tests passing");
    expect(screen.getByRole("link", { name: "Open pull request #42" })).toHaveAttribute(
      "href",
      "https://github.com/lazyxgenius/trade_mcp/pull/42",
    );
    // "Start the next run from this" arrives with M10 (no dead buttons).
    expect(screen.queryByText("Start the next run from this")).toBeNull();
  });
});
