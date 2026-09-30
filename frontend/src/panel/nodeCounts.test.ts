import { describe, expect, it } from "vitest";

import { skillsAndToolsCount } from "./nodeCounts";

// The Skills & tools tab count.

describe("skillsAndToolsCount", () => {
  it("adds skill sources, inline and library servers, and connector grants", () => {
    expect(
      skillsAndToolsCount([{ type: "inline" }, { type: "project_rules" }], {
        mcpServers: { fetch: {} },
        tvashtr: { library: ["t1"], connectors: [{ id: "c1", access: "read" }, { id: "c2" }] },
      }),
    ).toBe(5);
    expect(skillsAndToolsCount(null, null)).toBe(0);
  });

  it("counts only the connector grants the checklist would read (`connectorsOf`)", () => {
    expect(
      skillsAndToolsCount(null, {
        tvashtr: { connectors: [{ id: "c1", access: "read" }, "junk", { access: "write" }, null] },
      }),
    ).toBe(1);
  });
});
