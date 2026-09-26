import { describe, expect, it } from "vitest";

import type { DomainAgent } from "../../lib/api/domains";
import {
  addedStepToast,
  agentChoiceLine,
  defaultQuestion,
  lastQuestionLine,
  lowerName,
  matchesAgent,
  stepLine,
  subscriptionNote,
} from "./useInTeamsFormat";

const agent = (over: Partial<DomainAgent> = {}): DomainAgent => ({
  node_id: "n",
  team_id: "t",
  team_name: "Indicator sprint team",
  role_name: "pm",
  title: "Product manager",
  model: "xai/grok-4.7",
  scope: null,
  subscription: null,
  ...over,
});

describe("Use in teams copy", () => {
  it("lower-cases the name unless it starts with an acronym", () => {
    expect(lowerName("Support docs")).toBe("support docs");
    expect(lowerName("Q3 filings")).toBe("Q3 filings");
    expect(lowerName("API guide")).toBe("API guide");
    expect(defaultQuestion("Support docs")).toBe("What do our support docs say about {idea}?");
  });

  it("says when the last question was asked", () => {
    const now = new Date("2026-09-26T12:00:00Z");
    expect(lastQuestionLine("2026-09-26T10:00:00Z", now)).toBe("Last question asked 2 hours ago.");
    expect(lastQuestionLine(null, now)).toBe("No questions yet.");
  });

  it("describes a step and an agent choice", () => {
    const step = {
      node_id: "n",
      team_id: "t",
      team_name: "Docs team",
      title: "Look up support docs",
      pass_to_spec: false,
    };
    expect(stepLine(step)).toBe("Docs team · answer on the run log only");
    expect(stepLine({ ...step, pass_to_spec: true })).toBe("Docs team · answer passed to the spec");
    expect(agentChoiceLine(agent())).toBe("Indicator sprint team · xai/grok-4.7");
    expect(agentChoiceLine(agent({ model: null }))).toBe("Indicator sprint team");
    expect(agentChoiceLine(agent({ scope: "all" }))).toBe(
      "Indicator sprint team · Can search it already",
    );
    expect(subscriptionNote("claude")).toBe(
      "On Tvashtr Desktop with your Claude plan it can’t search domains yet.",
    );
  });

  it("searches agents by title, team and model", () => {
    expect(matchesAgent(agent(), "sprint")).toBe(true);
    expect(matchesAgent(agent(), "GROK")).toBe(true);
    expect(matchesAgent(agent(), "writer")).toBe(false);
    expect(matchesAgent(agent(), "  ")).toBe(true);
  });

  it("names where a new step went", () => {
    const added = {
      node_id: "n",
      team_id: "t",
      title: "Look up support docs",
      after: { node_id: "a", title: "Product manager" },
      connected_to: { node_id: "b", title: "Writer" },
    };
    expect(addedStepToast(added)).toBe("Added after Product manager. Connected to Writer.");
    expect(addedStepToast({ ...added, connected_to: null })).toBe("Added after Product manager.");
  });
});
