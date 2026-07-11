import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { askNode } from "../lib/api";
import { NodeChat } from "./NodeChat";

// Mock the api module (mirrors SkillsSection.test / ToolsSection.test): the factory returns only the
// fn NodeChat imports. fireEvent throughout (HANDOVER §4: user-event deadlocks vitest fake timers).
vi.mock("../lib/api", () => ({ askNode: vi.fn() }));
const mockAsk = askNode as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

describe("NodeChat — Mode A ask-the-node chat (client-held history)", () => {
  it("shows the empty prompt, then sends a question and renders the reply", async () => {
    mockAsk.mockResolvedValue({ answer: "I added bulk_discount to pricing.py." });
    render(<NodeChat runId="r1" nodeId="n-eng" />);

    // empty-state hint before any turn
    expect(screen.getByText(/answered only from its recorded/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Ask this node"), {
      target: { value: "What did you change?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // the user's turn renders immediately…
    expect(screen.getByText("What did you change?")).toBeInTheDocument();
    // …and the reply after the mocked askNode resolves
    expect(await screen.findByText("I added bulk_discount to pricing.py.")).toBeInTheDocument();
    // called with (runId, nodeId, [the client history incl. the new turn])
    expect(mockAsk).toHaveBeenCalledWith("r1", "n-eng", [
      { role: "user", content: "What did you change?" },
    ]);
  });

  it("keeps the running history across turns (sends the whole transcript each time)", async () => {
    mockAsk.mockResolvedValueOnce({ answer: "First answer." });
    render(<NodeChat runId="r1" nodeId="n-eng" />);

    fireEvent.change(screen.getByLabelText("Ask this node"), { target: { value: "q1" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("First answer.")).toBeInTheDocument();

    mockAsk.mockResolvedValueOnce({ answer: "Second answer." });
    fireEvent.change(screen.getByLabelText("Ask this node"), { target: { value: "q2" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Second answer.")).toBeInTheDocument();

    // the second call carries the FULL prior transcript + the new question
    expect(mockAsk).toHaveBeenLastCalledWith("r1", "n-eng", [
      { role: "user", content: "q1" },
      { role: "assistant", content: "First answer." },
      { role: "user", content: "q2" },
    ]);
  });

  it("shows an error note when the ask fails (and does not crash)", async () => {
    mockAsk.mockRejectedValue(new Error("boom"));
    render(<NodeChat runId="r1" nodeId="n-eng" />);

    fireEvent.change(screen.getByLabelText("Ask this node"), { target: { value: "why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/couldn't get an answer/i)).toBeInTheDocument();
  });

  it("disables sending when there is no run to ask about", () => {
    render(<NodeChat runId={null} nodeId="n-eng" />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
