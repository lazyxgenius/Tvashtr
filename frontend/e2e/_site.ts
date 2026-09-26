import { type Page, expect } from "@playwright/test";

// The public website's selector contract (website.md), shared by the specs that sign in through
// the UI. Every e2e run is self-hosted, so sign-in is the email/password form (WEB-28).

/** The landing's sign-up call to action ("Start building…"; a button today, a link on the redesign). */
export const startBuilding = (page: Page) =>
  page
    .getByRole("link", { name: /^Start building/ })
    .or(page.getByRole("button", { name: /^Start building/ }))
    .first();

/** The landing header's "Sign in". */
export const siteSignIn = (page: Page) =>
  page
    .getByRole("link", { name: "Sign in", exact: true })
    .or(page.getByRole("button", { name: "Sign in", exact: true }))
    .first();

/**
 * On `#/signin`: email + password, "Create an account" first to sign up. There are no further
 * steps: `#/signin/done` goes on to Home (or `next`) by itself.
 */
export async function passwordSignIn(page: Page, email: string, password: string, create = false) {
  await expect(page.getByRole("heading", { name: "Sign in to Tvashtr" })).toBeVisible({
    timeout: 30_000,
  });
  if (create) await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page
    .getByRole("button", { name: create ? "Create account" : "Sign in", exact: true })
    .click();
}
