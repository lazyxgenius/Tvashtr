import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecentTask } from "../../lib/api/myAgents";
import {
  type Call,
  homeRoutes,
  jsonError,
  mockApi,
  renderHome,
  resetHomeState,
} from "./homeTestUtils";
import { requestComposerPrefill } from "./homeData";

// M6 Agents-Recent: Home's composer shows Recent tasks as you type (≥ 2 characters); ↑ ↓ choose,
// Enter uses the chosen one (task + its team), Esc closes it until the next keystroke. Every
// existing composer control stays.

beforeEach(() => resetHomeState());
afterEach(() => {
  vi.unstubAllGlobals();
  resetHomeState();
});

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const task = (
  text: string,
  status: string,
  number: number,
  minutes: number,
  team = { id: "t-ind", name: "Indicator sprint team" },
): RecentTask => ({
  task: text,
  team,
  status,
  status_group: status,
  run_id: `r${number}`,
  number,
  created_at: ago(minutes),
});
const TASKS = [
  task("Add an RSI indicator", "completed", 12, 120),
  task("Add a MACD indicator", "running", 14, 0),
  task("Add a VWAP indicator", "failed", 11, 1500),
  task("Add an ATR indicator", "cancelled", 9, 4 * 1440 + 30),
];

function setup(reply: unknown = { tasks: TASKS }) {
  const calls: Call[] = mockApi(homeRoutes({ "GET /api/recent-tasks": reply }));
  renderHome();
  return calls;
}
const ideaBox = () =>
  screen.findByRole<HTMLTextAreaElement>("textbox", { name: "What should the team build?" });
// A person types into the focused box.
const type = (box: HTMLElement, value: string) => {
  if (document.activeElement !== box) act(() => box.focus());
  fireEvent.change(box, { target: { value } });
};
const list = () => screen.queryByRole("listbox", { name: "Recent tasks" });
const pause = (ms = 250) => act(() => new Promise((r) => setTimeout(r, ms)));
const recentCalls = (calls: Call[]) => calls.filter((c) => c.path.startsWith("/api/recent-tasks"));

describe("Home composer — Recent tasks (Agents-Recent)", () => {
  it("shows the account's recent tasks as you type: task, team, status, run, age", async () => {
    const calls = setup();
    const box = await ideaBox();
    type(box, "A");
    type(box, "Add a");
    const list = await screen.findByRole("listbox", { name: "Recent tasks" });
    expect(recentCalls(calls).map((c) => c.path)).toEqual(["/api/recent-tasks?q=Add+a&limit=6"]);
    expect(within(list).getByText("Picking one fills in the task and its team")).toBeVisible();
    const rows = within(list).getAllByRole("option");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Add an RSI indicator");
    expect(rows[0].querySelector("b")).toHaveTextContent("Add a");
    expect(rows[0]).toHaveTextContent("Indicator sprint team");
    expect(within(rows[0]).getByText("Done").closest(".ds-badge")).toHaveClass("ds-badge--success");
    expect(rows[0]).toHaveTextContent("#12");
    expect(rows[0]).toHaveTextContent("2h ago");
    expect(within(rows[1]).getByText("Working")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Failed")).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent("yesterday");
    expect(within(rows[3]).getByText("Stopped")).toBeInTheDocument();
    expect(rows[3]).toHaveTextContent("4 days ago");
    expect(within(list).getByText("to choose")).toBeInTheDocument();
    expect(within(list).getByText("Enter")).toHaveClass("ds-kbd");
    // A combobox textbox: expanded, controls the list, no row chosen yet.
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(box).toHaveAttribute("aria-controls", list.id);
    expect(box).not.toHaveAttribute("aria-activedescendant");
    expect(rows.every((r) => r.getAttribute("aria-selected") === "false")).toBe(true);
  });

  it("↓ then Enter uses the task and picks its team; the list closes", async () => {
    setup();
    const box = await ideaBox();
    type(box, "Add a");
    await screen.findByRole("listbox", { name: "Recent tasks" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    const rows = screen.getAllByRole("option");
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", rows[0].id);
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
    expect(box).toHaveValue("Add an RSI indicator");
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Recent tasks" })).toBeNull());
    const composer = screen.getByRole("region", { name: "Start a run" });
    expect(within(composer).getByRole("button", { name: /Indicator sprint team/ })).toBeVisible();
  });

  it("Enter with no chosen row keeps today's behaviour; a hover chooses; a click uses it", async () => {
    setup();
    const box = await ideaBox();
    type(box, "Add a");
    const list = await screen.findByRole("listbox", { name: "Recent tasks" });
    // Not prevented: the textarea takes its newline as before.
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(true);
    const rows = within(list).getAllByRole("option");
    fireEvent.mouseEnter(rows[2]);
    expect(rows[2]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(rows[2]);
    expect(box).toHaveValue("Add a VWAP indicator");
  });

  it("Esc closes it until the next keystroke", async () => {
    setup();
    const box = await ideaBox();
    type(box, "Add a");
    await screen.findByRole("listbox", { name: "Recent tasks" });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Recent tasks" })).toBeNull();
    expect(box).toHaveAttribute("aria-expanded", "false");
    type(box, "Add an");
    expect(await screen.findByRole("listbox", { name: "Recent tasks" })).toBeInTheDocument();
  });

  it("stays hidden under 2 characters, with no matches, and when the request fails", async () => {
    const calls = setup({ tasks: [] });
    const box = await ideaBox();
    type(box, "A");
    await new Promise((r) => setTimeout(r, 250));
    expect(recentCalls(calls)).toHaveLength(0);
    type(box, "Zz");
    await waitFor(() => expect(recentCalls(calls)).toHaveLength(1));
    expect(screen.queryByRole("listbox", { name: "Recent tasks" })).toBeNull();
    vi.unstubAllGlobals();
    mockApi(homeRoutes({ "GET /api/recent-tasks": jsonError(500, "boom") }));
    type(box, "Add");
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByRole("listbox", { name: "Recent tasks" })).toBeNull();
  });

  it("keeps every composer control", async () => {
    setup();
    const box = await ideaBox();
    type(box, "Add a");
    await screen.findByRole("listbox", { name: "Recent tasks" });
    const composer = screen.getByRole("region", { name: "Start a run" });
    expect(within(composer).getByText("Start a run")).toBeVisible();
    expect(within(composer).getByRole("button", { name: /Docs team/ })).toBeVisible();
    expect(within(composer).getByRole("button", { name: /Launch/ })).toBeInTheDocument();
    expect(within(composer).getByRole("button", { name: /Options/ })).toBeInTheDocument();
  });
});

// The review's fixes (M6): the list only while the box has focus after a real keystroke, IME,
// stale rows, the live region.
describe("Home composer — Recent tasks, focus and typing", () => {
  it("closes when the idea box loses focus (Tab, a click elsewhere) and comes back on focus", async () => {
    setup();
    const box = await ideaBox();
    type(box, "Add a");
    await screen.findByRole("listbox", { name: "Recent tasks" });
    act(() => box.blur());
    expect(list()).toBeNull();
    expect(box).toHaveAttribute("aria-expanded", "false");
    act(() => box.focus());
    expect(list()).not.toBeNull();
  });

  it("doesn't open when Retry / Run again fills the idea (no keystroke), nor ask for tasks", async () => {
    const calls = setup();
    const box = await ideaBox();
    act(() => requestComposerPrefill({ teamId: "t-ind", idea: "Add an RSI indicator" }));
    await waitFor(() => expect(box).toHaveValue("Add an RSI indicator"));
    act(() => box.focus());
    await pause();
    expect(list()).toBeNull();
    expect(recentCalls(calls)).toHaveLength(0);
    // The next real keystroke opens it.
    type(box, "Add a");
    expect(await screen.findByRole("listbox", { name: "Recent tasks" })).toBeInTheDocument();
  });

  it("leaves keys alone while an IME is composing", async () => {
    setup();
    const box = await ideaBox();
    type(box, "Add a");
    await screen.findByRole("listbox", { name: "Recent tasks" });
    expect(fireEvent.keyDown(box, { key: "ArrowDown", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(box).not.toHaveAttribute("aria-activedescendant");
    expect(box).toHaveValue("Add a");
  });

  it("shows no stale rows for new text; the chosen row resets with the text and on mouse leave", async () => {
    setup();
    const box = await ideaBox();
    type(box, "Add a");
    const shown = await screen.findByRole("listbox", { name: "Recent tasks" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveAttribute("aria-activedescendant");
    // New text: the old answer isn't shown while the new one is on its way.
    type(box, "Add an");
    expect(list()).toBeNull();
    const again = await screen.findByRole("listbox", { name: "Recent tasks" });
    expect(box).not.toHaveAttribute("aria-activedescendant");
    const rows = within(again).getAllByRole("option");
    fireEvent.mouseEnter(rows[1]);
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.mouseLeave(again);
    expect(rows[1]).toHaveAttribute("aria-selected", "false");
    expect(shown).not.toBeInTheDocument();
  });

  it("says when the list opens, in a polite live region; ↑ ↓ are the textarea's while it's shut", async () => {
    setup();
    const box = await ideaBox();
    expect(fireEvent.keyDown(box, { key: "ArrowDown" })).toBe(true);
    type(box, "Add a");
    await screen.findByRole("listbox", { name: "Recent tasks" });
    const live = screen.getByText("4 recent tasks — use the arrow keys to choose");
    expect(live).toHaveAttribute("aria-live", "polite");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(live).toBeEmptyDOMElement();
    expect(fireEvent.keyDown(box, { key: "ArrowUp" })).toBe(true);
  });
});
