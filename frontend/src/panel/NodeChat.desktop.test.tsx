import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import { askNode } from "../lib/api";
import { NodeChat } from "./NodeChat";

vi.mock("../lib/api", () => ({ askNode: vi.fn() }));

// M-desk-routes (D5): while a Desktop Ask waits, the chat keeps its existing "Thinking…"; one that
// couldn't be answered says why in the existing error line.

afterEach(() => vi.clearAllMocks());

describe("NodeChat — an Ask answered on the Desktop", () => {
  it("keeps Thinking… while it waits, then shows the answer", async () => {
    let finish: (v: { answer: string }) => void = () => undefined;
    (askNode as Mock).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<NodeChat runId="r1" nodeId="n1" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Ask this node" }), {
      target: { value: "Why did you change README.md?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Thinking…")).toBeInTheDocument();
    finish({ answer: "It added the line." });
    expect(await screen.findByText("It added the line.")).toBeInTheDocument();
    expect(screen.queryByText("Thinking…")).toBeNull();
  });

  it("an Ask the Desktop couldn't answer says why", async () => {
    const offline = "Tvashtr Desktop went offline — reopen it and retry.";
    (askNode as Mock).mockRejectedValue(Object.assign(new Error(offline), { askError: offline }));
    render(<NodeChat runId="r1" nodeId="n1" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Ask this node" }), {
      target: { value: "Why?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(offline)).toBeInTheDocument();
  });
});
