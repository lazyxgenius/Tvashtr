import { describe, expect, it } from "vitest";

import { parseMcpJson } from "./pasteMcpJson";

const names = (text: string) => {
  const r = parseMcpJson(text);
  return r.state === "ok" ? r.servers.map((s) => s.name) : r;
};

describe("parseMcpJson", () => {
  it("reads Claude/Cursor, VS Code and bare maps", () => {
    expect(names('{"mcpServers": {"linear": {"url": "https://mcp.linear.app/sse"}}}')).toEqual([
      "linear",
    ]);
    const vscode = parseMcpJson('{"servers": {"db": {"type": "stdio", "command": "uvx"}}}');
    expect(vscode).toEqual({
      state: "ok",
      servers: [{ name: "db", server: { command: "uvx" } }],
      skipped: [],
    });
    expect(names('{"a": {"command": "x"}, "b": {"url": "https://b"}}')).toEqual(["a", "b"]);
  });

  it("tolerates comments, trailing commas and members pasted without braces", () => {
    const jsonc = `{
      // Claude Desktop
      "mcpServers": {
        "a": { "command": "uvx", "args": ["x",], }, /* the url one */
        "b": { "url": "https://b/*not-a-comment*/" }, // last
      },
    }`;
    expect(names(jsonc)).toEqual(["a", "b"]);
    const r = parseMcpJson(jsonc);
    expect(r.state === "ok" && r.servers[1].server.url).toBe("https://b/*not-a-comment*/");
    expect(names('"a": {"command": "x"},\n"b": {"url": "https://b"}')).toEqual(["a", "b"]);
  });

  it("skips entries that aren't servers and explains a broken or nameless paste", () => {
    expect(parseMcpJson('{"mcpServers": {"a": {"command": "x"}, "b": {"note": 1}}}')).toMatchObject(
      { state: "ok", skipped: ["b"] },
    );
    expect(parseMcpJson("  ")).toEqual({ state: "empty" });
    const broken = parseMcpJson('{\n  "a": {"command": "x"}\n  "b": {"command": "y"}\n}');
    expect(broken).toEqual({
      state: "error",
      message: "That isn’t valid JSON — Line 2: add a comma after the object.",
    });
    expect(parseMcpJson('{"url": "https://x"}')).toEqual({
      state: "error",
      message: 'This server has no name. Paste it as { "mcpServers": { "<name>": … } }.',
    });
  });
});
