import { Bell } from "lucide-react";
import { useState } from "react";

import { Button, Checkbox } from "../../../design-system/components";
import type { NotifyPrefs } from "../../../lib/runNotifier";

type Choices = Omit<NotifyPrefs, "notify_asked">;

/**
 * The ask-once dialog's content (Prob-NotifyAsk): the three choices, pre-filled, with Not now /
 * Turn on. NotifyBell anchors it under the run bar's bell.
 */
export function NotifyAsk({
  initial,
  onTurnOn,
  onNotNow,
}: {
  initial: Choices;
  onTurnOn: (choices: Choices) => void;
  onNotNow: () => void;
}) {
  const [choices, setChoices] = useState(initial);
  const toggle = (key: keyof Choices) => () => setChoices((c) => ({ ...c, [key]: !c[key] }));
  return (
    <>
      <div className="tv-notify__head">
        <span className="tv-notify__icon">
          <Bell size={16} strokeWidth={1.6} aria-hidden />
        </span>
        <div>
          <div className="tv-notify__title">Get a notification when a run needs you?</div>
          <div className="tv-notify__body">
            Even when Tvashtr is in the background. You can change this later in Settings.
          </div>
        </div>
      </div>
      <div className="tv-notify__choices">
        <Checkbox
          label="When a run needs you"
          description="An approval or a question"
          checked={choices.notify_needs_you}
          onChange={toggle("notify_needs_you")}
        />
        <Checkbox
          label="When a run stalls or fails"
          checked={choices.notify_stalls_fails}
          onChange={toggle("notify_stalls_fails")}
        />
        <Checkbox
          label="When a run finishes"
          description="With its pull request"
          checked={choices.notify_finishes}
          onChange={toggle("notify_finishes")}
        />
      </div>
      <div className="tv-notify__actions">
        <Button variant="ghost" size="sm" onClick={onNotNow}>
          Not now
        </Button>
        <Button
          variant="primary"
          size="sm"
          iconLeft={<Bell size={14} strokeWidth={1.6} aria-hidden />}
          onClick={() => onTurnOn(choices)}
        >
          Turn on
        </Button>
      </div>
    </>
  );
}
