import { expect, test } from "@playwright/test";

import { registerFresh } from "./_home";

/**
 * Live gate for Domains (no model or key needed): sign up, create a domain from the empty page with
 * a Markdown file, land on its page with the file waiting for a reading key (reading is automatic,
 * it starts once the key is saved), rename it from the header ⋯ menu, then delete it back to the
 * empty page. Run against a live backend + Vite (see scripts/accounts_e2e.sh for the boot steps).
 */
test("Domains: create with a file, wait for the key, rename, delete", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Dashboard" });

  // Sign up the way every live spec does since the public site replaced the old landing.
  await registerFresh(page, "domains");
  await expect(nav).toBeVisible({ timeout: 30_000 });

  // The empty page (Dm-ListEmpty) → New domain.
  await nav.getByRole("button", { name: /^Domains/ }).click();
  await expect(page).toHaveURL(/#\/domains$/);
  await expect(
    page.getByRole("heading", { name: "Give your agents your own documents" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New domain" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New domain" });
  await dialog.getByLabel("Name").fill("Support docs");
  await dialog.getByRole("button", { name: "Next: add files" }).click();
  await dialog.getByTestId("new-domain-files").setInputFiles({
    name: "refund-policy.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Refunds\n\nRefunds are issued within 30 days of purchase.\n"),
  });
  // No reading key on a fresh account: the file is saved now and read once the key is added.
  await dialog.getByRole("button", { name: "Create and add 1 file" }).click();

  // Its page: the file waits for the key, the nav row is current.
  await expect(page).toHaveURL(/#\/domains\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Support docs" })).toBeVisible();
  const files = page.getByRole("region", { name: "Files" });
  await expect(files.getByText("refund-policy.md")).toBeVisible();
  await expect(files.getByText(/Waiting for an openai key/)).toBeVisible();
  await expect(nav.getByRole("button", { name: "Support docs" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Rename from the header ⋯ menu.
  await page.getByRole("button", { name: "More actions for Support docs" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename domain" });
  await rename.getByLabel("Name").fill("Help center");
  await rename.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Help center" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Help center" })).toBeVisible();

  // Survives a refresh at its address.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Help center" })).toBeVisible({
    timeout: 30_000,
  });

  // Delete (type-to-confirm) → back to the empty page.
  await page.getByRole("button", { name: "More actions for Help center" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const del = page.getByRole("dialog", { name: "Delete Help center?" });
  await del.getByLabel("Type the domain name to confirm").fill("Help center");
  await del.getByRole("button", { name: "Delete domain" }).click();
  await expect(page).toHaveURL(/#\/domains$/);
  await expect(
    page.getByRole("heading", { name: "Give your agents your own documents" }),
  ).toBeVisible();
  await expect(nav.getByRole("button", { name: "Help center" })).toHaveCount(0);
});
