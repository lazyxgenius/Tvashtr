// F6 group G2 — the document viewer: Docs-Viewer / Docs-ViewerWeb (reading the shared spec),
// Docs-Compare (v2 → v3 inline), Docs-EditLive (a live edit of the spec) and Focus-Docs (the focus
// view's Docs tab), each as a website and a Desktop render.
import { NODES, TEAM_ID } from "./panel-fixtures.mjs";
import { aboveTitleStrip, pair } from "./panel-skills.mjs";
import { underTitleStrip } from "./panel-advanced.mjs";
import { SPEC_EDIT, docsRoutes } from "./focus-docs-fixtures.mjs";

const ROUTES = docsRoutes();
const viewer = (query = "") => `/#/teams/${TEAM_ID}/docs/d-spec${query}`;

/** The viewer, once the spec, the run's documents and the versions are in. */
const viewerReady = async (page) => {
  const dialog = page.getByRole("dialog", { name: "Shared spec" });
  await dialog.getByRole("heading", { name: "Add an RSI indicator" }).waitFor();
  await dialog.getByText("Engineer · v2").waitFor();
  await dialog
    .getByText("Every agent reads the shared spec", { exact: false })
    .waitFor();
  await page.waitForTimeout(300);
  await page.mouse.move(0, 0);
};

/** A Desktop board's website render sits under the title strip's 30px. */
const desktopBoard = (name, base) => {
  const [web, desktop] = pair(name, base, ROUTES);
  return [
    {
      ...web,
      steps: async (p) => {
        await underTitleStrip(p);
        await base.steps(p);
      },
    },
    desktop,
  ];
};

export default [
  ...desktopBoard("Docs-Viewer", { path: viewer(), steps: viewerReady }),
  ...pair(
    "Docs-ViewerWeb",
    { path: viewer(), steps: viewerReady },
    ROUTES,
    aboveTitleStrip,
  ),
  ...desktopBoard("Docs-Compare", {
    path: viewer("?compare=2"),
    steps: viewerReady,
  }),
  ...desktopBoard("Docs-EditLive", {
    path: viewer(),
    steps: async (page) => {
      await viewerReady(page);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator(".dv-editor .ProseMirror").waitFor();
      // The design's edit: the start of the spec with the third goal rewritten, caret at its end.
      await page.evaluate((markdown) => {
        const editor = document.querySelector(".dv-editor .ProseMirror").editor;
        editor.commands.setContent(markdown);
        editor.commands.focus("end");
      }, SPEC_EDIT);
      await page.getByText("Unsaved edit · saves as v4").waitFor();
      await page.waitForTimeout(300);
    },
  }),
  ...desktopBoard("Focus-Docs", {
    path: `/#/teams/${TEAM_ID}?node=${NODES.rev.id}&tab=docs&focus=1`,
    steps: async (page) => {
      const dialog = page.getByRole("dialog", {
        name: "Reviewer in focus view",
      });
      await dialog
        .getByRole("heading", { name: "Add an RSI indicator" })
        .waitFor();
      await dialog.getByText("Engineer · v2").waitFor();
      await dialog
        .getByText("Every agent reads the shared spec", { exact: false })
        .waitFor();
      await page.waitForTimeout(300);
      await page.mouse.move(0, 0);
    },
  }),
];
