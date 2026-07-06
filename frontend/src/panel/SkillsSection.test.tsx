import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SkillsSection } from "./SkillsSection";

// M-tools C7.0 (scaffold): the Skills stub — a JSON editor (array of inline skill sources) wired to
// onChange, rendered for both thinker and worker nodes.

describe("SkillsSection (M-tools C7.0 stub)", () => {
  it("renders the Skills editor and round-trips a valid JSON array through onChange", () => {
    const onChange = vi.fn();
    render(<SkillsSection value={null} onChange={onChange} />);

    expect(screen.getByText("Skills")).toBeInTheDocument();
    const ta = screen.getByLabelText("Skills JSON");
    fireEvent.change(ta, { target: { value: '[{"name":"AGENTS.md"}]' } });
    expect(onChange).toHaveBeenCalledWith([{ name: "AGENTS.md" }]);
  });

  it("seeds the textarea from an existing skills value", () => {
    render(<SkillsSection value={[{ name: "x" }]} onChange={vi.fn()} />);
    expect(screen.getByLabelText<HTMLTextAreaElement>("Skills JSON").value).toContain("name");
  });

  it("clears to null when the editor is emptied", () => {
    const onChange = vi.fn();
    render(<SkillsSection value={[{ name: "x" }]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Skills JSON"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
