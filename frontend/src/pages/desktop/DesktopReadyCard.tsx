import { useEffect, useState } from "react";

import { Button, Input } from "../../design-system/components";
import type { AuthUser } from "../../lib/api";
import { getProviderDirectoryOnce, listSavedKeys } from "../../lib/api/desktop";
import { type LaunchBody, launchRun } from "../../lib/api/runs";
import { addRecentFolder, getPlanStatuses, inspectFolder, loginOf } from "../../lib/desktopApp";
import { desktopRepos } from "../../lib/desktopRepos";
import { setupFinishedThisSession, useDesktopSetupState } from "../../lib/desktopSetup";
import { navigate } from "../../lib/nav";
import { launchProblem, missingKeysSentence } from "../home/composerModel";
import { useHome } from "../home/homeContext";
import { noteLaunched } from "../home/homeData";
import { BookIcon, CheckCircleIcon, PlayIcon, UsersIcon, WrenchIcon } from "./icons";
import {
  READY_HEADING,
  WELCOME_BACK_HEADING,
  engineChip,
  newestTeam,
  targetChip,
} from "./readyCard";
import "./desktop.css";

const FOLDER_NEEDS_UPDATE =
  "Runs on a local folder need the latest Tvashtr Desktop. Pick a GitHub repo, or update Desktop.";

/** What the agents can run on (plans on this Mac, else saved keys), read once. */
function useEngineChip(): string | null {
  const [chip, setChip] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const plans = await getPlanStatuses();
      let names: string[] = [];
      try {
        const [keys, directory] = await Promise.all([listSavedKeys(), getProviderDirectoryOnce()]);
        names = keys
          .map((k) => directory.find((d) => d.provider === k.provider))
          .filter((d) => d?.serves_models)
          .map((d) => d!.name);
      } catch {
        // No keys readable: the plans alone decide.
      }
      if (alive) setChip(engineChip(plans, names));
    })();
    return () => {
      alive = false;
    };
  }, []);
  return chip;
}

/**
 * Desktop Home until the account's first run (DT-38–41): the team setup made, one line to give it
 * its first job, and three next steps. Launch takes the Home composer's path (DT-40); "Decide at
 * launch" hands the idea to the full composer instead.
 */
export function DesktopReadyCard({
  user,
  onDecideAtLaunch,
}: {
  user: AuthUser | null;
  onDecideAtLaunch: (p: { teamId: string; idea: string }) => void;
}) {
  const { teams, openNewTeam } = useHome();
  const setup = useDesktopSetupState();
  const workspace = setup.status === "ready" ? setup.setup.workspace : null;
  const engine = useEngineChip();
  const team = newestTeam(teams);
  const [idea, setIdea] = useState("");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chips = [
    user ? `Signed in as ${loginOf(user)}` : null,
    engine,
    targetChip(workspace),
    team?.name ?? null,
  ].filter((c): c is string => c !== null);

  const launch = async () => {
    const text = idea.trim();
    if (!text || launching) return;
    if (!team) {
      openNewTeam();
      return;
    }
    if (workspace?.kind !== "folder" && workspace?.kind !== "github") {
      onDecideAtLaunch({ teamId: team.team_graph_id, idea: text });
      return;
    }
    setLaunching(true);
    setError(null);
    const body: LaunchBody = {
      team_graph_id: team.team_graph_id,
      idea: text,
      desktop_target: true,
    };
    let baseRef: string | null = null;
    try {
      if (workspace.kind === "github") {
        body.github_repo = workspace.repo;
      } else {
        const prepare = desktopRepos()?.prepareRun;
        if (!prepare) throw new Error(FOLDER_NEEDS_UPDATE);
        const folder = await inspectFolder(workspace.path);
        if (!folder.is_git) throw new Error(folder.error);
        baseRef = folder.current_branch ?? "";
        const label = workspace.displayPath;
        const snap = await prepare({ path: workspace.path, baseRef, label });
        body.local_repo = { snapshot_id: snap.snapshot_id, label, base_ref: baseRef };
        void addRecentFolder(workspace.path);
      }
    } catch (e) {
      // This Mac's own refusal (git missing, the folder moved…): its copy is ready to show.
      setError(e instanceof Error ? e.message : FOLDER_NEEDS_UPDATE);
      setLaunching(false);
      return;
    }
    try {
      const runId = await launchRun(body);
      noteLaunched(runId);
      navigate({ page: "team", teamId: team.team_graph_id, runId });
    } catch (e) {
      const problem = launchProblem(e, {
        repo: workspace.kind === "github" ? workspace.repo : null,
        baseRef,
      });
      setError(
        problem.kind === "keys"
          ? missingKeysSentence(team.name, problem.providers ?? [])
          : (problem.message ?? null),
      );
      setLaunching(false);
    }
  };

  return (
    <div className="dt-ready">
      <div className="dt-ready__head">
        <h1 className="dt-ready__h1">Home</h1>
      </div>
      <section className="dt-ready__card" aria-labelledby="dt-ready-title">
        <div className="dt-ready__title">
          <h2 id="dt-ready-title" className="dt-ready__h2">
            {setupFinishedThisSession() ? READY_HEADING : WELCOME_BACK_HEADING}
          </h2>
        </div>
        {chips.length > 0 && (
          <ul className="dt-ready__chips">
            {chips.map((c) => (
              <li key={c} className="dt-ready__chip">
                <CheckCircleIcon />
                {c}
              </li>
            ))}
          </ul>
        )}
        <Input
          label={`What should ${team?.name ?? "your team"} build?`}
          // Only while empty (where it shows anyway), so a filled field reads as its value.
          placeholder={idea ? undefined : "Describe what to build"}
          value={idea}
          error={error ?? undefined}
          onChange={(e) => {
            setIdea(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void launch();
          }}
        />
        <div className="dt-ready__actions">
          <Button
            variant="primary"
            size="md"
            disabled={!idea.trim()}
            loading={launching}
            onClick={() => void launch()}
          >
            <PlayIcon />
            <span>Launch</span>
          </Button>
          {team && (
            <Button
              variant="ghost"
              size="md"
              onClick={() => navigate({ page: "team", teamId: team.team_graph_id })}
            >
              Open the canvas first
            </Button>
          )}
        </div>
      </section>
      <h2 className="dt-ready__later-title">When you’re ready</h2>
      <div className="dt-ready__later">
        <button
          type="button"
          className="dt-ready__next"
          onClick={() => navigate({ page: "domains" })}
        >
          <span className="dt-ready__next-head">
            <BookIcon />
            <span>Add a domain</span>
          </span>
          <span className="dt-ready__next-body">Give agents your docs, with sources.</span>
        </button>
        <button
          type="button"
          className="dt-ready__next"
          onClick={() => navigate({ page: "tools", view: "browse" })}
        >
          <span className="dt-ready__next-head">
            <WrenchIcon />
            <span>Add tools</span>
          </span>
          <span className="dt-ready__next-body">GitHub, Linear, web fetch and more.</span>
        </button>
        <button type="button" className="dt-ready__next" onClick={() => openNewTeam()}>
          <span className="dt-ready__next-head">
            <UsersIcon />
            <span>Try another template</span>
          </span>
          <span className="dt-ready__next-body">Spec only, or build your own.</span>
        </button>
      </div>
    </div>
  );
}
