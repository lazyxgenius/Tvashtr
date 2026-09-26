/**
 * `tvashtr://` deep links, both ends (engines.md B3, spec §6).
 *
 * - The website opens Tvashtr Desktop with `openTvashtrDesktop(connect?)`: the browser hands
 *   `tvashtr://engines/subscriptions[?connect=claude|grok]` to the app (it may ask first).
 * - Inside Tvashtr Desktop, `useDesktopDeepLinks()` (mounted once, in Workspace) moves the page to
 *   the address a link names. The main process only ever hands over allow-listed targets (see
 *   desktop/electron/deepLink.cjs); this side re-checks the shape and maps it through `parseRoute`,
 *   so an unknown path lands Home. `connect` only highlights that card on Subscriptions — a link
 *   never starts Connect.
 */
import { useEffect } from "react";

import { type ConnectTarget, type Route, navigate, parseRoute } from "./nav";

const CONNECT_TARGETS: readonly string[] = ["claude", "grok"];

/** The link that opens (or focuses) Tvashtr Desktop on Subscriptions, optionally pointing at one
 *  card. */
export function desktopLink(connect?: ConnectTarget | null): string {
  const link = "tvashtr://engines/subscriptions";
  return connect ? `${link}?connect=${connect}` : link;
}

/** Hand the link to the browser. The page stays where it is: the browser asks whether to open the
 *  app, and does nothing visible when the app isn't installed. */
export function openTvashtrDesktop(connect?: ConnectTarget | null): void {
  window.location.href = desktopLink(connect);
}

/** The app address for a target the Desktop bridge delivered, or null when it isn't one. */
export function routeForDeepLink(target: unknown): Route | null {
  if (typeof target !== "object" || target === null) return null;
  const { path, params } = target as { path?: unknown; params?: unknown };
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const route = parseRoute(`#${path.split("?", 1)[0]}`);
  const connect =
    typeof params === "object" && params !== null
      ? (params as Record<string, unknown>).connect
      : undefined;
  if (
    route.page === "engines" &&
    route.tab === "subscriptions" &&
    typeof connect === "string" &&
    CONNECT_TARGETS.includes(connect)
  ) {
    return { ...route, connect: connect as ConnectTarget };
  }
  return route;
}

function bridgeNavigation(): TvashtrDesktopBridge["navigation"] {
  const bridge = window.tvashtrDesktop;
  return typeof bridge === "object" ? bridge.navigation : undefined;
}

/** Follow `tvashtr://` links while mounted: every one that arrives, plus one that arrived before
 *  the page did. A no-op on the website and on a Desktop build without the navigation bridge. */
export function useDesktopDeepLinks(): void {
  useEffect(() => {
    const nav = bridgeNavigation();
    if (!nav) return;
    let live = true;
    const go = (target: unknown) => {
      if (!live) return;
      const route = routeForDeepLink(target);
      if (route) navigate(route);
    };
    let off: (() => void) | undefined;
    try {
      off = nav.onNavigate?.(go);
    } catch {
      /* an older bridge without navigation events: the pending link below still works */
    }
    // Each link is handed out once, so this and the first subscription never both deliver it.
    void nav.consumePending?.().then(go, () => undefined);
    return () => {
      live = false;
      off?.();
    };
  }, []);
}
