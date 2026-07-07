import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSkillLibraryItem,
  deleteSkillLibraryItem,
  listSkillLibrary,
  updateSkillLibraryItem,
} from "../lib/api";
import { SkillsShelf } from "./SkillsShelf";

// M-tools C7.C — the account Skill library shelf. Mock the CRUD client (no network).
vi.mock("../lib/api", () => ({
  listSkillLibrary: vi.fn(),
  createSkillLibraryItem: vi.fn(),
  updateSkillLibraryItem: vi.fn(),
  deleteSkillLibraryItem: vi.fn(),
}));
const mList = listSkillLibrary as unknown as ReturnType<typeof vi.fn>;
const mCreate = createSkillLibraryItem as unknown as ReturnType<typeof vi.fn>;
const mUpdate = updateSkillLibraryItem as unknown as ReturnType<typeof vi.fn>;
const mDelete = deleteSkillLibraryItem as unknown as ReturnType<typeof vi.fn>;

const ROW = {
  id: "s1",
  name: "house-style",
  source: { type: "inline", name: "house-style", content: "B", mode: "always" },
  created_at: "x",
};

beforeEach(() => {
  mList.mockResolvedValue([]);
  mCreate.mockResolvedValue({ id: "s1", name: "house-style" });
  mUpdate.mockResolvedValue({ id: "s1", name: "house-style" });
  mDelete.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe("SkillsShelf (M-tools C7.C)", () => {
  it("lists existing library skills with an Inline/Repo badge", async () => {
    mList.mockResolvedValue([ROW]);
    render(<SkillsShelf />);
    await waitFor(() => expect(screen.getByText("house-style")).toBeInTheDocument());
    // scope to the rows list — "Inline" is also the source-type toggle label in the add form
    expect(within(screen.getByRole("list")).getByText("Inline")).toBeInTheDocument();
  });

  it("adds an inline skill (name + content + mode)", async () => {
    render(<SkillsShelf />);
    fireEvent.change(screen.getByLabelText("Skill name"), { target: { value: "house-style" } });
    fireEvent.change(screen.getByLabelText("Skill content"), {
      target: { value: "prefer small diffs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    await waitFor(() =>
      expect(mCreate).toHaveBeenCalledWith("house-style", {
        type: "inline",
        name: "house-style",
        content: "prefer small diffs",
        mode: "always",
      }),
    );
  });

  it("adds a repo skill (url + ref)", async () => {
    render(<SkillsShelf />);
    fireEvent.change(screen.getByLabelText("Skill name"), { target: { value: "team-skills" } });
    fireEvent.click(screen.getByRole("button", { name: "Repo" })); // switch source type
    fireEvent.change(screen.getByLabelText("Repository URL"), {
      target: { value: "https://github.com/org/skills" },
    });
    fireEvent.change(screen.getByLabelText("Repository ref"), { target: { value: "v1.0.0" } });
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    await waitFor(() =>
      expect(mCreate).toHaveBeenCalledWith("team-skills", {
        type: "repo",
        url: "https://github.com/org/skills",
        ref: "v1.0.0",
      }),
    );
  });

  it("edits a skill (PATCH) then removes it (DELETE)", async () => {
    mList.mockResolvedValue([ROW]);
    render(<SkillsShelf />);
    await waitFor(() => screen.getByText("house-style"));
    fireEvent.click(screen.getByRole("button", { name: "Edit house-style" }));
    fireEvent.change(screen.getByLabelText("Skill content"), { target: { value: "NEWSTYLE" } });
    fireEvent.click(screen.getByRole("button", { name: "Save skill" }));
    await waitFor(() =>
      expect(mUpdate).toHaveBeenCalledWith("s1", "house-style", {
        type: "inline",
        name: "house-style",
        content: "NEWSTYLE",
        mode: "always",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove house-style" }));
    await waitFor(() => expect(mDelete).toHaveBeenCalledWith("s1"));
  });
});
