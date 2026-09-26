import { describe, expect, it } from "vitest";

import {
  EMPTY_SERVERS,
  NO_SERVERS,
  UNNAMED_SERVER,
  literalSecrets,
  readMcpJson,
  scanJson,
  secretNameOf,
  toolSlug,
  withSecretsMoved,
} from "./mcpJson";

/** The design's paste (TkF-Paste-1): the comma after linear's entry is missing. */
const MISSING_COMMA = `{
  "mcpServers": {
    "linear": { "url": "https://mcp.linear.app/sse" }
    "sqlite": { "command": "uvx", "args": ["mcp-server-sqlite"] }
  }
}`;
const FIXED = MISSING_COMMA.replace('sse" }\n', 'sse" },\n');

const errorOf = (text: string) => scanJson(text).error;

describe("scanJson — friendly, line-numbered mistakes", () => {
  it("names the entry a comma is missing after, on the line it belongs", () => {
    expect(errorOf(MISSING_COMMA)).toBe("Line 3: add a comma after the linear entry.");
  });

  it("keeps reading past the mistake, so the servers still count", () => {
    const { value } = scanJson(MISSING_COMMA);
    expect(value).toEqual({
      mcpServers: {
        linear: { url: "https://mcp.linear.app/sse" },
        sqlite: { command: "uvx", args: ["mcp-server-sqlite"] },
      },
    });
  });

  it("reads valid JSON exactly like JSON.parse", () => {
    const { value, error } = scanJson(FIXED);
    expect(error).toBeNull();
    expect(value).toEqual(JSON.parse(FIXED));
    const tricky = '{"a": "x\\"y\\u00e9\\n", "b": [1, -2.5e3, true, false, null], "c": {}}';
    expect(scanJson(tricky)).toEqual({ value: JSON.parse(tricky) as unknown, error: null });
  });

  it("accepts VS Code's comments and trailing commas", () => {
    const jsonc = `{
  // my servers
  "servers": {
    /* the fetch one */
    "fetch": { "command": "uvx", "args": ["mcp-server-fetch",], },
  },
}`;
    expect(scanJson(jsonc)).toEqual({
      value: { servers: { fetch: { command: "uvx", args: ["mcp-server-fetch"] } } },
      error: null,
    });
  });

  it("says what to fix for the usual slips", () => {
    expect(errorOf('{\n  "linear" { "url": "x" }\n}')).toBe('Line 2: add a colon after "linear".');
    expect(errorOf("{\n  linear: {}\n}")).toBe("Line 2: put linear in double quotes.");
    expect(errorOf("{\n  'linear': {}\n}")).toBe("Line 2: use double quotes, not single quotes.");
    expect(errorOf('{\n  "url": "https://mcp.linear.app/sse\n}')).toBe(
      'Line 2: close the quote after "https://mcp.linear.app/sse".',
    );
    expect(errorOf('{\n  "mcpServers": {\n    "a": {}\n')).toBe(
      "Line 3: add a } to close the mcpServers entry.",
    );
    expect(errorOf('{\n  "a": {}\n}\n}')).toBe("Line 4: remove the extra }.");
    expect(errorOf('{"a": True}')).toBe("Line 1: use true instead of True.");
    expect(errorOf('{\n  "args": ["a"\n    "b"]\n}')).toBe(
      "Line 2: add a comma between the args items.",
    );
    expect(errorOf('{"a": 1,, "b": 2}')).toBe("Line 1: remove the extra comma.");
    expect(errorOf('{"a": }')).toBe('Line 1: add a value after "a".');
    expect(errorOf("hello")).toBe("Line 1: paste the whole file, starting with {.");
  });

  it("reads servers pasted without the outer braces", () => {
    expect(scanJson('"fetch": { "command": "uvx" }')).toEqual({
      value: { fetch: { command: "uvx" } },
      error: null,
    });
  });

  it("is quiet for blank text", () => {
    expect(scanJson("  \n ")).toEqual({ value: undefined, error: null });
  });
});

describe("readMcpJson — the servers", () => {
  it("lists linear (Remote) and sqlite (Local) from mcpServers", () => {
    const read = readMcpJson(FIXED, [], new Set());
    expect(read.error).toBeNull();
    expect(read.servers.map((s) => [s.name, s.transport, s.problem, s.replaces])).toEqual([
      ["linear", "remote", null, false],
      ["sqlite", "local", null, false],
    ]);
  });

  it("still counts the servers while the JSON has a mistake", () => {
    const read = readMcpJson(MISSING_COMMA, [], new Set());
    expect(read.error).toBe("Line 3: add a comma after the linear entry.");
    expect(read.servers).toHaveLength(2);
  });

  it("flags a name you already have: adding it replaces yours", () => {
    const read = readMcpJson(FIXED, ["linear", "fetch"], new Set());
    expect(read.servers.map((s) => s.replaces)).toEqual([true, false]);
  });

  it("reads VS Code: servers, ${input:x} / ${env:X} → ${X}, no type stdio", () => {
    const vscode = JSON.stringify({
      inputs: [{ id: "github-pat", type: "promptString", password: true }],
      servers: {
        github: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${input:github-pat}", HOME: "${env:HOME}" },
        },
        remote: { type: "http", url: "https://example.com/mcp" },
      },
    });
    const [github, remote] = readMcpJson(vscode, [], new Set()).servers;
    expect(github.config).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PAT}", HOME: "${HOME}" },
    });
    expect(github.secrets).toEqual([]);
    expect(remote.config).toEqual({ type: "http", url: "https://example.com/mcp" });
    // settings.json keeps them under "mcp".
    const settings = JSON.stringify({ mcp: { servers: { a: { command: "x" } } } });
    expect(readMcpJson(settings, [], new Set()).servers.map((s) => s.name)).toEqual(["a"]);
  });

  it("fits names to the tool-name rule and says why a server can't be added", () => {
    const text = JSON.stringify({
      mcpServers: {
        "My Server": { command: "uvx" },
        "my-server": { command: "npx" },
        broken: { args: ["x"] },
        both: { command: "x", url: "https://y" },
        ftp: { url: "ftp://y" },
        "!!!": { command: "x" },
      },
    });
    const servers = readMcpJson(text, [], new Set()).servers;
    expect(servers.map((s) => [s.name, s.pastedAs, s.problem])).toEqual([
      ["my-server", "My Server", null],
      ["my-server", null, "Another server here has this name."],
      ["broken", null, "Add a command or a URL."],
      ["both", null, "Use a command or a URL, not both."],
      ["ftp", null, "Use an http:// or https:// URL."],
      ["!!!", "!!!", "Give it a name with letters or numbers."],
    ]);
  });

  it("says when there are no servers to find", () => {
    expect(readMcpJson('{"theme": "dark"}', [], new Set()).error).toBe(NO_SERVERS);
    expect(readMcpJson('{"mcpServers": {}}', [], new Set()).error).toBe(EMPTY_SERVERS);
    expect(readMcpJson('{"command": "uvx"}', [], new Set()).error).toBe(UNNAMED_SERVER);
    expect(readMcpJson("", [], new Set())).toEqual({ error: null, servers: [] });
  });
});

describe("secrets written out in full (spec Q13)", () => {
  it("finds token-like env values and Bearer headers, named so nothing clashes", () => {
    const taken = new Set(["LINEAR_TOKEN"]);
    expect(
      literalSecrets(
        "linear",
        {
          url: "https://mcp.linear.app/sse",
          headers: { Authorization: "Bearer lin_api_4f9c2d1e8b7a", "X-Api-Key": "k-1234567890" },
        },
        taken,
      ),
    ).toEqual([
      {
        block: "headers",
        key: "Authorization",
        name: "LINEAR_TOKEN_2",
        value: "lin_api_4f9c2d1e8b7a",
        prefix: "Bearer ",
      },
      {
        block: "headers",
        key: "X-Api-Key",
        name: "LINEAR_X_API_KEY",
        value: "k-1234567890",
        prefix: "",
      },
    ]);
    // Short values, flags, refs and non-secret keys stay.
    expect(
      literalSecrets(
        "sqlite",
        {
          command: "uvx",
          env: {
            SQLITE_READONLY: "true",
            API_KEY: "${SQLITE_API_KEY}",
            TOKEN_TTL: "60",
            DB_PATH: "/data/a-long-path.db",
          },
        },
        new Set(),
      ),
    ).toEqual([]);
  });

  it("swaps a moved value for its ${NAME}, keeping a header's Bearer", () => {
    const config = {
      url: "https://x.dev/mcp",
      headers: { Authorization: "Bearer abcdefgh123" },
      env: { API_KEY: "sk-1234567890" },
    };
    const secrets = literalSecrets("x", config, new Set());
    expect(withSecretsMoved(config, secrets)).toEqual({
      url: "https://x.dev/mcp",
      headers: { Authorization: "Bearer ${X_TOKEN}" },
      env: { API_KEY: "${API_KEY}" },
    });
    expect(config.env.API_KEY).toBe("sk-1234567890");
  });

  it("makes names from ids", () => {
    expect(secretNameOf("github-pat")).toBe("GITHUB_PAT");
    expect(secretNameOf("2fa code")).toBe("_2FA_CODE");
    expect(secretNameOf("--")).toBe("SECRET");
    expect(toolSlug("  My Server!! ")).toBe("my-server");
  });
});
