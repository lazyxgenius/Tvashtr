/**
 * The dashboard shell every non-canvas page sits in (Home, Domains, Engines, Toolkit): the 60px
 * header (logo, ⌘K search, backend status, account menu), the 224px left nav with count and
 * warning badges, and the page area. Geometry is the design's (Home-Main, Eng-Overview,
 * Toolkit-Tools artboards).
 *
 * Navigation is by address (lib/nav.ts): a nav item navigates; the active item is derived from the
 * current Route. Engines and Toolkit expand into their sub-pages while you are inside them.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Download,
  Home as HomeIcon,
  KeyRound,
  Keyboard,
  ListChecks,
  LogOut,
  Search,
  Wrench,
} from "lucide-react";

import { Avatar, Button, Logo } from "../../design-system/components";
import { cx, useDismiss } from "../../design-system/components/utils";
import { checkBackend, useBackendStatus } from "../../lib/backendStatus";
import { useUpdateState } from "../../lib/desktopApp";
import { DESKTOP_MAC_DMG_URL } from "../../lib/desktopDownload";
import { navigate, type Route, sectionOf } from "../../lib/nav";
import type { NavBadges, NavDomain } from "../../lib/workspaceStatus";
import { formatRelativeTimeWords } from "../../lib/time";
import { stateBadge } from "../domains/domainFormat";
import { useReadyCardShown } from "../desktop/readyCard";
import { UpdateCard } from "../desktop/UpdateCard";
import { loadGetStarted, setGetStartedHidden, useGetStarted } from "../home/getStarted";
import "./shell.css";

export type { NavBadges };

export interface ShellUser {
  email: string;
  display_name?: string | null;
}

function displayName(user: ShellUser): string {
  if (user.display_name) return user.display_name;
  const local = user.email.split("@")[0] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "You";
}

function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "warn";
  children: ReactNode;
}) {
  return (
    <span className="sh-nav__end">
      <span className={cx("sh-badge", tone !== "neutral" && `sh-badge--${tone}`)}>{children}</span>
    </span>
  );
}

interface NavLeaf {
  key: string;
  label: string;
  route: Route;
  active: boolean;
  badge?: ReactNode;
}

/** The status dot beside a domain's nav row (DM-1): sage ready, coral reading or re-reading,
 *  amber needs attention or waiting for a key, stone empty. */
function domainDotTone(state: NavDomain["state"]): string {
  switch (state) {
    case "ready":
      return "ready";
    case "reading":
    case "rereading":
      return "reading";
    case "needs_attention":
    case "waiting_for_key":
      return "attention";
    default:
      return "empty";
  }
}

function Nav({
  route,
  badges,
  domains,
  onNavigate,
}: {
  route: Route;
  badges: NavBadges;
  domains: NavDomain[];
  onNavigate: (r: Route) => void;
}) {
  const section = sectionOf(route);
  const inEngines = section === "engines";
  const inToolkit = section === "toolkit";
  const inDomains = section === "domains";
  const openDomainId = route.page === "domains" ? route.domainId : undefined;

  const warn = (n: number | undefined, word: string) =>
    n ? <Badge tone="warn">{`${n} ${word}`}</Badge> : null;

  const engineChildren: NavLeaf[] = [
    {
      key: "overview",
      label: "Overview",
      route: { page: "engines", tab: "overview" },
      active: route.page === "engines" && route.tab === "overview",
      badge: badges.enginesFirstTime ? (
        <Badge tone="accent">New</Badge>
      ) : (
        warn(badges.enginesToFix, "to fix")
      ),
    },
    {
      key: "subscriptions",
      label: "Subscriptions",
      route: { page: "engines", tab: "subscriptions" },
      active: route.page === "engines" && route.tab === "subscriptions",
      badge: badges.subscriptions ? (
        <Badge>{`${badges.subscriptions.connected} of ${badges.subscriptions.total}`}</Badge>
      ) : null,
    },
    {
      key: "keys",
      label: "API keys",
      route: { page: "engines", tab: "keys" },
      active: route.page === "engines" && route.tab === "keys",
      badge: badges.apiKeys ? <Badge>{badges.apiKeys}</Badge> : null,
    },
  ];

  const toolkitChildren: NavLeaf[] = [
    {
      key: "connectors",
      label: "Connectors",
      route: { page: "connectors", view: "connected" },
      active: route.page === "connectors" || route.page === "connector",
      // An expired sign-in replaces the count, like Engines › Overview's "N to fix".
      badge:
        warn(badges.connectorsToFix, "to fix") ??
        (badges.connectors ? <Badge>{badges.connectors}</Badge> : null),
    },
    {
      key: "tools",
      label: "Tools",
      route: { page: "tools", view: "installed" },
      active: route.page === "tools" || route.page === "tool",
      badge: badges.tools ? <Badge>{badges.tools}</Badge> : null,
    },
    {
      key: "skills",
      label: "Skills",
      route: { page: "skills", view: "mine" },
      active: route.page === "skills" || route.page === "skill",
      badge: badges.skills ? <Badge>{badges.skills}</Badge> : null,
    },
    // M6 (Agents-Page): the saved agents, after Skills.
    {
      key: "agents",
      label: "My agents",
      route: { page: "agents" },
      active: route.page === "agents",
      badge: badges.myAgents ? <Badge>{badges.myAgents}</Badge> : null,
    },
    {
      key: "memory",
      label: "Memory",
      route: { page: "memory", tab: "inbox", pick: true },
      active: route.page === "memory",
      badge: badges.memoryInbox ? <Badge tone="accent">{`${badges.memoryInbox} new`}</Badge> : null,
    },
    {
      key: "secrets",
      label: "Secrets",
      route: { page: "secrets" },
      active: route.page === "secrets",
      badge: warn(badges.secretsMissing, "missing"),
    },
  ];

  const top = (
    key: string,
    label: string,
    icon: ReactNode,
    target: Route,
    opts: { active?: boolean; open?: boolean; badge?: ReactNode },
  ) => (
    <li key={key}>
      <button
        type="button"
        className={cx("sh-nav__item", opts.open && "sh-nav__item--open")}
        aria-current={opts.active ? "page" : undefined}
        aria-expanded={opts.open === undefined ? undefined : opts.open}
        onClick={() => onNavigate(target)}
      >
        {icon}
        {label}
        {opts.open ? (
          <span className="sh-nav__chevron" aria-hidden="true">
            <ChevronDown size={14} strokeWidth={1.6} />
          </span>
        ) : (
          opts.badge
        )}
      </button>
    </li>
  );

  const leaf = (l: NavLeaf) => (
    <li key={l.key}>
      <button
        type="button"
        className="sh-nav__item sh-nav__item--child"
        aria-current={l.active ? "page" : undefined}
        onClick={() => onNavigate(l.route)}
      >
        {l.label}
        {l.badge}
      </button>
    </li>
  );

  const iconProps = { size: 16, strokeWidth: 1.8, "aria-hidden": true } as const;

  return (
    <nav className="sh-nav" aria-label="Dashboard">
      <ul className="sh-nav__list">
        {top(
          "home",
          "Home",
          <HomeIcon {...iconProps} />,
          { page: "home" },
          {
            active: route.page === "home",
            badge: badges.home ? <Badge tone="accent">{badges.home}</Badge> : null,
          },
        )}
        {top(
          "domains",
          "Domains",
          <BookOpen {...iconProps} />,
          { page: "domains" },
          {
            active: route.page === "domains" && !openDomainId,
            open: inDomains,
          },
        )}
        {inDomains &&
          domains.map((d) => (
            <li key={`domain-${d.id}`}>
              <button
                type="button"
                className="sh-nav__item sh-nav__item--child sh-nav__item--domain"
                aria-current={openDomainId === d.id ? "page" : undefined}
                aria-describedby={`sh-domain-state-${d.id}`}
                onClick={() => onNavigate({ page: "domains", domainId: d.id })}
              >
                <span className="sh-nav__label">{d.name}</span>
                <span className="sh-nav__end">
                  <span
                    className={`sh-nav__dot sh-nav__dot--${domainDotTone(d.state)}`}
                    aria-hidden="true"
                  />
                </span>
              </button>
              {/* DM-109: the dot's state in words, for screen readers (the name stays the domain's). */}
              <span id={`sh-domain-state-${d.id}`} hidden>
                {stateBadge(d.state).label}
              </span>
            </li>
          ))}
        {top(
          "engines",
          "Engines",
          <KeyRound {...iconProps} />,
          { page: "engines", tab: "overview" },
          {
            open: inEngines,
            badge: warn(badges.enginesToFix, "to fix"),
          },
        )}
        {inEngines && engineChildren.map(leaf)}
        {top(
          "toolkit",
          "Toolkit",
          <Wrench {...iconProps} />,
          { page: "connectors", view: "connected" },
          {
            open: inToolkit,
            badge: warn(badges.connectorsToFix, "to fix") ?? warn(badges.secretsMissing, "missing"),
          },
        )}
        {inToolkit && toolkitChildren.map(leaf)}
      </ul>
      <NavFoot section={section} />
    </nav>
  );
}

function NavFoot({ section }: { section: ReturnType<typeof sectionOf> }) {
  // Desktop: a waiting update replaces the section's foot on every page (DT-43).
  const update = useUpdateState();
  const readyCard = useReadyCardShown();
  if (update.state === "ready" || update.state === "manual") {
    return (
      <div className="sh-nav__foot">
        <UpdateCard update={update} />
      </div>
    );
  }
  // The Domains section (DM-2) and Desktop Home before the first job (the ready card, DT-Ready)
  // both introduce Domains.
  if (section === "domains" || (section === "home" && readyCard)) {
    return (
      <div className="sh-nav__foot">
        <span>
          <b>Domains</b> are libraries of your own files. You and your agents ask them questions and
          get answers with sources.
        </span>
      </div>
    );
  }
  if (section === "engines") {
    return (
      <div className="sh-nav__foot">
        <span>
          <b>Engines</b> are the models your agents run on: your own subscription on Desktop, or an
          API key anywhere.
        </span>
      </div>
    );
  }
  if (section === "toolkit") {
    return (
      <div className="sh-nav__foot">
        <span>
          Toolkit holds what any team’s agents can use. Switch things on per agent in its{" "}
          <b>Skills &amp; tools</b> tab.
        </span>
      </div>
    );
  }
  return (
    <div className="sh-nav__foot">
      <b className="sh-nav__foot-title">Shortcuts</b>
      <span>
        <kbd>⌘K</kbd> search and actions
      </span>
      <span>
        <kbd>N</kbd> new run · <kbd>T</kbd> new team
      </span>
    </div>
  );
}

/** The avatar and its account menu (the dashboard header and the team canvas header share it). */
export function AccountMenu({
  user,
  onShowShortcuts,
  onLogout,
}: {
  user: ShellUser;
  onShowShortcuts: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useDismiss(open, () => setOpen(false), wrap);
  const name = displayName(user);
  // TEAMS-56: while the get-started checklist is hidden, the menu offers to bring it back.
  const { hidden: checklistHidden } = useGetStarted();
  useEffect(() => {
    if (open) void loadGetStarted();
  }, [open]);
  const onDesktop = typeof window !== "undefined" && Boolean(window.tvashtrDesktop);
  return (
    <span className="ds-anchor" ref={wrap}>
      <button
        type="button"
        className="sh-avatar-btn"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={name} size="sm" accent />
      </button>
      {open && (
        <div className="sh-account" role="menu" aria-label="Account">
          <div className="sh-account__id">
            <span className="sh-account__initial" aria-hidden="true">
              {name.charAt(0).toUpperCase()}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="sh-account__name">{name}</div>
              <div className="sh-account__email">{user.email}</div>
            </div>
          </div>
          <div className="sh-account__sep" role="separator" />
          {!onDesktop && (
            <a
              className="sh-account__item"
              role="menuitem"
              href={DESKTOP_MAC_DMG_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
            >
              <Download size={15} strokeWidth={1.7} aria-hidden />
              <span>Download Tvashtr Desktop</span>
            </a>
          )}
          <button
            type="button"
            className="sh-account__item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onShowShortcuts();
            }}
          >
            <Keyboard size={15} strokeWidth={1.7} aria-hidden />
            <span>Keyboard shortcuts</span>
            <span className="sh-account__hint">?</span>
          </button>
          {checklistHidden === true && (
            <button
              type="button"
              className="sh-account__item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void setGetStartedHidden(false)
                  .then(() => navigate({ page: "home" }))
                  .catch(() => undefined);
              }}
            >
              <ListChecks size={15} strokeWidth={1.7} aria-hidden />
              <span>Show get-started checklist</span>
            </button>
          )}
          <div className="sh-account__sep" role="separator" />
          <button
            type="button"
            className="sh-account__item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <LogOut size={15} strokeWidth={1.7} aria-hidden />
            <span>Log out</span>
          </button>
        </div>
      )}
    </span>
  );
}

function Connection() {
  const { state } = useBackendStatus();
  return (
    <span className={cx("sh-conn", `sh-conn--${state}`)} role="status">
      <span className="sh-conn__dot" aria-hidden="true" />
      {state === "offline"
        ? "Can’t reach backend"
        : state === "checking"
          ? "Checking…"
          : "Connected"}
    </span>
  );
}

function OfflineBanner() {
  const { state, lastOkAt } = useBackendStatus();
  const [retrying, setRetrying] = useState(false);
  if (state !== "offline") return null;
  const when = lastOkAt ? formatRelativeTimeWords(new Date(lastOkAt).toISOString()) : "";
  return (
    <div className="sh-offline" role="alert">
      <span>
        Couldn’t reach the backend — some sections may be stale.
        {when ? ` Last updated ${when}.` : ""}
      </span>
      <Button
        variant="secondary"
        size="sm"
        loading={retrying}
        onClick={() => {
          setRetrying(true);
          void checkBackend().finally(() => setRetrying(false));
        }}
      >
        Try again
      </Button>
    </div>
  );
}

export function Shell({
  route,
  user,
  badges,
  onNavigate,
  onOpenSearch,
  onShowShortcuts,
  onLogout,
  children,
}: {
  route: Route;
  user: ShellUser;
  badges: NavBadges;
  onNavigate: (r: Route) => void;
  onOpenSearch: () => void;
  onShowShortcuts: () => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  // First-time Home hides the nav badges (TEAMS-2, TEAMS-70).
  const { firstTime } = useGetStarted();
  return (
    <div className="sh">
      <header className="sh-head">
        <Logo size={26} />
        <div className="sh-head__search-wrap">
          <button
            type="button"
            className="sh-search"
            aria-label="Search teams, runs and actions"
            onClick={onOpenSearch}
          >
            <Search size={15} strokeWidth={1.6} aria-hidden />
            Search teams, runs and actions
            <kbd>⌘K</kbd>
          </button>
        </div>
        <div className="sh-head__right">
          <Connection />
          <AccountMenu user={user} onShowShortcuts={onShowShortcuts} onLogout={onLogout} />
        </div>
      </header>
      <div className="sh-body">
        <Nav
          route={route}
          badges={firstTime ? {} : badges}
          domains={badges.domains ?? []}
          onNavigate={onNavigate}
        />
        <main
          className={cx(
            "sh-main",
            route.page === "home" && "sh-main--home",
            route.page === "domains" && "sh-main--domains",
          )}
        >
          <div className="sh-main__inner">
            <OfflineBanner />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
