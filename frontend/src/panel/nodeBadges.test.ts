import { afterEach, describe, expect, it } from "vitest";

import { setProviderCatalogue } from "../lib/api";
import { modelId, modelLabel, statusBadge } from "./nodeBadges";

afterEach(() => setProviderCatalogue([]));

const run = (over: Record<string, unknown>) => ({
  outcome: null,
  outcome_detail: null,
  run_id: "r",
  iteration: 1,
  started_at: new Date(Date.now() - 33 * 60_000).toISOString(),
  ended_at: new Date(Date.now() - 31 * 60_000).toISOString(),
  status: "done",
  ...over,
});

describe("statusBadge (PANEL-13)", () => {
  it("names the outcome and when", () => {
    expect(statusBadge(run({ outcome: "changes_requested" }))).toMatchObject({
      label: "Changes requested · 31m ago",
      variant: "accent",
      dot: true,
    });
    expect(statusBadge(run({ outcome: "prd_written" }))).toMatchObject({
      label: "Done · 31m ago",
      variant: "success",
    });
    expect(statusBadge(run({ outcome: "approved" })).label).toBe("Approved · 31m ago");
    expect(statusBadge(run({ status: "failed" }))).toMatchObject({ variant: "danger" });
    expect(statusBadge(run({ status: "running" })).label).toBe("Running");
  });

  it("an agent that never ran", () => {
    expect(statusBadge(null)).toEqual({
      label: "Not run yet",
      variant: "neutral",
      dot: true,
      hasRun: false,
    });
  });
});

describe("modelLabel (PANEL-15)", () => {
  it("uses the catalogue's friendly name, else the id without its provider", () => {
    setProviderCatalogue([
      {
        provider: "xai",
        thinker_default: null,
        worker_default: null,
        thinker_presets: [],
        worker_presets: [],
        model_labels: { "xai/grok-4.7": "Grok 4.7" },
      },
    ]);
    expect(modelLabel("xai/grok-4.7")).toBe("Grok 4.7");
    expect(modelLabel("openai/gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(modelId("groq/openai/gpt-oss-120b")).toBe("openai/gpt-oss-120b");
  });
});
