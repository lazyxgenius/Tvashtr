import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamVersions } from "../lib/api/versions";
import { HistoryPanel } from "./HistoryPanel";
import { VersionChip } from "./VersionChip";

// M5 — "saved 2m ago" and History's row times age while the canvas sits idle (a 60 s tick).

const NOW = Date.parse("2026-10-02T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const SUMMARY: TeamVersions = {
  current: 7,
  saved_at: ago(2),
  changes: 0,
  next: 8,
  total: 1,
  versions: [
    {
      number: 7,
      created_at: ago(2),
      author: "you",
      summary: "Reviewer: instructions changed",
      note: null,
      runs: 0,
      source: "save",
      restored_from: null,
    },
  ],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("M5 — the version times tick", () => {
  it("the chip's 'saved 2m ago' becomes 'saved 3m ago' a minute later", () => {
    render(
      <VersionChip
        versions={SUMMARY}
        open={false}
        saving={false}
        onToggle={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("· saved 2m ago")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("· saved 3m ago")).toBeInTheDocument();
  });

  it("History's row time ages too", () => {
    render(
      <HistoryPanel
        teamId="t1"
        versions={{ state: "ready", value: SUMMARY, retry: vi.fn() }}
        revision={0}
        guard={(go) => go()}
        onRestored={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const panel = screen.getByRole("complementary", { name: "History" });
    expect(within(panel).getByText("2m ago · you")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(within(panel).getByText("3m ago · you")).toBeInTheDocument();
  });
});
