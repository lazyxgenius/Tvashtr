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

  it("shows a run note in its own words, not as a tool that didn't load", () => {
    render(
      <RunWarnings
        warnings={[
          {
            source_kind: "spec",
            name: "pm",
            reason: "The PM didn't save REPORT.md, so its final message was used",
          },
        ]}
      />,
    );
    expect(
      screen.getByText("The PM didn't save REPORT.md, so its final message was used"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/didn.t load/)).not.toBeInTheDocument();
  });

  it("counts only tools and skills in the didn't-load line", () => {
    render(
      <RunWarnings
        warnings={[
          { source_kind: "tool", name: "github", reason: "missing secret GITHUB_TOKEN" },
          {
            source_kind: "spec",
            name: "pm",
            reason: "The PM didn't save REPORT.md, so its final message was used",
          },
        ]}
      />,
    );
    expect(screen.getByText(/1 tool\/skill didn.t load/)).toBeInTheDocument();
    expect(
      screen.getByText("The PM didn't save REPORT.md, so its final message was used"),
    ).toBeInTheDocument();
  });
});
