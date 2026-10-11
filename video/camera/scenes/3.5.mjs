// 3.5 Retrying, then the backup-model switch (SAMPLE). The hero run at the Engineer's round 2: the
// model is busy (1 of 3, then 2 of 3), the pinned callout offers the backup, the person switches
// now, and the Engineer carries on on deepseek/deepseek-chat (the run gains a ⚠ "you switched" note;
// its DeepSeek spend lands when the round ends, after the clip). Sample, not live: a Desktop
// subscription job never emits retry or backup events (video/fixtures/retrying.mjs, video/SCENES.md).
import { TEAM_ID } from "../../fixtures/base.mjs";
import { RUN_ID } from "../../fixtures/retrying.mjs";
import { activity, card, nowBar } from "../flows.mjs";

const line = (page, text) => activity(page).locator("li.lv-line", { hasText: text });

export default {
  id: "3.5",
  title: "Retrying, then the backup-model switch",
  mode: "sample",
  fixtures: "retrying",
  budget: 15,
  poster: 7.5, // retry 2 of 3 and the callout with its switch button
  start: `#/teams/${TEAM_ID}/runs/${RUN_ID}`,
  // Home first in a real take (the Dashboard nav), the run view straight away in --preview.
  ready: async ({ page }) =>
    page
      .getByRole("navigation", { name: "Dashboard" })
      .or(page.getByRole("region", { name: "Activity" }))
      .first()
      .waitFor({ timeout: 60000 }),
  before: async ({ page }) => {
    await activity(page).getByRole("button", { name: "Switch to the backup model now" }).waitFor({ timeout: 30000 });
    // Off camera: the canvas's own fit-view control, so the graph sits the same in every take
    // (TeamCanvas's FitView can fire before the Activity panel has its height).
    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(600);
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
    ctx.retrying.begin(); // the sample's clock starts with the clip: retry 2 of 3 lands 3 s in
    const pin = activity(page).locator(".lv-pin__box");
    await cam.roi("now", nowBar(page));
    await cam.roi("activity", activity(page));
    await cam.roi("pinned", pin);
    await cam.roi("engineer-card", card(page, "Engineer"));
    await cam.pause(900);
    await cam.hover(line(page, "1 of 3").locator(".lv-line__what"), "Model busy · 1 of 3");
    await line(page, "2 of 3").waitFor({ timeout: 15000 });
    await cam.hover(line(page, "2 of 3").locator(".lv-line__what"), "Model busy · 2 of 3");
    await cam.pause(900);
    await cam.hover(pin.locator(".lv-pin__title"), "The Engineer’s model is busy");
    await cam.pause(1100);
    await cam.click(activity(page).getByRole("button", { name: "Switch to the backup model now" }), "Switch to the backup model now");
    const backup = line(page, "Switched to the backup model");
    await backup.waitFor({ timeout: 15000 });
    await cam.roi("backup", backup);
    const warning = page.getByRole("status", { name: "Resolution warnings" });
    await warning.waitFor({ timeout: 15000 });
    await cam.roi("warning", warning);
    await cam.pause(1400);
    await line(page, "Running python -m pytest").waitFor({ timeout: 15000 });
    await cam.hover(nowBar(page).getByRole("button", { name: /^Engineer/ }), "the Engineer working again");
    await cam.pause(1600);
  },
};
