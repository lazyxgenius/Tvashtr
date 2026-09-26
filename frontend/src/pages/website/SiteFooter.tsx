/**
 * The website's footer (website.md WEB-8, from Web-Landing's HTML; clipped in its PNG). Status,
 * Privacy, Terms and the Legal column stay hidden until those pages exist (OQ-14).
 */
import { Logo } from "../../design-system/components";
import { DOCS_URL, GITHUB_RELEASES_PAGE_URL, GITHUB_REPO_URL } from "../../lib/desktopDownload";

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

export function SiteFooter() {
  return (
    <footer className="web-foot">
      <div className="web-foot__in">
        <div className="web-foot__brand">
          <Logo size={26} />
          <span className="web-foot__tag">Composed teams that ship reviewed code.</span>
          <span className="web-foot__copy">© 2026 Tvashtr</span>
        </div>
        <div className="web-foot__col">
          <span className="web-foot__head">Product</span>
          <a href="#/welcome?s=product">Canvas</a>
          <a href="#/welcome?s=domains">Domains</a>
          <a href="#/download">Desktop for Mac</a>
          <a href={GITHUB_RELEASES_PAGE_URL} {...external}>
            Changelog
          </a>
        </div>
        <div className="web-foot__col">
          <span className="web-foot__head">Resources</span>
          <a href={GITHUB_REPO_URL} {...external}>
            GitHub
          </a>
          <a href={DOCS_URL} {...external}>
            Docs
          </a>
        </div>
      </div>
    </footer>
  );
}
