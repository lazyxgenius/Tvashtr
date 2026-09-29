import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NodePalette } from "./NodePalette";
import { NodePicker } from "./NodePicker";
import * as items from "./paletteItems";

// Ruling 2 (DmF-Canvas-1): "+ Add to canvas" and the inline "+" picker offer exactly
// Agent · Gate · Ship · Stop · Query domain — no Presets row. "Agent" is a blank worker; role
// starting points come from the drawer's Templates.
const MENU = ["Agent", "Gate", "Ship", "Stop", "Query domain"];

describe("the canvas add menu (ruling 2)", () => {
  it("lists Agent · Gate · Ship · Stop · Query domain, and Agent adds a blank worker", () => {
    expect(items.PALETTE_PRIMITIVES.map((c) => c.label)).toEqual(MENU);
    expect(items.PALETTE_PRIMITIVES[0].body).toEqual({ node_kind: "worker" });
    expect("PALETTE_PRESETS" in items).toBe(false);
  });

  it("the palette popover has no Presets row", () => {
    render(<NodePalette onAdd={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to canvas" }));
    const menu = screen.getByRole("menu", { name: "Add to canvas" });
    expect(
      within(menu)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(MENU);
    expect(within(menu).queryByText("Presets")).toBeNull();
  });

  it("the inline picker offers the same five items", () => {
    render(<NodePicker x={0} y={0} onPick={() => {}} onCancel={() => {}} />);
    const picker = screen.getByRole("dialog", { name: "Add a downstream node" });
    const names = within(picker)
      .getAllByRole("button")
      .map((b) => b.querySelector(".tv-picker__name")?.textContent);
    expect(names).toEqual(MENU);
  });
});
