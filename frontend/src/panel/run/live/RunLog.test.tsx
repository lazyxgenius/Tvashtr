import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunMore } from "./RunLog";

// Next-More → Next-Log: the run's ⋯ menu, then the log in either format, previewed and saved
// through a Blob + <a download> (as the Team file does, so it works in Desktop too).

const TEXT_LINES = [
  "run #12 · Indicator sprint team · Add an RSI indicator · team setup v7",
  "10:41:02  run        started on lazyxgenius/trade_mcp (main)",
  "10:42:05  pm         wrote the spec (v2)",
  "10:43:10  gate       approved by you",
  "10:44:02  engineer   edited core/indicators.py (+48 −3)",
  "10:44:40  engineer   ran: python -m pytest -q tests/test_indicators.py → 3 failed",
  "                     env: GITHUB_TOKEN=••••  OPENAI_API_KEY=••••",
  "10:48:40  reviewer   changes requested: register RSI on INDICATORS; default length 14",
  // Never in the preview: the middle of the log (and most of its size).
  `10:50:00  engineer   ran: python -m pytest -q → ${"x".repeat(183_600)}`,
  "11:03:22  ship       opened pull request #42",
];
const TEXT = `${TEXT_LINES.join("\n")}\n`;
const JSONL =
  [
    { at: "2026-10-02T10:41:02Z", agent: "Run", round: null, kind: "started", text: "Started" },
    {
      at: "2026-10-02T10:42:05Z",
      agent: "Product manager",
      round: 1,
      kind: "wrote_doc",
      text: "Wrote the spec (v2)",
    },
  ]
    .map((o) => JSON.stringify(o))
    .join("\n") + "\n";

/** A saved Blob's text (jsdom's Blob has no `.text()`). */
const read = (b: Blob) =>
  new Promise<string>((done) => {
    const r = new FileReader();
    r.onload = () => done(r.result as string);
    r.readAsText(b);
  });

let saved: { name: string; blob: Blob }[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  saved = [];
  let last: Blob | null = null;
  URL.createObjectURL = vi.fn((b: Blob) => {
    last = b;
    return "blob:run-log";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, blob: last as Blob });
  });
  fetchMock = vi.fn((url: string) =>
    Promise.resolve(new Response(url.endsWith("format=jsonl") ? JSONL : TEXT)),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openLog() {
  fireEvent.click(screen.getByRole("button", { name: "More for this run" }));
  const menu = screen.getByRole("menu", { name: "More for this run" });
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Download the run log" }));
  return screen.findByRole("dialog", { name: "Download the run log" });
}

describe("RunMore — the run's ⋯ menu and Download the run log (Next-More, Next-Log)", () => {
  it("previews the readable text with its size and steps, then saves it", async () => {
    render(<RunMore runId="run-12" number={12} steps={31} />);
    const dialog = await openLog();
    expect(dialog).toHaveTextContent(
      "Every step, its output and its errors, in order. Secrets are replaced with ••••.",
    );
    expect(within(dialog).getByRole("button", { name: "Readable text" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const preview = await within(dialog).findByLabelText("Preview");
    expect(preview.textContent).toBe(
      [...TEXT_LINES.slice(0, 8), "…", TEXT_LINES[TEXT_LINES.length - 1]].join("\n"),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-12/log?format=text");
    expect(dialog).toHaveTextContent("About 180 KB · 31 steps");
    expect(dialog).toHaveTextContent(
      "The log is a record for sharing or keeping. It can’t be loaded back into Tvashtr; to build on this run, use Start the next run from this.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Download" }));
    expect(saved.map((s) => s.name)).toEqual(["run-12.txt"]);
    expect(await read(saved[0].blob)).toBe(TEXT);
    // Saving leaves the dialog for the person to close.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("JSON lines: one object per line in the preview, saved as .jsonl", async () => {
    render(<RunMore runId="run-12" number={12} steps={31} />);
    const dialog = await openLog();
    await within(dialog).findByLabelText("Preview");
    fireEvent.click(within(dialog).getByRole("button", { name: "JSON lines" }));
    expect(within(dialog).getByRole("button", { name: "JSON lines" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Preview").textContent).toBe(JSONL.trimEnd()),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-12/log?format=jsonl");
    expect(dialog).toHaveTextContent("About 1 KB · 31 steps");
    fireEvent.click(within(dialog).getByRole("button", { name: "Download" }));
    expect(saved.map((s) => s.name)).toEqual(["run-12.jsonl"]);
    expect(await read(saved[0].blob)).toBe(JSONL);
  });

  it("a log that can't be read says so, with Retry, and nothing to download", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("", { status: 500 })));
    render(<RunMore runId="run-12" number={12} steps={31} />);
    const dialog = await openLog();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn’t load the run log.",
    );
    expect(within(dialog).getByRole("button", { name: "Download" })).toBeDisabled();
  });
});
