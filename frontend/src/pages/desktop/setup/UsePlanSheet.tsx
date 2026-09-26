import { useCallback, useEffect, useState } from "react";

import { Button, Sheet } from "../../../design-system/components";
import { refreshPlan } from "../../../lib/desktopApp";
import type { SubscriptionStatus } from "../../../lib/engines";
import { ExternalLinkIcon, LockIcon, RefreshIcon } from "../icons";
import {
  checkAgainNote,
  NOT_FOUND_YET,
  PLAN_INSTALL_URLS,
  type PlanProvider,
  usePlanCopy,
} from "./planRows";

/**
 * "Use your Claude plan" (DT-25, DtF-Claude-2) and its Grok variant (OQ-18): a right sheet with
 * three numbered steps — install the CLI, sign in once in Terminal, come back and check — and the
 * lock note. Check again asks the bridge to look again (`engines.refresh`); found and signed in
 * with the plan, `onFound` closes the sheet (the caller toasts). Otherwise the footer note says
 * what was found. Close and × change nothing.
 */
export function UsePlanSheet({
  provider,
  mac,
  onClose,
  onStatus,
  onFound,
}: {
  /** The plan being set up; null = closed. */
  provider: PlanProvider | null;
  mac: string;
  onClose: () => void;
  /** Every status Check again reads, so the row behind the sheet stays true. */
  onStatus: (s: SubscriptionStatus) => void;
  /** The plan is found (connected, or found with "Use my plan" off). */
  onFound: (s: SubscriptionStatus) => void;
}) {
  const [note, setNote] = useState(NOT_FOUND_YET);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    // A new opening starts from "Not found yet".
    setNote(NOT_FOUND_YET);
    setChecking(false);
  }, [provider]);

  const checkAgain = useCallback(async () => {
    if (!provider) return;
    setChecking(true);
    const s = await refreshPlan(provider).catch(() => null);
    setChecking(false);
    if (s) onStatus(s);
    const next = checkAgainNote(provider, s?.state ?? "failed");
    if (next === null && s) onFound(s);
    else setNote(next ?? NOT_FOUND_YET);
  }, [onFound, onStatus, provider]);

  const copy = usePlanCopy(provider ?? "claude", mac);
  return (
    <Sheet
      open={provider !== null}
      title={copy.title}
      subtitle={copy.subtitle}
      onClose={onClose}
      footerNote={
        <span role="status" aria-live="polite">
          {note}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" size="sm" loading={checking} onClick={() => void checkAgain()}>
            <RefreshIcon />
            <span>Check again</span>
          </Button>
        </>
      }
    >
      <ol className="st-sheet st-plan-steps">
        <li className="st-plan-step">
          <span className="st-plan-step__num" aria-hidden="true">
            1
          </span>
          <div className="st-plan-step__body">
            <span className="st-plan-step__title">{copy.install.title}</span>
            <span className="st-plan-step__text">{copy.install.body}</span>
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  provider &&
                  window.open(PLAN_INSTALL_URLS[provider], "_blank", "noopener,noreferrer")
                }
              >
                <ExternalLinkIcon />
                <span>Open install guide</span>
              </Button>
            </div>
          </div>
        </li>
        <li className="st-plan-step">
          <span className="st-plan-step__num" aria-hidden="true">
            2
          </span>
          <div className="st-plan-step__body">
            <span className="st-plan-step__title">Sign in once</span>
            <span className="st-plan-step__text">{copy.signIn.body}</span>
            <div>
              <code className="st-plan-step__cmd">{copy.signIn.command}</code>
            </div>
          </div>
        </li>
        <li className="st-plan-step">
          <span className="st-plan-step__num" aria-hidden="true">
            3
          </span>
          <div className="st-plan-step__body">
            <span className="st-plan-step__title">Come back and check</span>
            <span className="st-plan-step__text">{copy.check}</span>
          </div>
        </li>
      </ol>
      <SheetNote>{copy.lock}</SheetNote>
    </Sheet>
  );
}

/** The sheets' sunk lock note ("You sign in inside…", "Saved encrypted…"). */
export function SheetNote({ children }: { children: string }) {
  return (
    <div className="st-sheet st-sheet-note">
      <span className="st-sheet-note__icon">
        <LockIcon />
      </span>
      <span className="st-sheet-note__text">{children}</span>
    </div>
  );
}
