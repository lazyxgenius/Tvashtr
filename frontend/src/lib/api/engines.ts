/**
 * Engines API (B-ENGINES contract, `docs/superpowers/plans/api/engines.md`): the provider directory
 * and model catalogue from the public config, where each provider is used (`/api/engines/usage`),
 * the subscription mirror plus the Desktop runner's check-in, and the account's saved API keys.
 *
 * Every answer is validated here, at the boundary: a malformed item is dropped, and a malformed
 * answer throws, so one unexpected response never blanks the whole Engines page. Every call reports
 * its outcome to the header's backend status (through `apiRequest`).
 */
import {
  SUBSCRIPTION_PROVIDERS,
  type SubscriptionCardState,
  type SubscriptionProviderId,
  type SubscriptionStatus,
} from "../engines";
import type { ProviderDirectoryEntry } from "./home";
import { apiRequest } from "./runs";

export type { ProviderDirectoryEntry } from "./home";

// ---- small guards ----

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : []);

function list<T>(v: unknown, item: (raw: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const raw of v) {
    const one = item(raw);
    if (one !== null) out.push(one);
  }
  return out;
}

// ---- GET /api/config (the parts Engines reads) ----

/** One model-catalogue entry: which models a provider serves in each seat. A provider whose both
 *  defaults are null and presets empty serves NO seat (nvidia_nim today). */
export interface CatalogueEntry {
  provider: string;
  thinker_default: string | null;
  worker_default: string | null;
  thinker_presets: string[];
  worker_presets: string[];
  label: string | null;
  subscription: string | null;
}

export interface EmbeddingPreset {
  id: string;
  label: string;
  slug: string;
  provider: string;
  dim: number | null;
  notes: string;
}

export interface EnginesConfig {
  directory: ProviderDirectoryEntry[];
  catalogue: CatalogueEntry[];
  embeddingPresets: EmbeddingPreset[];
}

function toDirectoryEntry(raw: unknown): ProviderDirectoryEntry | null {
  if (!isObj(raw) || !isStr(raw.provider) || !raw.provider) return null;
  const monogram = isStr(raw.monogram) && raw.monogram ? raw.monogram : raw.provider;
  return {
    provider: raw.provider,
    monogram: monogram.charAt(0).toUpperCase(),
    name: isStr(raw.name) && raw.name ? raw.name : raw.provider,
    label: isStr(raw.label) ? raw.label : "",
    example_model: strOrNull(raw.example_model),
    subscription: strOrNull(raw.subscription),
    embeddings: raw.embeddings === true,
    hint: strOrNull(raw.hint),
  };
}

function toCatalogueEntry(raw: unknown): CatalogueEntry | null {
  if (!isObj(raw) || !isStr(raw.provider) || !raw.provider) return null;
  return {
    provider: raw.provider,
    thinker_default: strOrNull(raw.thinker_default),
    worker_default: strOrNull(raw.worker_default),
    thinker_presets: strList(raw.thinker_presets),
    worker_presets: strList(raw.worker_presets),
    label: strOrNull(raw.label),
    subscription: strOrNull(raw.subscription),
  };
}

function toEmbeddingPreset(raw: unknown): EmbeddingPreset | null {
  if (!isObj(raw) || !isStr(raw.slug) || !isStr(raw.provider)) return null;
  return {
    id: isStr(raw.id) ? raw.id : raw.slug,
    label: isStr(raw.label) ? raw.label : raw.slug,
    slug: raw.slug,
    provider: raw.provider,
    dim: typeof raw.dim === "number" ? raw.dim : null,
    notes: isStr(raw.notes) ? raw.notes : "",
  };
}

let configPromise: Promise<EnginesConfig> | null = null;

/** The directory, catalogue and embedding presets (cached for the session — they are static
 *  server-side; a failed fetch is retried on the next call). */
export function getEnginesConfig(): Promise<EnginesConfig> {
  if (!configPromise) {
    configPromise = apiRequest<unknown>("GET", "/api/config")
      .then((body) => {
        if (!isObj(body)) throw new Error("Unexpected answer from /api/config");
        return {
          directory: list(body.provider_directory, toDirectoryEntry),
          catalogue: list(body.provider_catalogue, toCatalogueEntry),
          embeddingPresets: list(body.embedding_presets, toEmbeddingPreset),
        };
      })
      .catch((e: unknown) => {
        configPromise = null;
        throw e;
      });
  }
  return configPromise;
}

// ---- GET /api/engines/usage ----

export interface UsageNode {
  node_id: string;
  role_name: string;
  /** The agent's display name, or null (fall back to the role). */
  title: string | null;
  kind: string;
  /** Null when the node has no model yet — it then uses no provider. */
  model: string | null;
  provider: string | null;
  fallback_model: string | null;
  fallback_provider: string | null;
}

export interface UsageTeam {
  team_id: string;
  name: string;
  nodes: UsageNode[];
}

export interface UsageDomain {
  domain_id: string;
  name: string;
  embedding_model: string | null;
  embedding_provider: string | null;
  generation_model: string | null;
  generation_provider: string | null;
}

export interface ProviderTeamUse {
  team_id: string;
  name: string;
  roles: string[];
  node_ids: string[];
}

export interface ProviderDomainUse {
  domain_id: string;
  name: string;
  use: "embedding" | "generation";
}

export interface ProviderUse {
  /** Teams whose nodes use it as their primary model — the only use verdicts count. */
  teams: ProviderTeamUse[];
  /** Nodes that use it only as a fallback model (listed "(fallback)", never in verdicts). */
  fallback_teams: ProviderTeamUse[];
  domains: ProviderDomainUse[];
}

export interface EngineUsage {
  teams: UsageTeam[];
  domains: UsageDomain[];
  by_provider: Record<string, ProviderUse>;
}

export const EMPTY_USAGE: EngineUsage = { teams: [], domains: [], by_provider: {} };

function toUsageNode(raw: unknown): UsageNode | null {
  if (!isObj(raw) || !isStr(raw.node_id)) return null;
  const model = strOrNull(raw.model);
  return {
    node_id: raw.node_id,
    role_name: isStr(raw.role_name) ? raw.role_name : "",
    title: strOrNull(raw.title),
    kind: isStr(raw.kind) ? raw.kind : "agent",
    model,
    provider: model === null ? null : strOrNull(raw.provider),
    fallback_model: strOrNull(raw.fallback_model),
    fallback_provider: strOrNull(raw.fallback_provider),
  };
}

function toUsageTeam(raw: unknown): UsageTeam | null {
  if (!isObj(raw) || !isStr(raw.team_id)) return null;
  return {
    team_id: raw.team_id,
    name: isStr(raw.name) ? raw.name : "Untitled team",
    nodes: list(raw.nodes, toUsageNode),
  };
}

function toUsageDomain(raw: unknown): UsageDomain | null {
  if (!isObj(raw) || !isStr(raw.domain_id)) return null;
  return {
    domain_id: raw.domain_id,
    name: isStr(raw.name) ? raw.name : "Untitled domain",
    embedding_model: strOrNull(raw.embedding_model),
    embedding_provider: strOrNull(raw.embedding_provider),
    generation_model: strOrNull(raw.generation_model),
    generation_provider: strOrNull(raw.generation_provider),
  };
}

function toTeamUse(raw: unknown): ProviderTeamUse | null {
  if (!isObj(raw) || !isStr(raw.team_id)) return null;
  return {
    team_id: raw.team_id,
    name: isStr(raw.name) ? raw.name : "Untitled team",
    roles: strList(raw.roles),
    node_ids: strList(raw.node_ids),
  };
}

function toDomainUse(raw: unknown): ProviderDomainUse | null {
  if (!isObj(raw) || !isStr(raw.domain_id)) return null;
  if (raw.use !== "embedding" && raw.use !== "generation") return null;
  return { domain_id: raw.domain_id, name: isStr(raw.name) ? raw.name : "", use: raw.use };
}

export async function getEngineUsage(): Promise<EngineUsage> {
  const body = await apiRequest<unknown>("GET", "/api/engines/usage");
  if (!isObj(body) || !Array.isArray(body.teams)) {
    throw new Error("Unexpected answer from /api/engines/usage");
  }
  const byProvider: Record<string, ProviderUse> = {};
  if (isObj(body.by_provider)) {
    for (const [provider, raw] of Object.entries(body.by_provider)) {
      if (!isObj(raw)) continue;
      byProvider[provider] = {
        teams: list(raw.teams, toTeamUse),
        fallback_teams: list(raw.fallback_teams, toTeamUse),
        domains: list(raw.domains, toDomainUse),
      };
    }
  }
  return {
    teams: list(body.teams, toUsageTeam),
    domains: list(body.domains, toUsageDomain),
    by_provider: byProvider,
  };
}

// ---- GET /api/engines/subscriptions (the mirror + the Desktop runner's check-in) ----

export interface RunnerStatus {
  /** The owner's Tvashtr Desktop polled within the server's freshness window. */
  fresh: boolean;
  last_seen_at: string | null;
  providers: string[];
}

export interface EngineSubscriptions {
  subscriptions: SubscriptionStatus[];
  runner: RunnerStatus;
}

export const NO_RUNNER: RunnerStatus = { fresh: false, last_seen_at: null, providers: [] };

const STATES: readonly SubscriptionCardState[] = [
  "disconnected",
  "checking",
  "needs_install",
  "needs_login",
  "api_key",
  "connected",
  "error",
];

/** One subscription status (from the server mirror or the Desktop bridge), or null if unusable. */
export function toSubscriptionStatus(raw: unknown): SubscriptionStatus | null {
  if (!isObj(raw)) return null;
  const provider = raw.provider as SubscriptionProviderId;
  if (!SUBSCRIPTION_PROVIDERS.includes(provider)) return null;
  const connected = raw.connected === true;
  const state = STATES.includes(raw.state as SubscriptionCardState)
    ? (raw.state as SubscriptionCardState)
    : connected
      ? "connected"
      : "disconnected";
  const out: SubscriptionStatus = {
    provider,
    connected,
    state,
    account_hint: strOrNull(raw.account_hint),
    source: raw.source === "harness" || raw.source === "oauth" ? raw.source : null,
    checked_at: strOrNull(raw.checked_at),
  };
  if (typeof raw.runner_fresh === "boolean") out.runner_fresh = raw.runner_fresh;
  return out;
}

/** Always one status per subscription, in the fixed order (Claude, Grok, Codex); a provider the
 *  answer left out reads "disconnected". */
export function completeStatuses(rows: readonly SubscriptionStatus[]): SubscriptionStatus[] {
  return SUBSCRIPTION_PROVIDERS.map(
    (provider) =>
      rows.find((r) => r.provider === provider) ?? {
        provider,
        connected: false,
        state: "disconnected",
        account_hint: null,
        source: null,
        checked_at: null,
      },
  );
}

export async function getSubscriptions(): Promise<EngineSubscriptions> {
  const body = await apiRequest<unknown>("GET", "/api/engines/subscriptions");
  if (!isObj(body) || !Array.isArray(body.subscriptions)) {
    throw new Error("Unexpected answer from /api/engines/subscriptions");
  }
  const runner = isObj(body.runner)
    ? {
        fresh: body.runner.fresh === true,
        last_seen_at: strOrNull(body.runner.last_seen_at),
        providers: strList(body.runner.providers),
      }
    : NO_RUNNER;
  return {
    subscriptions: completeStatuses(list(body.subscriptions, toSubscriptionStatus)),
    runner,
  };
}

// ---- /api/providers (the account's API keys) ----

export interface SavedKey {
  provider: string;
  key_last4: string;
  created_at: string;
  /** When the CURRENT key was saved (a replace keeps `created_at`). */
  updated_at: string;
}

export interface SaveKeyResult extends SavedKey {
  /** A key for that provider already existed and was replaced. */
  replaced: boolean;
}

function toSavedKey(raw: unknown): SavedKey | null {
  if (!isObj(raw) || !isStr(raw.provider) || !raw.provider) return null;
  const created = isStr(raw.created_at) ? raw.created_at : "";
  return {
    provider: raw.provider,
    key_last4: isStr(raw.key_last4) ? raw.key_last4 : "",
    created_at: created,
    updated_at: isStr(raw.updated_at) ? raw.updated_at : created,
  };
}

/** The account's saved keys (server order: oldest first). */
export async function listKeys(): Promise<SavedKey[]> {
  const body = await apiRequest<unknown>("GET", "/api/providers");
  if (!isObj(body) || !Array.isArray(body.providers)) {
    throw new Error("Unexpected answer from /api/providers");
  }
  return list(body.providers, toSavedKey);
}

/** Save (or replace) a key. A 422 throws an `ApiDetailError` whose message is the server's plain
 *  `detail` ("A provider is required." …), ready to show inline. */
export async function saveKey(provider: string, apiKey: string): Promise<SaveKeyResult> {
  const body = await apiRequest<unknown>("POST", "/api/providers", { provider, api_key: apiKey });
  const key = toSavedKey(body);
  if (!key || !isObj(body)) throw new Error("Unexpected answer from POST /api/providers");
  return { ...key, replaced: body.replaced === true };
}

/** Remove a key (204, idempotent). */
export async function removeKey(provider: string): Promise<void> {
  await apiRequest<null>("DELETE", `/api/providers/${encodeURIComponent(provider)}`);
}

/** Test seam. */
export function __resetEnginesConfigForTests(): void {
  configPromise = null;
}
