// 0.1 The pull request on GitHub, opened by Tvashtr, with the Reviewer's approval — the PR page
// in Playwright's Chromium (not the app). V2 films the hero run's PR; V1 rehearses on the newest PR.
import { latestRun } from "../flows.mjs";

export default {
  id: "0.1",
  title: "The PR on GitHub, opened by Tvashtr, with the Reviewer's approval",
  mode: "web",
  githubSession: true, // trade_mcp is private: the operator's session (video/camera/github-login.mjs)
  budget: 20,
  setup: async ({ api }) => {
    const run = await latestRun(api, "completed");
    if (!run?.pr_url) throw new Error("0.1 needs a shipped run with a pull request");
    return { pr: run.pr_url };
  },
  url: (ctx) => ctx.state.pr,
  ready: async ({ page }) => page.waitForLoadState("domcontentloaded"),
  film: async (ctx) => {
    const { page, cam } = ctx;
    await cam.pause(2000);
    await cam.hover(page.locator("h1").first(), "the pull request");
    await cam.pause(1500);
    await cam.scroll(700, "the description and the review");
    await cam.pause(2500);
    await cam.scroll(700);
    await cam.pause(2500);
  },
};
