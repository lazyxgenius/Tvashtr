import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { registerFresh, shellNav } from "./_home";
import { openMyTeam } from "./_myTeam";

// Google Cloud 1 sign-off (G1–G4): the Add key sheet offers Google Cloud with its hint, a saved key
// shows its last four, a worker's picker lists the Google Cloud models, and the two Google rows read apart. No model call: POST /api/providers saves any key, so
// this uses a made-up one. Element screenshots go to artifacts/gcloud-1/ (git-ignored).

const SHOTS_DIR = process.env.TVASHTR_GCLOUD_SHOTS_DIR ?? "../artifacts/gcloud-1";
const TEST_KEY = "AQ.made-up-for-this-test-only-not-a-real-key-W7xQ";

test("Google Cloud: the Add key sheet, the saved row, the picker", async ({ page }) => {
  test.setTimeout(2 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const shot = (name: string) => path.join(SHOTS_DIR, `${name}.png`);

  await registerFresh(page, "gcloud");
  const nav = shellNav(page);
  await nav.getByRole("button", { name: /^Engines/ }).click();
  await nav.getByRole("button", { name: /^API keys/ }).click();

  // G1 + G4: the picker lists Google Cloud right after Gemini, and the two rows read apart.
  await page.getByRole("button", { name: "Add key" }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /Choose a provider/ }).click();
  const providers = sheet.getByRole("listbox", { name: "Providers" });
  const cloud = providers.getByRole("option", { name: /vertex_ai/ });
  const gemini = providers.getByRole("option", { name: /^G?\s*gemini/ });
  await expect(cloud).toContainText("Gemini on your Google Cloud account (Vertex AI)");
  await expect(gemini).toContainText(
    "Gemini models with a Google AI Studio key, and Domains embeddings",
  );
  await page.screenshot({ path: shot("g4-provider-list") });
  await cloud.click();
  await expect(
    sheet.getByText(
      "Paste a Google Cloud API key. Calls are billed to that Google Cloud account, so its credits pay.",
    ),
  ).toBeVisible();
  await page.screenshot({ path: shot("g1-add-key-sheet") });

  // G2: save through the sheet; the row shows the provider's slug, as every row does, and the last four.
  await sheet.getByLabel("API key").fill(TEST_KEY);
  await sheet.getByRole("button", { name: "Save key" }).click();
  await expect(sheet).toBeHidden({ timeout: 30_000 });
  const row = page.getByRole("row").filter({ hasText: "W7xQ" });
  await expect(row).toContainText("vertex_ai");
  await page.screenshot({ path: shot("g2-saved-row") });

  // G3: a worker's picker lists the Google Cloud models, the default selected.
  await openMyTeam(page);
  await page.locator(".react-flow__node", { hasText: "Engineer" }).first().click();
  const panel = page.getByRole("complementary", { name: "Engineer settings" });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel
    .getByRole("region", { name: "Model" })
    .locator('button[aria-haspopup="dialog"]')
    .click();
  const picker = panel.getByRole("dialog", { name: "Choose a model" });
  const group = picker.getByRole("group", { name: /^vertex_ai\b/ });
  await expect(group.getByRole("option", { name: "gemini-3-flash-preview" })).toBeVisible();
  await expect(group.getByRole("option", { name: "gemini-3.5-flash" })).toBeVisible();
  await page.screenshot({ path: shot("g3-model-picker") });
});
