/**
 * The website's two ways to Tvashtr Desktop (EnF-WebDesktop-2/3):
 * - Open (ENG-48): the page has just handed `tvashtr://engines/subscriptions[?connect=…]` to the
 *   browser. The dialog says what happens next, Try again hands the link over again, Download swaps
 *   to Get, and the dialog closes itself once Desktop checks in: it re-reads the runner every 3s and
 *   closes when the server reports a check-in newer than the one it saw when it opened.
 * - Get (ENG-47): what Desktop is, then Download → the stable latest-release DMG
 *   (DESKTOP_MAC_DMG_URL, never a version). The app isn't signed yet, so the dialog also gives the
 *   one-line Terminal fix for macOS's "Tvashtr is damaged". On any other platform it says Desktop
 *   is Mac-only for now and links the releases page instead of the Mac DMG (OQ-18).
 */
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button, ButtonLink } from "../../design-system/components";
import { openTvashtrDesktop } from "../../lib/desktopDeepLinks";
import {
  DESKTOP_MAC_DMG_URL,
  DESKTOP_RELEASES_URL,
  isMacPlatform,
} from "../../lib/desktopDownload";
import type { ConnectTarget } from "../../lib/nav";
import { useModalDialog } from "../../lib/useModalDialog";
import { useEngines } from "./enginesData";

/** How often the Opening dialog asks whether Desktop has checked in (ENG-48). */
const CHECK_IN_POLL_MS = 3_000;

const QUARANTINE_FIX = "xattr -dr com.apple.quarantine /Applications/Tvashtr.app";

export function OpenDesktopDialog({
  connect,
  onClose,
  onGetDesktop,
}: {
  /** The card the link points Desktop at (claude or grok), if any. */
  connect?: ConnectTarget | null;
  onClose: () => void;
  /** Download Tvashtr Desktop: swap to the Get dialog. */
  onGetDesktop: () => void;
}) {
  const { runner, refreshRunner } = useEngines();
  // The check-in the server knew about when the link was handed over.
  const [seen] = useState(runner.last_seen_at);
  const ref = useModalDialog<HTMLDivElement>(true, onClose);

  useEffect(() => {
    const id = window.setInterval(() => void refreshRunner(), CHECK_IN_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshRunner]);

  // Desktop checked in after the link went out: it's open, so the dialog has done its job.
  useEffect(() => {
    if (runner.fresh && runner.last_seen_at !== null && runner.last_seen_at !== seen) onClose();
  }, [runner, seen, onClose]);

  return createPortal(
    <>
      <div className="ds-scrim" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label="Opening Tvashtr Desktop…"
        className="ds-dialog"
        tabIndex={-1}
      >
        <h2 className="ds-dialog__title">Opening Tvashtr Desktop…</h2>
        <div className="ds-dialog__body">
          Your browser may ask if it can open the Tvashtr app. Say yes. If nothing opens, you may
          not have the app yet.
        </div>
        <div className="ds-dialog__actions">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" size="sm" onClick={onGetDesktop}>
            Download Tvashtr Desktop
          </Button>
          <Button variant="primary" size="sm" onClick={() => openTvashtrDesktop(connect)}>
            Try again
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export function GetDesktopDialog({ onClose }: { onClose: () => void }) {
  const ref = useModalDialog<HTMLDivElement>(true, onClose);
  const mac = isMacPlatform();
  return createPortal(
    <>
      <div className="ds-scrim" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label="Get Tvashtr Desktop"
        className="ds-dialog"
        tabIndex={-1}
      >
        <h2 className="ds-dialog__title">Get Tvashtr Desktop</h2>
        <div className="ds-dialog__body">
          Tvashtr Desktop runs agents on this computer with your own Claude or Grok plan. After you
          install it, sign in with the same account and connect a subscription.
        </div>
        <ul className="eng-getdesk__list">
          {[
            "Same teams, tools and keys as the website",
            "Runs use your subscription first, then API keys",
            "Runs stop when you quit the app",
          ].map((line) => (
            <li key={line}>
              <Check size={13} strokeWidth={2} aria-hidden />
              {line}
            </li>
          ))}
        </ul>
        {mac ? (
          <div className="eng-getdesk__note">
            The app isn’t signed yet, so macOS may say “Tvashtr is damaged”. After you move it to
            Applications, run this once in Terminal, then open it:
            <code className="eng-getdesk__cmd">{QUARANTINE_FIX}</code>
          </div>
        ) : (
          <p className="eng-getdesk__note">Tvashtr Desktop is Mac-only for now.</p>
        )}
        <div className="ds-dialog__actions">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Not now
          </Button>
          {mac ? (
            <ButtonLink variant="primary" size="sm" href={DESKTOP_MAC_DMG_URL}>
              Download
            </ButtonLink>
          ) : (
            <ButtonLink variant="primary" size="sm" href={DESKTOP_RELEASES_URL}>
              See releases
            </ButtonLink>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
