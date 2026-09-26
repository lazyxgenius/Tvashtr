import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { desktopLink, routeForDeepLink, useDesktopDeepLinks } from "./desktopDeepLinks";

afterEach(() => {
  delete window.tvashtrDesktop;
  window.history.replaceState(null, "", "/");
});

/** A fake v5 navigation bridge: `send` is a link arriving while the page listens. */
function installNavigation(pending: TvashtrDeepLinkTarget | null = null) {
  const listeners = new Set<(t: TvashtrDeepLinkTarget) => void>();
  const navigation = {
    onNavigate: vi.fn((cb: (t: TvashtrDeepLinkTarget) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    consumePending: vi.fn(() => Promise.resolve(pending)),
  };
  window.tvashtrDesktop = { navigation } as unknown as TvashtrDesktopBridge;
  return {
    navigation,
    listeners,
    send: (t: TvashtrDeepLinkTarget) => listeners.forEach((cb) => cb(t)),
  };
}

describe("desktopLink", () => {
  it("opens Subscriptions, optionally pointing at one card", () => {
    expect(desktopLink()).toBe("tvashtr://engines/subscriptions");
    expect(desktopLink(null)).toBe("tvashtr://engines/subscriptions");
    expect(desktopLink("grok")).toBe("tvashtr://engines/subscriptions?connect=grok");
  });
});

describe("routeForDeepLink", () => {
  it("maps a target onto the app's address", () => {
    expect(routeForDeepLink({ path: "/engines/keys" })).toEqual({ page: "engines", tab: "keys" });
    expect(routeForDeepLink({ path: "/toolkit/memory/inbox" })).toEqual({
      page: "memory",
      tab: "inbox",
    });
  });

  it("keeps connect only for Claude or Grok on Subscriptions", () => {
    expect(
      routeForDeepLink({ path: "/engines/subscriptions", params: { connect: "claude" } }),
    ).toEqual({ page: "engines", tab: "subscriptions", connect: "claude" });
    expect(
      routeForDeepLink({ path: "/engines/subscriptions", params: { connect: "codex" } }),
    ).toEqual({ page: "engines", tab: "subscriptions" });
    expect(routeForDeepLink({ path: "/engines/keys", params: { connect: "grok" } })).toEqual({
      page: "engines",
      tab: "keys",
    });
  });

  it("ignores anything that isn't a target, and sends an unknown path Home", () => {
    expect(routeForDeepLink(null)).toBeNull();
    expect(routeForDeepLink("/engines")).toBeNull();
    expect(routeForDeepLink({ path: 3 })).toBeNull();
    expect(routeForDeepLink({ path: "engines" })).toBeNull();
    expect(routeForDeepLink({ path: "/nope" })).toEqual({ page: "home" });
  });
});

describe("useDesktopDeepLinks", () => {
  it("moves the page to each link that arrives, then stops listening on unmount", () => {
    const bridge = installNavigation();
    const { unmount } = renderHook(() => useDesktopDeepLinks());
    expect(bridge.navigation.onNavigate).toHaveBeenCalledTimes(1);

    bridge.send({ path: "/engines/subscriptions", params: { connect: "grok" } });
    expect(window.location.hash).toBe("#/engines/subscriptions?connect=grok");
    bridge.send({ path: "/engines/keys" });
    expect(window.location.hash).toBe("#/engines/keys");

    unmount();
    expect(bridge.listeners.size).toBe(0);
  });

  it("follows a link that arrived before the page mounted", async () => {
    installNavigation({ path: "/engines/keys" });
    renderHook(() => useDesktopDeepLinks());
    await waitFor(() => expect(window.location.hash).toBe("#/engines/keys"));
  });

  it("does nothing on the website or on a Desktop build without navigation", () => {
    renderHook(() => useDesktopDeepLinks());
    window.tvashtrDesktop = true;
    renderHook(() => useDesktopDeepLinks());
    window.tvashtrDesktop = { engines: {} } as unknown as TvashtrDesktopBridge;
    renderHook(() => useDesktopDeepLinks());
    expect(window.location.hash).toBe("");
  });
});
