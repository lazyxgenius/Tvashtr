import { CheckCircleIcon, InfoIcon, SpinnerIcon, WarningIcon } from "./icons";
import { LaunchFrame, LaunchMark } from "./LaunchFrame";
import type { StatusLine } from "./launchLines";

const ICONS = {
  done: CheckCircleIcon,
  warn: WarningIcon,
  busy: SpinnerIcon,
  note: InfoIcon,
} as const;

/**
 * The launch frame's checklist screen (desktop-app.md §1 "Status checklist card"): the logo mark,
 * a 30px h1 and a card of 12.5px lines — sage check for done, amber triangle for "fix later",
 * spinner for in progress, info icon for a note. Used for the Splash (DT-13), Reconnected (DT-15)
 * and Updating (DT-45) screens; the lines tick as each answer arrives.
 */
export function LaunchStatusPage({ title, lines }: { title: string; lines: StatusLine[] }) {
  return (
    <LaunchFrame width={440}>
      <LaunchMark />
      <h1 className="dt-h1 dt-h1--30">{title}</h1>
      {lines.length > 0 && (
        <div className="dt-checklist" role="status" aria-label={title}>
          {lines.map((line) => {
            const Icon = ICONS[line.tone];
            return (
              <span key={line.text} className={`dt-check dt-check--${line.tone}`}>
                <Icon size={14} />
                {line.text}
              </span>
            );
          })}
        </div>
      )}
    </LaunchFrame>
  );
}
