import { expect, test } from "@playwright/test";
import { openMyTeam } from "./_myTeam";

// R18 (MA): the team drawer shows all six tabs at once in the real 384px drawer, labels wrapping
// as the Quality boards draw the row (`tabsT`) — none clipped, the row not scrolling sideways, and
// the kept inventory (Setup · Skills & tools · Memory · Runs · Tests · Docs, in order) unchanged.
// No run and no model call: a fresh account, the review_loop team, its Reviewer's drawer.

test("the agent drawer shows all six tabs inside the 384px drawer", async ({ page }) => {
  const reg = await page.request.post("/api/auth/register", {
    data: { email: `tabs+${Date.now()}@tvashtr.local`, password: "drawer-tabs-pass" },
  });
  expect(reg.ok(), "register a fresh account").toBeTruthy();
  const team = await openMyTeam(page);
  const res = await page.request.get(`/api/teams/${team}/graph`);
  expect(res.ok(), "read the team's graph").toBeTruthy();
  const graph = (await res.json()) as { nodes: { id: string; role_name: string }[] };
  const rev = graph.nodes.find((n) => n.role_name === "reviewer")!.id;

  for (const tab of ["tests", "setup", "docs"]) {
    await page.goto(`/#/teams/${team}?node=${rev}&tab=${tab}`);
    const drawer = page.getByRole("complementary", { name: "Reviewer settings" });
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    const row = drawer.getByRole("tablist", { name: "Agent" });
    const tabs = row.getByRole("tab");
    await expect(tabs).toHaveText([
      /^Setup/,
      /^Skills & tools/,
      /^Memory/,
      /^Runs/,
      /^Tests/,
      /^Docs/,
    ]);
    await expect(row.getByRole("tab", { selected: true })).toHaveText(
      new RegExp(`^${tab[0].toUpperCase()}${tab.slice(1)}`),
    );

    const box = (await drawer.boundingBox())!;
    expect(Math.round(box.width), "the drawer is 384px").toBe(384);
    for (let i = 0; i < 6; i++) {
      const t = (await tabs.nth(i).boundingBox())!;
      const name = await tabs.nth(i).textContent();
      expect(t.x, `${name} starts inside the drawer`).toBeGreaterThanOrEqual(box.x);
      expect(t.x + t.width, `${name} ends inside the drawer`).toBeLessThanOrEqual(
        box.x + box.width,
      );
      expect(t.width, `${name} has room`).toBeGreaterThan(0);
    }
    const fit = await row.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(fit.scroll, "the row isn't clipped or scrolled sideways").toBeLessThanOrEqual(
      fit.client,
    );
  }
});
