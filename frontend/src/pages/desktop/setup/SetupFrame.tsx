import type { ReactNode } from "react";

import { Avatar, Button, Logo } from "../../../design-system/components";
import type { SetupStep } from "../../../lib/desktopSetup";
import { CheckIcon } from "../icons";
import "./setup.css";

type RailStep = "signin" | SetupStep;

const ORDER: RailStep[] = ["signin", "engines", "project", "team"];

const COPY: Record<Exclude<RailStep, "signin">, { title: string; sub: string }> = {
  engines: { title: "Engines", sub: "How agents run here" },
  project: { title: "Project", sub: "Where teams work" },
  team: { title: "First team", sub: "Start from a template" },
};

export interface SetupFooter {
  /** Back to the previous step; omitted = rendered disabled (Engines, OQ-15). */
  onBack?: () => void;
  /** Skip for now (Engines only, DT-18). */
  onSkip?: () => void;
  primary: { label: string; disabled?: boolean; busy?: boolean; onClick: () => void };
}

/**
 * Tvashtr Desktop's setup frame (desktop-app.md §1 "Setup frame", DT-16..DT-18): the 320px rail —
 * Logo, "Set up Tvashtr Desktop", the steps (done, current, later; not clickable,
 * `aria-current="step"`) and "Signed in as <login>" with Switch — beside the main column and its
 * footer (Back, Skip for now, Continue). `overlay` covers everything below the title strip
 * (the Terminal sign-in scrim, DtF-Run-4). `teamsAlready` (DT-37): the account has teams, so
 * First team is skipped — the rail shows it done, "You have teams already".
 */
export function SetupFrame({
  step,
  login,
  onSwitch,
  footer,
  overlay,
  teamsAlready = false,
  children,
}: {
  step: SetupStep;
  login: string;
  onSwitch: () => void;
  footer: SetupFooter;
  overlay?: ReactNode;
  teamsAlready?: boolean;
  children: ReactNode;
}) {
  const current = ORDER.indexOf(step);
  return (
    <div className="st-frame">
      <aside className="st-rail" aria-label="Set up Tvashtr Desktop">
        <Logo size={26} />
        <div>
          <div className="st-rail__title">Set up Tvashtr Desktop</div>
          <div className="st-rail__sub">About 2 minutes. You can change all of this later.</div>
        </div>
        <ol className="st-steps" aria-label="Setup steps">
          {ORDER.map((id, i) => {
            const skipped = id === "team" && teamsAlready && i > current;
            const state = i < current || skipped ? "done" : i === current ? "current" : "later";
            const { title, sub } =
              id === "signin"
                ? { title: "Sign in", sub: login }
                : skipped
                  ? { title: COPY.team.title, sub: "You have teams already" }
                  : COPY[id];
            return (
              <li
                key={id}
                className={`st-step st-step--${state}`}
                aria-current={state === "current" ? "step" : undefined}
              >
                <span className="st-step__dot" aria-hidden="true">
                  {state === "done" ? <CheckIcon /> : i + 1}
                </span>
                <div>
                  <div className="st-step__title">{title}</div>
                  <div className="st-step__sub">{sub}</div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="st-rail__who">
          <Avatar name={login} size="sm" accent />
          <span>
            Signed in as <b>{login}</b>
          </span>
          <span className="st-rail__switch">
            <button type="button" className="st-link" onClick={onSwitch}>
              Switch
            </button>
          </span>
        </div>
      </aside>
      <div className="st-main">
        <main className="st-body">{children}</main>
        <footer className="st-foot">
          <Button variant="ghost" size="md" disabled={!footer.onBack} onClick={footer.onBack}>
            Back
          </Button>
          <span className="st-foot__push" />
          {footer.onSkip && (
            <Button variant="ghost" size="md" onClick={footer.onSkip}>
              Skip for now
            </Button>
          )}
          <Button
            variant="primary"
            size="md"
            disabled={footer.primary.disabled}
            loading={footer.primary.busy}
            onClick={footer.primary.onClick}
          >
            {footer.primary.label}
          </Button>
        </footer>
      </div>
      {overlay}
    </div>
  );
}

/** The h1 + lede block at the top of every setup step. */
export function SetupHead({ title, lede }: { title: string; lede: ReactNode }) {
  return (
    <div className="st-head">
      <h1 className="st-h1">{title}</h1>
      <p className="st-lede">{lede}</p>
    </div>
  );
}
