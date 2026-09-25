/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional absolute API origin. Empty (default) = same-origin relative `/api` calls
   * (Vite proxy in dev, one-origin host in prod, desktop local reverse proxy in Electron).
   * Do not set this to https://tvashtr.fly.dev for the desktop build — use the local proxy.
   */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /**
   * Set by Electron preload when running inside Tvashtr Desktop.
   * Truthy object (v2+) or legacy boolean `true` (v1). Prefer truthiness checks.
   */
  tvashtrDesktop?: boolean | TvashtrDesktopBridge;
  /**
   * `version` feature-detects the bridge: 4 = `platform`; 5 = `engines.cancelConnect`,
   * `navigation`, `repos`, `app` (docs/superpowers/plans/api/desktop-bridge.md).
   */
  tvashtrDesktopInfo?: { shell: string; version: number; platform?: string };
}

/**
 * Where a `tvashtr://` deep link asks the app to go. `path` is an app hash address without the `#`
 * (`/home`, `/engines`, `/engines/subscriptions`, `/engines/keys`, `/toolkit/tools`,
 * `/toolkit/skills`, `/toolkit/memory/inbox`, `/toolkit/secrets`, `/teams/<uuid>`). `params` only
 * ever carries `connect: "claude" | "grok"` on Engines — highlight that card, never start Connect.
 */
interface TvashtrDeepLinkTarget {
  path: string;
  params?: { connect?: "claude" | "grok" } & Record<string, string>;
}

/** `repos.inspect(path)`; a non-git / missing / nested folder is a result, not a rejection. */
type TvashtrRepoInspection =
  | {
      is_git: true;
      current_branch: string | null;
      branches: string[];
      tracked_file_count: number;
      subpaths: { path: string; file_count: number }[];
      remote_url: string | null;
    }
  | { is_git: false; error: string };

interface TvashtrRecentFolder {
  path: string;
  /** Home dir shown as `~`. */
  displayPath: string;
  /** Current branch; null when detached, not git, or unavailable. */
  branch: string | null;
  /** False when the folder has been moved or deleted since it was used. */
  available: boolean;
}

interface TvashtrDesktopBridge {
  engines: {
    getStatus: () => Promise<import("./lib/engines").SubscriptionStatus[]>;
    connect: (
      provider: import("./lib/engines").SubscriptionProviderId,
    ) => Promise<import("./lib/engines").SubscriptionStatus>;
    disconnect: (
      provider: import("./lib/engines").SubscriptionProviderId,
    ) => Promise<import("./lib/engines").SubscriptionStatus>;
    refresh: (
      provider: import("./lib/engines").SubscriptionProviderId,
    ) => Promise<import("./lib/engines").SubscriptionStatus>;
    /**
     * M-subs-desktop: the main process re-asks a CLI when the window regains focus after Connect
     * opened the vendor login in Terminal, and pushes the new status here. Returns an unsubscribe.
     */
    onStatus?: (cb: (status: import("./lib/engines").SubscriptionStatus) => void) => () => void;
    /**
     * v5: stop re-checking a pending sign-in when the window regains focus; resolves the cached
     * status. It can't close the Terminal window the vendor login opened.
     */
    cancelConnect?: (
      provider: import("./lib/engines").SubscriptionProviderId,
    ) => Promise<import("./lib/engines").SubscriptionStatus>;
  };
  /** v5: `tvashtr://` deep links. */
  navigation?: {
    /**
     * Called for every allow-listed link while subscribed. The first subscriber also receives a
     * link that arrived before the page mounted. Returns an unsubscribe.
     */
    onNavigate: (cb: (target: TvashtrDeepLinkTarget) => void) => () => void;
    /** A link that arrived before anyone subscribed (each link is handed out once), else null. */
    consumePending: () => Promise<TvashtrDeepLinkTarget | null>;
  };
  /**
   * v5: local-folder runs. Every method rejects with an `Error` whose `message` is ready to show
   * (e.g. "Branch \"dev\" isn't in this folder's repository.").
   */
  repos?: {
    /** Native folder picker; null when cancelled. */
    pickFolder: () => Promise<{ path: string; displayPath: string } | null>;
    inspect: (path: string) => Promise<TvashtrRepoInspection>;
    recent: {
      /** Up to 8, most recent first, each re-checked. */
      list: () => Promise<TvashtrRecentFolder[]>;
      add: (path: string) => Promise<void>;
      remove: (path: string) => Promise<void>;
    };
    /**
     * Bundle `baseRef` (a local branch) and upload it; pass `snapshot_id` to `POST /api/runs` as
     * `local_repo.snapshot_id`. `label` defaults to the `~` path.
     */
    prepareRun: (args: {
      path: string;
      baseRef: string;
      label?: string;
    }) => Promise<{ snapshot_id: string; size_bytes: number }>;
    /**
     * Fetch the shipped run into the folder as branch `tvashtr/<runId>` — no checkout; the working
     * tree and current branch are untouched. Safe to call twice.
     */
    bringBackBranch: (args: { path: string; runId: string }) => Promise<{ branch: string }>;
  };
  /** v5 */
  app?: {
    /**
     * Report unsaved agent edits; while dirty, closing, reloading or quitting asks
     * "Keep editing / Discard and close". Send `{dirty:false}` after Save or Discard.
     */
    setUnsavedChanges: (state: { dirty: boolean; agentName?: string }) => void;
  };
}
