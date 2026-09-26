import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { useNav } from "../../lib/nav";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { DomainDetailPage } from "./DomainDetailPage";
import { detailView, filesList, mockApi, sampleDomains } from "./domainsTestUtils";

const SUPPORT = detailView(sampleDomains()[0], {
  last_question_at: new Date(Date.now() - 2 * 3_600_000 - 60_000).toISOString(),
});
const ID = SUPPORT.domain_id;

const STEP = {
  node_id: "n-step",
  team_id: "t-docs",
  team_name: "Docs team",
  title: "Look up support docs",
  pass_to_spec: true,
};
const agent = (over: Record<string, unknown>) => ({
  node_id: "n-pm",
  team_id: "t-sprint",
  team_name: "Indicator sprint team",
  role_name: "pm",
  title: "Product manager",
  model: "xai/grok-4.7",
  scope: "this",
  subscription: null,
  ...over,
});
const PM = agent({});
const REVIEWER = agent({
  node_id: "n-rev",
  team_id: "t-bot",
  team_name: "Support bot",
  role_name: "reviewer",
  title: "Reviewer",
  scope: "all",
});
const PLACES = {
  teams: [
    {
      team_id: "t-docs",
      name: "Docs team",
      path: ["Product manager", "Writer", "Reviewer"],
      places: [
        { after_node_id: "n-docs-pm", after: "Product manager", next: "Writer" },
        { after_node_id: "n-writer", after: "Writer", next: "Reviewer" },
      ],
    },
    { team_id: "t-empty", name: "Empty team", path: [], places: [] },
  ],
};

function Harness() {
  const { route } = useNav();
  if (route.page === "team") return <p>{`canvas ${route.teamId} ${route.node ?? ""}`}</p>;
  if (route.page !== "domains" || !route.domainId) return <p>left the domain</p>;
  return <DomainDetailPage domainId={route.domainId} tab={route.tab} />;
}

function renderTeams() {
  window.location.hash = `#/domains/${ID}/teams`;
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

function routes(over: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    [`GET /api/domains/${ID}`]: SUPPORT,
    [`GET /api/domains/${ID}/documents`]: filesList([]),
    [`GET /api/domains/${ID}/usage`]: { steps: [STEP], agents: [PM, REVIEWER] },
    [`GET /api/domains/${ID}/step-places`]: PLACES,
    ...over,
  });
}

const card = (name: string) => screen.getByRole("region", { name });
const dialog = () => screen.getByRole("dialog");

beforeEach(() => {
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Use in teams (Dm-Teams)", () => {
  it("shows the three cards, the steps and agents that use it, and the domain ID", async () => {
    routes();
    renderTeams();
    const step = await screen.findByText("Look up support docs");
    expect(within(card("Ask it yourself")).getByText("Last question asked 2 hours ago.")).toBe(
      within(card("Ask it yourself")).getByRole("listitem"),
    );
    expect(step.nextSibling).toHaveTextContent("Docs team · answer passed to the spec");
    const agents = card("Let an agent search it");
    expect(
      within(agents).getByText("Indicator sprint team · can search this domain"),
    ).toBeVisible();
    // A legacy all-domains agent says so.
    expect(within(agents).getByText("Support bot · can search all your domains")).toBeVisible();
    // OQ-19: the raw id, no MCP-client claim.
    expect(screen.getByText("Domain ID")).toBeInTheDocument();
    expect(screen.getByText(ID)).toBeInTheDocument();
    expect(screen.queryByText(/MCP clients/)).toBeNull();

    fireEvent.click(within(agents).getAllByRole("button", { name: "Open canvas" })[0]);
    expect(await screen.findByText("canvas t-sprint n-pm")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/teams/t-sprint?node=n-pm");
  });

  it("says when nothing uses it yet (DmF-Step-1, DmF-Agent-1)", async () => {
    routes({
      [`GET /api/domains/${ID}`]: { ...SUPPORT, last_question_at: null },
      [`GET /api/domains/${ID}/usage`]: { steps: [], agents: [] },
    });
    renderTeams();
    expect(await screen.findByText("Not in any team yet.")).toBeInTheDocument();
    expect(screen.getByText("No agent can search it yet.")).toBeInTheDocument();
    expect(screen.getByText("No questions yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Ask" }));
    await waitFor(() => expect(window.location.hash).toBe(`#/domains/${ID}/ask`));
  });

  it("copies the domain ID", async () => {
    routes();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderTeams();
    await screen.findByText("Look up support docs");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(ID);
    expect(await screen.findByText("Domain ID copied.")).toBeInTheDocument();
  });

  it("offers a retry when the uses can't load", async () => {
    routes({
      [`GET /api/domains/${ID}/usage`]: () => new Response("{}", { status: 500 }),
    });
    renderTeams();
    expect(await screen.findByText("Couldn’t load where this domain is used.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("Add as a step in a team (DmF-Step-1…3)", () => {
  it("opens on the Team list; Add step waits for a pick, then adds after the first agent", async () => {
    const calls = routes({
      [`POST /api/domains/${ID}/steps`]: {
        node_id: "n-new",
        team_id: "t-docs",
        title: "Look up support docs",
        after: { node_id: "n-docs-pm", title: "Product manager" },
        connected_to: { node_id: "n-writer", title: "Writer" },
      },
    });
    renderTeams();
    await screen.findByText("Look up support docs");
    fireEvent.click(screen.getByRole("button", { name: "Add as a step in a team" }));
    const d = await screen.findByRole("dialog", { name: "Add Support docs to a team" });
    expect(
      within(d).getByText("It becomes a Query domain node that asks one question every run."),
    ).toBeInTheDocument();
    const list = await within(d).findByRole("listbox", { name: "Team" });
    const docs = within(list).getByRole("option", { name: /Docs team/ });
    expect(docs).toHaveAttribute("aria-selected", "true");
    expect(within(docs).getByText("Product manager → Writer → Reviewer")).toBeInTheDocument();
    // A team with no agents can't take a step.
    expect(within(list).getByRole("option", { name: /Empty team/ })).toBeDisabled();
    expect(within(list).getByText("No agents yet")).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Add step" })).toBeDisabled();

    fireEvent.click(docs);
    expect(within(d).queryByRole("listbox")).toBeNull();
    const where = within(d).getByRole("combobox", { name: "Where in the flow" });
    expect(where).toHaveValue("After Product manager");
    const question = within(d).getByRole("textbox", { name: "Question to ask" });
    expect(question).toHaveValue("What do our support docs say about {idea}?");
    expect(
      within(d).getByText("{idea} is replaced by the idea you launch the run with."),
    ).toBeInTheDocument();
    expect(
      within(d).getByRole("switch", { name: "Pass the answer to the next agents" }),
    ).toBeChecked();

    fireEvent.change(where, { target: { value: "After Writer" } });
    fireEvent.click(within(d).getByRole("button", { name: "Add step" }));
    await waitFor(() => expect(window.location.hash).toBe("#/teams/t-docs?node=n-new"));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      team_id: "t-docs",
      after_node_id: "n-writer",
      prompt: "What do our support docs say about {idea}?",
      pass_to_spec: true,
    });
    expect(
      await screen.findByText("Added after Product manager. Connected to Writer."),
    ).toBeVisible();
  });

  it("shows the server's reason when the place is refused", async () => {
    routes({
      [`POST /api/domains/${ID}/steps`]: () =>
        new Response(JSON.stringify({ detail: "Pick where the step goes." }), { status: 422 }),
    });
    renderTeams();
    await screen.findByText("Look up support docs");
    fireEvent.click(screen.getByRole("button", { name: "Add as a step in a team" }));
    const list = await screen.findByRole("listbox", { name: "Team" });
    fireEvent.click(within(list).getByRole("option", { name: /Docs team/ }));
    fireEvent.click(within(dialog()).getByRole("switch", { name: /Pass the answer/ }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Add step" }));
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "Pick where the step goes.",
    );
  });
});

describe("Give an agent access (DmF-Agent-1…3)", () => {
  it("picks an agent, keeps those with access, then lists and flashes the new row", async () => {
    let agents = [REVIEWER];
    const calls = routes({
      [`GET /api/domains/${ID}/usage`]: () => ({ steps: [STEP], agents }),
      [`GET /api/domains/${ID}/agents`]: {
        agents: [
          { ...PM, scope: null },
          agent({
            node_id: "n-eng",
            title: "Engineer",
            model: "anthropic/claude-sonnet-5",
            scope: null,
          }),
          REVIEWER,
        ],
      },
      [`PUT /api/domains/${ID}/agents`]: () => {
        agents = [PM, REVIEWER];
        return { agents };
      },
    });
    renderTeams();
    await screen.findByText("Look up support docs");
    fireEvent.click(screen.getByRole("button", { name: "Give an agent access" }));
    const d = await screen.findByRole("dialog", { name: "Let an agent search Support docs" });
    await within(d).findByRole("radio", { name: /Product manager/ });
    expect(within(d).getByText("Indicator sprint team · xai/grok-4.7")).toBeInTheDocument();
    // An agent with access already can't be picked again.
    expect(within(d).getByRole("radio", { name: /Reviewer/ })).toBeDisabled();
    expect(within(d).getByText("Support bot · Can search it already")).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Give access" })).toBeDisabled();

    // The search narrows the rows.
    fireEvent.change(within(d).getByRole("searchbox", { name: "Search agents and teams" }), {
      target: { value: "claude" },
    });
    expect(within(d).queryByRole("radio", { name: /Product manager/ })).toBeNull();
    fireEvent.change(within(d).getByRole("searchbox"), { target: { value: "" } });

    fireEvent.click(within(d).getByRole("radio", { name: /Product manager/ }));
    fireEvent.click(within(d).getByRole("button", { name: "Give access" }));
    expect(await screen.findByText("Product manager can now search Support docs")).toBeVisible();
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ node_ids: ["n-rev", "n-pm"] });
    const agentsCard = card("Let an agent search it");
    await within(agentsCard).findByText("Indicator sprint team · can search this domain");
    expect(agentsCard).toHaveClass("dm-use__card--flash");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says a Desktop plan's agent can't search domains there", async () => {
    routes({
      [`GET /api/domains/${ID}/agents`]: {
        agents: [{ ...PM, scope: null, subscription: "grok" }],
      },
    });
    renderTeams();
    await screen.findByText("Look up support docs");
    fireEvent.click(screen.getByRole("button", { name: "Give an agent access" }));
    const d = await screen.findByRole("dialog");
    expect(
      await within(d).findByText(
        "On Tvashtr Desktop with your Grok plan it can’t search domains yet.",
      ),
    ).toBeInTheDocument();
  });
});
