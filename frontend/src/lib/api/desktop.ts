/**
 * API calls only Tvashtr Desktop's screens make (desktop-app.md §5). Every answer is shape-checked
 * here, so one odd answer never blanks a launch screen.
 */
import { listRunsPage } from "./runs";

/**
 * DT-44 / OQ-7: how many of the account's runs are going on this Desktop — status group `running`
 * with `desktop_target: true` (awaiting-approval runs do no work; hosted runs aren't affected by a
 * restart). Null when the count couldn't be read.
 */
export async function countDesktopRunsGoing(): Promise<number | null> {
  try {
    const page = await listRunsPage({ status: "running", limit: 100 });
    if (!Array.isArray(page.runs)) return null;
    return page.runs.filter((r) => r?.desktop_target === true && r.status_group === "running")
      .length;
  } catch {
    return null;
  }
}
