import { Bell } from "lucide-react";
import { useEffect, useState } from "react";

import { IconButton, Popover } from "../../../design-system/components";
import {
  type NotifyPrefs,
  askNotificationPermission,
  claimAutoAsk,
  loadNotifyPrefs,
  saveNotifyPrefs,
} from "../../../lib/runNotifier";
import { NotifyAsk } from "./NotifyAsk";
import "./notify.css";

const ALL_ON = { notify_needs_you: true, notify_stalls_fails: true, notify_finishes: true };

/**
 * The run bar's bell (ruling R10, Prob-NotifyAsk): opens the ask dialog, and opens it on its own
 * once a session while the account hasn't answered. Turn on asks the OS and saves the choices;
 * Not now saves the answer with every choice off. lib/runNotifier does the notifying.
 */
export function NotifyBell() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null);

  useEffect(() => {
    let mounted = true;
    void loadNotifyPrefs().then((p) => {
      if (!mounted || !p) return;
      setPrefs(p);
      if (!p.notify_asked && claimAutoAsk()) setOpen(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const answer = (next: NotifyPrefs) => {
    setOpen(false);
    setPrefs(next);
    void saveNotifyPrefs(next);
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      width={360}
      label="Notifications"
      className="tv-notify"
      trigger={
        <IconButton
          size="sm"
          aria-label="Notifications"
          title="Notifications"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Bell size={15} strokeWidth={1.6} aria-hidden />
        </IconButton>
      }
    >
      <NotifyAsk
        initial={prefs ?? ALL_ON}
        onTurnOn={(choices) => {
          void askNotificationPermission(); // inside the click, so the browser shows its prompt
          answer({ ...choices, notify_asked: true });
        }}
        onNotNow={() =>
          answer({
            notify_asked: true,
            notify_needs_you: false,
            notify_stalls_fails: false,
            notify_finishes: false,
          })
        }
      />
    </Popover>
  );
}
