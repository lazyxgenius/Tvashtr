import { describe, expect, it } from "vitest";

import type { ToolItem, UsageRow } from "../../lib/api/tools";
import {
  catalogAddedToast,
  githubInstalledToast,
  agentName,
  agentNames,
  removeImpact,
  toolSecretsSavedToast,
  turnedOnToast,
} from "./toolFormat";
import { LINEAR, tool } from "./toolsTestUtils";

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

const row = (role_name: string, team_id: string, team_name: string): UsageRow => ({
  node_id: `${team_id}-${role_name}`,
  role_name,
  title: null,
  team_id,
  team_name,
});

describe("removeImpact (TOOL-49)", () => {
  it("names the agents by team, in the order met", () => {
    expect(
      removeImpact({ agent_count: 3, team_count: 2 }, [
        row("engineer", "a", "Indicator sprint team"),
        row("reviewer", "a", "Indicator sprint team"),
        row("writer", "b", "Docs team"),
      ]),
    ).toBe(
      "3 agents in 2 teams use it: Engineer and Reviewer in Indicator sprint team, Writer in Docs team. They lose it on their next run.",
    );
  });

  it("says one agent in the singular", () => {
    expect(removeImpact({ agent_count: 1, team_count: 1 }, [row("reviewer", "a", "Web")])).toBe(
      "1 agent in 1 team uses it: Reviewer in Web. It loses it on its next run.",
    );
  });

  it("falls back to the counts when the agents couldn't load", () => {
    expect(removeImpact({ agent_count: 2, team_count: 1 }, null)).toBe(
      "2 agents in 1 team use it. They lose it on their next run.",
    );
  });

  it("says no agents use an unused tool", () => {
    expect(removeImpact({ agent_count: 0, team_count: 0 }, [])).toBe("No agents use it.");
    expect(removeImpact({ agent_count: 0, team_count: 0 }, null)).toBe("No agents use it.");
  });
});

describe("toolSecretsSavedToast (TOOL-68)", () => {
  const ready: ToolItem = { ...LINEAR, missing_secrets: [], status: "ready" };

  it("says the tool is ready", () => {
    expect(toolSecretsSavedToast(["LINEAR_TOKEN"], "linear", ready)).toBe(
      "LINEAR_TOKEN saved. linear is ready.",
    );
    expect(toolSecretsSavedToast(["A_TOKEN", "B_TOKEN"], "jira", ready)).toBe(
      "A_TOKEN and B_TOKEN saved. jira is ready.",
    );
  });

  it("says what the tool still needs", () => {
    const still = tool(
      "t-j",
      "jira",
      {},
      {
        missing_secrets: ["B_TOKEN"],
        status: "needs_attention",
      },
    );
    expect(toolSecretsSavedToast(["A_TOKEN"], "jira", still)).toBe(
      "A_TOKEN saved. jira still needs B_TOKEN.",
    );
  });

  it("just says saved when the list couldn't be re-read", () => {
    expect(toolSecretsSavedToast(["LINEAR_TOKEN"], "linear", null)).toBe("LINEAR_TOKEN saved.");
  });
});

describe("turnedOnToast", () => {
  it("counts the agents and any that kept their own server", () => {
    expect(turnedOnToast("linear", 2, 0)).toBe("linear is on for 2 agents.");
    expect(turnedOnToast("linear", 0, 0)).toBe("linear is off for every agent.");
    expect(turnedOnToast("linear", 1, 1)).toBe(
      "linear is on for 1 agent. 1 agent kept its own linear server.",
    );
  });
});

describe("Browse toasts", () => {
  it("names the catalog entry and pluralises repos", () => {
    expect(catalogAddedToast("Web fetch")).toBe(
      "Web fetch added. Turn it on for an agent in its Skills & tools tab.",
    );
    expect(githubInstalledToast(2)).toBe("GitHub App installed on 2 repos.");
    expect(githubInstalledToast(1)).toBe("GitHub App installed on 1 repo.");
  });
});
