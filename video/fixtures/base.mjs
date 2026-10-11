/**
 * The fixtures' common ground (F2, F6): video/story.json plus the live base (live-base.json, what
 * the real app answered on tvashtr_film for the film team — capture-live.mjs → export-live.mjs).
 * Every sample scene starts from these routes and adds only the history it needs, so sample data
 * agrees with the live footage: the same account, team, agents, models, key and plans.
 *
 * Route format (scripts/design-parity's): { "GET /api/x": json | (req) => ({ status, json }) }.
 * Keys match exact path+query first, then the path alone (any query), then ":param" patterns.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import story from "../camera/story.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const LIVE = JSON.parse(fs.readFileSync(path.join(here, "live-base.json"), "utf8")).routes;

export const clone = (v) => JSON.parse(JSON.stringify(v));
export { story };

/** The live answer to `key` ("GET /api/teams"), cloned. */
export function live(key) {
  if (!(key in LIVE)) throw new Error(`no live answer for ${key} (see live-base.json)`);
  return clone(LIVE[key]);
}

/** The film team as captured: its id, graph and each node's id by title ("Engineer", "Fixer"…). */
const graphKey = Object.keys(LIVE).find((k) => /^GET \/api\/teams\/[^/]+\/graph$/.test(k));
export const TEAM_ID = graphKey.split("/")[3];
export const GRAPH = () => live(graphKey);
export const NODE = Object.fromEntries(
  GRAPH().nodes.map((n) => [n.config?.title ?? { pm: "Product manager", engineer: "Engineer", reviewer: "Reviewer" }[n.role_name] ?? n.role_name, n.id]),
);
for (const role of ["pm", "engineer", "reviewer", "prd_gate", "ship", "stop", "escalation_gate", "domain_query"]) {
  const n = GRAPH().nodes.find((x) => x.role_name === role);
  if (n) NODE[role] = n.id;
}

/** Where a run's work ran (M-desk-4): the Desktop names the subscription instead of "$0.00". */
export const RAN_ON = {
  CLAUDE: { subscriptions: ["claude"], all: true },
  GROK: { subscriptions: ["grok"], all: true },
  BOTH: { subscriptions: ["claude", "grok"], all: true },
  BOTH_AND_KEY: { subscriptions: ["claude", "grok"], all: false },
  NONE: { subscriptions: [], all: false },
};

/** Every live GET the capture saw, as routes (path+query keys exactly as the app asked). */
export function liveRoutes() {
  const out = {};
  for (const [k, v] of Object.entries(LIVE)) out[k] = clone(v);
  return out;
}

/**
 * design-parity's `desk()` (scenarios/desk4.mjs): the Desktop's read of `key` (any query with
 * desktop_target=1) answers `edit(base)`; the website's read is unchanged.
 */
export const desk = (routes, key, edit) => {
  const base = routes[key];
  if (base === undefined) throw new Error(`no route ${key}`);
  return {
    ...routes,
    [key]: async (req) => {
      const r = typeof base === "function" ? await base(req) : { json: base };
      const asked = new URL(req.url()).searchParams.get("desktop_target") === "1";
      return asked ? { ...r, json: edit(clone(r.json)) } : r;
    },
  };
};

/** ISO time `s` seconds before now (fixtures move with the clock, unlike frozen boards). */
export const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
