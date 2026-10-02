import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import type { ImportCheck } from "../../lib/api/teams";
import { HomeContext, type HomeContextValue } from "./homeContext";
import { ImportTeamDialog } from "./ImportTeamDialog";
import { NewTeamDialog } from "./NewTeamDialog";

// M4 — Home › New team › Import a team file (File-NewMenu), then the check before anything changes
// (File-Check), a file that can't be read (File-CheckError) and Import as a new team.

const YAML = "name: Indicator sprint team\nagents:\n  - id: pm\n";
/** jsdom's File has no `text()`; the dialog only reads the name and the text. */
const picked = (name: string, text = YAML) => ({ name, text: () => Promise.resolve(text) }) as File;

const CHECK: ImportCheck = {
  ok: true,
  error: null,
  filename: "indicator-sprint-team.yaml",
  lines: 48,
  name: "Indicator sprint team (copy)",
  counts: { agents: 4, gates: 1, routes: 5 },
  checks: [
    {
      key: "shape",
      tone: "ok",
      title: "4 agents, 1 gate and 5 routes",
      detail: "The canvas will look the same as in the file.",
    },
    {
      key: "tool:chart-render",
      tone: "warn",
      title: "The tool chart-render isn’t in your Toolkit",
      detail: "The Engineer runs without it until you add it or remove it from the team.",
      code: ["chart-render"],
    },
  ],
  fixes: 2,
};
const ERROR = { line: 12, message: "`agents` should be a list of agents." };
const CANT_READ: ImportCheck = {
  ...CHECK,
  ok: false,
  error: ERROR,
  name: "",
  checks: [],
  fixes: 0,
};
const IMPORTED = {
  team_graph_id: "t-copy",
  name: "Indicator sprint team (copy)",
  fixes: [
    {
      key: "tool:chart-render",
      text: "Add chart-render or remove it",
      action: "open_toolkit",
      target: "chart-render",
      node_ids: ["n-eng"],
    },
  ],
  note: "You can run the team now.",
};

const TEMPLATE = {
  template: "two_node",
  name: "PM → Engineer",
  description: "A PM writes the spec; an Engineer builds and ships it.",
  shape: { nodes: [], loops: [] },
};

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const posts = (url: string) =>
  fetchMock.mock.calls
    .filter(([u, i]) => u === url && (i as RequestInit)?.method === "POST")
    .map(([, i]) => JSON.parse((i as RequestInit).body as string) as Record<string, unknown>);

function withHome(ui: React.ReactNode) {
  const reloadTeams = vi.fn(() => Promise.resolve());
  render(
    <ToastProvider>
      <HomeContext.Provider value={{ reloadTeams } as unknown as HomeContextValue}>
        {ui}
      </HomeContext.Provider>
    </ToastProvider>,
  );
  return { reloadTeams };
}

const renderCheck = (file = picked("indicator-sprint-team.yaml")) => {
  const onClose = vi.fn();
  const home = withHome(<ImportTeamDialog file={file} onClose={onClose} />);
  return { onClose, ...home };
};

beforeEach(() => {
  sessionStorage.clear();
  handler = (url) => {
    if (url === "/api/teams/import-check") return json(CHECK);
    if (url === "/api/teams/import") return json(IMPORTED, 201);
    return json({ templates: [TEMPLATE] });
  };
  fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
  sessionStorage.clear();
});

describe("New team › Import a team file", () => {
  it("is offered beside the starting points and opens the file picker; the picked file goes on", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const onImportFile = vi.fn();
    withHome(<NewTeamDialog open onClose={vi.fn()} onImportFile={onImportFile} />);
    const dialog = screen.getByRole("dialog", { name: "New team" });
    await within(dialog).findByRole("button", { name: /PM → Engineer/ });
    const row = within(dialog).getByRole("button", { name: /Import a team file/ });
    expect(row).toHaveTextContent(".yaml or .json");
    expect(
      within(within(dialog).getByRole("group", { name: "Starting point" })).queryByRole("button", {
        name: /Import a team file/,
      }),
    ).toBeNull();
    fireEvent.click(row);
    const input = screen.getByTestId<HTMLInputElement>("import-team-input");
    expect(click.mock.contexts).toContain(input);
    expect(input.accept).toBe(".yaml,.yml,.json");
    const file = picked("indicator-sprint-team.yaml");
    fireEvent.change(input, { target: { files: [file] } });
    expect(onImportFile).toHaveBeenCalledWith(file);
    // The existing dialog is unchanged: its name, starting points and Create team are all there.
    expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create team" })).toBeInTheDocument();
  });

  it("is not offered when nothing takes the file", async () => {
    withHome(<NewTeamDialog open onClose={vi.fn()} />);
    await screen.findByRole("button", { name: /PM → Engineer/ });
    expect(screen.queryByRole("button", { name: /Import a team file/ })).toBeNull();
  });
});

describe("Import a team file — the check", () => {
  it("checks the file first: its lines, the suggested name, what we checked with code, the fixes", async () => {
    renderCheck();
    const dialog = screen.getByRole("dialog", { name: "Import a team file" });
    expect(dialog).toHaveTextContent(
      "Tvashtr checks the file first. Nothing changes until you choose Import.",
    );
    expect(await within(dialog).findByText("48 lines")).toBeInTheDocument();
    expect(posts("/api/teams/import-check")).toEqual([
      { content: YAML, filename: "indicator-sprint-team.yaml" },
    ]);
    expect(within(dialog).getByLabelText("Team name")).toHaveValue("Indicator sprint team (copy)");
    const list = within(dialog).getByRole("list", { name: "What we checked" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByLabelText("OK")).toBeInTheDocument();
    expect(within(rows[1]).getByLabelText("To fix")).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("The tool chart-render isn’t in your Toolkit");
    expect(within(rows[1]).getByText("chart-render").tagName).toBe("CODE");
    expect(dialog).toHaveTextContent("2 things to fix after importing");
    expect(within(dialog).getByRole("button", { name: "Import as a new team" })).toBeEnabled();
  });

  it("Choose another picks a new file and checks it again", async () => {
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    renderCheck();
    const dialog = screen.getByRole("dialog", { name: "Import a team file" });
    await within(dialog).findByText("48 lines");
    fireEvent.click(within(dialog).getByRole("button", { name: "Choose another" }));
    fireEvent.change(screen.getByTestId("import-another-input"), {
      target: { files: [picked("docs-team.json", "{}")] },
    });
    expect(await within(dialog).findByText("docs-team.json")).toBeInTheDocument();
    await waitFor(() => expect(posts("/api/teams/import-check")).toHaveLength(2));
    expect(posts("/api/teams/import-check")[1]).toEqual({
      content: "{}",
      filename: "docs-team.json",
    });
  });

  it("Import creates the new team, keeps its fixes for the canvas and opens it", async () => {
    const { onClose, reloadTeams } = renderCheck();
    const dialog = screen.getByRole("dialog", { name: "Import a team file" });
    const name = await within(dialog).findByLabelText("Team name");
    fireEvent.change(name, { target: { value: "  Indicator sprint team (mine) " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Import as a new team" }));
    await waitFor(() => expect(window.location.hash).toBe("#/teams/t-copy"));
    expect(posts("/api/teams/import")).toEqual([
      { content: YAML, name: "Indicator sprint team (mine)" },
    ]);
    expect(onClose).toHaveBeenCalled();
    expect(reloadTeams).toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem("tvashtr.teamImport.t-copy") ?? "null")).toEqual({
      fixes: IMPORTED.fixes,
      note: IMPORTED.note,
      toast: true,
    });
  });

  it("a blank name says so and sends nothing", async () => {
    renderCheck();
    const dialog = screen.getByRole("dialog", { name: "Import a team file" });
    fireEvent.change(await within(dialog).findByLabelText("Team name"), {
      target: { value: "  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Import as a new team" }));
    expect(
      await within(dialog).findByText("Give this team a name so you can tell it apart."),
    ).toBeInTheDocument();
    expect(posts("/api/teams/import")).toEqual([]);
  });

  it("a file that can't be read names the line; nothing changes and Import is off", async () => {
    handler = () => json(CANT_READ);
    renderCheck();
    const dialog = screen.getByRole("dialog", { name: "Import a team file" });
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("This file can’t be imported");
    expect(alert).toHaveTextContent("Line 12: agents should be a list of agents.");
    expect(within(alert).getByText("agents").tagName).toBe("CODE");
    expect(alert).toHaveTextContent("Nothing was changed. Fix the file, or choose another.");
    expect(within(dialog).getByText("Can’t be read · 48 lines")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Team name")).toBeNull();
    expect(dialog).toHaveTextContent("Nothing changed");
    expect(within(dialog).getByRole("button", { name: "Import as a new team" })).toBeDisabled();
  });

  it("a 422 on Import shows the file's error in the dialog, never silently", async () => {
    handler = (url) =>
      url === "/api/teams/import-check"
        ? json(CHECK)
        : json({ detail: { error: { line: 3, message: "`routes` should be a list." } } }, 422);
    renderCheck();
    const dialog = screen.getByRole("dialog", { name: "Import a team file" });
    await within(dialog).findByLabelText("Team name");
    fireEvent.click(within(dialog).getByRole("button", { name: "Import as a new team" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("This file can’t be imported");
    expect(alert).toHaveTextContent("Line 3: routes should be a list.");
    expect(within(dialog).getByRole("button", { name: "Import as a new team" })).toBeDisabled();
    expect(window.location.hash).toBe("");
  });

  it("a failed check or import says so", async () => {
    handler = () => json({ detail: "boom" }, 500);
    renderCheck();
    const dialog = screen.getByRole("dialog", { name: "Import a team file" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn’t check the file — is the backend running?",
    );

    handler = (url) => (url === "/api/teams/import-check" ? json(CHECK) : json({}, 500));
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.change(screen.getByTestId("import-another-input"), {
      target: { files: [picked("indicator-sprint-team.yaml")] },
    });
    await within(dialog).findByLabelText("Team name");
    fireEvent.click(within(dialog).getByRole("button", { name: "Import as a new team" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn’t import the team — is the backend running?",
    );
    expect(within(dialog).getByRole("button", { name: "Import as a new team" })).toBeEnabled();
  });

  it("a file that can't be read once picked says so instead of checking forever", async () => {
    handler = () => json(CHECK);
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    renderCheck();
    const dialog = screen.getByRole("dialog", { name: "Import a team file" });
    await within(dialog).findByLabelText("Team name");
    const gone = {
      name: "moved.yaml",
      text: () => Promise.reject(new DOMException("gone", "NotReadableError")),
    } as File;
    fireEvent.change(screen.getByTestId("import-another-input"), { target: { files: [gone] } });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn’t check the file — is the backend running?",
    );
    expect(within(dialog).queryByText("Checking…")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Import as a new team" })).toBeDisabled();
  });

  it("Cancel and Escape close it", async () => {
    const { onClose } = renderCheck();
    const dialog = screen.getByRole("dialog", { name: "Import a team file" });
    await within(dialog).findByText("48 lines");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
