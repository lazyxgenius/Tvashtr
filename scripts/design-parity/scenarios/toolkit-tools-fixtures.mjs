// Shared Toolkit › Tools + Secrets fixtures for the parity scenarios (toolkit-tools-list.mjs and
// the later groups' files). Not a scenario file itself. The data mirrors the design's sample data:
// fetch (Local, ready), github (Remote, ready), linear (Remote, needs LINEAR_TOKEN); secrets
// GITHUB_TOKEN + SENTRY_TOKEN stored, LINEAR_TOKEN missing; nav badges Tools 3 · Skills 3 ·
// Memory 2 new · Secrets 1 missing.
export const now = Date.now();
export const ago = (min) => new Date(now - min * 60_000).toISOString();

export const TOOL_IDS = {
  fetch: "tool-fetch",
  github: "tool-github",
  linear: "tool-linear",
};

export const tool = (id, name, server_config, extra = {}) => ({
  id,
  name,
  server_config,
  created_at: ago(60 * 24 * 10),
  updated_at: ago(60 * 24 * 10),
  secret_refs: [],
  missing_secrets: [],
  status: "ready",
  used_by: { agent_count: 0, team_count: 0 },
  ...extra,
});

export const FETCH = tool(
  TOOL_IDS.fetch,
  "fetch",
  { command: "uvx", args: ["mcp-server-fetch"] },
  { used_by: { agent_count: 2, team_count: 1 } },
);
export const GITHUB = tool(
  TOOL_IDS.github,
  "github",
  {
    url: "https://api.githubcopilot.com/mcp/",
    headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
  },
  { secret_refs: ["GITHUB_TOKEN"], used_by: { agent_count: 3, team_count: 2 } },
);
export const LINEAR = tool(
  TOOL_IDS.linear,
  "linear",
  {
    url: "https://mcp.linear.app/sse",
    headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
  },
  {
    secret_refs: ["LINEAR_TOKEN"],
    missing_secrets: ["LINEAR_TOKEN"],
    status: "needs_attention",
    used_by: { agent_count: 1, team_count: 1 },
  },
);
export const TOOLS = [FETCH, GITHUB, LINEAR];

export const SECRETS = {
  secrets: [
    {
      name: "GITHUB_TOKEN",
      created_at: ago(60 * 24 * 6),
      updated_at: ago(60 * 24 * 6),
      used_by_tools: [{ id: TOOL_IDS.github, name: "github" }],
    },
    {
      name: "SENTRY_TOKEN",
      created_at: ago(60 * 24 * 12),
      updated_at: ago(60 * 24 * 12),
      used_by_tools: [],
    },
  ],
  missing: [
    {
      name: "LINEAR_TOKEN",
      used_by_tools: [{ id: TOOL_IDS.linear, name: "linear" }],
    },
  ],
};

export const SUMMARY = {
  tools: 3,
  tools_needing_attention: 1,
  skills: 3,
  memory: { inbox: 2, active: 14, archive: 5 },
  secrets_missing: 1,
};

export const CATALOG = [
  {
    key: "fetch",
    name: "fetch",
    title: "Web fetch",
    description:
      "Fetch web pages over HTTP. Runs locally with uvx mcp-server-fetch.",
    access: "free",
    secret_names: [],
    badge: "Free · no login",
    attachable: true,
    server_config: { command: "uvx", args: ["mcp-server-fetch"] },
  },
  {
    key: "github-app",
    name: "github-app",
    title: "GitHub App repos",
    description:
      "Hosted runs use your Tvashtr GitHub App installation. Install the App, then launch against an App repo.",
    access: "needs_github_app",
    secret_names: [],
    badge: "Needs GitHub App",
    attachable: false,
    server_config: {},
  },
];

/** The routes every Toolkit › Tools / Secrets page reads. `tools` / `summary` can be overridden. */
export function toolkitRoutes({
  tools = TOOLS,
  summary = SUMMARY,
  secrets = SECRETS,
} = {}) {
  return {
    // The shell: Home's nav badge (none drawn) and the teams list the shell reads.
    "GET /api/inbox": { count: 0, items: [] },
    "GET /api/teams": { teams: [] },
    "GET /api/toolkit/summary": summary,
    "GET /api/tool-library": { tools },
    "GET /api/secrets": secrets,
    "GET /api/tool-catalog": { tools: CATALOG },
    "GET /api/github/status": {
      hosted: true,
      installed: false,
      installation_count: 0,
      repo_count: 0,
    },
  };
}

// Desktop: the one-time "runs your own installed Claude Code / Grok" disclosure is already seen
// (the artboards don't draw it).
export const DESKTOP_INIT = `try { sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1"); } catch {}`;

/** A web + Desktop pair of scenarios for one artboard (names `<name>-web` / `<name>-desktop`). */
export function pair(name, spec) {
  return [
    { name: `${name}-web`, ...spec },
    {
      name: `${name}-desktop`,
      ...spec,
      desktop: true,
      init: spec.init ?? DESKTOP_INIT,
    },
  ];
}
