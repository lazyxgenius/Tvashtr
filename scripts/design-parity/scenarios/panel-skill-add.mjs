// F5 group G8 — the Skills sub-views: Web-AddSkill (write a skill), Panel-FromRepo (a GitHub repo),
// Flow-Presets-1..3 (Add skill menu → presets sheet → the added rows + "2 skills added" toast), each
// as a website and a Desktop render.
import { drawerReady, isolateDrawer } from "./panel-fixtures.mjs";
import {
  FULL,
  SKILLS,
  TOOLS,
  aboveTitleStrip,
  at,
  drawer,
  offscreenChange,
  openMenu,
  pair,
  reviewer,
  routes,
} from "./panel-skills.mjs";

// The design's presets, in its order (the names mirror the added rows: tdd-discipline, yagni).
const preset = (key, name, title, description) => ({
  key,
  name,
  title,
  description,
  access: "free",
  badge: "Free",
  attachable: true,
  source: { type: "inline", name, content: `# ${title}`, mode: "always" },
});
const PRESETS = {
  skills: [
    preset(
      "tdd",
      "tdd-discipline",
      "TDD discipline",
      "Red → green → refactor. Smallest code that makes the failing test pass.",
    ),
    preset(
      "yagni",
      "yagni",
      "YAGNI",
      "Smallest change that solves the asked problem, no speculative extras.",
    ),
    preset(
      "caveman",
      "caveman",
      "Caveman (terse)",
      "Ultra-compressed output style that keeps technical substance.",
    ),
  ],
};
// POST /api/skill-library answers with the new item (a preset's copy in the account library).
const created = (req) => {
  const body = req.postDataJSON();
  return {
    json: {
      id: `s-${body.name}`,
      name: body.name,
      source: body.source,
      created_at: "2026-09-26T10:00:00Z",
    },
  };
};
const PRESET_ROUTES = {
  "GET /api/skill-presets": PRESETS,
  "POST /api/skill-library": created,
};

// The sheets' boards count "Skills & tools 4": house-style + pytest-review, fetch + github.
const FOUR = routes(
  reviewer({
    skills: SKILLS.filter((s) => s.type !== "library"),
    tool_config: TOOLS,
  }),
  PRESET_ROUTES,
);
const FULL_PRESETS = { ...FULL, ...PRESET_ROUTES };

const SKILL_TEXT = [
  "# Security checklist",
  "",
  "When you review code that touches auth:",
  "- Tokens and secrets are never logged.",
  "- Secrets come from the environment, never from source.",
  "- New endpoints check the session before doing work.",
].join("\n");

/** The Skills & tools tab once its rows are named, then the Add skill menu's `item`. */
const openSheet =
  (item, { alone = true } = {}) =>
  async (page) => {
    await drawerReady(page);
    if (alone) await isolateDrawer(page);
    await page.getByText("house-style").first().waitFor();
    await page.getByRole("button", { name: "Add skill" }).click();
    await page.getByRole("menuitem", { name: item }).click();
  };

/** Leave nothing focused and every scroller at its top, as drawn. */
const settle = async (page) => {
  await page.evaluate(() => {
    document.activeElement?.blur();
    document.querySelectorAll(".nd-sub__body, textarea").forEach((el) => {
      el.scrollTop = 0;
    });
  });
  await page.mouse.move(0, 0);
};

const pickPresets = async (page) => {
  const sheet = page.getByRole("region", { name: "Add from presets" });
  await sheet.getByText("TDD discipline").waitFor();
  await sheet.getByRole("checkbox").nth(0).check();
  await sheet.getByRole("checkbox").nth(1).check();
};

export default [
  ...pair(
    "Web-AddSkill",
    {
      path: at("skills"),
      steps: async (p) => {
        await openSheet("Write a new skill", { alone: false })(p);
        await p
          .getByRole("textbox", { name: "Name" })
          .fill("security-checklist");
        await p
          .getByRole("textbox", { name: "Skill content (SKILL.md)" })
          .fill(SKILL_TEXT);
        await p.getByRole("button", { name: "When triggered" }).click();
        await p
          .getByRole("textbox", { name: "Trigger words" })
          .fill("auth, secrets, tokens");
        await settle(p);
      },
    },
    FOUR,
    aboveTitleStrip,
  ),
  ...pair(
    "Panel-FromRepo",
    {
      ...drawer,
      height: 760,
      steps: async (p) => {
        await openSheet("From a GitHub repo")(p);
        await p
          .getByRole("textbox", { name: "Repository" })
          .fill("https://github.com/lazyxgenius/skills");
        await settle(p);
      },
    },
    FOUR,
  ),
  ...pair(
    "Flow-Presets-1",
    {
      ...drawer,
      steps: async (p) => {
        await drawerReady(p);
        await isolateDrawer(p);
        await p.getByText("security-checklist").first().waitFor();
        await openMenu(p, p.getByRole("button", { name: "Add skill" }));
      },
    },
    FULL_PRESETS,
  ),
  ...pair(
    "Flow-Presets-2",
    {
      ...drawer,
      steps: async (p) => {
        await openSheet("From presets")(p);
        await pickPresets(p);
        await settle(p);
      },
    },
    FOUR,
  ),
  ...pair(
    "Flow-Presets-3",
    {
      ...drawer,
      steps: async (p) => {
        await openSheet("From presets")(p);
        await pickPresets(p);
        await p.getByRole("button", { name: "Add 2 skills" }).click();
        await p.getByText("2 skills added").waitFor();
        await p.getByText("tdd-discipline").waitFor();
        await offscreenChange(p);
        await settle(p);
        await p.evaluate(() => {
          document.querySelector(".nd-body").scrollTop = 0;
        });
      },
    },
    FULL_PRESETS,
  ),
];
