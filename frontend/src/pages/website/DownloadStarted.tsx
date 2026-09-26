/**
 * `#/download/started` (website.md WEB-34, WEB-35; design Web-Download2, WbF-Mac-3, WbF-Mac-4): the
 * three install steps, then "Open Tvashtr?", which hands `tvashtr://home` to the browser. Signed in
 * here, the link carries the GitHub login as a display hint for Desktop's welcome (desktop-app.md
 * §6: `?from=web&login=&host=`, never a token).
 */
import { Download, ExternalLink } from "lucide-react";
import { useState } from "react";

import { Button, ButtonLink, Dialog } from "../../design-system/components";
import type { AuthUser } from "../../lib/api";
import { desktopHomeLink, openDesktopLink } from "../../lib/desktopDeepLinks";
import { DESKTOP_MAC_DMG_URL } from "../../lib/desktopDownload";
import { QuarantineFix } from "./QuarantineFix";

export function DownloadStarted({ user }: { user: AuthUser | null | undefined }) {
  const [asking, setAsking] = useState(false);
  return (
    <section className="web-dl">
      <span className="web-badge web-badge--success">
        <Download size={12} strokeWidth={1.6} aria-hidden />
        Your download has started
      </span>
      <h1 className="web-dl__title web-dl__title--steps">Three steps and you’re in.</h1>
      <ol className="web-steps">
        <li>
          <span className="web-steps__n">1</span>
          <div>
            <div className="web-steps__title">Open the downloaded file</div>
            <div className="web-steps__detail">
              <b>Tvashtr-mac.dmg</b> is in your Downloads. Drag Tvashtr into Applications.
            </div>
          </div>
        </li>
        <li>
          <span className="web-steps__n">2</span>
          <div>
            <div className="web-steps__title">Open it the first time with right-click → Open</div>
            <div className="web-steps__detail">
              This build isn’t notarized by Apple yet, so macOS asks you to confirm once.
            </div>
            <QuarantineFix />
          </div>
        </li>
        <li>
          <span className="web-steps__n">3</span>
          <div>
            <div className="web-steps__title">Sign in with GitHub</div>
            <div className="web-steps__detail">
              Use the same account as the website. The app walks you through the rest.
            </div>
          </div>
        </li>
      </ol>
      <div className="web-dl__row">
        <Button variant="secondary" size="md" onClick={() => setAsking(true)}>
          <ExternalLink size={15} strokeWidth={1.6} aria-hidden />
          <span>I’ve installed it — open Tvashtr</span>
        </Button>
        <ButtonLink variant="ghost" size="md" href={DESKTOP_MAC_DMG_URL}>
          Download again
        </ButtonLink>
      </div>
      <Dialog
        open={asking}
        title="Open Tvashtr?"
        onClose={() => setAsking(false)}
        closeButton={false}
        // The design's dialog is 500px wide overall (border-box), not 500 of content.
        width={456}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                openDesktopLink(desktopHomeLink(user?.github_login));
                setAsking(false);
              }}
            >
              Open Tvashtr
            </Button>
          </>
        }
      >
        <div className="web-dialog__body">
          Your browser asks before opening the app. Tvashtr then shows its own welcome and signs you
          in with the same GitHub account.
        </div>
      </Dialog>
    </section>
  );
}
