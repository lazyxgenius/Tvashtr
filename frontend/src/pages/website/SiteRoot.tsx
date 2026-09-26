/**
 * The public website's pages (website.md WEB-1): the landing, sign-in and download, signed in or
 * out. `AuthGate` renders it for every public address; Tvashtr Desktop never does (WEB-3).
 *
 * The landing and sign-in still render the previous LandingPage / AuthWizard until their redesigns
 * land (website build groups G2, G3).
 */
import { type ReactNode, useEffect } from "react";

import { AuthWizard } from "../../components/AuthWizard";
import { LandingPage } from "../../components/LandingPage";
import type { AuthUser, Config } from "../../lib/api";
import { type PublicRoute, navigate, parseRoute } from "../../lib/nav";
import { DownloadPage } from "./DownloadPage";
import { DownloadStarted } from "./DownloadStarted";
import { type SiteNavItem, SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import "./website.css";

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
  const leaveSignIn = route.page === "signin" && user ? (route.next ?? "/home") : null;
  useEffect(() => {
    if (leaveSignIn) navigate(parseRoute(`#${leaveSignIn}`), { replace: true });
  }, [leaveSignIn]);

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
    if (user) return null;
    return (
      <AuthWizard
        onAuthed={onAuthed}
        onBack={() => navigate({ page: "welcome" })}
        hosted={config?.hosted_mode ?? false}
        githubInstallUrl={config?.github_install_url ?? ""}
      />
    );
  }
  return <LandingPage onGetStarted={() => navigate({ page: "signin" })} />;
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
