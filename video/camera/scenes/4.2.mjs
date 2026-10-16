// 4.2 Needs you → Resume from here; the confirm (kept / runs again / skipped); Carried over; it
// ships. V2b (K3): opens on Home's Needs you, on 4.1's failed run (run #2), and resumes it as run #3;
// --dry stops before "Resume run".
import { filmTeam, must, story, teams } from "../film.mjs";
import { answerNotifyAsk, approveWaiting, composeAndLaunch, nowBar, smoke, summary, toTheEnd } from "../flows.mjs";

export default {
  id: "4.2",
  title: "Needs you → Resume from here → the confirm → Carried over → it ships",
  mode: "live",
  castEvery: 2,
  budget: 25,
  // 4.1's failed run as Home's Needs you lists it, with a Resume whose suggested step skips work.
  setup: async ({ api }) => {
    const team = await filmTeam(api);
    for (const it of (await api("GET", "/api/inbox?surface=desktop")).json?.items ?? []) {
      if (it.kind !== "run_failed" || !it.resume) continue;
      const res = (await api("GET", `/api/runs/${it.run.id}/resume?desktop_target=1`)).json;
      const at = res?.available && res.points.find((p) => p.state === "suggested");
      if (at?.confirm?.skips_s > 0) return { team, run: it.run.id, idea: it.run.idea, number: res.number };
    }
    return { team, run: null };
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
    if (!ctx.state.run) {
      if (!ctx.dry) smoke(ctx, "4.2 opens from Needs you", false, null, "Needs you lists no failed run whose Resume skips work");
      return ctx.advance("Resume (needs 4.1's failed run in Needs you)", async () => {});
    }
    const needs = page.locator("section[aria-label='Needs you']");
    await needs.waitFor({ timeout: 30000 });
    await cam.roi("needs-you", needs);
    const row = needs
      .locator("li.hm-inbox__item")
      .filter({ has: page.locator(".hm-inbox__title", { hasText: /^Run failed$/ }) })
      .filter({ hasText: ctx.state.idea });
    await row.waitFor({ timeout: 30000 });
    await cam.hover(row, "Run failed");
    await cam.pause(2500);
    smoke(ctx, "4.2 opens from Needs you", true, await ctx.shot("needs-you"), (await row.innerText()).replace(/\s+/g, " ").trim());
    await cam.click(row.getByRole("button", { name: "Resume", exact: true }), "Resume");
    const pick = page.getByRole("complementary", { name: /^Resume run #\d+$/ });
    await pick.waitFor({ timeout: 30000 });
    await cam.roi("resume", pick);
    await cam.pause(1500);
    const pickerShot = await ctx.shot("picker");
    // The suggested step (the one that failed): everything above it is kept and skipped.
    const suggested = pick.getByRole("listitem").filter({ hasText: "Suggested" });
    await cam.click(suggested.getByRole("button", { name: /Resume from here/ }), "Resume from here");
    const confirm = page.getByRole("dialog", { name: /^Resume from / });
    await confirm.waitFor();
    await cam.roi("confirm", confirm);
    await cam.pause(3000);
    // The live smoke (H2): the confirm's words and no dollar per step in the picker.
    const confirmShot = await ctx.shot("confirm");
    const said = (await confirm.innerText()).replace(/\s+/g, " ").trim();
    smoke(
      ctx,
      "4.2 H2 (the confirm)",
      /Skips \d+ min of finished work\./.test(said) && /Only the steps that run again use your (Claude|Grok|Claude and Grok) subscriptions?\./.test(said),
      confirmShot,
      said,
    );
    smoke(ctx, "4.2 H2 (no dollar per step)", !/\$\d/.test(await pick.innerText()), pickerShot);
    ctx.note(`K3: ${said.match(/This starts run #\d+\. It picks up where run #\d+ stopped\./)?.[0] ?? "no run numbers in the confirm"}`);
    await ctx.spend("run", "Resume run", () => cam.click(confirm.getByRole("button", { name: "Resume run" }), "Resume run"));
    await nowBar(page).getByText("Carried over").first().waitFor({ timeout: 60000 });
    await cam.pause(2500);
    await toTheEnd(ctx, "the resumed run");
    await cam.roi("summary", summary(page));
    await cam.pause(3000);
  },
  parts: [
    {
      // V2b second sitting: the P6 smoke (an evidence take, not for the film). The resume confirm of a
      // run on the earlier hero team (Engineer on Claude, Tests pass, Reviewer on Grok), stopped while
      // its Engineer works — no Grok job runs (brief: none in Part B); the confirm is cancelled.
      key: "p6",
      title: "Evidence: P6 the resume confirm — a check, every plan that runs again (not for the film)",
      mode: "live",
      setup: async ({ api }) => {
        const t = (await teams(api)).find((x) => x.name === `${story.team.name} (earlier)`);
        if (!t) throw new Error(`no team "${story.team.name} (earlier)" (the hero team)`);
        return { team: t.team_graph_id, task: "Add an Ultimate oscillator indicator" };
      },
      before: (ctx) => ctx.go(`#/teams/${ctx.state.team}`, ctx.page.getByRole("button", { name: "Run this team", exact: true })),
      film: async (ctx) => {
        const { page, cam, api } = ctx;
        const run = await composeAndLaunch(ctx, { task: ctx.state.task, repo: story.repo.full_name, folder: story.repo.folder, branch: story.repo.branch });
        await answerNotifyAsk(ctx, "Not now", { wait: 8000 });
        // Off camera: approve the spec, then stop the run (the app's own Stop) once the Engineer works.
        await ctx.offCamera("the PM, the spec, the Engineer starting", async () => {
          for (let i = 0; i < 600; i += 1) {
            await approveWaiting(ctx);
            const lines = (await api("GET", `/api/runs/${run}/activity?desktop_target=1`)).json?.lines ?? [];
            if (lines.some((l) => l.label === "Engineer" && ["edited", "read", "searched", "started"].includes(l.kind))) break;
            await new Promise((r) => setTimeout(r, 3000));
          }
          must(await api("POST", `/api/runs/${run}/cancel`), "stop the run");
        });
        await ctx.go(`#/teams/${ctx.state.team}/runs/${run}`);
        const resume = page.getByRole("button", { name: /^Resume from / }).first();
        await resume.waitFor({ timeout: 60000 });
        await cam.click(resume, "Resume from …");
        const pick = page.getByRole("complementary", { name: /^Resume run #\d+$/ });
        await pick.waitFor({ timeout: 30000 });
        const step = pick.getByRole("listitem").filter({ hasText: "Engineer" }).filter({ has: page.getByRole("button", { name: /Resume from here/ }) }).first();
        await cam.click(step.getByRole("button", { name: /Resume from here/ }), "Resume from here (Engineer)");
        const confirm = page.getByRole("dialog", { name: /^Resume from / });
        await confirm.waitFor({ timeout: 30000 });
        await cam.roi("confirm", confirm);
        await cam.pause(2500);
        const said = (await confirm.innerText()).replace(/\s+/g, " ").trim();
        smoke(ctx, "P6 (the resume confirm: a check reads “Tests pass — Tvashtr runs the tests”, every plan that runs again)",
          said.includes("Tests pass — Tvashtr runs the tests") && !/when you approve/.test(said) && said.includes("Only the steps that run again use your Claude and Grok subscriptions."),
          await ctx.shot("p6-confirm"), said.slice(0, 600));
        await cam.click(confirm.getByRole("button", { name: "Cancel", exact: true }), "Cancel");
      },
    },
  ],
};
