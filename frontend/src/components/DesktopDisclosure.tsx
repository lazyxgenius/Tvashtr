import { useState } from "react";

import { SUBSCRIPTION_DISCLOSURE } from "../lib/engines";

const SEEN_KEY = "tvashtr.desktopDisclosureSeen";

function seenThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * M-subs-desktop §3.0: shown once at Tvashtr Desktop launch (and always on the Engines cards) —
 * Tvashtr runs the user's OWN installed Claude Code / Grok and never sees their login. Dismissing it
 * hides it for the rest of this app session; the web app never shows it.
 */
export function DesktopDisclosure() {
  const isDesktop = document.documentElement.dataset.tvashtrDesktop === "true";
  const [visible, setVisible] = useState(() => isDesktop && !seenThisSession());
  if (!visible) return null;
  const dismiss = () => {
    try {
      window.sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* storage unavailable — hide for this render tree anyway */
    }
    setVisible(false);
  };
  return (
    <div
      className="tv-desktop-disclosure"
      role="note"
      aria-label="Your subscriptions on this computer"
    >
      <p>{SUBSCRIPTION_DISCLOSURE}</p>
      <button type="button" className="tv-btn tv-btn--sm tv-btn--ghost" onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}
