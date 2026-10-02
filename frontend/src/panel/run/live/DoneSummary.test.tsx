import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

describe("DoneSummary — M10 Start the next run from this (Next-Finished)", () => {
  const SUMMARY = {
    pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/42",
    pr_number: 42,
    rounds: 3,
    elapsed_s: 1358,
    cost_usd: 1.12,
    branch: "tvashtr/run-12",
    base_ref: "main",
    tests_passed: 41,
  };

  it("offers it beside Open pull request when the run can start one; the rest is unchanged", () => {
    const onStart = vi.fn();
    render(
      <DoneSummary
        idea="Add an RSI indicator"
        summary={SUMMARY}
        startNext={{ prNumber: 42, onStart }}
      />,
    );
    const row = screen.getByRole("region", { name: "Run summary" });
    expect(row).toHaveTextContent("Shipped: pull request #42 is open");
    expect(row).toHaveTextContent("Add an RSI indicator · branch tvashtr/run-12 → main");
    expect(row).toHaveTextContent("3rounds");
    expect(row).toHaveTextContent("22m 38stotal time");
    expect(row).toHaveTextContent("$1.12cost");
    expect(row).toHaveTextContent("41tests passing");
    const pr = screen.getByRole("link", { name: "Open pull request #42" });
    expect(pr).toHaveAttribute("href", SUMMARY.pr_url);
    const next = screen.getByRole("button", { name: "Start the next run from this" });
    // Beside it, after it.
    expect(pr.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Start the next feature where this one ended" +
        "The new run gets this run’s final spec, your decisions and what the agents learned, and can start from pull request #42. It does not copy the agents’ full conversations: long histories make agents slower and less accurate.",
    );
    fireEvent.click(next);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("without an open pull request the tip offers none, and the button still shows", () => {
    render(
      <DoneSummary
        idea="Add an RSI indicator"
        summary={{ ...SUMMARY, pr_url: null, pr_number: null }}
        startNext={{ prNumber: null, onStart: () => undefined }}
      />,
    );
    expect(screen.queryByRole("link", { name: /Open pull request/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Start the next run from this" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "The new run gets this run’s final spec, your decisions and what the agents learned. It does not copy",
    );
  });
});
