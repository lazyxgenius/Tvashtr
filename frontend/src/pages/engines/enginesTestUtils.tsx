/**
 * Test helpers for the Engines pages (slice F2): the design's sample data (two teams, keys for
 * deepseek / nvidia_nim / openrouter, Claude connected, Grok needing login, Codex not installed), a
 * fetch mock keyed by "METHOD /path" that records every call, a fake Desktop bridge, and a render
 * of an Engines tab.
 */
import { render } from "@testing-library/react";
import { vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import {
  type CatalogueEntry,
  type EngineUsage,
  type ProviderDirectoryEntry,
  type SavedKey,
  type UsageNode,
  __resetEnginesConfigForTests,
} from "../../lib/api/engines";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetAddKeyRequestsForTests } from "./addKeyRequests";
import type { SubscriptionStatus } from "../../lib/engines";
import type { EnginesTab } from "../../lib/nav";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import type { EngineInputs } from "./engineModel";
import { EnginesPage } from "./EnginesPage";

const dir = (
  provider: string,
  monogram: string,
  name: string,
  example_model: string | null,
  subscription: string | null = null,
): ProviderDirectoryEntry => ({
  provider,
  monogram,
  name,
  label: `${name} models`,
  example_model,
  subscription,
  embeddings: false,
  hint: null,
});

export const DIRECTORY: ProviderDirectoryEntry[] = [
  dir("anthropic", "A", "Anthropic", "anthropic/claude-sonnet-5", "claude"),
  dir("xai", "X", "xAI", "xai/grok-4.7", "grok"),
  dir("openai", "O", "OpenAI", "openai/gpt-4.1-mini"),
  dir("deepseek", "D", "DeepSeek", "deepseek/deepseek-chat"),
  dir("huggingface", "H", "Hugging Face", "huggingface/BAAI/bge-small-en-v1.5"),
  dir("nvidia_nim", "N", "NVIDIA NIM", null),
  dir("openrouter", "R", "OpenRouter", "openrouter/openai/gpt-4o-mini"),
];

const seat = (provider: string, model: string | null): CatalogueEntry => ({
  provider,
  thinker_default: model,
  worker_default: model,
  thinker_presets: model ? [model] : [],
  worker_presets: model ? [model] : [],
  label: null,
  subscription: null,
});

/** NVIDIA NIM serves no seat. */
export const CATALOGUE: CatalogueEntry[] = [
  seat("openrouter", "openrouter/openai/gpt-4o-mini"),
  seat("nvidia_nim", null),
  seat("openai", "openai/gpt-4.1-mini"),
  seat("deepseek", "deepseek/deepseek-chat"),
  seat("anthropic", "anthropic/claude-sonnet-5"),
  seat("xai", "xai/grok-4.7"),
];

export const key = (provider: string, last4: string, day = "2026-09-12"): SavedKey => ({
  provider,
  key_last4: last4,
  created_at: `${day}T08:00:00+00:00`,
  updated_at: `${day}T08:00:00+00:00`,
});

export const KEYS: SavedKey[] = [
  key("openrouter", "211b", "2026-08-28"),
  key("nvidia_nim", "HZmm", "2026-09-03"),
  key("deepseek", "7d24", "2026-09-12"),
];

export const sub = (
  provider: SubscriptionStatus["provider"],
  state: SubscriptionStatus["state"],
  account_hint: string | null = null,
): SubscriptionStatus => ({
  provider,
  connected: state === "connected",
  state,
  account_hint,
  source: "harness",
  checked_at: "2026-09-25T09:00:00+00:00",
  runner_fresh: false,
});

export const SUBS: SubscriptionStatus[] = [
  sub("claude", "connected", "Claude Pro"),
  sub("grok", "needs_login"),
  sub("codex", "needs_install"),
];

export const node = (
  id: string,
  role: string,
  model: string | null,
  title: string | null = null,
  fallback: string | null = null,
): UsageNode => ({
  node_id: id,
  role_name: role,
  title,
  kind: "agent",
  model,
  provider: model ? model.split("/")[0] : null,
  fallback_model: fallback,
  fallback_provider: fallback ? fallback.split("/")[0] : null,
});

export const USAGE: EngineUsage = {
  teams: [
    {
      team_id: "t-ind",
      name: "Indicator sprint team",
      nodes: [
        node("n-pm", "pm", "xai/grok-4.7"),
        node("n-eng", "engineer", "anthropic/claude-sonnet-5"),
        node("n-rev", "reviewer", "xai/grok-4.7"),
      ],
    },
    {
      team_id: "t-docs",
      name: "Docs team",
      nodes: [node("n-writer", "writer", "deepseek/deepseek-chat", "Writer")],
    },
  ],
  domains: [],
  by_provider: {},
};

export const RUNNER_STALE = {
  fresh: false,
  last_seen_at: "2026-09-26T06:00:00+00:00",
  providers: ["claude", "grok"],
};

/** The design's sample as model inputs (website unless overridden). */
export function sampleInputs(over: Partial<EngineInputs> = {}): EngineInputs {
  return {
    directory: DIRECTORY,
    catalogue: CATALOGUE,
    keys: KEYS,
    subs: SUBS,
    runner: RUNNER_STALE,
    usage: USAGE,
    surface: "website",
    ...over,
  };
}

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Reply = unknown;

/** Answer fetches from the sample + `over` ("GET /api/providers": {...} or a function); record
 *  every call. A reply that is a Response is returned as is. */
export function mockEnginesApi(over: Record<string, Reply> = {}): Call[] {
  const calls: Call[] = [];
  const routes: Record<string, Reply> = {
    "GET /health": { status: "ok", db: "ok" },
    "GET /api/config": {
      hosted_mode: true,
      provider_directory: DIRECTORY,
      provider_catalogue: CATALOGUE,
      embedding_presets: [],
    },
    "GET /api/providers": { providers: KEYS },
    "GET /api/engines/subscriptions": { subscriptions: SUBS, runner: RUNNER_STALE },
    "GET /api/engines/usage": USAGE,
    ...over,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
        "http://localhost",
      );
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, path: url.pathname + url.search, body });
      const reply = routes[`${method} ${url.pathname}`];
      if (reply === undefined) {
        return new Response(JSON.stringify({ detail: "no fixture" }), { status: 404 });
      }
      const out =
        typeof reply === "function"
          ? await (reply as (u: URL, b: unknown) => unknown)(url, body)
          : reply;
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

/** A fake Tvashtr Desktop: the bridge's engines API plus `push` (what onStatus delivers). */
export function installDesktop(statuses: SubscriptionStatus[] = SUBS) {
  const listeners = new Set<(s: SubscriptionStatus) => void>();
  const find = (p: string): Promise<SubscriptionStatus> => {
    const s = statuses.find((r) => r.provider === p);
    return s ? Promise.resolve(s) : Promise.reject(new Error(`no status for ${p}`));
  };
  const engines = {
    getStatus: vi.fn(() => Promise.resolve(statuses)),
    connect: vi.fn(find),
    disconnect: vi.fn(find),
    refresh: vi.fn(find),
    cancelConnect: vi.fn(find),
    onStatus: vi.fn((cb: (s: SubscriptionStatus) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
  };
  window.tvashtrDesktop = { engines };
  document.documentElement.dataset.tvashtrDesktop = "true";
  return { engines, push: (s: SubscriptionStatus) => listeners.forEach((cb) => cb(s)) };
}

export function resetEnginesState(): void {
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
  __resetEnginesConfigForTests();
  __resetAddKeyRequestsForTests();
  delete document.documentElement.dataset.tvashtrDesktop;
  delete window.tvashtrDesktop;
  window.location.hash = "";
}

export function renderEngines(tab: EnginesTab = "overview", fix = false) {
  return render(
    <ToastProvider>
      <EnginesPage tab={tab} fix={fix} />
    </ToastProvider>,
  );
}
