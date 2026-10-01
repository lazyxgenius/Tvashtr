import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRunActivity } from "./useRunActivity";

function Probe({ runId }: { runId: string }) {
  const a = useRunActivity(runId, true);
  return <span>{a ? `lines:${a.lines.length}` : "none"}</span>;
}

afterEach(() => vi.unstubAllGlobals());

describe("useRunActivity", () => {
  it("ignores a reply that is not an Activity (an older server)", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Probe runId="r-1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("reads the run's Activity", async () => {
    const body = {
      run_id: "r-1",
      status: "completed",
      live_state: "done",
      cursor: "c",
      total: 1,
      agents: [],
      lines: [
        {
          id: "a",
          at: "2026-10-02T10:00:00Z",
          node_id: null,
          label: "Run",
          iteration: null,
          kind: "done",
          text: "Done",
          tone: "ok",
          refs: {},
        },
      ],
      pinned: null,
      summary: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))),
    );
    render(<Probe runId="r-1" />);
    expect(await screen.findByText("lines:1")).toBeInTheDocument();
  });
});

describe("useRunActivity — polling", () => {
  it("never overlaps: the next poll waits for the previous reply (review finding 1)", async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: Array<() => void> = [];
    const body = {
      run_id: "r-1",
      status: "running",
      live_state: "working",
      cursor: "c",
      total: 0,
      agents: [],
      lines: [],
      pinned: null,
      summary: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise<Response>((resolve) =>
          resolvers.push(() => {
            inFlight -= 1;
            resolve(new Response(JSON.stringify(body), { status: 200 }));
          }),
        );
      }),
    );
    function Live() {
      useRunActivity("r-1", false);
      return null;
    }
    render(<Live />);
    // The first reply is slow (10 s): no second request may start meanwhile.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(maxInFlight).toBe(1);
    resolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(2_100);
    expect(resolvers.length).toBe(1); // the next poll, 2 s after the reply
    expect(maxInFlight).toBe(1);
    vi.useRealTimers();
  });
});
