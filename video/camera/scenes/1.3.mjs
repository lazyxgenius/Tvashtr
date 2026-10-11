// 1.3 Toolkit: a web-fetch tool, a secret by name, a skill imported from GitHub. The secret's value
// typed on camera is a placeholder, deleted after the take (brief rule 5).
import { clearToolkit, must, SKILL } from "../film.mjs";

export default {
  id: "1.3",
  title: "Toolkit: a web-fetch tool, a secret by name, a skill from GitHub",
  mode: "live",
  budget: 20,
  setup: async ({ api }) => clearToolkit(api),
  after: async ({ api, story }) => {
    must(await api("DELETE", `/api/secrets/${story.toolkit.secret}`), "delete the placeholder secret");
  },
  film: async (ctx) => {
    const { page, cam, story } = ctx;
    const nav = page.getByRole("navigation", { name: "Dashboard" });
    await cam.click(nav.getByRole("button", { name: /^Toolkit/ }), "Toolkit");
    await cam.click(nav.getByRole("button", { name: /^Tools/ }), "Tools");
    await cam.click(page.getByRole("tab", { name: "Browse" }), "Browse");
    const fetchCard = page.getByRole("article", { name: "Web fetch" });
    await fetchCard.waitFor();
    await cam.roi("web-fetch", fetchCard);
    await cam.click(fetchCard.getByRole("button", { name: "Add" }), "Add Web fetch");
    await page.getByText("Web fetch added.").first().waitFor({ timeout: 15000 }).catch(() => {});
    await cam.pause(1200);
    // A secret, by name.
    await cam.click(nav.getByRole("button", { name: /^Secrets/ }), "Secrets");
    await cam.click(page.getByRole("button", { name: "Add secret" }).first(), "Add secret");
    const sd = page.getByRole("dialog", { name: "Add a secret" });
    await sd.waitFor();
    await cam.type(sd.getByLabel("Name"), story.toolkit.secret, "the secret's name");
    await cam.type(sd.getByLabel("Value"), "placeholder-value-0000", "a placeholder value", { cps: 30 });
    await cam.click(sd.getByRole("button", { name: "Save secret" }), "Save secret");
    await sd.waitFor({ state: "hidden" });
    await cam.pause(1200);
    // A skill imported from GitHub.
    await cam.click(nav.getByRole("button", { name: /^Skills/ }), "Skills");
    await cam.click(page.getByRole("button", { name: "Add from GitHub" }).first(), "Add from GitHub");
    const gd = page.getByRole("dialog", { name: "Add skills from GitHub" });
    await gd.waitFor();
    await cam.type(gd.getByRole("textbox", { name: "Repository" }), story.toolkit.skills_repo, "the repository");
    const only = gd.getByRole("textbox", { name: /Only these skills/ });
    if (await only.count()) await cam.type(only, SKILL, "only mcp-builder");
    await cam.click(gd.getByRole("button", { name: "Find skills" }), "Find skills");
    const found = gd.getByRole("group", { name: "Skills found" });
    await found.waitFor({ timeout: 60000 });
    // Only the one skill: untick the others (the dialog ticks every SKILL.md it found).
    const boxes = found.getByRole("checkbox");
    for (let i = 0; i < (await boxes.count()); i += 1) {
      const b = boxes.nth(i);
      const name = (await b.getAttribute("aria-label")) ?? (await b.evaluate((el) => el.closest("label")?.innerText ?? ""));
      const want = name.includes(SKILL);
      if ((await b.isChecked()) !== want) await b.click();
    }
    await cam.hover(found.getByText(SKILL).first(), SKILL);
    await cam.click(gd.getByRole("button", { name: /^Add 1 skill/ }), "Add 1 skill");
    await page.getByText(/skills? added from/).first().waitFor({ timeout: 30000 }).catch(() => {});
    await cam.pause(1800);
  },
};
