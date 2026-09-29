import { describe, expect, it } from "vitest";

import {
  canContinueProject,
  type FolderState,
  folderStateFor,
  githubRepoOf,
  gitRepoLine,
  gitSetUpLine,
  workspaceFor,
} from "./projectFolder";

const NOTES = { path: "/Users/ada/Documents/notes", displayPath: "~/Documents/notes" };
const repo = (branch: string | null, remote: string | null) => ({
  is_git: true as const,
  current_branch: branch,
  branches: branch ? [branch] : [],
  tracked_file_count: 3,
  subpaths: [],
  remote_url: remote,
});

describe("the folder card's copy (DT-30)", () => {
  it("reads owner/repo from every GitHub remote form", () => {
    for (const remote of [
      "https://github.com/lazyxgenius/trade_mcp.git",
      "https://github.com/lazyxgenius/trade_mcp",
      "git@github.com:lazyxgenius/trade_mcp.git",
      "ssh://git@github.com/lazyxgenius/trade_mcp.git",
    ]) {
      expect(githubRepoOf(remote)).toBe("lazyxgenius/trade_mcp");
    }
    expect(githubRepoOf("https://gitlab.com/a/b.git")).toBeNull();
    expect(githubRepoOf(null)).toBeNull();
  });

  it("says git repo · branch · owner/repo, no remote yet, or just the branch", () => {
    expect(gitRepoLine("main", "https://github.com/lazyxgenius/trade_mcp.git")).toBe(
      "git repo · branch main · lazyxgenius/trade_mcp",
    );
    expect(gitRepoLine("dev", null)).toBe("git repo · branch dev · no remote yet");
    expect(gitRepoLine("main", "https://gitlab.com/a/b.git")).toBe("git repo · branch main");
    expect(gitSetUpLine("main")).toBe("git set up · branch main · no remote yet");
  });

  it("maps what the bridge read to states b, c and the error box", () => {
    expect(folderStateFor(NOTES, repo("main", null))).toEqual({
      phase: "git",
      folder: NOTES,
      line: "git repo · branch main · no remote yet",
    });
    expect(
      folderStateFor(NOTES, {
        is_git: false,
        error: "This folder isn't a git repository.",
        reason: "not_git",
      }),
    ).toEqual({ phase: "not_git", folder: NOTES, settingUp: false, error: null });
    // An older Desktop sends no reason.
    expect(
      folderStateFor(NOTES, { is_git: false, error: "This folder isn't a git repository." }).phase,
    ).toBe("not_git");
    const inside =
      "This folder is inside the git repository at ~/code. Choose that folder instead.";
    expect(folderStateFor(NOTES, { is_git: false, error: inside, reason: "inside_repo" })).toEqual({
      phase: "error",
      folder: NOTES,
      message: inside,
    });
    expect(folderStateFor(NOTES, repo(null, null))).toEqual({
      phase: "error",
      folder: NOTES,
      message: "~/Documents/notes is on a detached HEAD. Check out a branch, then choose it again.",
    });
  });
});

describe("Continue and what it saves (DT-32, OQ-20)", () => {
  const git: FolderState = { phase: "git", folder: NOTES, line: "x" };
  const notGit: FolderState = { phase: "not_git", folder: NOTES, settingUp: false, error: null };

  it("needs a git folder, a repo, or nothing for decide-at-launch", () => {
    expect(canContinueProject("folder", { phase: "none" }, null)).toBe(false);
    expect(canContinueProject("folder", notGit, null)).toBe(false);
    expect(canContinueProject("folder", { phase: "reading", folder: NOTES }, null)).toBe(false);
    expect(canContinueProject("folder", git, null)).toBe(true);
    expect(canContinueProject("github", git, null)).toBe(false);
    expect(canContinueProject("github", { phase: "none" }, "a/b")).toBe(true);
    expect(canContinueProject("ask", { phase: "none" }, null)).toBe(true);
  });

  it("saves the folder, the repo or ask — never a path for GitHub or ask", () => {
    expect(workspaceFor("folder", git, "a/b")).toEqual({ kind: "folder", ...NOTES });
    expect(workspaceFor("github", git, "a/b")).toEqual({ kind: "github", repo: "a/b" });
    expect(workspaceFor("ask", git, null)).toEqual({ kind: "ask" });
    expect(workspaceFor("folder", notGit, null)).toBeNull();
  });
});
