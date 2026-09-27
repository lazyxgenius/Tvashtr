import { describe, expect, it } from "vitest";

import type { GraphEdge, TeamGraphNode } from "../../lib/api";
import { sampleDomains } from "./domainsTestUtils";
import {
  accessLine,
  accessOf,
  afterPick,
  cardBadges,
  domainStatusLine,
  drawerSubtitle,
  lookupTitle,
  passHelper,
  pickedStatus,
  readersAfter,
  roundBadge,
  roundMeta,
  specLine,
  toggleAccess,
  usableDomain,
} from "./queryNodeFormat";

const [support, vendor, research, q3] = sampleDomains();

function node(id: string, role_name: string, kind = "agent", title?: string): TeamGraphNode {
  return {
    id,
    role_name,
    kind,
    model: null,
    engine: null,
    prompt: null,
    position: { x: 0, y: 0 },
    config: title ? { title } : {},
  };
}

const edge = (s: string, t: string, loop = false): GraphEdge => ({
  id: `${s}-${t}`,
  source_node_id: s,
  target_node_id: t,
  edge_type: loop ? "rework" : "work",
  conditions: loop ? { loop_limit: 3 } : null,
});

describe("domain status lines (DM-100)", () => {
  it("reads like the design's list", () => {
    expect(domainStatusLine(support)).toBe("Ready · 14 files");
    expect(domainStatusLine(vendor)).toBe("Reading 4 of 6");
    expect(domainStatusLine(research)).toBe("1 file needs attention");
    expect(domainStatusLine(q3)).toBe("No files yet");
    expect(usableDomain(q3)).toBe(false);
    expect(usableDomain(vendor)).toBe(true);
  });

  it("adds the latest test score under a ready pick", () => {
    expect(pickedStatus(support)).toEqual({
      tone: "ok",
      text: "Ready · 14 files · 83% found the right file",
    });
    expect(pickedStatus(vendor)).toEqual({ tone: "warn", text: "Reading 4 of 6" });
    expect(pickedStatus(q3)).toEqual({ tone: "warn", text: "No files yet — can’t be used" });
  });
});

describe("picking a domain (DM-101)", () => {
  it("renames a default node and fills its question", () => {
    expect(lookupTitle("Support docs")).toBe("Look up support docs");
    expect(lookupTitle("Q3 filings")).toBe("Look up Q3 filings");
    expect(afterPick({ title: "", prompt: "{idea}" }, null, "Support docs")).toEqual({
      title: "Look up support docs",
      prompt: "What do our support docs say about {idea}?",
    });
  });

  it("follows a second pick but keeps what the person wrote", () => {
    const first = afterPick({ title: "", prompt: "{idea}" }, null, "Support docs");
    expect(afterPick(first, "Support docs", "Vendor contracts")).toEqual({
      title: "Look up vendor contracts",
      prompt: "What do our vendor contracts say about {idea}?",
    });
    expect(
      afterPick({ title: "Refund check", prompt: "Refunds? {idea}" }, null, "Support docs"),
    ).toEqual({ title: "Refund check", prompt: "Refunds? {idea}" });
  });
});

describe("who reads the answer", () => {
  const nodes = [
    node("pm", "pm", "completion"),
    node("dq", "domain_query", "domain_query"),
    node("w", "writer", "agent", "Writer"),
    node("r", "reviewer"),
    node("ship", "ship", "terminal"),
  ];
  const edges = [
    edge("pm", "dq"),
    edge("dq", "w"),
    edge("w", "r"),
    edge("r", "ship"),
    edge("r", "w", true),
  ];

  it("lists the agents after the node, in path order", () => {
    expect(readersAfter("dq", nodes, edges)).toEqual(["Writer", "Reviewer"]);
    expect(passHelper(["Writer", "Reviewer"])).toBe(
      "Adds the answer and its sources to the spec, so the Writer and Reviewer read them.",
    );
    expect(passHelper(["Writer"])).toBe(
      "Adds the answer and its sources to the spec, so the Writer reads them.",
    );
    expect(passHelper([])).toBe(
      "Adds the answer and its sources to the spec, so the next agents read them.",
    );
  });
});

describe("Last run (DM-103)", () => {
  const round = {
    status: "done",
    outcome: "answered",
    covered: true,
    latency_ms: 1900,
    cost_usd: 0.0012,
    spec_section: "What the docs say",
    detail: null,
  };

  it("reads the round", () => {
    expect(drawerSubtitle("Look up support docs", 14)).toBe("Look up support docs · run 14");
    expect(drawerSubtitle("Look up support docs", null)).toBe("Look up support docs");
    expect(roundBadge(round)).toEqual({ tone: "ok", label: "Answered" });
    expect(roundBadge({ ...round, outcome: "no_answer", covered: false })?.label).toBe("No answer");
    expect(roundBadge({ ...round, status: "failed", outcome: null })?.label).toBe("Failed");
    expect(roundMeta(round)).toBe("1.9 s · $0.0012");
    expect(roundMeta({ latency_ms: null, cost_usd: null })).toBe("");
    expect(specLine(round)).toEqual({
      tone: "ok",
      text: "Added to the spec · section “What the docs say”",
    });
    expect(specLine({ ...round, spec_section: null })).toEqual({
      tone: "muted",
      text: "Not added to the spec",
    });
    expect(specLine({ ...round, status: "failed", detail: "No key" })).toEqual({
      tone: "danger",
      text: "No key",
    });
  });
});

describe("the card (DM-99)", () => {
  it("shows what blocks a run before how the last run went", () => {
    expect(cardBadges({ hasDomain: false })).toEqual([{ tone: "warn", label: "Needs a domain" }]);
    expect(cardBadges({ hasDomain: true, errorCode: "no_exit", lastOutcome: "answered" })).toEqual([
      { tone: "warn", label: "No way out" },
    ]);
    expect(cardBadges({ hasDomain: true, lastOutcome: "answered" })).toEqual([
      { tone: "ok", label: "Answered" },
    ]);
    expect(cardBadges({ hasDomain: true, lastOutcome: "no_answer" })[0].label).toBe("No answer");
    expect(cardBadges({ hasDomain: true, failed: true })[0].label).toBe("Failed");
    expect(cardBadges({ hasDomain: true })).toEqual([]);
  });
});

describe("an agent's domains (DM-105)", () => {
  const all = ["d-support", "d-vendor", "d-research"];

  it("reads true and lists; ignores the rest", () => {
    expect(accessOf({ tvashtr: { domains: true } })).toBe(true);
    expect(accessOf({ tvashtr: { domains: ["d-support"] } })).toEqual(["d-support"]);
    expect(accessOf({ tvashtr: { domains: [] } })).toBeNull();
    expect(accessOf(null)).toBeNull();
  });

  it("ticks one, and unticking from every domain keeps the others", () => {
    expect(toggleAccess(null, "d-support", true, all)).toEqual(["d-support"]);
    expect(toggleAccess(true, "d-vendor", false, all)).toEqual(["d-support", "d-research"]);
    expect(toggleAccess(["d-support"], "d-support", false, all)).toEqual([]);
  });

  it("names them on the agent card", () => {
    const names = sampleDomains().map((d) => ({ id: d.domain_id, name: d.name }));
    expect(accessLine(["d-support"], names)).toBe("Can search Support docs");
    expect(accessLine(true, names)).toBe("Can search Support docs +3");
    expect(accessLine(null, names)).toBeNull();
    expect(accessLine(["gone"], names)).toBeNull();
  });
});
