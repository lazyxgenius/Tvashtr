import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LastRun } from "./LastRun";

describe("LastRun (shared) — M2", () => {
  it("renders each round's outcome_detail brief + the §14.1 verdict tone", () => {
    const { container } = render(
      <LastRun
        rounds={[
          { iteration: 1, outcome: "changes_requested", outcome_detail: "Missing the tests." },
          { iteration: 2, outcome: "approved", outcome_detail: null },
        ]}
      />,
    );
    expect(screen.getByText("Changes requested")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Missing the tests.")).toBeInTheDocument();
    // the §14.1 tones still drive the styling (sage = approved, coral = changes)
    expect(container.querySelector(".tv-verdict--changes")).not.toBeNull();
    expect(container.querySelector(".tv-verdict--approved")).not.toBeNull();
  });

  it("with provenance renders a relative-time tag; WITHOUT it renders none (run-view byte-identical)", () => {
    const round = {
      iteration: 1,
      outcome: "prd_written",
      outcome_detail: "Drafted the spec from the idea.",
    };
    // Run-view (no provenance): no "ran … ago" tag.
    const { container: noProv } = render(<LastRun rounds={[round]} />);
    expect(noProv.querySelector(".tv-lastrun__when")).toBeNull();
    expect(screen.getByText("Drafted the spec from the idea.")).toBeInTheDocument();

    // Authoring (provenance): the muted relative-time tag renders.
    const { container: withProv } = render(
      <LastRun
        rounds={[round]}
        provenance={{
          startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          runId: "r1",
        }}
      />,
    );
    const when = withProv.querySelector(".tv-lastrun__when");
    expect(when).not.toBeNull();
    expect(when?.textContent).toContain("ran 2h ago");
  });

  it("renders 'No run yet.' for an empty round list", () => {
    render(<LastRun rounds={[]} />);
    expect(screen.getByText("No run yet.")).toBeInTheDocument();
  });

  // ---- M-ledger C6: a round's optional cost line + context-manifest table. ----
  it("renders a round's cost line + context-manifest table when present (C6)", () => {
    render(
      <LastRun
        rounds={[
          {
            iteration: 1,
            outcome: "built",
            outcome_detail: "Built the feature.",
            cost: {
              prompt_tokens: 1240,
              completion_tokens: 320,
              total_tokens: 1560,
              cost_usd: 0.0041,
            },
            context_manifest: {
              parts: [
                { name: "system", tokens: 900 },
                { name: "spec", tokens: 2100 },
              ],
              total_tokens: 3000,
              budget: 8000,
              handle_used: true,
            },
          },
        ]}
      />,
    );
    // the one-line cost summary
    expect(screen.getByText("1,240 in / 320 out · $0.0041")).toBeInTheDocument();
    // the manifest table (a part + the budget row) and the doc-handle offload note
    expect(screen.getByText("spec")).toBeInTheDocument();
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText((8000).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText("Spec offloaded to SPEC.md")).toBeInTheDocument();
  });

  it("renders NEITHER cost nor manifest when a round omits them (authoring stays byte-identical) (C6)", () => {
    const { container } = render(
      <LastRun rounds={[{ iteration: 1, outcome: "approved", outcome_detail: null }]} />,
    );
    expect(container.querySelector(".tv-verdict__cost")).toBeNull();
    expect(container.querySelector(".tv-manifest")).toBeNull();
  });
});
