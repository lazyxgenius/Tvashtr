/**
 * Engines › API keys, as pure data (no React, no fetch): the key table rows (ENG-53), the
 * suggested-keys banner (ENG-52), the data-driven Domains embeddings section (ENG-59, OQ-7), "Where
 * the <p> key is used" (ENG-55, OQ-13) and the Replace / Remove copy (ENG-56/57, OQ-21).
 *
 * A provider whose catalogue entry serves no seat (NVIDIA NIM today) is shown plainly — "No agent
 * uses NVIDIA NIM right now." — and is never suggested as a key to add.
 */
import type { SavedKey, UsageNode } from "../../lib/api/engines";
import { byokProviderOf, displayNameForSubscription } from "../../lib/engines";
import {
  type EngineInputs,
  monogramOf,
  noSeatNote,
  providerName,
  providersServingNoSeat,
  roleLabel,
  runnableSubFor,
  usedByCell,
  usedBySegments,
} from "./engineModel";

export const API_KEYS_LEDE =
  "Stored encrypted for your account. We only ever show the last 4 characters. Keys work on the website and on Tvashtr Desktop.";

/** "a", "a and b", "a, b and c". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Indicator sprint team", "A and B", "A and 2 other teams". */
export function teamsPhrase(names: readonly string[]): string {
  if (names.length <= 2) return joinAnd(names);
  return `${names[0]} and ${names.length - 1} other teams`;
}

function primaryProvider(n: UsageNode): string | null {
  if (!n.model || !n.model.trim()) return null;
  return n.provider ?? (byokProviderOf(n.model) || null);
}

function fallbackProvider(n: UsageNode): string | null {
  if (!n.fallback_model || !n.fallback_model.trim()) return null;
  return n.fallback_provider ?? (byokProviderOf(n.fallback_model) || null);
}

// ---- Added (ENG-53, OQ-17) ----

/** "Just now" under a minute, otherwise a short date ("Sep 12"; the year only when it isn't this
 *  year's). `iso` is the CURRENT key's age (updated_at) — a replace makes it new again. */
export function addedLabel(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  if (now.getTime() - t.getTime() < 60_000) return "Just now";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (t.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return t.toLocaleDateString("en-US", opts);
}

// ---- The key table (ENG-53) ----

export interface KeyRow {
  provider: string;
  monogram: string;
  last4: string;
  /** The Used by cell ("Writer · Docs team", "Domains ingest", "+N more"). */
  usedBy: string;
  /** Every use, for the cell's tooltip. */
  usedByFull: string;
  /** Nothing uses it (the cell reads muted). */
  unused: boolean;
  added: string;
  /** "Added Sep 3" when the key was replaced since (OQ-17), else undefined. */
  addedTitle?: string;
}

/** Everything that uses `provider`: primary agents per team, fallback agents (OQ-13) and Domains. */
export function usedByList(i: EngineInputs, provider: string): string[] {
  const out = usedBySegments(i.usage, provider);
  for (const team of i.usage.teams) {
    const roles: string[] = [];
    for (const n of team.nodes) {
      if (fallbackProvider(n) !== provider || primaryProvider(n) === provider) continue;
      const label = `${roleLabel(n.role_name, n.title)} (fallback)`;
      if (!roles.includes(label)) roles.push(label);
    }
    if (roles.length) out.push(`${roles.join(", ")} · ${team.name}`);
  }
  const domains = i.usage.domains;
  if (domains.some((d) => d.embedding_provider === provider)) out.push("Domains ingest");
  if (domains.some((d) => d.generation_provider === provider)) out.push("Domains Ask");
  return out;
}

/** A provider that only embeds (huggingface): in the directory with the embeddings flag, not in the
 *  model catalogue. Domains ingest is the one thing its key is ever used by. */
export function embeddingsOnly(i: EngineInputs, provider: string): boolean {
  const entry = i.directory.find((d) => d.provider === provider);
  return Boolean(entry?.embeddings) && !i.catalogue.some((c) => c.provider === provider);
}

/** The saved keys, newest first (by when the current key was saved). An embeddings-only key is
 *  "Used by Domains ingest" even before a domain embeds with it (the directory's own words). */
export function keyRows(i: EngineInputs, now: Date = new Date()): KeyRow[] {
  const noSeat = providersServingNoSeat(i.catalogue);
  const time = (k: SavedKey) => new Date(k.updated_at || k.created_at).getTime() || 0;
  return [...i.keys]
    .sort((a, b) => time(b) - time(a) || a.provider.localeCompare(b.provider))
    .map((k): KeyRow => {
      const listed = noSeat.has(k.provider) ? [] : usedByList(i, k.provider);
      const uses =
        listed.length === 0 && embeddingsOnly(i, k.provider) ? ["Domains ingest"] : listed;
      const replaced = Boolean(k.created_at) && k.updated_at !== k.created_at;
      const created = replaced ? addedLabel(k.created_at, now) : "";
      return {
        provider: k.provider,
        monogram: monogramOf(i.directory, k.provider),
        last4: k.key_last4,
        usedBy: noSeat.has(k.provider)
          ? noSeatNote(providerName(i, k.provider))
          : uses.length
            ? usedByCell(uses)
            : "Not used by any team",
        usedByFull: uses.join("; "),
        unused: uses.length === 0,
        added: addedLabel(k.updated_at || k.created_at, now),
        addedTitle: created && created !== "Just now" ? `Added ${created}` : undefined,
      };
    });
}

// ---- Suggested keys (ENG-52) ----

/** Providers the teams' agents use as their model with no key saved — the website can't run them.
 *  A provider that serves no seat is never suggested (a key for it would power nothing). */
export function suggestedKeys(i: EngineInputs): string[] {
  const noSeat = providersServingNoSeat(i.catalogue);
  const held = new Set(i.keys.map((k) => k.provider));
  const out = new Set<string>();
  for (const team of i.usage.teams) {
    for (const n of team.nodes) {
      const p = primaryProvider(n);
      if (p && !held.has(p) && !noSeat.has(p)) out.add(p);
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

// ---- Domains embeddings (ENG-59, OQ-7) ----

export interface EmbeddingItem {
  provider: string;
  /** The saved key's last 4, or null when no key is saved. */
  last4: string | null;
}

export interface EmbeddingsSection {
  /** "suggest": no domain yet — the free Hugging Face / Gemini suggestion. "domains": the providers
   *  the user's domains embed with. */
  mode: "suggest" | "domains";
  description: string;
  items: EmbeddingItem[];
}

const SUGGESTED_EMBEDDINGS = ["huggingface", "gemini"];

export const EMBEDDINGS_SUGGESTION =
  "Domains ingest uses Hugging Face (BGE-small, a free token from huggingface.co) or Gemini embeddings. Add one of these keys to ingest documents.";

/** With no domain, suggest Hugging Face (or Gemini, if that key is the one saved). With domains, one
 *  item per embedding provider they use, and "can ingest" only when every one has a key. */
export function embeddingsSection(i: EngineInputs): EmbeddingsSection {
  const last4 = (p: string) => i.keys.find((k) => k.provider === p)?.key_last4 ?? null;
  const used: string[] = [];
  for (const d of i.usage.domains) {
    if (d.embedding_provider && !used.includes(d.embedding_provider)) {
      used.push(d.embedding_provider);
    }
  }
  if (used.length === 0) {
    const saved = SUGGESTED_EMBEDDINGS.find((p) => last4(p) !== null);
    const provider = saved ?? SUGGESTED_EMBEDDINGS[0];
    return {
      mode: "suggest",
      description: EMBEDDINGS_SUGGESTION,
      items: [{ provider, last4: last4(provider) }],
    };
  }
  const items = used.map((provider) => ({ provider, last4: last4(provider) }));
  const names = joinAnd(used.map((p) => providerName(i, p)));
  const missing = items.filter((it) => it.last4 === null).length;
  const description =
    missing === 0
      ? `Your domains embed documents with ${names}. ${used.length === 1 ? "Its key is" : "Their keys are"} saved, so Domains can ingest documents.`
      : `Your domains embed documents with ${names}. Add ${missing === 1 ? "the missing key" : "the missing keys"} to ingest documents.`;
  return { mode: "domains", description, items };
}

// ---- Where the <p> key is used (ENG-55, OQ-13) ----

export interface UsageRow {
  kind: "node" | "fallback" | "domain";
  /** The role name in bold ("Writer", "Engineer (fallback)") or the domain's name. */
  title: string;
  /** "Docs team · deepseek/deepseek-chat" / "embeddings (huggingface/BAAI/bge-small-en-v1.5)". */
  detail: string;
  role: string;
  teamId?: string;
  nodeId?: string;
}

export interface KeyUsage {
  heading: string;
  rows: UsageRow[];
  /** Shown when there are no rows. */
  empty: string;
  /** "Works for website runs and Desktop runs." — left out for a provider that serves no seat. */
  footer: string | null;
}

export function keyUsage(i: EngineInputs, provider: string): KeyUsage {
  const noSeat = providersServingNoSeat(i.catalogue).has(provider);
  const rows: UsageRow[] = [];
  for (const team of i.usage.teams) {
    for (const n of team.nodes) {
      if (primaryProvider(n) === provider) {
        rows.push({
          kind: "node",
          title: roleLabel(n.role_name, n.title),
          detail: `${team.name} · ${n.model ?? ""}`,
          role: n.role_name,
          teamId: team.team_id,
          nodeId: n.node_id,
        });
      }
    }
  }
  for (const team of i.usage.teams) {
    for (const n of team.nodes) {
      if (fallbackProvider(n) === provider && primaryProvider(n) !== provider) {
        rows.push({
          kind: "fallback",
          title: `${roleLabel(n.role_name, n.title)} (fallback)`,
          detail: `${team.name} · ${n.fallback_model ?? ""}`,
          role: n.role_name,
          teamId: team.team_id,
          nodeId: n.node_id,
        });
      }
    }
  }
  for (const d of i.usage.domains) {
    if (d.embedding_provider === provider) {
      rows.push({
        kind: "domain",
        title: d.name,
        detail: `embeddings (${d.embedding_model ?? provider})`,
        role: "domain",
      });
    }
    if (d.generation_provider === provider) {
      rows.push({
        kind: "domain",
        title: d.name,
        detail: `Ask answers (${d.generation_model ?? provider})`,
        role: "domain",
      });
    }
  }
  return {
    heading: `${provider} is used by`,
    rows,
    empty: noSeat ? noSeatNote(providerName(i, provider)) : `No team uses ${provider} yet.`,
    footer: noSeat ? null : "Works for website runs and Desktop runs.",
  };
}

// ---- Replace (ENG-56) ----

/** The one agent using `provider` as its model, or null (none, or several). */
function soleUser(i: EngineInputs, provider: string): string | null {
  const users: string[] = [];
  for (const team of i.usage.teams) {
    for (const n of team.nodes) {
      if (primaryProvider(n) === provider) users.push(roleLabel(n.role_name, n.title));
    }
  }
  return users.length === 1 ? users[0] : null;
}

export interface ReplaceCopy {
  title: string;
  body: string;
  /** The success toast. */
  toast: string;
}

export function replaceCopy(i: EngineInputs, provider: string): ReplaceCopy {
  const noSeat = providersServingNoSeat(i.catalogue).has(provider);
  const user = noSeat ? null : soleUser(i, provider);
  const lead = "The old key is deleted when you save.";
  const body = noSeat
    ? `${lead} ${noSeatNote(providerName(i, provider))}`
    : user
      ? `${lead} ${user} uses the new one on its next run.`
      : `${lead} Agents use the new one on their next run.`;
  return {
    title: `Replace the ${provider} key`,
    body,
    toast: user
      ? `${provider} key replaced. ${user} uses it on its next run.`
      : `${provider} key replaced.`,
  };
}

// ---- Remove (ENG-57, OQ-13, OQ-21) ----

export interface RemoveCopy {
  title: string;
  body: string;
  /** The teams whose runs a removal can break (to check for runs in progress). */
  teamIds: string[];
  toast: string;
}

interface TeamUse {
  teamId: string;
  team: string;
  roles: string[];
}

function teamUses(
  i: EngineInputs,
  provider: string,
  pick: (n: UsageNode) => string | null,
): TeamUse[] {
  const out: TeamUse[] = [];
  for (const team of i.usage.teams) {
    const roles: string[] = [];
    for (const n of team.nodes) {
      if (pick(n) !== provider) continue;
      const label = roleLabel(n.role_name, n.title);
      if (!roles.includes(label)) roles.push(label);
    }
    if (roles.length) out.push({ teamId: team.team_id, team: team.name, roles });
  }
  return out;
}

function whoUses(uses: readonly TeamUse[]): { phrase: string; plural: boolean } {
  const parts = uses.map((u) => `${joinAnd(u.roles)} in ${u.team}`);
  const plural = uses.length > 1 || (uses[0]?.roles.length ?? 0) > 1;
  return { phrase: joinAnd(parts), plural };
}

/** Whether Tvashtr Desktop still runs `provider` on a connected subscription (live on Desktop, the
 *  mirror on the website), and that subscription's name. */
function coveringSub(i: EngineInputs, provider: string): string | null {
  const sub = runnableSubFor(provider);
  if (!sub) return null;
  return i.subs.find((s) => s.provider === sub)?.connected ? displayNameForSubscription(sub) : null;
}

export function removeCopy(i: EngineInputs, provider: string): RemoveCopy {
  const title = `Remove the ${provider} key?`;
  const toast = `${provider} key removed.`;
  const undo = "You can’t undo this.";
  if (providersServingNoSeat(i.catalogue).has(provider)) {
    return { title, body: `${noSeatNote(providerName(i, provider))} ${undo}`, teamIds: [], toast };
  }
  const primary = teamUses(i, provider, primaryProvider);
  const fallback = teamUses(i, provider, (n) =>
    primaryProvider(n) === provider ? null : fallbackProvider(n),
  );
  const domains = i.usage.domains
    .filter((d) => d.embedding_provider === provider)
    .map((d) => d.name);
  const sentences: string[] = [];
  if (primary.length) {
    const who = whoUses(primary);
    sentences.push(`${who.phrase} ${who.plural ? "use" : "uses"} ${provider}.`);
    const teams = joinAnd(primary.map((u) => u.team));
    const sub = coveringSub(i, provider);
    sentences.push(
      sub
        ? `${teams} can’t run on the website until you add a key again. On Desktop ${primary.length > 1 ? "they still run" : "it still runs"} on your ${sub} subscription.`
        : `${teams} can’t run on the website, or on Desktop, until you add a key again.`,
    );
  }
  if (fallback.length) {
    const who = joinAnd(fallback.map((u) => `${joinAnd(u.roles)} in ${u.team}`));
    sentences.push(`${provider} is ${primary.length ? "also " : ""}the fallback for ${who}.`);
  }
  if (domains.length) {
    sentences.push(
      `${joinAnd(domains)} ${domains.length > 1 ? "embed" : "embeds"} documents with ${provider} and can’t ingest until you add a key again.`,
    );
  }
  if (!sentences.length) sentences.push(`No team uses ${provider}.`);
  sentences.push(undo);
  return { title, body: sentences.join(" "), teamIds: primary.map((u) => u.teamId), toast };
}

/** OQ-21: the line for teams with a run in progress when their key is removed, or null. */
export function inFlightLine(
  i: EngineInputs,
  provider: string,
  running: readonly string[],
): string | null {
  if (running.length === 0) return null;
  const covered = coveringSub(i, provider) !== null;
  const names = joinAnd(running);
  if (running.length === 1) {
    return covered
      ? `A run of ${names} is in progress. On the website it will fail at its next ${provider} step.`
      : `A run of ${names} is in progress and will fail at its next ${provider} step.`;
  }
  return covered
    ? `Runs of ${names} are in progress. On the website they will fail at their next ${provider} step.`
    : `Runs of ${names} are in progress and will fail at their next ${provider} step.`;
}
