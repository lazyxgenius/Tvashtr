/**
 * Engines, as pure data (no React, no fetch): the Overview's provider rows and their Tvashtr
 * Desktop / Website cells (ENG-10..14), the "Can your teams run?" verdicts (ENG-20/21), the nav
 * badge counts (ENG-2..4), the "Also saved" line (ENG-19) and the first-time test (ENG-75).
 *
 * Verdicts use THE launch rule, `missingProvidersForModels` (parity-tested against the backend
 * gate), untouched. Two things are layered on top of it here, never inside it:
 * - a provider whose catalogue entry serves no seat (NVIDIA NIM today) runs nothing, so its key
 *   never counts toward a team being able to run, and it is never offered as "add a key";
 * - fallback models are not "the model" of a node, so they never enter verdicts (OQ-13).
 */
import type {
  CatalogueEntry,
  EngineUsage,
  ProviderDirectoryEntry,
  RunnerStatus,
  SavedKey,
  UsageTeam,
} from "../../lib/api/engines";
import {
  RUNNER_SUBSCRIPTIONS,
  type SubscriptionProviderId,
  type SubscriptionStatus,
  byokProviderOf,
  displayNameForSubscription,
  missingProvidersForModels,
  subscriptionProviderForModel,
} from "../../lib/engines";
import type { NavBadges } from "../../lib/workspaceStatus";

export type Surface = "desktop" | "website";

export interface EngineInputs {
  directory: readonly ProviderDirectoryEntry[];
  catalogue: readonly CatalogueEntry[];
  keys: readonly SavedKey[];
  /** Claude, Grok, Codex — live from the bridge on Desktop, the server mirror on the website. */
  subs: readonly SubscriptionStatus[];
  runner: RunnerStatus;
  usage: EngineUsage;
  surface: Surface;
}

// ---- providers ----

/** Providers whose catalogue entry serves no seat at all: no default and no preset in either seat
 *  (NVIDIA NIM since 2026-09-26). Derived from the catalogue, never a hard-coded slug. A provider
 *  that is not in the model catalogue (huggingface: embeddings only) is not one of them. */
export function providersServingNoSeat(catalogue: readonly CatalogueEntry[]): Set<string> {
  return new Set(
    catalogue
      .filter(
        (e) =>
          !e.thinker_default &&
          !e.worker_default &&
          e.thinker_presets.length === 0 &&
          e.worker_presets.length === 0,
      )
      .map((e) => e.provider),
  );
}

export function providerName(i: Pick<EngineInputs, "directory" | "catalogue">, p: string): string {
  return (
    i.directory.find((d) => d.provider === p)?.name ??
    i.catalogue.find((c) => c.provider === p)?.label ??
    p
  );
}

export function monogramOf(directory: readonly ProviderDirectoryEntry[], p: string): string {
  const m = directory.find((d) => d.provider === p)?.monogram;
  return (m || p || "?").charAt(0).toUpperCase();
}

/** "No agent uses NVIDIA NIM right now." — the plain note wherever a no-seat provider shows up
 *  (area rule: never invite or celebrate a key that powers nothing). */
export function noSeatNote(name: string): string {
  return `No agent uses ${name} right now.`;
}

/** The subscription Tvashtr Desktop can run a provider's models with (Claude, Grok), or null.
 *  Codex never covers a node (it can't run agents yet). */
export function runnableSubFor(provider: string): SubscriptionProviderId | null {
  const sub = subscriptionProviderForModel(`${provider}/`);
  return sub && RUNNER_SUBSCRIPTIONS.includes(sub) ? sub : null;
}

function subStatus(i: EngineInputs, sub: SubscriptionProviderId): SubscriptionStatus | undefined {
  return i.subs.find((s) => s.provider === sub);
}

function keyFor(i: EngineInputs, provider: string): SavedKey | undefined {
  return i.keys.find((k) => k.provider === provider);
}

/** Connected runnable subscriptions (Claude, Grok) — the "X of 2" count (ENG-3). */
export function connectedSubCount(i: Pick<EngineInputs, "subs">): number {
  return RUNNER_SUBSCRIPTIONS.filter((s) => i.subs.find((r) => r.provider === s)?.connected).length;
}

// ---- Used by ----

const ROLE_LABELS: Record<string, string> = {
  pm: "Product manager",
  architect: "Architect",
  engineer: "Engineer",
  reviewer: "Reviewer",
};

/** An agent's display name: its title, else a readable role ("pm" → "Product manager"). */
export function roleLabel(roleName: string, title: string | null): string {
  if (title && title.trim()) return title.trim();
  const known = ROLE_LABELS[roleName];
  if (known) return known;
  const words = roleName.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Agent";
}

function nodeProvider(n: { model: string | null; provider: string | null }): string | null {
  if (!n.model || !n.model.trim()) return null;
  return n.provider ?? (byokProviderOf(n.model) || null);
}

/** "Product manager, Reviewer · Indicator sprint team" for each team whose agents use `provider`
 *  as their primary model, in team order. */
export function usedBySegments(usage: EngineUsage, provider: string): string[] {
  const out: string[] = [];
  for (const team of usage.teams) {
    const roles: string[] = [];
    for (const n of team.nodes) {
      if (nodeProvider(n) !== provider) continue;
      const label = roleLabel(n.role_name, n.title);
      if (!roles.includes(label)) roles.push(label);
    }
    if (roles.length) out.push(`${roles.join(", ")} · ${team.name}`);
  }
  return out;
}

/** The Used by cell: up to two teams ("Roles · Team; Roles · Team"), then "+N more" (OQ-12). */
export function usedByCell(segments: readonly string[]): string {
  if (segments.length <= 2) return segments.join("; ");
  return `${segments.slice(0, 2).join("; ")} +${segments.length - 2} more`;
}

// ---- Overview cells (ENG-13/14) ----

export type CellActionKind = "add-key" | "connect" | "set-up" | "refresh" | "open-desktop";

export interface CellAction {
  kind: CellActionKind;
  label: string;
  provider: string;
  sub?: SubscriptionProviderId;
}

export interface Cell {
  tone: "ok" | "warn" | "neutral";
  text: string;
  /** Muted text after the main text — "(on Desktop)" on the website. */
  suffix?: string;
  action?: CellAction;
}

/** A no-seat provider's cell: plain, with no Add key (it would power nothing). */
function noSeatCell(): Cell {
  return { tone: "warn", text: "Not supported right now" };
}

function keyCell(key: SavedKey): Cell {
  return { tone: "ok", text: `API key •••• ${key.key_last4}` };
}

function addKeyAction(provider: string): CellAction {
  return { kind: "add-key", label: "Add key", provider };
}

/** The Tvashtr Desktop cell: subscription connected → key → subscription state + fix → No API key. */
export function desktopCell(i: EngineInputs, provider: string, noSeat: Set<string>): Cell {
  if (noSeat.has(provider)) return noSeatCell();
  const web = i.surface === "website";
  const sub = runnableSubFor(provider);
  const status = sub ? subStatus(i, sub) : undefined;
  if (sub && status?.connected) {
    return {
      tone: "ok",
      text: `${displayNameForSubscription(sub)} subscription`,
      suffix: web ? "(on Desktop)" : undefined,
    };
  }
  const key = keyFor(i, provider);
  if (key) return keyCell(key);
  if (sub) {
    const name = displayNameForSubscription(sub);
    const state = status?.state ?? "disconnected";
    if (state === "checking") return { tone: "neutral", text: "Checking…" };
    // The website can't connect or re-check a subscription: it opens Tvashtr Desktop (OQ-2).
    const onDesktop = (kind: CellActionKind, label: string): CellAction =>
      web
        ? { kind: "open-desktop", label: "Open in Desktop", provider, sub }
        : { kind, label, provider, sub };
    switch (state) {
      case "needs_login":
        return {
          tone: "warn",
          text: `${name} needs login`,
          action: onDesktop("connect", "Connect"),
        };
      case "api_key":
        return {
          tone: "warn",
          text: `${name} on an API key`,
          action: onDesktop("connect", "Connect"),
        };
      case "needs_install":
        return {
          tone: "warn",
          text: `${name} not installed`,
          action: { kind: "set-up", label: "Set up", provider, sub },
        };
      case "error":
        return {
          tone: "warn",
          text: `Couldn’t check ${name}`,
          action: onDesktop("refresh", "Refresh"),
        };
      default:
        return {
          tone: "warn",
          text: `${name} not connected`,
          action: onDesktop("connect", "Connect"),
        };
    }
  }
  return { tone: "warn", text: "No API key", action: addKeyAction(provider) };
}

/** The Website (hosted) cell: only an API key runs there. */
export function websiteCell(i: EngineInputs, provider: string, noSeat: Set<string>): Cell {
  if (noSeat.has(provider)) return noSeatCell();
  const key = keyFor(i, provider);
  if (key) return keyCell(key);
  return { tone: "warn", text: "No API key", action: addKeyAction(provider) };
}

export interface ProviderRow {
  provider: string;
  monogram: string;
  /** The Used by cell ("+N more" past two teams). */
  usedBy: string;
  /** Every team, for the cell's tooltip. */
  usedByFull: string;
  desktop: Cell;
  website: Cell;
  needsFix: boolean;
}

/** Every provider the user's library teams use as a primary model (ENG-10): rows needing a fix
 *  first, then alphabetical. */
export function providerRows(i: EngineInputs): ProviderRow[] {
  const noSeat = providersServingNoSeat(i.catalogue);
  const providers = new Set<string>();
  for (const team of i.usage.teams) {
    for (const n of team.nodes) {
      const p = nodeProvider(n);
      if (p) providers.add(p);
    }
  }
  const rows = [...providers].map((provider): ProviderRow => {
    const segments = usedBySegments(i.usage, provider);
    const desktop = desktopCell(i, provider, noSeat);
    const website = websiteCell(i, provider, noSeat);
    return {
      provider,
      monogram: monogramOf(i.directory, provider),
      usedBy: usedByCell(segments),
      usedByFull: segments.join("; "),
      desktop,
      website,
      needsFix: desktop.tone === "warn" || website.tone === "warn",
    };
  });
  return rows.sort(
    (a, b) => Number(b.needsFix) - Number(a.needsFix) || a.provider.localeCompare(b.provider),
  );
}

// ---- Also saved (ENG-19) ----

export interface AlsoSaved {
  providers: string[];
  /** Notes for saved providers that serve no seat ("No agent uses NVIDIA NIM right now."). */
  notes: string[];
}

/** Saved keys no team node uses (as its model or its fallback), alphabetical. */
export function alsoSaved(i: EngineInputs): AlsoSaved {
  const used = new Set<string>();
  for (const team of i.usage.teams) {
    for (const n of team.nodes) {
      const p = nodeProvider(n);
      if (p) used.add(p);
      if (n.fallback_model) used.add(n.fallback_provider ?? byokProviderOf(n.fallback_model));
    }
  }
  const noSeat = providersServingNoSeat(i.catalogue);
  const providers = i.keys
    .map((k) => k.provider)
    .filter((p) => !used.has(p))
    .sort((a, b) => a.localeCompare(b));
  return {
    providers,
    notes: providers.filter((p) => noSeat.has(p)).map((p) => noSeatNote(providerName(i, p))),
  };
}

// ---- Can your teams run? (ENG-20/21) ----

export interface Verdict {
  ready: boolean;
  /** "Desktop: connect Grok" / "Website: add anthropic, xai keys" / "Desktop: ready". */
  text: string;
}

export interface TeamVerdict {
  teamId: string;
  name: string;
  desktop: Verdict;
  website: Verdict;
}

function addKeys(providers: readonly string[]): string {
  return providers.length === 1 ? `add ${providers[0]} key` : `add ${providers.join(", ")} keys`;
}

/** One surface's verdict for one team. */
export function teamVerdict(i: EngineInputs, team: UsageTeam, target: "local" | "hosted"): Verdict {
  const noSeat = providersServingNoSeat(i.catalogue);
  // A key that powers nothing never counts toward a team being able to run.
  const byok = new Set(i.keys.map((k) => k.provider).filter((p) => !noSeat.has(p)));
  const connected: Partial<Record<SubscriptionProviderId, boolean>> = {};
  for (const s of RUNNER_SUBSCRIPTIONS) connected[s] = subStatus(i, s)?.connected === true;
  const missing = missingProvidersForModels({
    models: team.nodes.map((n) => n.model),
    byokProviders: byok,
    subscriptionConnected: connected,
    launchTarget: target,
  });
  const parts: string[] = [];
  const keys: string[] = [];
  const changes: string[] = [];
  for (const p of missing) {
    if (noSeat.has(p)) {
      changes.push(`change the ${providerName(i, p)} model`);
      continue;
    }
    const sub = target === "local" ? runnableSubFor(p) : null;
    if (sub) {
      const phrase = `connect ${displayNameForSubscription(sub)}`;
      if (!parts.includes(phrase)) parts.push(phrase);
    } else {
      keys.push(p);
    }
  }
  if (keys.length) parts.push(addKeys(keys));
  parts.push(...changes);
  const label = target === "local" ? "Desktop" : "Website";
  return parts.length
    ? { ready: false, text: `${label}: ${parts.join(", ")}` }
    : { ready: true, text: `${label}: ready` };
}

export function teamVerdicts(i: EngineInputs): TeamVerdict[] {
  return i.usage.teams.map((team) => ({
    teamId: team.team_id,
    name: team.name,
    desktop: teamVerdict(i, team, "local"),
    website: teamVerdict(i, team, "hosted"),
  }));
}

/** "N to fix": (team × surface) pairs that can't run yet (OQ-1). */
export function toFixCount(i: EngineInputs): number {
  return teamVerdicts(i).reduce(
    (n, v) => n + Number(!v.desktop.ready) + Number(!v.website.ready),
    0,
  );
}

// ---- First time (ENG-75) and the nav badges (ENG-2..5) ----

/** Nothing set up yet: no key saved and no subscription connected. */
export function isFirstTime(i: Pick<EngineInputs, "keys" | "subs">): boolean {
  return i.keys.length === 0 && connectedSubCount(i) === 0;
}

export function engineBadges(i: EngineInputs): Partial<NavBadges> {
  const first = isFirstTime(i);
  return {
    enginesFirstTime: first,
    enginesToFix: first ? 0 : toFixCount(i),
    subscriptions: { connected: connectedSubCount(i), total: RUNNER_SUBSCRIPTIONS.length },
    apiKeys: i.keys.length,
  };
}
