// F5 group G3 — templates, routing sync and the new agent: Flow-Templates-1..3, Flow-Routing-1..3
// and Web-NewAgent, each as a website and a Desktop render.
import {
  NODES,
  REVIEWER_PROMPT,
  TEAM_ID,
  drawerReady,
  isolateDrawer,
  panelRoutes,
} from "./panel-fixtures.mjs";

const at = (node) => `/#/teams/${TEAM_ID}?node=${node}`;

// GET /api/node-templates: the four built-in templates (control_plane/node_templates.py). The
// Reviewer's is the design's 38-line sample. Flow-Templates-3 draws the routing line OUT of sync
// after the Reviewer template is applied, so this Reviewer template writes other verdict words
// ("pass" | "fail") than the arrows route on ("approved") and the real sync check flags it as
// drawn. (The shipped template writes "approved" | "changes_requested" and stays in sync.)
const template = (
  key,
  title,
  description,
  prompt,
  edits_allowed,
  verdict_labels = [],
) => ({
  key,
  title,
  description,
  role_name: key,
  node_kind: key === "pm" || key === "architect" ? "thinker" : "worker",
  edits_allowed,
  writes_to: null,
  verdict_labels,
  prompt,
});
const REVIEWER_TEMPLATE = REVIEWER_PROMPT.replace(
  '"approved" | "changes_requested"',
  '"pass" | "fail"',
);
const TEMPLATES = {
  templates: [
    template(
      "pm",
      "Product manager",
      "Drafts the spec",
      "You are the PM on a software team. Write a concise mini-PRD (3-5 sentences) for the idea.",
      false,
    ),
    template(
      "architect",
      "Architect",
      "Adds the technical design",
      "You are the software architect on the team. Restate the spec and append a technical design.",
      false,
    ),
    template(
      "engineer",
      "Engineer",
      "Writes & ships it",
      "Read the PRD below and create or edit the files in your current working directory to build it.",
      true,
    ),
    template(
      "reviewer",
      "Reviewer",
      "Checks against the spec",
      REVIEWER_TEMPLATE,
      false,
      ["pass", "fail"],
    ),
  ],
};
const withTemplates = (over = {}) => ({
  "GET /api/node-templates": TEMPLATES,
  ...over,
});

const WEB = panelRoutes({ keys: ["xai", "anthropic"], over: withTemplates() });
const DESKTOP = panelRoutes({
  keys: [],
  subs: ["claude", "grok"],
  over: withTemplates(),
});

// Flow-Templates-3 / Flow-Routing-*: the saved Reviewer reads images, so turning Images off draws
// the switch as the design does (off) while counting as the second of "2 unsaved changes" (the
// design's second change is the model; its picker is G4's). For Flow-Templates-3 the saved text
// also carries a stray space on the blank line after the first paragraph (invisible), so the
// Reviewer template changes that line — the coral band the design draws there.
const lines = REVIEWER_PROMPT.split("\n");
const SPACED = [lines[0], " ", ...lines.slice(2)].join("\n");
const reviewer = (over) =>
  Object.values({
    ...NODES,
    rev: {
      ...NODES.rev,
      config: { ...NODES.rev.config, multimodal: true },
      ...over,
    },
  });
const EDIT_WEB = panelRoutes({
  nodes: reviewer(),
  keys: ["xai", "anthropic"],
  over: withTemplates(),
});
const EDIT_DESKTOP = panelRoutes({
  nodes: reviewer(),
  keys: [],
  subs: ["claude", "grok"],
  over: withTemplates(),
});
const SPACED_WEB = panelRoutes({
  nodes: reviewer({ prompt: SPACED }),
  keys: ["xai", "anthropic"],
  over: withTemplates(),
});
const SPACED_DESKTOP = panelRoutes({
  nodes: reviewer({ prompt: SPACED }),
  keys: [],
  subs: ["claude", "grok"],
  over: withTemplates(),
});

// Web-NewAgent: a Worker just added from the palette with a blank model ("Needs a model"), no
// instructions and no arrows yet. Like the real validity check, the team then has two starting
// points, so the canvas says it can't run yet (the design leaves the new agent off its canvas).
const NEW = {
  id: "n-new",
  role_name: "worker",
  kind: "agent",
  model: "",
  engine: "openhands",
  prompt: "",
  position: { x: 640, y: 560 },
  edits_allowed: false,
  config: null,
  tool_config: null,
  skills: null,
  last_run: null,
};
const NEW_NODES = Object.values({ ...NODES, new: NEW });
const TWO_ROOTS = {
  [`GET /api/teams/${TEAM_ID}/validate`]: {
    errors: ["n-new", "n-pm"].map((node_id) => ({
      code: "multiple_roots",
      message:
        "More than one starting point (2) — a team needs exactly one. Wire these into a single entry.",
      node_id,
      edge_id: null,
    })),
    warnings: [],
    runnable: false,
  },
};
const NEW_WEB = panelRoutes({
  nodes: NEW_NODES,
  keys: ["xai", "anthropic"],
  over: withTemplates(TWO_ROOTS),
});
const NEW_DESKTOP = panelRoutes({
  nodes: NEW_NODES,
  keys: ["xai", "anthropic"],
  over: withTemplates(TWO_ROOTS),
});

// Desktop: the one-time subscription disclosure was already dismissed this session.
const seenDisclosure = () =>
  sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");

// The Desktop render of a website board: Desktop draws the 30px title strip above the page, so the
// page is framed 30px up (the strip sits above the artboard).
const aboveTitleStrip = async (page) => {
  await page.addStyleTag({
    content: "html { height: calc(100% + 30px); margin-top: -30px; }",
  });
};

/** Out of focus, caret and scroll back at the top (no focus ring, the collapsed editor unscrolled). */
async function settle(page) {
  await page.evaluate(() => {
    document.activeElement?.blur();
    const body = document.querySelector(".nd-body");
    if (body) body.scrollTop = 0;
    const editor = document.querySelector(".nd-editor");
    if (editor) editor.scrollTop = 0;
  });
}

// The switch's input is visually hidden under its track: click it the way a label click would.
const toggleImages = (page) =>
  page.getByRole("switch", { name: "Images" }).evaluate((el) => el.click());

/** Flow-Save-1's edit: the blank line after the first paragraph changed, `"approved"` dropped from
 *  the verdict line (out of sync), and Images off — "2 unsaved changes". */
async function editOutOfSync(page) {
  const edited = REVIEWER_PROMPT.split("\n");
  edited[1] = " ";
  edited[8] = edited[8].replace('"approved" | ', "");
  const box = page.getByRole("textbox", { name: /^Instructions/ });
  await box.fill(edited.join("\n"));
  await box.evaluate((el) => {
    el.setSelectionRange(0, 0);
    el.blur();
  });
  await toggleImages(page);
  await settle(page);
}

async function openTemplates(page) {
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("menuitem", { name: "Reviewer" }).waitFor();
  // Let the menu's pop-in finish: Playwright's pointer actions on a moving item can scroll the
  // drawer body to reach it (a harness artifact — a person's pointer doesn't scroll anything).
  await page.waitForTimeout(250);
}

/** The drawer body back at the top (a harness pointer action may have scrolled it). */
const unscroll = (page) =>
  page.evaluate(() => {
    const body = document.querySelector(".nd-body");
    if (body) body.scrollTop = 0;
  });

const drawerAlone = (steps) => async (page) => {
  await drawerReady(page);
  await isolateDrawer(page);
  await steps?.(page);
};

const pair = (name, base, webRoutes, desktopRoutes, desktopFrame) => [
  { name: `${name}-web`, ...base, routes: webRoutes },
  {
    name: `${name}-desktop`,
    ...base,
    routes: desktopRoutes,
    desktop: true,
    init: seenDisclosure,
    steps: desktopFrame
      ? async (p) => {
          await desktopFrame(p);
          await base.steps(p);
        }
      : base.steps,
  },
];

const drawer = { width: 384, height: 800, path: at(NODES.rev.id) };

export default [
  ...pair(
    "Flow-Templates-1",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await openTemplates(p);
        // The design draws the pointer resting on Reviewer.
        await p.getByRole("menuitem", { name: "Reviewer" }).hover();
        await unscroll(p);
      }),
    },
    WEB,
    DESKTOP,
  ),
  ...pair(
    "Flow-Templates-2",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await openTemplates(p);
        await p.getByRole("menuitem", { name: "Reviewer" }).click();
        await p
          .getByRole("alertdialog", { name: "Replace the instructions?" })
          .waitFor();
      }),
    },
    WEB,
    DESKTOP,
  ),
  ...pair(
    "Flow-Templates-3",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await toggleImages(p);
        await openTemplates(p);
        await p.getByRole("menuitem", { name: "Reviewer" }).click();
        await p.getByRole("button", { name: "Replace" }).click();
        await p.getByText("Reviewer template applied").waitFor();
        await settle(p);
      }),
    },
    SPACED_WEB,
    SPACED_DESKTOP,
  ),
  ...pair(
    "Flow-Routing-1",
    { ...drawer, steps: drawerAlone(editOutOfSync) },
    EDIT_WEB,
    EDIT_DESKTOP,
  ),
  ...pair(
    "Flow-Routing-2",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await editOutOfSync(p);
        await p.getByRole("button", { name: "Update instructions" }).click();
        await p
          .getByRole("alertdialog", { name: "Update the instructions?" })
          .waitFor();
      }),
    },
    EDIT_WEB,
    EDIT_DESKTOP,
  ),
  ...pair(
    "Flow-Routing-3",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await editOutOfSync(p);
        await p.getByRole("button", { name: "Update instructions" }).click();
        await p.getByRole("button", { name: "Add lines" }).click();
        await p
          .getByText("Instructions updated to match your arrows")
          .waitFor();
        await settle(p);
      }),
    },
    EDIT_WEB,
    EDIT_DESKTOP,
  ),
  ...pair(
    "Web-NewAgent",
    {
      path: at(NEW.id),
      steps: async (p) => {
        await drawerReady(p, "New agent");
        // The chooser's buttons enable once the templates have loaded.
        await p
          .getByRole("group", { name: "Start from a template" })
          .getByRole("button", { name: "Product manager" })
          .and(p.locator(":enabled"))
          .waitFor();
        await toggleImages(p);
        await settle(p);
      },
    },
    NEW_WEB,
    NEW_DESKTOP,
    aboveTitleStrip,
  ),
];
