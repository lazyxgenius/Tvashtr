import { type ReactNode, useEffect } from "react";

import {
  HELP_URL,
  PRIVACY_URL,
  setDesktopTitle,
  TITLE_LAUNCH,
  useAppVersion,
} from "../../lib/desktopApp";
import "./desktop.css";

/**
 * The launch frame every Desktop launch and sign-in screen sits in (desktop-app.md §1): the coral
 * wash, one centred column (820 / 560 / 440px wide, 18px gap) and the foot "Tvashtr Desktop ·
 * <version>" with Help and Privacy, which open in the default browser (DT-4, DT-51). The title
 * strip reads "Tvashtr" here (DT-3).
 */
export function LaunchFrame({
  width,
  label,
  children,
}: {
  width: 820 | 560 | 440;
  /** The screen's accessible name (the h1 usually gives it; set for a frame without one). */
  label?: string;
  children?: ReactNode;
}) {
  const version = useAppVersion();
  useEffect(() => setDesktopTitle(TITLE_LAUNCH), []);
  return (
    <main className="dt-launch" aria-label={label}>
      <div className="dt-launch__wash">
        <div className="dt-launch__col" style={{ width }}>
          {children}
        </div>
      </div>
      <div className="dt-launch__foot">
        <span>{version ? `Tvashtr Desktop · ${version}` : "Tvashtr Desktop"}</span>
        <span className="dt-launch__links">
          <a href={HELP_URL} target="_blank" rel="noreferrer">
            Help
          </a>
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
            Privacy
          </a>
        </span>
      </div>
    </main>
  );
}

/** The 64px logo mark at the top of Welcome, Handoff, Expired and the checklist screens. */
export function LaunchMark() {
  return <img className="dt-mark" src="/mark-coral.png" width={64} height={64} alt="" />;
}
