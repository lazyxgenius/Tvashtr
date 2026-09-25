import { expect, type Page } from "@playwright/test";

/**
 * The canvas palette (f1b) is an "Add to canvas" menu that opens on hover: open it, then pick a
 * chip by its exact label. (Hovering, not clicking, the trigger: a click after the hover-open would
 * toggle the menu shut again.)
 */
export async function paletteAdd(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Add to canvas" }).hover();
  const menu = page.getByRole("menu", { name: "Add to canvas" });
  await expect(menu).toBeVisible({ timeout: 15_000 });
  await menu.getByRole("button", { name: label, exact: true }).click();
}
