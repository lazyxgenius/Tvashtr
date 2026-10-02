import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCompare } from "./useCompare";

// R15: the running compare polls every 2 s with a setTimeout chain — never two reads at once, and
// an older reply never lands over a newer one.

const body = (id: string, status: string) => ({
  id,
  team_id: "team-1",
  task: "t",
  auto_approve: true,
  status,
  elapsed_s: 0,
  cost_usd: 0,
  created_at: "2026-10-02T10:00:00Z",
  ended_at: null,
  waiting: null,
  sides: [],
  results: null,
});

function Probe({ id }: { id: string }) {
  const { compare } = useCompare(id);
  return <span>{compare ? `${compare.id}:${compare.status}` : "none"}</span>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** fetch answers only when the test says so: `pending` holds each request's resolver by URL. */
function deferredFetch() {
  let inFlight = 0;
  let maxInFlight = 0;
  const pending: { url: string; answer: (status: string) => void }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<Response>((resolve) =>
        pending.push({
          url,
          answer: (status) => {
            inFlight -= 1;
            const id = url.split("/").pop() as string;
            resolve(new Response(JSON.stringify(body(id, status))));
          },
        }),
      );
    }),
  );
  return { pending, max: () => maxInFlight };
}

describe("useCompare — polling", () => {
  it("never overlaps: the next read waits for the previous reply, 2 s after it", async () => {
    vi.useFakeTimers();
    const f = deferredFetch();
    render(<Probe id="c1" />);
    await vi.advanceTimersByTimeAsync(10_000); // a slow first reply: nothing else starts
    expect(f.pending).toHaveLength(1);
    f.pending.shift()?.answer("running");
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText("c1:running")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1_900);
    expect(f.pending).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.pending).toHaveLength(1);
    expect(f.max()).toBe(1);
  });

  it("stops polling once the compare has ended", async () => {
    vi.useFakeTimers();
    const f = deferredFetch();
    render(<Probe id="c1" />);
    await vi.advanceTimersByTimeAsync(0);
    f.pending.shift()?.answer("finished");
    await act(() => vi.advanceTimersByTimeAsync(0));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.pending).toHaveLength(0);
    expect(screen.getByText("c1:finished")).toBeInTheDocument();
  });

  it("the newest answer wins: a late reply for an older read is dropped", async () => {
    vi.useFakeTimers();
    const f = deferredFetch();
    const { rerender } = render(<Probe id="c1" />);
    await vi.advanceTimersByTimeAsync(0);
    rerender(<Probe id="c2" />);
    await vi.advanceTimersByTimeAsync(0);
    const [old, fresh] = f.pending;
    expect(fresh.url).toBe("/api/compares/c2");
    fresh.answer("stopped");
    await act(() => vi.advanceTimersByTimeAsync(0));
    old.answer("running");
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText("c2:stopped")).toBeInTheDocument();
  });
});
