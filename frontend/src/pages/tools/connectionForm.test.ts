import { describe, expect, it } from "vitest";

import {
  EMPTY_CONNECTION,
  RAW_JSON_INVALID,
  RAW_JSON_NOT_OBJECT,
  configText,
  configToForm,
  connectionError,
  defaultPick,
  formToConfig,
  openRefAt,
  parseConfigText,
  pickerOptions,
  secretOptions,
  suggestedSecret,
  toolNameError,
  valueSegments,
} from "./connectionForm";

const LINEAR = {
  ...EMPTY_CONNECTION,
  url: "https://mcp.linear.app/sse",
  headers: [{ key: "Authorization", value: "Bearer ${LINEAR_TOKEN}" }],
};

describe("connection form ⇄ server_config", () => {
  it("builds the chosen transport's config only, keeping raw-JSON extras", () => {
    expect(formToConfig(LINEAR)).toEqual({
      url: "https://mcp.linear.app/sse",
      headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
    });
    const local = { ...LINEAR, transport: "local" as const, command: "uvx", args: "a  b" };
    expect(formToConfig(local)).toEqual({ command: "uvx", args: ["a", "b"] });
    expect(formToConfig({ ...LINEAR, extras: { type: "sse" } })).toMatchObject({ type: "sse" });
  });

  it("prints the design's raw JSON", () => {
    expect(configText(LINEAR)).toBe(
      '{\n  "url": "https://mcp.linear.app/sse",\n  "headers": {\n    "Authorization": "Bearer ${LINEAR_TOKEN}"\n  }\n}',
    );
  });

  it("reads a config back into the form; the other transport's fields stay", () => {
    const prev = { ...EMPTY_CONNECTION, command: "npx" };
    const form = configToForm({ url: "https://x.dev/mcp", type: "sse", headers: { A: "b" } }, prev);
    expect(form).toMatchObject({
      transport: "remote",
      url: "https://x.dev/mcp",
      command: "npx",
      headers: [{ key: "A", value: "b" }],
      extras: { type: "sse" },
    });
    expect(
      configToForm({ command: "uvx", args: ["mcp-server-sqlite"], env: { K: "v" } }, prev),
    ).toMatchObject({
      transport: "local",
      command: "uvx",
      args: "mcp-server-sqlite",
      env: [{ key: "K", value: "v" }],
    });
    // Neither a URL nor a command: keep where it runs.
    expect(configToForm({}, { ...prev, transport: "local" }).transport).toBe("local");
  });

  it("parses typed raw JSON, or says why not", () => {
    expect(parseConfigText('{"url": "https://x"}')).toEqual({ config: { url: "https://x" } });
    expect(parseConfigText('{"url": ')).toEqual({ error: RAW_JSON_INVALID });
    expect(parseConfigText("[1]")).toEqual({ error: RAW_JSON_NOT_OBJECT });
    expect(parseConfigText("null")).toEqual({ error: RAW_JSON_NOT_OBJECT });
  });
});

describe("validation", () => {
  it("needs an http(s) URL for Remote and a command for Local", () => {
    expect(connectionError(EMPTY_CONNECTION)).toBe("Add the server’s URL.");
    expect(connectionError({ ...EMPTY_CONNECTION, url: "ftp://x" })).toBe(
      "Use an http:// or https:// URL.",
    );
    expect(connectionError(LINEAR)).toBeNull();
    const local = { ...EMPTY_CONNECTION, transport: "local" as const };
    expect(connectionError(local)).toBe("Add the command that starts the server.");
    expect(connectionError({ ...local, command: "uvx" })).toBeNull();
  });

  it("checks the tool name rule and that it's not taken", () => {
    expect(toolNameError(" ", [])).toBe("Give the tool a name.");
    expect(toolNameError("My Server", [])).toBe(
      "Use lowercase letters, numbers, - and _, like my-server.",
    );
    expect(toolNameError("linear", ["linear"])).toBe("You already have a tool named linear.");
    expect(toolNameError("my-server_2", ["linear"])).toBeNull();
  });
});

describe("secret references", () => {
  it("splits a value into text and ${NAME} chips", () => {
    expect(valueSegments("Bearer ${LINEAR_TOKEN}")).toEqual([
      { kind: "text", text: "Bearer " },
      { kind: "ref", name: "LINEAR_TOKEN" },
    ]);
    expect(valueSegments("${A}-${B}")).toEqual([
      { kind: "ref", name: "A" },
      { kind: "text", text: "-" },
      { kind: "ref", name: "B" },
    ]);
    expect(valueSegments("plain")).toEqual([{ kind: "text", text: "plain" }]);
  });

  it("finds the ${partial being typed before the caret", () => {
    expect(openRefAt("Bearer ${", 9)).toEqual({ start: 7, typed: "" });
    expect(openRefAt("Bearer ${LIN", 12)).toEqual({ start: 7, typed: "LIN" });
    expect(openRefAt("Bearer ${LIN}", 13)).toBeNull();
    expect(openRefAt("Bearer $", 8)).toBeNull();
  });

  it("offers the stored secrets with their usage, then Create <TOOL>_TOKEN", () => {
    const opts = secretOptions({
      secrets: [
        { name: "SENTRY_TOKEN", created_at: null, updated_at: null, used_by_tools: [] },
        {
          name: "GITHUB_TOKEN",
          created_at: null,
          updated_at: null,
          used_by_tools: [
            { id: "1", name: "github" },
            { id: "2", name: "gh-copy" },
          ],
        },
      ],
      missing: [{ name: "LINEAR_TOKEN", used_by_tools: [] }],
    });
    expect(opts).toEqual([
      { name: "GITHUB_TOKEN", usage: "used by github, gh-copy" },
      { name: "SENTRY_TOKEN", usage: "not used" },
    ]);
    const suggestion = suggestedSecret("linear");
    expect(suggestion).toBe("LINEAR_TOKEN");
    const all = pickerOptions(opts, "", suggestion);
    expect(all.map((o) => `${o.kind}:${o.name}`)).toEqual([
      "secret:GITHUB_TOKEN",
      "secret:SENTRY_TOKEN",
      "create:LINEAR_TOKEN",
    ]);
    expect(defaultPick(all, suggestion)).toBe(2);
    // Typing filters; a start of the suggestion keeps it, anything else creates what you typed.
    expect(pickerOptions(opts, "lin", suggestion)).toEqual([
      { kind: "create", name: "LINEAR_TOKEN" },
    ]);
    expect(pickerOptions(opts, "git", suggestion).map((o) => o.name)).toEqual([
      "GITHUB_TOKEN",
      "GIT",
    ]);
    // No Create for a name that already exists.
    expect(pickerOptions(opts, "", "GITHUB_TOKEN").map((o) => o.kind)).toEqual([
      "secret",
      "secret",
    ]);
  });
});
