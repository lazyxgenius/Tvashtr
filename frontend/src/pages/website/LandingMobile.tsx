/**
 * `#/welcome` on a phone, below 720px (website.md WEB-20..25; design Web-Mobile, WbF-Mob-1..3). Its
 * own copy, not a reflow. Phones never get the DMG (WEB-25): Start building, Download for Mac and
 * the closing button all open the "Best on a computer" sheet (OQ-24), which sends the page to a
 * computer instead of emailing a sign-in link (no email service, OQ-10).
 */
import { Download, Mail, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button, ButtonLink, IconButton, Logo } from "../../design-system/components";
import type { AuthUser, Config } from "../../lib/api";
import { DOCS_URL, GITHUB_REPO_URL } from "../../lib/desktopDownload";
import { useModalDialog } from "../../lib/useModalDialog";
import { GithubIcon } from "../desktop/icons";
import { COPY } from "./copy";
import { SendLink } from "./DownloadPage";
import { Faq, faqItems } from "./Faq";
import { PhoneTeamMock } from "./mocks";
import { onSectionLink } from "./sections";

const WHY = [
  ["Your team is yours", "Draw the process you actually use: roles, handoffs, loops and gates."],
  ["A living spec", "Edit the spec mid-run. The next agent reads the new version."],
  ["Domains", "Your own documents, answered with the exact passage."],
  ["Gates", "Approve the spec, send work back, and get a reviewed PR."],
];

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

export function LandingMobile({
  user,
  config,
}: {
  user: AuthUser | null | undefined;
  config: Config | null;
}) {
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(false);
  const openSheet = () => setSheet(true);

  return (
    <div className="web-page web-m">
      <header className="web-m__head">
        <a className="web-head__logo" href="#/welcome" aria-label="Tvashtr">
          <Logo size={22} />
        </a>
        <IconButton size="md" aria-label="Open menu" onClick={() => setMenu(true)}>
          <Menu size={16} strokeWidth={1.6} aria-hidden />
        </IconButton>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="web-m__hero">
          <span className="web-badge web-badge--cream">{COPY.phonePill}</span>
          <h1 className="web-m__title">
            Compose your own team of AI agents, <em>not just use one.</em>
          </h1>
          <p className="web-m__lede">
            Draw the team on a canvas. It works on your GitHub repo and hands back a reviewed pull
            request.
          </p>
          <Button variant="primary" size="lg" fullWidth onClick={openSheet}>
            <GithubIcon size={16} />
            <span>Start building</span>
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={openSheet}>
            <Download size={16} strokeWidth={1.6} aria-hidden />
            <span>Download for Mac</span>
          </Button>
          <div className="web-m__note">Tvashtr is built for a computer screen.</div>
          {/* "How it works" on a phone: the team at work (the 1440 cards aren't drawn at 390). */}
          <PhoneTeamMock id="how" />
        </section>

        <section id="product" className="web-m__sec web-m__sec--why">
          <span className="web-eyebrow">Why Tvashtr</span>
          <h2 className="web-m__h2">Composable. Legible. Steerable.</h2>
          {WHY.map(([title, body]) => (
            <div
              key={title}
              id={title === "Domains" ? "domains" : undefined}
              className="web-m__card"
            >
              <span className="web-eyebrow">{title}</span>
              <div className="web-m__card-body">{body}</div>
            </div>
          ))}
        </section>

        <section id="two-ways" className="web-m__sec web-m__sec--two">
          <span className="web-eyebrow">Two ways to run</span>
          <h2 className="web-m__h2 web-m__h2--two">Website or Mac app</h2>
          <div className="web-m__way">
            <b>Website</b> · runs on Tvashtr’s servers with your API keys.
          </div>
          <div className="web-m__way">
            <b>Desktop app</b> · runs your Claude or Grok plan’s steps on your Mac.
          </div>
        </section>

        <section id="faq" className="web-m__faq">
          <span className="web-eyebrow">Questions</span>
          <Faq items={faqItems(config).slice(0, 4)} initialOpen={null} phone />
        </section>

        <section className="web-m__close">
          <h2 className="web-m__close-title">Start weaving.</h2>
          <Button variant="primary" size="lg" fullWidth onClick={openSheet}>
            <Mail size={15} strokeWidth={1.6} aria-hidden />
            <span>Send me a link for my computer</span>
          </Button>
        </section>
      </main>
      <footer className="web-m__foot">
        <Logo size={22} />
        <span>Composed teams that ship reviewed code.</span>
        <span>
          <a href={GITHUB_REPO_URL} {...external}>
            GitHub
          </a>
          {" · "}
          <a href={DOCS_URL} {...external}>
            Docs
          </a>
        </span>
      </footer>

      {menu && (
        <MobileMenu
          user={user}
          onClose={() => setMenu(false)}
          onStart={() => {
            setMenu(false);
            openSheet();
          }}
        />
      )}
      {sheet && <PhoneSheet onClose={() => setSheet(false)} />}
    </div>
  );
}

/** A scrim or full-screen layer holds the page still while it's open. */
function useScrollLock() {
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
}

/** WbF-Mob-2: the full-screen menu (WEB-23). */
function MobileMenu({
  user,
  onClose,
  onStart,
}: {
  user: AuthUser | null | undefined;
  onClose: () => void;
  onStart: () => void;
}) {
  const ref = useModalDialog<HTMLDivElement>(true, onClose);
  useScrollLock();
  const section = (href: string, label: string) => (
    <a
      className="web-m__link"
      href={href}
      onClick={(e) => {
        onClose();
        onSectionLink(e);
      }}
    >
      {label}
    </a>
  );
  return (
    <div ref={ref} className="web-m__menu" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="web-m__head">
        <Logo size={22} />
        <IconButton size="md" aria-label="Close menu" onClick={onClose}>
          <X size={16} strokeWidth={1.6} aria-hidden />
        </IconButton>
      </div>
      <nav className="web-m__links" aria-label="Site">
        {section("#/welcome?s=product", "Product")}
        {section("#/welcome?s=how", "How it works")}
        {section("#/welcome?s=domains", "Domains")}
        <a className="web-m__link" href="#/download" onClick={onClose}>
          Desktop for Mac
        </a>
        <a className="web-m__link" href={GITHUB_REPO_URL} {...external}>
          GitHub
        </a>
        <Button variant="primary" size="lg" fullWidth onClick={onStart}>
          <GithubIcon size={16} />
          <span>Start building</span>
        </Button>
        {user ? (
          <ButtonLink variant="secondary" size="lg" className="ds-btn--block" href="#/home">
            Open app
          </ButtonLink>
        ) : (
          <ButtonLink variant="secondary" size="lg" className="ds-btn--block" href="#/signin">
            Sign in
          </ButtonLink>
        )}
      </nav>
    </div>
  );
}

/** WbF-Mob-3: "Tvashtr works best on a computer" (WEB-24, OQ-10). */
function PhoneSheet({ onClose }: { onClose: () => void }) {
  const ref = useModalDialog<HTMLDivElement>(true, onClose);
  useScrollLock();
  return (
    <>
      <div className="web-m__scrim" onClick={onClose} />
      <div
        ref={ref}
        className="web-m__sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Best on a computer"
      >
        <div className="web-m__sheet-title">Tvashtr works best on a computer</div>
        <div className="web-m__sheet-body">
          The canvas needs a big screen. Send yourself this page and open it on your computer.
        </div>
        <SendLink path="/" fullWidth />
        <ButtonLink variant="ghost" size="md" className="ds-btn--block" href="#/signin">
          Continue on this phone anyway
        </ButtonLink>
      </div>
    </>
  );
}
