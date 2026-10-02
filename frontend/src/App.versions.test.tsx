import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import App from "./App";
import { ToastProvider } from "./design-system/components";
import type { TeamRunRow } from "./lib/api";
import type { RestorePreview, TeamVersions, VersionDetail } from "./lib/api/versions";

// M5 — team versions on the real <App/> (the control plane stubbed): the header chip (saved /
// changes since vN + Save as vN), History (Versions / Runs) from the chip, What changed and Restore.

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const node = (id: string, role_name: string, kind: string) => ({
  id,
  role_name,
  kind,
  model: "openai/gpt-4o-mini",
  engine: null,
  prompt: null,
  position: { x: 0, y: 0 },
  config: null,
});
const GRAPH = {
  team_graph_id: "team-1",
  name: "Indicator sprint team",
  nodes: [
    node("tn-pm", "pm", "completion"),
    { ...node("tn-rev", "reviewer", "agent"), prompt: "Review it." },
  ],
  edges: [],
};
const ROWS: [number, number, string, number][] = [
  [7, 2, "Reviewer: stricter about the INDICATORS registry", 1],
  [6, 1440, "Added the Spec approval gate", 3],
  [5, 3 * 1440, "Engineer: model changed to Claude Sonnet 4", 2],
  [4, 5 * 1440, "Engineer: added a backup model", 4],
  [3, 8 * 1440, "Imported from a team file", 0],
  [2, 9 * 1440, "Engineer: instructions changed", 0],
  [1, 10 * 1440, "First version", 0],
];
const versions = (changes = 0, current = 7): TeamVersions => ({
  current,
  saved_at: ago(2),
  changes,
  next: current + 1,
  total: ROWS.length,
  versions: ROWS.map(([number, minutes, summary, runs]) => ({
    number,
    created_at: ago(minutes),
    author: "you",
    summary,
    note: null,
    runs,
    source: "save",
    restored_from: null,
  })),
});
const LINES: VersionDetail["changes"][number]["lines"] = [
  { op: "context", text: "3. Compare the build with the spec, item by item." },
  { op: "removed", text: "4. Approve when the tests pass." },
  { op: "added", text: "4. Fail the round if any new indicator is not registered on INDICATORS." },
  { op: "added", text: "5. Approve only when the tests pass and every spec item is met." },
];
const TEXT_ROW = {
  key: "node:tn-rev:prompt",
  node_id: "tn-rev",
  agent: "Reviewer",
  role: "reviewer",
  field: "Instructions",
  kind: "text" as const,
  removed: 1,
  added: 2,
  lines: LINES,
};
const V7: VersionDetail = {
  number: 7,
  created_at: ago(2),
  author: "you",
  summary: ROWS[0][2],
  note: null,
  source: "save",
  restored_from: null,
  current: true,
  compared_with: 6,
  changes: [
    TEXT_ROW,
    {
      key: "node:tn-eng:model",
      agent: "Engineer",
      role: "engineer",
      field: "Model",
      kind: "value",
      before: "a",
      after: "b",
    },
  ],
  same: ["models", "routes", "gates", "budget"],
  runs: [{ run_id: "r12", number: 12, idea: "Add an RSI indicator", status: "completed" }],
};
// Ver-ChangesFields: v6 (not the current version) — a gate added, the routes, a model, skills, the
// budget (a team field).
const V6: VersionDetail = {
  ...V7,
  number: 6,
  created_at: ago(1440),
  current: false,
  compared_with: 5,
  changes: [
    {
      key: "team:budget_usd",
      agent: null,
      field: "Budget",
      kind: "value",
      before: "$5.00",
      after: "$8.00",
    },
    {
      key: "node:tn-prd",
      agent: "Spec approval",
      role: "prd_gate",
      field: null,
      kind: "added",
      gate: true,
    },
    {
      key: "route:1",
      agent: null,
      field: "Routes",
      kind: "added",
      text: "Product manager → Spec approval",
    },
    {
      key: "route:2",
      agent: null,
      field: "Routes",
      kind: "removed",
      text: "Product manager → Engineer",
    },
    {
      key: "route:3",
      agent: null,
      field: "Routes",
      kind: "added",
      text: "Spec approval → Engineer · when approved",
    },
    {
      key: "node:tn-eng:model",
      agent: "Engineer",
      role: "engineer",
      field: "Model",
      kind: "value",
      before: "openai/gpt-4.1-mini",
      after: "anthropic/claude-sonnet-4",
    },
    {
      key: "node:tn-eng:skills",
      agent: "Engineer",
      role: "engineer",
      field: "Skills",
      kind: "changed",
    },
  ],
  same: ["budget"],
  runs: [{ run_id: "r11", number: 11, idea: "Add a VWAP indicator", status: "failed" }],
};
const PREVIEW: RestorePreview = {
  number: 6,
  makes: 8,
  current: 7,
  draft_saved_as: null,
  changes: [TEXT_ROW],
};
const run = (
  n: number,
  status: string,
  v: number,
  idea: string,
  extra: Partial<TeamRunRow>,
): TeamRunRow => ({
  run_id: `r${n}`,
  number: n,
  status,
  team_version_number: v,
  idea,
  created_at: ago(60),
  updated_at: ago(38),
  cost_total_usd: 0,
  spent_usd: 1.12,
  ...extra,
});
const RUNS = [
  run(12, "completed", 7, "Add an RSI indicator", { pr_number: 42, pr_url: "https://x/42" }),
  run(11, "failed", 6, "Add a VWAP indicator", { resumed_as: 13 }),
  run(9, "cancelled", 6, "Add an ATR indicator", {}),
];

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Fetch>;
let summary: TeamVersions;
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const calls = (method: string, url: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? "GET") === method)
    .length;

beforeEach(() => {
  window.location.hash = "";
  summary = versions();
  fetchMock = vi.fn<Fetch>((url, init) => {
    const method = init?.method ?? "GET";
    if (url === "/api/teams") return reply({ teams: [{ team_graph_id: "team-1", name: "x" }] });
    if (url === "/api/teams/team-1/graph") return reply(GRAPH);
    if (url === "/api/teams/team-1/validate")
      return reply({ errors: [], warnings: [], runnable: true });
    if (url === "/api/teams/team-1/versions" && method === "POST") {
      summary = { ...versions(0, 8), saved_at: ago(0) };
      return reply({ number: 8 }, 201);
    }
    if (url === "/api/teams/team-1/versions") return reply(summary);
    if (url === "/api/teams/team-1/versions/7") return reply(V7);
    if (url === "/api/teams/team-1/versions/6") return reply(V6);
    if (url === "/api/teams/team-1/versions/6/restore" && method === "POST") {
      summary = { ...versions(0, 8), saved_at: ago(0) };
      return reply({ number: 8, restored_from: 6, draft_saved_as: null }, 201);
    }
    if (url === "/api/teams/team-1/versions/6/restore") return reply(PREVIEW);
    if (url === "/api/teams/team-1/runs") return reply({ runs: RUNS });
    if (url === "/api/teams/team-1/file?format=yaml")
      return reply({ filename: "t.yaml", format: "yaml", content: "a: 1", lines: 1, needs: {} });
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

const renderApp = () =>
  render(
    <ToastProvider>
      <App teamId="team-1" onBackToDashboard={vi.fn()} />
    </ToastProvider>,
  );
const chip = () => screen.findByRole("button", { name: "Version history" });
const openHistory = async () => {
  fireEvent.click(await chip());
  return screen.findByRole("complementary", { name: "History" });
};

describe("App — M5 the version chip", () => {
  it("reads 'v7 · saved 2m ago' right after the team name, beside the kept toolbar", async () => {
    renderApp();
    const button = await chip();
    expect(button).toHaveTextContent("v7· saved 2m ago");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).not.toHaveClass("cv-ver--draft");
    expect(screen.queryByRole("button", { name: /^Save as/ })).toBeNull();
    // Right after the team's name.
    expect(screen.getByText("Indicator sprint team").nextElementSibling).toBe(button);
    const toolbar = screen.getByRole("toolbar", { name: "Team" });
    for (const name of ["Back to teams", "Run this team", "Team file"])
      expect(within(toolbar).getByRole("button", { name })).toBeInTheDocument();
    expect(within(toolbar).getByText("$0.00")).toBeInTheDocument();
    expect(within(toolbar).getByText("Connected")).toBeInTheDocument();
  });

  it("with changes: the amber '· 2 changes since v7' and Save as v8, which saves and reloads", async () => {
    summary = versions(2);
    renderApp();
    const button = await chip();
    expect(button).toHaveTextContent("v7· 2 changes since v7");
    expect(button).toHaveClass("cv-ver--draft");
    fireEvent.click(screen.getByRole("button", { name: "Save as v8" }));
    await waitFor(() => expect(calls("POST", "/api/teams/team-1/versions")).toBe(1));
    expect(await screen.findByText("· saved just now")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Version history" })).toHaveTextContent("v8");
    expect(screen.queryByRole("button", { name: /^Save as/ })).toBeNull();
  });

  it("one change reads '· 1 change since v7'", async () => {
    summary = versions(1);
    renderApp();
    expect(await chip()).toHaveTextContent("· 1 change since v7");
  });
});

describe("App — M5 with the agent drawer open", () => {
  const openReviewer = async () => {
    fireEvent.click((await screen.findAllByTitle("Set this node’s model"))[1]);
    return screen.findByRole("complementary", { name: /settings$/ });
  };

  it("Save as v8 asks about the drawer's unsaved draft first, then saves", async () => {
    summary = versions(2);
    renderApp();
    const drawer = await openReviewer();
    fireEvent.change(within(drawer).getByRole("textbox", { name: /^Instructions/ }), {
      target: { value: "A new text." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save as v8" }));
    const ask = within(drawer).getByRole("alertdialog", { name: "Unsaved changes" });
    expect(calls("POST", "/api/teams/team-1/versions")).toBe(0);
    fireEvent.click(within(ask).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(calls("POST", "/api/teams/team-1/versions")).toBe(1));
  });

  it("History closes the drawer, and opening an agent closes History", async () => {
    renderApp();
    await openReviewer();
    await openHistory();
    expect(screen.queryByRole("complementary", { name: /settings$/ })).toBeNull();
    await openReviewer();
    expect(screen.queryByRole("complementary", { name: "History" })).toBeNull();
  });
});

describe("App — M5 History", () => {
  it("the chip opens and closes History; the chip is coral while it is open", async () => {
    renderApp();
    const panel = await openHistory();
    const button = await chip();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveClass("cv-ver--open");
    expect(panel).toHaveTextContent("Every save is a version. Nothing is ever deleted.");
    expect(panel).toHaveTextContent(
      "Edits stay a draft until you save. Starting a run saves them first, so every run has a version.",
    );
    fireEvent.click(button);
    expect(screen.queryByRole("complementary", { name: "History" })).toBeNull();
    await openHistory();
    fireEvent.click(
      within(screen.getByRole("complementary", { name: "History" })).getByRole("button", {
        name: "Close",
      }),
    );
    expect(screen.queryByRole("complementary", { name: "History" })).toBeNull();
  });

  it("History and Team file never show together", async () => {
    renderApp();
    await openHistory();
    fireEvent.click(screen.getByRole("button", { name: "Team file" }));
    expect(await screen.findByRole("complementary", { name: "Team file" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "History" })).toBeNull();
    await openHistory();
    expect(screen.queryByRole("complementary", { name: "Team file" })).toBeNull();
  });

  it("Versions: five rows, Now on v7, runs pills, Restore on the older ones, then Show 2 older versions", async () => {
    renderApp();
    const panel = await openHistory();
    expect(within(panel).getByRole("button", { name: "Versions" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await within(panel).findByText("5 of 7 versions")).toBeInTheDocument();
    const rows = within(panel).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("v7Now2m ago · you");
    expect(rows[0]).toHaveTextContent("Reviewer: stricter about the INDICATORS registry");
    expect(rows[0]).toHaveTextContent("1 run");
    expect(within(rows[0]).queryByRole("button", { name: "Restore" })).toBeNull();
    expect(rows[1]).toHaveTextContent("v6yesterday · you");
    expect(rows[1]).toHaveTextContent("3 runs");
    expect(rows[2]).toHaveTextContent("3 days ago");
    expect(rows[4]).toHaveTextContent("1 week ago · you");
    expect(rows[4]).toHaveTextContent("no runs");
    expect(within(panel).getAllByRole("button", { name: "Restore" })).toHaveLength(4);
    expect(within(panel).getAllByRole("button", { name: "What changed" })).toHaveLength(5);

    fireEvent.click(within(panel).getByRole("button", { name: "Show 2 older versions" }));
    expect(within(panel).getAllByRole("listitem")).toHaveLength(7);
    expect(within(panel).getByText("7 versions")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /older versions/ })).toBeNull();
  });

  it("Runs: each run with its version tag and meta line; the version filter", async () => {
    renderApp();
    const panel = await openHistory();
    fireEvent.click(within(panel).getByRole("button", { name: "Runs" }));
    expect(
      await within(panel).findByText(
        "Each run keeps the version it started with, even if you change the team later.",
      ),
    ).toBeInTheDocument();
    const rows = await within(panel).findAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(
      "run #12Donev7Add an RSI indicator22m · $1.12 · pull request #42",
    );
    expect(rows[1]).toHaveTextContent(
      "run #11Failedv6Add a VWAP indicator22m · $1.12 · resumed as #13",
    );
    expect(rows[2]).toHaveTextContent(
      "run #9Stoppedv6Add an ATR indicator22m · $1.12 · stopped by you",
    );
    const filter = within(panel).getByRole("combobox", { name: "Version" });
    expect(
      within(filter)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All versions", "v7", "v6"]);
    fireEvent.change(filter, { target: { value: "6" } });
    expect(within(panel).getAllByRole("listitem")).toHaveLength(2);
    expect(within(panel).queryByText("Add an RSI indicator")).toBeNull();
  });
});

describe("App — M5 What changed and Restore", () => {
  it("What changed in v7: the instructions diff, the unchanged line, its runs and the footer", async () => {
    renderApp();
    const panel = await openHistory();
    await within(panel).findByText("5 of 7 versions");
    fireEvent.click(within(panel).getAllByRole("button", { name: "What changed" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "What changed in v7" });
    expect(
      await within(dialog).findByText("Compared with v6 · saved 2 minutes ago by you"),
    ).toBeInTheDocument();
    const section = within(dialog).getByRole("region", { name: "Reviewer › Instructions" });
    expect(section).toHaveTextContent("1 removed, 2 added");
    expect(within(section).getByText("4. Approve when the tests pass.").parentElement).toHaveClass(
      "cv-diff__row--removed",
    );
    expect(
      within(section).getByText("5. Approve only when the tests pass and every spec item is met.")
        .parentElement,
    ).toHaveClass("cv-diff__row--added");
    // Each change gets its section, in the server's order (Ver-ChangesFields draws the others).
    expect(
      within(dialog)
        .getAllByRole("region")
        .map((s) => s.getAttribute("aria-label")),
    ).toEqual(["Reviewer › Instructions", "Engineer › Model"]);
    expect(dialog).toHaveTextContent(
      "Nothing else changed: models, routes, gates and budget are the same as v6.",
    );
    expect(dialog).toHaveTextContent("Runs on v7");
    expect(dialog).toHaveTextContent("run #12 · Add an RSI indicator");
    expect(within(dialog).getByText("Done")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("v7 is your current version");
    expect(within(dialog).queryByRole("button", { name: /Compare/ })).toBeNull();

    // Restore v6 opens the Restore dialog for v6.
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore v6" }));
    expect(await screen.findByRole("dialog", { name: "Restore v6?" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "What changed in v7" })).toBeNull();
  });

  it("What changed in v6 (Ver-ChangesFields): gates, routes, models, skills, the budget", async () => {
    renderApp();
    const panel = await openHistory();
    await within(panel).findByText("5 of 7 versions");
    fireEvent.click(within(panel).getAllByRole("button", { name: "What changed" })[1]);
    const dialog = await screen.findByRole("dialog", { name: "What changed in v6" });
    expect(await within(dialog).findByText(/^Compared with v5 · saved/)).toBeInTheDocument();
    const sections = within(dialog).getAllByRole("region");
    expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Budget",
      "Spec approval › Gate",
      "Routes",
      "Engineer › Model",
      "Engineer › Skills",
    ]);
    const [budget, gate, routes, model, skills] = sections;
    expect(budget).toHaveTextContent("changed");
    expect(budget.querySelector(".lucide-users")).not.toBeNull();
    expect(gate).toHaveTextContent("added");
    expect(gate.querySelector(".cv-diff")).toBeNull();
    expect(gate.querySelector(".lucide-shield-check")).not.toBeNull();
    expect(routes).toHaveTextContent("2 added, 1 removed");
    expect(
      [...routes.querySelectorAll(".cv-diff__row")].map((r) => [r.className, r.textContent]),
    ).toEqual([
      ["cv-diff__row cv-diff__row--added", "+Product manager → Spec approval"],
      ["cv-diff__row cv-diff__row--added", "+Spec approval → Engineer · when approved"],
      ["cv-diff__row cv-diff__row--removed", "−Product manager → Engineer"],
    ]);
    expect(model).toHaveTextContent("changed");
    expect(
      [...model.querySelectorAll(".cv-diff__row")].map((r) => [r.className, r.textContent]),
    ).toEqual([
      ["cv-diff__row cv-diff__row--removed", "−openai/gpt-4.1-mini"],
      ["cv-diff__row cv-diff__row--added", "+anthropic/claude-sonnet-4"],
    ]);
    expect(skills).toHaveTextContent("changed");
    expect(skills.querySelector(".cv-diff")).toBeNull();
    expect(dialog).toHaveTextContent("Nothing else changed: budget is the same as v5.");
    expect(dialog).toHaveTextContent("run #11 · Add a VWAP indicator");
    expect(within(dialog).getByText("Failed")).toBeInTheDocument();
    // Not the current version: the footer still names the current one; Restore v5.
    expect(dialog).toHaveTextContent("v7 is your current version");
    expect(within(dialog).getByRole("button", { name: "Restore v5" })).toBeInTheDocument();
  });

  it("Restore v6?: what changes, the runs callout, then Restore as v8 restores and reloads", async () => {
    renderApp();
    const panel = await openHistory();
    await within(panel).findByText("5 of 7 versions");
    fireEvent.click(within(panel).getAllByRole("button", { name: "Restore" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Restore v6?" });
    expect(
      await within(dialog).findByText(
        "Restoring makes a new version, v8, that matches v6. v7 stays in History, so you can switch back at any time.",
      ),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent("What changes");
    expect(dialog).toHaveTextContent("Reviewer › Instructions go back to the v6 text");
    expect(dialog).toHaveTextContent("1 change. Everything else is already the same.");
    expect(dialog).toHaveTextContent("Runs that are going keep their version");
    expect(dialog).toHaveTextContent("A run started on v7 finishes on v7. New runs use v8.");
    const graphLoads = calls("GET", "/api/teams/team-1/graph");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore as v8" }));
    await waitFor(() => expect(calls("POST", "/api/teams/team-1/versions/6/restore")).toBe(1));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Restore v6?" })).toBeNull());
    await waitFor(() => expect(calls("GET", "/api/teams/team-1/graph")).toBe(graphLoads + 1));
    expect(await screen.findByText("· saved just now")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Version history" })).toHaveTextContent("v8");
  });

  it("Cancel closes the Restore dialog and keeps History", async () => {
    renderApp();
    const panel = await openHistory();
    await within(panel).findByText("5 of 7 versions");
    fireEvent.click(within(panel).getAllByRole("button", { name: "Restore" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Restore v6?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Restore v6?" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "History" })).toBeInTheDocument();
    expect(calls("POST", "/api/teams/team-1/versions/6/restore")).toBe(0);
  });
});
