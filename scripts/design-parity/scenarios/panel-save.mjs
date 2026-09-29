// F5 group G2 — editing, the save lifecycle and the ⋯ menu: Desktop-Editing, Flow-Save-1..3,
// Panel-CloseUnsaved, Flow-More-1..2, each as a website and a Desktop render.
import {
  NODES,
  REVIEWER_PROMPT,
  TEAM_ID,
  drawerReady,
  isolateDrawer,
  panelRoutes,
} from "./panel-fixtures.mjs";

const at = (node) => `/#/teams/${TEAM_ID}?node=${node}`;

// The saved Reviewer reads images, so the edit that turns Images off leaves the switch as the design
// draws it (off) while still counting as the second of "2 unsaved changes". The design's second
// change is the model (its Changed dot sits on the Model row); the model picker lands in G4.
const REVIEWER = {
  ...NODES.rev,
  config: { ...NODES.rev.config, multimodal: true },
};
const nodes = Object.values({ ...NODES, rev: REVIEWER });

const PATCH = `PATCH /api/teams/${TEAM_ID}/nodes/${NODES.rev.id}`;
const routes = (keys, subs, over = {}) =>
  panelRoutes({ nodes, keys, subs, over });
const WEB = routes(["xai", "anthropic"], []);
const DESKTOP = routes([], ["claude", "grok"]);
// Flow-Save-2 "Saving…": the PATCH never answers. Flow-Save-3 "Saved.": it answers at once.
const hang = { [PATCH]: () => new Promise(() => {}) };
const saved = { [PATCH]: REVIEWER };
const WEB_HANG = routes(["xai", "anthropic"], [], hang);
const DESKTOP_HANG = routes([], ["claude", "grok"], hang);
const WEB_SAVED = routes(["xai", "anthropic"], [], saved);
const DESKTOP_SAVED = routes([], ["claude", "grok"], saved);
// The ⋯ boards show the saved Reviewer as the design draws it (Images off, nothing changed).
const MORE_WEB = panelRoutes({ keys: ["xai", "anthropic"] });
const MORE_DESKTOP = panelRoutes({ keys: [], subs: ["claude", "grok"] });

// Desktop: the one-time subscription disclosure was already dismissed this session.
const seenDisclosure = () =>
  sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");

// The website render of a Desktop board: framed 30px down, where Desktop draws the page.
const underTitleStrip = async (page) => {
  await page.addStyleTag({
    content: "body { padding-top: 30px; box-sizing: border-box; }",
  });
};

/**
 * The design's edit: the blank line after the first paragraph changed (the coral line band) and
 * Images turned off. `breakSync` also drops `"approved"` from the verdict line further down, so the
 * routing line warns "Instructions no longer match your arrows" (Flow-Save-1, Desktop-Editing).
 */
async function edit(page, { breakSync }) {
  const lines = REVIEWER_PROMPT.split("\n");
  lines[1] = " ";
  if (breakSync) lines[8] = lines[8].replace('"approved" | ', "");
  const box = page.getByRole("textbox", { name: /^Instructions/ });
  await box.fill(lines.join("\n"));
  // Caret back to the top and out of the field (no focus ring, the collapsed editor unscrolled).
  await box.evaluate((el) => {
    el.setSelectionRange(0, 0);
    el.blur();
    el.parentElement.scrollTop = 0;
  });
  // The switch's input is visually hidden under its track: click it the way a label click would.
  await page
    .getByRole("switch", { name: "Images" })
    .evaluate((el) => el.click());
  await page.evaluate(() => {
    document.activeElement?.blur();
    const body = document.querySelector(".nd-body");
    if (body) body.scrollTop = 0;
  });
}

const drawerAlone = (steps) => async (page) => {
  await drawerReady(page);
  await isolateDrawer(page);
  await steps?.(page);
};

const pair = (name, base, webRoutes, desktopRoutes, webFrame) => [
  {
    name: `${name}-web`,
    ...base,
    routes: webRoutes,
    steps: webFrame
      ? async (p) => {
          await webFrame(p);
          await base.steps(p);
        }
      : base.steps,
  },
  {
    name: `${name}-desktop`,
    ...base,
    routes: desktopRoutes,
    desktop: true,
    init: seenDisclosure,
  },
];

const drawer = { width: 384, height: 800, path: at(NODES.rev.id) };

export default [
  ...pair(
    "Desktop-Editing",
    {
      path: at(NODES.rev.id),
      steps: async (p) => {
        await drawerReady(p);
        await edit(p, { breakSync: true });
      },
    },
    WEB,
    DESKTOP,
    underTitleStrip,
  ),
  ...pair(
    "Flow-Save-1",
    { ...drawer, steps: drawerAlone((p) => edit(p, { breakSync: true })) },
    WEB,
    DESKTOP,
  ),
  ...pair(
    "Flow-Save-2",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await edit(p, { breakSync: false });
        await p.getByRole("button", { name: /^Save/ }).click();
        await p.getByText("Saving 2 changes…").waitFor();
      }),
    },
    WEB_HANG,
    DESKTOP_HANG,
  ),
  ...pair(
    "Flow-Save-3",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await edit(p, { breakSync: false });
        await p.getByRole("button", { name: /^Save/ }).click();
        await p
          .getByText("Saved. This drives the next run you launch.")
          .waitFor();
      }),
    },
    WEB_SAVED,
    DESKTOP_SAVED,
  ),
  ...pair(
    "Panel-CloseUnsaved",
    {
      ...drawer,
      height: 900,
      steps: drawerAlone(async (p) => {
        await edit(p, { breakSync: true });
        await p.getByRole("button", { name: "Close panel" }).click();
        await p.getByRole("alertdialog", { name: "Unsaved changes" }).waitFor();
      }),
    },
    WEB,
    DESKTOP,
  ),
  ...pair(
    "Flow-More-1",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await p.getByRole("button", { name: "More actions" }).click();
        await p.getByRole("menu", { name: "More actions" }).waitFor();
      }),
    },
    MORE_WEB,
    MORE_DESKTOP,
  ),
  ...pair(
    "Flow-More-2",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await p.getByRole("button", { name: "More actions" }).click();
        await p.getByRole("menuitem", { name: /^Delete agent/ }).click();
        await p
          .getByRole("alertdialog", { name: "Delete Reviewer?" })
          .waitFor();
      }),
    },
    MORE_WEB,
    MORE_DESKTOP,
  ),
];
