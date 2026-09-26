/**
 * Test helpers for the Desktop app screens: a fake v6 bridge (`window.tvashtrDesktop`) and a
 * fetch stub keyed by "METHOD /path". `installDesktopBridge({setup})` adds this Mac's setup store
 * (G3); `fireStatus` pushes an `engines.onStatus` event.
 */
import { vi } from "vitest";

import { resetDesktopSetup } from "../../lib/desktopSetup";
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
  /**
   * This Mac's setup record (bridge `setup`, DB-4) for every account; omitted = no `setup` on the
   * bridge (an older Desktop: no first-run setup).
   */
  setup?: Partial<TvashtrDesktopSetup>;
  /** What `engines.connect(p)` answers per provider (default: connected). */
  connect?: Partial<Record<SubscriptionStatus["provider"], SubscriptionStatus["state"]>>;
  /** What `engines.refresh(p)` answers per provider (default: connected). */
  refresh?: Partial<Record<SubscriptionStatus["provider"], SubscriptionStatus["state"]>>;
  /**
   * This Mac's folders (bridge `repos`): what the picker returns, what `inspect` answers per path
   * (an Error rejects), what `initGit` answers (an Error rejects; `false` = an older Desktop
   * without it). Omitted = no `repos` on the bridge.
   */
  repos?: {
    pick?: { path: string; displayPath: string } | null;
    inspect?: Record<string, TvashtrRepoInspection | Error>;
    initGit?: { branch: "main"; commit: string; file_count: number } | Error | false;
  };
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
  const statusListeners = new Set<(s: SubscriptionStatus) => void>();
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
  type Provider = SubscriptionStatus["provider"];
  const engines = {
    getStatus: vi.fn(() => Promise.resolve(opts.plans ?? [])),
    connect: vi.fn((p: Provider) => Promise.resolve(plan(p, opts.connect?.[p] ?? "connected"))),
    disconnect: vi.fn((p: Provider) => Promise.resolve(plan(p, "disconnected"))),
    refresh: vi.fn((p: Provider) => Promise.resolve(plan(p, opts.refresh?.[p] ?? "connected"))),
    cancelConnect: vi.fn((p: Provider) =>
      Promise.resolve(opts.plans?.find((s) => s.provider === p) ?? plan(p, "disconnected")),
    ),
    onStatus: vi.fn((cb: (s: SubscriptionStatus) => void) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    }),
  };
  let stored: TvashtrDesktopSetup | null = opts.setup
    ? {
        version: 1,
        step: null,
        finishedAt: null,
        planConsentAt: null,
        workspace: null,
        ...opts.setup,
      }
    : null;
  const setup = {
    get: vi.fn<(id: string) => Promise<TvashtrDesktopSetup>>(() => Promise.resolve({ ...stored! })),
    update: vi.fn<
      (id: string, patch: Partial<TvashtrDesktopSetup>) => Promise<TvashtrDesktopSetup>
    >((_id, patch) => {
      stored = { ...stored!, ...patch };
      return Promise.resolve({ ...stored });
    }),
  };
  const reposOpts = opts.repos;
  const repos = {
    pickFolder: vi.fn(() => Promise.resolve(reposOpts?.pick ?? null)),
    inspect: vi.fn((path: string) => {
      const out = reposOpts?.inspect?.[path];
      if (out instanceof Error) return Promise.reject(out);
      return Promise.resolve(
        out ?? {
          is_git: false as const,
          error: "That folder doesn't exist any more.",
          reason: "missing" as const,
        },
      );
    }),
    initGit: vi.fn((args: { path: string }) => {
      void args;
      const out = reposOpts?.initGit ?? {
        branch: "main" as const,
        commit: "c0ffee",
        file_count: 3,
      };
      return out instanceof Error ? Promise.reject(out) : Promise.resolve(out || undefined);
    }),
    recent: {
      list: vi.fn(() => Promise.resolve([])),
      add: vi.fn((path: string) => {
        void path;
        return Promise.resolve();
      }),
      remove: vi.fn(() => Promise.resolve()),
    },
  };
  const reposBridge = reposOpts?.initGit === false ? { ...repos, initGit: undefined } : repos;
  const bridge = {
    engines,
    navigation,
    auth,
    app,
    update,
    ...(stored ? { setup } : {}),
    ...(reposOpts ? { repos: reposBridge } : {}),
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
    engines,
    setup,
    repos,
    fireStatus: (s: SubscriptionStatus) => statusListeners.forEach((cb) => cb(s)),
    fireSignIn: (e: TvashtrSignInEvent) => signInListeners.forEach((cb) => cb(e)),
    fireNavigate: (t: TvashtrDeepLinkTarget) => navListeners.forEach((cb) => cb(t)),
    fireUpdate: (s: TvashtrUpdateState) => updateListeners.forEach((cb) => cb(s)),
  };
}

export function uninstallDesktopBridge() {
  resetDesktopSetup();
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
