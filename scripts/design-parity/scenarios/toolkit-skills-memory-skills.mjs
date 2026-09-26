// Toolkit › Skills (slice F4) — website and Desktop renders of every Skills artboard.
// Scenario names are `<Artboard>-web` / `<Artboard>-desktop`, so the measurement lands in
// /tmp/parity-toolkit-skills-memory/<Artboard>-<surface>.json next to the design's <Artboard>.json.
import {
  LIBRARY,
  PRESET_LIBRARY,
  frozenClock,
  skillsRoutes,
} from "./toolkit-skills-memory-fixtures.mjs";

// `routes` is a factory: each render gets its own fixture state (a POST in the web render must not
// leak into the Desktop one).
const both = (artboard, { path, routes, steps, settle }) => [
  {
    name: `${artboard}-web`,
    path,
    routes: routes(),
    steps,
    settle,
    init: frozenClock,
  },
  {
    name: `${artboard}-desktop`,
    path,
    routes: routes(),
    steps,
    settle,
    init: frozenClock,
    desktop: true,
  },
];

const presetsFlow = () => {
  // The library grows when YAGNI is added (a fresh closure per scenario).
  const library = [...PRESET_LIBRARY];
  return skillsRoutes({ library, onCreate: (s) => library.push(s) });
};

const waitRows = (page) => page.waitForSelector(".sk-table tbody tr");

// G2 flows mutate the library (Delete, Add from GitHub): each render gets its own copy.
const g2Routes = () => skillsRoutes({ library: [...LIBRARY] });

const openMenu = async (page) => {
  await waitRows(page);
  await page
    .getByRole("button", { name: "More actions for house-style" })
    .click();
  await page.waitForSelector('[role="menu"]');
};
const openDelete = async (page) => {
  await openMenu(page);
  await page.getByRole("menuitem", { name: "Delete skill" }).click();
  await page
    .getByRole("alertdialog", { name: "Delete house-style?" })
    .getByText(/Reviewer and Engineer in Indicator sprint team use it\./)
    .waitFor();
};
const openSheet = async (page) => {
  await waitRows(page);
  await page.getByRole("button", { name: "Add from GitHub" }).click();
  await page.waitForSelector(
    '[role="dialog"][aria-label="Add skills from GitHub"]',
  );
};
const findSkills = async (page, url) => {
  await openSheet(page);
  await page.getByRole("textbox", { name: "Repository" }).fill(url);
  await page.getByRole("button", { name: "Find skills" }).click();
};
const foundSkills = async (page) => {
  await findSkills(page, "https://github.com/lazyxgenius/skills");
  await page.waitForSelector(".sk-found");
};
const toastShown = async (page) => {
  await page.waitForSelector('[role="status"].ds-toast');
  // The toast's pop-in animation finishes before the shot.
  await page.waitForTimeout(300);
};
const waitPresets = (page) => page.waitForSelector(".sk-preset");
const previewYagni = async (page) => {
  await waitPresets(page);
  await page
    .getByRole("article", { name: "YAGNI" })
    .getByRole("button", { name: "Preview" })
    .click();
  await page.waitForSelector('[role="dialog"][aria-label="YAGNI preset"]');
};

export default [
  ...both("Toolkit-Skills", {
    path: "/#/toolkit/skills",
    routes: () => skillsRoutes({ library: LIBRARY }),
    steps: waitRows,
  }),
  // TkF-SkillTabs-1 is the Your skills tab (same frame as Toolkit-Skills).
  ...both("TkF-SkillTabs-1", {
    path: "/#/toolkit/skills",
    routes: () => skillsRoutes({ library: LIBRARY }),
    steps: waitRows,
  }),
  // TkF-SkillTabs-2: click "Presets" from Your skills.
  ...both("TkF-SkillTabs-2", {
    path: "/#/toolkit/skills",
    routes: () => skillsRoutes({ library: PRESET_LIBRARY }),
    steps: async (page) => {
      await waitRows(page);
      await page.getByRole("tab", { name: /Presets/ }).click();
      await waitPresets(page);
    },
  }),
  ...both("Toolkit-SkillPresets", {
    path: "/#/toolkit/skills/presets",
    routes: () => skillsRoutes({ library: PRESET_LIBRARY }),
    steps: waitPresets,
  }),
  // TkF-SkillsEmpty-1: a search with no match.
  ...both("TkF-SkillsEmpty-1", {
    path: "/#/toolkit/skills",
    routes: () => skillsRoutes({ library: LIBRARY }),
    steps: async (page) => {
      await waitRows(page);
      await page.getByRole("textbox", { name: "Search skills" }).fill("docker");
      await page.waitForSelector(".sk-empty");
    },
  }),
  // TkF-SkillsEmpty-2: an empty library.
  ...both("TkF-SkillsEmpty-2", {
    path: "/#/toolkit/skills",
    routes: () => skillsRoutes({ library: [] }),
    steps: (page) => page.waitForSelector(".sk-empty"),
  }),
  // TkF-Presets-1: Preview on YAGNI.
  ...both("TkF-Presets-1", {
    path: "/#/toolkit/skills/presets",
    routes: presetsFlow,
    steps: previewYagni,
  }),
  // TkF-Presets-2: Add to your skills from the preview → the card flips, the toast shows.
  ...both("TkF-Presets-2", {
    path: "/#/toolkit/skills/presets",
    routes: presetsFlow,
    steps: async (page) => {
      await previewYagni(page);
      await page
        .getByRole("dialog", { name: "YAGNI preset" })
        .getByRole("button", { name: "Add to your skills" })
        .click();
      await page.waitForSelector('[role="status"].ds-toast');
      // The toast's pop-in animation finishes before the shot.
      await page.waitForTimeout(300);
    },
  }),
  // TkF-SkillMenu-1: ⋯ on house-style opens its menu.
  ...both("TkF-SkillMenu-1", {
    path: "/#/toolkit/skills",
    routes: g2Routes,
    steps: openMenu,
  }),
  // TkF-SkillMenu-2: Delete skill shows who loses it (GET /{id} used_by).
  ...both("TkF-SkillMenu-2", {
    path: "/#/toolkit/skills",
    routes: g2Routes,
    steps: openDelete,
  }),
  // TkF-SkillMenu-3: confirmed → the row goes, "house-style deleted." (no undo).
  ...both("TkF-SkillMenu-3", {
    path: "/#/toolkit/skills",
    routes: g2Routes,
    steps: async (page) => {
      await openDelete(page);
      await page
        .getByRole("alertdialog", { name: "Delete house-style?" })
        .getByRole("button", { name: "Delete skill" })
        .click();
      await toastShown(page);
    },
  }),
  // TkF-FromRepo-1: a typo in the repo → the field error.
  ...both("TkF-FromRepo-1", {
    path: "/#/toolkit/skills",
    routes: g2Routes,
    steps: async (page) => {
      await findSkills(page, "https://github.com/lazyxgenius/skils");
      await page.waitForSelector(".ds-field__help--error");
    },
  }),
  // TkF-FromRepo-2 / Toolkit-SkillFromRepo: the found state.
  ...both("TkF-FromRepo-2", {
    path: "/#/toolkit/skills",
    routes: g2Routes,
    steps: foundSkills,
  }),
  ...both("Toolkit-SkillFromRepo", {
    path: "/#/toolkit/skills",
    routes: g2Routes,
    steps: foundSkills,
  }),
  // TkF-FromRepo-3: Add → the sheet closes, the new rows are tinted, the toast says so.
  ...both("TkF-FromRepo-3", {
    path: "/#/toolkit/skills",
    routes: g2Routes,
    steps: async (page) => {
      await foundSkills(page);
      await page.getByRole("button", { name: /^Add \d+ skills?$/ }).click();
      await toastShown(page);
    },
  }),
];
