/**
 * M2 (Live-Home board): Running now cards keep their status badge and gain a Quiet / Stalled /
 * Needs you badge beside it plus the current-activity line; Needs you lists a stalled run with
 * "View run".
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunListRow } from "../../lib/api/runs";
import {
  INBOX_ITEMS,
  RSI_RUN,
  homeRoutes,
  mockApi,
  renderHome,
  resetHomeState,
  runRow,
  stalledInboxItem,
} from "./homeTestUtils";

const NOW = new Date("2026-10-02T10:50:00Z").getTime();
const secsAgo = (s: number) => new Date(NOW - s * 1000).toISOString();

beforeEach(() => {
  resetHomeState();
  // Freeze the clock only (timers stay real so RTL's findBy* keep polling).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetHomeState();
  window.location.hash = "";
});

function live(
  label: string,
  state: NonNullable<RunListRow["live_state"]>,
  lastS: number,
  activity = "Asked the model for the next step",
): Partial<RunListRow> {
  return {
    live_state: state,
    live: {
      label,
      live_state: state,
      activity,
      last_event_at: secsAgo(lastS),
      activity_started_at: secsAgo(lastS),
    },
  };
}

const WORKING = runRow({
  run_id: "r-docs",
  idea: "Write the API guide",
  ...live("Writer", "working", 4, "Edited a file"),
});
const STALLED = runRow({
  run_id: "r-stall",
  idea: "Fix the flaky login test",
  library_team_id: "t-bug",
  team: { id: "t-bug", name: "Bugfix squad" },
  ...live("Engineer", "stalled", 310),
});
const QUIET = runRow({
  run_id: "r-quiet",
  idea: "Compare three charting libraries",
  team: { id: "t-res", name: "Research pod" },
  ...live("Reviewer", "quiet", 100),
});
const COMMAND = runRow({
  run_id: "r-cmd",
  idea: "Run the suite",
  team: { id: "t-cmd", name: "Command team" },
  ...live("Engineer", "running_command", 4, "Running a command: python -m pytest -q"),
});
const RETRYING = runRow({
  run_id: "r-retry",
  idea: "Try again later",
  team: { id: "t-retry", name: "Retry team" },
  ...live("Engineer", "retrying", 2, "Model busy · trying again in 10 s (1 of 3)"),
});
const NEEDS = { ...RSI_RUN, ...live("Approval", "needs_you", 26) };
const PLAIN = runRow({
  run_id: "r-plain",
  idea: "No live fields",
  team: { id: "t-p", name: "Plain team" },
});

function card(name: string) {
  return within(screen.getByRole("region", { name: "Running now" })).getByRole("article", { name });
}

/** A card's badges, in order: the status badge it always had, then any live badge. */
const badges = (el: HTMLElement) =>
  Array.from(el.querySelectorAll(".ds-badge"), (b) => b.textContent);

describe("Running now — live state (Live-Home)", () => {
  it("keeps each card's status badge, adds Quiet / Stalled / Needs you beside it, and shows the current-activity line", async () => {
    mockApi(
      homeRoutes({
        "GET /api/runs": {
          runs: [NEEDS, WORKING, STALLED, QUIET, COMMAND, RETRYING, PLAIN],
          next_cursor: null,
        },
      }),
    );
    renderHome();
    await screen.findByRole("article", { name: "Docs team: Write the API guide" });
    expect(screen.getByText("Updates as it happens")).toBeInTheDocument();

    const needs = card("Indicator sprint team: Add an RSI indicator with tests");
    // Additive (brief §2.2): the status badge keeps its label; the live badge sits beside it.
    expect(badges(needs)).toEqual(["Awaiting you", "Needs you"]);
    // The existing waiting line stays; no second line repeats it.
    expect(within(needs).getByText("Waiting for you at Approval")).toBeInTheDocument();
    expect(within(needs).queryByText(/Asked the model/)).toBeNull();

    const working = card("Docs team: Write the API guide");
    // Working / Running a command / Retrying: the status badge already says it's running.
    expect(badges(working)).toEqual(["Running"]);
    expect(within(working).getByText("Writer")).toBeInTheDocument();
    expect(within(working).getByText("· Edited a file")).toBeInTheDocument();
    expect(within(working).getByText("4 s ago")).toBeInTheDocument();

    const stalled = card("Bugfix squad: Fix the flaky login test");
    expect(badges(stalled)).toEqual(["Running", "Stalled"]);
    expect(
      within(stalled).getByText("· no update for 5m 10s · nothing shipped yet"),
    ).toBeInTheDocument();
    // Resume arrives with M3 (no dead buttons).
    expect(within(stalled).queryByRole("button", { name: /Resume/ })).toBeNull();

    const quiet = card("Research pod: Compare three charting libraries");
    expect(badges(quiet)).toEqual(["Running", "Quiet"]);
    expect(
      within(quiet).getByText("· no update for 1m 40s · usually still thinking"),
    ).toBeInTheDocument();

    const command = card("Command team: Run the suite");
    expect(badges(command)).toEqual(["Running"]);
    expect(
      within(command).getByText("· Running a command: python -m pytest -q"),
    ).toBeInTheDocument();

    expect(badges(card("Retry team: Try again later"))).toEqual(["Running"]);

    // No live fields: the card is exactly as before.
    const plain = card("Plain team: No live fields");
    expect(badges(plain)).toEqual(["Running"]);
    expect(within(plain).queryByText(/·/)).toBeNull();
  });
});

describe("Needs you — Run stalled (Live-Home)", () => {
  it("lists a stalled run with View run, which opens the run", async () => {
    mockApi(
      homeRoutes({
        "GET /api/inbox": { count: 5, items: [...INBOX_ITEMS, stalledInboxItem(310)] },
      }),
    );
    renderHome();
    const section = await screen.findByRole("region", { name: "Needs you" });
    await within(section).findByText("Run stalled");
    const row = within(section).getByText("Run stalled").closest("li") as HTMLElement;
    expect(
      within(row).getByText(
        "Bugfix squad · “Fix the flaky login test” · no update for 5m 10s · Engineer",
      ),
    ).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Resume/ })).toBeNull();
    expect(within(row).getByRole("button", { name: "More for Run stalled" })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "View run" }));
    expect(window.location.hash).toBe("#/teams/t-bug/runs/r-stall");
  });
});

describe("M3 — Resume on Home (Live-Home, Prob-HomeFailed)", () => {
  const RESUME = { invocation_id: 105, label: "Engineer, round 2" };
  const rowOf = (section: HTMLElement, title: string) =>
    within(section).getByText(title).closest("li") as HTMLElement;
  const names = (row: HTMLElement) =>
    within(row)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);

  it("Needs you's Run stalled and Run failed rows gain Resume first, opening the run's Resume panel", async () => {
    mockApi(
      homeRoutes({
        "GET /api/inbox": {
          count: 5,
          items: [
            ...INBOX_ITEMS.map((i) => (i.kind === "run_failed" ? { ...i, resume: RESUME } : i)),
            { ...stalledInboxItem(310), resume: RESUME },
          ],
        },
      }),
    );
    renderHome();
    const section = await screen.findByRole("region", { name: "Needs you" });
    await within(section).findByText("Run stalled");
    const stalled = rowOf(section, "Run stalled");
    expect(names(stalled)).toEqual(["Resume", "View run", "More for Run stalled"]);
    const failed = rowOf(section, "Run failed");
    // The failed row keeps View run and Retry; Resume comes before them.
    expect(names(failed)).toEqual(["Resume", "View run", "Retry", "More for Run failed"]);
    fireEvent.click(within(stalled).getByRole("button", { name: "Resume" }));
    expect(window.location.hash).toBe("#/teams/t-bug/runs/r-stall?resume=1");
    fireEvent.click(within(failed).getByRole("button", { name: "Resume" }));
    expect(window.location.hash).toBe("#/teams/t-bug/runs/r-flaky?resume=1");
  });

  it("the stalled Running now card gains Resume when Needs you offers it", async () => {
    mockApi(
      homeRoutes({
        "GET /api/runs": { runs: [STALLED, QUIET], next_cursor: null },
        "GET /api/inbox": { count: 1, items: [{ ...stalledInboxItem(310), resume: RESUME }] },
      }),
    );
    renderHome();
    await screen.findByRole("article", { name: "Bugfix squad: Fix the flaky login test" });
    const stalled = card("Bugfix squad: Fix the flaky login test");
    fireEvent.click(await within(stalled).findByRole("button", { name: "Resume" }));
    expect(window.location.hash).toBe("#/teams/t-bug/runs/r-stall?resume=1");
    // Only the stalled card, and only with the server's resume.
    expect(
      within(card("Research pod: Compare three charting libraries")).queryByRole("button", {
        name: "Resume",
      }),
    ).toBeNull();
  });
});
