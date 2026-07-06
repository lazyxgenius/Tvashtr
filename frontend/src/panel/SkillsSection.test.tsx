import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SkillsSection } from "./SkillsSection";

// M-tools C7.B: the real per-node Skills editor (replaces the C7.0 JSON-textarea stub). Authors the
// `skills` source array (inline / repo / project_rules); clearing the last source emits onChange(null).
// fireEvent throughout (HANDOVER §4: user-event deadlocks vitest fake timers).

describe("SkillsSection (M-tools C7.B)", () => {
  it("renders the inline, repo, and use-repo-rules controls (both node kinds)", () => {
    render(<SkillsSection value={null} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Skill name")).toBeInTheDocument();
    expect(screen.getByLabelText("Skill content (SKILL.md)")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Disclosure mode" })).toBeInTheDocument();
    expect(screen.getByLabelText("Repository URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Use this repo's own rules")).toBeInTheDocument();
  });

  it("appends an inline source with the chosen disclosure mode", () => {
    const onChange = vi.fn();
    render(<SkillsSection value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Skill name"), { target: { value: "house-style" } });
    fireEvent.change(screen.getByLabelText("Skill content (SKILL.md)"), {
      target: { value: "prefer small diffs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agent decides" }));
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    expect(onChange).toHaveBeenCalledWith([
      { type: "inline", name: "house-style", content: "prefer small diffs", mode: "agent" },
    ]);
  });

  it("captures trigger words when the mode is On trigger", () => {
    const onChange = vi.fn();
    render(<SkillsSection value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Skill name"), { target: { value: "sql" } });
    fireEvent.change(screen.getByLabelText("Skill content (SKILL.md)"), {
      target: { value: "use indexes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "On trigger" }));
    fireEvent.change(screen.getByLabelText("Trigger words"), {
      target: { value: "database, query" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    expect(onChange).toHaveBeenCalledWith([
      {
        type: "inline",
        name: "sql",
        content: "use indexes",
        mode: "trigger",
        triggers: ["database", "query"],
      },
    ]);
  });

  it("appends a repo source from a URL + ref", () => {
    const onChange = vi.fn();
    render(<SkillsSection value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Repository URL"), {
      target: { value: "https://github.com/org/skills" },
    });
    fireEvent.change(screen.getByLabelText("Repository ref"), { target: { value: "v1.0.0" } });
    fireEvent.click(screen.getByRole("button", { name: "Add repo" }));
    expect(onChange).toHaveBeenCalledWith([
      { type: "repo", url: "https://github.com/org/skills", ref: "v1.0.0" },
    ]);
  });

  it("toggles the single project_rules source on and off", () => {
    const onAdd = vi.fn();
    const { rerender } = render(<SkillsSection value={null} onChange={onAdd} />);
    fireEvent.click(screen.getByLabelText("Use this repo's own rules"));
    expect(onAdd).toHaveBeenCalledWith([{ type: "project_rules" }]);

    // Present already => toggling off clears to null (it was the only source).
    const onRemove = vi.fn();
    rerender(<SkillsSection value={[{ type: "project_rules" }]} onChange={onRemove} />);
    fireEvent.click(screen.getByLabelText("Use this repo's own rules"));
    expect(onRemove).toHaveBeenCalledWith(null);
  });

  it("renders a badge per source type", () => {
    render(
      <SkillsSection
        value={[
          { type: "inline", name: "a", content: "x", mode: "always" },
          { type: "repo", url: "u", ref: "r" },
          { type: "project_rules" },
        ]}
        onChange={vi.fn()}
      />,
    );
    const rows = screen.getByLabelText("Skill sources");
    expect(within(rows).getByText("Inline")).toBeInTheDocument();
    expect(within(rows).getByText("Repo")).toBeInTheDocument();
    expect(within(rows).getByText("Repo rules")).toBeInTheDocument();
  });

  it("clears to null when the last source is removed", () => {
    const onChange = vi.fn();
    render(
      <SkillsSection
        value={[{ type: "inline", name: "only", content: "x", mode: "always" }]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove only" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
