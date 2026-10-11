// 6.2 Edit the Reviewer → "2 changes since v7" → Save as v8 → save and run the tests → results in
// History → What changed.
// The base take (SAMPLE, brief F10 "the history part of 6.2"): the canvas at v8 → History (v8..v1,
// the test pills) → What changed in v8 → Close. Fixtures: video/fixtures/history.mjs.
// The "save" part (RUN, filmed in V2): the same team made live at v7 (chapter 2's agent edits saved
// step by step, the Reviewer's 4 tests uploaded), the Reviewer edited on camera (one instructions line + a backup
// model), Save as v8 → "Save and run tests" (a spend: --dry stops there) → History → What changed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TEAM_ID } from "../../fixtures/base.mjs";
import { LINE, NOTE, SAVES, TESTS } from "../../fixtures/history.mjs";
import { buildFilmTeam, byRole, byTitle, graph, must, PM_LINE } from "../film.mjs";
import { canvasReady, card, closeDrawer, openAgent, saveDrawer } from "../flows.mjs";

const CSV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/files/history-reviewer-tests.csv");

/** History → the pills → all versions → What changed in v8 → Close (both takes end this way). */
async function history(ctx, { tests }) {
  const { page, cam } = ctx;
  await cam.click(page.getByRole("button", { name: "Version history" }), "Version history");
  const panel = page.getByRole("complementary", { name: "History" });
  const v8 = panel.getByRole("listitem").filter({ hasText: "v8" }).first();
  const pill = v8.locator(".cv-tpill");
  await pill.waitFor({ timeout: tests });
  await cam.roi("history", panel);
  await cam.pause(1300);
  await cam.hover(pill, "v8's tests");
  await cam.pause(1000);
  const v7pill = panel.getByRole("listitem").filter({ hasText: "v7" }).first().locator(".cv-tpill");
  if (await v7pill.count()) {
    await cam.hover(v7pill, "v7's tests");
    await cam.pause(900);
  }
  const older = panel.getByRole("button", { name: /^Show \d+ older versions?$/ });
  if (await older.count()) {
    await cam.click(older, "Show the older versions", { park: false });
    await cam.pause(500);
    await cam.scroll(450, "down to v1");
    await cam.pause(1300);
    await cam.scroll(-450, "back up to v8");
  }
  await cam.click(v8.getByRole("button", { name: "What changed in v8" }), "What changed in v8");
  const dialog = page.getByRole("dialog", { name: "What changed in v8" });
  await dialog.getByText(/^Compared with v7/).waitFor({ timeout: 30000 });
  await cam.roi("what-changed", dialog);
  await cam.pause(900);
  await cam.hover(dialog.getByRole("region", { name: "Reviewer › Instructions" }), "the instructions diff");
  await cam.pause(1600);
  await cam.hover(dialog.getByRole("region", { name: "Reviewer › Backup model" }), "the backup model");
  await cam.pause(1200);
  await cam.click(dialog.getByRole("button", { name: "Close", exact: true }).last(), "Close");
  await cam.pause(1000);
}

/**
 * The film team at v7 with the Reviewer's tests, through the app's API: built final (film.mjs),
 * then chapter 2's agent edits taken back out and saved again one by one, so History reads as
 * chapter 2 did (history.mjs SAVES: the base take shows the same rows). No spend.
 */
async function teamAtV7(ctx) {
  const { api, story } = ctx;
  const { id } = await buildFilmTeam(api, { name: story.team.name, upTo: "final" });
  const T = `/api/teams/${id}`;
  const g = await graph(api, id);
  const pm = byRole(g, "pm");
  const eng = byRole(g, "engineer");
  const rev = byRole(g, "reviewer");
  const fixer = byTitle(g, story.agents.fixer.title);
  // An agent node's PATCH carries its prompt and model; `pm`, `eng`, `rev` hold the final values.
  const patch = async (n, body = {}) =>
    must(await api("PATCH", `${T}/nodes/${n.id}`, { prompt: n.prompt, model: n.model, ...body }), `patch ${n.role_name}`);
  const save = async (n) => {
    const v = must(await api("POST", `${T}/versions`, {}), `save v${n}`);
    if (v.number !== n || v.summary !== SAVES[n - 1])
      throw new Error(`v${v.number} reads "${v.summary}", the base take shows v${n} "${SAVES[n - 1]}"`);
  };

  // Before the first versions read (it makes v1): the team as 2.1 left it, plus what chapter 2
  // added as nodes (the domain step, the gates).
  await patch(pm, { prompt: pm.prompt.replace(`\n\n${PM_LINE}`, "") });
  await patch(eng, {
    tool_config: null,
    skills: (eng.skills ?? []).filter((s) => s.type !== "library"),
    fallback_model: null,
    memory_remember_enabled: false,
  });
  await patch(rev, { model: story.agents.reviewer.model_before });
  must(await api("DELETE", `${T}/nodes/${fixer.id}`), "take the Fixer out");
  const v1 = must(await api("GET", `${T}/versions`), "v1");
  if (v1.current !== 1 || v1.versions[0].summary !== SAVES[0]) throw new Error(`v1: ${JSON.stringify(v1).slice(0, 200)}`);

  await patch(pm); // 2.2 the PM's instructions
  await save(2);
  await patch(eng, { tool_config: eng.tool_config, skills: eng.skills }); // 2.4
  await save(3);
  await patch(eng, { fallback_model: eng.config.fallback_model }); // 2.5
  await save(4);
  await patch(rev); // 2.5 the Reviewer on Grok
  await save(5);
  await patch(eng, { memory_remember_enabled: true }); // 2.6
  await save(6);
  const back = must(
    await api("POST", `${T}/nodes`, {
      node_kind: "worker",
      title: fixer.config.title,
      prompt: fixer.prompt,
      model: fixer.model,
      position: fixer.position,
    }),
    "the Fixer",
  );
  must(await api("POST", `${T}/edges`, { source_node_id: eng.id, target_node_id: back.id, role: "failure" }), "failure path");
  must(await api("POST", `${T}/edges`, { source_node_id: back.id, target_node_id: rev.id, role: "forward" }), "Fixer → Reviewer");
  await save(7);

  // The Reviewer's tests: 6.1's 4 (its CSV's rows + a row standing in for its test from a round).
  const mapping = { "what the reviewer gets": "gets", "must say": "must_say", file: "must_name_file" };
  const file = { filename: "reviewer-tests.csv", content: fs.readFileSync(CSV, "utf8"), mapping };
  const added = must(await api("POST", `${T}/nodes/${rev.id}/tests/file`, file), "upload the tests").added;
  if (added !== TESTS) throw new Error(`${added} tests uploaded, the base take shows ${TESTS}`);
  return { team: id, reviewer: rev.id };
}

export default {
  id: "6.2",
  title: "History: v8 and its test results; What changed in v8",
  mode: "sample",
  fixtures: "history",
  budget: 25,
  start: `#/teams/${TEAM_ID}`,
  // Home in a real take (it opens on #/home, then goes to `start`); the canvas in --preview (it
  // opens on `start`, which has no Dashboard nav).
  ready: ({ page }) =>
    page
      .getByRole("navigation", { name: "Dashboard" })
      .or(page.locator(".react-flow__node"))
      .first()
      .waitFor({ timeout: 60000 }),
  before: async (ctx) => {
    await canvasReady(ctx.page);
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
    const chip = page.getByRole("button", { name: "Version history" });
    await cam.roi("chip", chip);
    await cam.hover(chip, "v8 · saved");
    await cam.pause(1000);
    await history(ctx, { tests: 30000 });
  },
  parts: [
    {
      key: "save",
      title: "Edit the Reviewer; 2 changes since v7; Save as v8; save and run the tests; History",
      mode: "run",
      fixtures: undefined,
      budget: 40,
      start: undefined,
      ready: undefined,
      setup: teamAtV7,
      before: async (ctx) => {
        await ctx.go(`#/teams/${ctx.state.team}`);
        await canvasReady(ctx.page);
      },
      film: async (ctx) => {
        const { page, cam, story } = ctx;
        const chip = page.getByRole("button", { name: "Version history" });
        await chip.filter({ hasText: "v7" }).waitFor({ timeout: 30000 });
        await cam.roi("chip", chip);
        await cam.hover(chip, "v7 · saved");
        await cam.pause(1000);
        const d = await openAgent(ctx, "Reviewer");
        // One line at the end of the instructions.
        const more = d.getByRole("button", { name: /^Show all \d+ lines$/ });
        if (await more.count()) await cam.click(more, "Show all lines");
        const text = d.getByRole("textbox", { name: /^Instructions/ });
        await cam.click(text, "the instructions", { park: false });
        await text.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
        await cam.type(text, `\n${LINE}`, "one line", { click: false });
        await cam.pause(800);
        // A backup model (Advanced), as 2.5 gave the Engineer.
        await cam.click(d.getByRole("button", { name: /^Advanced/ }), "Advanced");
        await cam.click(d.getByRole("button", { name: /^Backup model/ }).first(), "Backup model");
        const bk = page.getByRole("dialog", { name: "Choose a backup model" });
        await bk.waitFor();
        await cam.click(bk.getByRole("group", { name: /^deepseek\b/ }).getByRole("option").first(), story.backup_model);
        await cam.pause(600);
        await saveDrawer(ctx, d);
        await closeDrawer(ctx);
        await chip.filter({ hasText: "2 changes since v7" }).waitFor({ timeout: 15000 });
        await cam.hover(chip, "2 changes since v7");
        await cam.pause(1500);
        await cam.click(page.getByRole("button", { name: "Save as v8" }), "Save as v8");
        const dialog = page.getByRole("dialog", { name: "Save as v8" });
        await dialog.waitFor({ timeout: 15000 });
        await cam.roi("save-as-v8", dialog);
        await cam.type(dialog.getByLabel("What changed (optional)"), NOTE, "the note");
        await cam.hover(
          dialog.getByRole("radio", { name: new RegExp(`^Save and run the Reviewer’s ${TESTS} tests`) }),
          "Save and run the Reviewer's tests",
        );
        await cam.pause(1500);
        await ctx.spend("save_with_tests", "Save and run tests", () =>
          cam.click(dialog.getByRole("button", { name: "Save and run tests" }), "Save and run tests"),
        );
        await chip.filter({ hasText: "v8" }).waitFor({ timeout: 30000 });
        // The Reviewer's card counts the tests as they run on the Grok subscription.
        const rev = card(page, "Reviewer");
        await rev.locator(".rf-node__tests--live").waitFor({ timeout: 60000 }).catch(() => {});
        await cam.roi("testing", rev);
        await cam.hover(rev, "the Reviewer testing");
        await cam.pause(2500);
        await rev.locator(".rf-node__tests", { hasText: /^\d+ of \d+ tests$/ }).waitFor({ timeout: 30 * 60000 });
        await cam.pause(1500);
        await history(ctx, { tests: 60000 });
      },
    },
  ],
};
