// 8.1 Home: Running now, Recent runs, spend and budget, ⌘K; a run on a local folder; the same Home
// on the website. Sample data (video/fixtures/home.mjs): weeks of history can't be filmed live.

const homeIn = async ({ page, story }) => {
  await page.getByRole("article", { name: `${story.team.name}: ${story.runs.next}` }).waitFor({ timeout: 30000 });
  await page.getByRole("region", { name: "Recent runs" }).locator(".hm-recent__row").first().waitFor();
  await page.getByRole("region", { name: "Spend" }).locator(".hm-spend__total").waitFor();
};

const film = async ({ page, cam, story }) => {
  const running = page.getByRole("region", { name: "Running now" });
  const recent = page.getByRole("region", { name: "Recent runs" });
  const spend = page.getByRole("region", { name: "Spend" });
  const card = running.getByRole("article", { name: `${story.team.name}: ${story.runs.next}` });
  const row = (idea) => recent.locator(".hm-recent__row", { has: page.getByRole("button", { name: idea, exact: true }) });

  await cam.pause(1400, "Home");
  await cam.roi("running-now", running);
  await cam.hover(card.locator(".hm-run__live"), "the DEMA run's live line");
  await cam.pause(1400);
  await cam.hover(card.getByRole("meter", { name: "Budget used" }), "the budget meter (Desktop: on keys)");
  await cam.pause(1400);

  await cam.roi("recent-runs", recent);
  await cam.hover(row("Add a TEMA indicator").locator(".hm-recent__status"), "the local-folder run's branch");
  await cam.pause(1400);
  await cam.click(recent.getByRole("link", { name: "Show more" }), "Show more");
  await row(story.runs.hero).waitFor();
  await cam.pause(700);
  await cam.scroll(600, "down to the older runs and Spend");
  await cam.pause(500);
  await cam.hover(row(story.runs.hero).getByRole("link", { name: /^PR #/ }), "the hero run's PR");
  await cam.pause(1600);

  await cam.roi("spend", spend);
  await cam.hover(spend.locator(".hm-spend__note"), "Spend: key spend only");
  await cam.pause(1800);

  await cam.press("Meta+k", "⌘K");
  const palette = page.getByRole("dialog", { name: "Search and actions" });
  const search = palette.getByRole("combobox", { name: "Search teams, runs and actions" });
  await search.waitFor();
  await cam.pause(700);
  await cam.type(search, "hull", "search runs", { click: false, cps: 8 });
  await palette.getByRole("group", { name: "Runs" }).getByRole("option", { name: new RegExp(story.runs.hero) }).waitFor();
  await cam.roi("palette", palette);
  await cam.pause(1800, "the Runs group");
  await cam.press("Escape", "close ⌘K");
  await cam.pause(900);
};

export default {
  id: "8.1",
  title: "Home: Running now, Recent runs, spend and budget, ⌘K; a run on a local folder",
  mode: "sample",
  fixtures: "home",
  budget: 25,
  start: "#/home",
  before: homeIn,
  film,
  parts: [
    {
      key: "web",
      title: "The same Home on the website",
      mode: "web",
      fixtures: "home",
    },
  ],
};
