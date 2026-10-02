import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentTests } from "../../lib/api/agentTests";
import {
  DONE_RUN,
  QUEUED_RUN,
  RUNNING_RUN,
  STOPPED_RUN,
  TESTS,
  tests as testsOf,
  WORSE_RUN,
} from "./testsFixtures";
import { DeleteTestBar, TestsFooter, TestsTab, type TestsTabProps } from "./TestsTab";
import type { AgentTestsApi } from "./useAgentTests";

// M7 Test-Empty / -List / -Running / -Queued / -Results / -Worse / -Stopped / -RowMenu / -Focus.

const api = (value: AgentTests | null, over: Partial<AgentTestsApi> = {}): AgentTestsApi => ({
  state: value ? "ready" : "loading",
  value,
  readAt: Date.now(),
  running: value?.run?.status === "running",
  watched: null,
  retry: vi.fn(),
  reload: vi.fn(),
  runAll: vi.fn(),
  stop: vi.fn(),
  ...over,
});

function renderTab(tests: AgentTestsApi, over: Partial<TestsTabProps> = {}) {
  const props: TestsTabProps = {
    agent: "Reviewer",
    tests,
    onRunAll: vi.fn(),
    onStop: vi.fn(),
    busy: false,
    onPickRound: vi.fn(),
    onPickFile: vi.fn(),
    onOpenReplay: vi.fn(),
    onCompare: vi.fn(),
    onJudge: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  };
  render(<TestsTab {...props} />);
  return props;
}
const rows = () => within(screen.getByRole("list", { name: "Tests" })).getAllByRole("listitem");
const toggle = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("TestsTab", () => {
  it("Test-Empty: no tests yet — pick a round, add a file, how it works", () => {
    const props = renderTab(api(testsOf(null, { tests: [] })));
    expect(screen.getByText("No tests yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pick a round from a run" }));
    expect(props.onPickRound).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add tests from a file" })).toBeInTheDocument();
    expect(screen.getByText("CSV or JSON lines")).toBeInTheDocument();
    const how = screen.getByRole("region", { name: "How it works" });
    expect(within(how).getByText("Pick a real round that went right or wrong.")).toBeVisible();
    // A file picked reaches the drawer.
    const file = new File(["task\n"], "reviewer-examples.csv", { type: "text/csv" });
    fireEvent.change(screen.getByTestId("test-file"), { target: { files: [file] } });
    expect(props.onPickFile).toHaveBeenCalledWith(file);
  });

  it("loading and its error with Retry", () => {
    const tests = api(null, { state: "error" });
    renderTab(tests);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(tests.retry).toHaveBeenCalled();
  });

  it("Test-List: 6 tests, the last run, Run all 6, the estimate and each row's pill and meta", () => {
    const props = renderTab(api(testsOf(DONE_RUN)));
    expect(screen.getByText("6 tests")).toBeInTheDocument();
    expect(screen.getByText("Last run on v7 · 2h ago · 5 passed, 1 failed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Replays only the Reviewer, on saved inputs. About $0.40 on your keys · 4 min. AI checks are included.",
      ),
    ).toBeInTheDocument();
    expect(rows()).toHaveLength(6);
    expect(within(rows()[0]).getByText("Passed")).toBeInTheDocument();
    expect(within(rows()[0]).getByText("From run #12 · round 1 · 3 checks")).toBeInTheDocument();
    expect(within(rows()[5]).getByText("Failed")).toBeInTheDocument();
    // Not watched: no row opens by itself.
    expect(toggle("Names the file to fix")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Run all 6" }));
    expect(props.onRunAll).toHaveBeenCalled();
  });

  it("Test-Running: Running 3 of 6 with its timer, $0.14 so far, Stop, the bar and the row states", () => {
    const props = renderTab(api(testsOf(RUNNING_RUN)));
    expect(screen.getByText("Running 3 of 6")).toBeInTheDocument();
    expect(screen.getByText("1m 40s")).toBeInTheDocument();
    expect(screen.getByText("On v7 · $0.14 so far")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Tests done" });
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "6");
    expect(within(rows()[2]).getByText("Running")).toBeInTheDocument();
    expect(within(rows()[3]).getByText("Waiting")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(props.onStop).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Run all/ })).not.toBeInTheDocument();
  });

  it("a stop asked for mid-replay reads Stopping… and can't be pressed again (#5)", () => {
    const props = renderTab(api(testsOf({ ...RUNNING_RUN, stopping: true })));
    const stop = screen.getByRole("button", { name: "Stopping…" });
    expect(stop).toBeDisabled();
    expect(stop).toHaveAttribute("aria-busy", "true");
    fireEvent.click(stop);
    expect(props.onStop).not.toHaveBeenCalled();
    expect(screen.getByText("Running 3 of 6")).toBeInTheDocument();
  });

  it("Test-Queued: waiting to start while the owner's runs use every slot", () => {
    renderTab(api(testsOf(QUEUED_RUN)));
    expect(screen.getByText("Waiting to start")).toBeInTheDocument();
    expect(screen.getByText("On v7 · 6 tests")).toBeInTheDocument();
    expect(
      screen.getByText("Your runs are using all 3 slots. The tests start when one finishes."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("Test-Results: 5 of 6 passed, +1 since v6, the failed row open with why and its actions", () => {
    const props = renderTab(api(testsOf(DONE_RUN), { watched: "run7" }));
    expect(screen.getByText("+1 since v6")).toBeInTheDocument();
    expect(screen.getByText(/5 of 6 passed/)).toBeInTheDocument();
    expect(screen.getByText("On v7 · just now · $0.38")).toBeInTheDocument();
    const failed = rows()[5];
    expect(toggle("Names the file to fix")).toHaveAttribute("aria-expanded", "true");
    expect(failed).toHaveTextContent(
      "AI check: names the file and line for each problem · not met",
    );
    expect(
      within(failed).getByText(
        "Changes requested: the new function isn’t registered, so the builder can’t list it.",
      ),
    ).toBeInTheDocument();
    expect(
      within(failed).getByText(
        "No file or line named. Something like core/indicators.py:118 was expected.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(failed).getByRole("button", { name: "Open this replay" }));
    expect(props.onOpenReplay).toHaveBeenCalledWith(DONE_RUN.results[5]);
    fireEvent.click(within(failed).getByRole("button", { name: "Compare with v6" }));
    expect(props.onCompare).toHaveBeenCalledWith(6);
    fireEvent.click(within(failed).getByRole("button", { name: "The AI check is wrong" }));
    expect(props.onJudge).toHaveBeenCalledWith(TESTS[5], 1, DONE_RUN.results[5].answer);
    // A passed row opens too: its answer, no actions (Test-Worse).
    fireEvent.click(toggle("Catches an unregistered indicator"));
    expect(
      within(rows()[0]).getByText("Changes requested: register rsi on INDICATORS."),
    ).toBeVisible();
    expect(within(rows()[0]).queryByRole("button", { name: "Open this replay" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(props.onRunAll).toHaveBeenCalled();
  });

  it("no Compare without an older version; no AI-check link when another check failed", () => {
    const run = {
      ...DONE_RUN,
      since: null,
      results: DONE_RUN.results.map((r, i) =>
        i === 5
          ? { ...r, checks: [{ kind: "must_say" as const, value: "X", met: false, reason: null }] }
          : r,
      ),
    };
    renderTab(api(testsOf(run), { watched: "run7" }));
    const failed = rows()[5];
    expect(failed).toHaveTextContent("Must say: X · not met");
    expect(within(failed).queryByText(/Compare with/)).not.toBeInTheDocument();
    expect(within(failed).queryByText("The AI check is wrong")).not.toBeInTheDocument();
  });

  it("Test-Worse: −1 since v6 and a replay that ran out of time", () => {
    renderTab(api(testsOf(WORSE_RUN), { watched: "run7" }));
    expect(screen.getByText("−1 since v6")).toBeInTheDocument();
    expect(screen.getByText(/4 of 6 passed/)).toBeInTheDocument();
    expect(
      within(rows()[0]).getByText("It took more than 10 minutes, so it was stopped."),
    ).toBeInTheDocument();
    expect(within(rows()[0]).getByRole("button", { name: "Compare with v6" })).toBeVisible();
  });

  it("Test-Worse: a passed row's AI check that couldn't run reads skipped, not failed", () => {
    const run = {
      ...WORSE_RUN,
      results: WORSE_RUN.results.map((r, i) =>
        i === 2
          ? {
              ...r,
              answer: "Changes requested: rsi() exceeds 100.",
              checks: [
                { kind: "must_say" as const, value: "Changes requested", met: true, reason: null },
                {
                  kind: "ai" as const,
                  value: "names the file and line",
                  met: null,
                  reason: "No AI checks left this month",
                },
              ],
            }
          : r,
      ),
    };
    renderTab(api(testsOf(run), { watched: "run7" }));
    fireEvent.click(toggle("Says why the tests fail"));
    expect(rows()[2]).toHaveTextContent(
      "AI check: names the file and line · skipped — no AI checks left this month",
    );
  });

  it("Test-Stopped: Stopped · 2 of 6 ran, the rest Stopped, Run again", () => {
    renderTab(api(testsOf(STOPPED_RUN), { watched: "run7" }));
    expect(screen.getByText("Stopped · 2 of 6 ran")).toBeInTheDocument();
    expect(screen.getByText("On v7 · $0.14")).toBeInTheDocument();
    expect(within(rows()[2]).getByText("Stopped")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run again" })).toBeInTheDocument();
  });

  it("a run that failed says why", () => {
    const run = {
      ...DONE_RUN,
      status: "failed" as const,
      error: "Tvashtr restarted while the tests ran. Run them again.",
    };
    renderTab(api(testsOf(run)));
    expect(screen.getByRole("alert")).toHaveTextContent("Tvashtr restarted while the tests ran.");
  });

  it("Test-RowMenu: a row's ⋯ › Delete test", () => {
    const props = renderTab(api(testsOf(DONE_RUN)));
    fireEvent.click(screen.getByRole("button", { name: "More for Flags a missing test file" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete test" }));
    expect(props.onDelete).toHaveBeenCalledWith(TESTS[3]);
  });

  it("Test-Focus: the rows two by two with New test and Add tests from a file under them", () => {
    const props = renderTab(api(testsOf(DONE_RUN)), { focus: true });
    expect(document.querySelector(".tt-focus .tt-list")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New test" }));
    expect(props.onPickRound).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add tests from a file" })).toBeInTheDocument();
  });
});

describe("TestsFooter and DeleteTestBar", () => {
  it("New test, and a picked file", () => {
    const onNewTest = vi.fn();
    const onPickFile = vi.fn();
    render(<TestsFooter onNewTest={onNewTest} onPickFile={onPickFile} />);
    fireEvent.click(screen.getByRole("button", { name: "New test" }));
    expect(onNewTest).toHaveBeenCalled();
    const file = new File(["{}"], "a.jsonl");
    fireEvent.change(screen.getByTestId("test-file"), { target: { files: [file] } });
    expect(onPickFile).toHaveBeenCalledWith(file);
  });

  it("asks in the footer's place; Cancel or Escape keeps the test", () => {
    const onCancel = vi.fn();
    const onDelete = vi.fn();
    render(
      <DeleteTestBar
        name="Flags a missing test file"
        busy={false}
        onCancel={onCancel}
        onDelete={onDelete}
      />,
    );
    const bar = screen.getByRole("alertdialog", { name: "Delete test" });
    expect(bar).toHaveTextContent("Delete “Flags a missing test file”? Its past results stay.");
    fireEvent.keyDown(bar, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalled();
  });
});
