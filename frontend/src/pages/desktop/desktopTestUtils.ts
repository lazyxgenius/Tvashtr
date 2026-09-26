/**
 * Test helpers for the Desktop app screens: a fake v6 bridge (`window.tvashtrDesktop`) and a
 * fetch stub keyed by "METHOD /path". Later groups extend `installDesktopBridge` (setup, update).
 */
import { vi } from "vitest";

import type { SubscriptionStatus } from "../../lib/engines";

export const ME = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "lazyxgenius@users.noreply.github.com",
  github_login: "lazyxgenius",
  display_name: "lazyxgenius",
};

export const SIGN_IN_URL =
  "https://tvashtr.fly.dev/api/auth/desktop/start?challenge=c&state=s&account=github";

export interface FakeBridgeOptions {
  openedFromWeb?: { login: string; host: string } | null;
  lastUser?: { login: string; displayName: string } | null;
  platform?: string;
  version?: string;
  /** What `engines.getStatus` answers (the splash's plan lines). */
  plans?: SubscriptionStatus[];
  /** What `update.getState` answers first. */
  update?: TvashtrUpdateState;
}

/** A plan CLI's status as the bridge reports it. */
export function plan(
  provider: SubscriptionStatus["provider"],
  state: SubscriptionStatus["state"],
): SubscriptionStatus {
  return {
    provider,
    state,
    connected: state === "connected",
    account_hint: null,
    source: state === "connected" ? "harness" : null,
    checked_at: null,
  };
}

export function installDesktopBridge(opts: FakeBridgeOptions = {}) {
  const signInListeners = new Set<(e: TvashtrSignInEvent) => void>();
  const navListeners = new Set<(t: TvashtrDeepLinkTarget) => void>();
  const updateListeners = new Set<(s: TvashtrUpdateState) => void>();
  const auth = {
    startSignIn: vi.fn<
      (o?: { account?: "current" | "github"; openBrowser?: boolean }) => Promise<{
        signInUrl: string;
      }>
    >(() => Promise.resolve({ signInUrl: SIGN_IN_URL })),
    reopenBrowser: vi.fn(() => Promise.resolve()),
    cancelSignIn: vi.fn(() => Promise.resolve()),
    onSignIn: vi.fn((cb: (e: TvashtrSignInEvent) => void) => {
      signInListeners.add(cb);
      return () => signInListeners.delete(cb);
    }),
    getLaunchContext: vi.fn(() =>
      Promise.resolve({
        openedFromWeb: opts.openedFromWeb ?? null,
        lastUser: opts.lastUser ?? null,
      }),
    ),
    rememberUser: vi.fn<(u: { login: string; displayName: string }) => Promise<void>>(() =>
      Promise.resolve(),
    ),
    forgetUser: vi.fn(() => Promise.resolve()),
  };
  const app = {
    setUnsavedChanges: vi.fn(),
    getInfo: vi.fn(() =>
      Promise.resolve({
        version: opts.version ?? "0.5.0",
        apiOrigin: "https://tvashtr.fly.dev",
        apiHost: "tvashtr.fly.dev",
        platform: opts.platform ?? "darwin",
        bundlePath: null,
        bundleWritable: false,
      }),
    ),
  };
  const navigation = {
    onNavigate: vi.fn((cb: (t: TvashtrDeepLinkTarget) => void) => {
      navListeners.add(cb);
      return () => navListeners.delete(cb);
    }),
    consumePending: vi.fn(() => Promise.resolve(null)),
  };
  const update = {
    getState: vi.fn(() => Promise.resolve(opts.update ?? { state: "idle" })),
    onState: vi.fn((cb: (s: TvashtrUpdateState) => void) => {
      updateListeners.add(cb);
      return () => updateListeners.delete(cb);
    }),
  };
  const bridge = {
    engines: {
      getStatus: vi.fn(() => Promise.resolve(opts.plans ?? [])),
      connect: vi.fn(),
      disconnect: vi.fn(),
      refresh: vi.fn(),
    },
    navigation,
    auth,
    app,
    update,
  } as unknown as TvashtrDesktopBridge;
  window.tvashtrDesktop = bridge;
  window.tvashtrDesktopInfo = {
    shell: "electron",
    version: 6,
    platform: opts.platform ?? "darwin",
  };
  document.documentElement.dataset.tvashtrDesktop = "true";
  return {
    auth,
    app,
    navigation,
    fireSignIn: (e: TvashtrSignInEvent) => signInListeners.forEach((cb) => cb(e)),
    fireNavigate: (t: TvashtrDeepLinkTarget) => navListeners.forEach((cb) => cb(t)),
    fireUpdate: (s: TvashtrUpdateState) => updateListeners.forEach((cb) => cb(s)),
  };
}

export function uninstallDesktopBridge() {
  delete window.tvashtrDesktop;
  delete window.tvashtrDesktopInfo;
  delete document.documentElement.dataset.tvashtrDesktop;
}

type Answer = { status?: number; body?: unknown } | "network" | "pending";
type Reply = Answer | (() => Answer);

/** Answered unless a test says otherwise: the server is up and the account has no teams. */
const DEFAULT_ROUTES: Record<string, Reply> = {
  "GET /health": { body: { status: "ok", db: "ok" } },
  "GET /api/teams": { body: { teams: [] } },
};

/**
 * Stub fetch: `routes["GET /api/auth/me"] = {status: 401}`; unknown paths answer 404. A reply of
 * `"network"` rejects like fetch does when nothing answers; `"pending"` never answers (until
 * the request is aborted).
 */
export function stubFetch(given: Record<string, Reply>) {
  const routes = { ...DEFAULT_ROUTES, ...given };
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, "http://localhost");
    const key = `${(init?.method ?? "GET").toUpperCase()} ${url.pathname}`;
    const hit = routes[key];
    const reply = typeof hit === "function" ? hit() : hit;
    if (reply === "network") return Promise.reject(new TypeError("Failed to fetch"));
    if (reply === "pending") {
      // Like fetch: nothing ever answers, but aborting the request rejects it.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      });
    }
    const status = reply === undefined ? 404 : (reply.status ?? 200);
    const body = reply === undefined ? { detail: "no fixture" } : (reply.body ?? {});
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const HOSTED_CONFIG = {
  hosted_mode: true,
  github_install_url: "https://github.com/login/oauth/authorize?client_id=x",
  github_manage_url: "",
  provider_catalogue: [],
};
