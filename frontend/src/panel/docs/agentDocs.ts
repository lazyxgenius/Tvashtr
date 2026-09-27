/**
 * The Docs tab's cards (PANEL-76..80), from one run's documents (`GET /api/runs/{id}/documents`)
 * and the agent's own Reads / Writes: the shared spec, what this agent wrote, what it read, and
 * the names it's set to use that the run didn't produce ("Not written in this run").
 */
import type { RunDoc } from "../../lib/api/docs";
import { joinAnd } from "../nodeActions";
import { whenShort } from "../runs/rounds";

export interface AgentDocs {
  shared: RunDoc | null;
  /** Documents (not the spec) this agent wrote in the run. */
  writes: RunDoc[];
  /** Its Writes name when the run has no document by that name. */
  missingWrite: string | null;
  /** Documents it read, the spec first. */
  reads: RunDoc[];
  /** Its Reads names the run has no document for. */
  missingReads: string[];
}

export function agentDocs(
  docs: RunDoc[],
  nodeId: string,
  own: { writesTo: string; readsFrom: readonly string[] },
): AgentDocs {
  const has = (name: string) => docs.some((d) => d.name === name);
  const byNode = (list: RunDoc["read_by"]) => list.some((a) => a.node_id === nodeId);
  const reads = docs.filter((d) => byNode(d.read_by));
  return {
    shared: docs.find((d) => d.is_shared_spec) ?? null,
    writes: docs.filter((d) => !d.is_shared_spec && byNode(d.written_by)),
    missingWrite: own.writesTo && !has(own.writesTo) ? own.writesTo : null,
    reads: [...reads.filter((d) => d.is_shared_spec), ...reads.filter((d) => !d.is_shared_spec)],
    missingReads: own.readsFrom.filter((n) => !has(n)),
  };
}

const labels = (list: RunDoc["read_by"]) => joinAnd(list.map((a) => a.label));

/** "Written by Engineer", or who's set to write it when no one has. */
export function writtenBy(doc: RunDoc): string {
  return doc.written_by.length > 0 ? `Written by ${labels(doc.written_by)}` : "No one writes it";
}

/** "Read by Reviewer" on this agent's own document. */
export function readBy(doc: RunDoc): string {
  return doc.read_by.length > 0 ? `Read by ${labels(doc.read_by)}` : "No agent reads it yet";
}

/** "v3 · 31m ago", plus the shared card's "· read by all 3 agents". */
export function versionLine(doc: RunDoc, agentCount?: number): string {
  const v = doc.latest_version;
  const parts = v ? [`v${v.version_no}`, whenShort(v.created_at)] : ["No version yet"];
  if (agentCount !== undefined) {
    const n = doc.read_by.length;
    parts.push(
      n > 1 && n === agentCount
        ? `read by all ${n} agents`
        : `read by ${n} agent${n === 1 ? "" : "s"}`,
    );
  }
  return parts.filter(Boolean).join(" · ");
}

/** The shared card's "PRD · written by Product manager". */
export function specLine(doc: RunDoc): string {
  const kind = doc.doc_type === "prd" ? "PRD" : doc.name;
  return doc.written_by.length > 0 ? `${kind} · written by ${labels(doc.written_by)}` : kind;
}

/** "Shared spec" for the run's spec, else the document's name. */
export const docLabel = (doc: RunDoc): string => (doc.is_shared_spec ? "Shared spec" : doc.name);

/** The Documents drawer's "v2 · 36m ago · read by Reviewer" (readers who also write it left out). */
export function readersLine(doc: RunDoc): string {
  const writers = new Set(doc.written_by.map((a) => a.node_id));
  const readers = doc.read_by.filter((a) => !writers.has(a.node_id));
  const version = versionLine(doc);
  return readers.length > 0 ? `${version} · read by ${labels(readers)}` : version;
}

/**
 * The canvas chips (DOCS-11): each written document on its writers' cards, keyed by the canvas
 * node id — the authored id on the team canvas, the snapshot clone's id in a run view.
 */
export function docChipsByNode(docs: readonly RunDoc[], runView: boolean): Map<string, RunDoc[]> {
  const out = new Map<string, RunDoc[]>();
  for (const doc of docs) {
    if (!doc.latest_version) continue;
    for (const w of doc.written_by) {
      const id = runView ? w.clone_node_id : w.node_id;
      if (id) out.set(id, [...(out.get(id) ?? []), doc]);
    }
  }
  return out;
}
