import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { Compare, CompareStart, SetCell, TaskSet } from "../../lib/api/compare";
import { useNav } from "../../lib/nav";
import { ComparePage } from "./ComparePage";

// M9 — task sets on the Compare page (Quality › Set-List, Set-Empty, Set-RowMenu, Set-DeleteConfirm,
// Set-Edit, Set-AddRecent, Cmp-Start's "One task | A task set", Set-StartSet, Set-Running,
// Set-Results and Cmp-Results' "One task is a small sample"), the control plane stubbed.

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const item = (task: string, check: string, starts_from: string | null = "main") => ({
  task,
  starts_from,
  hidden_check: check,
});
const INDICATORS: TaskSet = {
  id: "set-ind",
  name: "Indicators",
  items: [
    item("Add an RSI indicator", "pytest -q tests/test_indicators.py -k rsi"),
    item("Add a MACD indicator", "pytest -q -k macd"),
    item("Add Bollinger bands", "pytest -q -k bollinger"),
    item("Add an ATR indicator", "pytest -q -k atr"),
    item("Fix the EMA warm-up", "pytest -q -k ema_warmup"),
  ],
  last_used: { compare_id: "cmp-7", a: 6, b: 7, at: ago(2 * 1440), summary: "v7 better on 4 of 5" },
  estimate: { cost_usd: 5.6, minutes: 40 },
};
const BUGFIXES: TaskSet = {
  id: "set-bug",
  name: "Bugfixes",
  items: [
    item("Fix the flaky login test", "pytest -q -k login", null),
    item("Stop double-counting fees", "pytest -q -k fees"),
    item("Handle an empty price list", "pytest -q -k empty"),
  ],
  last_used: null,
  estimate: null,
};
const START: CompareStart = {
  team: { id: "team-1", name: "Indicator sprint team" },
  versions: [
    { number: 7, when: ago(0), runs: 1, summary: "Reviewer: stricter", current: true },
    {
      number: 6,
      when: ago(1440),
      runs: 3,
      summary: "Added the Spec approval gate",
      current: false,
    },
  ],
  defaults: { a: 6, b: 7 },
  changes: 1,
  target: { repo: "lazyxgenius/trade_mcp", base_ref: "main" },
  estimate: { cost_usd: 2.3, minutes: 25 },
  latest: null,
  task_sets: [
    { id: "set-ind", name: "Indicators", count: 5 },
    { id: "set-bug", name: "Bugfixes", count: 3 },
  ],
};

const cell = (over: Partial<SetCell> = {}): SetCell => ({
  run_id: null,
  status: "waiting",
  now: null,
  check: null,
  rounds: 0,
  cost_usd: 0,
  note: null,
  ...over,
});
const done = (run_id: string, rounds: number, cost_usd: number, over: Partial<SetCell> = {}) =>
  cell({ run_id, status: "finished", check: "passed", rounds, cost_usd, ...over });
const BASE: Compare = {
  id: "cmp-2",
  team_id: "team-1",
  task: "Indicators",
  auto_approve: true,
  status: "running",
  elapsed_s: 725,
  cost_usd: 3.1,
  created_at: ago(12),
  ended_at: null,
  waiting: null,
  runs_waiting: 4,
  sides: [
    {
      label: "A",
      version: 6,
      run_id: null,
      number: null,
      status: "running",
      elapsed_s: 725,
      cost_usd: 1.5,
      strip: [],
      current: null,
      lines: [],
      gate_task_id: null,
    },
    {
      label: "B",
      version: 7,
      run_id: null,
      number: null,
      status: "running",
      elapsed_s: 725,
      cost_usd: 1.6,
      strip: [],
      current: null,
      lines: [],
      gate_task_id: null,
    },
  ],
  results: null,
  set: { id: "set-ind", name: "Indicators", count: 5 },
  started: 6,
};
const SET_RUNNING: Compare = {
  ...BASE,
  items: [
    {
      task: "Add an RSI indicator",
      a: cell({ run_id: "run-rsi-a", status: "running", now: "Engineer · round 2" }),
      b: done("run-rsi-b", 2, 0.92),
      badge: null,
    },
    {
      task: "Add a MACD indicator",
      a: done("run-macd-a", 3, 1.21, { check: "failed", note: "signal line missing" }),
      b: cell({ run_id: "run-macd-b", status: "running", now: "Engineer · round 2" }),
      badge: null,
    },
    { task: "Add an ATR indicator", a: cell(), b: cell(), badge: null },
  ],
};
const SET_RESULTS: Compare = {
  ...BASE,
  status: "finished",
  cost_usd: 11.3,
  ended_at: ago(6),
  waiting: null,
  runs_waiting: 0,
  started: 10,
  items: [
    {
      task: "Add an RSI indicator",
      a: done("run-rsi-a", 4, 1.48),
      b: done("run-rsi-b", 2, 0.92),
      badge: "v7 better",
    },
    {
      task: "Add an ATR indicator",
      a: done("run-atr-a", 4, 1.39, {
        status: "failed",
        check: null,
        note: "stalled, then resumed",
      }),
      b: done("run-atr-b", 3, 1.2),
      badge: "v7 better",
    },
    {
      task: "Fix the EMA warm-up",
      a: done("run-ema-a", 3, 0.92),
      b: done("run-ema-b", 2, 1.08),
      badge: "v7 costs more",
    },
  ],
  results: {
    headline: "v7 did better on this set",
    rows: [],
    current_version: 7,
    restore: 6,
    cards: [
      {
        key: "checks",
        label: "Hidden checks passed",
        a: "3 of 5",
        b: "5 of 5",
        note: "2 more tasks really work",
        tone: "good",
      },
      {
        key: "rounds",
        label: "Rounds per task",
        a: "3.4",
        b: "2.2",
        note: "about 1 fewer round",
        tone: "good",
      },
      {
        key: "cost",
        label: "Cost",
        a: "$6.10",
        b: "$5.20",
        note: "$0.90 more in all",
        tone: "warn",
      },
      { key: "retries", label: "Retries and stalls", a: "3", b: "3", note: "same", tone: null },
    ],
  },
};
const ONE_RESULTS: Compare = {
  ...BASE,
  id: "cmp-1",
  task: "Add an RSI indicator",
  status: "finished",
  ended_at: ago(2),
  waiting: null,
  set: null,
  started: undefined,
  sides: BASE.sides.map((s) => ({ ...s, status: "finished", run_id: `run-${s.label}` })),
  results: {
    headline: "v7 did better on this task",
    rows: [
      { key: "cost", label: "Cost", a: "$1.48", b: "$0.92", better: "b", difference: "−$0.56" },
    ],
    current_version: 7,
    restore: 6,
    sample: { set_id: "set-ind", name: "Indicators", count: 5 },
  },
};

let sets: TaskSet[];
let compare: Compare;
let saveReply: { status: number; body: unknown };
let deleteReply: { status: number; body: unknown };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Fetch>;
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }));
const calls = (url: string, method = "GET") =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? "GET") === method);
const bodyOf = (url: string, method: string) =>
  JSON.parse(calls(url, method).at(-1)?.[1]?.body as string) as unknown;

beforeEach(() => {
  sets = [INDICATORS, BUGFIXES];
  compare = SET_RUNNING;
  saveReply = { status: 201, body: { ...BUGFIXES, id: "set-new" } };
  deleteReply = { status: 204, body: null };
  fetchMock = vi.fn<Fetch>((url, init) => {
    const method = init?.method ?? "GET";
    if (url === "/api/teams/team-1/compare" && method === "POST")
      return reply({ id: "cmp-9", status: "running" }, 201);
    if (url === "/api/teams/team-1/compare") return reply(START);
    if (url === "/api/teams/team-1/task-sets" && method === "POST")
      return reply(saveReply.body, saveReply.status);
    if (url === "/api/teams/team-1/task-sets") return reply({ sets });
    if (url.startsWith("/api/task-sets/") && method === "PATCH")
      return reply(saveReply.body, saveReply.status === 201 ? 200 : saveReply.status);
    if (url.startsWith("/api/task-sets/") && method === "DELETE")
      return reply(deleteReply.body, deleteReply.status);
    if (url.startsWith("/api/recent-tasks"))
      return reply({
        tasks: [
          {
            task: "Add a stochastic oscillator",
            team: { id: "team-1" },
            created_at: ago(2 * 1440),
          },
          { task: "Add an RSI indicator", team: { id: "team-1" }, created_at: ago(2 * 1440) },
          { task: "Fix the MACD label", team: { id: "team-2" }, created_at: ago(60) },
          {
            task: "Add VWAP to the indicators list",
            team: { id: "team-1" },
            created_at: ago(2900),
          },
          { task: "Fix the EMA warm-up", team: { id: "team-1" }, created_at: ago(3 * 1440) },
          {
            task: "Retry the price feed on a timeout",
            team: { id: "team-1" },
            created_at: ago(7200),
          },
        ],
      });
    if (/^\/api\/compares\/cmp-\d+$/.test(url)) return reply(compare);
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

function Routed() {
  const { route } = useNav();
  if (route.page !== "compare") return <div>ELSEWHERE {window.location.hash}</div>;
  return <ComparePage teamId={route.teamId} compareId={route.compareId} tab={route.tab} />;
}
const open = (hash = "#/teams/team-1/compare?tab=sets") => {
  window.location.hash = hash;
  return render(<Routed />);
};
const card = (name: string) => screen.getByRole("article", { name });
const dialog = (name: string) => screen.getByRole("dialog", { name });

describe("Task sets — the tab (Set-List)", () => {
  it("the tab and its count; each card's name, tasks, last use and buttons", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Task sets" })).toBeInTheDocument();
    const tab = screen.getByRole("tab", { name: /Task sets/ });
    expect(tab).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(tab).toHaveTextContent("Task sets2"));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Compare",
      "Task sets2",
      "Versions",
    ]);
    expect(
      screen.getByText(
        "A few tasks you care about. Comparing on a set shows whether a change helps in general, not just once.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New task set" })).toBeInTheDocument();

    const ind = await screen.findByRole("article", { name: "Indicators" });
    expect(within(ind).getByText("5 tasks · each has a hidden check")).toBeInTheDocument();
    expect(
      within(ind)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(INDICATORS.items.map((i) => i.task));
    expect(
      within(ind).getByText("Last used: v6 vs v7 · 2 days ago · v7 better on 4 of 5"),
    ).toBeInTheDocument();
    // The most recently used set's Compare is the primary one.
    expect(within(ind).getByRole("button", { name: "Compare on this set" })).toHaveClass(
      "ds-btn--primary",
    );
    expect(within(ind).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(ind).getByRole("button", { name: "More for Indicators" })).toBeInTheDocument();
    // R11: a card never shows a hidden check.
    expect(ind).not.toHaveTextContent("pytest");

    const bug = card("Bugfixes");
    expect(within(bug).getByText("3 tasks · each has a hidden check")).toBeInTheDocument();
    expect(within(bug).getByText("Not used yet")).toBeInTheDocument();
    expect(within(bug).getByRole("button", { name: "Compare on this set" })).toHaveClass(
      "ds-btn--secondary",
    );
  });

  it("Compare on this set opens the Compare tab with A task set and that set chosen", async () => {
    open();
    const bug = await screen.findByRole("article", { name: "Bugfixes" });
    fireEvent.click(within(bug).getByRole("button", { name: "Compare on this set" }));
    await waitFor(() => expect(window.location.hash).toBe("#/teams/team-1/compare"));
    expect(await screen.findByRole("radio", { name: "A task set" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("combobox", { name: "Task set" })).toHaveValue("set-bug");
    expect(screen.getByRole("tab", { name: "Compare" })).toHaveAttribute("aria-selected", "true");
  });

  it("Set-Empty: no sets — the empty card, no count on the tab, New task set opens the dialog", async () => {
    sets = [];
    open();
    expect(await screen.findByRole("heading", { name: "No task sets yet" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Make one from tasks you care about — each with a hidden check that says whether it really works.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Task sets/ })).toHaveTextContent(/^Task sets$/);
    const news = screen.getAllByRole("button", { name: "New task set" });
    expect(news).toHaveLength(2); // the header's and the empty card's (both drawn)
    expect(news[1]).toHaveClass("ds-btn--primary");
    fireEvent.click(news[1]);
    expect(dialog("New task set")).toBeInTheDocument();
  });

  it("Set-RowMenu: the ⋯ menu has Edit and Delete; Edit opens the set", async () => {
    open();
    const ind = await screen.findByRole("article", { name: "Indicators" });
    fireEvent.click(within(ind).getByRole("button", { name: "More for Indicators" }));
    const menu = screen.getByRole("menu", { name: "More for Indicators" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["Edit", "Delete"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Edit" }));
    expect(within(dialog("Edit task set")).getByRole("textbox", { name: "Name" })).toHaveValue(
      "Indicators",
    );
  });

  it("Set-DeleteConfirm: Keep it keeps the set; Delete set deletes it and the list reads again", async () => {
    open();
    const ind = await screen.findByRole("article", { name: "Indicators" });
    fireEvent.click(within(ind).getByRole("button", { name: "More for Indicators" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    let confirm = screen.getByRole("alertdialog", { name: "Delete Indicators?" });
    expect(confirm).toHaveTextContent(
      "Its tasks and hidden checks are removed. Past results stay next to the versions they checked.",
    );
    fireEvent.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls("/api/task-sets/set-ind", "DELETE")).toHaveLength(0);

    fireEvent.click(
      within(card("Indicators")).getByRole("button", { name: "More for Indicators" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    confirm = screen.getByRole("alertdialog", { name: "Delete Indicators?" });
    const reads = calls("/api/teams/team-1/task-sets").length;
    sets = [BUGFIXES];
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete set" }));
    await waitFor(() => expect(calls("/api/task-sets/set-ind", "DELETE")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Indicators" })).toBeNull());
    expect(calls("/api/teams/team-1/task-sets").length).toBeGreaterThan(reads);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("a refused delete says why in the confirm", async () => {
    deleteReply = { status: 409, body: { detail: "A compare on this set is running." } };
    open();
    const ind = await screen.findByRole("article", { name: "Indicators" });
    fireEvent.click(within(ind).getByRole("button", { name: "More for Indicators" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete Indicators?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete set" }));
    expect(await within(confirm).findByRole("alert")).toHaveTextContent(
      "A compare on this set is running.",
    );
  });
});

describe("Task sets — the Edit / New dialog (Set-Edit, Set-AddRecent)", () => {
  it("Edit: the name, the tasks table, the callout and the estimate; Save set PATCHes the whole set", async () => {
    open();
    const ind = await screen.findByRole("article", { name: "Indicators" });
    fireEvent.click(within(ind).getByRole("button", { name: "Edit" }));
    const d = dialog("Edit task set");
    expect(within(d).getByRole("textbox", { name: "Name" })).toHaveValue("Indicators");
    expect(d).toHaveTextContent("Tasks (5)");
    const tasks = within(d).getAllByRole("textbox", { name: "Task" });
    expect(tasks.map((t) => (t as HTMLInputElement).value)).toEqual(
      INDICATORS.items.map((i) => i.task),
    );
    expect(within(d).getAllByRole("textbox", { name: "Starts from" })[0]).toHaveValue("main");
    expect(within(d).getAllByRole("textbox", { name: "Hidden check" })[1]).toHaveValue(
      "pytest -q -k macd",
    );
    expect(within(d).getByText("What a hidden check is")).toBeInTheDocument();
    expect(d).toHaveTextContent(
      "A command Tvashtr runs after each run to see if the task really works. The agents never see it, so they can’t write code just to pass it.",
    );
    expect(d).toHaveTextContent("Comparing two versions on this set: about $5.60 and 40 min");
    expect(within(d).getByRole("button", { name: "Add from recent tasks" })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Add a task" })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    fireEvent.change(tasks[1], { target: { value: "Add a MACD indicator with a signal line" } });
    fireEvent.change(within(d).getAllByRole("textbox", { name: "Starts from" })[2], {
      target: { value: "  " },
    });
    fireEvent.click(within(d).getByRole("button", { name: "Remove Fix the EMA warm-up" }));
    expect(d).toHaveTextContent("Tasks (4)");
    fireEvent.click(within(d).getByRole("button", { name: "Save set" }));
    await waitFor(() => expect(calls("/api/task-sets/set-ind", "PATCH")).toHaveLength(1));
    expect(bodyOf("/api/task-sets/set-ind", "PATCH")).toEqual({
      name: "Indicators",
      items: [
        item("Add an RSI indicator", "pytest -q tests/test_indicators.py -k rsi"),
        item("Add a MACD indicator with a signal line", "pytest -q -k macd"),
        item("Add Bollinger bands", "pytest -q -k bollinger", null),
        item("Add an ATR indicator", "pytest -q -k atr"),
      ],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("New task set: Add a task adds a row; a blank row is left out; Save set posts the set", async () => {
    open();
    await screen.findByRole("article", { name: "Indicators" });
    fireEvent.click(screen.getByRole("button", { name: "New task set" }));
    const d = dialog("New task set");
    expect(within(d).queryAllByRole("textbox", { name: "Task" })).toHaveLength(0);
    expect(d).toHaveTextContent("Tasks (0)");
    expect(d).not.toHaveTextContent("Comparing two versions on this set");
    fireEvent.change(within(d).getByRole("textbox", { name: "Name" }), {
      target: { value: "  Refactors " },
    });
    fireEvent.click(within(d).getByRole("button", { name: "Add a task" }));
    const task = within(d).getAllByRole("textbox", { name: "Task" })[0];
    expect(task).toHaveFocus();
    fireEvent.click(within(d).getByRole("button", { name: "Add a task" }));
    expect(d).toHaveTextContent("Tasks (2)");
    expect(within(d).getAllByRole("textbox", { name: "Task" })[1]).toHaveFocus();
    fireEvent.change(task, { target: { value: "Split the indicators module" } });
    fireEvent.change(within(d).getAllByRole("textbox", { name: "Hidden check" })[0], {
      target: { value: "pytest -q" },
    });
    fireEvent.click(within(d).getByRole("button", { name: "Save set" }));
    await waitFor(() => expect(calls("/api/teams/team-1/task-sets", "POST")).toHaveLength(1));
    expect(bodyOf("/api/teams/team-1/task-sets", "POST")).toEqual({
      name: "Refactors",
      items: [
        { task: "Split the indicators module", starts_from: null, hidden_check: "pytest -q" },
      ],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows the server's words (422 / 409) in the dialog and keeps it open", async () => {
    saveReply = { status: 409, body: { detail: "This team already has a set called Indicators." } };
    open();
    await screen.findByRole("article", { name: "Indicators" });
    fireEvent.click(screen.getByRole("button", { name: "New task set" }));
    const d = dialog("New task set");
    fireEvent.change(within(d).getByRole("textbox", { name: "Name" }), {
      target: { value: "indicators" },
    });
    fireEvent.click(within(d).getByRole("button", { name: "Save set" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent(
      "This team already has a set called Indicators.",
    );
    expect(within(d).getByRole("button", { name: "Save set" })).toBeEnabled();

    saveReply = {
      status: 422,
      body: { detail: "Each task needs a hidden check." },
    };
    fireEvent.click(within(d).getByRole("button", { name: "Save set" }));
    await waitFor(() =>
      expect(within(d).getByRole("alert")).toHaveTextContent("Each task needs a hidden check."),
    );
    expect(dialog("New task set")).toBeInTheDocument();
  });

  it("Cancel closes it and saves nothing", async () => {
    open();
    await screen.findByRole("article", { name: "Indicators" });
    fireEvent.click(screen.getByRole("button", { name: "New task set" }));
    fireEvent.click(within(dialog("New task set")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls("/api/teams/team-1/task-sets", "POST")).toHaveLength(0);
  });

  it("Add from recent tasks: this team's tasks, those in the set ticked and off, Add N adds them", async () => {
    open();
    const ind = await screen.findByRole("article", { name: "Indicators" });
    fireEvent.click(within(ind).getByRole("button", { name: "Edit" }));
    const d = dialog("Edit task set");
    fireEvent.click(within(d).getByRole("button", { name: "Add from recent tasks" }));
    const pop = await within(d).findByRole("dialog", { name: "Add from recent tasks" });
    expect(pop).toHaveTextContent("Recent tasks on this team");
    await within(pop).findByRole("checkbox", { name: "Add a stochastic oscillator" });
    expect(
      within(pop)
        .getAllByRole("checkbox")
        .map((c) => c.closest("li")?.textContent),
    ).toEqual([
      "Add a stochastic oscillator2d ago",
      "Add an RSI indicatorIn the set",
      "Add VWAP to the indicators list2d ago",
      "Fix the EMA warm-upIn the set",
      "Retry the price feed on a timeout5d ago",
    ]);
    const rsi = within(pop).getByRole("checkbox", { name: "Add an RSI indicator" });
    expect(rsi).toBeChecked();
    expect(rsi).toBeDisabled();
    const add = () => within(pop).getByRole("button", { name: /^Add \d+$/ });
    expect(add()).toHaveTextContent("Add 0");
    expect(add()).toBeDisabled();
    fireEvent.click(within(pop).getByRole("checkbox", { name: "Add a stochastic oscillator" }));
    fireEvent.click(within(pop).getByRole("checkbox", { name: "Add VWAP to the indicators list" }));
    expect(add()).toHaveTextContent("Add 2");
    fireEvent.click(add());
    expect(within(d).queryByRole("dialog", { name: "Add from recent tasks" })).toBeNull();
    expect(d).toHaveTextContent("Tasks (7)");
    const tasks = within(d).getAllByRole("textbox", { name: "Task" });
    expect(tasks.slice(-2).map((t) => (t as HTMLInputElement).value)).toEqual([
      "Add a stochastic oscillator",
      "Add VWAP to the indicators list",
    ]);
  });
});

describe("Compare tab — One task | A task set (Cmp-Start, Set-StartSet)", () => {
  it("no task sets: no switch, the task as in M8", async () => {
    sets = [];
    open("#/teams/team-1/compare");
    await screen.findByRole("heading", { name: "Run the same task on two versions" });
    await waitFor(() => expect(calls("/api/teams/team-1/task-sets").length).toBeGreaterThan(0));
    expect(screen.queryByRole("radiogroup", { name: "Run them on" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "A task set" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Task" })).toBeInTheDocument();
  });

  it("A task set: the select, its tasks, the estimate; Start compare posts the set", async () => {
    open("#/teams/team-1/compare");
    const one = await screen.findByRole("radio", { name: "One task" });
    expect(one).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("textbox", { name: "Task" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Task set" })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "A task set" }));
    const select = screen.getByRole("combobox", { name: "Task set" });
    expect(select).toHaveValue("set-ind");
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Indicators · 5 tasks", "Bugfixes · 3 tasks"]);
    expect(screen.queryByRole("textbox", { name: "Task" })).toBeNull();
    const list = screen.getByRole("list", { name: "Tasks in Indicators" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText(/5 tasks × 2 versions/)).toHaveTextContent(
      "About $5.60 on your keys · about 40 min · 5 tasks × 2 versions",
    );
    // Kept: everything M8's start form had around it.
    expect(screen.getByRole("combobox", { name: "Version A" })).toHaveValue("6");
    expect(screen.getByRole("combobox", { name: "Version B" })).toHaveValue("7");
    expect(screen.getByRole("button", { name: "1 change" })).toBeInTheDocument();
    expect(screen.getByText("lazyxgenius/trade_mcp")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Approve gates automatically/ })).toBeChecked();

    fireEvent.change(select, { target: { value: "set-bug" } });
    expect(screen.getByRole("list", { name: "Tasks in Bugfixes" })).toHaveTextContent(
      "Fix the flaky login test",
    );
    expect(screen.getByText(/3 tasks × 2 versions/)).toHaveTextContent(/^3 tasks × 2 versions$/);
    fireEvent.click(screen.getByRole("button", { name: "Start compare" }));
    await waitFor(() => expect(window.location.hash).toBe("#/teams/team-1/compare/cmp-9"));
    expect(bodyOf("/api/teams/team-1/compare", "POST")).toEqual({
      a: 6,
      b: 7,
      task_set_id: "set-bug",
      auto_approve: true,
    });
  });

  it("One task again: the task input comes back and Start posts the task", async () => {
    open("#/teams/team-1/compare");
    fireEvent.click(await screen.findByRole("radio", { name: "A task set" }));
    fireEvent.click(screen.getByRole("radio", { name: "One task" }));
    const task = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add an RSI indicator" } });
    fireEvent.click(screen.getByRole("button", { name: "Start compare" }));
    await waitFor(() => expect(calls("/api/teams/team-1/compare", "POST")).toHaveLength(1));
    expect(bodyOf("/api/teams/team-1/compare", "POST")).toEqual({
      a: 6,
      b: 7,
      task: "Add an RSI indicator",
      auto_approve: true,
    });
  });
});

describe("A set compare (Set-Running, Set-Results)", () => {
  it("running: the header on the set, the started line and each cell's state", async () => {
    open("#/teams/team-1/compare/cmp-2");
    expect(
      await screen.findByRole("heading", { name: "v6 and v7 on Indicators" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("12m 05s · $3.10 so far")).toBeInTheDocument();
    expect(
      screen.getByText("6 of 10 runs started · 4 waiting for a free slot"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop compare" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Version A" })).toBeNull();
    const table = screen.getByRole("table", { name: "Tasks" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Task", "A · v6", "B · v7", ""]);
    const rsi = within(table).getByRole("row", { name: /^Add an RSI indicator/ });
    expect(rsi).toHaveTextContent("Working · Engineer · round 2");
    expect(within(rsi).getByText("Engineer").tagName).toBe("B");
    expect(rsi).toHaveTextContent("2 rounds · $0.92");
    expect(within(rsi).getByTitle("Hidden check passed")).toBeInTheDocument();
    const macd = within(table).getByRole("row", { name: /^Add a MACD indicator/ });
    expect(macd).toHaveTextContent("3 rounds · $1.21signal line missing");
    expect(within(macd).getByTitle("Hidden check failed")).toBeInTheDocument();
    const atr = within(table).getByRole("row", { name: /^Add an ATR indicator/ });
    expect(within(atr).getAllByText("Waiting for a free slot")).toHaveLength(2);
    expect(
      screen.getByText(
        "Gates are approved automatically in this compare. You can leave; it carries on by itself.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(rsi).getByRole("button", { name: /2 rounds/ }));
    expect(window.location.hash).toBe("#/teams/team-1/runs/run-rsi-b");
  });

  it("results: the four cards, the table with each result, its note and badge; Restore and Done", async () => {
    compare = SET_RESULTS;
    open("#/teams/team-1/compare/cmp-2");
    expect(
      await screen.findByRole("heading", { name: "v6 and v7 on Indicators" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("5 tasks · run side by side · finished 6 minutes ago · $11.30 in all"),
    ).toBeInTheDocument();
    expect(screen.getByText("Finished")).toBeInTheDocument();
    const checks = screen.getByRole("group", { name: "Hidden checks passed" });
    expect(checks).toHaveTextContent("v6 3 of 5");
    expect(checks).toHaveTextContent("v7 5 of 5");
    expect(checks).toHaveTextContent("2 more tasks really work");
    for (const label of ["Rounds per task", "Cost", "Retries and stalls"])
      expect(screen.getByRole("group", { name: label })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Cost" })).toHaveTextContent("$0.90 more in all");
    // The note's colour follows its tone: better green, worse amber, neither plain.
    expect(within(checks).getByText("2 more tasks really work")).toHaveClass(
      "cmp-card__note--good",
    );
    expect(screen.getByText("$0.90 more in all")).toHaveClass("cmp-card__note--warn");
    expect(screen.getByText("same", { selector: ".cmp-card__note" }).className).toBe(
      "cmp-card__note",
    );

    const table = screen.getByRole("table", { name: "Results" });
    const rsi = within(table).getByRole("row", { name: /^Add an RSI indicator/ });
    expect(rsi).toHaveTextContent("4 rounds · $1.48");
    expect(within(rsi).getByText("v7 better")).toBeInTheDocument();
    const atr = within(table).getByRole("row", { name: /^Add an ATR indicator/ });
    expect(atr).toHaveTextContent("stalled, then resumed");
    expect(within(atr).getByTitle("Failed")).toBeInTheDocument();
    expect(within(table).getByText("v7 costs more")).toHaveClass("cmp-set__badge--warn");
    // M8's one-task rows are not drawn for a set.
    expect(screen.queryByRole("columnheader", { name: "Difference" })).toBeNull();

    expect(
      screen.getByText("Click any result to open that run. v7 is your current version."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore v6" })).toBeInTheDocument();
    fireEvent.click(within(rsi).getByRole("button", { name: /4 rounds/ }));
    expect(window.location.hash).toBe("#/teams/team-1/runs/run-rsi-a");
  });

  it("Done on a set's results goes back to the canvas", async () => {
    compare = SET_RESULTS;
    open("#/teams/team-1/compare/cmp-2");
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    expect(window.location.hash).toBe("#/teams/team-1");
  });
});

describe("One task is a small sample (Cmp-Results)", () => {
  it("names the set and Compare on it opens the Compare tab with that set", async () => {
    compare = ONE_RESULTS;
    open("#/teams/team-1/compare/cmp-1");
    expect(await screen.findByText("One task is a small sample")).toBeInTheDocument();
    expect(
      screen.getByText("Run the Indicators task set (5 tasks) before you rely on this."),
    ).toBeInTheDocument();
    // Kept: M8's results.
    expect(screen.getByRole("table", { name: "Results" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore v6" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compare on Indicators" }));
    await waitFor(() => expect(window.location.hash).toBe("#/teams/team-1/compare"));
    expect(await screen.findByRole("radio", { name: "A task set" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("combobox", { name: "Task set" })).toHaveValue("set-ind");
  });

  it("no set for the team: no callout", async () => {
    compare = { ...ONE_RESULTS, results: { ...ONE_RESULTS.results!, sample: null } };
    open("#/teams/team-1/compare/cmp-1");
    await screen.findByRole("table", { name: "Results" });
    expect(screen.queryByText("One task is a small sample")).toBeNull();
  });
});
