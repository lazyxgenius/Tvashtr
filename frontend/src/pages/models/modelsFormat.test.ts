import { describe, expect, it } from "vitest";

import type { ProviderCatalogueEntry } from "../../lib/api";
import type { ModelRun } from "../../lib/api/models";
import { parseRoute, routeToHash, sectionOf } from "../../lib/nav";
import {
  aboutMoney,
  ago,
  compareOption,
  defaultPair,
  estimateLine,
  estimateTotal,
  judgeLine,
  kindChip,
  modelName,
  modelRows,
  money,
  percent,
  runButtonLabel,
  runCost,
  runSpeed,
  scoringHint,
  shortModel,
  unlistedLine,
} from "./modelsFormat";

function run(over: Partial<ModelRun> = {}): ModelRun {
  return {
    run_id: "r1",
    model_slug: "deepseek/deepseek-chat",
    model_name: "deepseek-chat",
    provider_label: "DeepSeek",
    version: 4,
    status: "completed",
    stop_requested: false,
    cases_total: 50,
    done: 50,
    passed: 46,
    failed: 4,
    errors: 0,
    first_error: null,
    price_known: true,
    estimate_usd: 0.2,
    cost_usd: 0.2,
    judge_cost_usd: 0.01,
    total_usd: 0.21,
    avg_latency_ms: 1400,
    error_message: null,
    created_at: "2026-11-01T10:00:00Z",
    completed_at: "2026-11-01T10:00:00Z",
    ...over,
  };
}

const CATALOGUE: ProviderCatalogueEntry[] = [
  {
    provider: "vertex_ai",
    label: "Google Cloud",
    thinker_default: "vertex_ai/flash",
    worker_default: null,
    thinker_presets: ["vertex_ai/flash", "vertex_ai/pro"],
    worker_presets: [],
  },
  {
    provider: "nvidia_nim",
    label: "NVIDIA NIM",
    thinker_default: "nvidia_nim/meta/llama",
    worker_default: null,
    thinker_presets: ["nvidia_nim/meta/llama"],
    worker_presets: [],
  },
  {
    provider: "groq",
    label: "Groq",
    thinker_default: "groq/openai/gpt-oss-120b",
    worker_default: null,
    thinker_presets: ["groq/openai/gpt-oss-120b", "groq/other"],
    worker_presets: [],
  },
  {
    provider: "openai",
    label: "OpenAI",
    thinker_default: null,
    worker_default: null,
    thinker_presets: ["openai/none"],
    worker_presets: [],
  },
];

describe("money", () => {
  it("is two decimals, and below a cent <$0.01", () => {
    expect(money(0.21)).toBe("$0.21");
    expect(money(1.005)).toBe("$1.00");
    expect(money(0.009)).toBe("<$0.01");
    expect(money(0)).toBe("$0.00");
    expect(aboutMoney(0.23)).toBe("about $0.23");
    expect(aboutMoney(0.001)).toBe("about <$0.01");
  });
});

describe("ago", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  it("reads like the design", () => {
    expect(ago("2026-11-01T11:59:40Z", now)).toBe("just now");
    expect(ago("2026-11-01T11:55:00Z", now)).toBe("5 min ago");
    expect(ago("2026-11-01T10:00:00Z", now)).toBe("2 h ago");
    expect(ago("2026-10-29T12:00:00Z", now)).toBe("3 d ago");
    expect(ago(null, now)).toBe("");
  });
});

describe("labels", () => {
  it("names a model by its last segment, and shortens claude-", () => {
    expect(modelName("groq/openai/gpt-oss-120b")).toBe("gpt-oss-120b");
    expect(shortModel("anthropic/claude-sonnet-5-5")).toBe("sonnet-5-5");
    expect(shortModel("groq/openai/gpt-oss-120b")).toBe("gpt-oss-120b");
  });
  it("gives the kind's chip", () => {
    expect(kindChip({ answer_kind: "choice", choices: ["a", "b"] })).toBe(
      "Pick from a list · 2 choices",
    );
    expect(kindChip({ answer_kind: "text", choices: [] })).toBe("Write text");
  });
  it("gives each way of scoring its hint", () => {
    expect(scoringHint("exact", false)).toBe(
      "The answer must match the expected answer. Case, spaces and a final full stop don't matter.",
    );
    expect(scoringHint("contains", false)).toBe(
      "The answer passes if it contains every word or phrase below.",
    );
    expect(scoringHint("judge", false)).toBe(
      "An AI judge reads the answer against your rubric and says pass or fail, with a reason.",
    );
    expect(scoringHint("exact", true)).toBe("Pick-from-a-list tests are scored by exact match.");
  });
  it("shows a run's cost, speed and percent", () => {
    expect(runCost(run())).toBe("$0.21 for all 50");
    expect(runCost(run({ status: "stopped" }))).toBe("$0.21 so far");
    expect(runCost(run({ price_known: false }))).toBe("cost not listed");
    expect(runSpeed(run())).toBe("1.4 s per answer");
    expect(runSpeed(run({ avg_latency_ms: null }))).toBeNull();
    expect(percent(46, 50)).toBe(92);
    expect(percent(0, 0)).toBe(0);
    expect(compareOption(run())).toBe("deepseek-chat · 46 / 50");
  });
});

describe("the Run dialog's rows", () => {
  it("lists held presets first, then each missing provider's default; never NVIDIA NIM", () => {
    const rows = modelRows(CATALOGUE, ["groq"]);
    expect(rows.map((r) => [r.slug, r.held])).toEqual([
      ["groq/openai/gpt-oss-120b", true],
      ["groq/other", true],
      ["vertex_ai/flash", false],
    ]);
    expect(rows[0].providerLabel).toBe("Groq");
    expect(rows[0].name).toBe("gpt-oss-120b");
  });
  it("keeps a custom model among the held, or with Add a key without one", () => {
    const rows = modelRows(CATALOGUE, ["groq"], ["groq/custom", "mistral/large"]);
    expect(rows.map((r) => [r.slug, r.held])).toEqual([
      ["groq/openai/gpt-oss-120b", true],
      ["groq/other", true],
      ["groq/custom", true],
      ["mistral/large", false],
      ["vertex_ai/flash", false],
    ]);
    expect(rows[3].providerLabel).toBe("Mistral");
  });
  it("doesn't list a slug twice", () => {
    const rows = modelRows(CATALOGUE, ["groq"], ["groq/other"]);
    expect(rows.filter((r) => r.slug === "groq/other")).toHaveLength(1);
  });
  it("adds up the ticked, listed rows", () => {
    const row = (model: string, estimate_usd: number | null) => ({
      model,
      estimate_usd,
      price_known: estimate_usd !== null,
      model_usd: estimate_usd,
      judge_usd: 0,
      unpriced_judges: [],
    });
    const rows = [row("a", 0.21), row("b", 0.02), row("c", null), row("d", 9)];
    expect(estimateTotal(rows, ["a", "b", "c"])).toBeCloseTo(0.23);
  });
  it("words the lines", () => {
    const none = { judge_tests: 0, judges: [], uses_exact: true, uses_contains: false };
    expect(estimateLine(2, 50, none)).toBe(
      "2 models × 50 tests, paid on your own keys. These tests use exact match, so no judge model is needed.",
    );
    expect(estimateLine(1, 1, none)).toContain("1 model × 1 test,");
    expect(judgeLine({ ...none, uses_contains: true })).toBe(
      "These tests use exact match and key words, so no judge model is needed.",
    );
    expect(
      judgeLine({
        judge_tests: 4,
        judges: ["openai/gpt-4o-mini"],
        uses_exact: false,
        uses_contains: false,
      }),
    ).toBe(
      "These tests include 4 AI-judge tests, judged by gpt-4o-mini on your key. The judge's cost is included.",
    );
    expect(unlistedLine("mistral/large")).toBe(
      "No listed price for large: its cost shows after the run if the provider reports it.",
    );
    expect(runButtonLabel(50, 2)).toBe("Run 50 tests on 2 models");
    expect(runButtonLabel(1, 1)).toBe("Run 1 test on 1 model");
  });
});

describe("compare's default pair", () => {
  it("is the best against the lowest cost, else the next finished", () => {
    const a = run({ run_id: "a" });
    const b = run({ run_id: "b" });
    const c = run({ run_id: "c" });
    expect(defaultPair([a, b, c], "a", "c")).toEqual(["a", "c"]);
    expect(defaultPair([a, b], "a", "a")).toEqual(["a", "b"]);
    expect(defaultPair([a], "a", null)).toBeNull();
  });
});

describe("the addresses", () => {
  it("round-trip, and every Models page is the Models section", () => {
    for (const hash of ["#/models", "#/models/m1", "#/models/m1/results", "#/models/m1/settings"]) {
      expect(routeToHash(parseRoute(hash))).toBe(hash);
      expect(sectionOf(parseRoute(hash))).toBe("models");
    }
    expect(parseRoute("#/models/m1/tests")).toEqual({ page: "models", modelId: "m1" });
    expect(routeToHash({ page: "models", modelId: "m1", tab: "tests" })).toBe("#/models/m1");
  });
});
