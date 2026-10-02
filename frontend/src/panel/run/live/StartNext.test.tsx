import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import { ApiDetailError } from "../../../lib/api/runs";
import type { CarrySnapshot, NextInfo } from "../../../lib/api/startFrom";
import { CameAlong, StartedFrom, StartNextDialog } from "./StartNext";

const INFO: NextInfo = {
  available: true,
  reason: null,
  run: { id: "run-12", number: 12, idea: "Add an RSI indicator" },
  spec: { version: 3 },
  decisions: [
    { title: "Spec approved", text: null },
    { title: "The reviewer’s rule", text: "every indicator is registered on INDICATORS" },
  ],
  memories: [
    { id: "m1", content: "Register every indicator on INDICATORS" },
    { id: "m2", content: "Indicators take a length and default to 14" },
    { id: "m3", content: "Run python -m pytest -q tests/test_indicators.py before you finish" },
  ],
  pending_memories: 1,
  summaries: [{ agent: "Product manager", text: "Wrote the RSI spec (v3)." }],
  pr: { number: 42, branch: "tvashtr/run-12", merged: false },
  start_from: [
    { value: "pr", label: "tvashtr/run-12 (pull request #42)" },
    { value: "main", label: "main" },
  ],
  default_start: "pr",
  team: { id: "team-1", version: 7 },
};

const MERGED: NextInfo = {
  ...INFO,
  decisions: [],
  pr: { number: 42, branch: "tvashtr/run-12", merged: true },
  start_from: [{ value: "main", label: "main" }],
  default_start: "main",
};

type Start = (body: unknown) => Promise<unknown>;

function open(info: NextInfo, onStart: Mock<Start> = vi.fn<Start>(() => new Promise(() => {}))) {
  const onCancel = vi.fn();
  render(<StartNextDialog info={info} onStart={onStart} onCancel={onCancel} />);
  const dialog = screen.getByRole("dialog", { name: "Start a new run from run #12" });
  return { dialog, onStart, onCancel };
}

const box = (dialog: HTMLElement, name: RegExp) =>
  within(dialog).getByRole<HTMLInputElement>("checkbox", { name });

describe("StartNextDialog (Next-Carry)", () => {
  it("brings everything along by default and starts from the open pull request", () => {
    const { dialog } = open(INFO);
    expect(dialog).toHaveTextContent(
      "The team starts with what run #12 finished with, so it doesn’t redo or forget it.",
    );
    expect(within(dialog).getByLabelText("What should the team do next?")).toHaveValue("");
    expect(dialog).toHaveTextContent("Brings along");
    const spec = box(dialog, /^The final spec \(v3\)/);
    const decisions = box(dialog, /^Your decisions \(2\)/);
    const memories = box(dialog, /^What the agents learned \(3 memories\)/);
    const summaries = box(dialog, /^A short summary from each agent/);
    for (const b of [spec, decisions, memories, summaries]) {
      expect(b).toBeChecked();
      expect(b).toBeEnabled();
    }
    expect(spec.closest("label")).toHaveTextContent(
      "Becomes the starting spec. The product manager updates it for the new task.",
    );
    expect(decisions.closest("label")).toHaveTextContent(
      "Spec approved · The reviewer’s rule: every indicator is registered on INDICATORS",
    );
    expect(memories.closest("label")).toHaveTextContent(
      "Confirmed memories from run #12. New ones still wait for your review.",
    );
    expect(summaries.closest("label")).toHaveTextContent(
      "What each one did and why, in a few lines",
    );
    const from = within(dialog).getByLabelText<HTMLSelectElement>("Start from");
    expect(from.value).toBe("pr");
    expect(Array.from(from.options).map((o) => o.text)).toEqual([
      "tvashtr/run-12 (pull request #42)",
      "main",
    ]);
    expect(dialog).toHaveTextContent("Pull request #42 isn’t merged yet.");
    expect(dialog).toHaveTextContent(
      "Left behind: the agents’ full conversations" +
        "They stay with run #12. Open it and use Ask if you need something from them.",
    );
    expect(dialog).toHaveTextContent("Uses the team as it is now (v7)");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
    // Nothing to start until the person says what the team should do next.
    expect(within(dialog).getByRole("button", { name: "Start run" })).toBeDisabled();
  });

  it("sends the task, what the person ticked and where to start from", () => {
    const { dialog, onStart } = open(INFO);
    fireEvent.change(within(dialog).getByLabelText("What should the team do next?"), {
      target: { value: "Add a MACD indicator, with tests." },
    });
    fireEvent.click(box(dialog, /^Your decisions/));
    fireEvent.click(box(dialog, /^A short summary/));
    expect(box(dialog, /^Your decisions/)).not.toBeChecked();
    fireEvent.change(within(dialog).getByLabelText("Start from"), { target: { value: "main" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start run" }));
    expect(onStart).toHaveBeenCalledWith({
      task: "Add a MACD indicator, with tests.",
      carry: { spec: true, decisions: false, memories: true, summaries: false },
      start_from: "main",
    });
  });

  it("a merged pull request: starts from main only; nothing decided: Your decisions (none) (Next-CarryMerged)", () => {
    const { dialog, onStart } = open(MERGED);
    const from = within(dialog).getByLabelText<HTMLSelectElement>("Start from");
    expect(from.value).toBe("main");
    expect(Array.from(from.options).map((o) => o.text)).toEqual(["main"]);
    expect(dialog).toHaveTextContent(
      "Pull request #42 is merged, so the new run starts from main.",
    );
    const decisions = box(dialog, /^Your decisions \(none\)/);
    expect(decisions).not.toBeChecked();
    expect(decisions).toBeDisabled();
    expect(decisions.closest("label")).toHaveTextContent(
      "You didn’t approve or change anything in run #12.",
    );
    fireEvent.change(within(dialog).getByLabelText("What should the team do next?"), {
      target: { value: "Add MACD" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start run" }));
    expect(onStart).toHaveBeenCalledWith({
      task: "Add MACD",
      carry: { spec: true, decisions: false, memories: true, summaries: true },
      start_from: "main",
    });
  });

  it("a refusal shows its reason above the footer and the dialog stays open", async () => {
    let refuse: (e: unknown) => void = () => {};
    const onStart = vi.fn<Start>(
      () =>
        new Promise((_, reject) => {
          refuse = reject;
        }),
    );
    const { dialog, onCancel } = open(MERGED, onStart);
    fireEvent.change(within(dialog).getByLabelText("What should the team do next?"), {
      target: { value: "Add MACD" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start run" }));
    // On its way: nothing cancels it.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onCancel).not.toHaveBeenCalled();
    act(() =>
      refuse(
        new ApiDetailError(
          429,
          "You have 3 runs going, the most at once. Start this one when one of them finishes.",
          null,
        ),
      ),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You have 3 runs going, the most at once. Start this one when one of them finishes.",
    );
    expect(screen.getByRole("dialog", { name: "Start a new run from run #12" })).toBe(dialog);
    expect(within(dialog).getByRole("button", { name: "Start run" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("full run slots: the server's 429 reads as the board's sentence (Next-CarryMerged)", async () => {
    const onStart = vi.fn<Start>(() =>
      Promise.reject(
        new ApiDetailError(
          429,
          "you already have 3 run(s) in flight (limit 3) — wait for one to finish, or cancel it",
          {
            code: "owner_concurrency_limit",
            message:
              "you already have 3 run(s) in flight (limit 3) — wait for one to finish, or cancel it",
          },
        ),
      ),
    );
    const { dialog } = open(MERGED, onStart);
    fireEvent.change(within(dialog).getByLabelText("What should the team do next?"), {
      target: { value: "Add MACD" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start run" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You have 3 runs going, the most at once. Start this one when one of them finishes.",
    );
  });

  it("the spec's line names the team's first agent", () => {
    const { dialog } = open({ ...INFO, entry_agent: "Spec writer" });
    expect(dialog).toHaveTextContent(
      "Becomes the starting spec. The spec writer updates it for the new task.",
    );
  });

  it("Close and Escape cancel", () => {
    const { dialog, onCancel } = open(INFO);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

describe("StartedFrom (Next-Started)", () => {
  it("the run bar's From run #12 links to that run", () => {
    render(
      <StartedFrom
        from={{ run_id: "run-12", number: 12, summary: "brought spec v3" }}
        teamId="team-1"
      />,
    );
    expect(screen.getByRole("link", { name: "From run #12" })).toHaveAttribute(
      "href",
      "#/teams/team-1/runs/run-12",
    );
  });
});

describe("CameAlong (Next-CameAlong)", () => {
  const SNAPSHOT: CarrySnapshot = {
    from: { run_id: "run-12", number: 12 },
    spec: { version: 3 },
    decisions: INFO.decisions,
    memories: INFO.memories,
    summaries: [
      { agent: "Product manager", text: "Wrote the RSI spec (v3) and its acceptance tests." },
      { agent: "Engineer", text: "Added RSI to core/indicators.py in 3 rounds." },
    ],
  };
  afterEach(() => vi.unstubAllGlobals());

  it("See what came along opens what run #12 brought, read from the run's carry", async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(new Response(JSON.stringify(url.endsWith("/carry") ? SNAPSHOT : {}))),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<CameAlong runId="run-14" />);
    fireEvent.click(screen.getByRole("button", { name: "See what came along" }));
    const pop = await screen.findByRole("dialog", { name: "What came along from run #12" });
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-14/carry", expect.anything());
    const text = (s: string) => expect(pop).toHaveTextContent(s);
    text("The final specSpec v3 · became this run’s starting spec");
    text("Your decisions (2)Spec approvedThe reviewer’s rule: every indicator is registered");
    text("What the agents learned (3 memories)Register every indicator on INDICATORS");
    text("Run python -m pytest -q tests/test_indicators.py before you finish");
    text("A short summary from each agentProduct manager · Wrote the RSI spec (v3)");
    text("Engineer · Added RSI to core/indicators.py in 3 rounds.");
    text("Left behind: the agents’ full conversations. They stay with run #12.");
    fireEvent.click(within(pop).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens over the top of the Activity panel, 8px down, and scrolls when the window is short", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(SNAPSHOT)))),
    );
    render(
      <section aria-label="Activity">
        <CameAlong runId="run-14" />
      </section>,
    );
    const section = screen.getByRole("region", { name: "Activity" });
    section.getBoundingClientRect = () => ({ top: 228 }) as DOMRect;
    fireEvent.click(screen.getByRole("button", { name: "See what came along" }));
    const pop = await screen.findByRole("dialog", { name: "What came along from run #12" });
    expect(pop.style.top).toBe("236px");
    expect(pop.style.maxHeight).toBe("calc(100vh - 252px)");
  });

  it("leaves out what didn't come along", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ...SNAPSHOT, spec: null, decisions: [], summaries: [] })),
        ),
      ),
    );
    render(<CameAlong runId="run-14" />);
    fireEvent.click(screen.getByRole("button", { name: "See what came along" }));
    const pop = await screen.findByRole("dialog", { name: "What came along from run #12" });
    expect(pop).not.toHaveTextContent("The final spec");
    expect(pop).not.toHaveTextContent("Your decisions");
    expect(pop).not.toHaveTextContent("A short summary");
    expect(pop).toHaveTextContent("What the agents learned (3 memories)");
  });
});
