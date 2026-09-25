import { CircleCheck, TriangleAlert, Undo } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getGithubRepos, inspectRepo } from "../../lib/api";
import { type HomeConfig, getHomeConfig } from "../../lib/api/home";
import { type LaunchBody, getRepoBranches, getRepoSubpaths, launchRun } from "../../lib/api/runs";
import {
  type DesktopFolder,
  desktopRepos,
  folderLabel,
  isDesktopApp,
} from "../../lib/desktopRepos";
import { navigate } from "../../lib/nav";
import { Button, useToast } from "../../design-system/components";
import { AddKeySheet } from "./AddKeySheet";
import {
  type LaunchProblem,
  type RepoList,
  type Target,
  budgetError,
  launchProblem,
  missingKeysSentence,
  parseBudget,
  readinessHint,
  readinessOf,
  rememberLastTeam,
  targetBranch,
} from "./composerModel";
import { OptionsPopover, TargetPicker, TeamPicker } from "./ComposerPickers";
import { useHome } from "./homeContext";
import {
  type ComposerPrefill,
  refreshHome,
  requestAddKeys,
  useComposerPrefillHandler,
} from "./homeData";
import { SECTION_IDS, money } from "./homeFormat";
import { PlayIcon } from "./homeIcons";
import "./home-runs.css";

const LAST_TARGET_KEY = "tvashtr.home.lastTarget";

function readLastTarget(): string | null {
  try {
    return localStorage.getItem(LAST_TARGET_KEY);
  } catch {
    return null;
  }
}

function targetKey(t: Target): string {
  if (t.kind === "github") return `github:${t.repo}`;
  if (t.kind === "folder") return `folder:${t.path}`;
  if (t.kind === "local") return `local:${t.path}`;
  return "none";
}

/**
 * Start a run (Home-Main composer; HmF-Idea, -PickTeam, -PickRepo, -PickFolder, -Options, -Launch,
 * -Retry, -FixSetup): the idea, the team, the repo (website) or local folder (Desktop), Options
 * (base branch, scope, budget), the readiness hint with Fix, and Launch — which stays on Home.
 */
export function Composer() {
  const {
    teams,
    teamsLoading,
    composerTeamId,
    pickTeamForRun,
    registerComposerFocus,
    openNewTeam,
    reloadTeams,
  } = useHome();
  const toast = useToast();
  const desktop = isDesktopApp();
  const bridge = desktopRepos();

  const [config, setConfig] = useState<HomeConfig | null>(null);
  const [idea, setIdea] = useState("");
  const [ideaError, setIdeaError] = useState(false);
  const [retryOf, setRetryOf] = useState<{ runId: string; teamId: string | null } | null>(null);
  const [target, setTarget] = useState<Target>({ kind: "none" });
  const [targetTouched, setTargetTouched] = useState(false);
  const [baseRef, setBaseRef] = useState("");
  const [subpath, setSubpath] = useState("");
  const [budget, setBudget] = useState("");
  const [budgetTouched, setBudgetTouched] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesTruncated, setBranchesTruncated] = useState(true);
  const [subpaths, setSubpaths] = useState<string[]>([]);
  const [repos, setRepos] = useState<RepoList>({ state: "off" });
  const [folders, setFolders] = useState<DesktopFolder[]>([]);
  const [problem, setProblem] = useState<LaunchProblem | null>(null);
  const [launching, setLaunching] = useState(false);
  const ideaRef = useRef<HTMLTextAreaElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  const selected = teams.find((t) => t.team_graph_id === composerTeamId);
  const readiness = readinessOf(selected, desktop);
  const hint = readinessHint(readiness, desktop);
  const hosted = config?.hosted_mode ?? true;

  // ---- focus / prefill hooks other sections use ----
  const focusIdea = useCallback(() => {
    sectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    ideaRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    registerComposerFocus(focusIdea);
    return () => registerComposerFocus(null);
  }, [registerComposerFocus, focusIdea]);

  // ---- data: config, repos, folders ----
  useEffect(() => {
    let live = true;
    getHomeConfig()
      .then((c) => {
        if (!live) return;
        setConfig(c);
        if (c.hosted_mode) setRepos({ state: "loading" });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!config || budgetTouched) return;
    setBudget(config.default_run_budget_usd ? money(config.default_run_budget_usd) : "");
  }, [config, budgetTouched]);

  useEffect(() => {
    if (!config?.hosted_mode) return;
    let live = true;
    getGithubRepos()
      .then((data) => live && setRepos({ state: "ok", data }))
      .catch(() => live && setRepos({ state: "error" }));
    return () => {
      live = false;
    };
  }, [config]);

  const loadFolders = useCallback(async () => {
    const list = await bridge?.recent?.list?.().catch(() => [] as DesktopFolder[]);
    setFolders(list ?? []);
    return list ?? [];
  }, [bridge]);
  useEffect(() => {
    if (desktop) void loadFolders();
  }, [desktop, loadFolders]);

  // ---- the default target: last used, else the first folder (Desktop) / repo (website) ----
  useEffect(() => {
    if (targetTouched) return;
    const repoList = repos.state === "ok" ? repos.data.repos : [];
    const candidates: Target[] = [
      ...(desktop
        ? folders
            .filter((f) => f.available !== false)
            .map<Target>((f) => ({
              kind: "folder",
              path: f.path,
              label: folderLabel(f),
              branch: f.branch ?? null,
            }))
        : []),
      ...repoList.map<Target>((r) => ({
        kind: "github",
        repo: r.full_name,
        defaultBranch: r.default_branch,
      })),
    ];
    const last = readLastTarget();
    const pick = candidates.find((c) => targetKey(c) === last) ?? candidates[0];
    if (pick && targetKey(pick) !== targetKey(target)) setTarget(pick);
  }, [repos, folders, desktop, targetTouched, target]);

  // ---- branches + scope for the chosen target ----
  const targetId = targetKey(target);
  useEffect(() => {
    let live = true;
    setBranches([]);
    setSubpaths([]);
    setSubpath("");
    setBranchesTruncated(true);
    if (target.kind === "github") {
      setBaseRef(target.defaultBranch);
      getRepoBranches(target.repo)
        .then((b) => {
          if (!live) return;
          setBranches(b.branches);
          setBranchesTruncated(b.truncated);
        })
        .catch(() => undefined);
    } else if (target.kind === "folder") {
      setBaseRef(target.branch ?? "");
      bridge
        ?.inspect?.(target.path)
        .then((r) => {
          if (!live || !r.is_git) return;
          setBranches(r.branches);
          setBranchesTruncated(false);
          setSubpaths(r.subpaths.map((s) => s.path));
          if (!target.branch && r.current_branch) setBaseRef(r.current_branch);
        })
        .catch(() => undefined);
    } else if (target.kind === "local") {
      setBaseRef(target.branch ?? "");
      inspectRepo(target.path)
        .then((r) => {
          if (!live || !r.is_git) return;
          setBranches(r.branches);
          setBranchesTruncated(false);
          setSubpaths((r.subpaths ?? []).map((s) => s.path));
        })
        .catch(() => undefined);
    } else {
      setBaseRef("");
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the target's identity
  }, [targetId]);

  // GitHub scope follows the chosen base branch (only once it's a known branch).
  const scopeRef = target.kind === "github" && branches.includes(baseRef) ? baseRef : null;
  const scopeRepo = target.kind === "github" ? target.repo : null;
  useEffect(() => {
    if (!scopeRepo || !scopeRef) return;
    let live = true;
    getRepoSubpaths(scopeRepo, scopeRef)
      .then((s) => live && setSubpaths(s.subpaths.map((p) => p.path)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [scopeRepo, scopeRef]);

  // Changing the team ends retry mode (HOME-67).
  useEffect(() => {
    if (retryOf && retryOf.teamId && retryOf.teamId !== composerTeamId) setRetryOf(null);
  }, [composerTeamId, retryOf]);

  // A problem about the old team / target goes away once the choice changes.
  useEffect(() => {
    setProblem(null);
  }, [composerTeamId, targetId]);

  const branchErr = useMemo(() => {
    const b = baseRef.trim();
    if (target.kind === "none" || !b || branchesTruncated || branches.length === 0) return null;
    if (branches.includes(b)) return null;
    const where =
      target.kind === "github"
        ? target.repo
        : target.kind === "folder"
          ? target.label
          : target.path;
    return `No branch named ${b} in ${where}.`;
  }, [baseRef, branches, branchesTruncated, target]);
  const budgetErr = budgetError(budget);

  // ---- prefill (Retry / Start again) ----
  useComposerPrefillHandler((p: ComposerPrefill) => {
    if (p.teamId) pickTeamForRun(p.teamId);
    else focusIdea();
    setIdea(p.idea);
    setIdeaError(false);
    setProblem(null);
    setRetryOf(p.retryOfRunId ? { runId: p.retryOfRunId, teamId: p.teamId } : null);
    if (p.target) {
      let next: Target | null = null;
      if (p.target.kind === "github") {
        const repoName = p.target.repo;
        const known =
          repos.state === "ok" ? repos.data.repos.find((r) => r.full_name === repoName) : undefined;
        next = {
          kind: "github",
          repo: repoName,
          defaultBranch: known?.default_branch ?? p.baseRef ?? "main",
        };
      } else if (p.target.kind === "folder") {
        const label = p.target.label;
        const f = folders.find((x) => folderLabel(x) === label || x.path === label);
        if (f)
          next = { kind: "folder", path: f.path, label: folderLabel(f), branch: f.branch ?? null };
      } else if (p.target.kind === "local") {
        next = { kind: "local", path: p.target.path, branch: p.baseRef ?? null };
      } else {
        next = { kind: "none" };
      }
      if (next) {
        setTargetTouched(true);
        setTarget(next);
      }
    }
    // Branch / scope apply after the target's own reset has run.
    window.setTimeout(() => {
      if (p.baseRef) setBaseRef(p.baseRef);
      if (p.subpath) setSubpath(p.subpath);
    }, 0);
    if (typeof p.budget === "number") {
      setBudgetTouched(true);
      setBudget(money(p.budget));
    }
    window.setTimeout(() => focusIdea(), 0);
  });

  // ---- keys ----
  const addKeys = (providers: string[]) => {
    if (!selected) return;
    requestAddKeys({
      teamName: selected.name,
      providers,
      onDone: () => {
        setProblem(null);
        void reloadTeams();
        void refreshHome();
      },
    });
  };

  // ---- launch ----
  const launch = async () => {
    if (launching) return;
    const text = idea.trim();
    if (!text) {
      setIdeaError(true);
      ideaRef.current?.focus();
      return;
    }
    if (!selected) {
      openNewTeam();
      return;
    }
    if (budgetErr || branchErr) {
      setProblem({ kind: "message", message: budgetErr ?? branchErr ?? "" });
      return;
    }
    if (readiness.ready === false && readiness.missing.length > 0) {
      setProblem({ kind: "keys", providers: readiness.missing });
      return;
    }
    setLaunching(true);
    setProblem(null);
    const branch = targetBranch(target, baseRef) ?? undefined;
    const body: LaunchBody = { team_graph_id: selected.team_graph_id, idea: text };
    const cap = parseBudget(budget);
    if (cap !== undefined && !Number.isNaN(cap)) body.budget_cap_usd = cap;
    if (desktop) body.desktop_target = true;
    if (retryOf) body.retry_of_run_id = retryOf.runId;
    try {
      if (target.kind === "github") {
        body.github_repo = target.repo;
        body.base_ref = branch;
        if (subpath) body.subpath = subpath;
      } else if (target.kind === "local") {
        body.repo_path = target.path;
        body.base_ref = branch;
        if (subpath) body.subpath = subpath;
      } else if (target.kind === "folder") {
        if (!hosted) {
          body.repo_path = target.path;
          body.base_ref = branch;
          if (subpath) body.subpath = subpath;
        } else {
          const prepare = bridge?.prepareRun;
          if (!prepare) {
            setProblem({
              kind: "message",
              message:
                "Runs on a local folder need the latest Tvashtr Desktop. Pick a GitHub repo, or update Desktop.",
            });
            setLaunching(false);
            return;
          }
          const snap = await prepare({
            path: target.path,
            baseRef: branch ?? "",
            label: target.label,
          });
          body.local_repo = {
            snapshot_id: snap.snapshot_id,
            label: target.label,
            base_ref: branch ?? "",
            ...(subpath ? { subpath } : {}),
          };
        }
        void bridge?.recent?.add?.(target.path);
      }
      const runId = await launchRun(body);
      const teamId = selected.team_graph_id;
      const teamName = selected.name;
      rememberLastTeam(teamId);
      try {
        localStorage.setItem(LAST_TARGET_KEY, targetKey(target));
      } catch {
        // storage blocked: the default target is simply the first one next time
      }
      toast({
        message: retryOf
          ? `Run started on ${teamName}. The failed run stays in its history.`
          : `Run started on ${teamName}.`,
        action: {
          label: "Open run",
          onClick: () => navigate({ page: "team", teamId, runId }),
        },
      });
      setIdea("");
      setRetryOf(null);
      void refreshHome();
      void reloadTeams();
    } catch (e) {
      setProblem(
        launchProblem(e, {
          repo: target.kind === "github" ? target.repo : null,
          baseRef: branch ?? null,
        }),
      );
    } finally {
      setLaunching(false);
    }
  };

  // Grow the idea box with its content.
  useEffect(() => {
    const el = ideaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [idea]);

  if (teamsLoading) {
    return (
      <div className="hm-skel-card" style={{ height: 150 }} aria-hidden="true">
        <div className="hm-skel-bar" style={{ width: "30%", height: 14 }} />
        <div className="hm-skel-bar" style={{ width: "80%", height: 12 }} />
        <div className="hm-skel-bar" style={{ width: "60%", height: 12 }} />
      </div>
    );
  }

  const where = desktop ? "on this computer" : "on the website";

  return (
    <section
      ref={sectionRef}
      id={SECTION_IDS.composer}
      className="hm-card hm-card--open hm-composer"
      aria-label="Start a run"
    >
      <div className="hm-composer__body">
        <div className="hm-composer__top">
          <span className="hm-composer__label">Start a run</span>
          <span className="hm-composer__press">
            Press <kbd className="hm-composer__kbd">N</kbd> from anywhere
          </span>
        </div>
        {retryOf && (
          <div className="hm-retry-note">
            <Undo size={13} strokeWidth={1.6} aria-hidden />
            Retrying the failed run with the same idea and repo.
          </div>
        )}
        <span id="hm-idea-label" className="hm-sr-only">
          What should the team build?
        </span>
        <textarea
          ref={ideaRef}
          className={ideaError ? "hm-idea hm-idea--error" : "hm-idea"}
          rows={1}
          aria-labelledby="hm-idea-label"
          aria-invalid={ideaError || undefined}
          placeholder={
            idea
              ? undefined
              : "What should the team build? For example: Add an RSI indicator with tests"
          }
          value={idea}
          onChange={(e) => {
            setIdea(e.target.value);
            if (ideaError) setIdeaError(false);
            if (!e.target.value.trim() && retryOf) setRetryOf(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void launch();
            }
          }}
        />
        {ideaError && (
          <div role="alert" className="hm-idea-error">
            <TriangleAlert size={13} strokeWidth={1.6} aria-hidden />
            Describe what the team should build.
          </div>
        )}
        {problem && (
          <div role="alert" className="hm-alert">
            <TriangleAlert size={16} strokeWidth={1.6} aria-hidden />
            {problem.kind === "keys" ? (
              <>
                <span className="hm-alert__text">
                  <b>Can’t run {where} yet.</b>{" "}
                  {missingKeysSentence(selected?.name ?? "This team", problem.providers ?? [])}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => addKeys(problem.providers ?? [])}
                >
                  Add keys
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate({ page: "engines", tab: "overview" })}
                >
                  Open Engines
                </Button>
              </>
            ) : (
              <>
                <span className="hm-alert__text">{problem.message}</span>
                {problem.openTeam && selected && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate({ page: "team", teamId: selected.team_graph_id })}
                  >
                    Open team
                  </Button>
                )}
              </>
            )}
          </div>
        )}
        <div className="hm-composer__row">
          <TeamPicker
            teams={teams}
            selected={selected}
            desktop={desktop}
            onPick={(id) => pickTeamForRun(id)}
            onNewTeam={() => openNewTeam()}
          />
          <TargetPicker
            target={target}
            baseRef={baseRef}
            repos={repos}
            folders={folders}
            foldersSupported={Boolean(bridge?.recent?.list || bridge?.pickFolder)}
            desktop={desktop}
            hosted={hosted}
            installUrl={config?.github_install_url ?? ""}
            manageUrl={config?.github_manage_url ?? ""}
            onPick={(t) => {
              setTargetTouched(true);
              setTarget(t);
            }}
            onChooseFolder={() => {
              void bridge
                ?.pickFolder?.()
                .then(async (picked) => {
                  if (!picked) return;
                  await bridge?.recent?.add?.(picked.path);
                  const list = await loadFolders();
                  const f = list.find((x) => x.path === picked.path);
                  setTargetTouched(true);
                  setTarget({
                    kind: "folder",
                    path: picked.path,
                    label: picked.displayPath || folderLabel(picked),
                    branch: f?.branch ?? null,
                  });
                })
                .catch(() => undefined);
            }}
            onTypePath={(path) => {
              setTargetTouched(true);
              setTarget({ kind: "local", path, branch: null });
            }}
          />
          <OptionsPopover
            target={target}
            baseRef={baseRef}
            onBaseRef={setBaseRef}
            branches={branches}
            subpath={subpath}
            onSubpath={setSubpath}
            subpaths={subpaths}
            budget={budget}
            onBudget={(v) => {
              setBudgetTouched(true);
              setBudget(v);
            }}
            branchError={branchErr}
            budgetError={budgetErr}
          />
          <span className="hm-composer__hint">
            {hint?.tone === "gap" && (
              <span className="hm-hint hm-hint--gap">
                <TriangleAlert size={14} strokeWidth={1.6} aria-hidden />
                {hint.text}
                <a
                  href="#"
                  className="hm-hint__fix"
                  onClick={(e) => {
                    e.preventDefault();
                    addKeys(readiness.missing);
                  }}
                >
                  Fix
                </a>
              </span>
            )}
            {hint?.tone === "ready" && (
              <span className="hm-hint hm-hint--ready">
                <CircleCheck size={14} strokeWidth={1.6} aria-hidden />
                {hint.text}
              </span>
            )}
          </span>
          <Button
            variant="primary"
            className="hm-btn-inline"
            loading={launching}
            onClick={() => void launch()}
            title={
              desktop
                ? "Claude and Grok nodes run on this computer — keep Tvashtr Desktop open until the run finishes."
                : undefined
            }
          >
            {!launching && <PlayIcon />}
            <span>{launching ? "Launching…" : "Launch"}</span>
          </Button>
        </div>
      </div>
      <AddKeySheet directory={config?.provider_directory ?? []} desktop={desktop} />
    </section>
  );
}
