import { describe, expect, it } from "vitest";

import { credentialBlock, joinOr, validityBlock } from "./runBlocked";

describe("credentialBlock (engines.md ENG-77)", () => {
  it("website: names the providers and that subscriptions only work on Desktop", () => {
    expect(credentialBlock(["anthropic", "xai"], false)).toEqual({
      title: "Can’t run on the website yet.",
      detail: "No API key for anthropic or xai. Subscriptions only work on Tvashtr Desktop.",
      openEngines: true,
    });
    // No Desktop subscription runs openai, so the callout doesn't mention one.
    expect(credentialBlock(["openai"], false)?.detail).toBe("No API key for openai.");
  });

  it("Desktop: a key or a connected subscription would cover it", () => {
    expect(credentialBlock(["xai"], true)).toEqual({
      title: "Can’t run yet.",
      detail: "No API key or connected subscription for xai.",
      openEngines: true,
    });
    expect(credentialBlock([], true)).toBeNull();
  });

  it("joinOr", () => {
    expect(joinOr(["a", "b", "c"])).toBe("a, b or c");
  });
});

describe("validityBlock", () => {
  it("shows the first two findings and counts the rest", () => {
    const issue = (message: string) => ({ code: "x", message, node_id: null, edge_id: null });
    expect(validityBlock([issue("One."), issue("Two."), issue("Three.")])).toEqual({
      title: "Can’t run yet.",
      detail: "One. Two. …and 1 more.",
      openEngines: false,
    });
    expect(validityBlock([])).toBeNull();
  });

  it("says a finding repeated on several nodes once (two starting points)", () => {
    const roots = ["n-pm", "n-new"].map((node_id) => ({
      code: "multiple_roots",
      message: "More than one starting point (2) — a team needs exactly one.",
      node_id,
      edge_id: null,
    }));
    expect(validityBlock(roots)?.detail).toBe(
      "More than one starting point (2) — a team needs exactly one.",
    );
  });
});
