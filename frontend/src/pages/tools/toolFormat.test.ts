import { describe, expect, it } from "vitest";

import type { ToolItem, UsageRow } from "../../lib/api/tools";
import {
  addFailedMessage,
  addServersLabel,
  agentsFailedToast,
  catalogAddedToast,
  githubInstalledToast,
  agentName,
  agentNames,
  heldAgentsLine,
  pageRemoveImpact,
  pastedToast,
  removeCardLine,
  removeImpact,
  savedToast,
  secretsLede,
  serversFoundLabel,
  toolAddedToast,
  toolSecretsSavedToast,
  turnedOnToast,
  usedByTitle,
  wizardSubtitle,
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

describe("Add tool wizard copy", () => {
  const reviewer: UsageRow = {
    node_id: "n-rev",
    role_name: "reviewer",
    title: null,
    team_id: "team-ind",
    team_name: "Indicator sprint team",
  };

  it("subtitles each step", () => {
    expect(wizardSubtitle(0, "linear")).toBe("Step 1 of 3");
    expect(wizardSubtitle(1, "linear")).toBe("linear · step 2 of 3");
    expect(wizardSubtitle(2, "linear")).toBe("linear · step 3 of 3");
  });

  it("opens step 3 by what's still unset", () => {
    expect(secretsLede("linear", 1, 1)).toBe(
      "linear uses one secret. Add its value now or later in Secrets.",
    );
    expect(secretsLede("jira", 2, 2)).toBe(
      "jira uses 2 secrets. Add their values now or later in Secrets.",
    );
    expect(secretsLede("jira", 3, 1)).toBe(
      "jira uses 3 secrets. Add the missing value now or later in Secrets.",
    );
    expect(secretsLede("github", 1, 0)).toBe("github uses one secret (already set).");
    expect(secretsLede("jira", 2, 0)).toBe("jira uses 2 secrets (all set).");
    expect(secretsLede("fetch", 0, 0)).toBe("fetch uses no secrets.");
  });

  it("says who it will turn on for", () => {
    expect(heldAgentsLine([])).toBe("You can also do this later, per agent.");
    expect(heldAgentsLine(["Reviewer"])).toBe("Turns on for Reviewer when you add it.");
    expect(heldAgentsLine(["Engineer", "Reviewer", "Writer"])).toBe(
      "Turns on for 3 agents when you add it.",
    );
  });

  it("toasts the add, naming the one agent it opens", () => {
    expect(toolAddedToast("linear", null)).toEqual({ message: "linear added.", agent: null });
    expect(toolAddedToast("linear", { agents: [reviewer], agent_count: 1, skipped: [] })).toEqual({
      message: "linear added and turned on for Reviewer.",
      agent: reviewer,
    });
    expect(
      toolAddedToast("linear", { agents: [reviewer, reviewer], agent_count: 2, skipped: [] })
        .message,
    ).toBe("linear added and turned on for 2 agents.");
    expect(toolAddedToast("linear", { agents: [], agent_count: 0, skipped: [{}] }).message).toBe(
      "linear added. 1 agent kept its own linear server.",
    );
  });

  it("names the submit step that failed", () => {
    expect(addFailedMessage({ secret: "LINEAR_TOKEN" }, null, [])).toBe(
      "Couldn’t save LINEAR_TOKEN. Try again. The tool isn’t added yet.",
    );
    expect(addFailedMessage({ secret: "B" }, "Too long.", ["A"])).toBe(
      "Couldn’t save B: Too long. A is saved. The tool isn’t added yet.",
    );
    expect(
      addFailedMessage({ tool: "linear" }, "You already have a tool named linear.", ["A", "B"]),
    ).toBe("Couldn’t add linear: You already have a tool named linear. A and B are saved.");
    expect(addFailedMessage({ tool: "linear" }, null, [])).toBe("Couldn’t add linear. Try again.");
    expect(agentsFailedToast("linear")).toBe(
      "linear added, but it couldn’t be turned on for your agents. Use Turn on for agents… in its ⋯ menu.",
    );
  });
});

describe("paste copy (TOOL-62..65)", () => {
  it("counts the servers found and the ones to add", () => {
    expect(serversFoundLabel(2)).toBe("2 servers found");
    expect(serversFoundLabel(1)).toBe("1 server found");
    expect(addServersLabel(2)).toBe("Add 2 servers");
    expect(addServersLabel(1)).toBe("Add 1 server");
    expect(addServersLabel(0)).toBe("Add servers");
  });

  it("toasts what was added and who still needs a secret", () => {
    const sqlite = tool("t-sqlite", "sqlite", { command: "uvx" });
    expect(pastedToast([LINEAR, sqlite])).toEqual({
      message: "2 servers added. linear needs a secret.",
      needs: [LINEAR],
    });
    expect(pastedToast([sqlite]).message).toBe("1 server added.");
    const jira = tool("t-jira", "jira", {}, { missing_secrets: ["JIRA_TOKEN", "JIRA_USER"] });
    expect(pastedToast([jira]).message).toBe("1 server added. jira needs 2 secrets.");
    expect(pastedToast([LINEAR, jira]).message).toBe(
      "2 servers added. linear and jira need secrets.",
    );
  });
});

describe("the tool page's copy", () => {
  const row = (role_name: string, team_id: string, team_name: string): UsageRow => ({
    node_id: `n-${role_name}-${team_id}`,
    role_name,
    title: null,
    team_id,
    team_name,
  });
  const three = [
    row("engineer", "t1", "Indicator sprint team"),
    row("reviewer", "t1", "Indicator sprint team"),
    row("writer", "t2", "Docs team"),
  ];

  it("titles Used by with agents and teams", () => {
    expect(usedByTitle(three)).toBe("Used by 3 agents in 2 teams");
    expect(usedByTitle(three.slice(0, 1))).toBe("Used by 1 agent in 1 team");
    expect(usedByTitle([])).toBe("Not used yet");
  });

  it("says who picks up a save (TOOL-57)", () => {
    expect(savedToast(3)).toBe("Saved. 3 agents use the new settings on their next run.");
    expect(savedToast(1)).toBe("Saved. 1 agent uses the new settings on its next run.");
    expect(savedToast(0)).toBe("Saved.");
  });

  it("says who loses it on the Remove card and in its confirmation (TOOL-58)", () => {
    expect(removeCardLine(3)).toBe("The 3 agents above lose it on their next run.");
    expect(removeCardLine(1)).toBe("The agent above loses it on its next run.");
    expect(removeCardLine(0)).toBe("No agents use it.");
    expect(pageRemoveImpact(three)).toBe(
      "Engineer, Reviewer and Writer lose it on their next run. You can add it again later.",
    );
    expect(pageRemoveImpact(three.slice(2))).toBe(
      "Writer loses it on its next run. You can add it again later.",
    );
    expect(pageRemoveImpact([])).toBe("No agents use it. You can add it again later.");
    expect(
      pageRemoveImpact([
        row("engineer", "t1", "Indicator sprint team"),
        row("engineer", "t2", "Docs team"),
      ]),
    ).toBe(
      "Engineer in Indicator sprint team and Engineer in Docs team lose it on their next run. You can add it again later.",
    );
  });
});
