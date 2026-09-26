import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { navigate, parseRoute, type Route, routeToHash, sectionOf, useNav } from "./nav";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("parseRoute / routeToHash", () => {
  const cases: [string, Route][] = [
    ["#/home", { page: "home" }],
    ["#/domains", { page: "domains" }],
    ["#/engines", { page: "engines", tab: "overview" }],
    ["#/engines/subscriptions", { page: "engines", tab: "subscriptions" }],
    ["#/engines/keys", { page: "engines", tab: "keys" }],
    ["#/engines?fix=1", { page: "engines", tab: "overview", fix: true }],
    [
      "#/engines/subscriptions?connect=grok",
      { page: "engines", tab: "subscriptions", connect: "grok" },
    ],
    ["#/toolkit/tools", { page: "tools", view: "installed" }],
    ["#/toolkit/tools/browse", { page: "tools", view: "browse" }],
    ["#/toolkit/tools/abc-123", { page: "tool", toolId: "abc-123" }],
    ["#/toolkit/skills", { page: "skills", view: "mine" }],
    ["#/toolkit/skills/presets", { page: "skills", view: "presets" }],
    ["#/toolkit/skills/new", { page: "skill", skillId: "new" }],
    ["#/toolkit/memory/active", { page: "memory", tab: "active" }],
    ["#/toolkit/secrets", { page: "secrets" }],
    ["#/teams/t1", { page: "team", teamId: "t1" }],
    ["#/teams/t1/runs/r1", { page: "team", teamId: "t1", runId: "r1" }],
    [
      "#/teams/t1?node=n1&tab=skills&focus=1",
      { page: "team", teamId: "t1", node: "n1", tab: "skills", focus: true },
    ],
    [
      "#/teams/t1/docs/d1?v=3&compare=2",
      { page: "team", teamId: "t1", docId: "d1", version: 3, compare: 2 },
    ],
  ];

  it.each(cases)("%s round-trips", (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
    expect(routeToHash(route)).toBe(hash);
  });

  it("sends empty, unknown and malformed addresses Home", () => {
    expect(parseRoute("")).toEqual({ page: "home" });
    expect(parseRoute("#/")).toEqual({ page: "home" });
    expect(parseRoute("#/nope")).toEqual({ page: "home" });
    expect(parseRoute("#/teams")).toEqual({ page: "home" });
  });

  it("falls back to each section's first tab for an unknown tab", () => {
    expect(parseRoute("#/engines/zzz")).toEqual({ page: "engines", tab: "overview" });
    // Only Overview highlights the rows to fix.
    expect(parseRoute("#/engines/keys?fix=1")).toEqual({ page: "engines", tab: "keys" });
    // Only Subscriptions highlights a card, and only Claude or Grok (Codex never connects).
    expect(parseRoute("#/engines/keys?connect=grok")).toEqual({ page: "engines", tab: "keys" });
    expect(parseRoute("#/engines/subscriptions?connect=codex")).toEqual({
      page: "engines",
      tab: "subscriptions",
    });
    expect(parseRoute("#/toolkit/memory/zzz")).toEqual({ page: "memory", tab: "inbox" });
    expect(parseRoute("#/toolkit")).toEqual({ page: "tools", view: "installed" });
  });

  it("drops an unknown node tab and a non-numeric version", () => {
    expect(parseRoute("#/teams/t1?tab=bogus&v=x")).toEqual({ page: "team", teamId: "t1" });
  });

  it("encodes ids", () => {
    expect(routeToHash({ page: "tool", toolId: "a b" })).toBe("#/toolkit/tools/a%20b");
    expect(parseRoute("#/toolkit/tools/a%20b")).toEqual({ page: "tool", toolId: "a b" });
  });
});

describe("sectionOf", () => {
  it("groups the Toolkit pages", () => {
    expect(sectionOf({ page: "secrets" })).toBe("toolkit");
    expect(sectionOf({ page: "tool", toolId: "x" })).toBe("toolkit");
    expect(sectionOf({ page: "engines", tab: "keys" })).toBe("engines");
  });
});

describe("useNav", () => {
  it("re-renders on navigation and supports replace", () => {
    const { result } = renderHook(() => useNav());
    expect(result.current.route).toEqual({ page: "home" });
    act(() => navigate({ page: "engines", tab: "keys" }));
    // jsdom fires hashchange asynchronously for a hash assignment; dispatch it for the test.
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current.route).toEqual({ page: "engines", tab: "keys" });
    const before = window.history.length;
    act(() => result.current.navigate({ page: "secrets" }, { replace: true }));
    expect(result.current.route).toEqual({ page: "secrets" });
    expect(window.history.length).toBe(before);
  });
});
