import { describe, expect, it } from "vitest";

import type { DesktopTemplateNode } from "../../../lib/api/desktop";
import { chipName, runsOnLabel, SETUP_TEAM_CARDS } from "./teamCards";

const node = (over: Partial<DesktopTemplateNode>): DesktopTemplateNode => ({
  role: "pm",
  kind: "thinker",
  label: "PM",
  model: "xai/grok-4.7",
  runs_on: "grok",
  ...over,
});

describe("First team strip labels (DT-35)", () => {
  it("names the chips as the design does", () => {
    expect(chipName(node({ role: "pm" }))).toBe("Product manager");
    expect(chipName(node({ role: "gate", kind: "gate" }))).toBe("You approve");
    expect(chipName(node({ role: "engineer" }))).toBe("Engineer");
    expect(chipName(node({ role: "reviewer" }))).toBe("Reviewer");
    expect(chipName(node({ role: "ship", kind: "terminal" }))).toBe("Ship PR");
    expect(chipName(node({ role: "architect", label: "Architect" }))).toBe("Architect");
  });

  it("labels where each model node runs, and nothing under gates or Ship", () => {
    expect(runsOnLabel(node({ runs_on: "grok" }))).toBe("Grok plan");
    expect(runsOnLabel(node({ kind: "worker", runs_on: "claude" }))).toBe("Claude plan");
    expect(runsOnLabel(node({ runs_on: "api_key" }))).toBe("API key");
    expect(runsOnLabel(node({ runs_on: null }))).toBe("Needs setup");
    expect(runsOnLabel(node({ kind: "gate", model: null, runs_on: null }))).toBeNull();
    expect(runsOnLabel(node({ kind: "terminal", model: null, runs_on: null }))).toBeNull();
  });

  it("offers Plan, build, review (recommended) and Blank canvas — not Spec only (its run can't end completed yet)", () => {
    expect(SETUP_TEAM_CARDS.map((c) => [c.template, c.title])).toEqual([
      ["review_loop", "Plan, build, review"],
      ["blank", "Blank canvas"],
    ]);
    expect(SETUP_TEAM_CARDS[1].description).toBe("Start with one agent and add your own.");
  });
});
