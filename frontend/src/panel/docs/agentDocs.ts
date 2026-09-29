/**
 * The Docs tab's cards (PANEL-76..80), from one run's documents (`GET /api/runs/{id}/documents`)
 * and the agent's own Reads / Writes: the shared spec, what this agent wrote, what it read, and
 * the names it's set to use that the run didn't produce ("Not written in this run").
 */
import type { RunDoc } from "../../lib/api/nodes";
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
