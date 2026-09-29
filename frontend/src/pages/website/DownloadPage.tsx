/**
 * `#/download` (website.md WEB-32, WEB-33, WEB-36; design Web-Download, Web-DownloadWin). The page
 * picks its variant from the visitor's platform, or from `?os=` (then it claims no detection):
 * - a Mac: Tvashtr for Mac. "Apple silicon" is claimed only when UA-CH says `arm` (OQ-7);
 * - an Intel Mac (UA-CH `x86`): the Mac build is arm64 only, so the "not for this computer yet"
 *   page (OQ-6);
 * - Windows or Linux: the desktop app is Mac-only for now (OQ-29);
 * - a phone: the Mac page without a badge, and "send yourself the link" instead of a DMG (OQ-24).
 * Every download control is the stable latest-release DMG (WEB-37).
 */
import {
  Check,
  Download,
  Globe,
  Info,
  KeyRound,
  Link as LinkIcon,
  Mail,
  Power,
  Share,
  Terminal,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button, ButtonLink, useToast } from "../../design-system/components";
import type { AuthUser } from "../../lib/api";
import { getSiteInfo } from "../../lib/api/site";
import {
  DESKTOP_MAC_DMG_URL,
  DESKTOP_MIN_MACOS_LABEL,
  GITHUB_RELEASES_PAGE_URL,
} from "../../lib/desktopDownload";
import { type DownloadOs, navigate } from "../../lib/nav";
import { usePlatform } from "../../lib/platform";

export function DownloadPage({
  os: chosen,
  user,
}: {
  /** `?os=`: the visitor picked a platform, so nothing is "detected". */
  os?: DownloadOs;
  user: AuthUser | null | undefined;
}) {
  const platform = usePlatform();
  // A phone never gets the DMG (WEB-25), whatever `?os=` says: it is decided by the device.
  if (platform.os === "phone") return <ForMac badge={null} phone />;
  const detected = chosen === undefined;
  const os = chosen ?? platform.os;
  if (os === "windows" || os === "linux") {
    return <NotForThisComputer kind={os} detected={detected} user={user} />;
  }
  if (os === "mac" && detected && platform.arch === "x86") {
    return <NotForThisComputer kind="intel" detected user={user} />;
  }
  let badge: string | null = null;
  if (detected && os === "mac" && platform.arch === "arm") {
    badge = "We detected a Mac with Apple silicon";
  } else if (detected && os === "mac" && platform.arch === "unknown") {
    badge = "We detected a Mac";
  }
  return <ForMac badge={badge} phone={false} />;
}

function ForMac({ badge, phone }: { badge: string | null; phone: boolean }) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void getSiteInfo().then((info) => {
      if (live) setVersion(info?.version ?? null);
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="web-dl">
      {badge && (
        <span className="web-badge web-badge--success">
          <Check size={12} strokeWidth={2.2} aria-hidden />
          {badge}
        </span>
      )}
      <h1 className="web-dl__title">Tvashtr for Mac</h1>
      <p className="web-dl__lede">
        Agents on your Claude or Grok plan run on this computer, with the plan you already pay for.
        Same account, teams and keys as the website.
      </p>
      {phone ? (
        <SendLink />
      ) : (
        <ButtonLink
          variant="primary"
          size="lg"
          href={DESKTOP_MAC_DMG_URL}
          // The DMG answers as an attachment, so the page stays: show the install steps.
          onClick={() => navigate({ page: "download", started: true })}
        >
          <Download size={17} strokeWidth={1.6} aria-hidden />
          <span>Download for Mac · Apple silicon</span>
        </ButtonLink>
      )}
      <div className="web-dl__meta">
        Needs a Mac with Apple silicon (M1 or later)
        {version && ` · v${version}`} · {DESKTOP_MIN_MACOS_LABEL}
      </div>
      <div className="web-dl__needs">
        <span className="web-dl__needs-head">What you need on your Mac</span>
        <div className="web-dl__need">
          <Terminal size={16} strokeWidth={1.6} aria-hidden />
          Claude Code or Grok installed, if you want to use your plan. The app checks for you.
        </div>
        <div className="web-dl__need">
          <KeyRound size={16} strokeWidth={1.6} aria-hidden />
          Or an API key for any provider.
        </div>
        <div className="web-dl__need">
          <Power size={16} strokeWidth={1.6} aria-hidden />
          Steps on your plan stop when you quit the app.
        </div>
      </div>
    </section>
  );
}

/** A phone can't run the Mac app: send the page to a computer (OQ-10, OQ-24). */
export function SendLink({
  path = "/#/download",
  fullWidth,
}: {
  path?: string;
  fullWidth?: boolean;
}) {
  const toast = useToast();
  const url = `${window.location.origin}${path}`;
  if (typeof navigator.share === "function") {
    return (
      <Button
        variant="primary"
        size="lg"
        fullWidth={fullWidth}
        onClick={() => void navigator.share({ title: "Tvashtr", url }).catch(() => undefined)}
      >
        <Share size={17} strokeWidth={1.6} aria-hidden />
        <span>Send me the link</span>
      </Button>
    );
  }
  return (
    <Button
      variant="primary"
      size="lg"
      fullWidth={fullWidth}
      onClick={() =>
        void navigator.clipboard?.writeText(url).then(
          () => toast({ message: "Link copied" }),
          () => undefined,
        )
      }
    >
      <LinkIcon size={17} strokeWidth={1.6} aria-hidden />
      <span>Copy the link</span>
    </Button>
  );
}

const OTHER = {
  windows: {
    badge: "We detected Windows",
    title: "The desktop app is Mac-only for now.",
    ask: "Want to know when Windows is ready?",
    macLink: "I’m on a Mac — show the Mac download",
  },
  linux: {
    badge: "We detected Linux",
    title: "The desktop app is Mac-only for now.",
    ask: "Want to know when Linux is ready?",
    macLink: "I’m on a Mac — show the Mac download",
  },
  intel: {
    badge: "We detected an Intel Mac",
    title: "The desktop app needs Apple silicon for now.",
    ask: "Want to know when there’s a version for Intel Macs?",
    macLink: "Show the Apple silicon download",
  },
};

/** Windows, Linux or an Intel Mac: no build yet. The email list isn't built (OQ-9): releases on
 *  GitHub say when there is one. */
function NotForThisComputer({
  kind,
  detected,
  user,
}: {
  kind: keyof typeof OTHER;
  detected: boolean;
  user: AuthUser | null | undefined;
}) {
  const copy = OTHER[kind];
  return (
    <section className="web-dl">
      {detected && (
        <span className="web-badge web-badge--info">
          <Info size={12} strokeWidth={1.6} aria-hidden />
          {copy.badge}
        </span>
      )}
      <h1 className="web-dl__title web-dl__title--other">{copy.title}</h1>
      <p className="web-dl__lede">
        You can do everything on the website today with API keys. {copy.ask}
      </p>
      <div className="web-dl__row">
        <ButtonLink variant="primary" size="lg" href={user ? "#/home" : "#/signin"}>
          <Globe size={15} strokeWidth={1.6} aria-hidden />
          <span>Use the website</span>
        </ButtonLink>
      </div>
      <div className="web-dl__row">
        <ButtonLink
          variant="secondary"
          size="md"
          href={GITHUB_RELEASES_PAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Mail size={15} strokeWidth={1.6} aria-hidden />
          <span>Watch for releases on GitHub</span>
        </ButtonLink>
      </div>
      <div className="web-dl__meta">
        <a
          href="#/download?os=mac"
          onClick={(e) => {
            e.preventDefault();
            navigate({ page: "download", os: "mac" }, { replace: true });
          }}
        >
          {copy.macLink}
        </a>
      </div>
    </section>
  );
}
