import { describe, expect, it } from "vitest";

import { summarizeEvent } from "./events";

describe("summarizeEvent", () => {
  it("summarizes an action (tool_name + thought)", () => {
    const s = summarizeEvent("action", {
      tool_name: "str_replace_editor",
      thought: "I will create greeting.txt",
      action: "write",
    });
    expect(s.tone).toBe("neutral");
    expect(s.label).toBe("action");
    expect(s.lead).toBe("str_replace_editor");
    expect(s.detail).toBe("I will create greeting.txt");
  });

  it("falls back to the action verb when there is no thought", () => {
    const s = summarizeEvent("action", { tool_name: "bash", action: "ls -la" });
    expect(s.detail).toBe("ls -la");
    expect(s.full).toBe("ls -la");
  });

  it("summarizes an observation", () => {
    const s = summarizeEvent("observation", {
      tool_name: "bash",
      observation: "file written\nexit 0",
    });
    expect(s.label).toBe("observation");
    expect(s.lead).toBe("bash");
    expect(s.detail).toBe("file written"); // first non-empty line
  });

  it("summarizes a message (source + text)", () => {
    const s = summarizeEvent("message", { source: "agent", text: "Done." });
    expect(s.label).toBe("message");
    expect(s.lead).toBe("agent");
    expect(s.detail).toBe("Done.");
  });

  it("flags an error with the danger tone", () => {
    const s = summarizeEvent("error", { error: "boom" });
    expect(s.tone).toBe("danger");
    expect(s.label).toBe("error");
    expect(s.lead).toBe("");
    expect(s.detail).toBe("boom");
  });

  it("handles the defensive { unparsed, error } fallback shape", () => {
    const s = summarizeEvent("weird", { unparsed: true, error: "could not parse" });
    expect(s.tone).toBe("neutral");
    expect(s.label).toBe("weird");
    expect(s.detail).toBe("could not parse");
  });

  it("labels an unknown empty event without throwing", () => {
    const s = summarizeEvent("", {});
    expect(s.label).toBe("event");
    expect(s.detail).toBe("");
    expect(s.lead).toBe("");
  });

  it("never throws on missing keys and yields empty strings", () => {
    const s = summarizeEvent("action", {});
    expect(s.lead).toBe("");
    expect(s.detail).toBe("");
    expect(s.full).toBe("");
  });

  it("caps an over-long detail with an ellipsis but keeps the full text", () => {
    const long = "x".repeat(400);
    const s = summarizeEvent("message", { source: "agent", text: long });
    expect(s.detail.length).toBeLessThanOrEqual(140);
    expect(s.detail.endsWith("…")).toBe(true);
    expect(s.full).toBe(long);
  });
});
