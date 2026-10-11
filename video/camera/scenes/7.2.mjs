// 7.2 Team file: Download ("No secrets or sign-ins inside"); a second account made through the
// app's own sign-up; Import on it; the things-to-fix card. The email sign-up only shows when the
// backend is self-hosted: run with the stack started as HOSTED=0 (video/SCENES.md).
import fs from "node:fs";
import path from "node:path";
import { buildFilmTeam, must } from "../film.mjs";
import { canvasReady } from "../flows.mjs";

export default {
  id: "7.2",
  title: "Team file: Download; Import on a second account; the things-to-fix card",
  mode: "live",
  budget: 30,
  setup: async (ctx) => {
    const cfg = must(await ctx.api("GET", "/api/config"), "config");
    if (cfg.hosted_mode) throw new Error("7.2 needs the stack started with HOSTED=0 (the email sign-up)");
    const { id } = await buildFilmTeam(ctx.api, { upTo: "final" });
    const n = Date.now().toString(36).slice(-4);
    return { team: id, email: ctx.story.account.second_email.replace("@", `+${n}@`) };
  },
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}`);
    await canvasReady(ctx.page);
    // Account B finishes this Mac's first-run setup the moment it exists (as a teammate who has
    // already set up would): a camera hook on the sign-up response, not product code.
    await ctx.page.evaluate(() => {
      const f = window.fetch.bind(window);
      window.fetch = async (...a) => {
        const r = await f(...a);
        if (String(a[0]).includes("/api/auth/register") && r.ok) {
          const u = await r.clone().json();
          await window.tvashtrDesktop.setup.update(u.id, { finishedAt: new Date().toISOString() });
        }
        return r;
      };
    });
  },
  film: async (ctx) => {
    const { page, cam, out } = ctx;
    await cam.click(page.getByRole("button", { name: "Team file" }), "Team file");
    const panel = page.getByRole("complementary", { name: "Team file" });
    await panel.waitFor();
    await cam.roi("team-file", panel);
    await cam.hover(panel.getByText("No secrets or sign-ins inside"), "No secrets or sign-ins inside");
    await cam.pause(1500);
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      cam.click(panel.getByRole("button", { name: "Download" }), "Download"),
    ]);
    const file = path.join(out, dl.suggestedFilename());
    await dl.saveAs(file);
    await cam.pause(1000);
    // Log out; a second account through the app's own sign-up.
    await cam.click(page.getByRole("button", { name: "Account" }), "Account");
    await cam.click(page.getByRole("menuitem", { name: "Log out" }), "Log out");
    const form = page.getByRole("form", { name: "Sign in with email" });
    await form.waitFor({ timeout: 30000 });
    await cam.click(form.getByRole("button", { name: "Create an account" }), "Create an account");
    await cam.type(form.getByLabel("Email"), ctx.state.email, "a teammate's email");
    await cam.type(form.getByLabel("Password"), "teammate-pass-0000", "a password", { cps: 30 });
    await cam.click(form.getByRole("button", { name: "Create account" }), "Create account");
    await page.getByRole("navigation", { name: "Dashboard" }).waitFor({ timeout: 60000 });
    await cam.pause(1500);
    // Import the file as a new team.
    await cam.click(page.getByRole("button", { name: "New team", exact: true }).first(), "New team");
    const nd = page.getByRole("dialog", { name: "New team" });
    await nd.waitFor();
    await cam.hover(nd.getByRole("button", { name: /Import a team file/ }), "Import a team file");
    await page.getByTestId("import-team-input").setInputFiles(fs.realpathSync(file));
    const imp = page.getByRole("dialog", { name: "Import a team file" });
    await imp.waitFor({ timeout: 30000 });
    await cam.roi("what-we-checked", imp);
    await cam.pause(2500);
    await cam.click(imp.getByRole("button", { name: "Import as a new team" }), "Import as a new team");
    const fix = page.getByRole("region", { name: "Things to fix" });
    await fix.waitFor({ timeout: 30000 });
    await cam.roi("things-to-fix", fix);
    await cam.hover(fix, "the things to fix");
    await cam.pause(2500);
  },
};
