// A domain's Use in teams tab (group G11), website and Desktop:
//   teams   → Dm-Teams (a step in Docs team, two agents with access)
//   step-1  → DmF-Step-1 (not in any team yet; Add as a step in a team focused)
//   step-2  → DmF-Step-2 (Add Support docs to a team: the Team list open, Docs team shown)
//   step-3  → DmF-Step-3 (Docs team picked: After Product manager, the question, pass on; Add step focused)
//   agent-1 → DmF-Agent-1 (no agent can search it yet; Give an agent access focused)
//   agent-2 → DmF-Agent-2 (Let an agent search Support docs: Product manager picked, Give access focused)
//   agent-3 → DmF-Agent-3 (access given: the agent card lists Product manager and flashes, the toast)
import {
  D,
  DOMAINS,
  SUPPORT_FILES,
  ago,
  detailOf,
  detailRoutes,
  pair,
} from "./domains-fixtures.mjs";

const id = D.support;
const path = `/#/domains/${id}/teams`;
// The design's sample keeps "Use in teams 3" on every board (its count is the list item's).
const DETAIL = detailOf(DOMAINS[0], { last_question_at: ago(125) });

const T = {
  docs: "d4427ab6-2d4d-4ab9-b925-bd7e107ce3a4",
  sprint: "5e0f6a3b-7c1d-4e2f-9a8b-1c2d3e4f5a6b",
  bot: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
};
const N = {
  step: "0f1e2d3c-4b5a-4968-8776-655443322110",
  docsPm: "caf4bd86-8193-44b4-9d45-e70e6a644956",
  writer: "40de840c-643d-45f0-be48-eb36b543068b",
  docsReviewer: "1390b92b-9033-430c-8409-610b63a4d3ae",
  pm: "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e",
  engineer: "c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f",
  triage: "d3e4f5a6-b7c8-4d9e-8f1a-2b3c4d5e6f7a",
  reply: "e4f5a6b7-c8d9-4e0f-9a2b-3c4d5e6f7a8b",
  reviewer: "f5a6b7c8-d9e0-4f1a-8b3c-4d5e6f7a8b9c",
};

const STEP = {
  node_id: N.step,
  team_id: T.docs,
  team_name: "Docs team",
  title: "Look up support docs",
  pass_to_spec: true,
};
const agent = (node_id, team_id, team_name, title, model, scope = "this") => ({
  node_id,
  team_id,
  team_name,
  role_name: title === "Product manager" ? "pm" : title.toLowerCase(),
  title,
  model,
  scope,
  subscription: null,
});
const PM = agent(
  N.pm,
  T.sprint,
  "Indicator sprint team",
  "Product manager",
  "xai/grok-4.7",
);
const REVIEWER = agent(
  N.reviewer,
  T.bot,
  "Support bot",
  "Reviewer",
  "xai/grok-4.7",
);
// The Give access dialog's rows (DmF-Agent-2), none with access yet.
const CHOICES = [
  { ...PM, scope: null },
  agent(
    N.engineer,
    T.sprint,
    "Indicator sprint team",
    "Engineer",
    "anthropic/claude-sonnet-5",
    null,
  ),
  agent(
    N.writer,
    T.docs,
    "Docs team",
    "Writer",
    "anthropic/claude-sonnet-5",
    null,
  ),
  { ...REVIEWER, scope: null },
];

const place = (after_node_id, after, next) => ({ after_node_id, after, next });
const PLACES = {
  teams: [
    {
      team_id: T.docs,
      name: "Docs team",
      path: ["Product manager", "Writer", "Reviewer"],
      places: [
        place(N.docsPm, "Product manager", "Writer"),
        place(N.writer, "Writer", "Reviewer"),
        place(N.docsReviewer, "Reviewer", "Ship"),
      ],
    },
    {
      team_id: T.sprint,
      name: "Indicator sprint team",
      path: ["Product manager", "Engineer", "Reviewer"],
      places: [
        place(N.pm, "Product manager", "Approval"),
        place(N.engineer, "Engineer", "Reviewer"),
      ],
    },
    {
      team_id: T.bot,
      name: "Support bot",
      path: ["Triage", "Reply", "Reviewer"],
      places: [
        place(N.triage, "Triage", "Reply"),
        place(N.reply, "Reply", "Reviewer"),
      ],
    },
  ],
};

/** The tab's routes; `usage` answers GET …/usage (a function for a board whose uses change). */
function teamsRoutes(usage) {
  return detailRoutes({
    detail: DETAIL,
    files: SUPPORT_FILES,
    extra: {
      [`GET /api/domains/${id}/usage`]: usage,
      [`GET /api/domains/${id}/step-places`]: PLACES,
      [`GET /api/domains/${id}/agents`]: { agents: CHOICES },
      [`PUT /api/domains/${id}/agents`]: { agents: [PM] },
    },
  });
}

const loaded = (page) =>
  page.getByText("Last question asked 2 hours ago.").waitFor();

/** Keyboard focus on `name` (the frames' coral ring is focus-visible): focus what comes before it
 *  in the tab order, then Tab. */
async function ring(page, before, name) {
  await page.getByRole("button", { name: before, exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name, exact: true }).evaluate((el) => {
    if (el !== document.activeElement)
      throw new Error(`${el.textContent} is not focused`);
  });
  await page.mouse.move(0, 0);
}

const openAddStep = async (page) => {
  await loaded(page);
  await page.getByRole("button", { name: "Add as a step in a team" }).click();
  await page.getByRole("listbox", { name: "Team" }).waitFor();
};

const openGiveAccess = async (page) => {
  await loaded(page);
  await page.getByRole("button", { name: "Give an agent access" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Let an agent search Support docs",
  });
  await dialog.getByText("Product manager", { exact: true }).click();
};

// Fresh routes per render: the agent card lists Product manager once access is given.
const perSurface = (name, spec) =>
  ["web", "desktop"].map((surface) => ({
    ...pair(name, spec()).find((s) => s.name.endsWith(surface)),
  }));

export default [
  ...pair("teams", {
    path,
    routes: teamsRoutes({ steps: [STEP], agents: [PM, REVIEWER] }),
    steps: loaded,
  }),
  ...pair("step-1", {
    path,
    routes: teamsRoutes({ steps: [], agents: [PM, REVIEWER] }),
    steps: async (page) => {
      await loaded(page);
      await ring(page, "Open Ask", "Add as a step in a team");
    },
  }),
  ...pair("step-2", {
    path,
    routes: teamsRoutes({ steps: [], agents: [PM, REVIEWER] }),
    steps: async (page) => {
      await openAddStep(page);
      await page.mouse.move(0, 0);
    },
  }),
  ...pair("step-3", {
    path,
    routes: teamsRoutes({ steps: [], agents: [PM, REVIEWER] }),
    steps: async (page) => {
      await openAddStep(page);
      await page.getByRole("option", { name: /^Docs team/ }).click();
      await page
        .getByText("After Product manager")
        .first()
        .waitFor({ state: "attached" });
      await ring(page, "Cancel", "Add step");
    },
  }),
  ...pair("agent-1", {
    path,
    routes: teamsRoutes({ steps: [STEP], agents: [] }),
    steps: async (page) => {
      await loaded(page);
      await ring(page, "Add as a step in a team", "Give an agent access");
    },
  }),
  ...pair("agent-2", {
    path,
    routes: teamsRoutes({ steps: [STEP], agents: [] }),
    steps: async (page) => {
      await openGiveAccess(page);
      await ring(page, "Cancel", "Give access");
    },
  }),
  ...perSurface("agent-3", () => {
    let given = false;
    const routes = teamsRoutes(() => ({
      json: { steps: [STEP], agents: given ? [PM] : [] },
    }));
    routes[`PUT /api/domains/${id}/agents`] = () => {
      given = true;
      return { json: { agents: [PM] } };
    };
    return {
      path,
      routes,
      steps: async (page) => {
        await openGiveAccess(page);
        await page.getByRole("button", { name: "Give access" }).click();
        await page
          .getByText("Product manager can now search Support docs")
          .waitFor();
        await page
          .getByText("Indicator sprint team · can search this domain")
          .waitFor();
        await page.mouse.move(0, 0);
      },
    };
  }),
];
