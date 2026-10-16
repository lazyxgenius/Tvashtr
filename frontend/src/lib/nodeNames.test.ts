import { describe, expect, it } from "vitest";

import { gateLabel, nodeDescription, nodeTitle } from "./nodeNames";

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
    expect(nodeTitle(node("agent", "qa"))).toBe("qa");
  });

  it("a blank palette agent is a New agent until it's named (PANEL-61)", () => {
    expect(nodeTitle(node("agent", "worker"))).toBe("New agent");
    expect(nodeTitle(node("completion", "thinker"))).toBe("New agent");
    expect(nodeDescription(node("agent", "worker"))).toBe("");
    expect(nodeTitle(node("agent", "worker", { title: "Tester" }))).toBe("Tester");
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

  it("a Tests pass gate reads Tests pass, not its raw kind (M-desk-6 T1)", () => {
    expect(gateLabel("tests_pass")).toBe("Tests pass");
    expect(nodeTitle(node("gate", "g", { gate_kind: "tests_pass", title: "Run the tests" }))).toBe(
      "Tests pass",
    );
  });

  it("a guardrail card reads its title, else its type's name — never its raw kind (M-desk-8 P1)", () => {
    expect(gateLabel("secret_leak_scan")).toBe("Secret leak scan");
    expect(gateLabel("diff_touches_forbidden_paths")).toBe("Forbidden paths");
    expect(gateLabel("output_schema_check")).toBe("Output schema");
    const gate = (gate_kind: string, title?: string) =>
      nodeTitle(node("gate", "g", { gate_kind, ...(title === undefined ? {} : { title }) }));
    expect(gate("secret_leak_scan", "Secret scan")).toBe("Secret scan");
    expect(gate("diff_touches_forbidden_paths", "No edits to servers/")).toBe(
      "No edits to servers/",
    );
    expect(gate("secret_leak_scan", "")).toBe("Secret leak scan");
    expect(gate("output_schema_check")).toBe("Output schema");
    // a check switched before F1 still carries the human default: never a question on a check
    expect(gate("diff_touches_forbidden_paths", "Approve before continuing?")).toBe(
      "Forbidden paths",
    );
    // a plain approval gate reads its title too (the M11 boards' "Ask me what to do")
    expect(gate("approval", "Ask me what to do")).toBe("Ask me what to do");
    expect(gate("approval", "Approve before continuing?")).toBe("Approval");
    // the named human gates keep their short names over their sentence titles
    expect(gate("prd_approval", "Approve before continuing?")).toBe("PRD approval");
    expect(gate("review_escalation", "Couldn't satisfy the spec")).toBe("Escalation");
  });
});
