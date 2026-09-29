import { expect, type Locator, type Page } from "@playwright/test";

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

/** Click a node's card on the canvas and return its open drawer ("<Name> settings"). */
export async function openNodeDrawer(page: Page, nodeId: string): Promise<Locator> {
  await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
  const panel = page.getByRole("complementary", { name: / settings$/ });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

/**
 * Ruling 2: role starting points come from the drawer's Templates. In the open agent drawer
 * `panel`, apply the `title` template (e.g. "Engineer") and Save.
 */
export async function applyDrawerTemplate(
  page: Page,
  panel: Locator,
  title: string,
): Promise<void> {
  await panel.getByRole("button", { name: "Templates" }).click();
  await page
    .getByRole("menu", { name: "Templates" })
    .getByRole("menuitem", { name: title })
    .click();
  await panel.getByRole("button", { name: /^Save/ }).click();
  await expect(panel.getByText(/Saved/)).toBeVisible({ timeout: 30_000 });
}

/**
 * In an open agent drawer ("<Name> settings"): replace the instructions, pick `model` through the
 * model picker's "Use a custom model ID", and Save.
 */
export async function saveAgentPromptAndModel(
  page: Page,
  agent: string,
  prompt: string,
  model: string,
): Promise<void> {
  const panel = page.getByRole("complementary", { name: `${agent} settings` });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.getByRole("textbox", { name: /^Instructions/ }).fill(prompt);
  await panel
    .getByRole("region", { name: "Model" })
    .locator('button[aria-haspopup="dialog"]')
    .click();
  const picker = panel.getByRole("dialog", { name: "Choose a model" });
  await picker.getByRole("button", { name: "Use a custom model ID" }).click();
  await picker.getByLabel("Custom model ID").fill(model);
  await picker.getByRole("button", { name: "Use this model" }).click();
  await expect(picker).toHaveCount(0);
  await panel.getByRole("button", { name: /^Save/ }).click();
  await expect(panel.getByText(/Saved/)).toBeVisible({ timeout: 30_000 });
}
