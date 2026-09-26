// F5 group G5 — Access & documents: Flow-Access-1..2, Flow-Reads-1..2, Flow-Writes-1..2, each as a
// website and a Desktop render (the drawer alone, 384×800).
import {
  EDGES,
  NODES,
  TEAM_ID,
  TEAM_NAME,
  drawerReady,
  isolateDrawer,
  panelRoutes,
} from "./panel-fixtures.mjs";

const at = (node) => `/#/teams/${TEAM_ID}?node=${node}`;

// The design's documents: the Engineer writes build-notes, and "design" is a name someone reads
// that no one writes yet (the Engineer lists it), so the Reads picker shows Shared spec — Product
// manager, build-notes — Engineer, design — no one writes this yet.
const ENGINEER = {
  ...NODES.eng,
  config: {
    ...NODES.eng.config,
    writes_to: "build-notes",
    reads_from: ["spec", "design"],
  },
};
// The -2 boards count "2 unsaved changes": the flow's change plus Images turned off (the saved
// Reviewer reads images; the design draws the switch off).
const withImages = (node) => ({
  ...node,
  config: { ...node.config, multimodal: true },
});

const graphOf = (nodes, edges = EDGES) => ({
  [`GET /api/teams/${TEAM_ID}/graph`]: {
    team_graph_id: TEAM_ID,
    name: TEAM_NAME,
    nodes,
    edges,
  },
});
const teamWith = (rev, eng, edges) =>
  graphOf(Object.values({ ...NODES, rev, eng }), edges);

// Flow-Writes: Writes is off on an agent that routes on a verdict (Q3), so these boards run on a
// Reviewer that doesn't branch — its arrows go on to Ship, and back to the Engineer (loop). Only
// build-notes is known to it (no one lists "design" here), as drawn.
const NO_VERDICT_EDGES = EDGES.map((e) =>
  e.id === "e-rev-ship" ? { ...e, conditions: null } : e,
);
const WRITES_ENGINEER = {
  ...NODES.eng,
  config: { ...NODES.eng.config, writes_to: "build-notes" },
};

const web = (over) => panelRoutes({ keys: ["xai", "anthropic"], over });
const desktop = (over) =>
  panelRoutes({ keys: [], subs: ["claude", "grok"], over });

// Desktop: the one-time subscription disclosure was already dismissed this session.
const seenDisclosure = () =>
  sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");

/** Out of focus, the drawer body and the collapsed editor back at the top. */
async function settle(page) {
  await page.evaluate(() => {
    document.activeElement?.blur();
    const body = document.querySelector(".nd-body");
    if (body) body.scrollTop = 0;
    const editor = document.querySelector(".nd-editor");
    if (editor) editor.scrollTop = 0;
  });
}

/**
 * These boards draw the collapsed instructions about 60px tall (every other board 196px), so the
 * Access section sits about 136px higher than the app draws it. The app keeps one height: the
 * scenario scrolls the drawer body until the "Access & documents" title is where the design draws
 * it (y 612), which puts its rows (and the popover that opens from them) there too. The amount
 * differs per board with what's above it: the website's one-line API-key hint, Flow-Reads-2's
 * run-time banner (it now names build-notes: one more line), Flow-Writes' one-line routing.
 */
const ACCESS_TITLE_Y = 612;
const alignAccess = (page) =>
  page.evaluate((y) => {
    const body = document.querySelector(".nd-body");
    const title = document.querySelector(
      'section[aria-label="Access & documents"] h3',
    );
    if (body && title) body.scrollTop += title.getBoundingClientRect().top - y;
  }, ACCESS_TITLE_Y);

/** The switch's input is visually hidden under its track: click it the way a label click would. */
const imagesOff = (page) =>
  page.getByRole("switch", { name: "Images" }).evaluate((el) => el.click());

const section = (page) =>
  page.getByRole("region", { name: "Access & documents" });

async function openAdd(page) {
  await section(page).getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Documents it reads, in order" })
    .waitFor();
  await page.waitForTimeout(250);
}

async function openChoose(page) {
  await section(page)
    .getByRole("button", { name: "Choose", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "The one document it writes" })
    .waitFor();
  await page.waitForTimeout(250);
}

const flows = {
  "Flow-Access-1": {
    team: teamWith(NODES.rev, ENGINEER),
    steps: async (p) => {
      await section(p).getByRole("button", { name: "Can edit files" }).click();
      await p
        .getByRole("alertdialog", { name: "Let Reviewer change files?" })
        .waitFor();
      await p.waitForTimeout(250);
      await settle(p);
    },
  },
  "Flow-Access-2": {
    team: teamWith(withImages(NODES.rev), ENGINEER),
    steps: async (p) => {
      await section(p).getByRole("button", { name: "Can edit files" }).click();
      await p.getByRole("button", { name: "Allow edits" }).click();
      await imagesOff(p);
      await settle(p);
    },
  },
  "Flow-Reads-1": {
    team: teamWith(NODES.rev, ENGINEER),
    steps: async (p) => {
      await openAdd(p);
      await settle(p);
    },
  },
  "Flow-Reads-2": {
    team: teamWith(withImages(NODES.rev), ENGINEER),
    steps: async (p) => {
      await openAdd(p);
      await p
        .getByRole("dialog", { name: "Documents it reads, in order" })
        .getByRole("checkbox", { name: /build-notes/ })
        .check();
      await p.keyboard.press("Escape");
      await imagesOff(p);
      await settle(p);
    },
  },
  "Flow-Writes-1": {
    team: teamWith(NODES.rev, WRITES_ENGINEER, NO_VERDICT_EDGES),
    steps: async (p) => {
      await openChoose(p);
      await p
        .getByRole("dialog", { name: "The one document it writes" })
        .getByRole("textbox", { name: "New document name" })
        .fill("review-notes");
      await settle(p);
    },
  },
  "Flow-Writes-2": {
    team: teamWith(withImages(NODES.rev), WRITES_ENGINEER, NO_VERDICT_EDGES),
    steps: async (p) => {
      await openChoose(p);
      const pop = p.getByRole("dialog", { name: "The one document it writes" });
      await pop
        .getByRole("textbox", { name: "New document name" })
        .fill("review-notes");
      await pop.getByRole("button", { name: "Use review-notes" }).click();
      await imagesOff(p);
      await settle(p);
      // The toast (bottom 70px) is up; keep the pointer off it.
      await p.mouse.move(380, 20);
    },
  },
};

const scenarios = [];
for (const [name, { team, steps }] of Object.entries(flows)) {
  const base = { width: 384, height: 800, path: at(NODES.rev.id) };
  const run = async (p) => {
    await drawerReady(p);
    await isolateDrawer(p);
    await steps(p);
    await alignAccess(p);
  };
  scenarios.push(
    { name: `${name}-web`, ...base, routes: web(team), steps: run },
    {
      name: `${name}-desktop`,
      ...base,
      routes: desktop(team),
      desktop: true,
      init: seenDisclosure,
      steps: run,
    },
  );
}

export default scenarios;
