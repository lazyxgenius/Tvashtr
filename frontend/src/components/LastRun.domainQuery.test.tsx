import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LastRun } from "./LastRun";

describe("LastRun domain_query citations", () => {
  it("renders citation filenames from context_manifest", () => {
    render(
      <LastRun
        rounds={[
          {
            iteration: 1,
            outcome: "answered",
            outcome_detail: "Refunds within 30 days.",
            status: "done",
            context_manifest: {
              citations: [
                {
                  document_id: "d1",
                  filename: "policy.md",
                  chunk_id: "c1",
                  ordinal: 0,
                  excerpt: "Refunds within 30 days.",
                },
              ],
              domain_id: "dom-1",
            } as any,
          },
        ]}
      />,
    );
    expect(screen.getAllByText(/answered|Refunds within 30 days/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/policy\.md/)).toBeTruthy();
  });
});
