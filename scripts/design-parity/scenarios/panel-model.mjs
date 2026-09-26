// F5 group G4 — the model picker and the model warnings: Desktop-ModelPicker, Flow-Model-1..3,
// Panel-ModelWeb, Panel-Warnings, each as a website and a Desktop render.
import {
  CATALOGUE,
  NODES,
  REVIEWER_PROMPT,
  TEAM_ID,
  drawerReady,
  isolateDrawer,
  panelRoutes,
} from "./panel-fixtures.mjs";

const at = (node) => `/#/teams/${TEAM_ID}?node=${node}`;
const PATCH = `PATCH /api/teams/${TEAM_ID}/nodes/${NODES.rev.id}`;

// The design's sample catalogue. The Reviewer is a worker (the agent loop), so the picker lists the
// worker presets: openai offers gpt-4.1-mini and gpt-4o-mini as drawn. NIM serves no seat (empty
// presets), so it's never offered even though the account holds its key.
const entry = (provider, label, models, extra = {}) => ({
  provider,
  thinker_default: models[0] ?? null,
  worker_default: models[0] ?? null,
  thinker_presets: models,
  worker_presets: models,
  label,
  model_labels: {},
  subscription: null,
  byok_probed: true,
  ...extra,
});
const byProvider = Object.fromEntries(CATALOGUE.map((e) => [e.provider, e]));
const NIM = entry("nvidia_nim", "NVIDIA NIM", []);
const OPENAI = entry(
  "openai",
  "OpenAI",
  ["openai/gpt-4.1-mini", "openai/gpt-4o-mini"],
  {
    model_labels: {
      "openai/gpt-4.1-mini": "GPT-4.1 mini",
      "openai/gpt-4o-mini": "GPT-4o mini",
    },
  },
);
const GEMINI = entry("gemini", "Gemini", ["gemini/gemini-2.5-flash"], {
  model_labels: { "gemini/gemini-2.5-flash": "Gemini 2.5 Flash" },
});
const DEEPSEEK = entry("deepseek", "DeepSeek", ["deepseek/deepseek-chat"], {
  model_labels: { "deepseek/deepseek-chat": "DeepSeek Chat" },
});
const config = (catalogue) => ({
  "GET /api/config": {
    hosted_mode: true,
    github_install_url: "https://github.com/apps/tvashtr/installations/new",
    github_manage_url: "https://github.com/apps/tvashtr/installations/new",
    provider_catalogue: catalogue,
    provider_directory: [],
    default_run_budget_usd: 5,
  },
});
// Desktop-ModelPicker / Flow-Model-*: xai, anthropic, openai, gemini. Panel-ModelWeb: deepseek.
const PICKER = config([
  NIM,
  byProvider.anthropic,
  byProvider.xai,
  OPENAI,
  GEMINI,
]);
const PICKER_WEB = config([
  NIM,
  byProvider.anthropic,
  byProvider.xai,
  OPENAI,
  DEEPSEEK,
]);

// Flow-Model-3: pasting the Gemini key saves it (POST /api/providers answers the new key's tail).
const addGemini = {
  "POST /api/providers": { provider: "gemini", key_last4: "9Q4k" },
};

// Desktop: the one-time subscription disclosure was already dismissed this session.
const seenDisclosure = () =>
  sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");

// The website render of a Desktop board: framed 30px down, where Desktop draws the page.
const underTitleStrip = async (page) => {
  await page.addStyleTag({
    content: "body { padding-top: 30px; box-sizing: border-box; }",
  });
};

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
 * The picker boards draw the collapsed instructions 150px tall (Panel-Warnings 120px) where every
 * other board draws them 196px, so the Model row sits 46px (76px) higher. The app keeps one height;
 * the scenario scrolls the drawer body by the difference, which puts the Model row (and the listbox
 * that opens from it) where the design draws it.
 */
const scrollBody = (page, px) =>
  page.evaluate((top) => {
    const body = document.querySelector(".nd-body");
    if (body) body.scrollTop = top;
  }, px);

async function openPicker(page, { model = "grok-4.7", scroll = 46 } = {}) {
  await page.getByRole("button", { name: model, exact: true }).click();
  await page.getByRole("listbox", { name: "Choose a model" }).waitFor();
  await page.waitForTimeout(250);
  await settle(page);
  await scrollBody(page, scroll);
}

const GEMINI_KEY = "AIzaSyD3m0-k3y-9Q4k";
const pasteGemini = (page) =>
  page
    .getByRole("textbox", { name: "Paste your Gemini API key" })
    .fill(GEMINI_KEY);

/** Flow-Model-3's first change: the blank line after the first paragraph (and, as drawn, the
 *  verdict line no longer says `"approved"`, so the routing line warns). */
async function editInstructions(page) {
  const edited = REVIEWER_PROMPT.split("\n");
  edited[1] = " ";
  edited[8] = edited[8].replace('"approved" | ', "");
  const box = page.getByRole("textbox", { name: /^Instructions/ });
  await box.fill(edited.join("\n"));
  await box.evaluate((el) => {
    el.setSelectionRange(0, 0);
    el.blur();
  });
  await settle(page);
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

const nodes = Object.values(NODES);
// The website holds xAI + Anthropic + OpenAI keys (the Reviewer runs on its xAI key); Desktop runs
// xai and anthropic on the Grok and Claude subscriptions and holds an OpenAI key. Gemini has none.
const WEB = panelRoutes({
  nodes,
  keys: ["xai", "anthropic", "openai", "nvidia_nim"],
  over: PICKER,
});
const DESKTOP = panelRoutes({
  nodes,
  keys: ["openai", "nvidia_nim"],
  subs: ["claude", "grok"],
  over: PICKER,
});
const WEB_ADD = panelRoutes({
  nodes,
  keys: ["xai", "anthropic", "openai"],
  over: { ...PICKER, ...addGemini },
});
const DESKTOP_ADD = panelRoutes({
  nodes,
  keys: ["openai"],
  subs: ["claude", "grok"],
  over: { ...PICKER, ...addGemini },
});
// Panel-ModelWeb: keys for xAI, OpenAI and DeepSeek; none for Anthropic.
const MODEL_WEB = panelRoutes({
  nodes,
  keys: ["xai", "openai", "deepseek"],
  over: PICKER_WEB,
});

// Panel-Warnings: the Engineer runs the Reviewer's model, and the save fails.
const sameModel = Object.values({
  ...NODES,
  eng: { ...NODES.eng, model: "xai/grok-4.7" },
});
const failSave = { [PATCH]: () => ({ status: 500, json: { detail: "boom" } }) };
const WARN_WEB = panelRoutes({
  nodes: sameModel,
  keys: ["xai", "anthropic", "openai"],
  over: { ...PICKER, ...failSave },
});
const WARN_DESKTOP = panelRoutes({
  nodes: sameModel,
  keys: ["openai"],
  subs: ["claude", "grok"],
  over: { ...PICKER, ...failSave },
});

/** Panel-Warnings: a mistyped custom backup model, then Save fails. */
async function warnings(page) {
  await page.getByRole("button", { name: /^Advanced/ }).click();
  await page.getByRole("button", { name: "None", exact: true }).click();
  await page.getByRole("listbox", { name: "Choose a backup model" }).waitFor();
  await page.getByRole("button", { name: "Use a custom model ID" }).click();
  await page
    .getByRole("textbox", { name: "Custom model ID" })
    .fill("openai/gpt-4o-mni");
  await page.getByRole("button", { name: "Use this model" }).click();
  await page.getByRole("button", { name: /^Save/ }).click();
  await page.getByText("Couldn’t save. Try again.").waitFor();
  await settle(page);
  await scrollBody(page, 76);
}

const drawer = { width: 384, height: 800, path: at(NODES.rev.id) };
const tall = { width: 384, height: 900, path: at(NODES.rev.id) };

export default [
  ...pair(
    "Desktop-ModelPicker",
    {
      path: at(NODES.rev.id),
      steps: async (p) => {
        await drawerReady(p);
        await openPicker(p);
      },
    },
    WEB,
    DESKTOP,
    underTitleStrip,
  ),
  ...pair(
    "Flow-Model-1",
    { ...drawer, steps: drawerAlone(openPicker) },
    WEB,
    DESKTOP,
  ),
  ...pair(
    "Flow-Model-2",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await openPicker(p);
        await pasteGemini(p);
        await settle(p);
        await scrollBody(p, 46);
      }),
    },
    WEB,
    DESKTOP,
  ),
  ...pair(
    "Flow-Model-3",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await editInstructions(p);
        await openPicker(p, { scroll: 0 });
        await pasteGemini(p);
        await p
          .getByRole("listbox")
          .getByRole("button", { name: "Add", exact: true })
          .click();
        await p
          .locator(".nd-toast-host")
          .getByText("Gemini key saved to Engines")
          .waitFor();
        await settle(p);
      }),
    },
    WEB_ADD,
    DESKTOP_ADD,
  ),
  ...pair(
    "Panel-ModelWeb",
    { ...tall, steps: drawerAlone(openPicker) },
    MODEL_WEB,
    MODEL_WEB,
  ),
  ...pair(
    "Panel-Warnings",
    { ...tall, steps: drawerAlone(warnings) },
    WARN_WEB,
    WARN_DESKTOP,
  ),
];
