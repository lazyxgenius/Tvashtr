import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Round 1 of the revamp removed the canvas's LaunchPanel: the canvas's "Run this team" now opens
 * Home's "Start a run" composer with that team picked (spec §4.6, Q18), Launch stays on Home, and
 * a toast offers "Open run". These helpers drive that one launch surface the way a user does.
 */

/**
 * The backend's pinned skeleton idea (`DEFAULT_IDEA` in backend/tvashtr/routers.py). The old launch
 * panel let a run start with an empty feature request, which fell back to this text; the composer
 * requires an idea, so specs that relied on the fallback type the same words.
 */
export const SKELETON_IDEA =
  "Add a file named greeting.txt at the repository root, containing exactly this single line " +
  "and nothing else:\nShipped by the Tvashtr PM->Engineer team";

/** Home's "Start a run" card. */
export function composer(page: Page): Locator {
  return page.locator("section[aria-label='Start a run']");
}

/** The composer's idea box ("What should the team build?"). */
export function ideaBox(page: Page): Locator {
  return composer(page).getByRole("textbox", { name: "What should the team build?" });
}

/**
 * From a team's canvas: click "Run this team" and wait until Home's composer is showing with that
 * team picked (the team picker's button carries the team's name).
 */
export async function openComposerFromCanvas(page: Page, teamName?: string): Promise<Locator> {
  await page.getByRole("button", { name: "Run this team", exact: true }).click();
  const card = composer(page);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/#\/(home)?$/);
  if (teamName) {
    await expect(card.locator(".hm-picker--team")).toContainText(teamName, { timeout: 30_000 });
  }
  return card;
}

export interface LaunchResult {
  runId: string;
  /** The POST /api/runs body the composer sent. */
  body: Record<string, unknown>;
}

/**
 * Type the idea and click Launch; returns the new run id and the launch body. With `openRun`, it
 * then clicks the "Run started on …" toast's "Open run" and waits for the run's canvas address.
 */
export async function launchFromComposer(
  page: Page,
  opts: { idea?: string; openRun?: boolean } = {},
): Promise<LaunchResult> {
  const card = composer(page);
  await ideaBox(page).fill(opts.idea ?? SKELETON_IDEA);
  const posted = page.waitForResponse(
    (r) => r.url().endsWith("/api/runs") && r.request().method() === "POST",
    { timeout: 120_000 },
  );
  await card.getByRole("button", { name: "Launch", exact: true }).click();
  const res = await posted;
  const body = (res.request().postDataJSON() ?? {}) as Record<string, unknown>;
  expect(res.ok(), `POST /api/runs -> ${res.status()} ${await res.text()}`).toBeTruthy();
  const { run_id: runId } = (await res.json()) as { run_id: string };
  expect(runId, "the launch returns a run_id").toBeTruthy();
  const toast = page.getByRole("status").filter({ hasText: "Run started on" });
  await expect(toast).toBeVisible({ timeout: 30_000 });
  if (opts.openRun ?? true) {
    await toast.getByRole("button", { name: "Open run" }).click();
    await expect(page).toHaveURL(new RegExp(`#/teams/[^/]+/runs/${runId}$`), { timeout: 30_000 });
  }
  return { runId, body };
}

/** Canvas "Run this team" → composer → Launch → (by default) the run's canvas. */
export async function runFromCanvas(
  page: Page,
  opts: { idea?: string; openRun?: boolean; teamName?: string } = {},
): Promise<LaunchResult> {
  await openComposerFromCanvas(page, opts.teamName);
  return launchFromComposer(page, opts);
}
