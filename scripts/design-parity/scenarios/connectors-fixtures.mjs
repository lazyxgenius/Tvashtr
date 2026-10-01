// Toolkit › Connectors parity fixtures — shared by connectors-*.mjs; not a scenario file itself.
// The data mirrors the design's sample (Cn-Screens / CnF-* boards, split per frame by
// split-composite.py): 14 Featured entries (Google Drive / Docs / Sheets and HubSpot "Coming
// soon"), 15,036 registry servers led by Apify (API key), Stripe, Canva, Cloudflare, Windsor.ai,
// Zapier; connections Supabase (read, project trade-mcp-prod, 2 agents · 1 team), Notion (read,
// 1 · 1), Linear (read & write, 1 · 1), PostHog (read, not used yet).
import { DESKTOP_INIT, SUMMARY, toolkitRoutes } from "./toolkit-tools-fixtures.mjs";

const T = "2026-09-28T10:02:11+00:00";

const feat = (key, name, publisher, category, description, extra = {}) => ({
  key,
  name,
  publisher,
  featured: true,
  reviewed: true,
  category,
  description,
  website: null,
  host: `mcp.${key.replace(/^google-/, "")}.com`,
  auth: "oauth",
  key_fields: [],
  access_modes: ["read", "write"],
  read_only_by: "scopes",
  scope_picker: null,
  available: true,
  unavailable_reason: null,
  connection_id: null,
  connection_status: null,
  ...extra,
});
const soon = { available: false, unavailable_reason: "Coming soon" };

export const SUPABASE_ENTRY = feat(
  "supabase",
  "Supabase",
  "Supabase",
  "databases",
  "Read tables, run read-only SQL and check logs in one project.",
  { read_only_by: "provider", scope_picker: { param: "project_ref", label: "Project" } },
);

export const FEATURED = [
  SUPABASE_ENTRY,
  feat("neon", "Neon", "Neon", "databases", "Read schemas and run queries on one Neon project."),
  feat("notion", "Notion", "Notion", "docs", "Search and read pages and databases."),
  feat("google-drive", "Google Drive", "Google", "docs", "Search and read files in your Drive.", soon),
  feat("google-docs", "Google Docs", "Google", "docs", "Read documents such as specs and briefs.", soon),
  feat("google-sheets", "Google Sheets", "Google", "docs", "Read spreadsheets and the values in them.", soon),
  feat("posthog", "PostHog", "PostHog", "analytics", "Query insights, events and feature flags."),
  feat("mixpanel", "Mixpanel", "Mixpanel", "analytics", "Query events, funnels and retention."),
  feat("amplitude", "Amplitude", "Amplitude", "analytics", "Read charts, dashboards and experiments."),
  feat("hubspot", "HubSpot", "HubSpot", "crm", "Read contacts, companies, deals and tickets.", soon),
  feat("intercom", "Intercom", "Intercom", "crm", "Search conversations and contacts."),
  feat("linear", "Linear", "Linear", "work", "Read issues, projects and cycles."),
  feat("sentry", "Sentry", "Sentry", "work", "Read errors, issues and releases."),
  feat("atlassian", "Atlassian", "Atlassian", "work", "Read Jira issues and Confluence pages."),
];

const reg = (key, name, description, host, extra = {}) => ({
  ...feat(key, name, null, null, description),
  featured: false,
  reviewed: false,
  host,
  auth: "unknown",
  read_only_by: "annotations",
  ...extra,
});

export const APIFY_ENTRY = reg(
  "com.apify/apify-mcp-server",
  "Apify",
  "Run web scrapers and read their results.",
  "mcp.apify.com",
  {
    auth: "api_key",
    key_fields: [
      {
        id: "Authorization",
        label: "API key",
        hint: "Apify API token. Sent to mcp.apify.com as its Authorization header.",
        secret: true,
        required: true,
      },
    ],
  },
);

export const REGISTRY = [
  APIFY_ENTRY,
  reg("com.stripe/mcp", "Stripe", "Read customers, payments and invoices.", "mcp.stripe.com"),
  reg("com.canva.mcp/mcp", "Canva", "Find and read designs in your Canva team.", "mcp.canva.com"),
  reg(
    "com.cloudflare.mcp/mcp",
    "Cloudflare",
    "Read Workers, KV and D1 in your account.",
    "bindings.mcp.cloudflare.com",
  ),
  reg(
    "ai.windsor/windsor-mcp",
    "Windsor.ai",
    "Marketing data from 320+ ad and analytics sources.",
    "mcp.windsor.ai",
  ),
  reg("com.zapier/mcp", "Zapier", "Act across 8,000+ apps.", "mcp.zapier.com"),
];

export const CATEGORIES = ["databases", "docs", "analytics", "crm", "work"];

/** A connection in the contract's shape, built from its catalog entry. */
export function conn(entry, over = {}) {
  return {
    id: `c-${entry.key.replace(/[^a-z]/g, "")}`,
    connector_key: entry.key,
    name: entry.name,
    slug: entry.key,
    publisher: entry.publisher,
    featured: entry.featured,
    reviewed: entry.reviewed,
    category: entry.category,
    host: entry.host,
    auth_kind: entry.auth === "api_key" ? "api_key" : "oauth",
    key_fields: entry.key_fields,
    signin_host: entry.auth === "api_key" ? null : entry.host,
    signin_host_differs: false,
    access: "read",
    access_modes: entry.access_modes,
    read_only_by: entry.read_only_by,
    scope: null,
    scope_picker: entry.scope_picker,
    status: "connected",
    signin_pending: false,
    last_error: null,
    tools: [],
    used_by: { agent_count: 0, team_count: 0 },
    used_by_agents: null,
    connected_at: T,
    created_at: T,
    updated_at: T,
    ...over,
  };
}

const byKey = (k) => [...FEATURED, ...REGISTRY].find((e) => e.key === k);
const one = { agent_count: 1, team_count: 1 };
export const SUPABASE = conn(SUPABASE_ENTRY, {
  scope: { value: "abcd1234", label: "trade-mcp-prod · ap-southeast-1" },
  used_by: { agent_count: 2, team_count: 1 },
});
export const NOTION = conn(byKey("notion"), { used_by: one });
export const LINEAR = conn(byKey("linear"), { access: "write", used_by: one });
export const POSTHOG = conn(byKey("posthog"));
export const APIFY = conn(APIFY_ENTRY);

/** GET /api/connectors/{id}: a connection plus who uses it. */
export const detail = (c) => ({
  ...c,
  used_by_agents: c.used_by_agents ?? [],
  recent_use: [],
  revoke_hint: null,
});

/** A catalog answer for a query (`q` filters names, `category` the Featured chips). */
function catalogAnswer(connections, url) {
  const u = new URL(url);
  const q = (u.searchParams.get("q") ?? "").toLowerCase();
  const cat = u.searchParams.get("category");
  const mine = (e) => {
    const c = connections.find((x) => x.connector_key === e.key);
    return c ? { ...e, connection_id: c.id, connection_status: c.status } : e;
  };
  if (q) {
    const items = [...FEATURED, ...REGISTRY].filter((e) => e.name.toLowerCase().includes(q));
    return { items: items.map(mine), total: items.length + 1, next_offset: null, categories: CATEGORIES };
  }
  const featured = FEATURED.filter((e) => !cat || e.category === cat);
  return {
    items: [...featured, ...REGISTRY].map(mine),
    total: featured.length + 15036,
    next_offset: featured.length + REGISTRY.length,
    categories: CATEGORIES,
  };
}

/** Every route the Connectors pages read, `connections` listed as the Connected tab draws them
 *  (newest first); `over` adds or replaces routes. */
export function connectorsRoutes({ connections = [SUPABASE, NOTION, LINEAR, POSTHOG], over = {} } = {}) {
  return {
    ...toolkitRoutes({ summary: { ...SUMMARY, secrets_missing: 0, connectors: connections.length, connectors_needing_attention: 0 } }),
    // The API lists oldest first and the Connected tab shows newest first: `connections` is in
    // the order the frames draw them.
    "GET /api/connectors": { connections: [...connections].reverse() },
    "GET /api/connectors/catalog": (req) => ({ json: catalogAnswer(connections, req.url()) }),
    "GET /api/connectors/:id": (req) => {
      const id = new URL(req.url()).pathname.split("/").pop();
      const c = connections.find((x) => x.id === id);
      return c ? { json: detail(c) } : { status: 404, json: { detail: "Connector not found." } };
    },
    ...over,
  };
}

// The sign-in window: a stand-in that never loads the provider (or null: the browser blocked it).
export const POPUP_OK = `window.open = () => ({ close() {}, closed: false, opener: null, location: { href: "" } });`;
export const POPUP_BLOCKED = `window.open = () => null;`;

/** A web + Desktop pair for one artboard (names `<name>-web` / `<name>-desktop`). */
export function pair(name, spec) {
  const popup = spec.popup ?? POPUP_OK;
  return [
    { name: `${name}-web`, ...spec, init: popup },
    { name: `${name}-desktop`, ...spec, desktop: true, init: `${DESKTOP_INIT}\n${popup}` },
  ];
}
