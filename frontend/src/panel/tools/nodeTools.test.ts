import { describe, expect, it } from "vitest";

import {
  FETCH_SERVER,
  addServer,
  domainsOf,
  enabledOf,
  refsOf,
  removeLibrary,
  removeServer,
  setDomains,
  setEnabled,
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
});
