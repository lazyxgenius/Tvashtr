import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSkillLibraryItem, listSkillLibrary, listSkillPresets } from "../lib/api";
import { SkillsSection } from "./SkillsSection";

vi.mock("../lib/api", () => ({
  listSkillLibrary: vi.fn(),
  listSkillPresets: vi.fn(),
  createSkillLibraryItem: vi.fn(),
}));
const mockLibrary = listSkillLibrary as unknown as ReturnType<typeof vi.fn>;
const mockPresets = listSkillPresets as unknown as ReturnType<typeof vi.fn>;
const mockCreate = createSkillLibraryItem as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockLibrary.mockResolvedValue([]);
  mockPresets.mockResolvedValue([
    {
      key: "caveman",
      name: "caveman",
      title: "Caveman (terse)",
      description: "Vendored ultra-compressed output style.",
      access: "free",
      badge: "Free",
      attachable: true,
      source: {
        type: "inline",
        name: "caveman",
        content: "Respond terse like smart caveman.",
        mode: "always",
      },
    },
  ]);
  mockCreate.mockResolvedValue({ id: "preset-1", name: "caveman" });
});
afterEach(() => vi.clearAllMocks());

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

  // ---- C7.C: "Add from library" picker + library-reference rows + the overridden tag ----

  it("picking a library skill appends a {type:'library',id} source and renders a Library row", async () => {
    const onChange = vi.fn();
    mockLibrary.mockResolvedValue([
      {
        id: "s1",
        name: "house-style",
        source: { type: "inline", name: "house-style", content: "B", mode: "always" },
        created_at: "x",
      },
    ]);
    render(<SkillsSection value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add from library" }));
    await waitFor(() => screen.getByRole("button", { name: "Add house-style from library" }));
    fireEvent.click(screen.getByRole("button", { name: "Add house-style from library" }));
    expect(onChange).toHaveBeenCalledWith([{ type: "library", id: "s1" }]);
  });

  it("shows an 'overridden' tag when a library skill's name collides with an earlier inline skill", async () => {
    mockLibrary.mockResolvedValue([
      {
        id: "s1",
        name: "DUP",
        source: { type: "inline", name: "DUP", content: "lib", mode: "always" },
        created_at: "x",
      },
    ]);
    render(
      <SkillsSection
        value={[
          { type: "inline", name: "DUP", content: "first", mode: "always" },
          { type: "library", id: "s1" },
        ]}
        onChange={vi.fn()}
      />,
    );
    // the library row (second, resolving to the same name "DUP") is the overridden one
    await waitFor(() => expect(screen.getByText("overridden")).toBeInTheDocument());
  });
});

describe("SkillsSection presets", () => {
  it("Add from presets lists caveman and attaches via skill library", async () => {
    const onChange = vi.fn();
    render(<SkillsSection value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add from presets" }));
    await waitFor(() => screen.getByRole("button", { name: "Add caveman from presets" }));
    fireEvent.click(screen.getByRole("button", { name: "Add caveman from presets" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith("caveman", {
        type: "inline",
        name: "caveman",
        content: "Respond terse like smart caveman.",
        mode: "always",
      }),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([{ type: "library", id: "preset-1" }]),
    );
  });
});
