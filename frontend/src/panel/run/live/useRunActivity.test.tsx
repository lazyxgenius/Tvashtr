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
