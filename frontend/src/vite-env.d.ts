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
  tvashtrDesktopInfo?: { shell: string; version: number };
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
  };
}
