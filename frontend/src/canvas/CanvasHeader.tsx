import { useState } from "react";
import { Globe, Monitor } from "lucide-react";

import { Logo } from "../design-system/components";
import { AccountMenu, type ShellUser } from "../pages/shell/Shell";
import { ShortcutsDialog } from "../pages/shell/ShortcutsDialog";

/** "Tvashtr Desktop" with a monitor inside the app; the site's actual host with a globe on the web. */
function EnvChip() {
  const desktop = document.documentElement.dataset.tvashtrDesktop === "true";
  return (
    <span className="cv-env" data-testid="env-chip">
      {desktop ? (
        <Monitor size={13} strokeWidth={1.7} aria-hidden />
      ) : (
        <Globe size={13} strokeWidth={1.7} aria-hidden />
      )}
      {desktop ? "Tvashtr Desktop" : window.location.host}
    </span>
  );
}

/** The canvas's top bar (PANEL-1): Logo, "the living canvas", where it runs, and the account. */
export function CanvasHeader({
  user,
  onLogout,
}: {
  user?: ShellUser | null;
  onLogout?: () => void;
}) {
  const [shortcuts, setShortcuts] = useState(false);
  return (
    <header className="cv-bar">
      <div className="cv-bar__group">
        <Logo size={26} />
        <span className="cv-tagline">the living canvas</span>
      </div>
      <div className="cv-bar__group">
        <EnvChip />
        {user && (
          <AccountMenu
            user={user}
            onShowShortcuts={() => setShortcuts(true)}
            onLogout={() => onLogout?.()}
          />
        )}
      </div>
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
    </header>
  );
}
