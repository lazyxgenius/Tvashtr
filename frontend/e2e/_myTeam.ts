import type { Page } from "@playwright/test";

/**
 * B-TEAMS stopped auto-seeding "My team" for new accounts (Home's first-time checklist replaced
 * it). Specs that used to open the seeded team now create the same team — the `review_loop`
 * template the seed used — and open its canvas by address. Returns the team id.
 */
export async function openMyTeam(page: Page): Promise<string> {
  const res = await page.request.post("/api/teams", {
    data: { template: "review_loop", name: "My team" },
  });
  if (!res.ok()) throw new Error(`create "My team" -> ${res.status()}`);
  const { team_graph_id } = (await res.json()) as { team_graph_id: string };
  await page.goto(`/#/teams/${team_graph_id}`);
  return team_graph_id;
}
