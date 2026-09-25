import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { HomeContext, type HomeContextValue } from "./homeContext";
import { NewTeamDialog } from "./NewTeamDialog";

const shape = (...labels: string[]) => ({
  nodes: labels.map((l) => ({ id: null, kind: "worker", role: l.toLowerCase(), label: l })),
  loops: [],
});

const TEMPLATES = {
  templates: [
    {
      template: "two_node",
      name: "PM → Engineer",
      description: "A PM writes the spec; an Engineer builds and ships it. No review step.",
      shape: shape("PM", "Engineer", "Ship"),
    },
    {
      template: "review_loop",
      name: "PM → Engineer ⇄ Reviewer",
      description: "Adds a Reviewer that runs the tests and loops back for fixes.",
      shape: shape("PM", "Engineer", "Reviewer", "Ship"),
    },
  ],
  blank: {
    template: "blank",
    name: "Blank",
    description: "An empty canvas: one thinker into Ship. Wire the rest yourself.",
    shape: shape("Thinker", "Ship"),
  },
};

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function renderDialog(props: { initialTemplate?: string } = {}) {
  const onClose = vi.fn();
  const reloadTeams = vi.fn(() => Promise.resolve());
  render(
    <ToastProvider>
      <HomeContext.Provider value={{ reloadTeams } as unknown as HomeContextValue}>
        <NewTeamDialog open onClose={onClose} {...props} />
      </HomeContext.Provider>
    </ToastProvider>,
  );
  return { onClose, reloadTeams };
}

beforeEach(() => {
  handler = (url) => (url === "/api/templates" ? json(TEMPLATES) : json({}, 404));
  fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("NewTeamDialog", () => {
  it("offers Blank (selected) and the starter templates with their strips", async () => {
    renderDialog();
    const dialog = screen.getByRole("dialog", { name: "New team" });
    expect(within(dialog).getByLabelText("Name")).toHaveFocus();
    expect(dialog).toHaveTextContent("So this isn’t another “New team”.");
    await screen.findByRole("button", { name: /PM → Engineer ⇄ Reviewer/ });
    const blank = screen.getByRole("button", { name: /^Blank/ });
    expect(blank).toHaveAttribute("aria-pressed", "true");
    expect(within(blank).getByRole("img", { name: "Thinker" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("You can change every agent after you create it.");
  });

  it("a blank name shows the error and sends nothing", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect(screen.getByText("Give this team a name so you can tell it apart.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, i]) => (i as RequestInit)?.method === "POST")).toEqual(
      [],
    );
    await userEvent.type(screen.getByLabelText("Name"), "x");
    expect(screen.queryByText("Give this team a name so you can tell it apart.")).toBeNull();
  });

  it("creates the team, then opens it on the canvas with a toast", async () => {
    let posted: unknown = null;
    handler = (url, init) => {
      if (url === "/api/templates") return json(TEMPLATES);
      if (url === "/api/teams" && init?.method === "POST") {
        posted = JSON.parse(init.body as string);
        return json({ team_graph_id: "t-new", name: "Payments squad" });
      }
      return json({}, 404);
    };
    const { onClose, reloadTeams } = renderDialog();
    await userEvent.type(screen.getByLabelText("Name"), "  Payments squad ");
    await userEvent.click(await screen.findByRole("button", { name: /PM → Engineer ⇄ Reviewer/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create team" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posted).toEqual({ template: "review_loop", name: "Payments squad" });
    expect(window.location.hash).toBe("#/teams/t-new");
    expect(reloadTeams).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Payments squad created. Click an agent to set it up, then Run.",
    );
  });

  it("shows Creating… while the request runs", async () => {
    handler = (url) =>
      url === "/api/templates" ? json(TEMPLATES) : new Promise<Response>(() => undefined);
    renderDialog();
    await userEvent.type(screen.getByLabelText("Name"), "Payments squad");
    await userEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect(screen.getByRole("button", { name: "Creating…" })).toHaveAttribute("aria-busy", "true");
  });

  it("maps a 422 to the name error and a failure to the backend copy", async () => {
    handler = (url, init) => {
      if (url === "/api/templates") return json(TEMPLATES);
      if (init?.method === "POST") return json({ detail: "A team name is required." }, 422);
      return json({}, 404);
    };
    renderDialog();
    await userEvent.type(screen.getByLabelText("Name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect(
      await screen.findByText("Give this team a name so you can tell it apart."),
    ).toBeInTheDocument();

    handler = (url) => (url === "/api/templates" ? json(TEMPLATES) : json({}, 500));
    await userEvent.type(screen.getByLabelText("Name"), "y");
    await userEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect(
      await screen.findByText("Couldn’t create the team — is the backend running?"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create team" })).toBeEnabled();
  });

  it("templates failing to load leaves Blank and says why", async () => {
    handler = () => json({ detail: "boom" }, 500);
    renderDialog({ initialTemplate: "review_loop" });
    expect(
      await screen.findByText(
        "Couldn’t load the starter templates — is the backend running? You can still start from Blank.",
      ),
    ).toBeInTheDocument();
    const cards = within(screen.getByRole("group", { name: "Starting point" })).getAllByRole(
      "button",
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("preselects the template it was opened with", async () => {
    renderDialog({ initialTemplate: "two_node" });
    const card = await screen.findByRole("button", { name: /^PM → Engineer (?!⇄)/ });
    expect(card).toHaveAttribute("aria-pressed", "true");
  });

  it("Escape closes it", async () => {
    const { onClose } = renderDialog();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
