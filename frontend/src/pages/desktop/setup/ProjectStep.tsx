import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Button, ButtonLink, Select, useToast } from "../../../design-system/components";
import { getGithubRepos, type GithubReposResponse } from "../../../lib/api";
import { getHomeConfig } from "../../../lib/api/home";
import {
  addRecentFolder,
  canInitGit,
  initGit,
  inspectFolder,
  type PickedFolder,
  pickFolder,
  thisComputer,
} from "../../../lib/desktopApp";
import { type DesktopSetup, saveDesktopSetup } from "../../../lib/desktopSetup";
import { navigate } from "../../../lib/nav";
import { CheckCircleIcon, FolderIcon, GithubIcon, WarningIcon } from "../icons";
import { leaveSetup } from "./leaveSetup";
import {
  canContinueProject,
  type FolderState,
  folderStateFor,
  gitSetUpLine,
  PROJECT_CHOICES,
  type ProjectChoice,
  workspaceFor,
} from "./projectFolder";
import { RadioCard, RadioCardGroup } from "./RadioCard";
import { SetupFrame, SetupHead } from "./SetupFrame";

const messageOf = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback;

const SAVE_FAILED = "Couldn’t save this Mac’s setup. Try again.";

/**
 * Setup step 3, Project (desktop-app.md DT-29..DT-32, DT-37): where teams work — a folder on this
 * Mac (picked, read and, when it isn't one, made a git repository), a GitHub repository, or decide
 * at launch. The choice is saved on this Mac only (OQ-23); a folder also goes first in Recent
 * folders. With teams already on the account, Continue finishes setup (DT-37).
 */
export function ProjectStep({
  login,
  setup,
  teamsAlready,
  onSwitch,
}: {
  login: string;
  setup: DesktopSetup;
  /** True when the account has library teams (step 4 is skipped); null while unknown. */
  teamsAlready: boolean | null;
  onSwitch: () => void;
}) {
  const toast = useToast();
  const saved = setup.workspace;
  const [choice, setChoice] = useState<ProjectChoice>(
    saved?.kind === "github" ? "github" : saved?.kind === "ask" ? "ask" : "folder",
  );
  const [folder, setFolder] = useState<FolderState>(
    saved?.kind === "folder"
      ? { phase: "reading", folder: { path: saved.path, displayPath: saved.displayPath } }
      : { phase: "none" },
  );
  const [repo, setRepo] = useState<string | null>(saved?.kind === "github" ? saved.repo : null);
  const [saving, setSaving] = useState(false);
  const reads = useRef(0);

  const read = useCallback(async (picked: PickedFolder) => {
    const seq = ++reads.current;
    setFolder({ phase: "reading", folder: picked });
    try {
      const inspection = await inspectFolder(picked.path);
      if (seq === reads.current) setFolder(folderStateFor(picked, inspection));
    } catch (e) {
      if (seq === reads.current) {
        setFolder({
          phase: "error",
          folder: picked,
          message: messageOf(e, "Couldn’t read that folder."),
        });
      }
    }
  }, []);

  // A folder saved earlier on this Mac (Back from First team, or a relaunch) is read again.
  const initial = useRef(saved?.kind === "folder" ? saved : null);
  useEffect(() => {
    const first = initial.current;
    initial.current = null;
    if (first) void read({ path: first.path, displayPath: first.displayPath });
  }, [read]);

  const choose = useCallback(async () => {
    setChoice("folder");
    let picked: PickedFolder | null;
    try {
      picked = await pickFolder();
    } catch (e) {
      setFolder({
        phase: "error",
        folder: null,
        message: messageOf(e, "Couldn’t open the folder picker."),
      });
      return;
    }
    if (picked) await read(picked);
  }, [read]);

  const setUpGit = useCallback(async () => {
    if (folder.phase !== "not_git" || folder.settingUp) return;
    const target = folder.folder;
    setFolder({ phase: "not_git", folder: target, settingUp: true, error: null });
    try {
      const { branch } = await initGit(target.path);
      setFolder({ phase: "git", folder: target, line: gitSetUpLine(branch) });
    } catch (e) {
      setFolder({
        phase: "not_git",
        folder: target,
        settingUp: false,
        error: messageOf(e, "Couldn’t set up git here. Try again."),
      });
    }
  }, [folder]);

  const onContinue = useCallback(async () => {
    const workspace = workspaceFor(choice, folder, repo);
    if (!workspace || saving) return;
    const finish = teamsAlready === true;
    setSaving(true);
    try {
      await saveDesktopSetup(
        finish
          ? { workspace, step: "team", finishedAt: new Date().toISOString() }
          : { workspace, step: "team" },
      );
    } catch {
      setSaving(false);
      toast({ message: SAVE_FAILED, tone: "error" });
      return;
    }
    if (workspace.kind === "folder") void addRecentFolder(workspace.path);
    if (finish) leaveSetup();
    else navigate({ page: "setup", step: "team" });
  }, [choice, folder, repo, saving, teamsAlready, toast]);

  const back = useCallback(() => {
    void saveDesktopSetup({ step: "engines" }).catch(() => undefined);
    navigate({ page: "setup", step: "engines" });
  }, []);

  const pick = useCallback((v: string) => setChoice(v as ProjectChoice), []);

  return (
    <SetupFrame
      step="project"
      login={login}
      onSwitch={onSwitch}
      teamsAlready={teamsAlready === true}
      footer={{
        onBack: back,
        primary: {
          label: "Continue",
          disabled: !canContinueProject(choice, folder, repo),
          busy: saving,
          onClick: () => void onContinue(),
        },
      }}
    >
      <SetupHead
        title="Where should your teams work?"
        lede="Agents read and change code here. They work on a new branch and ask you before anything is merged."
      />
      <RadioCardGroup
        label="Where your teams work"
        value={choice}
        values={PROJECT_CHOICES}
        onChange={pick}
        className="st-cards"
      >
        <RadioCard
          value="folder"
          indicator
          title={`A folder on ${thisComputer()}`}
          description="Good for local projects. Only on Desktop."
        >
          {choice === "folder" && (
            <FolderPanel folder={folder} onChoose={choose} onSetUpGit={setUpGit} />
          )}
        </RadioCard>
        <RadioCard
          value="github"
          indicator
          title="A GitHub repository"
          description="Tvashtr works in a copy and opens a pull request. Works on the website too."
        >
          {choice === "github" && <RepoPanel repo={repo} onRepo={setRepo} />}
        </RadioCard>
        <RadioCard
          value="ask"
          indicator
          title="Decide when I launch a run"
          description="You’ll pick a folder or repo each time."
        />
      </RadioCardGroup>
    </SetupFrame>
  );
}

/** The selected folder card's content: DT-30 states a–d and the errors. */
function FolderPanel({
  folder,
  onChoose,
  onSetUpGit,
}: {
  folder: FolderState;
  onChoose: () => Promise<void>;
  onSetUpGit: () => Promise<void>;
}) {
  const choose = () => void onChoose();
  switch (folder.phase) {
    case "none":
      return (
        <div>
          <span className="st-inline-slot">
            <Button variant="secondary" size="sm" onClick={choose}>
              <FolderIcon size={15} />
              <span>Choose folder…</span>
            </Button>
          </span>
        </div>
      );
    case "reading":
      return folder.folder ? (
        <FolderRow
          folder={folder.folder}
          status={<span className="st-folder__reading">Reading the folder…</span>}
        />
      ) : null;
    case "git":
      return (
        <FolderRow
          folder={folder.folder}
          status={
            <span className="st-folder__status">
              <CheckCircleIcon size={14} />
              {folder.line}
            </span>
          }
          onChange={choose}
        />
      );
    case "not_git":
      return (
        <div className="st-folder-warn" role="alert">
          <div className="st-folder-warn__line">
            <WarningIcon size={15} />
            <span>
              {folder.error ?? (
                <>
                  <span className="st-folder-warn__path">{folder.folder.displayPath}</span> isn’t a
                  git repository. Teams track and review their changes with git.
                </>
              )}
            </span>
          </div>
          <div className="st-folder-warn__actions">
            {canInitGit() && (
              <span className="st-inline-slot">
                <Button
                  variant="tint"
                  size="sm"
                  loading={folder.settingUp}
                  onClick={() => void onSetUpGit()}
                >
                  Set up git here
                </Button>
              </span>
            )}
            <Button variant="ghost" size="sm" disabled={folder.settingUp} onClick={choose}>
              Choose another folder
            </Button>
          </div>
        </div>
      );
    case "error":
      return (
        <div className="st-folder-warn" role="alert">
          <div className="st-folder-warn__line">
            <WarningIcon size={15} />
            <span>{folder.message}</span>
          </div>
          <div className="st-folder-warn__actions">
            <Button variant="ghost" size="sm" onClick={choose}>
              Choose another folder
            </Button>
          </div>
        </div>
      );
  }
}

function FolderRow({
  folder,
  status,
  onChange,
}: {
  folder: PickedFolder;
  status: ReactNode;
  onChange?: () => void;
}) {
  return (
    <div className="st-folder">
      <span className="st-folder__icon">
        <FolderIcon size={16} />
      </span>
      <span className="st-folder__path">{folder.displayPath}</span>
      <span className="st-folder__push">{status}</span>
      {onChange && (
        <Button variant="ghost" size="sm" onClick={onChange}>
          Change
        </Button>
      )}
    </div>
  );
}

type RepoList =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ok"; data: GithubReposResponse; connectUrl: string };

/**
 * "A GitHub repository" selected (DT-31, OQ-19 — not designed): a repo select from the account's
 * GitHub App repositories, or Connect GitHub (the App's install / manage page) when it covers none.
 * The list is read again when the window regains focus after Connect GitHub.
 */
function RepoPanel({
  repo,
  onRepo,
}: {
  repo: string | null;
  onRepo: (repo: string | null) => void;
}) {
  const [list, setList] = useState<RepoList>({ state: "loading" });

  const load = useCallback(async () => {
    try {
      const [data, config] = await Promise.all([getGithubRepos(), getHomeConfig()]);
      const repos = Array.isArray(data?.repos) ? data.repos : [];
      const count = typeof data?.installation_count === "number" ? data.installation_count : 0;
      setList({
        state: "ok",
        data: { repos, installation_count: count },
        connectUrl: count === 0 ? config.github_install_url : config.github_manage_url,
      });
    } catch {
      setList({ state: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const [connecting, setConnecting] = useState(false);
  useEffect(() => {
    if (!connecting) return;
    const again = () => {
      setConnecting(false);
      void load();
    };
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [connecting, load]);

  if (list.state === "loading") return <span className="st-repo__note">Loading repositories…</span>;
  if (list.state === "error") {
    return (
      <span className="st-repo__note">Couldn’t reach the server to list your repositories.</span>
    );
  }
  const { repos } = list.data;
  if (repos.length === 0) {
    if (!list.connectUrl) {
      return <span className="st-repo__note">GitHub isn’t set up on this Tvashtr server.</span>;
    }
    return (
      <div className="st-repo__connect">
        <span className="st-repo__note">No repositories are connected yet.</span>
        <span>
          <ButtonLink
            variant="secondary"
            size="sm"
            href={list.connectUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setConnecting(true)}
          >
            <GithubIcon size={15} />
            <span>Connect GitHub</span>
          </ButtonLink>
        </span>
      </div>
    );
  }
  return (
    <div className="st-repo__select">
      <Select
        label="Repository"
        size="sm"
        value={repo ?? ""}
        onChange={(e) => onRepo(e.target.value || null)}
        options={[
          { value: "", label: "Choose a repository" },
          ...repos.map((r) => ({ value: r.full_name, label: r.full_name })),
        ]}
      />
    </div>
  );
}
