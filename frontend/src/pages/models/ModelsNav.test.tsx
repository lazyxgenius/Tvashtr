import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Route } from "../../lib/nav";
import { buildPaletteGroups } from "../home/paletteItems";
import { Shell } from "../shell/Shell";

afterEach(cleanup);

function shell(route: Route) {
  const onNavigate = vi.fn();
  render(
    <Shell
      route={route}
      user={{ email: "a@b.c" }}
      badges={{}}
      onNavigate={onNavigate}
      onOpenSearch={vi.fn()}
      onShowShortcuts={vi.fn()}
      onLogout={vi.fn()}
    >
      <div />
    </Shell>,
  );
  return { onNavigate, nav: screen.getByRole("navigation", { name: "Dashboard" }) };
}

describe("the menu", () => {
  it("has Models right after Domains, with no children, highlighted on every Models page", () => {
    for (const route of [
      { page: "models" },
      { page: "models", modelId: "m1" },
      { page: "models", modelId: "m1", tab: "results" },
    ] as Route[]) {
      const { nav } = shell(route);
      const items = within(nav)
        .getAllByRole("button")
        .map((b) => b.textContent);
      expect(items.slice(0, 4)).toEqual(["Home", "Domains", "Models", "Engines"]);
      expect(within(nav).getByRole("button", { name: "Models" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(nav).toHaveTextContent(
        "Models start with tests: real cases with the right answers, so you can see how well any model does your job.",
      );
      cleanup();
    }
  });

  it("goes to the list", () => {
    const { nav, onNavigate } = shell({ page: "home" });
    fireEvent.click(within(nav).getByRole("button", { name: "Models" }));
    expect(onNavigate).toHaveBeenCalledWith({ page: "models" });
  });
});

describe("Cmd-K", () => {
  it("offers Open Models right after Open Domains", () => {
    const groups = buildPaletteGroups({
      query: "open",
      teams: [],
      runs: [],
      domains: [],
      inbox: [],
    });
    const labels = groups.flatMap((g) => g.options.map((o) => o.label));
    expect(labels[labels.indexOf("Open Domains") + 1]).toBe("Open Models");
    const models = buildPaletteGroups({
      query: "open models",
      teams: [],
      runs: [],
      domains: [],
      inbox: [],
    })[0].options[0];
    expect(models.target).toEqual({ kind: "models" });
  });
});
