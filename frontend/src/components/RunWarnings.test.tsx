import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RunWarnings } from "./RunWarnings";

describe("RunWarnings (M-tools C7.A)", () => {
  it("renders nothing when there are no warnings", () => {
    const { container } = render(<RunWarnings warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each warning's name and reason", () => {
    render(
      <RunWarnings
        warnings={[
          { source_kind: "tool", name: "github", reason: "missing secret GITHUB_TOKEN" },
          { source_kind: "skill", name: "team-rules", reason: "repo unreachable" },
        ]}
      />,
    );
    expect(screen.getByText("github")).toBeInTheDocument();
    expect(screen.getByText(/missing secret GITHUB_TOKEN/)).toBeInTheDocument();
    expect(screen.getByText("team-rules")).toBeInTheDocument();
    expect(screen.getByText(/didn.t load/)).toBeInTheDocument();
  });
});
