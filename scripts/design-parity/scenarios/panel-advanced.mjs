// F5 group G6 — Advanced output format + focus mode: Flow-Schema-1..3 (the drawer alone, 384×800)
// and Desktop-Focus (1440×900), each as a website and a Desktop render.
import {
  NODES,
  REVIEWER_PROMPT,
  TEAM_ID,
  drawerReady,
  graph,
  isolateDrawer,
  panelRoutes,
} from "./panel-fixtures.mjs";

export const at = (node, focus = false) =>
  `/#/teams/${TEAM_ID}?node=${node}${focus ? "&focus=1" : ""}`;

export const web = (over) => panelRoutes({ keys: ["xai", "anthropic"], over });
export const desktop = (over) =>
  panelRoutes({ keys: [], subs: ["claude", "grok"], over });

// Desktop: the one-time subscription disclosure was already dismissed this session.
export const seenDisclosure = () =>
  sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");

// The website render of a Desktop board: the web has no title strip, so the page is framed 30px
// down, where the Desktop board draws it (as panel-shell's Main).
export const underTitleStrip = (page) =>
  page.addStyleTag({
    content: "body { padding-top: 30px; box-sizing: border-box; }",
  });

// ---- Flow-Schema --------------------------------------------------------------------------------

// The design's schema, first without the comma after the "required" list (line 3), then fixed.
const BROKEN_SCHEMA = [
  "{",
  '  "type": "object",',
  '  "required": ["verdict", "reasons"]',
  '  "properties": {',
  '    "verdict": { "enum": ["approved", "changes_requested"] },',
  '    "reasons": { "type": "string" }',
  "  }",
  "}",
].join("\n");
const FIXED_SCHEMA = BROKEN_SCHEMA.replace('"reasons"]\n', '"reasons"],\n');

/**
 * Flow-Schema-1 draws the collapsed instructions about 60px tall (the app keeps 196px), with the
 * body at the top. As in panel-access, the body scrolls until the "Access & documents" title sits
 * where the design draws it (y 592); the instructions' items only move (up, under the tabs).
 */
const ACCESS_TITLE_Y = 592;
const alignAccess = (page) =>
  page.evaluate((y) => {
    const body = document.querySelector(".nd-body");
    const title = document.querySelector(
      'section[aria-label="Access & documents"] h3',
    );
    if (body && title) body.scrollTop += title.getBoundingClientRect().top - y;
  }, ACCESS_TITLE_Y);

async function openAdvanced(page) {
  await page.getByRole("button", { name: /^Advanced/ }).click();
  await page.waitForTimeout(150);
}

async function openSchemaEditor(page, text) {
  await openAdvanced(page);
  await page.getByRole("button", { name: "Add JSON schema" }).click();
  const editor = page.getByRole("textbox", { name: "Output format" });
  await editor.fill(text);
  // The caret back at the start, the sheet scrolled to the top.
  await editor.evaluate((el) => {
    el.setSelectionRange(0, 0);
    el.scrollTop = 0;
    const body = el.closest(".nd-sub__body");
    if (body) body.scrollTop = 0;
  });
  await page.waitForTimeout(150);
}

const flows = {
  "Flow-Schema-1": async (p) => {
    await openAdvanced(p);
    await p.evaluate(() => document.activeElement?.blur());
    await alignAccess(p);
  },
  "Flow-Schema-2": (p) => openSchemaEditor(p, BROKEN_SCHEMA),
  "Flow-Schema-3": (p) => openSchemaEditor(p, FIXED_SCHEMA),
};

// ---- Desktop-Focus ------------------------------------------------------------------------------

// The board's counter reads "1,284 characters · about 320 tokens": the Reviewer's first 27 lines,
// with line 26 a little longer, come to exactly 1,284 characters (and keep the verdict line).
export const FOCUS_PROMPT = REVIEWER_PROMPT.split("\n")
  .slice(0, 27)
  .map((line, i) =>
    i === 25 ? "- One to three short, specific sentences, no more." : line,
  )
  .join("\n");
if (FOCUS_PROMPT.length !== 1284)
  throw new Error(`focus prompt is ${FOCUS_PROMPT.length} chars`);

export const FOCUS_NODES = Object.values({
  ...NODES,
  rev: { ...NODES.rev, prompt: FOCUS_PROMPT },
});

/** The caret on line 12, column 38 ("Line 12, column 38"), in the focused editor. */
export async function caretAt(page, line, column) {
  const editor = page.getByRole("textbox", { name: "Instructions" });
  await editor.evaluate(
    (el, [l, c]) => {
      const lines = el.value.split("\n");
      const offset =
        lines.slice(0, l - 1).reduce((n, s) => n + s.length + 1, 0) + (c - 1);
      el.focus({ preventScroll: true });
      el.setSelectionRange(offset, offset);
      el.closest(".fx-editor").scrollTop = 0;
    },
    [line, column],
  );
  await page.waitForTimeout(150);
}

export const focusSteps = async (p) => {
  await p.getByRole("dialog", { name: "Reviewer in focus view" }).waitFor();
  await p.waitForTimeout(300);
  await caretAt(p, 12, 38);
};

// ---- Scenarios ----------------------------------------------------------------------------------

const scenarios = [];
for (const [name, steps] of Object.entries(flows)) {
  const base = { width: 384, height: 800, path: at(NODES.rev.id) };
  const run = async (p) => {
    await drawerReady(p);
    await isolateDrawer(p);
    await steps(p);
  };
  scenarios.push(
    { name: `${name}-web`, ...base, routes: web(), steps: run },
    {
      name: `${name}-desktop`,
      ...base,
      routes: desktop(),
      desktop: true,
      init: seenDisclosure,
      steps: run,
    },
  );
}

scenarios.push(
  {
    name: "Desktop-Focus-web",
    path: at(NODES.rev.id, true),
    routes: web({ [`GET /api/teams/${TEAM_ID}/graph`]: graph(FOCUS_NODES) }),
    steps: async (p) => {
      await underTitleStrip(p);
      await focusSteps(p);
    },
  },
  {
    name: "Desktop-Focus-desktop",
    path: at(NODES.rev.id, true),
    routes: desktop({
      [`GET /api/teams/${TEAM_ID}/graph`]: graph(FOCUS_NODES),
    }),
    desktop: true,
    init: seenDisclosure,
    steps: focusSteps,
  },
);

export default scenarios;
