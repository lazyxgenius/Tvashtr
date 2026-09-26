/**
 * Pure pieces of setup's Project step (desktop-app.md DT-30..DT-32): what the folder card says for
 * a folder, and when Continue is on.
 */
import type { PickedFolder, RepoInspection } from "../../../lib/desktopApp";
import type { DesktopSetup } from "../../../lib/desktopSetup";

export type ProjectChoice = "folder" | "github" | "ask";

export const PROJECT_CHOICES: readonly ProjectChoice[] = ["folder", "github", "ask"];

/** The folder card's states (DT-30 a–d, plus the in-between and error states). */
export type FolderState =
  /** (a) nothing chosen yet */
  | { phase: "none" }
  /** the picker is open, or the folder is being read */
  | { phase: "reading"; folder: PickedFolder | null }
  /** (b) a git repo, or (d) one git was just set up in: the sage line */
  | { phase: "git"; folder: PickedFolder; line: string }
  /** (c) not a git repository: offer Set up git here (`error` = a failed set-up's copy) */
  | { phase: "not_git"; folder: PickedFolder; settingUp: boolean; error: string | null }
  /** inside a repo, missing, detached HEAD, git missing: only Choose another folder */
  | { phase: "error"; folder: PickedFolder | null; message: string };

/** `owner/repo` for a GitHub remote (https, scp-style or ssh URL), else null. */
export function githubRepoOf(remote: string | null): string | null {
  if (!remote) return null;
  const m =
    /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
      remote.trim(),
    );
  return m ? `${m[1]}/${m[2]}` : null;
}

/** (b): "git repo · branch main · lazyxgenius/trade_mcp" (or "· no remote yet"). */
export function gitRepoLine(branch: string, remote: string | null): string {
  const repo = githubRepoOf(remote);
  if (repo) return `git repo · branch ${branch} · ${repo}`;
  return remote ? `git repo · branch ${branch}` : `git repo · branch ${branch} · no remote yet`;
}

/** (d): right after Set up git here. */
export function gitSetUpLine(branch: string): string {
  return `git set up · branch ${branch} · no remote yet`;
}

/** The folder card for a folder the bridge just read. */
export function folderStateFor(folder: PickedFolder, inspection: RepoInspection): FolderState {
  if (inspection.is_git) {
    if (!inspection.current_branch) {
      return {
        phase: "error",
        folder,
        message: `${folder.displayPath} is on a detached HEAD. Check out a branch, then choose it again.`,
      };
    }
    return {
      phase: "git",
      folder,
      line: gitRepoLine(inspection.current_branch, inspection.remote_url),
    };
  }
  // An older Desktop sends no reason: its only "not a repo" copy is this one.
  const notGit =
    inspection.reason === "not_git" ||
    (inspection.reason === undefined && inspection.error === "This folder isn't a git repository.");
  if (notGit) return { phase: "not_git", folder, settingUp: false, error: null };
  return { phase: "error", folder, message: inspection.error };
}

/** DT-32 (OQ-20): a folder needs git (b/d); GitHub needs a repo; "decide later" always. */
export function canContinueProject(
  choice: ProjectChoice,
  folder: FolderState,
  repo: string | null,
): boolean {
  if (choice === "folder") return folder.phase === "git";
  if (choice === "github") return Boolean(repo);
  return true;
}

/** What Continue saves on this Mac (DB-4); null when Continue is off. */
export function workspaceFor(
  choice: ProjectChoice,
  folder: FolderState,
  repo: string | null,
): DesktopSetup["workspace"] {
  if (!canContinueProject(choice, folder, repo)) return null;
  if (choice === "folder" && folder.phase === "git") {
    return { kind: "folder", path: folder.folder.path, displayPath: folder.folder.displayPath };
  }
  if (choice === "github" && repo) return { kind: "github", repo };
  return { kind: "ask" };
}
