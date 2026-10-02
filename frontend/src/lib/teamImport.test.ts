import { describe, expect, it } from "vitest";

import type { ImportFix } from "./api/teams";
import { fixChips, fixRoute } from "./teamImport";

const fix = (key: string, action: ImportFix["action"], target: string, node_ids: string[]) => ({
  key,
  text: key,
  action,
  target,
  node_ids,
});

describe("an import's fixes (M4)", () => {
  it("become each node's chips: sign-ins by name, tools and skills counted", () => {
    const chips = fixChips([
      fix("connector:github", "sign_in", "github", ["eng"]),
      fix("connector:notion", "sign_in", "notion", ["pm"]),
      fix("tool:chart-render", "open_toolkit", "chart-render", ["eng"]),
      fix("tool:lint", "open_toolkit", "lint", ["eng"]),
      fix("skill:pytest", "open_toolkit", "pytest", ["eng", "rev"]),
      fix("model:anthropic", "open_engines", "anthropic", ["rev"]),
    ]);
    expect(chips.get("eng")).toEqual(["Needs GitHub", "2 tools missing", "1 skill missing"]);
    expect(chips.get("pm")).toEqual(["Needs Notion"]);
    expect(chips.get("rev")).toEqual(["Needs a model key", "1 skill missing"]);
  });

  it("each open the place to fix them; GitHub's sign-in is the App install (no route)", () => {
    expect(fixRoute(fix("connector:github", "sign_in", "github", []))).toBeNull();
    expect(fixRoute(fix("connector:notion", "sign_in", "notion", []))).toEqual({
      page: "connectors",
      view: "connected",
    });
    expect(fixRoute(fix("tool:x", "open_toolkit", "x", []))).toEqual({
      page: "tools",
      view: "installed",
    });
    expect(fixRoute(fix("skill:x", "open_toolkit", "x", []))).toEqual({
      page: "skills",
      view: "mine",
    });
    expect(fixRoute(fix("secret:X", "open_toolkit", "X", []))).toEqual({ page: "secrets" });
    expect(fixRoute(fix("model:a", "open_engines", "a", []))).toEqual({
      page: "engines",
      tab: "overview",
      fix: true,
    });
  });
});

describe("a Domain the import couldn't find (M4)", () => {
  it("is made on the Domains page and its node says it needs one", () => {
    const f = fix("domain:docs", "open_domains", "docs", ["ask"]);
    expect(fixRoute(f)).toEqual({ page: "domains" });
    expect(fixChips([f]).get("ask")).toEqual(["Needs a Domain"]);
  });
});
