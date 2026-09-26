/**
 * The Add key sheet, as pure data (no React, no fetch): the provider picker's options (ENG-63/64,
 * OQ-22), the hint under the picker (ENG-66, ENG-65/OQ-5 replace hint), the "Other" model-prefix
 * checks (ENG-70, OQ-6), the notes and the footer's "Used by …" (ENG-68), and the save toast.
 *
 * A provider whose catalogue entry serves no seat (NVIDIA NIM today) is described plainly — "No
 * agent uses NVIDIA NIM right now" — never with an inviting label, and it is never sorted first.
 */
import { displayNameForSubscription } from "../../lib/engines";
import {
  type EngineInputs,
  monogramOf,
  noSeatNote,
  providerName,
  providersServingNoSeat,
  runnableSubFor,
  usedByCell,
  usedBySegments,
} from "./engineModel";
import { replaceCopy } from "./keysModel";

// ---- what the picker holds ----

export type ProviderPick =
  | { kind: "none" }
  | { kind: "provider"; provider: string }
  /** "Other": the user types the model prefix (e.g. mistral). */
  | { kind: "other" };

export const NO_PICK: ProviderPick = { kind: "none" };

// ---- titles ----

export interface SheetTitles {
  title: string;
  subtitle: string;
}

export const ADD_KEY_TITLES: SheetTitles = {
  title: "Add an API key",
  subtitle: "For website runs, and Desktop runs without a subscription",
};

/** ENG-60, with the subtitle OQ-19 fixed (embeddings keys are for Domains, not runs). */
export const EMBEDDINGS_KEY_TITLES: SheetTitles = {
  title: "Add an embeddings key",
  subtitle: "For Domains ingest and Ask, on the website and on Desktop.",
};

// ---- the options (ENG-63, OQ-22) ----

export interface PickerOption {
  provider: string;
  monogram: string;
  /** "Claude models · your teams use it", "Saved · many models through one key". */
  description: string;
  /** A key is saved already (picking it replaces that key, OQ-5). */
  saved: boolean;
  /** One of the user's teams runs an agent on it and it can run one. */
  teamUsed: boolean;
}

/** Every provider in the directory: the ones the user's teams use first, then the directory's own
 *  order. A no-seat provider says so instead of its label, and never counts as team-used. */
export function pickerOptions(i: EngineInputs): PickerOption[] {
  const noSeat = providersServingNoSeat(i.catalogue);
  const held = new Set(i.keys.map((k) => k.provider));
  const options = i.directory.map((d): PickerOption => {
    const saved = held.has(d.provider);
    const teamUsed = !noSeat.has(d.provider) && usedBySegments(i.usage, d.provider).length > 0;
    const label = noSeat.has(d.provider)
      ? noSeatNote(providerName(i, d.provider)).replace(/\.$/, "")
      : d.label;
    const description = saved
      ? `Saved · ${label}`
      : teamUsed
        ? `${label} · your teams use it`
        : label;
    return {
      provider: d.provider,
      monogram: monogramOf(i.directory, d.provider),
      description,
      saved,
      teamUsed,
    };
  });
  return [...options.filter((o) => o.teamUsed), ...options.filter((o) => !o.teamUsed)];
}

/** ENG-64: case-insensitive on the slug, the vendor's name and the description ("hug" leaves
 *  huggingface; the "Other" action is always there, outside this list). */
export function filterOptions(
  i: Pick<EngineInputs, "directory" | "catalogue">,
  options: readonly PickerOption[],
  query: string,
): PickerOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  return options.filter((o) =>
    [o.provider, providerName(i, o.provider), o.description].some((s) =>
      s.toLowerCase().includes(q),
    ),
  );
}

// ---- "Other": the model prefix (ENG-70, OQ-6) ----

export const PREFIX_HELPER =
  "The part before the slash in your model names, like mistral in mistral/large.";

/** What the server saves for a typed prefix: trimmed and lowercased. */
export function normalizePrefix(raw: string): string {
  return raw.trim().toLowerCase();
}

/** The inline error for a typed prefix, or null when it is fine (or still empty). The server
 *  accepts `[a-z0-9][a-z0-9_.-]{0,63}` (POST /api/providers); this says why before it has to. */
export function prefixError(raw: string): string | null {
  const v = normalizePrefix(raw);
  if (!v) return null;
  const slash = v.indexOf("/");
  if (slash !== -1) {
    const before = v.slice(0, slash).trim();
    return before
      ? `Just the part before the slash: ${before}.`
      : "Just the part before the slash, like mistral.";
  }
  if (!/^[a-z0-9]/.test(v)) return "Start with a letter or a number.";
  if (!/^[a-z0-9_.-]+$/.test(v)) return "Use letters, numbers, _ . or - only.";
  if (v.length > 64) return "Keep it to 64 characters or fewer.";
  return null;
}

/** The provider a save goes to, or "" when nothing usable is picked or typed yet. */
export function effectiveProvider(pick: ProviderPick, prefix: string): string {
  if (pick.kind === "provider") return pick.provider;
  if (pick.kind === "other" && !prefixError(prefix)) return normalizePrefix(prefix);
  return "";
}

// ---- the hint under the picker (ENG-66) ----

export type SheetHint =
  | { kind: "covers"; prefix: string; example: string | null }
  /** A provider's own hint (huggingface), or the no-seat note. `strong` is bolded (the design
   *  bolds the product name "Domains"). */
  | { kind: "text"; text: string; strong: string | null };

export function sheetHint(i: EngineInputs, provider: string): SheetHint {
  const noSeat = providersServingNoSeat(i.catalogue);
  if (noSeat.has(provider)) {
    return {
      kind: "text",
      text: `No agent uses ${providerName(i, provider)} right now, so this key won’t run anything yet.`,
      strong: null,
    };
  }
  const entry = i.directory.find((d) => d.provider === provider);
  if (entry?.hint) {
    return {
      kind: "text",
      text: entry.hint,
      strong: entry.hint.includes("Domains") ? "Domains" : null,
    };
  }
  return { kind: "covers", prefix: `${provider}/`, example: entry?.example_model ?? null };
}

/** ENG-65 / OQ-5: picking a provider that already has a key replaces it. */
export function replaceHint(i: EngineInputs, provider: string): string | null {
  const saved = i.keys.find((k) => k.provider === provider);
  return saved ? `This replaces your saved ${provider} key (•••• ${saved.key_last4}).` : null;
}

// ---- notes and footer (ENG-68) ----

export const ENCRYPTION_NOTE =
  "Saved encrypted. After you save, you’ll only see •••• and the last 4 characters.";

/** "On Tvashtr Desktop your Claude subscription still runs first. …" — only when that provider's
 *  runnable subscription is connected (live on Desktop, the mirror on the website). */
export function subscriptionNote(i: EngineInputs, provider: string): string | null {
  const sub = provider ? runnableSubFor(provider) : null;
  if (!sub || !i.subs.find((s) => s.provider === sub)?.connected) return null;
  const name = displayNameForSubscription(sub);
  return `On Tvashtr Desktop your ${name} subscription still runs first. This key covers website runs, and Desktop runs if you disconnect ${name}.`;
}

/** The footer's left side: who uses the picked provider ("Used by Engineer · Indicator sprint
 *  team", "+N more"), "Used by Domains ingest" for an embeddings key, or for a typed prefix what
 *  the key covers ("Covers mistral/… models"). Null when there is nothing true to say. */
export function footerNote(i: EngineInputs, pick: ProviderPick, prefix: string): string | null {
  if (pick.kind === "other") {
    const p = effectiveProvider(pick, prefix);
    return p ? `Covers ${p}/… models` : null;
  }
  if (pick.kind !== "provider") return null;
  const p = pick.provider;
  if (providersServingNoSeat(i.catalogue).has(p)) return null;
  const teams = usedBySegments(i.usage, p);
  if (teams.length) return `Used by ${usedByCell(teams)}`;
  const entry = i.directory.find((d) => d.provider === p);
  const inCatalogue = i.catalogue.some((c) => c.provider === p);
  // An embeddings-only key (huggingface) is only ever used by Domains ingest; a model provider is
  // "used by Domains ingest" only when one of the user's domains embeds with it.
  if (
    i.usage.domains.some((d) => d.embedding_provider === p) ||
    (entry?.embeddings && !inCatalogue)
  ) {
    return "Used by Domains ingest";
  }
  return null;
}

// ---- errors and toasts (ENG-71/72) ----

export const FORM_EMPTY_ERROR = "Enter a provider and an API key.";
export const SAVE_NETWORK_ERROR =
  "Couldn’t save that key — is the backend running? Your key wasn’t saved. Try again.";

/** The toast after a save. A no-seat key is never celebrated (area rule). */
export function saveToast(i: EngineInputs, provider: string, replaced: boolean): string {
  if (providersServingNoSeat(i.catalogue).has(provider)) {
    return `${provider} key saved. ${noSeatNote(providerName(i, provider))}`;
  }
  if (replaced) return replaceCopy(i, provider).toast;
  return `${provider} key saved.`;
}
