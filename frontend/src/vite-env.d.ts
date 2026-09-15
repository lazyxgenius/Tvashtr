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
  /** Set by Electron preload when running inside Tvashtr Desktop. */
  tvashtrDesktop?: boolean;
  tvashtrDesktopInfo?: { shell: string; version: number };
}
