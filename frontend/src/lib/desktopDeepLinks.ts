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

/** Firefox replaces the page with "The address wasn't understood" when a top-level navigation
 *  names a scheme no app handles; inside a hidden frame that error stays invisible. */
function isGecko(): boolean {
  return typeof navigator !== "undefined" && /\bfirefox\//i.test(navigator.userAgent);
}

/** Hand the link to the browser (call it inside the click, so the browser lets it through). The
 *  page stays where it is: the browser asks whether to open the app, and shows nothing that leaves
 *  the page when the app isn't installed — Chrome and Safari keep the page for a top-level link,
 *  Firefox gets it through one reusable hidden frame. */
export function openTvashtrDesktop(connect?: ConnectTarget | null): void {
  const link = desktopLink(connect);
  if (!isGecko()) {
    window.location.href = link;
    return;
  }
  let frame = document.querySelector<HTMLIFrameElement>("iframe[data-tvashtr-desktop-link]");
  if (!frame) {
    frame = document.createElement("iframe");
    frame.dataset.tvashtrDesktopLink = "";
    frame.hidden = true;
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    document.body.appendChild(frame);
  }
  frame.src = link;
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
