import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runTests } from "../../lib/api/agentTests";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { mockApi } from "../../pages/home/homeTestUtils";
import { DONE_RUN, RUNNING_RUN, tests } from "./testsFixtures";
import { TestsTab } from "./TestsTab";
import { type AgentTestsApi, useAgentTests } from "./useAgentTests";

// M-desk-routes (D1, D4; Quality › Test-RunningDesktop): tests started in Tvashtr Desktop replay
// Desktop-routed agents on the owner's subscription; a replay queued behind another job of its plan
// shows the waiting line in its row. The website posts exactly what it did.

const BASE = "/api/teams/t1/nodes/n-rev/tests";
const LINE = "Waiting for your Grok subscription — one job at a time.";

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.tvashtrDesktop;
  __resetBackendStatusForTests();
});

describe("Run all from the Desktop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const flush = async () => {
    for (let i = 0; i < 5; i++) await act(async () => Promise.resolve());
  };

  it("posts desktop_target in Tvashtr Desktop", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    const calls = mockApi({
      [`GET ${BASE}`]: tests(DONE_RUN),
      [`POST ${BASE}/run`]: { run: RUNNING_RUN },
    });
    const { result } = renderHook(() => useAgentTests("t1", "n-rev", true));
    await flush();
    await act(() => result.current.runAll());
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([
      { desktop_target: true },
    ]);
  });

  it("the website posts no body, as before", async () => {
    const calls = mockApi({
      [`GET ${BASE}`]: tests(DONE_RUN),
      [`POST ${BASE}/run`]: { run: RUNNING_RUN },
    });
    const { result } = renderHook(() => useAgentTests("t1", "n-rev", true));
    await flush();
    await act(() => result.current.runAll());
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([undefined]);
  });

  it("runTests sends the flag only when asked", async () => {
    const calls = mockApi({ [`POST ${BASE}/run`]: { run: RUNNING_RUN } });
    await runTests("t1", "n-rev");
    await runTests("t1", "n-rev", { desktop_target: false });
    await runTests("t1", "n-rev", { desktop_target: true });
    expect(calls.map((c) => c.body)).toEqual([undefined, undefined, { desktop_target: true }]);
  });
});

describe("Test-RunningDesktop", () => {
  const api = (value: ReturnType<typeof tests>): AgentTestsApi => ({
    state: "ready",
    value,
    readAt: Date.now(),
    running: true,
    watched: null,
    retry: vi.fn(),
    reload: vi.fn(),
    runAll: vi.fn(),
    stop: vi.fn(),
  });
  const renderTab = (value: ReturnType<typeof tests>) =>
    render(
      <TestsTab
        agent="Reviewer"
        tests={api(value)}
        onRunAll={vi.fn()}
        onStop={vi.fn()}
        busy={false}
        onPickRound={vi.fn()}
        onPickFile={vi.fn()}
        onOpenReplay={vi.fn()}
        onCompare={vi.fn()}
        onJudge={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

  it("a replay queued behind another job of its plan shows the waiting line in its row", () => {
    const run = {
      ...RUNNING_RUN,
      results: RUNNING_RUN.results.map((r) =>
        r.status === "running" ? { ...r, waiting: LINE } : r,
      ),
    };
    renderTab(tests(run));
    const line = screen.getByText(LINE);
    expect(line.closest("li")).toHaveTextContent("Says why the tests fail");
    expect(screen.getAllByText(LINE)).toHaveLength(1);
  });

  it("no line without one (the website, or a replay the Desktop is running)", () => {
    renderTab(tests(RUNNING_RUN));
    expect(screen.queryByText(/one job at a time/)).toBeNull();
  });
});
