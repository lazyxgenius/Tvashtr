import { describe, expect, it } from "vitest";

import { nodeDescription, nodeTitle } from "./nodeNames";

const node = (kind: string, role_name: string, config: Record<string, unknown> | null = null) => ({
  kind,
  role_name,
  config,
});

describe("nodeTitle / nodeDescription", () => {
  it("an agent's own name and tagline win over its role's", () => {
    expect(nodeTitle(node("agent", "reviewer", { title: "QA lead" }))).toBe("QA lead");
    expect(nodeTitle(node("agent", "reviewer"))).toBe("Reviewer");
    expect(nodeDescription(node("agent", "reviewer", { description: "Checks it" }))).toBe(
      "Checks it",
    );
    expect(nodeDescription(node("agent", "reviewer"))).toBe("Checks against the spec");
    expect(nodeTitle(node("agent", "worker"))).toBe("worker");
  });

  it("gates, endpoints and Query-domain nodes", () => {
    expect(
      nodeTitle(node("gate", "g", { gate_kind: "prd_approval", title: "Approve the PRD" })),
    ).toBe("PRD approval");
    expect(nodeDescription(node("gate", "g"))).toBe("Gate");
    expect(nodeTitle(node("terminal", "ship", { terminal_kind: "ship" }))).toBe("Ship");
    expect(nodeTitle(node("terminal", "stop", { terminal_kind: "stop" }))).toBe("Stop");
    expect(nodeTitle(node("domain_query", "domain_query"))).toBe("Domain ask");
  });
});
