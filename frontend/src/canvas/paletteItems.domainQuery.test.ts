import { describe, expect, it } from "vitest";
import { PALETTE_PRIMITIVES } from "./paletteItems";

describe("palette domain_query", () => {
  it("offers a Query domain primitive", () => {
    const chip = PALETTE_PRIMITIVES.find((c) => c.body.node_kind === "domain_query");
    expect(chip).toBeTruthy();
    expect(chip!.label.toLowerCase()).toMatch(/query domain|domain/);
  });
});
