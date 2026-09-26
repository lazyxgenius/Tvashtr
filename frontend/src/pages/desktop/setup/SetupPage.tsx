import { useCallback } from "react";

import { useToast } from "../../../design-system/components";
import type { AuthUser } from "../../../lib/api";
import { loginOf } from "../../../lib/desktopApp";
import {
  type DesktopSetup,
  saveDesktopSetup,
  type SetupStep,
  takeAfterSetup,
} from "../../../lib/desktopSetup";
import { HOME, navigate } from "../../../lib/nav";
import { EnginesStep } from "./EnginesStep";
import { PLAN_INSTALL_URLS } from "./planRows";
import { SetupFrame, SetupHead } from "./SetupFrame";

/**
 * Tvashtr Desktop's first-run setup at `#/setup/<step>` (desktop-app.md DT-16..DT-18), shown
 * full-window by the Workspace while this Mac's setup for the account isn't finished (DT-17).
 */
export function SetupPage({
  step,
  user,
  setup,
  onLogout,
}: {
  step: SetupStep;
  user: AuthUser;
  setup: DesktopSetup;
  onLogout: () => void;
}) {
  const login = loginOf(user);
  switch (step) {
    case "engines":
      return (
        <EnginesStep
          login={login}
          setup={setup}
          onSwitch={onLogout}
          // G4 swaps these for the setup sheets (UsePlanSheet DT-25, SetupKeySheet DT-26).
          onSetUp={(p) => window.open(PLAN_INSTALL_URLS[p], "_blank", "noopener,noreferrer")}
          onUseKey={() => undefined}
        />
      );
    case "project":
      return <InterimStep step="project" login={login} onSwitch={onLogout} />;
    case "team":
      return <InterimStep step="team" login={login} onSwitch={onLogout} />;
  }
}

/** Steps 3 and 4 until their screens land (G5): the frame, the heading and the way on. */
function InterimStep({
  step,
  login,
  onSwitch,
}: {
  step: "project" | "team";
  login: string;
  onSwitch: () => void;
}) {
  const toast = useToast();
  const finish = useCallback(async () => {
    try {
      await saveDesktopSetup({ step: "team", finishedAt: new Date().toISOString() });
    } catch {
      toast({ message: "Couldn’t save this Mac’s setup. Try again.", tone: "error" });
      return;
    }
    const after = takeAfterSetup();
    if (after) window.location.hash = after;
    else navigate(HOME);
  }, [toast]);
  const onward = useCallback(() => {
    if (step === "team") {
      void finish();
      return;
    }
    void saveDesktopSetup({ step: "team" }).catch(() => undefined);
    navigate({ page: "setup", step: "team" });
  }, [finish, step]);
  const back = useCallback(() => {
    const to: SetupStep = step === "team" ? "project" : "engines";
    void saveDesktopSetup({ step: to }).catch(() => undefined);
    navigate({ page: "setup", step: to });
  }, [step]);
  return (
    <SetupFrame
      step={step}
      login={login}
      onSwitch={onSwitch}
      footer={{ onBack: back, primary: { label: "Continue", onClick: onward } }}
    >
      {step === "project" ? (
        <SetupHead
          title="Where should your teams work?"
          lede="Agents read and change code here. They work on a new branch and ask you before anything is merged."
        />
      ) : (
        <SetupHead
          title="Start with a team"
          lede="Pick a starting point. You can change every role, prompt and model on the canvas."
        />
      )}
    </SetupFrame>
  );
}
