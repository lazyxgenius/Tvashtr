import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ResumeInfo, ResumePoint } from "../../../lib/api/resume";
import { ApiDetailError } from "../../../lib/api/runs";
import { pushOverlay, removeOverlay } from "../../../lib/overlayStack";
import { ResumeConfirm, ResumedFrom, ResumePick } from "./Resume";

const T = (h: number, m: number, s = 0) => new Date(2026, 9, 2, h, m, s).toISOString();

const CONFIRM = {
  title: "Resume from Engineer, round 2?",
  step_label: "Engineer, round 2",
  kept: [
    { text: "Spec v2", at: null },
    { text: "Your approval", at: T(10, 43, 10) },
    {
      text: "Engineer round 1: changes to core/indicators.py and tests/test_indicators.py",
      at: null,
    },
    { text: "Reviewer round 1: the 2 fixes it asked for", at: null },
  ],
  runs_again: [
    "Engineer · round 2",
    "Reviewer · round 2, and round 3 if it asks for more",
    "Ship, if the reviewer approves",
  ],
  skips_cost_usd: 0.56,
  skips_s: 480,
};

const point = (over: Partial<ResumePoint>): ResumePoint => ({
  invocation_id: 101,
  node_id: "n-pm",
  origin_node_id: null,
  label: "Product manager",
  kind: "agent",
  iteration: 1,
  title: "Product manager",
  text: "Wrote the spec (v2)",
  at: T(10, 42, 5),
  cost_usd: 0.06,
  state: "kept",
  resumable: true,
  confirm: { ...CONFIRM, title: "Resume from Product manager?" },
  ...over,
});

const POINTS: ResumePoint[] = [
  point({}),
  point({
    invocation_id: 102,
    node_id: "n-prd",
    label: "Approval gate",
    kind: "gate",
    title: "Approval gate",
    text: "You approved the spec",
    at: T(10, 43, 10),
    cost_usd: null,
    resumable: false,
    confirm: null,
  }),
  point({
    invocation_id: 103,
    node_id: "n-eng",
    label: "Engineer",
    title: "Engineer · round 1",
    text: "Edited 2 files · tests passed",
    at: T(10, 46, 12),
    cost_usd: 0.41,
  }),
  point({
    invocation_id: 105,
    node_id: "n-eng",
    label: "Engineer",
    iteration: 2,
    title: "Engineer · round 2",
    text: "Failed: the model didn’t answer",
    at: T(10, 59, 5),
    cost_usd: 0.28,
    state: "suggested",
    confirm: CONFIRM,
  }),
];

const info = (over: Partial<ResumeInfo> = {}): ResumeInfo => ({
  run_id: "r-12",
  number: 12,
  next_number: 13,
  available: true,
  reason: null,
  stops_run: false,
  points: POINTS,
  ...over,
});

describe("ResumePick (Prob-Pick)", () => {
  it("lists the steps Kept / Suggested with time and cost, and Resume from here on agent steps only", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<ResumePick info={info()} onPick={onPick} onClose={onClose} />);
    const panel = screen.getByRole("complementary", { name: "Resume run #12" });
    expect(
      within(panel).getByText("Pick where to start again. Everything before that step is kept."),
    ).toBeInTheDocument();
    expect(within(panel).getAllByText("Kept")).toHaveLength(3);
    expect(within(panel).getByText("Suggested")).toBeInTheDocument();
    // Local clock time, and the cost when the step has one (a gate has none).
    expect(within(panel).getByText("10:42 · $0.06")).toBeInTheDocument();
    expect(within(panel).getByText("10:43")).toBeInTheDocument();
    expect(within(panel).getByText("10:59 · $0.28")).toBeInTheDocument();
    // The gate has no button: three agent steps can resume.
    const buttons = within(panel).getAllByRole("button", { name: "Resume from here" });
    expect(buttons).toHaveLength(3);
    // The suggested step's is the primary one.
    expect(buttons[2]).toHaveClass("ds-btn--primary");
    expect(buttons[0]).toHaveClass("ds-btn--ghost");
    fireEvent.click(buttons[2]);
    expect(onPick).toHaveBeenCalledWith(POINTS[3]);
    expect(within(panel).getByText("Uses the same team setup as run #12")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("drops the number for a run without one", () => {
    render(<ResumePick info={info({ number: null })} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("complementary", { name: "Resume this run" })).toBeInTheDocument();
    expect(screen.getByText("Uses the same team setup as this run")).toBeInTheDocument();
  });
  it("lists steps carried from an earlier run (no step of this run) once each, never resumable", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const carried = (node_id: string, title: string) =>
      point({
        invocation_id: null,
        node_id,
        title,
        text: "From run #11",
        resumable: false,
        confirm: null,
        from_run: { run_id: "r-11", number: 11 },
      });
    render(
      <ResumePick
        info={info({
          points: [
            carried("n-pm", "Product manager"),
            carried("n-prd", "Approval gate"),
            POINTS[3],
          ],
        })}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const panel = screen.getByRole("complementary", { name: "Resume run #12" });
    expect(within(panel).getAllByText("From run #11")).toHaveLength(2);
    expect(within(panel).getAllByRole("button", { name: "Resume from here" })).toHaveLength(1);
    // No React key warning for the carried steps (they have no invocation id).
    expect(err.mock.calls.flat().join(" ")).not.toMatch(/key/);
    err.mockRestore();
  });

  it("takes focus on its Close, and Escape closes it unless a dialog is on top", () => {
    const onClose = vi.fn();
    render(<ResumePick info={info()} onPick={vi.fn()} onClose={onClose} />);
    const panel = screen.getByRole("complementary", { name: "Resume run #12" });
    expect(within(panel).getByRole("button", { name: "Close" })).toHaveFocus();
    const dialog = pushOverlay();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    removeOverlay(dialog);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ResumeConfirm (Prob-Confirm)", () => {
  it("says what is kept, what runs again and what it skips, then resumes", async () => {
    const onResume = vi.fn(() => Promise.resolve());
    render(
      <ResumeConfirm info={info()} point={POINTS[3]} onResume={onResume} onCancel={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog", { name: "Resume from Engineer, round 2?" });
    expect(dialog).toHaveTextContent("This starts run #13. It picks up where run #12 stopped.");
    expect(within(dialog).getByText("Your approval, 10:43")).toBeInTheDocument();
    // File paths are set as code.
    expect(within(dialog).getByText("core/indicators.py").tagName).toBe("CODE");
    expect(within(dialog).getByText("tests/test_indicators.py").tagName).toBe("CODE");
    expect(within(dialog).getByText("Ship, if the reviewer approves")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Skips work that already cost $0.56 and took about 8 minutes"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("You only pay for the steps that run again."),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Uses the same team setup as run #12. Changes you made to the team since then are not used.",
    );
    expect(dialog).toHaveTextContent("Run #12 stays as it is");
    fireEvent.click(within(dialog).getByRole("button", { name: "Resume run" }));
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));
  });

  it("a stalled run: Resume stops it first (Prob-ConfirmStalled)", () => {
    render(
      <ResumeConfirm
        info={info({ stops_run: true })}
        point={POINTS[3]}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "This stops run #12 and starts run #13. It picks up where run #12 got to.",
    );
    expect(dialog).toHaveTextContent("Run #12 is stopped first. What it did stays as it is");
  });

  it("shows a refusal's reason in the dialog, never silently", async () => {
    const onResume = vi.fn(() =>
      Promise.reject(
        new ApiDetailError(409, "This run already has a resumed run that is still going", null),
      ),
    );
    const onCancel = vi.fn();
    render(
      <ResumeConfirm info={info()} point={POINTS[3]} onResume={onResume} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This run already has a resumed run that is still going",
    );
    // Still open, and the person can try again or cancel.
    expect(screen.getByRole("button", { name: "Resume run" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("while Resume run is on its way nothing cancels it, and a late refusal still shows", async () => {
    let refuse: (e: Error) => void = () => undefined;
    const onResume = vi.fn(
      () =>
        new Promise((_, reject) => {
          refuse = reject;
        }),
    );
    const onCancel = vi.fn();
    render(
      <ResumeConfirm info={info()} point={POINTS[3]} onResume={onResume} onCancel={onCancel} />,
    );
    const dialog = screen.getByRole("dialog", { name: "Resume from Engineer, round 2?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Resume run" }));
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));
    // Escape, the scrim, the X and Cancel all wait for the answer.
    fireEvent.keyDown(document, { key: "Escape" });
    const scrim = document.querySelector(".ds-scrim");
    if (scrim) fireEvent.click(scrim);
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onCancel).not.toHaveBeenCalled();
    act(() => refuse(new ApiDetailError(429, "You have 3 runs going.", null)));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("You have 3 runs going.");
    // Answered: closing works again.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("ResumedFrom (Prob-Resumed's run bar)", () => {
  it("links to the run this one resumed", () => {
    render(
      <ResumedFrom
        from={{ run_id: "r-12", number: 12, step_label: "Engineer, round 2" }}
        teamId="t-ind"
      />,
    );
    expect(screen.getByRole("link", { name: "Resumed from #12" })).toHaveAttribute(
      "href",
      "#/teams/t-ind/runs/r-12",
    );
  });
});
