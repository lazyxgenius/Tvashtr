import { BookOpen, ChevronDown, Plus, Sparkle, Wrench } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";

import type { TeamSummary } from "../../lib/api";
import type { DesktopFolder } from "../../lib/desktopRepos";
import { folderLabel } from "../../lib/desktopRepos";
import { Input, LetterTile, Popover, Select } from "../../design-system/components";
import { type RepoList, type Target, pickerPhrase, targetBranch } from "./composerModel";
import { GithubIcon } from "./homeIcons";

/** Arrow keys move between a picker's options; Enter picks (native button). */
function onListKeys(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const opts = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled])'),
  );
  if (opts.length === 0) return;
  const i = opts.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    i < 0
      ? e.key === "ArrowDown"
        ? 0
        : opts.length - 1
      : (i + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
  opts[next]?.focus();
  e.preventDefault();
}

function Option({
  selected = false,
  onPick,
  children,
  end,
}: {
  selected?: boolean;
  onPick: () => void;
  children: ReactNode;
  end?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className="ds-option hm-option"
      onClick={onPick}
    >
      {children}
      <span className="ds-option__end">{end}</span>
    </button>
  );
}

function Chevron() {
  return (
    <span className="hm-picker__chev">
      <ChevronDown size={14} strokeWidth={1.6} aria-hidden />
    </span>
  );
}

// ---- Team ----

export function TeamPicker({
  teams,
  selected,
  desktop,
  onPick,
  onNewTeam,
}: {
  teams: TeamSummary[];
  selected: TeamSummary | undefined;
  desktop: boolean;
  onPick: (teamId: string) => void;
  onNewTeam: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    setQ("");
    trigger.current?.focus();
  };
  const shown = teams.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Popover
      open={open}
      onClose={close}
      width={474}
      label="Pick a team"
      className="hm-pop"
      trigger={
        <button
          ref={trigger}
          type="button"
          className="hm-picker hm-picker--team"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => (open ? close() : setOpen(true))}
        >
          {selected ? (
            <>
              <LetterTile name={selected.name} />
              <span className="hm-picker__name">{selected.name}</span>
            </>
          ) : (
            <span className="hm-picker__muted">No team yet</span>
          )}
          <Chevron />
        </button>
      }
    >
      <div onKeyDown={onListKeys} className="hm-pop__inner">
        <Input
          size="sm"
          placeholder="Search teams"
          aria-label="Search teams"
          className="hm-pop__search"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
        />
        <div role="listbox" aria-label="Your teams" className="hm-pop__list">
          <div className="ds-popover__heading" role="presentation">
            Your teams
          </div>
          {shown.map((t) => (
            <Option
              key={t.team_graph_id}
              selected={t.team_graph_id === selected?.team_graph_id}
              onPick={() => {
                onPick(t.team_graph_id);
                close();
              }}
              end={pickerPhrase(t, desktop)}
            >
              <LetterTile name={t.name} />
              <span className="hm-option__name">{t.name}</span>
              <span className="ds-option__meta">
                {t.node_count} {t.node_count === 1 ? "agent" : "agents"}
              </span>
            </Option>
          ))}
          {shown.length === 0 && <div className="hm-pop__empty">No teams match “{q.trim()}”.</div>}
          <div className="hm-pop__sep" role="separator" />
          <Option
            onPick={() => {
              close();
              onNewTeam();
            }}
          >
            <span className="hm-option__accent-icon">
              <Plus size={14} strokeWidth={1.6} aria-hidden />
            </span>
            <span className="hm-option__accent">New team…</span>
          </Option>
        </div>
      </div>
    </Popover>
  );
}

// ---- Repo / folder ----

export function TargetPicker({
  target,
  baseRef,
  repos,
  folders,
  foldersSupported,
  desktop,
  hosted,
  installUrl,
  manageUrl,
  onPick,
  onChooseFolder,
  onTypePath,
}: {
  target: Target;
  baseRef: string;
  repos: RepoList;
  folders: DesktopFolder[];
  foldersSupported: boolean;
  desktop: boolean;
  hosted: boolean;
  installUrl: string;
  manageUrl: string;
  onPick: (t: Target) => void;
  onChooseFolder: () => void;
  onTypePath: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [path, setPath] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    setQ("");
    trigger.current?.focus();
  };
  const pick = (t: Target) => {
    onPick(t);
    close();
  };
  const branch = targetBranch(target, baseRef);
  const openExternal = (url: string) => {
    if (url) window.open(url, "_blank", "noopener");
    close();
  };

  let label: ReactNode;
  if (target.kind === "github" || target.kind === "folder" || target.kind === "local") {
    const name =
      target.kind === "github"
        ? target.repo
        : target.kind === "folder"
          ? target.label
          : target.path;
    label = (
      <>
        {target.kind === "github" ? (
          <GithubIcon />
        ) : (
          <BookOpen size={14} strokeWidth={1.6} aria-hidden />
        )}
        <span className="hm-picker__code">{name}</span>
        {branch && <span className="hm-picker__branch">· {branch}</span>}
      </>
    );
  } else {
    label = (
      <>
        <Sparkle size={14} strokeWidth={1.6} aria-hidden />
        <span>No repo · fresh app</span>
      </>
    );
  }

  const repoData = repos.state === "ok" ? repos.data : null;
  const shownRepos = (repoData?.repos ?? []).filter((r) =>
    r.full_name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const showSearch = !desktop && hosted;
  const addReposUrl = repoData && repoData.installation_count === 0 ? installUrl : manageUrl;

  const repoOptions = (
    <>
      {repos.state === "loading" && <div className="hm-pop__empty">Loading repositories…</div>}
      {repos.state === "error" && (
        <div className="hm-pop__empty">Couldn’t reach the server to list your repositories.</div>
      )}
      {repoData && repoData.installation_count === 0 && (
        <div className="hm-pop__empty">
          <a href={installUrl} target="_blank" rel="noopener noreferrer">
            Install the Tvashtr GitHub App →
          </a>
        </div>
      )}
      {repoData && repoData.installation_count > 0 && repoData.repos.length === 0 && (
        <div className="hm-pop__empty">
          <a href={manageUrl} target="_blank" rel="noopener noreferrer">
            Add repositories on GitHub →
          </a>
        </div>
      )}
      {repoData && repoData.repos.length > 0 && shownRepos.length === 0 && (
        <div className="hm-pop__empty">No repos match “{q.trim()}”.</div>
      )}
      {shownRepos.map((r) => (
        <Option
          key={r.full_name}
          selected={target.kind === "github" && target.repo === r.full_name}
          onPick={() =>
            pick({ kind: "github", repo: r.full_name, defaultBranch: r.default_branch })
          }
          end={r.default_branch}
        >
          <GithubIcon />
          <span className="hm-picker__code">{r.full_name}</span>
        </Option>
      ))}
    </>
  );

  const noRepo = (
    <Option selected={target.kind === "none"} onPick={() => pick({ kind: "none" })}>
      <Sparkle size={14} strokeWidth={1.6} aria-hidden />
      <span>No repo · build a fresh app</span>
    </Option>
  );

  let body: ReactNode;
  let foot: string;
  if (desktop) {
    foot = "The team works on its own branch. Your working folder is never touched.";
    body = (
      <>
        <div className="ds-popover__heading" role="presentation">
          Recent folders
        </div>
        {!foldersSupported && (
          <div className="hm-pop__empty">Local folders need the latest Tvashtr Desktop.</div>
        )}
        {folders.map((f) => (
          <Option
            key={f.path}
            selected={target.kind === "folder" && target.path === f.path}
            onPick={() =>
              pick({
                kind: "folder",
                path: f.path,
                label: folderLabel(f),
                branch: f.branch ?? null,
              })
            }
            end={f.available === false ? "Unavailable" : (f.branch ?? "")}
          >
            <BookOpen size={14} strokeWidth={1.6} aria-hidden />
            <span className="hm-picker__code">{folderLabel(f)}</span>
          </Option>
        ))}
        <div className="hm-pop__sep" role="separator" />
        {foldersSupported && (
          <Option
            onPick={() => {
              close();
              onChooseFolder();
            }}
          >
            <Plus size={14} strokeWidth={1.6} aria-hidden />
            <span>Choose a folder…</span>
          </Option>
        )}
        {noRepo}
        {hosted && repos.state !== "off" && (
          <>
            <div className="ds-popover__heading" role="presentation">
              GitHub App repos
            </div>
            {repoOptions}
          </>
        )}
      </>
    );
  } else if (hosted) {
    foot = "The team works on its own branch and opens a pull request.";
    body = (
      <>
        <div className="ds-popover__heading" role="presentation">
          GitHub App repos
        </div>
        {repoOptions}
        <div className="hm-pop__sep" role="separator" />
        {noRepo}
        <Option onPick={() => openExternal(addReposUrl)}>
          <Plus size={14} strokeWidth={1.6} aria-hidden />
          <span className="hm-option__accent">Add repos on GitHub…</span>
        </Option>
      </>
    );
  } else {
    // Self-hosted website (Q15): type a path on the server's disk, inspected like before.
    foot = "The team works on its own branch. Your working tree is never touched.";
    body = (
      <>
        <div className="ds-popover__heading" role="presentation">
          Local repo
        </div>
        <form
          className="hm-pop__path"
          onSubmit={(e) => {
            e.preventDefault();
            if (!path.trim()) return;
            onTypePath(path.trim());
            close();
          }}
        >
          <Input
            size="sm"
            mono
            placeholder="Type a path…"
            aria-label="Repository path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </form>
        {target.kind === "local" && (
          <Option selected onPick={() => close()} end={target.branch ?? ""}>
            <BookOpen size={14} strokeWidth={1.6} aria-hidden />
            <span className="hm-picker__code">{target.path}</span>
          </Option>
        )}
        <div className="hm-pop__sep" role="separator" />
        {noRepo}
      </>
    );
  }

  return (
    <Popover
      open={open}
      onClose={close}
      width={374}
      label={desktop ? "Pick a folder" : "Pick a repo"}
      className="hm-pop"
      trigger={
        <button
          ref={trigger}
          type="button"
          className="hm-picker hm-picker--repo"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => (open ? close() : setOpen(true))}
        >
          {label}
          <Chevron />
        </button>
      }
    >
      <div onKeyDown={onListKeys} className="hm-pop__inner">
        {showSearch && (
          <Input
            size="sm"
            placeholder="Search repos"
            aria-label="Search repos"
            className="hm-pop__search"
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
          />
        )}
        <div role="listbox" aria-label={desktop ? "Folders" : "Repos"} className="hm-pop__list">
          {body}
        </div>
        <div className="hm-pop__foot">{foot}</div>
      </div>
    </Popover>
  );
}

// ---- Options ----

export function OptionsPopover({
  target,
  baseRef,
  onBaseRef,
  branches,
  subpath,
  onSubpath,
  subpaths,
  budget,
  onBudget,
  branchError,
  budgetError,
}: {
  target: Target;
  baseRef: string;
  onBaseRef: (v: string) => void;
  branches: string[];
  subpath: string;
  onSubpath: (v: string) => void;
  subpaths: string[];
  budget: string;
  onBudget: (v: string) => void;
  branchError: string | null;
  budgetError: string | null;
}) {
  const [open, setOpen] = useState(false);
  const noRepo = target.kind === "none";
  const placeholder =
    target.kind === "github"
      ? target.defaultBranch
      : target.kind === "folder" || target.kind === "local"
        ? (target.branch ?? "")
        : "";
  const scopeOptions = [
    { value: "", label: "Whole repo" },
    ...subpaths.map((p) => ({ value: p, label: p })),
  ];
  if (subpath && !subpaths.includes(subpath)) scopeOptions.push({ value: subpath, label: subpath });
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      width={322}
      label="Run options"
      className="hm-pop hm-pop--options"
      trigger={
        <button
          type="button"
          className={open ? "hm-options-btn hm-options-btn--open" : "hm-options-btn"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Wrench size={14} strokeWidth={1.6} aria-hidden />
          Options
        </button>
      }
    >
      <div className="hm-options">
        <Input
          label="Base branch"
          value={noRepo ? "" : baseRef}
          placeholder={placeholder}
          disabled={noRepo}
          list="hm-branches"
          error={branchError ?? undefined}
          onChange={(e) => onBaseRef(e.target.value)}
        />
        <datalist id="hm-branches">
          {branches.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        <Select
          label="Scope"
          aria-label="Scope"
          value={subpath}
          disabled={noRepo}
          options={scopeOptions}
          onChange={(e) => onSubpath(e.target.value)}
        />
        <Input
          label="Budget for this run"
          value={budget}
          inputMode="decimal"
          helper="The run pauses and asks you before spending more."
          error={budgetError ?? undefined}
          onChange={(e) => onBudget(e.target.value)}
        />
      </div>
    </Popover>
  );
}
