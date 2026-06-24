import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { HumanTask } from "../lib/api";
import { TasksDrawer } from "./TasksDrawer";

// Brief §2.3.3: (a) an empty inbox renders NOTHING (returns null); (b) blockers (High) sit above
// nudges (Low), Approve/Reject resolve a blocker and Dismiss acknowledges a nudge, each through
// the right handler.

function mkTask(over: Partial<HumanTask> & Pick<HumanTask, "id">): HumanTask {
  return {
    run_id: "r1",
    kind: "gate_approval",
    priority: "high_blocker",
    blocking: true,
    topic: null,
    title: "A task",
    description: "Review the spec and decide.",
    status: "pending",
    resolution: null,
    resolution_note: null,
    created_at: "2026-01-01T00:00:00Z",
    resolved_at: null,
    ...over,
  };
}

const noop = () => {};

describe("TasksDrawer — empty inbox", () => {
  it("renders nothing when there are no blockers and no nudges", () => {
    const { container } = render(
      <TasksDrawer
        blockers={[]}
        nudges={[]}
        onResolve={noop}
        onAcknowledge={noop}
        onFocusNode={noop}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TasksDrawer — High above Low + the right handlers", () => {
  const blocker = mkTask({
    id: 10,
    blocking: true,
    priority: "high_blocker",
    topic: "gate:r1:n-gate",
    title: "Approve the PRD",
  });
  const nudge = mkTask({
    id: 20,
    blocking: false,
    priority: "low_nudge",
    topic: null,
    title: "Budget heads up",
  });

  it("orders the High (Needs your approval) section above the Low (Heads up) section", () => {
    render(
      <TasksDrawer
        blockers={[blocker]}
        nudges={[nudge]}
        onResolve={noop}
        onAcknowledge={noop}
        onFocusNode={noop}
      />,
    );
    const high = screen.getByText("Needs your approval");
    const low = screen.getByText("Heads up");
    // High precedes Low in document order.
    expect(high.compareDocumentPosition(low) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Approve / Reject call onResolve with the right decision; Dismiss calls onAcknowledge", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const onAcknowledge = vi.fn();
    const onFocusNode = vi.fn();
    render(
      <TasksDrawer
        blockers={[blocker]}
        nudges={[nudge]}
        onResolve={onResolve}
        onAcknowledge={onAcknowledge}
        onFocusNode={onFocusNode}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(onResolve).toHaveBeenCalledWith(10, "approve");

    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(onResolve).toHaveBeenCalledWith(10, "reject");

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onAcknowledge).toHaveBeenCalledWith(20);

    // The gate-linked blocker body frames its node on the canvas.
    await user.click(screen.getByText("Show on canvas →"));
    expect(onFocusNode).toHaveBeenCalledWith("n-gate");
  });
});
