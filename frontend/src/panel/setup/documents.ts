/**
 * Reads & Writes (PANEL-52..56): the documents a team knows about, and the pure rules for an
 * agent's ordered Reads list. A document is a name: the entry agent writes the shared spec
 * (`config.writes_to`, default "spec"), other agents write the one named in their `writes_to`, and
 * any name in some agent's `reads_from` that nobody writes is known too ("no one writes this yet").
 * An agent with no Reads names reads the spec by default (`reads_default`, Q4); names replace it.
 */
import type { GraphEdge, TeamGraphNode } from "../../lib/api";
import { nodeTitle } from "../../lib/nodeNames";
import { joinAnd } from "../nodeActions";

export interface KnownDocument {
  name: string;
  /** The shared spec the entry agent writes. */
  isSpec: boolean;
  /** Who writes it (agent names), empty when no one does yet. */
  writers: string[];
}

const cfgOf = (n: TeamGraphNode) => (n.config as Record<string, unknown> | null) ?? {};
const writesOf = (n: TeamGraphNode) => {
  const v = cfgOf(n).writes_to;
  return typeof v === "string" ? v.trim() : "";
};
const readsOf = (n: TeamGraphNode) => {
  const v = cfgOf(n).reads_from;
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim())
    : [];
};

/** The team's entry agent: the node no arrow points at (as the canvas finds it). */
export function entryNodeOf(nodes: TeamGraphNode[], edges: GraphEdge[]): TeamGraphNode | null {
  const targets = new Set(edges.map((e) => e.target_node_id));
  return nodes.find((n) => !targets.has(n.id)) ?? null;
}

/** The shared spec's document name: what the entry agent writes (the executor's default "spec"). */
export function specNameOf(nodes: TeamGraphNode[], edges: GraphEdge[]): string {
  const entry = entryNodeOf(nodes, edges);
  return (entry && writesOf(entry)) || "spec";
}

/**
 * Every document this agent could read or write, from the saved team (other agents' Writes and
 * Reads) plus the agent's own draft Reads (so a name it just typed stays listed). The spec comes
 * first; the rest keep the order they're first met in. The agent's own saved Writes isn't listed
 * as someone else's document.
 */
export function knownDocuments({
  nodes,
  edges,
  selfId,
  draftReads = [],
}: {
  nodes: TeamGraphNode[];
  edges: GraphEdge[];
  selfId: string;
  draftReads?: readonly string[];
}): KnownDocument[] {
  const entry = entryNodeOf(nodes, edges);
  const spec = specNameOf(nodes, edges);
  const docs = new Map<string, KnownDocument>();
  const add = (name: string, writer?: string) => {
    let doc = docs.get(name);
    if (!doc) {
      doc = { name, isSpec: name === spec, writers: [] };
      docs.set(name, doc);
    }
    if (writer && !doc.writers.includes(writer)) doc.writers.push(writer);
  };
  add(spec, entry ? nodeTitle(entry) : undefined);
  for (const n of nodes) {
    if (n.id === selfId || n.id === entry?.id) continue;
    const w = writesOf(n);
    if (w) add(w, nodeTitle(n));
  }
  for (const n of nodes) for (const r of readsOf(n)) add(r);
  for (const r of draftReads) if (r.trim()) add(r.trim());
  return [...docs.values()];
}

/** "Product manager", "Engineer and Architect", or "no one writes this yet". */
export function writersText(doc: KnownDocument): string {
  return doc.writers.length > 0 ? joinAnd(doc.writers) : "no one writes this yet";
}

/** The Writes picker's line: "Engineer writes this", "Engineer and Architect write this". */
export function writerLine(doc: KnownDocument): string {
  if (doc.writers.length === 0) return "no one writes this yet";
  return `${joinAnd(doc.writers)} ${doc.writers.length > 1 ? "write" : "writes"} this`;
}

/** How a document is named in the pickers: the spec is "Shared spec". */
export function documentLabel(doc: KnownDocument): string {
  return doc.isSpec ? "Shared spec" : doc.name;
}

export interface ReadsValue {
  readsFrom: string[];
  readsDefault: boolean;
}

/** The chips the Reads row shows, in reading order (the implicit spec when nothing is named). */
export function readsChips(value: ReadsValue, spec: string): string[] {
  if (value.readsFrom.length > 0) return value.readsFrom;
  return value.readsDefault ? [spec] : [];
}

/**
 * The Reads value for the documents it should read, in order. Nothing → reads nothing
 * (`reads_default: false`); the spec alone → the default (no names, `reads_default` back on), so
 * the stored value stays the plain default; anything else → those names (a list replaces the
 * default, so `readsDefault` is left as it was).
 */
export function readsFor(names: readonly string[], spec: string, prev: ReadsValue): ReadsValue {
  const clean = names.map((n) => n.trim()).filter((n, i, all) => n && all.indexOf(n) === i);
  if (clean.length === 0) return { readsFrom: [], readsDefault: false };
  if (clean.length === 1 && clean[0] === spec) return { readsFrom: [], readsDefault: true };
  return { readsFrom: clean, readsDefault: prev.readsDefault };
}

/** The Reads value with one chip removed ("Remove <name>"); removing the last one reads nothing. */
export function withoutRead(value: ReadsValue, name: string, spec: string): ReadsValue {
  return readsFor(
    readsChips(value, spec).filter((n) => n !== name),
    spec,
    value,
  );
}

/**
 * The documents another agent could write (the Writes picker): what other agents write, and names
 * someone reads that no one writes yet. The shared spec stays the entry agent's.
 */
export function writableDocuments(known: readonly KnownDocument[]): KnownDocument[] {
  return known.filter((d) => !d.isSpec);
}

/** Longest document name the pickers take. */
export const DOC_NAME_MAX = 60;
