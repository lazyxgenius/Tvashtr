import { expect, test } from "@playwright/test";

/**
 * Live gate for the revamp's dashboard shell (no model needed): sign up, then every section at its
 * own address inside the new header + nav, refresh and back/forward keeping the place, the
 * keyboard-shortcuts dialog, log out / log in, and a team's canvas opened by address and left
 * again. Run against a live backend + Vite (see scripts/accounts_e2e.sh for the boot steps).
 */
test("the dashboard shell: addresses, nav, refresh, back, shortcuts, account, canvas", async ({
  page,
}) => {
  const email = `shell-${Date.now()}@tvashtr.dev`;
  const password = "revamp-shell-pass";
  const nav = page.getByRole("navigation", { name: "Dashboard" });

  // Sign up from the landing page → Home inside the new shell.
  await page.goto("/");
  await page.getByRole("button", { name: "Get started" }).first().click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  // The sign-up wizard's scene-setting steps (nothing is saved).
  await page.getByRole("button", { name: /^Engineer/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /^A fresh idea/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Enter Tvashtr" }).click();
  await expect(nav).toBeVisible({ timeout: 30_000 });
  await expect(nav.getByRole("button", { name: /^Home/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("status").filter({ hasText: "Connected" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Search teams, runs and actions" })).toBeVisible();

  // Domains.
  await nav.getByRole("button", { name: /^Domains/ }).click();
  await expect(page).toHaveURL(/#\/domains$/);
  await expect(nav.getByRole("button", { name: /^Domains/ })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Engines expands into its three sub-pages.
  await nav.getByRole("button", { name: /^Engines/ }).click();
  await expect(page).toHaveURL(/#\/engines/);
  await expect(nav.getByRole("button", { name: /^Overview/ })).toBeVisible();
  await nav.getByRole("button", { name: /^API keys/ }).click();
  await expect(page).toHaveURL(/#\/engines\/keys$/);
  await nav.getByRole("button", { name: /^Subscriptions/ }).click();
  await expect(page).toHaveURL(/#\/engines\/subscriptions$/);

  // Toolkit expands into Tools / Skills / Memory / Secrets, each with its own address.
  await nav.getByRole("button", { name: /^Toolkit/ }).click();
  await expect(page).toHaveURL(/#\/toolkit\/tools$/);
  for (const [label, url] of [
    ["Skills", /#\/toolkit\/skills$/],
    ["Memory", /#\/toolkit\/memory/],
    ["Secrets", /#\/toolkit\/secrets$/],
    ["Tools", /#\/toolkit\/tools$/],
  ] as const) {
    await nav.getByRole("button", { name: new RegExp(`^${label}`) }).click();
    await expect(page).toHaveURL(url);
    await expect(nav.getByRole("button", { name: new RegExp(`^${label}`) })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }

  // Refresh keeps the place; Back returns to the previous page.
  await nav.getByRole("button", { name: /^Secrets/ }).click();
  await page.reload();
  await expect(nav.getByRole("button", { name: /^Secrets/ })).toHaveAttribute(
    "aria-current",
    "page",
    { timeout: 30_000 },
  );
  await page.goBack();
  await expect(page).toHaveURL(/#\/toolkit\/tools$/);

  // Keyboard shortcuts: ? opens the dialog, Done closes it.
  await page.locator("body").click({ position: { x: 5, y: 400 } });
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Search and actions");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);

  // Home, then a new team → its canvas at #/teams/<id>.
  await nav.getByRole("button", { name: /^Home/ }).click();
  await expect(page).toHaveURL(/#\/(home)?$/);
  await page.getByRole("button", { name: "New team", exact: true }).click();
  const newTeam = page.getByRole("dialog", { name: "New team" });
  await newTeam.getByLabel("Team name").fill("Shell e2e team");
  await newTeam.getByRole("button", { name: "Create team" }).click();
  await expect(page).toHaveURL(/#\/teams\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });
  const teamUrl = page.url();

  // The canvas address survives a reload; the back arrow returns to Home in the shell.
  await page.reload();
  await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });
  expect(page.url()).toBe(teamUrl);
  await page.getByRole("button", { name: "Back to dashboard" }).click();
  await expect(nav).toBeVisible();
  await expect(page).toHaveURL(/#\/(home)?$/);
  await expect(page.getByText("Shell e2e team")).toBeVisible({ timeout: 30_000 });

  // Log out from the account menu → landing; log in again → back in the shell.
  await page.getByRole("button", { name: "Account" }).click();
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(menu).toContainText(email);
  await menu.getByRole("menuitem", { name: /Log out/ }).click();
  await expect(page.getByRole("button", { name: "Get started" }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: /Log in|Sign in/ })
    .first()
    .click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^(Log in|Sign in)$/ }).click();
  await page.getByRole("button", { name: "Enter Tvashtr" }).click();
  await expect(nav).toBeVisible({ timeout: 30_000 });
});
