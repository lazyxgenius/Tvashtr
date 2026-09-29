import { describe, expect, it } from "vitest";

import {
  FETCH_SERVER,
  addLibrary,
  addServer,
  domainsOf,
  enabledOf,
  formOf,
  refsOf,
  removeLibrary,
  removeServer,
  replaceServer,
  secretName,
  serverFrom,
  setDomains,
  setEnabled,
  targetProblem,
  toolRows,
  transportOf,
} from "./nodeTools";

const github = {
  type: "http",
  url: "https://api.githubcopilot.com/mcp",
  headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
};
const cfg = { mcpServers: { fetch: FETCH_SERVER, github } };

describe("nodeTools", () => {
  it("reads transports, the secrets a server uses (env/headers only) and the switches", () => {
    expect(transportOf(FETCH_SERVER)).toBe("stdio");
    expect(transportOf(github)).toBe("http");
    expect(transportOf({ url: "https://x", type: "sse" })).toBe("sse");
    expect(refsOf(github)).toEqual(["GITHUB_TOKEN"]);
    expect(refsOf({ url: "https://x/${NOT_FILLED}", env: { A: "${KEY}-x" } })).toEqual(["KEY"]);
    expect(enabledOf(cfg, "fetch")).toBe(true);
    expect(domainsOf(cfg)).toBe(false);
  });

  it("switches a server and Domains, and tidies back to null", () => {
    const off = setEnabled(cfg, "fetch", false);
    expect(enabledOf(off, "fetch")).toBe(false);
    expect(setEnabled(off, "fetch", true)).toEqual(cfg);
    const dom = setDomains(null, true);
    expect(dom).toEqual({ tvashtr: { domains: true } });
    expect(setDomains(dom, false)).toBeNull();
  });

  it("adds and removes servers and library references", () => {
    const one = addServer(null, "fetch", FETCH_SERVER);
    expect(one).toEqual({ mcpServers: { fetch: FETCH_SERVER } });
    expect(removeServer(setEnabled(one, "fetch", false), "fetch")).toBeNull();
    expect(removeLibrary({ tvashtr: { library: ["t1"] } }, "t1")).toBeNull();
  });

  it("lists rows with their badge and target (PANEL-94)", () => {
    const withLib = { ...cfg, tvashtr: { library: ["t-lin", "t-gone"] } };
    const library = [
      {
        id: "t-lin",
        name: "linear",
        server_config: { url: "https://mcp.linear.app/sse", headers: { A: "${LINEAR_TOKEN}" } },
        created_at: "",
      },
    ];
    const rows = toolRows(withLib, library, ["GITHUB_TOKEN"]);
    expect(rows.map((r) => [r.name, r.badge.label, r.target])).toEqual([
      ["fetch", "Local", "uvx mcp-server-fetch"],
      ["github", "Remote", "https://api.githubcopilot.com/mcp · ${GITHUB_TOKEN}"],
      ["linear", "Needs secret", "https://mcp.linear.app/sse · ${LINEAR_TOKEN}"],
      ["Removed from your library", "Library", ""],
    ]);
    // Unknown secrets flag nothing; an unloaded library names the row generically.
    const unknown = toolRows(withLib, null, null);
    expect(unknown.map((r) => r.badge.label)).toEqual(["Local", "Remote", "Library", "Library"]);
    expect(unknown[2].name).toBe("Library tool");
  });

  it("adds library ids once, and edits a server in place keeping its switch", () => {
    expect(addLibrary({ tvashtr: { library: ["t1"] } }, ["t1", "t2"])).toEqual({
      tvashtr: { library: ["t1", "t2"] },
    });
    const off = setEnabled(cfg, "fetch", false);
    const renamed = replaceServer(off, "fetch", "web", { command: "uvx", args: ["f"] });
    expect(Object.keys(renamed?.mcpServers as object)).toEqual(["web", "github"]);
    expect(enabledOf(renamed, "web")).toBe(false);
  });

  it("builds a server from the add form and back (Q14: headers / env rows)", () => {
    const rows = [
      { key: "Authorization", value: "Bearer ${LINEAR_TOKEN}" },
      { key: " ", value: "dropped" },
    ];
    const remote = serverFrom("remote", " https://mcp.linear.app/sse ", rows);
    expect(remote).toEqual({
      url: "https://mcp.linear.app/sse",
      headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
    });
    expect(formOf(remote)).toEqual({
      transport: "remote",
      target: "https://mcp.linear.app/sse",
      rows: [rows[0]],
    });
    const local = serverFrom("local", 'npx -y "my server" x', [], { type: "sse", timeout: 5 });
    expect(local).toEqual({ timeout: 5, command: "npx", args: ["-y", "my server", "x"] });
    expect(formOf(local).target).toBe('npx -y "my server" x');
    expect(serverFrom("local", "uvx a", [{ key: "K", value: "${K}" }]).env).toEqual({ K: "${K}" });
  });

  it("checks the URL or command, and names the hint's secret", () => {
    expect(targetProblem("remote", "https://mcp.linear.app/sse")).toBeNull();
    expect(targetProblem("remote", "mcp.linear.app")).toBe(
      "Use a URL that starts with https:// or http://.",
    );
    expect(targetProblem("remote", "ftp://x")).not.toBeNull();
    expect(targetProblem("remote", "https://x/${T}")).toBe(
      "Secrets aren’t filled in here. Put them in a header.",
    );
    expect(targetProblem("local", "uvx ${T}")).toMatch(/Put them in Env\.$/);
    expect(targetProblem("local", "uvx x")).toBeNull();
    expect(secretName("linear")).toBe("LINEAR_TOKEN");
    expect(secretName("my-db 2")).toBe("MY_DB_2_TOKEN");
    expect(secretName("")).toBe("MCP_TOKEN");
    expect(secretName("1x")).toBe("MCP_1X_TOKEN");
  });
});
