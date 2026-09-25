/**
 * `tvashtr://` deep links (spec §6, engines.md B3).
 *
 * A link is untrusted input from any web page or app on the machine, so the parser is an
 * allow-list: it recognises a handful of fixed places and returns the app's own hash address for
 * them (see frontend/src/lib/nav.ts), built from constants — never from the link's text, apart
 * from a team id that must be a UUID. A link can only move the window to a page; `?connect=` only
 * highlights a card and never starts Connect. Anything else is ignored (null).
 *
 * Accepted:
 *   tvashtr://home                                   → /home
 *   tvashtr://engines/overview                       → /engines
 *   tvashtr://engines/subscriptions[?connect=claude|grok] → /engines/subscriptions
 *   tvashtr://engines/keys                           → /engines/keys
 *   tvashtr://toolkit/tools|skills|secrets           → /toolkit/<same>
 *   tvashtr://toolkit/memory                         → /toolkit/memory/inbox
 *   tvashtr://teams/<uuid>                           → /teams/<uuid>
 */
const SCHEME = "tvashtr";
const MAX_LINK_LENGTH = 2048;

const ENGINES = { overview: "/engines", subscriptions: "/engines/subscriptions", keys: "/engines/keys" };
const TOOLKIT = {
  tools: "/toolkit/tools",
  skills: "/toolkit/skills",
  memory: "/toolkit/memory/inbox",
  secrets: "/toolkit/secrets",
};
const CONNECT_PROVIDERS = ["claude", "grok"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * @param {unknown} link
 * @returns {{ path: string, params?: Record<string, string> } | null}
 */
function parseDeepLink(link) {
  if (typeof link !== "string" || link.length === 0 || link.length > MAX_LINK_LENGTH) return null;
  let url;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:`) return null;
  if (url.username || url.password || url.port) return null;

  // `tvashtr://engines/keys` parses as host "engines" + path "/keys"; `tvashtr:///engines/keys`
  // and `tvashtr:engines/keys` put everything in the path. Treat all three the same.
  const segments = `${url.host}/${url.pathname}`
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
  if (segments.some((s) => !/^[a-z0-9-]+$/.test(s))) return null;

  const [area, page, ...rest] = segments;
  if (rest.length > 0) return null;

  if (area === "home" && page === undefined) return { path: "/home" };

  if (area === "engines" && page !== undefined && Object.hasOwn(ENGINES, page)) {
    const target = { path: ENGINES[/** @type {keyof typeof ENGINES} */ (page)] };
    const connect = (url.searchParams.get("connect") || "").toLowerCase();
    if (CONNECT_PROVIDERS.includes(connect)) return { ...target, params: { connect } };
    return target;
  }

  if (area === "toolkit" && page !== undefined && Object.hasOwn(TOOLKIT, page)) {
    return { path: TOOLKIT[/** @type {keyof typeof TOOLKIT} */ (page)] };
  }

  if (area === "teams" && page !== undefined && UUID_RE.test(page)) {
    return { path: `/teams/${page}` };
  }

  return null;
}

/**
 * The first `tvashtr:` argument on a command line (Windows/Linux hand the link to the app as an
 * argument, both at cold start and to the running instance via `second-instance`).
 * @param {unknown} argv
 * @returns {string | null}
 */
function findDeepLinkArg(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    if (typeof arg === "string" && arg.toLowerCase().startsWith(`${SCHEME}:`)) return arg;
  }
  return null;
}

/**
 * Holds the one deep link the page hasn't confirmed yet. Every link is pushed to the window at
 * once (`send`) AND kept: a page with an `onNavigate` listener acknowledges it (`ack(id)`), which
 * drops it; a page that isn't listening yet (cold start, mid-reload) ignores the push and picks the
 * link up with `consumePending()` when it mounts. The main process never has to guess whether a
 * page is listening. A newer link replaces an older one that was never seen.
 *
 * @typedef {{ path: string, params?: Record<string, string> }} NavTarget
 * @param {{ send: (msg: { id: number, target: NavTarget }) => void }} deps
 */
function createNavigationQueue({ send }) {
  /** @type {{ id: number, target: NavTarget } | null} */
  let pending = null;
  let nextId = 1;

  return {
    /** @param {NavTarget} target */
    deliver(target) {
      pending = { id: nextId++, target };
      send(pending);
    },
    /** The page handled link ``id``. */
    ack(id) {
      if (pending && pending.id === id) pending = null;
    },
    /** @returns {{ id: number, target: NavTarget } | null} */
    consumePending() {
      const out = pending;
      pending = null;
      return out;
    },
  };
}

module.exports = { SCHEME, parseDeepLink, findDeepLinkArg, createNavigationQueue };
