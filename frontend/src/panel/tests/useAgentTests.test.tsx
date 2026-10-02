import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError, mockApi } from "../../pages/home/homeTestUtils";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { DONE_RUN, RUNNING_RUN, tests } from "./testsFixtures";
import { TESTS_POLL_MS, useAgentTests } from "./useAgentTests";

const BASE = "/api/teams/t1/nodes/n-rev/tests";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
});

// Let the mocked fetches settle under fake timers.
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => Promise.resolve());
};

describe("useAgentTests", () => {
  it("reads nothing until the tab wants it", async () => {
    const calls = mockApi({ [`GET ${BASE}`]: tests(null) });
    const { result } = renderHook(() => useAgentTests("t1", "n-rev", false));
    await flush();
    expect(result.current.state).toBe("idle");
    expect(calls).toHaveLength(0);
  });

  it("polls every 2 s while running (R15), keeps the list through a failed poll, and says when it ended", async () => {
    let reply: unknown = tests(RUNNING_RUN);
    const calls = mockApi({ [`GET ${BASE}`]: () => reply });
    const ended = vi.fn();
    const { result } = renderHook(() => useAgentTests("t1", "n-rev", true, ended));
    await flush();
    expect(result.current.state).toBe("ready");
    expect(result.current.running).toBe(true);
    expect(calls).toHaveLength(1);

    reply = jsonError(500, "boom");
    act(() => {
      vi.advanceTimersByTime(TESTS_POLL_MS);
    });
    await flush();
    expect(calls).toHaveLength(2);
    expect(result.current.state).toBe("ready");
    expect(result.current.value?.run?.status).toBe("running");

    reply = tests(DONE_RUN);
    act(() => {
      vi.advanceTimersByTime(TESTS_POLL_MS);
    });
    await flush();
    expect(calls).toHaveLength(3);
    expect(result.current.running).toBe(false);
    // The run this tab saw going is the one whose results now show.
    expect(result.current.watched).toBe("run7");
    expect(ended).toHaveBeenCalledTimes(1);

    // Done: no more polls.
    act(() => {
      vi.advanceTimersByTime(TESTS_POLL_MS * 3);
    });
    await flush();
    expect(calls).toHaveLength(3);
  });

  it("Run all puts the new run in place at once; Stop puts back the stopped one", async () => {
    const calls = mockApi({
      [`GET ${BASE}`]: tests(DONE_RUN),
      [`POST ${BASE}/run`]: { run: RUNNING_RUN },
      [`POST ${BASE}/stop`]: { run: { ...RUNNING_RUN, status: "stopped" } },
    });
    const { result } = renderHook(() => useAgentTests("t1", "n-rev", true));
    await flush();
    expect(result.current.watched).toBeNull();
    await act(() => result.current.runAll());
    expect(result.current.running).toBe(true);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    await act(() => result.current.stop());
    expect(result.current.value?.run?.status).toBe("stopped");
    expect(result.current.watched).toBe("run7");
  });

  it("a first read that fails is an error; Retry reads again", async () => {
    let reply: unknown = jsonError(500, "boom");
    mockApi({ [`GET ${BASE}`]: () => reply });
    const { result } = renderHook(() => useAgentTests("t1", "n-rev", true));
    await flush();
    expect(result.current.state).toBe("error");
    reply = tests(null);
    act(() => result.current.retry());
    expect(result.current.state).toBe("loading");
    await flush();
    expect(result.current.state).toBe("ready");
  });
});
