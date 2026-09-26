import { describe, expect, it } from "vitest";

import { agentName, agentNames } from "./toolFormat";

describe("agent names", () => {
  it("uses the agent's own title, else its role, title-cased", () => {
    expect(agentName({ role_name: "engineer", title: null })).toBe("Engineer");
    expect(agentName({ role_name: "prd_gate", title: null })).toBe("Prd gate");
    expect(agentName({ role_name: "pm", title: null })).toBe("Product manager");
    expect(agentName({ role_name: "engineer", title: "Backend engineer" })).toBe(
      "Backend engineer",
    );
    expect(agentName({ role_name: "engineer", title: "  " })).toBe("Engineer");
  });

  it("lists each name once, in order", () => {
    expect(
      agentNames([
        { role_name: "engineer", title: null },
        { role_name: "reviewer", title: null },
        { role_name: "engineer", title: null },
        { role_name: "writer", title: null },
      ]),
    ).toEqual(["Engineer", "Reviewer", "Writer"]);
  });
});
