/**
 * "Install the Tvashtr GitHub App" (TkF-Catalog-3, TOOL-24): the alertdialog before GitHub. "Open
 * GitHub" opens the App's install URL (`/api/config.github_install_url`, already pointed back at
 * this computer on Desktop by `rewriteGithubInstallUrlForDesktop`). The website opens it in a new
 * window and keeps this page; Desktop loads GitHub in this window and reloads the app afterwards,
 * so its copy doesn't promise a new window (TOOL-69).
 */
import { createPortal } from "react-dom";

import { Button } from "../../design-system/components";
import { isDesktopApp } from "../../lib/desktopRepos";
import { useModalDialog } from "../../lib/useModalDialog";
import { openGithub } from "./githubReturn";
import "../secrets/secrets.css";

const TITLE = "Install the Tvashtr GitHub App";
const WEB_BODY =
  "GitHub opens in a new window. Pick the repos Tvashtr can use, then come back here. Hosted runs can only open pull requests on those repos.";
const DESKTOP_BODY =
  "GitHub opens in this window. Pick the repos Tvashtr can use, and you’ll come back to this page. Hosted runs can only open pull requests on those repos.";

export function InstallGithubAppDialog({
  url,
  onClose,
  onLeave,
}: {
  /** The install URL; "Open GitHub" is disabled without one. */
  url: string;
  onClose: () => void;
  /** Called right before GitHub opens (remembers the state to compare on return). */
  onLeave: () => void;
}) {
  const ref = useModalDialog<HTMLDivElement>(true, onClose);
  const open = () => {
    onLeave();
    openGithub(url);
    onClose();
  };

  return createPortal(
    <>
      <div className="ds-scrim" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label={TITLE}
        className="ds-dialog sc-dialog sc-dialog--confirm"
        tabIndex={-1}
      >
        <h2 className="ds-dialog__title">{TITLE}</h2>
        <div className="ds-dialog__body">{isDesktopApp() ? DESKTOP_BODY : WEB_BODY}</div>
        <div className="ds-dialog__actions">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={open} disabled={!url}>
            Open GitHub
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
