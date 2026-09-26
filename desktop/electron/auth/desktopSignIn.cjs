/**
 * Bridge v6 `auth` (DB-1): sign in to Tvashtr in the user's default browser with PKCE.
 *
 * Main owns the whole handshake so the page never sees a code or the verifier:
 *   1. `start()` makes a verifier (32 random bytes, base64url), its SHA-256 challenge and a state
 *      (24 random bytes), opens `${apiOrigin}/api/auth/desktop/start?challenge=&state=&account=`
 *      in the default browser and starts a 10-minute clock.
 *   2. The browser signs in and fires `tvashtr://auth/done?code=&state=` (or `?error=&state=`).
 *      deepLink.cjs hands that link to `handleDone()` — never to the page. A link whose state
 *      doesn't match the pending sign-in is ignored.
 *   3. `handleDone()` exchanges `{code, verifier}` through the loopback proxy, stores the
 *      `tv_session` cookie on the loopback origin, remembers the last user, focuses the window
 *      and emits `signed_in`.
 * Everything Electron-specific is injected, so this module runs under `node --test`.
 */
const crypto = require("crypto");

const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;
const STATE_RE = /^[A-Za-z0-9_-]{16,64}$/;

const MESSAGES = {
  timeout: "The browser didn't send you back within 10 minutes.",
  cancelled: "You cancelled on GitHub. Nothing was changed.",
  expired: "This sign-in has expired. Sign in again.",
  exchange_failed: "Couldn't finish signing in. Sign in again.",
};

/** @param {Buffer} buf */
function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 S256. @param {string} verifier */
function challengeFor(verifier) {
  return base64url(crypto.createHash("sha256").update(verifier, "ascii").digest());
}

/**
 * `tv_session`'s value and lifetime from the exchange response's Set-Cookie headers.
 * @param {string[]} setCookies
 * @returns {{ value: string, maxAgeSeconds: number | null } | null}
 */
function readSessionCookie(setCookies) {
  for (const raw of setCookies) {
    const parts = String(raw).split(";").map((p) => p.trim());
    const [first, ...attrs] = parts;
    const eq = first.indexOf("=");
    if (eq < 0 || first.slice(0, eq) !== "tv_session") continue;
    let value = first.slice(eq + 1);
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!value) continue;
    let maxAgeSeconds = null;
    for (const a of attrs) {
      const m = /^max-age=(\d+)$/i.exec(a);
      if (m) maxAgeSeconds = Number(m[1]);
    }
    return { value, maxAgeSeconds };
  }
  return null;
}

/**
 * @typedef {{ id: string, email: string, github_login: string | null, display_name: string }} SignedInUser
 * @typedef {{ state: "waiting", signInUrl: string }
 *   | { state: "signed_in", user: SignedInUser }
 *   | { state: "failed", reason: "timeout" | "cancelled" | "expired" | "exchange_failed", message: string }} SignInEvent
 * @param {{
 *   apiOrigin: () => string,
 *   localOrigin: () => string,
 *   openExternal: (url: string) => Promise<unknown> | unknown,
 *   fetchImpl?: typeof fetch,
 *   setSessionCookie: (c: { url: string, value: string, maxAgeSeconds: number | null }) => Promise<void>,
 *   lastUser: { save: (u: { login: string, displayName: string }) => void },
 *   focus?: () => void,
 *   emit: (e: SignInEvent) => void,
 *   timeoutMs?: number,
 *   randomBytes?: (n: number) => Buffer,
 *   setTimer?: typeof setTimeout,
 *   clearTimer?: typeof clearTimeout,
 *   log?: (m: string) => void,
 * }} deps
 */
function createDesktopSignIn({
  apiOrigin,
  localOrigin,
  openExternal,
  fetchImpl = fetch,
  setSessionCookie,
  lastUser,
  focus = () => {},
  emit,
  timeoutMs = SIGN_IN_TIMEOUT_MS,
  randomBytes = crypto.randomBytes,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = () => {},
}) {
  /** @type {{ verifier: string, state: string, url: string, timer: any, exchanging: boolean } | null} */
  let pending = null;

  function stopClock() {
    if (pending && pending.timer) clearTimer(pending.timer);
    if (pending) pending.timer = null;
  }

  function startClock() {
    stopClock();
    if (!pending) return;
    const mine = pending;
    mine.timer = setTimer(() => {
      if (pending !== mine || mine.exchanging) return;
      pending = null;
      emit({ state: "failed", reason: "timeout", message: MESSAGES.timeout });
    }, timeoutMs);
    if (mine.timer && typeof mine.timer.unref === "function") mine.timer.unref();
  }

  function drop() {
    stopClock();
    pending = null;
  }

  /**
   * @param {{ account?: "current" | "github", openBrowser?: boolean }} [opts]
   * @returns {Promise<{ signInUrl: string }>}
   */
  async function start(opts = {}) {
    drop();
    const account = opts.account === "current" ? "current" : "github";
    const verifier = base64url(randomBytes(32));
    const state = base64url(randomBytes(24));
    const q = new URLSearchParams({ challenge: challengeFor(verifier), state, account });
    const url = `${apiOrigin().replace(/\/$/, "")}/api/auth/desktop/start?${q.toString()}`;
    pending = { verifier, state, url, timer: null, exchanging: false };
    startClock();
    if (opts.openBrowser !== false) await openExternal(url);
    emit({ state: "waiting", signInUrl: url });
    return { signInUrl: url };
  }

  /** Open the same sign-in page again and restart the 10-minute clock. */
  async function reopen() {
    if (!pending) return;
    startClock();
    await openExternal(pending.url);
  }

  /** Drop the pending sign-in: a code that arrives afterwards is ignored. */
  function cancel() {
    drop();
  }

  /**
   * A `tvashtr://auth/done` link (already parsed by deepLink.cjs).
   * @param {{ code?: string, error?: string, state?: string }} link
   * @returns {Promise<boolean>} whether it belonged to the pending sign-in
   */
  async function handleDone(link) {
    if (!pending || pending.exchanging || !link || typeof link.state !== "string") return false;
    if (!STATE_RE.test(link.state) || link.state !== pending.state) {
      log("[tvashtr-desktop] ignored a sign-in link for another sign-in");
      return false;
    }
    const mine = pending;
    if (link.error) {
      drop();
      const reason = link.error === "expired" ? "expired" : "cancelled";
      emit({ state: "failed", reason, message: MESSAGES[reason] });
      return true;
    }
    if (!link.code) return false;
    mine.exchanging = true;
    stopClock();
    try {
      const res = await fetchImpl(`${localOrigin().replace(/\/$/, "")}/api/auth/desktop/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ code: link.code, verifier: mine.verifier }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = body && typeof body.detail === "string" ? body.detail : null;
        throw Object.assign(new Error(detail || `exchange -> ${res.status}`), { detail });
      }
      const setCookies =
        typeof res.headers.getSetCookie === "function"
          ? res.headers.getSetCookie()
          : [res.headers.get("set-cookie") || ""];
      const cookie = readSessionCookie(setCookies);
      if (!cookie || !body || typeof body.id !== "string") throw new Error("no session");
      if (pending !== mine) return true; // cancelled while exchanging: drop the session unused
      await setSessionCookie({ url: localOrigin(), ...cookie });
      pending = null;
      /** @type {SignedInUser} */
      const user = {
        id: body.id,
        email: typeof body.email === "string" ? body.email : "",
        github_login: typeof body.github_login === "string" ? body.github_login : null,
        display_name: typeof body.display_name === "string" ? body.display_name : "",
      };
      try {
        lastUser.save({ login: user.github_login || user.display_name, displayName: user.display_name });
      } catch (e) {
        log(`[tvashtr-desktop] couldn't remember the last user: ${e}`);
      }
      focus();
      emit({ state: "signed_in", user });
      return true;
    } catch (e) {
      if (pending === mine) pending = null;
      const detail = /** @type {any} */ (e).detail;
      emit({
        state: "failed",
        reason: "exchange_failed",
        message: typeof detail === "string" && detail ? detail : MESSAGES.exchange_failed,
      });
      return true;
    }
  }

  return {
    start,
    reopen,
    cancel,
    handleDone,
    /** The pending sign-in page (for "Copy the sign-in link"), or null. */
    signInUrl: () => (pending ? pending.url : null),
    isPending: () => pending !== null,
  };
}

module.exports = {
  createDesktopSignIn,
  challengeFor,
  readSessionCookie,
  SIGN_IN_TIMEOUT_MS,
  MESSAGES,
};
