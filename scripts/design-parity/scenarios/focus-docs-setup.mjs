// F6 group G3 — the focus view's Setup family: Focus-Setup (= F5's Desktop-Focus), Focus-SetupWeb
// (the website header), Focus-SetupEditing (two unsaved changes), Focus-ReviewChanges (the footer
// count opened), Focus-AgentSees ("Preview as the agent sees it") and Focus-Templates (the
// Templates dialog), each as a website and a Desktop render.
import { NODES, REVIEWER_PROMPT, TEAM_ID, graph } from "./panel-fixtures.mjs";
import advanced, {
  FOCUS_NODES,
  FOCUS_PROMPT,
  at,
  caretAt,
  desktop,
  focusSteps,
  seenDisclosure,
  underTitleStrip,
  web,
} from "./panel-advanced.mjs";
import { aboveTitleStrip } from "./panel-skills.mjs";
import { SPEC_V3 } from "./focus-docs-fixtures.mjs";

const PATH = at(NODES.rev.id, true);
const GRAPH = `GET /api/teams/${TEAM_ID}/graph`;

// GET /api/node-templates: the four built-in templates with the server's one-sentence summaries
// (control_plane/node_templates.py, B1). The Reviewer's prompt is the design's sample.
const template = (key, title, summary, prompt, edits_allowed) => ({
  key,
  title,
  description: "",
  summary,
  role_name: key,
  node_kind: key === "pm" || key === "architect" ? "thinker" : "worker",
  edits_allowed,
  writes_to: null,
  verdict_labels: key === "reviewer" ? ["approved", "changes_requested"] : [],
  prompt,
});
const TEMPLATES = {
  templates: [
    template(
      "pm",
      "Product manager",
      "Turns your idea into a spec the team can build from.",
      "You are the PM on a software team. Write a concise mini-PRD (3-5 sentences) for the idea.",
      false,
    ),
    template(
      "architect",
      "Architect",
      "Plans the change and adds a technical design to the spec.",
      "You are the software architect on the team. Restate the spec and append a technical design.",
      false,
    ),
    template(
      "engineer",
      "Engineer",
      "Builds the change the spec asks for.",
      "Read the PRD below and create exactly the file it specifies, with exactly the specified contents.",
      true,
    ),
    template(
      "reviewer",
      "Reviewer",
      "Checks the build against the spec and gives a verdict.",
      REVIEWER_PROMPT,
      false,
    ),
  ],
};

// POST …/context-preview as the server compiles it for this Reviewer (read-only, one pinned
// lesson, the run's idea and spec v3): its instructions first (spec OQ-1), then the lesson, the
// idea, the spec and the report-only note; house-style always on, pytest-review fetched at run time.
const part = (key, label, text, source, tokens) => ({
  key,
  label,
  text,
  tokens,
  source: { label: source },
  placeholder: false,
});
const PREVIEW = {
  source_run: {
    run_id: "r-rsi",
    idea: "Add an RSI indicator to the strategy builder.",
    created_at: "2026-09-27T08:00:00+00:00",
  },
  parts: [
    part(
      "node_prompt",
      "Your instructions",
      FOCUS_PROMPT,
      "Setup → Instructions",
      321,
    ),
    part(
      "memory",
      "Remembered lessons",
      "--- REMEMBERED LESSONS ---\n- MUST: Run pytest with -q so the output fits the verdict.",
      "Pinned lessons · 1",
      18,
    ),
    part(
      "idea",
      "The idea",
      "--- ORIGINAL IDEA ---\nAdd an RSI indicator to the strategy builder.",
      "Typed when you pressed Run",
      16,
    ),
    part(
      "spec",
      "The latest spec",
      `--- PRD ---\n${SPEC_V3}`,
      "Shared spec · v3",
      180,
    ),
    part(
      "capability_note",
      "Report-only note",
      "--- REPORT-ONLY NODE ---\nFile changes you make in this run are not applied anywhere — this node is report-only: do NOT build or implement the feature, and create no code/feature files. Write your complete deliverable — a written report — to REPORT.md at the workspace root. Do not attempt workarounds to apply file changes.",
      "Setup → File access: Read-only",
      70,
    ),
  ],
  skills: [
    {
      name: "house-style",
      mode: "always",
      triggers: [],
      delivery: "context",
      content:
        "# House style\n\nWrite review notes in plain words. Lead with the verdict, then the reasons. Quote the test output you relied on.",
      tokens: 30,
      source_type: "inline",
      fetched_at_run_time: false,
    },
    {
      name: "https://github.com/org/skills",
      mode: null,
      triggers: [],
      delivery: "context",
      content: null,
      tokens: 0,
      source_type: "repo",
      fetched_at_run_time: true,
    },
  ],
  skills_tokens: 30,
  total_tokens: 605,
  budget: 110000,
  over_budget: false,
  handle_used: false,
  notes: [
    "Pinned lessons are shown. At run time, other lessons that match the task are added too.",
    "Repo skills and rules files are fetched when the team runs.",
  ],
};

const over = (nodes = FOCUS_NODES) => ({
  [GRAPH]: graph(nodes),
  "GET /api/node-templates": TEMPLATES,
  [`POST /api/teams/${TEAM_ID}/nodes/${NODES.rev.id}/context-preview`]: PREVIEW,
});

/** Focus-Setup + a board's own steps; `desktopBoard` = the Desktop board's web render sits 30px down. */
function boards(name, { nodes, steps = async () => {}, desktopBoard = true }) {
  const run = async (p) => {
    await focusSteps(p);
    await steps(p);
  };
  return [
    {
      name: `${name}-web`,
      path: PATH,
      routes: web(over(nodes)),
      steps: async (p) => {
        if (desktopBoard) await underTitleStrip(p);
        await run(p);
      },
    },
    {
      name: `${name}-desktop`,
      path: PATH,
      routes: desktop(over(nodes)),
      desktop: true,
      init: seenDisclosure,
      steps: async (p) => {
        if (!desktopBoard) await aboveTitleStrip(p);
        await run(p);
      },
    },
  ];
}

const lines = FOCUS_PROMPT.split("\n");
const withLines = (edit) => {
  const next = [...lines];
  edit(next);
  return next.join("\n");
};

/** Type into the editor the way a person does (React sees the input), then put the caret back. */
async function setPrompt(page, text) {
  await page.getByRole("textbox", { name: "Instructions" }).fill(text);
  await caretAt(page, 12, 38);
}

// Focus-SetupEditing: "1. Inspect the files…" edited (a trailing space; the design draws the same
// words with the band — its line 5, the app's line 4, as the mock hard-breaks line 1), a character
// dropped from line 26 (out of view) so the count still reads 1,284, and Images turned off (saved
// on) — "2 unsaved changes".
const EDITING_NODES = FOCUS_NODES.map((n) =>
  n.id === NODES.rev.id
    ? { ...n, config: { ...n.config, multimodal: true } }
    : n,
);
const editingSteps = async (p) => {
  await setPrompt(
    p,
    withLines((l) => {
      l[3] = `${l[3]} `;
      l[25] = l[25].slice(0, -1);
    }),
  );
  await p.getByRole("switch", { name: "Images" }).evaluate((el) => el.click());
  await caretAt(p, 12, 38);
  await p.getByText("2 unsaved changes").waitFor();
  await p.mouse.move(0, 0);
};

// Focus-ReviewChanges: the pytest fallback rewritten as two lines, and the model moved to Claude.
const REVIEW_PROMPT = withLines((l) => {
  const i = l.findIndex((s) => s.includes("If pytest is unavailable"));
  l.splice(
    i,
    1,
    "   If pytest is unavailable, run: python -m unittest discover -s tests",
    "   Report which command you used in the reasons.",
  );
});
const reviewSteps = async (p) => {
  await setPrompt(p, REVIEW_PROMPT);
  await p.getByRole("button", { name: /^Model / }).click();
  await p
    .getByRole("option", { name: /claude-sonnet-5/ })
    .first()
    .click();
  await p.getByRole("button", { name: "2 unsaved changes" }).click();
  await p.getByRole("region", { name: "Review 2 changes" }).waitFor();
  await p.waitForTimeout(300);
  await p.mouse.move(0, 0);
};

// The design squeezes its four cards into the dialog (its column clips them). The app's cards
// scroll under the fixed head, and the real preview has two more parts (the pinned lesson and the
// report-only note), so the cards are scrolled until Always-on skills sits where the design draws
// it (y 720).
const SKILLS_CARD_Y = 720;
const previewSteps = async (p) => {
  await p.getByRole("button", { name: "Preview as the agent sees it" }).click();
  await p.getByRole("region", { name: "Always-on skills" }).waitFor();
  await p.evaluate((y) => {
    const card = document.querySelector(
      '.fx-part[aria-label="Always-on skills"]',
    );
    card.closest(".fx-sub__list").scrollTop +=
      card.getBoundingClientRect().top - y;
  }, SKILLS_CARD_Y);
  await p.waitForTimeout(300);
  await p.mouse.move(0, 0);
};

const templatesSteps = async (p) => {
  await p.getByRole("button", { name: "Templates" }).click();
  const dialog = p.getByRole("dialog", { name: "Choose a template" });
  await dialog
    .getByText("Checks the build against the spec and gives a verdict.")
    .waitFor();
  await p.waitForTimeout(300);
  await p.mouse.move(0, 0);
};

// Focus-Setup's HTML is Desktop-Focus's, byte for byte: F5's scenario, under this board's name.
const setup = advanced
  .filter((s) => s.name.startsWith("Desktop-Focus-"))
  .map((s) => ({ ...s, name: s.name.replace("Desktop-Focus", "Focus-Setup") }));

export default [
  ...setup,
  ...boards("Focus-SetupWeb", { desktopBoard: false }),
  ...boards("Focus-SetupEditing", {
    nodes: EDITING_NODES,
    steps: editingSteps,
  }),
  ...boards("Focus-ReviewChanges", { steps: reviewSteps }),
  ...boards("Focus-AgentSees", { steps: previewSteps }),
  ...boards("Focus-Templates", { steps: templatesSteps }),
];
