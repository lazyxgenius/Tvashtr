// Engines parity fixtures (slice F2) — shared by engines-*.mjs; not a scenario file itself.
// The data mirrors the design's sample: two library teams ("Indicator sprint team": Product manager
// + Reviewer on xai, Engineer on anthropic; "Docs team": Writer on deepseek), keys for deepseek
// (7d24), nvidia_nim (HZmm) and openrouter (211b), Claude connected on "Claude Pro", Grok needing
// login and Codex not installed, and one domain embedding with huggingface. The nav then reads
// "2 to fix", "1 of 2" and "3", as drawn.

export const DIRECTORY = [
  [
    "anthropic",
    "A",
    "Anthropic",
    "Claude models",
    "anthropic/claude-sonnet-5",
    "claude",
    false,
    null,
  ],
  ["xai", "X", "xAI", "Grok models", "xai/grok-4.7", "grok", false, null],
  [
    "openai",
    "O",
    "OpenAI",
    "GPT models",
    "openai/gpt-4.1-mini",
    null,
    true,
    null,
  ],
  [
    "gemini",
    "G",
    "Gemini",
    "Gemini models and Domains embeddings",
    "gemini/gemini-2.5-flash",
    null,
    true,
    null,
  ],
  [
    "groq",
    "Q",
    "Groq",
    "Fast open models",
    "groq/openai/gpt-oss-120b",
    null,
    false,
    null,
  ],
  [
    "deepseek",
    "D",
    "DeepSeek",
    "DeepSeek models",
    "deepseek/deepseek-chat",
    null,
    false,
    null,
  ],
  [
    "huggingface",
    "H",
    "Hugging Face",
    "Domains BGE-small embeddings (free token)",
    "huggingface/BAAI/bge-small-en-v1.5",
    null,
    true,
    "Used by Domains ingest for BGE-small embeddings. A free token from huggingface.co works.",
  ],
  [
    "nvidia_nim",
    "N",
    "NVIDIA NIM",
    "Open models on NVIDIA NIM",
    null,
    null,
    false,
    null,
  ],
  [
    "openrouter",
    "R",
    "OpenRouter",
    "many models through one key",
    "openrouter/openai/gpt-4o-mini",
    null,
    true,
    null,
  ],
].map(
  ([
    provider,
    monogram,
    name,
    label,
    example_model,
    subscription,
    embeddings,
    hint,
  ]) => ({
    provider,
    monogram,
    name,
    label,
    example_model,
    subscription,
    embeddings,
    hint,
  }),
);

const seat = (provider, label, thinker, worker, subscription = null) => ({
  provider,
  thinker_default: thinker,
  worker_default: worker,
  thinker_presets: thinker ? [thinker] : [],
  worker_presets: worker ? [worker] : [],
  label,
  model_labels: {},
  subscription,
  byok_probed: subscription === null,
});

// NVIDIA NIM serves no seat (backend PROVIDER_CATALOGUE since 2026-09-26).
export const CATALOGUE = [
  seat(
    "openrouter",
    "OpenRouter",
    "openrouter/openai/gpt-4o-mini",
    "openrouter/openai/gpt-4o-mini",
  ),
  seat("nvidia_nim", "NVIDIA NIM", null, null),
  seat("openai", "OpenAI", "openai/gpt-4.1-mini", "openai/gpt-4.1-mini"),
  seat(
    "gemini",
    "Gemini",
    "gemini/gemini-2.5-flash",
    "gemini/gemini-2.5-flash",
  ),
  seat("groq", "Groq", "groq/openai/gpt-oss-120b", "groq/openai/gpt-oss-120b"),
  seat(
    "deepseek",
    "DeepSeek",
    "deepseek/deepseek-chat",
    "deepseek/deepseek-chat",
  ),
  seat(
    "anthropic",
    "Anthropic",
    "anthropic/claude-sonnet-5",
    "anthropic/claude-sonnet-5",
    "claude",
  ),
  seat("xai", "xAI", "xai/grok-4.7", "xai/grok-4.7", "grok"),
];

export const CONFIG = {
  hosted_mode: true,
  github_install_url: "https://github.com/apps/tvashtr/installations/new",
  github_manage_url: "https://github.com/apps/tvashtr/installations/new",
  provider_catalogue: CATALOGUE,
  provider_directory: DIRECTORY,
  embedding_presets: [
    {
      id: "openai-3-small",
      label: "OpenAI text-embedding-3-small (default)",
      slug: "openai/text-embedding-3-small",
      provider: "openai",
      dim: 1536,
      notes: "Requires Engines key for provider openai.",
    },
    {
      id: "hf-bge-small-en-v1.5",
      label: "Hugging Face BGE-small-en-v1.5 (384, free/rate-limited)",
      slug: "huggingface/BAAI/bge-small-en-v1.5",
      provider: "huggingface",
      dim: 384,
      notes: "Free HF Inference feature-extraction embed.",
    },
  ],
  default_run_budget_usd: 5,
};

export const key = (provider, last4, day) => ({
  provider,
  key_last4: last4,
  created_at: day,
  updated_at: day,
});

export const KEYS = [
  key("openrouter", "211b", "2026-08-28T09:12:00+00:00"),
  key("nvidia_nim", "HZmm", "2026-09-03T11:40:00+00:00"),
  key("deepseek", "7d24", "2026-09-12T08:01:10+00:00"),
];

const node = (id, role, title, model) => {
  const provider = model ? model.split("/")[0] : null;
  return {
    node_id: id,
    role_name: role,
    title,
    kind: role === "pm" ? "completion" : "agent",
    model,
    provider,
    fallback_model: null,
    fallback_provider: null,
  };
};

export const USAGE_TEAMS = [
  {
    team_id: "t-ind",
    name: "Indicator sprint team",
    nodes: [
      node("n-pm", "pm", "Product manager", "xai/grok-4.7"),
      node("n-eng", "engineer", "Engineer", "anthropic/claude-sonnet-5"),
      node("n-rev", "reviewer", "Reviewer", "xai/grok-4.7"),
    ],
  },
  {
    team_id: "t-docs",
    name: "Docs team",
    nodes: [node("n-writer", "writer", "Writer", "deepseek/deepseek-chat")],
  },
];

export const USAGE_DOMAINS = [
  {
    domain_id: "d-research",
    name: "Research",
    embedding_model: "huggingface/BAAI/bge-small-en-v1.5",
    embedding_provider: "huggingface",
    generation_model: null,
    generation_provider: null,
  },
];

/** `/api/engines/usage` built from the teams and domains, like the server does. */
export function usage(teams = USAGE_TEAMS, domains = USAGE_DOMAINS) {
  const by = {};
  const slot = (p) =>
    (by[p] ??= { teams: [], fallback_teams: [], domains: [] });
  for (const t of teams) {
    const per = {};
    for (const n of t.nodes) {
      if (!n.provider) continue;
      per[n.provider] ??= {
        team_id: t.team_id,
        name: t.name,
        roles: [],
        node_ids: [],
      };
      if (!per[n.provider].roles.includes(n.role_name))
        per[n.provider].roles.push(n.role_name);
      per[n.provider].node_ids.push(n.node_id);
    }
    for (const [p, use] of Object.entries(per)) slot(p).teams.push(use);
  }
  for (const d of domains) {
    if (d.embedding_provider) {
      slot(d.embedding_provider).domains.push({
        domain_id: d.domain_id,
        name: d.name,
        use: "embedding",
      });
    }
  }
  return { teams, domains, by_provider: by };
}

export const sub = (provider, state, account_hint = null) => ({
  provider,
  connected: state === "connected",
  state,
  account_hint,
  source: state === "disconnected" ? null : "harness",
  checked_at: "2026-09-26T09:00:00+00:00",
  runner_fresh: false,
});

export const SUBS = [
  sub("claude", "connected", "Claude Pro"),
  sub("grok", "needs_login"),
  sub("codex", "needs_install"),
];

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

/** Desktop checked in hours ago (the website Overview draws "Not open on this computer"). */
export const RUNNER_STALE = {
  fresh: false,
  last_seen_at: minutesAgo(180),
  providers: ["claude", "grok"],
};
export const RUNNER_FRESH = {
  fresh: true,
  last_seen_at: minutesAgo(0),
  providers: ["claude", "grok"],
};
export const NO_RUNNER = { fresh: false, last_seen_at: null, providers: [] };

/** Every /api route an Engines page asks for. */
export function enginesRoutes({
  keys = KEYS,
  subs = SUBS,
  runner = RUNNER_STALE,
  teams = USAGE_TEAMS,
  domains = USAGE_DOMAINS,
  over = {},
} = {}) {
  const state = { keys: [...keys] };
  return {
    "GET /api/config": CONFIG,
    "GET /api/providers": () => ({ json: { providers: state.keys } }),
    "GET /api/engines/subscriptions": { subscriptions: subs, runner },
    "GET /api/engines/usage": usage(teams, domains),
    "GET /api/teams": { teams: [] },
    "GET /api/inbox": { count: 0, items: [] },
    ...over,
  };
}

/**
 * Desktop init script: the live bridge status (the harness stub reports Claude + Grok connected;
 * the design has Grok needing login), the launch disclosure already seen, and `window.__engPush`
 * to push a status from `steps` (what the main process's onStatus does).
 */
export function desktopInit(statuses = SUBS) {
  return `(() => {
    try { sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1"); } catch {}
    const statuses = ${JSON.stringify(statuses)};
    const listeners = new Set();
    window.__engPush = (s) => listeners.forEach((cb) => cb(s));
    const find = (p) => statuses.find((s) => s.provider === p);
    window.tvashtrDesktop.engines = {
      getStatus: async () => statuses,
      connect: async (p) => find(p),
      disconnect: async (p) => ({ ...find(p), connected: false, state: "disconnected" }),
      refresh: async (p) => find(p),
      cancelConnect: async (p) => find(p),
      onStatus: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    };
  })();`;
}
