// The fixtures' live base (F2: "sample data must agree with the live footage"): a no-spend record
// take that walks every screen the SAMPLE scenes show, on the real film team, so each fixture
// starts from what the app really answers. Then `node video/fixtures/export-live.mjs`.
//   node video/camera/take.mjs video/fixtures/capture-live.mjs
import { buildFilmTeam, ensureDomain, ensureToolkit, keepOnlyKey } from "../camera/film.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  id: "0.0",
  title: "Capture the live base for the fixtures",
  mode: "record",
  record: "live-base",
  setup: async ({ api, story }) => {
    await keepOnlyKey(api);
    await ensureToolkit(api);
    await ensureDomain(api);
    const { id, g } = await buildFilmTeam(api, { name: story.team.name, upTo: "final" });
    return { team: id, nodes: Object.fromEntries(g.nodes.map((n) => [n.config?.title ?? n.role_name, n.id])) };
  },
  film: async ({ page, go, state, cam }) => {
    const nav = page.getByRole("navigation", { name: "Dashboard" });
    const visit = async (hash, ms = 2500) => {
      await go(hash);
      await sleep(ms);
    };
    for (const h of [
      "#/home",
      "#/engines",
      "#/engines/subscriptions",
      "#/engines/keys",
      "#/toolkit/connectors/browse",
      "#/toolkit/connectors",
      "#/toolkit/tools",
      "#/toolkit/tools/browse",
      "#/toolkit/skills",
      "#/toolkit/agents",
      "#/toolkit/memory",
      "#/toolkit/secrets",
      "#/domains",
    ])
      await visit(h);
    await nav.getByRole("button", { name: /^Domains/ }).click();
    await sleep(1500);
    const team = state.team;
    await visit(`#/teams/${team}`, 4000);
    for (const role of ["Product manager", "Engineer", "Reviewer", "Fixer"]) {
      const nid = state.nodes[role];
      for (const tab of ["setup", "skills", "memory", "runs", "tests", "docs"])
        await visit(`#/teams/${team}?node=${nid}&tab=${tab}`, 1500);
    }
    await visit(`#/teams/${team}`, 1500);
    await page.getByRole("button", { name: "Version history" }).click().catch(() => {});
    await sleep(2000);
    await visit(`#/teams/${team}/compare`, 3000);
    await visit(`#/teams/${team}/compare?tab=sets`, 2000);
    await visit(`#/teams/${team}/compare?tab=versions`, 2000);
    // Home's composer: the team, the repo picker, the branch and the folder.
    await visit("#/home", 2500);
    await page.keyboard.press("Meta+k");
    await sleep(1500);
    await page.keyboard.press("Escape");
    const composer = page.locator("section[aria-label='Start a run']");
    if (await composer.count()) {
      await composer.locator(".hm-picker--repo").click();
      await sleep(3000);
      await page.keyboard.press("Escape");
    }
    await cam.pause(500);
  },
};
