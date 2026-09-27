/**
 * What the model picker offers (PANEL-41/42/46/47), derived from the served provider catalogue
 * (`GET /api/config` → `provider_catalogue`): one group per provider that has models for this
 * agent's seat, how the account can run it (a Desktop subscription, an API key, or nothing yet),
 * the honest note above the groups, and the soft warnings under the Model and Backup model rows.
 * Pure: no React, no fetch.
 */
import type { Capability, GraphEdge, ProviderCatalogueEntry, TeamGraphNode } from "../../lib/api";
import { providerOf } from "../../lib/api";
import { displayNameForSubscription, type SubscriptionProviderId } from "../../lib/engines";
import { nodeTitle } from "../../lib/nodeNames";
import { joinAnd } from "../nodeActions";
import type { CredentialCover } from "./modelCopy";

/** A worker drives the agent loop; everything else makes one completion (the thinker seat). */
export function seatOf(node: Pick<TeamGraphNode, "kind">): Capability {
  return node.kind === "agent" ? "worker" : "thinker";
}

/** How the account runs a provider's models: its Desktop subscription, its API key, or not yet. */
export type GroupState = "subscription" | "key" | "none";

export interface ModelGroup {
  provider: string;
  /** The display name ("xAI"), used in the key field and the toast. */
  label: string;
  state: GroupState;
  /** The subscription that can run it on Tvashtr Desktop ("grok" / "claude"), if any. */
  subscription: SubscriptionProviderId | null;
  /** The full slugs this seat can pick. */
  models: string[];
  /** Proven to run a full build the way it would run here (a probed key, or the subscription). */
  proven: boolean;
  /** Website only: the "Your Claude or Grok subscription can run agents in Tvashtr Desktop" note. */
  desktopExplainer: boolean;
}

const SUBSCRIPTIONS: readonly SubscriptionProviderId[] = ["claude", "grok", "codex"];

function subscriptionOf(entry: ProviderCatalogueEntry): SubscriptionProviderId | null {
  const sub = entry.subscription;
  return SUBSCRIPTIONS.find((s) => s === sub) ?? null;
}

function seatPresets(entry: ProviderCatalogueEntry, seat: Capability): string[] {
  const list = seat === "worker" ? entry.worker_presets : entry.thinker_presets;
  return Array.isArray(list) ? list.filter((m) => typeof m === "string" && m.trim() !== "") : [];
}

/**
 * The picker's provider groups, before search. Only providers with presets for this seat are
 * offered (NIM serves no seat, so it never appears). Order: the current model's provider, then the
 * providers a subscription can run (Claude, Grok), then the rest in catalogue order.
 */
export function modelGroups(
  catalogue: readonly ProviderCatalogueEntry[],
  seat: Capability,
  cover: CredentialCover | null,
  { desktop, current }: { desktop: boolean; current: string },
): ModelGroup[] {
  const groups: ModelGroup[] = [];
  for (const entry of catalogue) {
    const models = seatPresets(entry, seat);
    if (models.length === 0) continue;
    const subscription = subscriptionOf(entry);
    const subscribed = desktop && subscription !== null && cover?.subs[subscription] === true;
    const state: GroupState = subscribed
      ? "subscription"
      : cover?.byok.has(entry.provider)
        ? "key"
        : "none";
    groups.push({
      provider: entry.provider,
      label: entry.label || entry.provider,
      state,
      subscription,
      models,
      proven: state === "subscription" || entry.byok_probed === true,
      desktopExplainer: !desktop && subscription !== null && state === "none",
    });
  }
  const currentProvider = current.trim() ? providerOf(current) : "";
  const rank = (g: ModelGroup) =>
    g.provider === currentProvider
      ? 0
      : g.subscription === "claude" || g.subscription === "grok"
        ? 1
        : 2;
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
    .map(({ g }) => g);
}

/** The groups (and models) that match a search: a provider match keeps all its models. */
export function searchGroups(groups: readonly ModelGroup[], query: string): ModelGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...groups];
  const out: ModelGroup[] = [];
  for (const g of groups) {
    if (g.provider.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)) {
      out.push(g);
      continue;
    }
    const models = g.models.filter((m) => m.toLowerCase().includes(q));
    if (models.length > 0) out.push({ ...g, models });
  }
  return out;
}

/** The model's id without its provider ("xai/grok-4.7" → "grok-4.7"). */
export function shortId(slug: string): string {
  const at = slug.indexOf("/");
  return at === -1 ? slug : slug.slice(at + 1);
}

export const PROVEN_NOTE = "Only models proven to run a full build are listed.";

/**
 * The note above the groups. The design's sentence is only true when every provider listed has
 * been proven the way it would run here; the website offers Claude and Grok models on an API key,
 * which were proven on their subscriptions only (`byok_probed: false`), so the note says so.
 */
export function pickerNote(groups: readonly ModelGroup[]): string {
  const unproven = groups.filter((g) => !g.proven).map((g) => g.label);
  if (unproven.length === 0) return PROVEN_NOTE;
  return `Proven to run a full build, except ${joinAnd(unproven)} models on an API key.`;
}

/** The subscription group's state line ("Grok subscription · this computer"). */
export function subscriptionStateText(sub: SubscriptionProviderId): string {
  return `${displayNameForSubscription(sub)} subscription · this computer`;
}

/** Every slug the catalogue declares, for either seat. */
function catalogueSlugs(catalogue: readonly ProviderCatalogueEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of catalogue) {
    for (const m of [
      e.thinker_default,
      e.worker_default,
      ...(e.thinker_presets ?? []),
      ...(e.worker_presets ?? []),
    ]) {
      if (typeof m === "string" && m.trim()) out.add(m.trim());
    }
  }
  return out;
}

/** A catalogue model (the button shows its provider tile and short id; others show the slug). */
export function isCatalogueModel(
  slug: string,
  catalogue: readonly ProviderCatalogueEntry[],
): boolean {
  return catalogueSlugs(catalogue).has(slug.trim());
}

/**
 * The unknown-model warning (PANEL-47) for a main or backup model the catalogue doesn't list:
 * soft, it never blocks Save. Null when the model is blank or known, and while the catalogue is
 * still loading (an empty catalogue knows nothing, so it can't call anything unknown).
 */
export function unknownModel(
  slug: string,
  catalogue: readonly ProviderCatalogueEntry[],
): string | null {
  const s = slug.trim();
  if (!s || catalogue.length === 0) return null;
  return isCatalogueModel(s, catalogue) ? null : s;
}

/**
 * The same-model advisory (PANEL-46): a verdict agent (its arrows route on what it says) that runs
 * the same model as an agent it's connected to. Returns that agent's name, or null.
 */
export function sameModelSibling(
  node: Pick<TeamGraphNode, "id">,
  model: string,
  nodes: readonly TeamGraphNode[],
  edges: readonly GraphEdge[],
  { verdict }: { verdict: boolean },
): string | null {
  const slug = model.trim();
  if (!verdict || !slug) return null;
  const connected = new Set<string>();
  for (const e of edges) {
    if (e.source_node_id === node.id) connected.add(e.target_node_id);
    if (e.target_node_id === node.id) connected.add(e.source_node_id);
  }
  const sibling = nodes.find(
    (n) =>
      n.id !== node.id &&
      (n.kind === "agent" || n.kind === "completion") &&
      connected.has(n.id) &&
      (n.model ?? "").trim() === slug,
  );
  return sibling ? nodeTitle(sibling) : null;
}

/** A custom model ID must be `provider/model`; null when it is, else what to fix. */
export function customModelProblem(text: string): string | null {
  const s = text.trim();
  const at = s.indexOf("/");
  if (at > 0 && at < s.length - 1 && !/\s/.test(s)) return null;
  return "Use provider/model, for example openai/gpt-4.1-mini.";
}

/** The model the picker lands on after a key is added: the seat's default, else its first preset. */
export function landingModel(
  group: ModelGroup,
  catalogue: readonly ProviderCatalogueEntry[],
  seat: Capability,
): string {
  const entry = catalogue.find((e) => e.provider === group.provider);
  const def = entry ? (seat === "worker" ? entry.worker_default : entry.thinker_default) : null;
  return def && group.models.includes(def) ? def : (group.models[0] ?? "");
}
