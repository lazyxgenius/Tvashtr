/**
 * 1.4 Connectors: Linear (SAMPLE). The film account has nothing connected (live-base: GET
 * /api/connectors → []); the take connects Linear, read only, through the Desktop sign-in.
 * Copied from scripts/design-parity/scenarios/connectors-{fixtures,connect}.mjs and rewritten to the
 * story: the catalog is the live one (live-base.json, the real Featured + MCP Registry page), and
 * the connection is shaped as backend/tvashtr/control_plane/connectors.py serialize() returns it.
 *
 * Stateful, as the real sign-in is: POST /api/connectors → pending (signin_pending false) →
 * oauth/start → the poll (GET /api/connectors/:id, every 2 s) reads pending for PENDING_POLLS polls,
 * then connected; from then on the list, the catalog and the Toolkit counts include Linear.
 */
import { live, liveRoutes } from "./base.mjs";

const PENDING_POLLS = 2; // 2 pending polls, connected on the 3rd: ≈6 s of "Finish signing in to Linear in your browser"
const ID = "5b0c8e2a-3f1d-4c6e-9a7b-2d4e6f8a1c3e";
const HOST = "mcp.linear.app"; // connector_catalog.py: https://mcp.linear.app/mcp
// What connector_oauth.start() answers on the film stack (public_base_url http://localhost:8000, so
// dynamic registration, not a client metadata document). Linear's metadata, read 2026-10-11:
// authorization_endpoint https://mcp.linear.app/authorize, resource …/mcp, the 401's scope
// "read write". The state, verifier and registered client id are placeholders (never on screen).
const BASE = "http://localhost:8000";
const STATE = "film-sample-state";
const AUTHORIZE = `https://${HOST}/authorize?${new URLSearchParams({
  response_type: "code",
  client_id: "film-sample-client",
  redirect_uri: `${BASE}/api/connectors/oauth/callback`,
  state: STATE,
  code_challenge: "film-sample-challenge",
  code_challenge_method: "S256",
  resource: `https://${HOST}/mcp`,
  scope: "read write",
})}`;
// A guess at Linear's MCP tools (its tools/list needs a signed-in account; read/write as if its
// annotations mark the list/get ones read-only). Not on screen in 1.4.
const TOOLS = [
  ["list_issues", false],
  ["get_issue", false],
  ["list_projects", false],
  ["list_teams", false],
  ["create_issue", true],
  ["update_issue", true],
  ["create_comment", true],
].map(([name, write]) => ({ name, title: null, write, on: !write }));

export default () => {
  const routes = liveRoutes();
  const catalog = live("GET /api/connectors/catalog");
  const entry = catalog.items.find((e) => e.key === "linear");
  let conn = null; // the Linear row once POSTed
  let started = false;
  let polls = 0;
  const connected = () => conn?.status === "connected";

  const make = (access) => {
    const at = new Date().toISOString();
    conn = {
      id: ID,
      connector_key: entry.key,
      name: entry.name,
      slug: "linear",
      publisher: entry.publisher,
      featured: true,
      reviewed: true,
      category: entry.category,
      host: HOST,
      auth_kind: "oauth",
      key_fields: [],
      signin_host: HOST,
      signin_host_differs: false,
      access,
      access_modes: entry.access_modes,
      read_only_by: entry.read_only_by,
      scope: null,
      scope_picker: null,
      status: "pending",
      signin_pending: false,
      last_error: null,
      tools: null,
      used_by: { agent_count: 0, team_count: 0 },
      used_by_agents: null,
      connected_at: null,
      created_at: at,
      updated_at: at,
    };
    return conn;
  };
  const detail = () => ({ ...conn, used_by_agents: [], recent_use: [], revoke_hint: "To remove Tvashtr on Linear’s side too, revoke it in Linear’s settings." });

  return {
    ...routes,
    "GET /api/toolkit/summary": () => ({
      json: { ...live("GET /api/toolkit/summary"), connectors: connected() ? 1 : 0 },
    }),
    "GET /api/connectors": () => ({ json: { connections: connected() ? [{ ...conn }] : [] } }),
    // The live first page; a pending connection is not marked on it (connectors.catalog()).
    "GET /api/connectors/catalog": () => ({
      json: {
        ...catalog,
        items: catalog.items.map((e) =>
          e.key === "linear" && connected() ? { ...e, connection_id: ID, connection_status: "connected" } : e,
        ),
      },
    }),
    "POST /api/connectors": (req) => {
      const body = req.postDataJSON() ?? {};
      if (body.key !== "linear") return { status: 409, json: { detail: { code: "not_in_story", message: "Only Linear connects in 1.4." } } };
      return { status: 201, json: make(body.access ?? "read") };
    },
    "POST /api/connectors/:id/oauth/start": () => {
      started = true;
      conn = { ...conn, signin_pending: true };
      return {
        json: {
          authorize_url: AUTHORIZE,
          // What the app opens (Tvashtr's own hop, then on to authorize_url).
          open_url: `${BASE}/api/connectors/oauth/go?state=${STATE}`,
          signin_host: HOST,
          expires_in: 600,
        },
      };
    },
    "GET /api/connectors/:id": (req) => {
      if (!conn || !req.url().includes(ID)) return { status: 404, json: { detail: "Connector not found." } };
      if (started && conn.status === "pending" && ++polls > PENDING_POLLS) {
        const at = new Date().toISOString();
        conn = { ...conn, status: "connected", signin_pending: false, tools: TOOLS, connected_at: at, updated_at: at };
      }
      return { json: detail() };
    },
  };
};
