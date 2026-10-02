/**
 * Page addresses (spec §3.2). Navigation used to be React state only, so no screen had an address:
 * "Open Reviewer" (a team's canvas with one agent's drawer open on a tab), refresh-keeps-your-place,
 * back/forward and the Desktop `tvashtr://` deep links had nothing to point at. Addresses live in the
 * URL HASH so they work unchanged on fly.dev, the Desktop loopback server and Vite, with no server
 * routing.
 *
 *   #/home
 *   #/domains · #/domains/<id> · #/domains/<id>/ask|quality|teams|settings (?file=<doc>&piece=<n>)
 *   #/engines · #/engines/subscriptions · #/engines/keys
 *   #/engines?fix=1 (Overview with the rows that need a fix highlighted — the canvas's Open Engines)
 *   #/engines/subscriptions?connect=claude|grok (that card highlighted — a `tvashtr://` deep link)
 *   #/engines/keys?embeddings=1 (API keys scrolled to Domains embeddings — Domains' Open Engines)
 *   #/toolkit/connectors · #/toolkit/connectors/browse · #/toolkit/connectors/<id>
 *   (a bare #/toolkit is Connectors, Toolkit's first page)
 *   #/toolkit/tools · #/toolkit/tools/browse · #/toolkit/tools/<id>
 *   #/toolkit/skills · #/toolkit/skills/presets · #/toolkit/skills/new · #/toolkit/skills/<id>
 *   #/toolkit/agents (M6: My agents)
 *   #/toolkit/memory (the page picks Inbox or Active) · #/toolkit/memory/inbox|active|archive
 *   #/toolkit/secrets
 *   #/teams/<teamId>?node=<id>&tab=<tab>&focus=1
 *   #/teams/<teamId>/runs/<runId>[?resume=1] (resume: the run view with "Resume run #n" open, M3)
 *   #/teams/<teamId>/docs/<documentId>?v=<n>&compare=<m>
 *   #/teams/<teamId>/runs/<runId>/docs/<documentId>?v=<n>&compare=<m> (the viewer over a run view)
 *   #/setup/engines|project|team          (Tvashtr Desktop only; the website goes Home)
 *
 * The public website (website.md WEB-1; `isPublicRoute`; Tvashtr Desktop sends them all Home):
 *   #/welcome[?s=product|how|domains|two-ways|faq]
 *   #/download[/started][?os=mac|windows|linux]
 *   #/signin[/done][?error=cancelled|failed|expired&next=<app address>]
 */
import { useCallback, useSyncExternalStore } from "react";

export type EnginesTab = "overview" | "subscriptions" | "keys";
/** A subscription a link asks Subscriptions to point out (it never starts Connect). */
export type ConnectTarget = "claude" | "grok";
export type MemoryTab = "inbox" | "active" | "archive";
export type NodeTab = "setup" | "skills" | "memory" | "runs" | "tests" | "docs";
/** A domain's tabs; `sources` is the bare `#/domains/<id>`. */
export type DomainTab = "sources" | "ask" | "quality" | "teams" | "settings";
/** The dashboard section the canvas's back / "Open Engines · Toolkit" controls return to. */
export type DashView = "home" | "domains" | "engines" | "tools";
/** Tvashtr Desktop's first-run setup steps (desktop-app.md DT-17). */
export type SetupStep = "engines" | "project" | "team";
/** The landing's scroll targets (website.md WEB-7). */
export type SiteSection = "product" | "how" | "domains" | "two-ways" | "faq";
/** The download page's platform, when the address names one (`?os=`, WEB-32). */
export type DownloadOs = "mac" | "windows" | "linux";
export type SignInError = "cancelled" | "failed" | "expired";

export type Route =
  | { page: "home" }
  | {
      page: "domains";
      /** A domain's page; absent = the Domains list. */
      domainId?: string;
      tab?: DomainTab;
      /** `?file=<documentId>` opens that file's preview over the tab (`&piece=<n>` scrolls to it). */
      file?: string;
      piece?: number;
    }
  // `fix`: arrived from a blocked run ("Open Engines") — Overview highlights the rows to fix.
  // `connect`: Subscriptions only — highlight that card (the website's "Open in Desktop").
  // `embeddings`: API keys only — arrived from Domains, show the Domains embeddings section.
  | {
      page: "engines";
      tab: EnginesTab;
      fix?: boolean;
      connect?: ConnectTarget;
      embeddings?: boolean;
    }
  | { page: "connectors"; view: "connected" | "browse" }
  | { page: "connector"; connectorId: string }
  | { page: "tools"; view: "installed" | "browse" }
  | { page: "tool"; toolId: string }
  | { page: "skills"; view: "mine" | "presets" }
  // `skillId` is "new" for the new-skill editor.
  | { page: "skill"; skillId: string }
  // M6: Toolkit › My agents.
  | { page: "agents" }
  // `pick`: the bare `#/toolkit/memory` (the nav's Memory link). The page opens the Inbox when
  // memories wait there, otherwise Active (MEM-4); an address that names a tab keeps it.
  | { page: "memory"; tab: MemoryTab; pick?: true }
  | { page: "secrets" }
  // Desktop only: the first-run setup (DT-17).
  | { page: "setup"; step: SetupStep }
  // The public website (WEB-1). `next`: the app address to return to after sign-in.
  | { page: "welcome"; section?: SiteSection }
  | { page: "download"; started?: boolean; os?: DownloadOs }
  | { page: "signin"; done?: boolean; error?: SignInError; next?: string }
  | {
      page: "team";
      teamId: string;
      runId?: string;
      docId?: string;
      node?: string;
      tab?: NodeTab;
      focus?: boolean;
      version?: number;
      compare?: number;
      /** M3: open the run view with its "Resume run #n" panel (Home's Resume). */
      resume?: boolean;
      /** M7: open the New test dialog on this round (the run view's "Make this a test"). */
      testFrom?: number;
    }
  // M8: "Compare versions" — a team's compare page; `compareId` opens that compare (running or
  // its results); `tab` "versions" is the Versions tab.
  | { page: "compare"; teamId: string; compareId?: string; tab?: "versions" };

const ENGINES_TABS: EnginesTab[] = ["overview", "subscriptions", "keys"];
const CONNECT_TARGETS: ConnectTarget[] = ["claude", "grok"];
const MEMORY_TABS: MemoryTab[] = ["inbox", "active", "archive"];
const NODE_TABS: NodeTab[] = ["setup", "skills", "memory", "runs", "tests", "docs"];
const DOMAIN_TABS: DomainTab[] = ["sources", "ask", "quality", "teams", "settings"];
const SETUP_STEPS: SetupStep[] = ["engines", "project", "team"];
const SITE_SECTIONS: SiteSection[] = ["product", "how", "domains", "two-ways", "faq"];
const DOWNLOAD_OS: DownloadOs[] = ["mac", "windows", "linux"];
const SIGNIN_ERRORS: SignInError[] = ["cancelled", "failed", "expired"];
// The server keeps the same shape (control_plane/web_signin.py): never `//host` or a scheme.
const APP_ADDRESS_RE = /^\/(?!\/)[A-Za-z0-9/_?=&.%-]{0,300}$/;

function pick<T extends string>(values: readonly T[], v: string | null): T | undefined {
  return values.includes(v as T) ? (v as T) : undefined;
}

/** `value` when it is an app (not public) address like `/teams/<id>?node=x`, else undefined. */
export function appAddress(value: string | null | undefined): string | undefined {
  if (!value || !APP_ADDRESS_RE.test(value)) return undefined;
  return isPublicRoute(parseRoute(`#${value}`)) ? undefined : value;
}

export type PublicRoute = Extract<Route, { page: "welcome" | "download" | "signin" }>;

/** A page of the public website (WEB-1): never shown inside Tvashtr Desktop (WEB-3). */
export function isPublicRoute(route: Route): route is PublicRoute {
  return route.page === "welcome" || route.page === "download" || route.page === "signin";
}

function onDesktop(): boolean {
  return (
    typeof document !== "undefined" && document.documentElement.dataset.tvashtrDesktop === "true"
  );
}

export const HOME: Route = { page: "home" };

function num(v: string | null): number | undefined {
  if (v === null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Parse a hash (`#/toolkit/tools/abc`, with or without the leading `#`) into a Route. Anything
 *  unknown lands on Home, so a stale or mistyped link never shows a blank page. */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, "");
  const [pathPart, query = ""] = raw.split("?", 2);
  const parts = pathPart
    .split("/")
    .filter(Boolean)
    .map((p) => decodeURIComponent(p));
  const q = new URLSearchParams(query);
  const [a, b, c] = parts;

  switch (a) {
    case undefined:
    case "home":
      return HOME;
    case "domains": {
      if (!b) return { page: "domains" };
      const route: Extract<Route, { page: "domains" }> = { page: "domains", domainId: b };
      if (c && c !== "sources" && DOMAIN_TABS.includes(c as DomainTab)) route.tab = c as DomainTab;
      const file = q.get("file");
      if (file) route.file = file;
      const piece = num(q.get("piece"));
      if (file && piece !== undefined) route.piece = piece;
      return route;
    }
    case "engines": {
      const tab = ENGINES_TABS.includes(b as EnginesTab) ? (b as EnginesTab) : "overview";
      const connect = q.get("connect");
      if (tab === "subscriptions" && CONNECT_TARGETS.includes(connect as ConnectTarget)) {
        return { page: "engines", tab, connect: connect as ConnectTarget };
      }
      if (tab === "keys" && q.get("embeddings") === "1") {
        return { page: "engines", tab, embeddings: true };
      }
      return tab === "overview" && q.get("fix") === "1"
        ? { page: "engines", tab, fix: true }
        : { page: "engines", tab };
    }
    case "toolkit":
      if (b === "connectors" && c === "browse") return { page: "connectors", view: "browse" };
      if (b === "connectors" && c !== undefined) return { page: "connector", connectorId: c };
      if (b === "tools") {
        if (c === undefined) return { page: "tools", view: "installed" };
        if (c === "browse") return { page: "tools", view: "browse" };
        return { page: "tool", toolId: c };
      }
      if (b === "skills") {
        if (c === undefined) return { page: "skills", view: "mine" };
        if (c === "presets") return { page: "skills", view: "presets" };
        return { page: "skill", skillId: c };
      }
      if (b === "memory") {
        if (c === undefined) return { page: "memory", tab: "inbox", pick: true };
        return {
          page: "memory",
          tab: MEMORY_TABS.includes(c as MemoryTab) ? (c as MemoryTab) : "inbox",
        };
      }
      if (b === "secrets") return { page: "secrets" };
      if (b === "agents") return { page: "agents" };
      // Connectors is Toolkit's first page: the bare address and an unknown child land there.
      return { page: "connectors", view: "connected" };
    case "setup":
      // Setup lives on this Mac; the website has none (DT-17).
      if (!onDesktop()) return HOME;
      return {
        page: "setup",
        step: SETUP_STEPS.includes(b as SetupStep) ? (b as SetupStep) : "engines",
      };
    case "welcome": {
      const section = pick(SITE_SECTIONS, q.get("s"));
      return section ? { page: "welcome", section } : { page: "welcome" };
    }
    case "download": {
      const route: Extract<Route, { page: "download" }> = { page: "download" };
      if (b === "started") route.started = true;
      const os = pick(DOWNLOAD_OS, q.get("os"));
      if (os) route.os = os;
      return route;
    }
    case "signin": {
      const route: Extract<Route, { page: "signin" }> = { page: "signin" };
      if (b === "done") route.done = true;
      const error = pick(SIGNIN_ERRORS, q.get("error"));
      if (error) route.error = error;
      const next = appAddress(q.get("next"));
      if (next) route.next = next;
      return route;
    }
    case "teams": {
      if (!b) return HOME;
      if (c === "compare") {
        const cmp: Extract<Route, { page: "compare" }> = { page: "compare", teamId: b };
        if (parts[3]) cmp.compareId = parts[3];
        if (q.get("tab") === "versions") cmp.tab = "versions";
        return cmp;
      }
      const route: Extract<Route, { page: "team" }> = { page: "team", teamId: b };
      if (c === "runs" && parts[3]) route.runId = parts[3];
      const docs = route.runId ? parts.slice(4) : parts.slice(2);
      if (docs[0] === "docs" && docs[1]) route.docId = docs[1];
      const node = q.get("node");
      if (node) route.node = node;
      const tab = q.get("tab");
      if (tab && NODE_TABS.includes(tab as NodeTab)) route.tab = tab as NodeTab;
      if (q.get("focus") === "1") route.focus = true;
      const v = num(q.get("v"));
      if (v !== undefined) route.version = v;
      const cmp = num(q.get("compare"));
      if (cmp !== undefined) route.compare = cmp;
      if (route.runId && q.get("resume") === "1") route.resume = true;
      const testFrom = num(q.get("test_from"));
      if (!route.runId && route.node && testFrom !== undefined) route.testFrom = testFrom;
      return route;
    }
    default:
      return HOME;
  }
}

/** The hash for a Route (always starts with `#/`). */
export function routeToHash(route: Route): string {
  const enc = encodeURIComponent;
  switch (route.page) {
    case "home":
      return "#/home";
    case "domains": {
      if (!route.domainId) return "#/domains";
      let path = `#/domains/${enc(route.domainId)}`;
      if (route.tab && route.tab !== "sources") path += `/${route.tab}`;
      const q = new URLSearchParams();
      if (route.file) q.set("file", route.file);
      if (route.file && route.piece !== undefined) q.set("piece", String(route.piece));
      const qs = q.toString();
      return qs ? `${path}?${qs}` : path;
    }
    case "engines":
      if (route.tab === "subscriptions" && route.connect) {
        return `#/engines/subscriptions?connect=${route.connect}`;
      }
      if (route.tab === "keys" && route.embeddings) return "#/engines/keys?embeddings=1";
      if (route.tab !== "overview") return `#/engines/${route.tab}`;
      return route.fix ? "#/engines?fix=1" : "#/engines";
    case "connectors":
      return route.view === "browse" ? "#/toolkit/connectors/browse" : "#/toolkit/connectors";
    case "connector":
      return `#/toolkit/connectors/${enc(route.connectorId)}`;
    case "tools":
      return route.view === "browse" ? "#/toolkit/tools/browse" : "#/toolkit/tools";
    case "tool":
      return `#/toolkit/tools/${enc(route.toolId)}`;
    case "skills":
      return route.view === "presets" ? "#/toolkit/skills/presets" : "#/toolkit/skills";
    case "skill":
      return `#/toolkit/skills/${enc(route.skillId)}`;
    case "memory":
      return route.pick ? "#/toolkit/memory" : `#/toolkit/memory/${route.tab}`;
    case "secrets":
      return "#/toolkit/secrets";
    case "agents":
      return "#/toolkit/agents";
    case "setup":
      return `#/setup/${route.step}`;
    case "welcome":
      return route.section ? `#/welcome?s=${route.section}` : "#/welcome";
    case "download":
      return `#/download${route.started ? "/started" : ""}${route.os ? `?os=${route.os}` : ""}`;
    case "signin": {
      const q = new URLSearchParams();
      if (route.error) q.set("error", route.error);
      if (route.next) q.set("next", route.next);
      const qs = q.toString();
      return `#/signin${route.done ? "/done" : ""}${qs ? `?${qs}` : ""}`;
    }
    case "team": {
      let path = `#/teams/${enc(route.teamId)}`;
      if (route.runId) path += `/runs/${enc(route.runId)}`;
      if (route.docId) path += `/docs/${enc(route.docId)}`;
      const q = new URLSearchParams();
      if (route.node) q.set("node", route.node);
      if (route.tab) q.set("tab", route.tab);
      if (route.focus) q.set("focus", "1");
      if (route.version !== undefined) q.set("v", String(route.version));
      if (route.compare !== undefined) q.set("compare", String(route.compare));
      if (route.runId && route.resume) q.set("resume", "1");
      if (!route.runId && route.node && route.testFrom !== undefined)
        q.set("test_from", String(route.testFrom));
      const qs = q.toString();
      return qs ? `${path}?${qs}` : path;
    }
    case "compare": {
      const path = `#/teams/${enc(route.teamId)}/compare${route.compareId ? `/${enc(route.compareId)}` : ""}`;
      return route.tab === "versions" ? `${path}?tab=versions` : path;
    }
  }
}

/** Which top-level nav section a Route belongs to (for the left nav's active state). */
export function sectionOf(route: Route): "home" | "domains" | "engines" | "toolkit" | "team" {
  switch (route.page) {
    case "home":
    case "domains":
    case "engines":
    case "team":
      return route.page;
    case "compare":
      return "team";
    case "setup":
    case "welcome":
    case "download":
    case "signin":
      return "home";
    default:
      return "toolkit";
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function getHash(): string {
  return window.location.hash;
}

/** Go to a Route. `replace` rewrites the current history entry (for redirects and in-page state
 *  like a tab switch that shouldn't pile up Back steps). */
export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const hash = routeToHash(route);
  if (window.location.hash === hash) return;
  if (opts.replace) {
    const url = new URL(window.location.href);
    url.hash = hash;
    window.history.replaceState(window.history.state, "", url);
    // replaceState doesn't fire hashchange; tell subscribers ourselves.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = hash;
  }
}

/** The current Route, re-rendering on every address change, plus `navigate`. */
export function useNav(): {
  route: Route;
  navigate: (route: Route, opts?: { replace?: boolean }) => void;
} {
  const hash = useSyncExternalStore(subscribe, getHash, () => "");
  const nav = useCallback(
    (route: Route, opts?: { replace?: boolean }) => navigate(route, opts),
    [],
  );
  return { route: parseRoute(hash), navigate: nav };
}

/** Fired when a page keeps the user where they are (a leave guard's "Keep editing"): anything
 * queued to run on the page they were heading to must be dropped, not run on a later visit. */
export const NAVIGATION_KEPT = "tvashtr:navigation-kept";
