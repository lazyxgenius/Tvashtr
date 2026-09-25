import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";

import { Button, useToast } from "../../design-system/components";
import { getMe } from "../../lib/api";
import { getTeamTemplates, type TeamTemplate } from "../../lib/api/teams";
import { navigate } from "../../lib/nav";
import { Composer } from "./Composer";
import { setGetStartedHidden } from "./getStarted";
import { useHome } from "./homeContext";
import { PipelineStrip } from "./PipelineStrip";
import { RunningNow } from "./RunningNow";
import type { GetStartedProgress, GetStartedSteps } from "./useGetStartedProgress";
import "./teams.css";

/** The first-time template copy is shorter than the dialog's for two of them (Home-FirstTime). */
const FIRST_TIME_COPY: Record<string, string> = {
  two_node: "A PM writes the spec; an Engineer builds and ships it.",
  full_squad: "Plan, you approve, build and test, you approve the ship.",
};

const HOW = [
  ["Build a team", "Agents on a canvas: thinkers plan, workers write code, gates wait for you."],
  ["Run it on a repo", "Each run works on its own branch, in a sandbox."],
  ["Review the pull request", "You approve at the gates. Nothing merges without you."],
] as const;

function displayName(me: { email: string; display_name?: string | null } | null): string {
  if (!me) return "";
  if (me.display_name) return me.display_name;
  const local = me.email.split("@")[0] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
}

function GithubMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

interface Step {
  key: keyof GetStartedSteps;
  title: string;
  desc: string;
  action: string;
  onClick: () => void;
}

/**
 * First-time Home (Home-FirstTime, HmF-FirstTime-1…6): "Welcome to Tvashtr", the get-started
 * checklist, then — by stage — starter templates, the Start-a-run composer, Running now, or the
 * "your first pull request is open" callout; "How Tvashtr works" in the right rail.
 */
export function FirstTimeHome({ progress }: { progress: GetStartedProgress }) {
  const { openNewTeam, focusComposer, teams } = useHome();
  const toast = useToast();
  const [name, setName] = useState("");
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [hiding, setHiding] = useState(false);
  const howRef = useRef<HTMLElement>(null);
  const { steps, runs, firstResult } = progress;

  useEffect(() => {
    let live = true;
    void getMe()
      .then((me) => live && setName(displayName(me)))
      .catch(() => undefined);
    void getTeamTemplates()
      .then((t) => live && setTemplates(t.templates))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const hide = async () => {
    if (hiding) return;
    setHiding(true);
    try {
      await setGetStartedHidden(true);
      toast({ message: "Checklist hidden. Bring it back from the account menu." });
    } catch {
      toast({ message: "Couldn’t hide the checklist — is the backend running?", tone: "error" });
    } finally {
      setHiding(false);
    }
  };

  // "See how" (§6 Q11): a run waiting at a gate, else the newest running run, else How it works.
  const seeHow = () => {
    const pick =
      runs.find((r) => r.status === "awaiting_human" && r.team) ??
      runs.find((r) => (r.status === "running" || r.status === "pending") && r.team);
    if (pick?.team) navigate({ page: "team", teamId: pick.team.id, runId: pick.run_id });
    else howRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const list: Step[] = [
    {
      key: "engine",
      title: "Connect an engine",
      desc: "Your Claude or Grok plan on Desktop, or an API key.",
      action: "Open Engines",
      onClick: () => navigate({ page: "engines", tab: "overview" }),
    },
    {
      key: "team",
      title: "Create a team",
      desc: "Start from a template. You can change every agent later.",
      action: "New team",
      onClick: () => openNewTeam(),
    },
    {
      key: "run",
      title: "Start your first run",
      desc: "Tell the team what to build, and pick a repo.",
      action: "Start a run",
      onClick: () => (teams.length === 0 ? openNewTeam() : focusComposer()),
    },
    {
      key: "review",
      title: "Review the pull request",
      desc: "Approve the spec and the ship when the team asks.",
      action: "See how",
      onClick: seeHow,
    },
  ];
  const done = list.filter((s) => steps[s.key]).length;
  const current = list.find((s) => !steps[s.key])?.key ?? null;
  const allDone = current === null;

  let stageBody = null;
  if (allDone) {
    // the callout inside the checklist is the whole stage
  } else if (!steps.team) {
    stageBody = templates.length > 0 && (
      <section className="hm-ft-templates" aria-label="Start from a template">
        <h2 className="hm-ft-templates__title">Start from a template</h2>
        <div className="hm-teams__grid">
          {templates.map((t) => (
            <article key={t.template} className="hm-ft-tpl">
              <div className="hm-ft-tpl__name">{t.name}</div>
              <PipelineStrip shape={t.shape} size={20} />
              <div className="hm-ft-tpl__desc">{FIRST_TIME_COPY[t.template] ?? t.description}</div>
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openNewTeam({ templateKey: t.template })}
                >
                  Use template
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  } else if (!steps.run) stageBody = <Composer />;
  else stageBody = <RunningNow />;

  return (
    <>
      <div className="hm-ft-head">
        <div>
          <h1 className="hm-ft-head__title">
            {name ? `Welcome to Tvashtr, ${name}.` : "Welcome to Tvashtr."}
          </h1>
          <p className="hm-ft-head__lede">
            Build a team of agents, run it on your repo, and review the pull request it opens.
          </p>
        </div>
        <Button variant="secondary" onClick={() => openNewTeam()}>
          <Plus className="hm-inline-icon" size={15} strokeWidth={1.6} aria-hidden />
          New team
        </Button>
      </div>
      <div className="hm-cols">
        <div className="hm-cols__main">
          <section className="hm-card" aria-label="Get started">
            <div className="hm-gs__top">
              <div className="hm-gs__row">
                <h2 className="hm-gs__title">{allDone ? "You’re all set" : "Get started"}</h2>
                <span className="hm-gs__count">{`${done} of 4 done`}</span>
                <button
                  type="button"
                  className="hm-gs__hide"
                  onClick={() => void hide()}
                  disabled={hiding}
                >
                  Hide checklist
                </button>
              </div>
              <div
                className="hm-gs__bar"
                role="progressbar"
                aria-label="Get started progress"
                aria-valuemin={0}
                aria-valuemax={4}
                aria-valuenow={done}
              >
                <div className="hm-gs__fill" style={{ width: `${(done / 4) * 100}%` }} />
              </div>
            </div>
            <ol className="hm-gs__steps">
              {list.map((s, i) => {
                const isDone = steps[s.key];
                const isCurrent = s.key === current;
                return (
                  <li
                    key={s.key}
                    className={`hm-gs__step${isCurrent ? " hm-gs__step--current" : ""}`}
                  >
                    {isDone ? (
                      <span className="hm-gs__num hm-gs__num--done" aria-label="Done">
                        <Check size={14} strokeWidth={2.4} aria-hidden />
                      </span>
                    ) : (
                      <span className={`hm-gs__num${isCurrent ? " hm-gs__num--current" : ""}`}>
                        {i + 1}
                      </span>
                    )}
                    <div>
                      <div
                        className={`hm-gs__step-title${isDone ? " hm-gs__step-title--done" : ""}`}
                      >
                        {s.title}
                      </div>
                      <div className="hm-gs__step-desc">{s.desc}</div>
                    </div>
                    {isDone ? (
                      <span className="hm-gs__done">Done</span>
                    ) : (
                      <Button
                        variant={isCurrent ? "primary" : "ghost"}
                        size="sm"
                        onClick={s.onClick}
                      >
                        {s.action}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
            {allDone && (
              <div className="hm-gs__ok">
                <span className="hm-gs__ok-icon">
                  <GithubMark />
                </span>
                <span className="hm-gs__ok-text">
                  {firstResult?.url ? (
                    <>
                      Your first pull request is open:{" "}
                      <a href={firstResult.url} target="_blank" rel="noopener noreferrer">
                        {firstResult.label}
                      </a>
                      . Home now shows your runs and teams.
                    </>
                  ) : (
                    <>
                      Your first change is on {firstResult?.label ?? "its branch"}. Home now shows
                      your runs and teams.
                    </>
                  )}
                </span>
                <Button variant="primary" size="sm" onClick={() => void hide()} loading={hiding}>
                  Hide checklist
                </Button>
              </div>
            )}
          </section>
          {stageBody}
        </div>
        <div className="hm-cols__side">
          <section className="hm-card" aria-label="How Tvashtr works" ref={howRef}>
            <div className="hm-how">
              <h2 className="hm-how__title">How Tvashtr works</h2>
              <ol className="hm-how__list">
                {HOW.map(([title, desc], i) => (
                  <li key={title} className="hm-how__item">
                    <span className="hm-how__num">{i + 1}</span>
                    <div>
                      <div className="hm-how__item-title">{title}</div>
                      <div className="hm-how__item-desc">{desc}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
