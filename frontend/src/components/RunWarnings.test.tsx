import { render, screen, within } from "@testing-library/react";
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

  it("says which connectors the run went on without, with the way to Connectors", () => {
    render(
      <RunWarnings
        warnings={[
          { source_kind: "connector", name: "Notion", reason: "its sign-in expired" },
          { source_kind: "connector", name: "a connector", reason: "it was disconnected" },
        ]}
      />,
    );
    const banner = screen.getByRole("status", { name: "Resolution warnings" });
    const lines = within(banner).getAllByRole("listitem");
    expect(lines.map((l) => l.textContent)).toEqual([
      "⚠ Ran without Notion: its sign-in expired.",
      "⚠ Ran without a connector: it was disconnected.",
    ]);
    // A connection has a display name, not a server name: bold, as on the round.
    expect(within(lines[0]).getByText("Notion").tagName).toBe("B");
    // One way to Connectors for the banner, not one per line.
    const links = within(banner).getAllByRole("link", { name: "Open Connectors" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "#/toolkit/connectors");
    // A connector the run went on without is not a tool that "didn't load".
    expect(screen.queryByText(/didn.t load/)).not.toBeInTheDocument();
  });

  it("keeps connectors apart from tools that didn't load and from run notes", () => {
    render(
      <RunWarnings
        warnings={[
          { source_kind: "tool", name: "github", reason: "missing secret GITHUB_TOKEN" },
          { source_kind: "connector", name: "Supabase", reason: "we couldn’t reach it" },
          { source_kind: "spec", name: "pm", reason: "The PM didn't save REPORT.md" },
        ]}
      />,
    );
    expect(screen.getByText(/1 tool\/skill didn.t load/)).toBeInTheDocument();
    expect(screen.getByText(/Ran without/).closest("li")).toHaveTextContent(
      "Ran without Supabase: we couldn’t reach it.",
    );
    expect(screen.getByText("The PM didn't save REPORT.md")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open Connectors" })).toHaveLength(1);
  });

  it("offers no way to Connectors when no connector was skipped", () => {
    render(
      <RunWarnings
        warnings={[{ source_kind: "tool", name: "github", reason: "missing secret GITHUB_TOKEN" }]}
      />,
    );
    expect(screen.queryByRole("link", { name: "Open Connectors" })).toBeNull();
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
