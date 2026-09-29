// Tvashtr Desktop app screens (desktop-app.md), group G5: setup's Project step (DT-Project,
// DtF-Run-6, DtF-Git-1/2/3) and First team (DT-Team, DtF-Run-7). Desktop-only boards: every
// scenario is `desktop: true` with the v6 fake bridge from desktop-app.mjs (setup unfinished, so
// the app sits on #/setup/<step>) plus its `repos` fake for this Mac's folders.
//
// The coral rings on the DtF-* boards are annotations (box-shadows), not UI.
import { desktopBridge } from "./desktop-app.mjs";

const ME = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "lazyxgenius@users.noreply.github.com",
  github_login: "lazyxgenius",
  display_name: "lazyxgenius",
};

const routes = {
  "GET /api/auth/me": ME,
  "GET /api/providers": { providers: [] },
  "GET /api/teams": { teams: [] },
};

const TRADE = {
  path: "/Users/lazyx/code/trade_mcp",
  displayPath: "~/code/trade_mcp",
};
const NOTES = {
  path: "/Users/lazyx/Documents/notes",
  displayPath: "~/Documents/notes",
};

const repos = {
  pick: NOTES,
  inspect: {
    [TRADE.path]: {
      is_git: true,
      current_branch: "main",
      branches: ["main"],
      tracked_file_count: 42,
      subpaths: [],
      remote_url: "https://github.com/lazyxgenius/trade_mcp.git",
    },
    [NOTES.path]: {
      is_git: false,
      error: "This folder isn't a git repository.",
      reason: "not_git",
    },
  },
};

const heading = (page, name) => page.getByRole("heading", { name }).waitFor();

// DT-Project / DtF-Run-6: a git folder chosen earlier on this Mac.
const project = {
  path: "/#/home",
  desktop: true,
  routes,
  init: desktopBridge({
    repos,
    setup: { step: "project", workspace: { kind: "folder", ...TRADE } },
  }),
  steps: async (page) => {
    await heading(page, "Where should your teams work?");
    await page
      .getByText("git repo · branch main · lazyxgenius/trade_mcp")
      .waitFor();
  },
};

// DtF-Git-1: the folder card selected, no folder yet.
const chooseFolder = {
  ...project,
  init: desktopBridge({ repos, setup: { step: "project" } }),
  steps: async (page) => {
    await heading(page, "Where should your teams work?");
    await page.getByRole("button", { name: "Choose folder…" }).waitFor();
  },
};

// DtF-Git-2: the picked folder isn't a git repository.
const notARepo = {
  ...chooseFolder,
  steps: async (page) => {
    await heading(page, "Where should your teams work?");
    await page.getByRole("button", { name: "Choose folder…" }).click();
    await page.getByRole("button", { name: "Set up git here" }).waitFor();
  },
};

// DtF-Git-3: Set up git here made it a repository.
const gitSetUp = {
  ...chooseFolder,
  steps: async (page) => {
    await notARepo.steps(page);
    await page.getByRole("button", { name: "Set up git here" }).click();
    await page.getByText("git set up · branch main · no remote yet").waitFor();
  },
};

// DT-Team / DtF-Run-7: both plans in use, so the strips read Grok / Claude plan as designed.
const node = (kind, role, label, model = null, runs_on = null) => ({
  id: null,
  kind,
  role,
  label,
  model,
  runs_on,
});
const GROK = "xai/grok-4.7";
const CLAUDE = "anthropic/claude-sonnet-5";
const TEMPLATES = {
  templates: [
    {
      template: "review_loop",
      name: "PM → Engineer ⇄ Reviewer",
      description:
        "Adds a Reviewer that runs the tests and loops back for fixes.",
      shape: {
        nodes: [
          node("thinker", "pm", "PM", GROK, "grok"),
          node("gate", "gate", "Approval"),
          node("worker", "engineer", "Engineer", CLAUDE, "claude"),
          node("worker", "reviewer", "Reviewer", GROK, "grok"),
          node("terminal", "ship", "Ship"),
        ],
        loops: [{ from: 3, to: 2 }],
      },
    },
    {
      template: "spec_only",
      name: "Spec only",
      description: "Turns an idea into a reviewed spec. No code changes.",
      shape: {
        nodes: [
          node("thinker", "pm", "PM", GROK, "grok"),
          node("worker", "reviewer", "Reviewer", CLAUDE, "claude"),
        ],
        loops: [],
      },
    },
  ],
  blank: {
    template: "blank",
    name: "Blank",
    description:
      "An empty canvas: one thinker into Ship. Wire the rest yourself.",
    shape: {
      nodes: [
        node("thinker", "thinker", "Thinker", GROK, "grok"),
        node("terminal", "ship", "Ship"),
      ],
      loops: [],
    },
  },
};

const team = {
  path: "/#/home",
  desktop: true,
  routes: { ...routes, "GET /api/templates?for=desktop": TEMPLATES },
  init: desktopBridge({
    repos,
    setup: { step: "team", workspace: { kind: "folder", ...TRADE } },
  }),
  steps: async (page) => {
    await heading(page, "Start with a team");
    await page.getByText("Claude plan").first().waitFor();
    // The design's sample name (the app prefills "My first team", OQ-13).
    const name = page.getByLabel("Team name");
    await name.fill("Refund feature team");
    await name.blur();
  },
};

export default [
  { name: "DT-Project", ...project },
  { name: "DtF-Run-6", ...project },
  { name: "DtF-Git-1", ...chooseFolder },
  { name: "DtF-Git-2", ...notARepo },
  { name: "DtF-Git-3", ...gitSetUp },
  { name: "DT-Team", ...team },
  { name: "DtF-Run-7", ...team },
];
