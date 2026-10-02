import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import App from "./App";
import { ToastProvider } from "./design-system/components";
import type { Config } from "./lib/api";
import type { ImportFix } from "./lib/api/teams";

// M4 — the team file on the real <App/> (the control plane stubbed): the toolbar's Team file opens
// the read-only panel (YAML / JSON, Copy, Download, the no-secrets note), and an imported team shows
// its toast, its "things to fix" card and its cards' chips — kept in this tab's session.

const YAML = "# Tvashtr team file\nname: Indicator sprint team\nagents:\n  - id: engineer";
const JSON_TEXT = '{\n  "name": "Indicator sprint team"\n}';
const file = (format: "yaml" | "json") => ({
  filename: `indicator-sprint-team.${format}`,
  format,
  content: format === "yaml" ? YAML : JSON_TEXT,
  lines: format === "yaml" ? 4 : 3,
  needs: { connectors: ["github"], secrets: ["GITHUB_TOKEN"] },
});
const node = (id: string, role_name: string, kind: string, model: string | null) => ({
  id,
  role_name,
  kind,
  model,
  engine: null,
  prompt: null,
  position: { x: 0, y: 0 },
  config: null,
});
const GRAPH = {
  team_graph_id: "team-1",
  name: "Indicator sprint team",
  nodes: [
    node("tn-pm", "pm", "completion", "openai/gpt-4o-mini"),
    node("tn-eng", "engineer", "agent", "openai/gpt-4o-mini"),
  ],
  edges: [],
};
const FIXES: ImportFix[] = [
  {
    key: "connector:github",
    text: "Sign in to GitHub",
    action: "sign_in",
    target: "github",
    node_ids: ["tn-eng"],
  },
  {
    key: "tool:chart-render",
    text: "Add chart-render or remove it",
    action: "open_toolkit",
    target: "chart-render",
    node_ids: ["tn-eng"],
  },
];
const NOTE = "You can run the team now. It can’t open a pull request until GitHub is signed in.";
const KEY = "tvashtr.teamImport.team-1";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Fetch>;
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  window.location.hash = "";
  sessionStorage.clear();
  fetchMock = vi.fn<Fetch>((url) => {
    if (url === "/api/teams") return reply({ teams: [{ team_graph_id: "team-1", name: "x" }] });
    if (url === "/api/teams/team-1/graph") return reply(GRAPH);
    if (url === "/api/teams/team-1/validate")
      return reply({ errors: [], warnings: [], runnable: true });
    if (url === "/api/teams/team-1/file?format=yaml") return reply(file("yaml"));
    if (url === "/api/teams/team-1/file?format=json") return reply(file("json"));
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
  sessionStorage.clear();
});

const renderApp = (config?: Partial<Config>) =>
  render(
    <ToastProvider>
      <App teamId="team-1" config={config as Config | undefined} />
    </ToastProvider>,
  );

const openPanel = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Team file" }));
  const panel = await screen.findByRole("complementary", { name: "Team file" });
  await within(panel).findByText("indicator-sprint-team.yaml");
  return panel;
};

describe("App — M4 Team file panel", () => {
  it("keeps the team canvas's existing controls beside Team file (kept-teamcanvas.txt)", async () => {
    render(
      <ToastProvider>
        <App teamId="team-1" onBackToDashboard={vi.fn()} />
      </ToastProvider>,
    );
    // The cards are in (each card's model chip opens its Model field).
    expect(await screen.findAllByTitle("Set this node’s model")).toHaveLength(2);
    const toolbar = screen.getByRole("toolbar", { name: "Team" });
    for (const name of ["Back to teams", "Run this team", "Team file"])
      expect(within(toolbar).getByRole("button", { name })).toBeInTheDocument();
    expect(within(toolbar).getByText("$0.00")).toBeInTheDocument();
    expect(within(toolbar).getByText("Connected")).toBeInTheDocument();
    for (const name of ["Add to canvas", "Zoom In", "Zoom Out", "Fit View"])
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
  });

  it("Team file opens the read-only YAML with its lines and the no-secrets note; the button is tinted while open", async () => {
    renderApp();
    const button = await screen.findByRole("button", { name: "Team file" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    const panel = await openPanel();
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveClass("ds-btn--tint");
    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team-1/file?format=yaml", undefined);
    expect(within(panel).getByRole("button", { name: "YAML" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(panel).toHaveTextContent("name: Indicator sprint team");
    expect(within(panel).getByText("4 lines")).toBeInTheDocument();
    expect(within(panel).getByText("No secrets or sign-ins inside")).toBeInTheDocument();
    expect(panel).toHaveTextContent(
      "The file names GITHUB_TOKEN but never holds its value. Whoever imports it signs in with their own account.",
    );
    expect(panel).toHaveTextContent("Read-only · matches the canvas");
    // The toggle and Close put it away.
    fireEvent.click(button);
    expect(screen.queryByRole("complementary", { name: "Team file" })).toBeNull();
    await openPanel();
    fireEvent.click(
      within(screen.getByRole("complementary", { name: "Team file" })).getByRole("button", {
        name: "Close",
      }),
    );
    expect(screen.queryByRole("complementary", { name: "Team file" })).toBeNull();
  });

  it("JSON shows the JSON file; Download saves it under the server's filename; Copy copies it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const saved: string[] = [];
    URL.createObjectURL = vi.fn(() => "blob:team-file");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    renderApp();
    const panel = await openPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "JSON" }));
    expect(await within(panel).findByText("indicator-sprint-team.json")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "JSON" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(panel).getByText("3 lines")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Download" }));
    expect(saved).toEqual(["indicator-sprint-team.json"]);
    fireEvent.click(within(panel).getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(JSON_TEXT);
    expect(await screen.findByText("Copied indicator-sprint-team.json")).toBeInTheDocument();
  });
});

describe("App — M4 an imported team (File-Imported)", () => {
  it("shows the toast once, the card with its rows and note, and the Engineer's chips; Hide keeps the chips", async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ fixes: FIXES, note: NOTE, toast: true }));
    renderApp();
    expect(await screen.findByText("Imported as a new team")).toBeInTheDocument();
    const card = await screen.findByRole("region", { name: "Things to fix" });
    expect(card).toHaveTextContent("2 things to fix before shipping");
    expect(card).toHaveTextContent("Sign in to GitHub");
    expect(within(card).getByText("chart-render").tagName).toBe("CODE");
    expect(card).toHaveTextContent(NOTE);
    expect(await screen.findByText("Needs GitHub")).toBeInTheDocument();
    expect(screen.getByText("1 tool missing")).toBeInTheDocument();
    expect(screen.getByText("Needs GitHub").closest(".rf-node")).toHaveClass("rf-node--fix");
    // The toast is spent: a reload won't show it again.
    expect(JSON.parse(sessionStorage.getItem(KEY) ?? "{}")).toMatchObject({ toast: false });

    fireEvent.click(within(card).getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("region", { name: "Things to fix" })).toBeNull();
    expect(screen.getByText("Needs GitHub")).toBeInTheDocument();
    // Hidden, and the spent toast stays spent (a reload shows neither).
    expect(JSON.parse(sessionStorage.getItem(KEY) ?? "{}")).toMatchObject({
      hidden: true,
      toast: false,
    });

    // The toast's Open the file opens the Team file panel.
    fireEvent.click(screen.getByRole("button", { name: "Open the file" }));
    expect(await screen.findByRole("complementary", { name: "Team file" })).toBeInTheDocument();
  });

  it("after a reload of the tab the card and chips come back, without the toast", async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ fixes: FIXES, note: NOTE, toast: false }));
    renderApp();
    expect(await screen.findByRole("region", { name: "Things to fix" })).toBeInTheDocument();
    expect(await screen.findByText("Needs GitHub")).toBeInTheDocument();
    expect(screen.queryByText("Imported as a new team")).toBeNull();
  });

  it("Sign in opens the GitHub App install; Open Toolkit goes to Toolkit › Tools", async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ fixes: FIXES, note: NOTE }));
    renderApp({ github_install_url: "https://github.com/apps/tvashtr/installations/new" });
    const card = await screen.findByRole("region", { name: "Things to fix" });
    fireEvent.click(within(card).getByRole("button", { name: "Sign in" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Install the Tvashtr GitHub App",
    });
    expect(within(dialog).getByRole("button", { name: "Open GitHub" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(card).getByRole("button", { name: "Open Toolkit" }));
    await waitFor(() => expect(window.location.hash).toBe("#/toolkit/tools"));
  });

  it("a team that wasn't imported has no card and no chips", async () => {
    renderApp();
    await screen.findByRole("button", { name: "Team file" });
    expect(screen.queryByRole("region", { name: "Things to fix" })).toBeNull();
    expect(screen.queryByText("Needs GitHub")).toBeNull();
  });
});
