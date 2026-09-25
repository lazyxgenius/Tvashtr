import { expect, type Page } from "@playwright/test";

/**
 * Helpers for the revamped shell (round 1): Home at `#/`, a team's canvas at `#/teams/<id>`, and
 * the header's search-and-actions palette (⌘K) that reaches any team from any page.
 */

/** The signed-in shell's section nav. */
export function shellNav(page: Page) {
  return page.getByRole("navigation", { name: "Dashboard" });
}

/**
 * Register a fresh account through the API (the cookie lands on `page.request`, which the page
 * shares) and open the app signed in. Returns the email.
 */
export async function registerFresh(page: Page, prefix: string): Promise<string> {
  const email = `${prefix}+${Date.now()}@tvashtr.local`;
  const reg = await page.request.post("/api/auth/register", {
    data: { email, password: "e2e-password-123" },
  });
  expect(reg.ok(), `register ${email} -> ${reg.status()}`).toBeTruthy();
  await page.goto("/");
  await expect(shellNav(page)).toBeVisible({ timeout: 30_000 });
  return email;
}

/**
 * Open a team's canvas the way a user reaches it from anywhere in the shell: the header's
 * "Search teams, runs and actions" palette, type the name, pick the team.
 */
export async function openTeamViaPalette(page: Page, teamName: string): Promise<void> {
  await page.getByRole("button", { name: "Search teams, runs and actions" }).click();
  const palette = page.getByRole("dialog", { name: "Search and actions" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox", { name: "Search teams, runs and actions" }).fill(teamName);
  await palette
    .getByRole("group", { name: "Teams" })
    .getByRole("option", { name: new RegExp(teamName) })
    .click();
  await expect(page).toHaveURL(/#\/teams\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });
}
