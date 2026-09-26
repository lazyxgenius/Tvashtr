/**
 * Page addresses (spec §3.2). Navigation used to be React state only, so no screen had an address:
 * "Open Reviewer" (a team's canvas with one agent's drawer open on a tab), refresh-keeps-your-place,
 * back/forward and the Desktop `tvashtr://` deep links had nothing to point at. Addresses live in the
 * URL HASH so they work unchanged on fly.dev, the Desktop loopback server and Vite, with no server
 * routing.
 *
 *   #/home
 *   #/domains
 *   #/engines · #/engines/subscriptions · #/engines/keys
 *   #/engines?fix=1 (Overview with the rows that need a fix highlighted — the canvas's Open Engines)
 *   #/engines/subscriptions?connect=claude|grok (that card highlighted — a `tvashtr://` deep link)
 *   #/toolkit/tools · #/toolkit/tools/browse · #/toolkit/tools/<id>
 *   #/toolkit/skills · #/toolkit/skills/presets · #/toolkit/skills/new · #/toolkit/skills/<id>
 *   #/toolkit/memory/inbox|active|archive
 *   #/toolkit/secrets
 *   #/teams/<teamId>?node=<id>&tab=<tab>&focus=1
 *   #/teams/<teamId>/runs/<runId>
 *   #/teams/<teamId>/docs/<documentId>?v=<n>&compare=<m>
 */
import { useCallback, useSyncExternalStore } from "react";

export type EnginesTab = "overview" | "subscriptions" | "keys";
/** A subscription a link asks Subscriptions to point out (it never starts Connect). */
export type ConnectTarget = "claude" | "grok";
export type MemoryTab = "inbox" | "active" | "archive";
export type NodeTab = "setup" | "skills" | "memory" | "runs" | "docs";
/** The dashboard section the canvas's back / "Open Engines · Toolkit" controls return to. */
export type DashView = "home" | "domains" | "engines" | "tools";

export type Route =
  | { page: "home" }
  | { page: "domains" }
  // `fix`: arrived from a blocked run ("Open Engines") — Overview highlights the rows to fix.
  // `connect`: Subscriptions only — highlight that card (the website's "Open in Desktop").
  | { page: "engines"; tab: EnginesTab; fix?: boolean; connect?: ConnectTarget }
  | { page: "tools"; view: "installed" | "browse" }
  | { page: "tool"; toolId: string }
  | { page: "skills"; view: "mine" | "presets" }
  // `skillId` is "new" for the new-skill editor.
  | { page: "skill"; skillId: string }
  | { page: "memory"; tab: MemoryTab }
  | { page: "secrets" }
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
    };

const ENGINES_TABS: EnginesTab[] = ["overview", "subscriptions", "keys"];
const CONNECT_TARGETS: ConnectTarget[] = ["claude", "grok"];
const MEMORY_TABS: MemoryTab[] = ["inbox", "active", "archive"];
const NODE_TABS: NodeTab[] = ["setup", "skills", "memory", "runs", "docs"];

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
    case "domains":
      return { page: "domains" };
    case "engines": {
      const tab = ENGINES_TABS.includes(b as EnginesTab) ? (b as EnginesTab) : "overview";
      const connect = q.get("connect");
      if (tab === "subscriptions" && CONNECT_TARGETS.includes(connect as ConnectTarget)) {
        return { page: "engines", tab, connect: connect as ConnectTarget };
      }
      return tab === "overview" && q.get("fix") === "1"
        ? { page: "engines", tab, fix: true }
        : { page: "engines", tab };
    }
    case "toolkit":
      if (b === undefined || b === "tools") {
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
        return {
          page: "memory",
          tab: MEMORY_TABS.includes(c as MemoryTab) ? (c as MemoryTab) : "inbox",
        };
      }
      if (b === "secrets") return { page: "secrets" };
      return { page: "tools", view: "installed" };
    case "teams": {
      if (!b) return HOME;
      const route: Extract<Route, { page: "team" }> = { page: "team", teamId: b };
      if (c === "runs" && parts[3]) route.runId = parts[3];
      if (c === "docs" && parts[3]) route.docId = parts[3];
      const node = q.get("node");
      if (node) route.node = node;
      const tab = q.get("tab");
      if (tab && NODE_TABS.includes(tab as NodeTab)) route.tab = tab as NodeTab;
      if (q.get("focus") === "1") route.focus = true;
      const v = num(q.get("v"));
      if (v !== undefined) route.version = v;
      const cmp = num(q.get("compare"));
      if (cmp !== undefined) route.compare = cmp;
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
    case "domains":
      return "#/domains";
    case "engines":
      if (route.tab === "subscriptions" && route.connect) {
        return `#/engines/subscriptions?connect=${route.connect}`;
      }
      if (route.tab !== "overview") return `#/engines/${route.tab}`;
      return route.fix ? "#/engines?fix=1" : "#/engines";
    case "tools":
      return route.view === "browse" ? "#/toolkit/tools/browse" : "#/toolkit/tools";
    case "tool":
      return `#/toolkit/tools/${enc(route.toolId)}`;
    case "skills":
      return route.view === "presets" ? "#/toolkit/skills/presets" : "#/toolkit/skills";
    case "skill":
      return `#/toolkit/skills/${enc(route.skillId)}`;
    case "memory":
      return `#/toolkit/memory/${route.tab}`;
    case "secrets":
      return "#/toolkit/secrets";
    case "team": {
      let path = `#/teams/${enc(route.teamId)}`;
      if (route.runId) path += `/runs/${enc(route.runId)}`;
      else if (route.docId) path += `/docs/${enc(route.docId)}`;
      const q = new URLSearchParams();
      if (route.node) q.set("node", route.node);
      if (route.tab) q.set("tab", route.tab);
      if (route.focus) q.set("focus", "1");
      if (route.version !== undefined) q.set("v", String(route.version));
      if (route.compare !== undefined) q.set("compare", String(route.compare));
      const qs = q.toString();
      return qs ? `${path}?${qs}` : path;
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
