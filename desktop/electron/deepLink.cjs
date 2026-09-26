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
 *
 * v6 (desktop-app.md DB-2):
 *   - Every allowed link may carry a sign-in HINT from the website, `?from=web&login=<github
 *     login>&host=<api host>`. It is returned as `hint` only when `host` is the configured API host;
 *     main keeps it for `auth.getLaunchContext()` (a display label, never proof of identity) and it
 *     is never a navigation param.
 *   - `tvashtr://auth/done?code=&state=` / `?error=cancelled|expired&state=` is the browser
 *     sign-in's return link. `parseAuthLink` hands it to main's sign-in only; the page never sees
 *     it (`parseDeepLink` rejects it).
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
// v6: the sign-in return link's pieces (a signed itsdangerous code, main's own state) and the
// website's display hint (a GitHub login).
const AUTH_CODE_RE = /^[A-Za-z0-9_.-]{1,1500}$/;
const AUTH_STATE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const AUTH_ERRORS = ["cancelled", "expired"];
const HINT_LOGIN_RE = /^[A-Za-z0-9-]{1,39}$/;

/**
 * The URL and its lower-cased path segments, or null when the link isn't a clean tvashtr: link.
 * @param {unknown} link
 */
function splitLink(link) {
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
  return { url, segments };
}

/**
 * The website's "who you are there" hint, when it names the configured API host.
 * @param {URL} url
 * @param {string | undefined} apiHost
 * @returns {{ login: string, host: string } | null}
 */
function readHint(url, apiHost) {
  if (!apiHost || url.searchParams.get("from") !== "web") return null;
  const login = url.searchParams.get("login") || "";
  const host = (url.searchParams.get("host") || "").toLowerCase();
  if (!HINT_LOGIN_RE.test(login) || host !== String(apiHost).toLowerCase()) return null;
  return { login, host };
}

/**
 * @param {unknown} link
 * @param {{ apiHost?: string }} [opts] the API host a `from=web` hint must name
 * @returns {{ path: string, params?: Record<string, string>, hint?: { login: string, host: string } } | null}
 */
function parseDeepLink(link, opts = {}) {
  const split = splitLink(link);
  if (!split) return null;
  const { url, segments } = split;

  const [area, page, ...rest] = segments;
  if (rest.length > 0) return null;

  /** @type {{ path: string, params?: Record<string, string> } | null} */
  let target = null;
  if (area === "home" && page === undefined) target = { path: "/home" };
  else if (area === "engines" && page !== undefined && Object.hasOwn(ENGINES, page)) {
    target = { path: ENGINES[/** @type {keyof typeof ENGINES} */ (page)] };
    const connect = (url.searchParams.get("connect") || "").toLowerCase();
    if (CONNECT_PROVIDERS.includes(connect)) target = { ...target, params: { connect } };
  } else if (area === "toolkit" && page !== undefined && Object.hasOwn(TOOLKIT, page)) {
    target = { path: TOOLKIT[/** @type {keyof typeof TOOLKIT} */ (page)] };
  } else if (area === "teams" && page !== undefined && UUID_RE.test(page)) {
    target = { path: `/teams/${page}` };
  }
  if (!target) return null;
  const hint = readHint(url, opts.apiHost);
  return hint ? { ...target, hint } : target;
}

/**
 * `tvashtr://auth/done…` — the browser sign-in's return link (main only).
 * @param {unknown} link
 * @returns {{ code?: string, error?: "cancelled" | "expired", state?: string } | null}
 *   null when it isn't an auth link or its pieces are malformed; `{}` for the bare link (the
 *   return page's button without a result: just bring the window forward).
 */
function parseAuthLink(link) {
  const split = splitLink(link);
  if (!split) return null;
  const { url, segments } = split;
  if (segments.length !== 2 || segments[0] !== "auth" || segments[1] !== "done") return null;
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  if (code === null && error === null && state === null) return {};
  if (state === null || !AUTH_STATE_RE.test(state)) return null;
  if (code !== null && error === null && AUTH_CODE_RE.test(code)) return { code, state };
  if (error !== null && code === null && AUTH_ERRORS.includes(error)) {
    return { error: /** @type {"cancelled" | "expired"} */ (error), state };
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

module.exports = {
  SCHEME,
  parseDeepLink,
  parseAuthLink,
  findDeepLinkArg,
  createNavigationQueue,
};
