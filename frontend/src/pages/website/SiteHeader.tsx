/**
 * The website's 72px sticky header (website.md WEB-6, WEB-4, WEB-5). The right side is empty while
 * `/api/auth/me` is in flight (`user === undefined`), so it never flashes the wrong variant; signed
 * out it offers Sign in / Start building, signed in "Signed in as …" and Open app.
 */
import { ArrowRight, ExternalLink } from "lucide-react";

import { Avatar, ButtonLink, Logo } from "../../design-system/components";
import type { AuthUser } from "../../lib/api";
import { GITHUB_REPO_URL } from "../../lib/desktopDownload";

export type SiteNavItem = "product" | "how" | "domains" | "desktop";

const LINKS: { id: SiteNavItem; label: string; href: string }[] = [
  { id: "product", label: "Product", href: "#/welcome?s=product" },
  { id: "how", label: "How it works", href: "#/welcome?s=how" },
  { id: "domains", label: "Domains", href: "#/welcome?s=domains" },
  { id: "desktop", label: "Desktop", href: "#/download" },
];

export function SiteHeader({
  user,
  current,
}: {
  /** undefined while the session check is in flight, null when signed out. */
  user: AuthUser | null | undefined;
  current?: SiteNavItem;
}) {
  return (
    <header className="web-head">
      <a className="web-head__logo" href="#/welcome" aria-label="Tvashtr">
        <Logo size={26} />
      </a>
      <nav className="web-head__nav" aria-label="Site">
        {LINKS.map((l) => (
          <a
            key={l.id}
            className="web-head__link"
            href={l.href}
            aria-current={current === l.id ? "page" : undefined}
          >
            {l.label}
          </a>
        ))}
        <a
          className="web-head__link"
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
          <ExternalLink size={13} strokeWidth={1.6} aria-hidden />
        </a>
      </nav>
      {user === undefined ? (
        <div className="web-head__right" />
      ) : user ? (
        <div className="web-head__right web-head__right--in">
          <span className="web-head__who">
            Signed in as <b>{user.github_login || user.display_name}</b>
          </span>
          <Avatar name={user.display_name ?? ""} size="sm" accent />
          <ButtonLink variant="primary" size="sm" href="#/home">
            <ArrowRight size={15} strokeWidth={1.6} aria-hidden />
            <span>Open app</span>
          </ButtonLink>
        </div>
      ) : (
        <div className="web-head__right">
          <ButtonLink variant="ghost" size="sm" href="#/signin">
            Sign in
          </ButtonLink>
          <ButtonLink variant="primary" size="sm" href="#/signin">
            Start building
          </ButtonLink>
        </div>
      )}
    </header>
  );
}
