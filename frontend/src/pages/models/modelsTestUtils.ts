/** Fixtures for the Models pages' tests, shaped like the API. */
import type {
  ModelCard,
  ModelDetail,
  ModelRun,
  ModelTest,
  ModelTests,
  RunsOfVersion,
} from "../../lib/api/models";

export function aRun(over: Partial<ModelRun> = {}): ModelRun {
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
    cost_usd: 0.21,
    judge_cost_usd: 0,
    total_usd: 0.21,
    avg_latency_ms: 1400,
    error_message: null,
    created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    completed_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    ...over,
  };
}

export function aCard(over: Partial<ModelCard> = {}): ModelCard {
  return {
    model_id: "m1",
    name: "Claims triage",
    job: "Sort the claim.",
    answer_kind: "choice",
    choices: ["Motor", "Home"],
    current_version: 4,
    tests: 50,
    badge: "not_run",
    tested_at: null,
    best: [],
    ...over,
  };
}

export function aModel(over: Partial<ModelDetail> = {}): ModelDetail {
  return {
    model_id: "m1",
    name: "Claims triage",
    job: "Sort the claim.",
    answer_kind: "choice",
    choices: ["Motor", "Home"],
    current_version: 4,
    tests: 2,
    runs_on_current: 1,
    edited_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    judge_default: "groq/openai/gpt-oss-120b",
    pre_checked: ["groq/openai/gpt-oss-120b"],
    created_at: null,
    ...over,
  };
}

export function aTest(over: Partial<ModelTest> = {}): ModelTest {
  return {
    case_id: "c1",
    case_key: "k1",
    position: 1,
    input: "Rear-ended at a red light.",
    expected: "Motor",
    scoring: "exact",
    must_contain: [],
    rubric: null,
    judge_model: null,
    last_run: [],
    ...over,
  };
}

export function someTests(over: Partial<ModelTests> = {}): ModelTests {
  return {
    version: 4,
    is_current: true,
    change_note: "Added test 2",
    created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    tests: [aTest()],
    last_runs: [],
    ...over,
  };
}

export function someRuns(over: Partial<RunsOfVersion> = {}): RunsOfVersion {
  return {
    version: 4,
    current_version: 4,
    runs: [],
    best_run_id: null,
    lowest_cost_run_id: null,
    versions_with_runs: [],
    ...over,
  };
}

export const CONFIG = {
  hosted_mode: false,
  github_install_url: "",
  github_manage_url: "",
  provider_directory: [],
  provider_catalogue: [
    {
      provider: "groq",
      label: "Groq",
      thinker_default: "groq/openai/gpt-oss-120b",
      worker_default: null,
      thinker_presets: ["groq/openai/gpt-oss-120b"],
      worker_presets: [],
    },
    {
      provider: "deepseek",
      label: "DeepSeek",
      thinker_default: "deepseek/deepseek-chat",
      worker_default: null,
      thinker_presets: ["deepseek/deepseek-chat"],
      worker_presets: [],
    },
    {
      provider: "openai",
      label: "OpenAI",
      thinker_default: "openai/gpt-4o-mini",
      worker_default: null,
      thinker_presets: ["openai/gpt-4o-mini"],
      worker_presets: [],
    },
  ],
};

export const HELD = {
  providers: [
    { provider: "groq", key_last4: "1234", created_at: "" },
    { provider: "deepseek", key_last4: "1234", created_at: "" },
  ],
};
