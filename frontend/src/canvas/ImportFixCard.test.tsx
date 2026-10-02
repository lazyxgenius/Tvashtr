import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { fixRoute } from "../lib/teamImport";
import { ImportFixCard } from "./ImportFixCard";

describe("a team the import left unable to run (M4)", () => {
  it("is fixed on its own canvas: the row has no button, and no page to open", () => {
    const graph = {
      key: "graph",
      text: "The team needs a change before it can run",
      action: "open_team" as const,
      target: null,
      node_ids: [],
    };
    render(<ImportFixCard fixes={[graph]} note="" onFix={vi.fn()} onHide={vi.fn()} />);
    const card = screen.getByRole("region", { name: "Things to fix" });
    expect(card).toHaveTextContent("The team needs a change before it can run");
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Hide",
    ]);
    expect(fixRoute(graph)).toBeNull();
  });
});
