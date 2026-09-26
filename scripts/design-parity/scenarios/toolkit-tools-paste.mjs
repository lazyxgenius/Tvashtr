// Toolkit › Tools › Paste mcp.json (slice F3, group G7) — website and Desktop renders of
// TkF-Paste-1..3: the design's paste with the comma after linear's entry missing ("Line 3: add a
// comma after the linear entry.", "Add 2 servers" disabled), fixed ("2 servers found": linear
// Remote, sqlite Local), then added (sqlite on top, the toast).
//
// Fixture note: the list is the design's (fetch, github, linear needing LINEAR_TOKEN). linear is
// already yours, so the checklist marks it "Replaces your linear", unticked (spec Q1); frame 2
// ticks it to match the design's two ticked rows and "Add 2 servers", and the add sends
// on_conflict "replace" (linear keeps its id, row and agents). The pasted linear has no
// Authorization header, so after the replace it references no secret: it turns Ready, the
// "1 missing" badge goes, and the toast reads "2 servers added." — the design's "linear needs a
// secret." / "Needs LINEAR_TOKEN" / "Add secret" can't be backed and are "not found in app".
import {
  DESKTOP_INIT,
  SECRETS,
  SUMMARY,
  TOOLS,
  toolkitRoutes,
} from "./toolkit-tools-fixtures.mjs";

const path = "/#/toolkit/tools";

// The design's text, as drawn (TkF-Paste-1), and fixed (TkF-Paste-2).
const BROKEN = `{
  "mcpServers": {
    "linear": { "url": "https://mcp.linear.app/sse" }
    "sqlite": { "command": "uvx", "args": ["mcp-server-sqlite"] }
  }
}`;
const FIXED = BROKEN.replace('sse" }\n', 'sse" },\n');

const refsOf = (cfg) =>
  [
    ...new Set(
      Object.values({ ...(cfg.headers ?? {}), ...(cfg.env ?? {}) }).flatMap(
        (v) =>
          [...String(v).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(
            (m) => m[1],
          ),
      ),
    ),
  ].sort();

/** Fresh routes per render: POST /api/tool-library/import adds or replaces (create-only unless
 *  on_conflict is "replace"); status, the secrets' missing[] and the summary follow. */
function statefulRoutes() {
  let tools = structuredClone(TOOLS);
  const stored = new Set(SECRETS.secrets.map((s) => s.name));
  const statusOf = (t) => {
    const refs = refsOf(t.server_config);
    const missing = refs.filter((n) => !stored.has(n));
    return {
      ...t,
      secret_refs: refs,
      missing_secrets: missing,
      status: missing.length ? "needs_attention" : "ready",
    };
  };
  const missingNames = () => [
    ...new Set(tools.map(statusOf).flatMap((t) => t.missing_secrets)),
  ];
  return {
    ...toolkitRoutes(),
    "GET /api/tool-library": () => ({ json: { tools: tools.map(statusOf) } }),
    "GET /api/secrets": () => ({
      json: {
        secrets: SECRETS.secrets,
        missing: missingNames().map((name) => ({
          name,
          used_by_tools: tools
            .filter((t) => statusOf(t).missing_secrets.includes(name))
            .map((t) => ({ id: t.id, name: t.name })),
        })),
      },
    }),
    "GET /api/toolkit/summary": () => ({
      json: {
        ...SUMMARY,
        tools: tools.length,
        tools_needing_attention: tools
          .map(statusOf)
          .filter((t) => t.status !== "ready").length,
        secrets_missing: missingNames().length,
      },
    }),
    "POST /api/tool-library/import": (req) => {
      const { servers, on_conflict } = req.postDataJSON();
      const conflicts = Object.keys(servers).filter((n) =>
        tools.some((t) => t.name === n),
      );
      if (conflicts.length && on_conflict !== "replace") {
        return {
          status: 409,
          json: {
            detail: {
              code: "name_taken",
              message: `You already have a tool named ${conflicts[0]}.`,
              conflicts,
            },
          },
        };
      }
      const at = new Date().toISOString();
      const added = Object.entries(servers).map(([name, server_config]) => {
        const had = tools.find((t) => t.name === name);
        if (had) {
          had.server_config = server_config;
          had.updated_at = at;
          return had;
        }
        const created = {
          id: `tool-${name}`,
          name,
          server_config,
          created_at: at,
          updated_at: at,
          used_by: { agent_count: 0, team_count: 0 },
        };
        tools.push(created);
        return created;
      });
      tools = [...tools];
      return { json: { added: added.map(statusOf), conflicts } };
    },
  };
}

/** A web + Desktop pair, each with fresh (stateful) routes. */
function pair(name, spec) {
  return [
    { name: `${name}-web`, routes: statefulRoutes(), ...spec },
    {
      name: `${name}-desktop`,
      routes: statefulRoutes(),
      ...spec,
      desktop: true,
      init: DESKTOP_INIT,
    },
  ];
}

const sheet = (page) => page.getByRole("dialog", { name: "Paste mcp.json" });
const still = async (page) => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(0, 0);
};
const paste = async (page, text) => {
  await page.getByRole("button", { name: "Paste mcp.json" }).click();
  await sheet(page).getByRole("textbox", { name: "mcp.json" }).fill(text);
};
// 2 · Fixed: both servers found; linear is yours already, so tick "Replaces your linear".
const found = async (page) => {
  await paste(page, FIXED);
  await sheet(page)
    .getByRole("checkbox", { name: /^linear/ })
    .check();
};

export default [
  // TkF-Paste-1: the missing comma — the line-numbered error, "Add 2 servers" disabled.
  ...pair("paste-1", {
    path,
    steps: async (page) => {
      await paste(page, BROKEN);
      await sheet(page)
        .getByText("Line 3: add a comma after the linear entry.")
        .waitFor();
      await still(page);
    },
  }),
  // TkF-Paste-2: fixed — "2 servers found", linear (Remote) and sqlite (Local) ticked.
  ...pair("paste-2", {
    path,
    steps: async (page) => {
      await found(page);
      await still(page);
    },
  }),
  // TkF-Paste-3: added — sqlite on top ("Not used yet"), linear replaced in place, the toast.
  ...pair("paste-3", {
    path,
    steps: async (page) => {
      await found(page);
      await sheet(page).getByRole("button", { name: "Add 2 servers" }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "2 servers added." })
        .waitFor();
      await still(page);
    },
  }),
];
