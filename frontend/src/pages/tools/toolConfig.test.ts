import { describe, expect, it } from "vitest";

import { buildServerConfig, rowsOfBlock, runsLabel, secretRefsOf, transportOf } from "./toolConfig";
import { needsLabel, plural, sortTools, usedByLabel } from "./toolFormat";
import { FETCH, GITHUB, LINEAR, tool } from "./toolsTestUtils";

// server_config is the INNER object ({command,args,env} / {url,headers}) — never mcpServers-wrapped.
describe("buildServerConfig (pure)", () => {
  it("builds a local stdio config and splits args on whitespace", () => {
    expect(buildServerConfig("local", "uvx", "mcp-server-fetch  --port 3000", [])).toEqual({
      command: "uvx",
      args: ["mcp-server-fetch", "--port", "3000"],
    });
  });

  it("emits args:[] for a local server with no args (never omits the key)", () => {
    expect(buildServerConfig("local", "uvx", "   ", [])).toEqual({ command: "uvx", args: [] });
  });

  it("folds env rows into a local `env` map, dropping blank keys", () => {
    expect(
      buildServerConfig("local", "uvx", "x", [
        { key: "API_KEY", value: "${OPENAI_KEY}" },
        { key: "  ", value: "ignored" },
      ]),
    ).toEqual({ command: "uvx", args: ["x"], env: { API_KEY: "${OPENAI_KEY}" } });
  });

  it("builds a remote http config from the url, ignoring args", () => {
    expect(buildServerConfig("remote", "https://ex/mcp", "these are ignored", [])).toEqual({
      url: "https://ex/mcp",
    });
  });

  it("folds header rows into a remote `headers` map (not env)", () => {
    expect(
      buildServerConfig("remote", "https://ex/mcp", "", [
        { key: "Authorization", value: "Bearer ${TOKEN}" },
      ]),
    ).toEqual({ url: "https://ex/mcp", headers: { Authorization: "Bearer ${TOKEN}" } });
  });

  it("omits env/headers entirely when no non-blank rows exist", () => {
    expect(buildServerConfig("local", "uvx", "", [{ key: "", value: "v" }])).toEqual({
      command: "uvx",
      args: [],
    });
    expect(buildServerConfig("remote", "https://ex/mcp", "", [])).toEqual({
      url: "https://ex/mcp",
    });
  });
});

describe("transportOf / runsLabel", () => {
  it("is Local with a command and shows the command line", () => {
    expect(transportOf({ command: "uvx", args: ["mcp-server-fetch"] })).toBe("local");
    expect(runsLabel({ command: "uvx", args: ["mcp-server-fetch"] })).toBe("uvx mcp-server-fetch");
    expect(runsLabel({ command: "npx" })).toBe("npx");
  });

  it("is Remote with a URL and shows it without the scheme or trailing slash", () => {
    expect(transportOf({ url: "https://api.githubcopilot.com/mcp/" })).toBe("remote");
    expect(runsLabel({ url: "https://api.githubcopilot.com/mcp/" })).toBe(
      "api.githubcopilot.com/mcp",
    );
    expect(runsLabel({ url: "http://localhost:3000/sse" })).toBe("localhost:3000/sse");
  });

  it("is neither for an empty config", () => {
    expect(transportOf({})).toBeNull();
    expect(runsLabel({})).toBe("");
  });
});

describe("secretRefsOf / rowsOfBlock", () => {
  it("reads ${NAME} refs from env and header values only", () => {
    expect(
      secretRefsOf({
        url: "https://x/${NOT_THIS}",
        headers: { Authorization: "Bearer ${B_TOKEN}", X: "${A_KEY}${B_TOKEN}" },
      }),
    ).toEqual(["A_KEY", "B_TOKEN"]);
    expect(secretRefsOf({ command: "uvx", env: { K: "${SQLITE_API_KEY}", L: "true" } })).toEqual([
      "SQLITE_API_KEY",
    ]);
  });

  it("turns a block back into rows", () => {
    expect(rowsOfBlock({ A: "1", B: 2 })).toEqual([
      { key: "A", value: "1" },
      { key: "B", value: "2" },
    ]);
    expect(rowsOfBlock(null)).toEqual([]);
  });
});

describe("tool copy", () => {
  it("pluralises usage, or says it isn't used", () => {
    expect(plural(1, "agent")).toBe("1 agent");
    expect(usedByLabel({ agent_count: 3, team_count: 2 })).toBe("3 agents · 2 teams");
    expect(usedByLabel({ agent_count: 1, team_count: 1 })).toBe("1 agent · 1 team");
    expect(usedByLabel({ agent_count: 0, team_count: 0 })).toBe("Not used yet");
  });

  it("names one missing secret, counts several, and flags a config that can't connect", () => {
    expect(needsLabel(LINEAR)).toBe("Needs LINEAR_TOKEN");
    expect(needsLabel({ ...LINEAR, missing_secrets: ["A", "B"] })).toBe("Needs 2 secrets");
    expect(needsLabel({ ...LINEAR, missing_secrets: [] })).toBe("Needs a command or URL");
  });

  it("sorts A→Z, case-insensitively, with fresh rows first", () => {
    const Beta = tool("t-b", "Beta", { command: "x" });
    expect(sortTools([LINEAR, Beta, GITHUB, FETCH], []).map((t) => t.name)).toEqual([
      "Beta",
      "fetch",
      "github",
      "linear",
    ]);
    expect(sortTools([LINEAR, GITHUB, FETCH], ["t-linear"]).map((t) => t.name)).toEqual([
      "linear",
      "fetch",
      "github",
    ]);
  });
});
