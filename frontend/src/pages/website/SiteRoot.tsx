/**
 * The public website's pages (website.md WEB-1): the landing, sign-in and download, signed in or
 * out. `AuthGate` renders it for every public address; Tvashtr Desktop never does (WEB-3).
 */
import { type ReactNode, useEffect, useSyncExternalStore } from "react";

import type { AuthUser, Config } from "../../lib/api";
import { type PublicRoute, navigate, parseRoute } from "../../lib/nav";
import { DownloadPage } from "./DownloadPage";
import { DownloadStarted } from "./DownloadStarted";
import { LandingMobile } from "./LandingMobile";
import { LandingPage } from "./LandingPage";
import { useSectionScroll } from "./sections";
import { type SiteNavItem, SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { SignInDone } from "./SignInDone";
import { SignInPage } from "./SignInPage";
import "./website.css";

/** Below 720px the landing is the phone page (WEB-19). */
const PHONE = "(max-width: 719px)";
function subscribePhone(onChange: () => void): () => void {
  const query = window.matchMedia?.(PHONE);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}
function isPhone(): boolean {
  return window.matchMedia?.(PHONE).matches ?? false;
}

const TITLES: Record<PublicRoute["page"], string> = {
  welcome: "Tvashtr — compose your own team of AI agents",
  download: "Tvashtr for Mac",
  signin: "Sign in · Tvashtr",
};

export function SiteRoot({
  route,
  user,
  config,
  onAuthed,
}: {
  route: PublicRoute;
  /** undefined while the session check is in flight, null when signed out. */
  user: AuthUser | null | undefined;
  config: Config | null;
  onAuthed: (user: AuthUser) => void;
}) {
  const title = TITLES[route.page];
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = "Tvashtr";
    };
  }, [title]);

  // Signed in, the sign-in page has nothing to do: on to where they were going (WEB-4).
  // `#/signin/done` does its own leaving once the account is ready (WEB-29).
  const leaveSignIn =
    route.page === "signin" && !route.done && user ? (route.next ?? "/home") : null;
  useEffect(() => {
    if (leaveSignIn) navigate(parseRoute(`#${leaveSignIn}`), { replace: true });
  }, [leaveSignIn]);

  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);
  useSectionScroll(route.page === "welcome" ? route.section : undefined);

  if (route.page === "download") {
    return (
      <SiteFrame user={user} current="desktop">
        {route.started ? (
          <DownloadStarted user={user} />
        ) : (
          <DownloadPage os={route.os} user={user} />
        )}
      </SiteFrame>
    );
  }
  if (route.page === "signin") {
    if (route.done) {
      // Arriving here is a fresh page load from GitHub: assume hosted until /api/config says.
      return <SignInDone user={user} next={route.next} hosted={config?.hosted_mode !== false} />;
    }
    if (user) return null;
    return <SignInPage error={route.error} next={route.next} config={config} onAuthed={onAuthed} />;
  }
  if (phone) return <LandingMobile user={user} config={config} />;
  return (
    <SiteFrame user={user}>
      <LandingPage user={user} config={config} />
    </SiteFrame>
  );
}

/** Skip link, header, the page, footer (WEB-38 landmarks). */
function SiteFrame({
  user,
  current,
  children,
}: {
  user: AuthUser | null | undefined;
  current?: SiteNavItem;
  children: ReactNode;
}) {
  return (
    <div className="web-page">
      <a
        className="web-skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <SiteHeader user={user} current={current} />
      <main id="main" className="web-main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
